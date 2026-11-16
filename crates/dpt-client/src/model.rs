//! Typed views of the reader's JSON. The device sends almost every number and flag as a string, so the
//! conversions live here. All types serialize as camelCase, ready to hand to a UI.

use serde::Serialize;
use serde_json::Value;

fn s(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::String(x)) => x.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}
fn opt(v: &Value, key: &str) -> Option<String> {
    let x = s(v, key);
    (!x.is_empty()).then_some(x)
}
fn num(v: &Value, key: &str) -> u64 {
    match v.get(key) {
        Some(Value::String(x)) => x.trim().parse().unwrap_or(0),
        Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
        _ => 0,
    }
}
fn flag(v: &Value, key: &str) -> bool {
    match v.get(key) {
        Some(Value::String(x)) => x == "true" || x == "on",
        Some(Value::Bool(b)) => *b,
        _ => false,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Document,
    Folder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DocType {
    Normal,
    Note,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub doc_type: Option<DocType>,
    pub parent_id: String,
    pub size: u64,
    pub mime: Option<String>,
    pub created: String,
    pub modified: String,
    pub last_read: Option<String>,
    pub current_page: u32,
    pub total_page: u32,
    pub is_new: bool,
}

impl Entry {
    pub fn from_value(v: &Value) -> Option<Entry> {
        let id = s(v, "entry_id");
        if id.is_empty() {
            return None;
        }
        let kind = if s(v, "entry_type") == "folder" { EntryKind::Folder } else { EntryKind::Document };
        let doc_type = (kind == EntryKind::Document).then(|| if s(v, "document_type") == "note" { DocType::Note } else { DocType::Normal });
        Some(Entry {
            id,
            name: s(v, "entry_name"),
            path: s(v, "entry_path"),
            kind,
            doc_type,
            parent_id: s(v, "parent_folder_id"),
            size: num(v, "file_size"),
            mime: opt(v, "mime_type"),
            created: s(v, "created_date"),
            modified: s(v, "modified_date"),
            last_read: opt(v, "reading_date"),
            current_page: num(v, "current_page") as u32,
            total_page: num(v, "total_page") as u32,
            is_new: flag(v, "is_new"),
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub level: u32,
    pub pen: u32,
    pub status: String,
    pub plugged: String,
    pub health: String,
    pub charging: bool,
}

impl Battery {
    pub fn from_value(v: &Value) -> Battery {
        let status = s(v, "status");
        Battery {
            level: num(v, "level") as u32,
            pen: num(v, "pen") as u32,
            charging: status == "charging",
            status,
            plugged: s(v, "plugged"),
            health: s(v, "health"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Storage {
    pub available: u64,
    pub capacity: u64,
}

impl Storage {
    pub fn from_value(v: &Value) -> Storage {
        Storage { available: num(v, "available"), capacity: num(v, "capacity") }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub model: String,
    pub serial: String,
    pub color: String,
    pub sku: String,
}

impl DeviceInfo {
    pub fn from_value(v: &Value) -> DeviceInfo {
        DeviceInfo { model: s(v, "model_name"), serial: s(v, "serial_number"), color: s(v, "device_color"), sku: s(v, "sku_code") }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfig {
    pub date_format: String,
    pub time_format: String,
    pub timeout_to_standby: String,
    pub timezone: String,
    pub owner: String,
}

impl DeviceConfig {
    pub fn from_value(v: &Value) -> DeviceConfig {
        let get = |k: &str| v.get(k).map(|x| s(x, "value")).unwrap_or_default();
        DeviceConfig {
            date_format: get("date_format"),
            time_format: get("time_format"),
            timeout_to_standby: get("timeout_to_standby"),
            timezone: get("timezone"),
            owner: get("owner"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiNetwork {
    pub ssid: String,
    pub security: String,
    pub dhcp: bool,
    pub proxy: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiScanResult {
    pub ssid: String,
    pub security: String,
    pub signal: Option<i64>,
}

fn decode_ssid(v: &Value) -> String {
    use base64::Engine;
    let raw = s(v, "ssid");
    base64::engine::general_purpose::STANDARD
        .decode(raw.as_bytes())
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or(raw)
}

impl WifiNetwork {
    pub fn from_value(v: &Value) -> WifiNetwork {
        WifiNetwork { ssid: decode_ssid(v), security: s(v, "security"), dhcp: flag(v, "dhcp"), proxy: flag(v, "proxy") }
    }
}

impl WifiScanResult {
    pub fn from_value(v: &Value) -> WifiScanResult {
        let signal = v.get("rssi").or_else(|| v.get("signal")).and_then(|x| match x {
            Value::String(t) => t.parse().ok(),
            Value::Number(n) => n.as_i64(),
            _ => None,
        });
        WifiScanResult { ssid: decode_ssid(v), security: s(v, "security"), signal }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
}

/// What an unauthenticated reader tells anyone on the network about itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub addr: String,
    pub model: String,
    pub serial: String,
    pub api_version: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn entry_parses_string_numbers_and_flags() {
        let v = json!({
            "entry_id": "doc-1", "entry_name": "Sample Book.pdf", "entry_path": "Document/Books/Sample Book.pdf",
            "entry_type": "document", "document_type": "normal", "parent_folder_id": "folder-1",
            "file_size": "1048576", "mime_type": "application/pdf", "created_date": "2024-01-02T03:04:05Z",
            "modified_date": "2024-01-03T03:04:05Z", "reading_date": "2024-02-01T00:00:00Z",
            "current_page": "12", "total_page": "300", "is_new": "true"
        });
        let e = Entry::from_value(&v).unwrap();
        assert_eq!(e.kind, EntryKind::Document);
        assert_eq!(e.doc_type, Some(DocType::Normal));
        assert_eq!((e.size, e.current_page, e.total_page), (1_048_576, 12, 300));
        assert!(e.is_new);
        assert_eq!(e.last_read.as_deref(), Some("2024-02-01T00:00:00Z"));
    }

    #[test]
    fn folder_has_no_doc_type() {
        let v = json!({"entry_id": "f", "entry_name": "Books", "entry_path": "Document/Books", "entry_type": "folder", "parent_folder_id": "root"});
        let e = Entry::from_value(&v).unwrap();
        assert_eq!(e.kind, EntryKind::Folder);
        assert_eq!(e.doc_type, None);
        assert_eq!(e.size, 0);
    }

    #[test]
    fn entries_without_an_id_are_skipped() {
        assert!(Entry::from_value(&json!({"entry_name": "x"})).is_none());
    }

    #[test]
    fn wifi_ssid_is_base64_decoded() {
        let w = WifiNetwork::from_value(&json!({"ssid": "SG9tZSBuZXQ=", "security": "psk", "dhcp": "true", "proxy": "false"}));
        assert_eq!(w.ssid, "Home net");
        assert!(w.dhcp && !w.proxy);
    }

    #[test]
    fn battery_reports_charging() {
        let b = Battery::from_value(&json!({"level": "50", "pen": "100", "status": "charging", "plugged": "usb", "health": "good"}));
        assert!(b.charging);
        assert_eq!((b.level, b.pen), (50, 100));
    }
}
