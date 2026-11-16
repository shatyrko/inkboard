//! Dashboards: the saved documents, the data their widgets pull in, and publishing the rendered pages to the reader.

use std::fs;
use std::path::Path;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::{InvokeBody, Request};
use tauri::State;

use crate::mtp::{self, Target};
use crate::pdf::{self, PageSpec};
use crate::pngout;
use crate::state::Shared;
use crate::stats::{self, SystemStats};
use crate::store::{self, valid_id};
use crate::util::{blocking, err, now_iso, run_shell, CmdResult};

// ------------------------------------------------------------------ saved documents

#[derive(Serialize)]
pub struct DashboardSummary {
    id: String,
    name: String,
    updated: String,
}

#[tauri::command]
pub async fn dashboards_list(state: State<'_, Shared>) -> CmdResult<Vec<DashboardSummary>> {
    let dir = store::dashboards_dir(&state.dir);
    blocking(move || {
        let mut out: Vec<DashboardSummary> = fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let path = e.path();
                if path.extension()?.to_str()? != "json" {
                    return None;
                }
                let doc: Value = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
                Some(DashboardSummary {
                    id: doc.get("id")?.as_str()?.to_string(),
                    name: doc.get("name").and_then(Value::as_str).unwrap_or("Untitled").to_string(),
                    updated: doc.get("updated").and_then(Value::as_str).unwrap_or_default().to_string(),
                })
            })
            .collect();
        out.sort_by(|a, b| b.updated.cmp(&a.updated));
        out
    })
    .await
}

#[tauri::command]
pub async fn dashboards_load(state: State<'_, Shared>, id: String) -> CmdResult<Value> {
    if !valid_id(&id) {
        return Err("Invalid dashboard id.".into());
    }
    let path = store::dashboards_dir(&state.dir).join(format!("{id}.json"));
    blocking(move || serde_json::from_slice(&fs::read(path).map_err(|_| "That dashboard no longer exists.".to_string())?).map_err(err)).await?
}

#[tauri::command]
pub async fn dashboards_save(state: State<'_, Shared>, mut doc: Value) -> CmdResult<()> {
    let id = doc.get("id").and_then(Value::as_str).ok_or("The dashboard has no id.")?.to_string();
    if !valid_id(&id) {
        return Err("Invalid dashboard id.".into());
    }
    if doc.get("name").and_then(Value::as_str).is_none() {
        return Err("The dashboard has no name.".into());
    }
    doc["updated"] = json!(now_iso());
    let path = store::dashboards_dir(&state.dir).join(format!("{id}.json"));
    blocking(move || store::write_atomic(&path, &serde_json::to_vec_pretty(&doc).map_err(err)?).map_err(err)).await?
}

#[tauri::command]
pub async fn dashboards_delete(state: State<'_, Shared>, id: String) -> CmdResult<()> {
    if !valid_id(&id) {
        return Err("Invalid dashboard id.".into());
    }
    let path = store::dashboards_dir(&state.dir).join(format!("{id}.json"));
    blocking(move || match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err(e)),
    })
    .await?
}

// ------------------------------------------------------------------ data for widgets

#[tauri::command]
pub async fn system_stats(state: State<'_, Shared>) -> CmdResult<SystemStats> {
    let st = state.inner().clone();
    blocking(move || stats::collect(&st.sys)).await
}

#[tauri::command]
pub async fn fetch_text(url: String) -> CmdResult<String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http:// and https:// addresses can be fetched.".into());
    }
    blocking(move || {
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(10))).http_status_as_error(false).build().into();
        let mut resp = agent.get(&url).call().map_err(|e| format!("Could not fetch it: {e}"))?;
        let status = resp.status().as_u16();
        if status >= 400 {
            return Err(format!("The server answered {status}."));
        }
        resp.body_mut().with_config().limit(1_000_000).lossy_utf8(true).read_to_string().map_err(|e| format!("Could not read the answer: {e}"))
    })
    .await?
}

#[tauri::command]
pub async fn run_command(state: State<'_, Shared>, command: String) -> CmdResult<String> {
    if !store::load_settings(&state.dir).allow_commands {
        return Err("Commands are disabled. Turn them on in Settings.".into());
    }
    blocking(move || run_shell(&command, Duration::from_secs(10), 64 * 1024)).await?
}

#[tauri::command]
pub async fn read_image(path: String) -> CmdResult<String> {
    blocking(move || {
        let p = Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            _ => return Err("Use a PNG, JPEG, GIF, WebP or SVG image.".to_string()),
        };
        let meta = fs::metadata(p).map_err(|e| format!("Could not read the image: {e}"))?;
        if meta.len() > 8 * 1024 * 1024 {
            return Err("That image is larger than 8 MB.".into());
        }
        let bytes = fs::read(p).map_err(err)?;
        Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    })
    .await?
}

// ------------------------------------------------------------------ publishing

#[derive(Deserialize)]
struct PublishMeta {
    name: String,
    folder: String,
    display: bool,
    pages: Vec<PageSpec>,
    /// where to publish; absent means the paired Digital Paper
    #[serde(default)]
    target: Option<Target>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    path: String,
    entry_id: String,
    pages: usize,
    bytes: usize,
}

fn header(request: &Request<'_>, name: &str) -> CmdResult<String> {
    let raw = request.headers().get(name).and_then(|v| v.to_str().ok()).ok_or_else(|| format!("missing {name} header"))?;
    percent_encoding::percent_decode_str(raw).decode_utf8().map(|s| s.into_owned()).map_err(err)
}

fn parse(request: &Request<'_>) -> CmdResult<(PublishMeta, Vec<u8>)> {
    let meta: PublishMeta = serde_json::from_str(&header(request, "x-meta")?).map_err(|e| format!("bad publish description: {e}"))?;
    let InvokeBody::Raw(pixels) = request.body() else { return Err("the page pixels were not sent as raw bytes".into()) };
    Ok((meta, pixels.clone()))
}

/// A file name the reader and every file system accept.
fn file_stem(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { ' ' } else { c }).collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned = cleaned.trim_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "Dashboard".into()
    } else {
        cleaned.chars().take(80).collect()
    }
}

#[tauri::command]
pub async fn dashboard_publish(state: State<'_, Shared>, request: Request<'_>) -> CmdResult<PublishResult> {
    let (meta, pixels) = parse(&request)?;
    if let Some(Target::Mtp { reader_id, folder, format }) = meta.target.clone() {
        return publish_to_usb_reader(state.inner().as_ref(), &meta, &pixels, &reader_id, &folder, &format).await;
    }
    let c = state.client()?;
    let settings = store::load_settings(&state.dir);
    blocking(move || {
        let pdf = pdf::build(&meta.name, &meta.pages, &pixels)?;
        let folder = if meta.folder.trim().is_empty() { settings.dashboard_folder.clone() } else { store::normalize_remote_folder(&meta.folder) };
        let name = format!("{}.pdf", file_stem(&meta.name));
        let len = pdf.len();
        let id = c.upload_document(&folder, &name, std::io::Cursor::new(pdf), len as u64, &mut |_| {}).map_err(err)?;
        if meta.display {
            c.open_document(&id, 1).map_err(err)?;
        }
        Ok(PublishResult { path: format!("{folder}/{name}"), entry_id: id, pages: meta.pages.len(), bytes: len })
    })
    .await?
}

/// Saves the dashboard as one PDF, or one PNG per page, in a folder on a USB reader's storage.
async fn publish_to_usb_reader(state: &crate::state::AppState, meta: &PublishMeta, pixels: &[u8], reader_id: &str, folder: &str, format: &str) -> CmdResult<PublishResult> {
    let stem = file_stem(&meta.name);
    let files: Vec<(String, Vec<u8>)> = match format {
        "pdf" => vec![(format!("{stem}.pdf"), pdf::build(&meta.name, &meta.pages, pixels)?)],
        "png" => {
            let single = meta.pages.len() == 1;
            let expected: usize = meta.pages.iter().map(|p| p.width as usize * p.height as usize).sum();
            if expected != pixels.len() {
                return Err(format!("page sizes add up to {expected} bytes but {} arrived", pixels.len()));
            }
            let mut offset = 0;
            let mut out = Vec::new();
            for (i, p) in meta.pages.iter().enumerate() {
                let len = p.width as usize * p.height as usize;
                let name = if single { format!("{stem}.png") } else { format!("{stem} - {}.png", i + 1) };
                out.push((name, pngout::encode_gray(p.width, p.height, &pixels[offset..offset + len])?));
                offset += len;
            }
            out
        }
        other => return Err(format!("unknown format: {other}")),
    };
    let bytes = files.iter().map(|(_, d)| d.len()).sum();
    let first = files.first().map(|(n, _)| n.clone()).unwrap_or_default();
    let many = files.len() > 1;
    let folder = if folder.trim().is_empty() { mtp::default_folder(format).to_string() } else { folder.trim().to_string() };
    let used = mtp::put_files(state, reader_id, &folder, files).await?;
    Ok(PublishResult { path: if many { used } else { format!("{used}/{first}") }, entry_id: String::new(), pages: meta.pages.len(), bytes })
}

#[tauri::command]
pub async fn dashboard_export_pdf(request: Request<'_>) -> CmdResult<()> {
    let (meta, pixels) = parse(&request)?;
    let dest = header(&request, "x-dest")?;
    blocking(move || {
        let pdf = pdf::build(&meta.name, &meta.pages, &pixels)?;
        fs::write(&dest, pdf).map_err(|e| format!("Could not write the file: {e}"))
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_stems_are_safe() {
        assert_eq!(file_stem("Morning / plan: v2"), "Morning plan v2");
        assert_eq!(file_stem("  ...  "), "Dashboard");
        assert_eq!(file_stem("Дашборд дня"), "Дашборд дня");
        assert_eq!(file_stem(&"x".repeat(200)).chars().count(), 80);
    }
}
