//! The reader's file library: listing, uploads and downloads with progress events, folders, moves, deletes.

use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use dpt_client::{Client, Entry, Template};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::Shared;
use crate::util::{blocking, err, CmdResult};

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
struct Progress<'a> {
    app: &'a AppHandle,
    id: String,
    name: String,
    direction: &'static str,
    total: u64,
    last: Instant,
}

impl<'a> Progress<'a> {
    fn new(app: &'a AppHandle, name: &str, direction: &'static str, total: u64) -> Self {
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
    fn tick(&mut self, sent: u64) {
        if self.last.elapsed() >= Duration::from_millis(100) {
            self.last = Instant::now();
            self.emit(sent, false, None);
        }
    }
    fn finish(&self, result: &Result<(), String>) {
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

#[derive(Serialize)]
pub struct UploadResult {
    name: String,
    ok: bool,
    error: Option<String>,
}

fn is_pdf(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("pdf")).unwrap_or(false)
}

fn upload_one(c: &Client, app: &AppHandle, path: &Path, folder: &str) -> Result<(), String> {
    if !is_pdf(path) {
        return Err("The reader only opens PDF files.".into());
    }
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("The file name is not valid text.")?.to_string();
    let file = File::open(path).map_err(|e| format!("Could not read the file: {e}"))?;
    let len = file.metadata().map_err(err)?.len();
    let mut progress = Progress::new(app, &name, "up", len);
    let result = c.upload_document(folder, &name, file, len, &mut |sent| progress.tick(sent)).map(|_| ()).map_err(err);
    progress.finish(&result);
    result
}

#[tauri::command]
pub async fn library_upload(app: AppHandle, state: State<'_, Shared>, paths: Vec<String>, folder: String) -> CmdResult<Vec<UploadResult>> {
    let c = state.client()?;
    let folder = crate::store::normalize_remote_folder(&folder);
    blocking(move || {
        paths
            .iter()
            .map(|p| {
                let path = PathBuf::from(p);
                let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.clone());
                match upload_one(&c, &app, &path, &folder) {
                    Ok(()) => UploadResult { name, ok: true, error: None },
                    Err(e) => UploadResult { name, ok: false, error: Some(e) },
                }
            })
            .collect()
    })
    .await
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
