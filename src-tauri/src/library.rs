//! The reader's file library: listing, uploads and downloads with progress events, folders, moves, deletes.

use std::fs::File;
use std::io::{BufWriter, Cursor};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use dpt_client::{Client, Entry, Template};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::state::Shared;
use crate::tapzones;
use crate::util::{blocking, err, CmdResult, UploadResult};

static TRANSFER_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    id: String,
    name: String,
    direction: &'static str,
    sent: u64,
    total: u64,
    done: bool,
    error: Option<String>,
}

/// Emits `transfer-progress` events, at most about ten a second.
pub(crate) struct Progress<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    id: String,
    name: String,
    direction: &'static str,
    pub(crate) total: u64,
    last: Instant,
}

impl<'a, R: Runtime> Progress<'a, R> {
    pub(crate) fn new(app: &'a AppHandle<R>, name: &str, direction: &'static str, total: u64) -> Self {
        let id = format!("{direction}-{}", TRANSFER_COUNTER.fetch_add(1, Ordering::Relaxed));
        let p = Progress { app, id, name: name.to_string(), direction, total, last: Instant::now() - Duration::from_secs(1) };
        p.emit(0, false, None);
        p
    }
    fn emit(&self, sent: u64, done: bool, error: Option<String>) {
        let _ = self.app.emit(
            "transfer-progress",
            TransferProgress { id: self.id.clone(), name: self.name.clone(), direction: self.direction, sent, total: self.total, done, error },
        );
    }
    pub(crate) fn tick(&mut self, sent: u64) {
        if self.last.elapsed() >= Duration::from_millis(100) {
            self.last = Instant::now();
            self.emit(sent, false, None);
        }
    }
    pub(crate) fn finish(&self, result: &Result<(), String>) {
        match result {
            Ok(()) => self.emit(self.total, true, None),
            Err(e) => self.emit(0, true, Some(e.clone())),
        }
    }
}

#[tauri::command]
pub async fn library_list(state: State<'_, Shared>) -> CmdResult<Vec<Entry>> {
    let c = state.client()?;
    blocking(move || c.list_entries().map_err(err)).await?
}

fn is_pdf(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("pdf")).unwrap_or(false)
}

/// Uploads one PDF. With `tap_squares` the file is first given tap squares for page turning; when that is not possible (encrypted,
/// damaged, too large) it goes up unchanged and the note says why. Returns the note, if any.
fn upload_one(c: &Client, app: &AppHandle, path: &Path, folder: &str, tap_squares: bool) -> Result<Option<String>, String> {
    if !is_pdf(path) {
        return Err("The reader only opens PDF files.".into());
    }
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("The file name is not valid text.")?.to_string();
    if !tap_squares {
        let file = File::open(path).map_err(|e| format!("Could not read the file: {e}"))?;
        let len = file.metadata().map_err(err)?.len();
        let mut progress = Progress::new(app, &name, "up", len);
        let result = c.upload_document(folder, &name, file, len, &mut |sent| progress.tick(sent)).map(|_| ()).map_err(err);
        progress.finish(&result);
        return result.map(|()| None);
    }
    let original = std::fs::read(path).map_err(|e| format!("Could not read the file: {e}"))?;
    let (bytes, note) = match tapzones::add_tap_zones(&original) {
        Ok(Some(changed)) => (changed, None),
        Ok(None) => (original, None), // one page: nothing to turn
        Err(why) => (original, Some(format!("Uploaded without tap squares: {why}."))),
    };
    let len = bytes.len() as u64;
    let mut progress = Progress::new(app, &name, "up", len);
    let result = c.upload_document(folder, &name, Cursor::new(bytes), len, &mut |sent| progress.tick(sent)).map(|_| ()).map_err(err);
    progress.finish(&result);
    result.map(|()| note)
}

#[tauri::command]
pub async fn library_upload(app: AppHandle, state: State<'_, Shared>, paths: Vec<String>, folder: String) -> CmdResult<Vec<UploadResult>> {
    let c = state.client()?;
    let folder = crate::store::normalize_remote_folder(&folder);
    let tap_squares = crate::store::load_settings(&state.dir).tap_squares;
    blocking(move || {
        paths
            .iter()
            .map(|p| {
                let path = PathBuf::from(p);
                let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.clone());
                match upload_one(&c, &app, &path, &folder, tap_squares) {
                    Ok(note) => UploadResult::ok_with_note(name, note),
                    Err(e) => UploadResult::failed(name, e),
                }
            })
            .collect()
    })
    .await
}

/// Makes a copy of a document on the reader with tap squares added ("Name (tap squares).pdf" next to it). The original is left alone:
/// it keeps its reading position and the notes written on it.
#[tauri::command]
pub async fn library_add_tap_squares(app: AppHandle, state: State<'_, Shared>, entry_id: String) -> CmdResult<UploadResult> {
    let c = state.client()?;
    blocking(move || {
        let entry = c.list_entries().map_err(err)?.into_iter().find(|e| e.id == entry_id).ok_or("That document is no longer on the reader.")?;
        let (folder, file) = entry.path.rsplit_once('/').ok_or("The document has no folder.")?;
        let stem = file.strip_suffix(".pdf").or_else(|| file.strip_suffix(".PDF")).unwrap_or(file);
        let copy = format!("{} (tap squares).pdf", stem.trim_end_matches(" (tap squares)"));

        let mut bytes = Vec::new();
        let mut down = Progress::new(&app, file, "down", entry.size);
        let got = c.download_document(&entry_id, &mut bytes, &mut |done, total| {
            if let Some(t) = total {
                down.total = t;
            }
            down.tick(done);
        });
        down.finish(&got.map(|_| ()).map_err(err));
        let changed = tapzones::add_tap_zones(&bytes).map_err(|why| format!("{why}."))?.ok_or("A one-page document has no pages to turn.")?;

        let len = changed.len() as u64;
        let mut up = Progress::new(&app, &copy, "up", len);
        let result = c.upload_document(folder, &copy, Cursor::new(changed), len, &mut |sent| up.tick(sent)).map(|_| ()).map_err(err);
        up.finish(&result);
        result?;
        Ok(UploadResult::ok(copy))
    })
    .await?
}

#[tauri::command]
pub async fn library_download(app: AppHandle, state: State<'_, Shared>, entry_id: String, dest: String) -> CmdResult<()> {
    let c = state.client()?;
    blocking(move || {
        let name = Path::new(&dest).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "document.pdf".into());
        let mut progress = Progress::new(&app, &name, "down", 0);
        let result = (|| -> Result<(), String> {
            let mut out = BufWriter::new(File::create(&dest).map_err(|e| format!("Could not create the file: {e}"))?);
            c.download_document(&entry_id, &mut out, &mut |done, total| {
                if let Some(t) = total {
                    progress.total = t;
                }
                progress.tick(done);
            })
            .map_err(err)?;
            std::io::Write::flush(&mut out).map_err(err)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&dest); // never leave a truncated copy behind
        }
        progress.finish(&result);
        result
    })
    .await?
}

#[tauri::command]
pub async fn library_delete(state: State<'_, Shared>, entry_id: String, kind: String) -> CmdResult<()> {
    let c = state.client()?;
    blocking(move || match kind.as_str() {
        "folder" => c.delete_folder(&entry_id).map_err(err),
        "document" => c.delete_document(&entry_id).map_err(err),
        other => Err(format!("unknown entry kind: {other}")),
    })
    .await?
}

#[tauri::command]
pub async fn library_new_folder(state: State<'_, Shared>, path: String) -> CmdResult<()> {
    let c = state.client()?;
    let path = crate::store::normalize_remote_folder(&path);
    blocking(move || c.ensure_folder(&path).map(|_| ()).map_err(err)).await?
}

#[tauri::command]
pub async fn library_move(state: State<'_, Shared>, entry_id: String, folder_id: String, new_name: Option<String>) -> CmdResult<()> {
    let c = state.client()?;
    blocking(move || c.move_document(&entry_id, &folder_id, new_name.as_deref()).map_err(err)).await?
}

#[tauri::command]
pub async fn library_copy(state: State<'_, Shared>, entry_id: String, folder_id: String, new_name: Option<String>) -> CmdResult<()> {
    let c = state.client()?;
    blocking(move || c.copy_document(&entry_id, &folder_id, new_name.as_deref()).map_err(err)).await?
}

#[tauri::command]
pub async fn library_open(state: State<'_, Shared>, entry_id: String, page: u32) -> CmdResult<()> {
    let c = state.client()?;
    blocking(move || c.open_document(&entry_id, page).map_err(err)).await?
}

#[tauri::command]
pub async fn templates_list(state: State<'_, Shared>) -> CmdResult<Vec<Template>> {
    let c = state.client()?;
    blocking(move || c.list_templates().map_err(err)).await?
}

#[tauri::command]
pub async fn templates_upload(state: State<'_, Shared>, path: String) -> CmdResult<()> {
    let c = state.client()?;
    blocking(move || {
        let path = PathBuf::from(path);
        if !is_pdf(&path) {
            return Err("Templates must be PDF files.".to_string());
        }
        let name = path.file_name().and_then(|n| n.to_str()).ok_or("The file name is not valid text.")?.to_string();
        let file = File::open(&path).map_err(|e| format!("Could not read the file: {e}"))?;
        let len = file.metadata().map_err(err)?.len();
        c.upload_template(&name, file, len, &mut |_| {}).map_err(err)
    })
    .await?
}

#[tauri::command]
pub async fn templates_delete(state: State<'_, Shared>, id: String) -> CmdResult<()> {
    let c = state.client()?;
    blocking(move || c.delete_template(&id).map_err(err)).await?
}
