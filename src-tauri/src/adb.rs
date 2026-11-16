//! USB debugging (ADB) for Android readers: a live screenshot of the reader's screen, battery, and opening a file on it.
//!
//! This is opt-in: ADB gives the computer full control of the reader, so nothing here runs until the user asks, and the reader itself
//! shows an "Allow USB debugging?" prompt the first time. The protocol is spoken directly over USB by `rsadb`; no `adb` program is needed.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use rsadb::auth::{self, HostKey, KeyPaths};
use rsadb::transport::usb;
use rsadb::{Device, Error, Session};
use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

use crate::state::{AppState, Shared};
use crate::util::CmdResult;

/// How long a connection waits for the user to tap Allow on the reader.
const APPROVAL_WAIT: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct AdbHub {
    sessions: Mutex<HashMap<String, Arc<Device<Session>>>>,
}

fn key_paths(state: &AppState) -> KeyPaths {
    KeyPaths::in_dir(&state.dir)
}

fn load_key(state: &AppState) -> CmdResult<HostKey> {
    let key = auth::load_or_generate(&key_paths(state), "Inkboard").map_err(|e| format!("Could not prepare the USB debugging key: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(state.dir.join("adbkey"), std::fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

fn fmt_err(e: Error) -> String {
    match e {
        Error::Unauthorized => "The reader did not approve this computer. Wake it, and tap Allow on the \"Allow USB debugging?\" prompt.".into(),
        Error::NoDevice(_) => "USB debugging is off on the reader. Turn it on under Settings > Developer options, then try again.".into(),
        Error::ClaimFailed(_) => "Another program is using the reader's debugging connection (an adb server, Android Studio?). Close it and try again.".into(),
        Error::Disconnected | Error::StreamClosed => "The reader was unplugged or stopped answering.".into(),
        other => format!("USB debugging failed: {other}"),
    }
}

/// The USB serial of the reader (the same one the file connection uses), so the right device is picked when several are plugged in.
async fn usb_serial(reader_id: &str) -> CmdResult<Option<String>> {
    let infos = crate::util::blocking(|| mtp_rs::MtpDevice::list_devices()).await?.map_err(|e| e.to_string())?;
    infos.into_iter().find(|i| crate::mtp::reader_id(i) == reader_id).map(|i| i.serial_number).ok_or_else(|| "The reader is not plugged in.".to_string())
}

// ------------------------------------------------------------------ status

#[derive(Serialize, Default)]
pub struct AdbBattery {
    level: u32,
    charging: bool,
}

#[derive(Serialize, Default)]
pub struct AdbScreen {
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbStatus {
    /// 'unavailable': the reader offers no debugging connection (USB debugging is off on it).
    /// 'off': it does, but this computer is not connected. 'ready': connected and approved.
    state: &'static str,
    android: Option<String>,
    battery: Option<AdbBattery>,
    screen: Option<AdbScreen>,
}

impl AdbStatus {
    fn bare(state: &'static str) -> Self {
        Self { state, android: None, battery: None, screen: None }
    }
}

async fn shell(d: &Device<Session>, cmd: &str) -> Result<String, Error> {
    Ok(d.shell(cmd).await?.stdout_text().to_string())
}

/// `dumpsys battery` prints "  level: 44", "  status: 2" (2 charging, 5 full) and "  AC powered: true".
pub fn parse_battery(text: &str) -> Option<AdbBattery> {
    let field = |name: &str| text.lines().map(str::trim).find_map(|l| l.strip_prefix(name)).map(|v| v.trim_start_matches(':').trim().to_string());
    let level: u32 = field("level")?.parse().ok()?;
    let status: u32 = field("status").and_then(|s| s.parse().ok()).unwrap_or(0);
    let powered = ["AC powered", "USB powered", "Wireless powered"].iter().any(|k| field(k).as_deref() == Some("true"));
    Some(AdbBattery { level, charging: status == 2 || (status == 5 && powered) })
}

/// `wm size` prints "Physical size: 2400x3200" and, when changed, "Override size: ...".
pub fn parse_screen(text: &str) -> Option<AdbScreen> {
    let line = text.lines().rev().find(|l| l.contains("size:"))?;
    let (w, h) = line.split(':').nth(1)?.trim().split_once('x')?;
    Some(AdbScreen { width: w.trim().parse().ok()?, height: h.trim().parse().ok()? })
}

async fn describe(d: &Device<Session>) -> Result<AdbStatus, Error> {
    let android = d.getprop("ro.build.version.release").await.ok().filter(|v| !v.trim().is_empty()).map(|v| v.trim().to_string());
    let battery = shell(d, "dumpsys battery").await.ok().and_then(|t| parse_battery(&t));
    let screen = shell(d, "wm size").await.ok().and_then(|t| parse_screen(&t));
    Ok(AdbStatus { state: "ready", android, battery, screen })
}

async fn session(state: &AppState, id: &str) -> Option<Arc<Device<Session>>> {
    state.adb.sessions.lock().await.get(id).cloned()
}

/// Never prompts: 'ready' only when a connection is already open and still answering.
#[tauri::command]
pub async fn adb_status(state: State<'_, Shared>, id: String) -> CmdResult<AdbStatus> {
    if let Some(d) = session(&state, &id).await {
        match describe(&d).await {
            Ok(s) => return Ok(s),
            Err(_) => {
                state.adb.sessions.lock().await.remove(&id); // unplugged or restarted
            }
        }
    }
    let serial = usb_serial(&id).await?;
    Ok(match usb::find(serial.as_deref()).await {
        Ok(_) => AdbStatus::bare("off"),
        Err(_) => AdbStatus::bare("unavailable"),
    })
}

/// Connects, which makes the reader ask the user to approve this computer; waits up to a minute for the tap.
#[tauri::command]
pub async fn adb_connect(state: State<'_, Shared>, id: String) -> CmdResult<AdbStatus> {
    if let Some(d) = session(&state, &id).await {
        if let Ok(s) = describe(&d).await {
            return Ok(s);
        }
        state.adb.sessions.lock().await.remove(&id);
    }
    let key = load_key(&state)?;
    let serial = usb_serial(&id).await?;
    let info = usb::find(serial.as_deref()).await.map_err(fmt_err)?;
    let transport = usb::open(&info).await.map_err(fmt_err)?;
    let session = Session::connect(transport, &key, APPROVAL_WAIT).await.map_err(fmt_err)?;
    let device = Arc::new(Device::new(session));
    let status = describe(&device).await.map_err(fmt_err)?;
    state.adb.sessions.lock().await.insert(id, device);
    Ok(status)
}

#[tauri::command]
pub async fn adb_disconnect(state: State<'_, Shared>, id: String) -> CmdResult<()> {
    state.adb.sessions.lock().await.remove(&id);
    Ok(())
}

async fn ready(state: &AppState, id: &str) -> CmdResult<Arc<Device<Session>>> {
    session(state, id).await.ok_or_else(|| "USB debugging is not connected. Turn it on from the reader's device page first.".to_string())
}

fn drop_if_gone(e: &Error) -> bool {
    matches!(e, Error::Disconnected | Error::StreamClosed)
}

/// A PNG of the reader's screen right now, as a data URL.
#[tauri::command]
pub async fn adb_screenshot(state: State<'_, Shared>, id: String) -> CmdResult<String> {
    let d = ready(&state, &id).await?;
    match d.screencap().await {
        Ok(png) => Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))),
        Err(e) => {
            if drop_if_gone(&e) {
                state.adb.sessions.lock().await.remove(&id);
            }
            Err(fmt_err(e))
        }
    }
}

// ------------------------------------------------------------------ opening a file on the reader

fn mime_of(name: &str) -> &'static str {
    match name.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
        Some("pdf") => "application/pdf",
        Some("epub") => "application/epub+zip",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("txt" | "md") => "text/plain",
        Some("html" | "htm") => "text/html",
        Some("fb2") => "application/x-fictionbook+xml",
        Some("mobi") => "application/x-mobipocket-ebook",
        Some("cbz") => "application/vnd.comicbook+zip",
        _ => "*/*",
    }
}

/// Reader apps to try first, so Android does not stop to ask which app to use ("Open with"): Onyx's own reader and gallery.
fn preferred_packages(mime: &str) -> &'static [&'static str] {
    if mime.starts_with("image/") {
        &["com.onyx.gallery"]
    } else {
        &["com.onyx.kreader"]
    }
}

/// The commands that show `path` (relative to the main storage, like "Documents/Inkboard/Day.pdf") in the reader's viewer, best first:
/// aimed at the reader's own app, then (for other readers, or when that app is missing) a plain view request. The URI is
/// percent-encoded down to a safe alphabet, so the path cannot add anything to the shell command.
pub fn open_commands(path: &str) -> CmdResult<Vec<String>> {
    use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
    const KEEP: &AsciiSet = &NON_ALPHANUMERIC.remove(b'/').remove(b'.').remove(b'-').remove(b'_');
    let path = path.trim().trim_start_matches('/');
    if path.is_empty() || path.split('/').any(|p| p == "..") {
        return Err("That is not a path on the reader.".into());
    }
    let name = path.rsplit('/').next().unwrap_or(path);
    let uri = format!("file:///storage/emulated/0/{}", utf8_percent_encode(path, KEEP));
    let mime = mime_of(name);
    let base = format!("am start -a android.intent.action.VIEW -d {uri} -t {mime}");
    let mut out: Vec<String> = preferred_packages(mime).iter().map(|p| format!("{base} -p {p}")).collect();
    out.push(base);
    Ok(out)
}

#[tauri::command]
pub async fn adb_open(state: State<'_, Shared>, id: String, path: String) -> CmdResult<()> {
    let d = ready(&state, &id).await?;
    for cmd in open_commands(&path)? {
        let out = shell(&d, &cmd).await.map_err(fmt_err)?;
        // "Error: Activity not started, unable to resolve Intent" means no such app: try the next way
        if !out.contains("Error") && !out.contains("Exception") {
            return Ok(());
        }
    }
    Err("The reader could not open that file.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn battery_is_read_from_dumpsys() {
        let text = "Current Battery Service state:\n  AC powered: false\n  USB powered: true\n  status: 2\n  health: 2\n  present: true\n  level: 44\n  scale: 100\n";
        let b = parse_battery(text).unwrap();
        assert_eq!((b.level, b.charging), (44, true));
        let full = parse_battery("  USB powered: false\n  AC powered: false\n  status: 3\n  level: 80\n").unwrap();
        assert!(!full.charging);
        assert!(parse_battery("nothing useful").is_none());
    }

    #[test]
    fn screen_size_prefers_the_override() {
        assert_eq!(parse_screen("Physical size: 2400x3200\n").map(|s| (s.width, s.height)), Some((2400, 3200)));
        assert_eq!(parse_screen("Physical size: 2400x3200\nOverride size: 1200x1600\n").map(|s| (s.width, s.height)), Some((1200, 1600)));
        assert!(parse_screen("").is_none());
    }

    #[test]
    fn open_commands_are_quoted_safely() {
        let c = open_commands("Documents/Inkboard/Day plan.pdf").unwrap();
        let base = "am start -a android.intent.action.VIEW -d file:///storage/emulated/0/Documents/Inkboard/Day%20plan.pdf -t application/pdf";
        assert_eq!(c, [format!("{base} -p com.onyx.kreader"), base.to_string()]);
        assert!(open_commands("Pictures/Inkboard/Wall.png").unwrap()[0].ends_with("-p com.onyx.gallery"));
        for cmd in open_commands("x'; rm -rf /sdcard; echo '.pdf").unwrap() {
            assert!(!cmd.contains(';') && !cmd.contains('\''), "{cmd}");
            assert!(cmd.split_whitespace().count() >= 8, "the path must stay one argument: {cmd}");
        }
        assert!(open_commands("../etc/passwd").is_err());
        assert!(open_commands("  ").is_err());
    }

    #[test]
    fn mime_types_by_extension() {
        assert_eq!(mime_of("a.EPUB"), "application/epub+zip");
        assert_eq!(mime_of("noext"), "*/*");
    }
}
