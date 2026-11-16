//! USB readers over MTP (Boox and other Android e-readers): detection, a file manager, and a place to put dashboards.
//!
//! The device exposes its storage as files only: there is no way to open a document on its screen or to read its settings
//! over MTP, so the Digital Paper's feature set is deliberately not mirrored here.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use bytes::Bytes;
use dpt_client::Credentials;
use futures_util::stream;
use mtp_rs::{ByteRange, MtpDevice, MtpDeviceInfo, NewObjectInfo, ObjectHandle, ObjectInfo, Storage, StorageId, UsbSpeed, UtcOffset};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use crate::library::Progress;
use crate::state::{AppState, Shared};
use crate::store;
use crate::util::{CmdResult, UploadResult};

// ------------------------------------------------------------------ the hub: which devices are open

#[derive(Default)]
pub struct MtpHub {
    /// open sessions by reader id; MTP allows one session per device, so it is opened once and kept
    devices: Mutex<HashMap<String, Arc<MtpDevice>>>,
    /// what a device called itself the last time it was opened: (maker, model)
    known: StdMutex<HashMap<String, (String, String)>>,
}

impl MtpHub {
    pub async fn forget(&self, id: &str) {
        self.devices.lock().await.remove(id);
    }
}

fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.bytes() {
        h ^= u32::from(b);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// Stable for a device while it stays plugged in and across replugs when it has a serial number; the serial itself never leaves the process.
pub fn reader_id(info: &MtpDeviceInfo) -> String {
    let key = format!("{:04x}:{:04x}:{}", info.vendor_id, info.product_id, info.serial_number.clone().unwrap_or_else(|| format!("loc{:x}", info.location_id)));
    format!("mtp:{:08x}", fnv1a(&key))
}

fn fmt_err(e: mtp_rs::Error) -> String {
    use mtp_rs::Error as E;
    match e {
        E::ExclusiveAccess => "Another program is using the reader. Close any file manager that has it open and try again.".into(),
        E::PermissionDenied => "This computer may not talk to the reader over USB. On Linux that usually needs a udev rule for the device.".into(),
        E::Busy => "The reader is busy. Wait a moment and try again.".into(),
        E::StorageFull => "The reader's storage is full.".into(),
        E::Disconnected => "The reader was unplugged or stopped answering.".into(),
        E::AccessDenied => "The reader refused that: the folder or file is protected.".into(),
        E::StaleHandle => "The reader re-indexed its files. Refresh the list and try again.".into(),
        E::NotFound => "That file or folder is no longer on the reader.".into(),
        E::Unsupported => "The reader does not support that over USB.".into(),
        E::AlreadyExists => "Something with that name is already there.".into(),
        other => format!("The reader reported an error: {other}"),
    }
}

fn is_gone(e: &mtp_rs::Error) -> bool {
    matches!(e, mtp_rs::Error::Disconnected)
}

async fn find_info(id: &str) -> CmdResult<MtpDeviceInfo> {
    let list = crate::util::blocking(|| MtpDevice::list_devices()).await?.map_err(fmt_err)?;
    list.into_iter().find(|i| reader_id(i) == id).ok_or_else(|| "The reader is not plugged in.".to_string())
}

/// The open session for `id`, opening it on first use.
async fn device(hub: &MtpHub, id: &str) -> CmdResult<Arc<MtpDevice>> {
    let mut devices = hub.devices.lock().await;
    if let Some(d) = devices.get(id) {
        return Ok(d.clone());
    }
    let info = find_info(id).await?;
    let opened = match &info.serial_number {
        Some(serial) => MtpDevice::open_by_serial(serial).await,
        None => MtpDevice::open_by_location(info.location_id).await,
    }
    .map_err(|e| match e {
        mtp_rs::Error::Timeout | mtp_rs::Error::Disconnected => {
            "The reader did not answer. Unlock it, and set its USB mode to file transfer (MTP).".to_string()
        }
        other => fmt_err(other),
    })?;
    let d = &opened.device_info();
    hub.known.lock().unwrap().insert(id.to_string(), (d.manufacturer.clone(), d.model.clone()));
    let opened = Arc::new(opened);
    devices.insert(id.to_string(), opened.clone());
    Ok(opened)
}

async fn storage(hub: &MtpHub, id: &str, storage: u32) -> CmdResult<(Arc<MtpDevice>, Storage)> {
    let dev = device(hub, id).await?;
    match dev.storage(StorageId(u64::from(storage))).await {
        Ok(s) => Ok((dev, s)),
        Err(e) => {
            if is_gone(&e) {
                hub.forget(id).await;
            }
            Err(fmt_err(e))
        }
    }
}

fn handle_of(h: Option<u32>) -> Option<ObjectHandle> {
    h.map(|n| ObjectHandle(u64::from(n)))
}

// ------------------------------------------------------------------ readers

#[derive(Serialize)]
pub struct Reader {
    id: String,
    kind: &'static str,
    name: String,
    maker: String,
    connected: bool,
    link: &'static str,
}

/// "TabXC" -> "Tab XC": the device reports a model without spaces; a break before each capital makes it readable.
pub fn prettify_model(model: &str) -> String {
    let mut out = String::new();
    let mut prev: Option<char> = None;
    for c in model.chars() {
        if let Some(p) = prev {
            if c.is_uppercase() && (p.is_lowercase() || p.is_ascii_digit()) {
                out.push(' ');
            }
        }
        out.push(c);
        prev = Some(c);
    }
    out
}

/// The USB product string often carries a serial ("SM8150-MTP _SN:1234"); drop that part.
fn clean_product(p: &str) -> String {
    p.split(" _SN:").next().unwrap_or(p).trim().to_string()
}

/// Whether something answers on the Digital Paper's HTTPS port; bounded so the reader list never stalls on a sleeping reader.
fn reachable(addr: &str) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    let Ok(mut addrs) = (addr, 8443u16).to_socket_addrs() else { return false };
    addrs.next().map(|a| TcpStream::connect_timeout(&a, Duration::from_millis(800)).is_ok()).unwrap_or(false)
}

#[tauri::command]
pub async fn readers_list(state: State<'_, Shared>) -> CmdResult<Vec<Reader>> {
    let st = state.inner().clone();
    let mut out = Vec::new();

    if let Some(rec) = store::load_device(&st.dir) {
        if Credentials::exists_in(&st.dir) {
            let has_session = st.client.lock().unwrap().is_some();
            let addr = rec.addr.clone();
            let connected = has_session && crate::util::blocking(move || reachable(&addr)).await?;
            out.push(Reader { id: "dpt".into(), kind: "digital-paper", name: rec.model.clone().unwrap_or_else(|| "DPT-RP1".into()), maker: "Sony".into(), connected, link: "wifi" });
        }
    }

    let infos = crate::util::blocking(|| MtpDevice::list_devices()).await?.unwrap_or_default();
    for info in infos {
        let id = reader_id(&info);
        // learn the real name once: opening a session is quick, and failing to (device busy, locked) just leaves the USB strings
        let known = st.mtp.known.lock().unwrap().get(&id).cloned();
        let known = match known {
            Some(k) => Some(k),
            None => {
                let _ = tokio::time::timeout(Duration::from_secs(4), device(&st.mtp, &id)).await;
                st.mtp.known.lock().unwrap().get(&id).cloned()
            }
        };
        let (maker, name) = match known {
            Some((maker, model)) => (maker, prettify_model(&model)),
            None => (info.manufacturer.clone().unwrap_or_else(|| "USB".into()), clean_product(info.product.as_deref().unwrap_or("Reader"))),
        };
        let open = st.mtp.devices.lock().await.contains_key(&id);
        out.push(Reader { id, kind: "mtp", name, maker, connected: open, link: "usb" });
    }
    Ok(out)
}

// ------------------------------------------------------------------ status

#[derive(Serialize)]
pub struct MtpStorageInfo {
    id: u32,
    name: String,
    total: u64,
    free: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MtpStatus {
    id: String,
    maker: String,
    model: String,
    name: String,
    storages: Vec<MtpStorageInfo>,
    usb_speed: Option<String>,
}

fn speed_label(s: UsbSpeed) -> &'static str {
    match s {
        UsbSpeed::Low => "Low speed (1.5 Mbit/s)",
        UsbSpeed::Full => "Full speed (12 Mbit/s)",
        UsbSpeed::High => "High speed (480 Mbit/s)",
        UsbSpeed::Super => "SuperSpeed (5 Gbit/s)",
        UsbSpeed::SuperPlus => "SuperSpeed+ (10 Gbit/s)",
        _ => "Unknown speed",
    }
}

#[tauri::command]
pub async fn mtp_status(state: State<'_, Shared>, id: String) -> CmdResult<MtpStatus> {
    let dev = device(&state.mtp, &id).await?;
    let storages = match dev.storages().await {
        Ok(s) => s,
        Err(e) => {
            if is_gone(&e) {
                state.mtp.forget(&id).await;
            }
            return Err(fmt_err(e));
        }
    };
    let info = dev.device_info();
    let usb_speed = find_info(&id).await.ok().and_then(|i| i.speed).map(|s| speed_label(s).to_string());
    Ok(MtpStatus {
        id,
        maker: info.manufacturer.clone(),
        model: info.model.clone(),
        name: prettify_model(&info.model),
        storages: storages
            .iter()
            .map(|s| {
                let i = s.info();
                MtpStorageInfo { id: s.id().0 as u32, name: i.description.clone(), total: i.total_capacity, free: i.free_space }
            })
            .collect(),
        usb_speed,
    })
}

// ------------------------------------------------------------------ files

#[derive(Serialize)]
pub struct MtpEntry {
    handle: u32,
    name: String,
    kind: &'static str,
    size: u64,
    modified: Option<String>,
}

fn iso(dt: &mtp_rs::DateTime) -> Option<String> {
    use time::format_description::well_known::Rfc3339;
    let secs = dt.to_unix_seconds_with_fallback(UtcOffset::UTC)?;
    time::OffsetDateTime::from_unix_timestamp(secs).ok()?.format(&Rfc3339).ok()
}

fn entry_of(o: &ObjectInfo) -> MtpEntry {
    MtpEntry {
        handle: o.handle.0 as u32,
        name: o.filename.clone(),
        kind: if o.is_folder() { "folder" } else { "file" },
        size: o.size,
        modified: o.modified.as_ref().and_then(iso),
    }
}

#[tauri::command]
pub async fn mtp_list(state: State<'_, Shared>, id: String, storage: u32, parent: Option<u32>) -> CmdResult<Vec<MtpEntry>> {
    let (_dev, st) = self::storage(&state.mtp, &id, storage).await?;
    match st.list_objects(handle_of(parent)).await {
        Ok(list) => Ok(list.iter().map(entry_of).collect()),
        Err(e) => {
            if is_gone(&e) {
                state.mtp.forget(&id).await;
            }
            Err(fmt_err(e))
        }
    }
}

/// A byte stream over a file, in 256 KiB chunks.
fn file_stream(file: tokio::fs::File) -> impl futures_util::Stream<Item = Result<Bytes, std::io::Error>> + Unpin + Send {
    Box::pin(stream::unfold(file, |mut f| async move {
        let mut buf = vec![0u8; 256 * 1024];
        match f.read(&mut buf).await {
            Ok(0) => None,
            Ok(n) => {
                buf.truncate(n);
                Some((Ok(Bytes::from(buf)), f))
            }
            Err(e) => Some((Err(e), f)),
        }
    }))
}

async fn upload_path<R: Runtime>(st: &Storage, app: &AppHandle<R>, parent: Option<ObjectHandle>, path: &Path) -> Result<(), String> {
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("The file name is not valid text.")?.to_string();
    let file = tokio::fs::File::open(path).await.map_err(|e| format!("Could not read the file: {e}"))?;
    let len = file.metadata().await.map_err(|e| e.to_string())?.len();
    // a file of the same name is replaced instead of duplicated
    if let Ok(existing) = st.list_objects(parent).await {
        if let Some(old) = existing.iter().find(|o| !o.is_folder() && o.filename == name) {
            st.delete(old.handle).await.map_err(fmt_err)?;
        }
    }
    let mut progress = Progress::new(app, &name, "up", len);
    let result = st
        .upload_with_progress(parent, NewObjectInfo::file(name.clone(), len), file_stream(file), |p| {
            progress.tick(p.bytes_transferred);
            std::ops::ControlFlow::Continue(())
        })
        .await
        .map(|_| ())
        .map_err(|e| fmt_err(e.source));
    progress.finish(&result);
    result
}

#[tauri::command]
pub async fn mtp_upload<R: Runtime>(app: AppHandle<R>, state: State<'_, Shared>, id: String, storage: u32, parent: Option<u32>, paths: Vec<String>) -> CmdResult<Vec<UploadResult>> {
    let (_dev, st) = self::storage(&state.mtp, &id, storage).await?;
    let mut out = Vec::new();
    for p in paths {
        let path = PathBuf::from(&p);
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.clone());
        match upload_path(&st, &app, handle_of(parent), &path).await {
            Ok(()) => out.push(UploadResult::ok(name)),
            Err(e) => out.push(UploadResult::failed(name, e)),
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn mtp_download<R: Runtime>(app: AppHandle<R>, state: State<'_, Shared>, id: String, storage: u32, handle: u32, dest: String) -> CmdResult<()> {
    let (_dev, st) = self::storage(&state.mtp, &id, storage).await?;
    let name = Path::new(&dest).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
    let mut dl = st.download(ObjectHandle(u64::from(handle)), ByteRange::Full).await.map_err(fmt_err)?;
    let mut progress = Progress::new(&app, &name, "down", dl.size());
    let result: Result<(), String> = async {
        let mut out = tokio::fs::File::create(&dest).await.map_err(|e| format!("Could not create the file: {e}"))?;
        while let Some(chunk) = dl.next_chunk().await {
            let chunk = chunk.map_err(fmt_err)?;
            out.write_all(&chunk).await.map_err(|e| e.to_string())?;
            progress.tick(dl.bytes_received());
        }
        out.flush().await.map_err(|e| e.to_string())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&dest).await; // never leave a truncated copy behind
    }
    progress.finish(&result);
    result
}

/// Deletes the object and everything under it, deepest first.
async fn delete_tree(st: &Storage, handle: ObjectHandle) -> Result<(), mtp_rs::Error> {
    let mut order = vec![handle];
    let mut i = 0;
    while i < order.len() {
        let info = st.get_object_info(order[i]).await?;
        if info.is_folder() {
            for child in st.list_objects(Some(order[i])).await? {
                order.push(child.handle);
            }
        }
        i += 1;
    }
    for h in order.into_iter().rev() {
        st.delete(h).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn mtp_delete(state: State<'_, Shared>, id: String, storage: u32, handle: u32) -> CmdResult<()> {
    let (_dev, st) = self::storage(&state.mtp, &id, storage).await?;
    delete_tree(&st, ObjectHandle(u64::from(handle))).await.map_err(fmt_err)
}

#[tauri::command]
pub async fn mtp_new_folder(state: State<'_, Shared>, id: String, storage: u32, parent: Option<u32>, name: String) -> CmdResult<u32> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') {
        return Err("Enter a folder name without slashes.".into());
    }
    let (_dev, st) = self::storage(&state.mtp, &id, storage).await?;
    st.create_folder(handle_of(parent), name).await.map(|h| h.0 as u32).map_err(fmt_err)
}

#[tauri::command]
pub async fn mtp_rename(state: State<'_, Shared>, id: String, storage: u32, handle: u32, name: String) -> CmdResult<()> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') {
        return Err("Enter a name without slashes.".into());
    }
    let (dev, st) = self::storage(&state.mtp, &id, storage).await?;
    if !dev.supports_rename() {
        return Err("This reader does not support renaming over USB.".into());
    }
    st.rename(ObjectHandle(u64::from(handle)), name).await.map_err(fmt_err)
}

#[tauri::command]
pub async fn mtp_move(state: State<'_, Shared>, id: String, storage: u32, handle: u32, parent: Option<u32>) -> CmdResult<()> {
    let (_dev, st) = self::storage(&state.mtp, &id, storage).await?;
    st.move_object(ObjectHandle(u64::from(handle)), handle_of(parent).unwrap_or(ObjectHandle::ROOT), None).await.map_err(fmt_err)
}

// ------------------------------------------------------------------ dashboards

/// Finds or creates a folder path ("Documents/Inkboard") on the storage and returns its handle.
async fn ensure_path(st: &Storage, path: &str) -> Result<Option<ObjectHandle>, mtp_rs::Error> {
    let mut parent: Option<ObjectHandle> = None;
    for part in path.split('/').map(str::trim).filter(|p| !p.is_empty()) {
        let children = st.list_objects(parent).await?;
        parent = match children.iter().find(|o| o.is_folder() && o.filename.eq_ignore_ascii_case(part)) {
            Some(f) => Some(f.handle),
            None => Some(st.create_folder(parent, part).await?),
        };
    }
    Ok(parent)
}

/// Writes finished dashboard files (already encoded) into `folder` on the reader's main storage, replacing same-named files.
/// Returns the folder path used.
pub async fn put_files(state: &AppState, reader_id: &str, folder: &str, files: Vec<(String, Vec<u8>)>) -> CmdResult<String> {
    let dev = device(&state.mtp, reader_id).await?;
    let storages = dev.storages().await.map_err(fmt_err)?;
    let st = storages.into_iter().next().ok_or("The reader has no storage.")?;
    let folder = folder.trim().trim_matches('/').to_string();
    let result: Result<(), mtp_rs::Error> = async {
        let parent = ensure_path(&st, &folder).await?;
        for (name, data) in files {
            if let Some(old) = st.list_objects(parent).await?.iter().find(|o| !o.is_folder() && o.filename == name) {
                st.delete(old.handle).await?;
            }
            let len = data.len() as u64;
            let body = Box::pin(stream::once(async move { Ok::<Bytes, std::io::Error>(Bytes::from(data)) }));
            st.upload(parent, NewObjectInfo::file(name, len), body).await.map_err(|e| e.source)?;
        }
        Ok(())
    }
    .await;
    match result {
        Ok(()) => Ok(folder),
        Err(e) => {
            if is_gone(&e) {
                state.mtp.forget(reader_id).await;
            }
            Err(fmt_err(e))
        }
    }
}

/// How a dashboard is published to a USB reader.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum Target {
    Dpt,
    Mtp { reader_id: String, folder: String, format: String },
}

pub fn default_folder(format: &str) -> &'static str {
    if format == "png" {
        "Pictures/Inkboard"
    } else {
        "Documents/Inkboard"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_names_are_made_readable() {
        assert_eq!(prettify_model("TabXC"), "Tab XC");
        assert_eq!(prettify_model("Kindle"), "Kindle");
        assert_eq!(prettify_model("Note3"), "Note3");
        assert_eq!(prettify_model("Go6Color"), "Go6 Color");
    }

    #[test]
    fn usb_product_strings_lose_their_serial() {
        assert_eq!(clean_product("SM8150-MTP _SN:0A1B2C3D"), "SM8150-MTP");
        assert_eq!(clean_product("Kindle"), "Kindle");
    }

    #[test]
    fn default_folders_depend_on_the_format() {
        assert_eq!(default_folder("pdf"), "Documents/Inkboard");
        assert_eq!(default_folder("png"), "Pictures/Inkboard");
    }

    #[test]
    fn publish_targets_parse_like_the_ui_sends_them() {
        let t: Target = serde_json::from_str(r#"{"kind":"mtp","readerId":"mtp:00ff","folder":"","format":"png"}"#).unwrap();
        assert!(matches!(t, Target::Mtp { ref reader_id, ref format, .. } if reader_id == "mtp:00ff" && format == "png"));
        assert!(matches!(serde_json::from_str::<Target>(r#"{"kind":"dpt"}"#).unwrap(), Target::Dpt));
    }

    #[test]
    fn reader_ids_are_stable_hashes() {
        assert_eq!(fnv1a("a"), fnv1a("a"));
        assert_ne!(fnv1a("a"), fnv1a("b"));
        assert_eq!(format!("mtp:{:08x}", fnv1a("")), "mtp:811c9dc5");
    }
}
