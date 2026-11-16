//! What Inkboard keeps on disk, all under the user's config directory (`~/.config/inkboard` on Linux):
//! the app settings, which reader this computer is paired with, the pairing keys and the saved dashboards.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub fn config_dir() -> PathBuf {
    dirs::config_dir().or_else(|| dirs::home_dir().map(|h| h.join(".config"))).unwrap_or_else(|| PathBuf::from(".")).join("inkboard")
}

pub fn dashboards_dir(dir: &Path) -> PathBuf {
    dir.join("dashboards")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// dashboards may run shell commands (the Command widget)
    pub allow_commands: bool,
    /// where dashboards are uploaded on the reader
    pub dashboard_folder: String,
    pub display_after_push: bool,
    /// PDFs uploaded to the Digital Paper get tap squares in the bottom corners (see tapzones.rs)
    pub tap_squares: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self { allow_commands: false, dashboard_folder: "Document/Dashboards".into(), display_after_push: true, tap_squares: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRecord {
    pub addr: String,
    pub serial: Option<String>,
    /// e.g. "DPT-RP1", for the reader list
    #[serde(default)]
    pub model: Option<String>,
}

/// Writes through a temporary file so a crash never leaves half a file behind.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(tmp, path)
}

pub fn load_settings(dir: &Path) -> AppSettings {
    fs::read(dir.join("settings.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save_settings(dir: &Path, s: &AppSettings) -> std::io::Result<()> {
    write_atomic(&dir.join("settings.json"), &serde_json::to_vec_pretty(s).expect("settings serialize"))
}

pub fn load_device(dir: &Path) -> Option<DeviceRecord> {
    fs::read(dir.join("device.json")).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

pub fn save_device(dir: &Path, d: &DeviceRecord) -> std::io::Result<()> {
    write_atomic(&dir.join("device.json"), &serde_json::to_vec_pretty(d).expect("device serialize"))
}

pub fn delete_device(dir: &Path) {
    let _ = fs::remove_file(dir.join("device.json"));
}

/// Dashboard ids become file names, so they are restricted to a safe alphabet.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A reader path must live under the "Document" root.
pub fn normalize_remote_folder(path: &str) -> String {
    let p = path.trim().trim_matches('/');
    if p.is_empty() {
        "Document".into()
    } else if p == "Document" || p.starts_with("Document/") {
        p.into()
    } else {
        format!("Document/{p}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_cannot_escape_the_folder() {
        assert!(valid_id("daily-1_x"));
        assert!(!valid_id(""));
        assert!(!valid_id("../x"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(&"a".repeat(65)));
    }

    #[test]
    fn remote_folders_are_rooted_at_document() {
        assert_eq!(normalize_remote_folder(""), "Document");
        assert_eq!(normalize_remote_folder("/Dash/"), "Document/Dash");
        assert_eq!(normalize_remote_folder("Document/A"), "Document/A");
        assert_eq!(normalize_remote_folder("Documents"), "Document/Documents");
    }

    #[test]
    fn settings_default_and_partial_files() {
        let d = tempdir();
        assert!(!load_settings(&d).allow_commands);
        assert!(load_settings(&d).tap_squares, "on unless switched off, also for settings files written before it existed");
        fs::write(d.join("settings.json"), r#"{"allowCommands": true}"#).unwrap();
        let s = load_settings(&d);
        assert!(s.allow_commands);
        assert_eq!(s.dashboard_folder, "Document/Dashboards");
    }

    fn tempdir() -> PathBuf {
        let p = std::env::temp_dir().join(format!("inkboard-test-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }
}
