//! A blocking client for the reader's REST API.
//!
//! Two listeners are involved: plain HTTP on port 8080 (device facts and the pairing handshake, no login) and
//! HTTPS on port 8443 (everything else, behind a signed-nonce login). The HTTPS certificate is issued by the
//! reader's own CA, so verification against public roots is off; the traffic never leaves the local network.

use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};
use ureq::http::{self, Response};
use ureq::tls::TlsConfig;
use ureq::{Agent, Body, SendBody};

use crate::creds::Credentials;
use crate::error::{Error, Result};
use crate::model::*;

#[derive(Debug, Clone)]
pub struct Config {
    pub addr: String,
    pub api_port: u16,
    pub reg_port: u16,
    /// false only in tests that talk to a local stand-in server
    pub https: bool,
}

impl Config {
    pub fn new(addr: impl Into<String>) -> Self {
        Self { addr: addr.into(), api_port: 8443, reg_port: 8080, https: true }
    }

    fn host(&self) -> String {
        if self.addr.contains(':') && !self.addr.starts_with('[') {
            format!("[{}]", self.addr)
        } else {
            self.addr.clone()
        }
    }
    fn api_url(&self, path: &str) -> String {
        format!("{}://{}:{}{}", if self.https { "https" } else { "http" }, self.host(), self.api_port, path)
    }
    pub(crate) fn reg_url(&self, path: &str) -> String {
        format!("http://{}:{}{}", self.host(), self.reg_port, path)
    }
}

pub(crate) fn make_agent() -> Agent {
    let config = Agent::config_builder()
        .tls_config(TlsConfig::builder().disable_verification(true).build())
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(8)))
        .timeout_recv_response(Some(Duration::from_secs(60)))
        .build();
    Agent::new_with_config(config)
}

/// `quote_plus`: how the reader expects names and paths inside URLs and multipart file names.
pub fn quote_plus(s: &str) -> String {
    form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

pub(crate) fn error_from_response(status: u16, body: &str) -> Error {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str().map(str::to_string)))
        .unwrap_or_else(|| body.trim().chars().take(200).collect());
    match status {
        401 => Error::Unauthorized,
        404 => Error::NotFound(message),
        _ => Error::Api { status, message },
    }
}

/// Sends `reader` through while reporting how many bytes went by.
struct Counting<'a, R: Read> {
    inner: R,
    sent: u64,
    on_progress: &'a mut dyn FnMut(u64),
}
impl<R: Read> Read for Counting<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.sent += n as u64;
        (self.on_progress)(self.sent);
        Ok(n)
    }
}

pub struct Client {
    cfg: Config,
    agent: Agent,
    cookie: Mutex<Option<String>>,
    creds: Mutex<Option<Credentials>>,
}

impl Client {
    pub fn new(cfg: Config) -> Self {
        Self { cfg, agent: make_agent(), cookie: Mutex::new(None), creds: Mutex::new(None) }
    }

    pub fn addr(&self) -> &str {
        &self.cfg.addr
    }

    // ---------------------------------------------------------------- transport

    fn send(&self, method: &str, url: &str, content_type: Option<&str>, len: Option<u64>, body: SendBody<'_>) -> Result<Response<Body>> {
        let mut b = http::Request::builder().method(method).uri(url);
        if let Some(c) = self.cookie.lock().unwrap().as_deref() {
            b = b.header("Cookie", c);
        }
        if let Some(c) = content_type {
            b = b.header("Content-Type", c);
        }
        if let Some(l) = len {
            b = b.header("Content-Length", l.to_string());
        }
        let req = b.body(body).map_err(|e| Error::Protocol(e.to_string()))?;
        Ok(self.agent.run(req)?)
    }

    fn json_request(&self, method: &str, url: &str, payload: Option<&Value>) -> Result<Value> {
        let bytes = payload.map(serde_json::to_vec).transpose()?;
        let mut resp = match &bytes {
            Some(b) => self.send(method, url, Some("application/json"), Some(b.len() as u64), SendBody::from_owned_reader(std::io::Cursor::new(b.clone())))?,
            None => self.send(method, url, None, None, SendBody::none())?,
        };
        let status = resp.status().as_u16();
        let text = resp.body_mut().with_config().limit(64 * 1024 * 1024).lossy_utf8(true).read_to_string()?;
        if status >= 400 {
            return Err(error_from_response(status, &text));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_str(&text)?)
    }

    /// Authenticated call on the HTTPS API. A rejected session is renewed once and the call repeated.
    fn api(&self, method: &str, path: &str, payload: Option<&Value>) -> Result<Value> {
        let url = self.cfg.api_url(path);
        match self.json_request(method, &url, payload) {
            Err(Error::Unauthorized) => {
                let creds = self.creds.lock().unwrap().clone();
                match creds {
                    Some(c) => {
                        self.authenticate(&c)?;
                        self.json_request(method, &url, payload)
                    }
                    None => Err(Error::Unauthorized),
                }
            }
            other => other,
        }
    }

    fn get(&self, path: &str) -> Result<Value> {
        self.api("GET", path, None)
    }
    fn put(&self, path: &str, payload: Value) -> Result<Value> {
        self.api("PUT", path, Some(&payload))
    }
    fn post(&self, path: &str, payload: Value) -> Result<Value> {
        self.api("POST", path, Some(&payload))
    }
    fn delete(&self, path: &str) -> Result<Value> {
        // the reader's own app sends an empty JSON object with deletes
        self.api("DELETE", path, Some(&json!({})))
    }

    // ---------------------------------------------------------------- session

    /// Signs the reader's nonce with the private key and stores the session cookie it hands back.
    pub fn authenticate(&self, creds: &Credentials) -> Result<()> {
        *self.cookie.lock().unwrap() = None;
        let nonce = self.json_request("GET", &self.cfg.api_url(&format!("/auth/nonce/{}", creds.client_id)), None)?;
        let nonce = nonce.get("nonce").and_then(Value::as_str).ok_or_else(|| Error::Protocol("no nonce in the reply".into()))?;
        let signed = creds.sign_nonce(nonce)?;
        let url = self.cfg.api_url("/auth");
        let body = serde_json::to_vec(&json!({ "client_id": creds.client_id, "nonce_signed": signed }))?;
        let mut resp = self.send("PUT", &url, Some("application/json"), Some(body.len() as u64), SendBody::from_owned_reader(std::io::Cursor::new(body)))?;
        let status = resp.status().as_u16();
        if status >= 400 {
            let text = resp.body_mut().read_to_string().unwrap_or_default();
            return Err(match status {
                // a reader that has forgotten this client answers like a failed login
                400 | 401 | 403 => Error::Pairing("the reader does not recognise this computer; pair it again".into()),
                _ => error_from_response(status, &text),
            });
        }
        let cookie = resp
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .find_map(|v| {
                let first = v.split(';').next()?.trim();
                first.to_ascii_lowercase().starts_with("credentials=").then(|| first.to_string())
            })
            .ok_or_else(|| Error::Protocol("the reader sent no session cookie".into()))?;
        *self.cookie.lock().unwrap() = Some(cookie);
        *self.creds.lock().unwrap() = Some(creds.clone());
        Ok(())
    }

    pub fn is_authenticated(&self) -> bool {
        self.cookie.lock().unwrap().is_some() && self.get("/ping").is_ok()
    }

    // ---------------------------------------------------------------- facts without login (HTTP 8080)

    pub fn probe(&self) -> Result<Probe> {
        let info = self.json_request("GET", &self.cfg.reg_url("/register/information"), None)?;
        let di = DeviceInfo::from_value(&info);
        let api_version = self
            .json_request("GET", &self.cfg.reg_url("/api_version"), None)
            .ok()
            .and_then(|v| v.get("value").and_then(Value::as_str).map(str::to_string));
        Ok(Probe { addr: self.cfg.addr.clone(), model: di.model, serial: di.serial, api_version })
    }

    // ---------------------------------------------------------------- status

    pub fn info(&self) -> Result<DeviceInfo> {
        Ok(DeviceInfo::from_value(&self.get("/register/information")?))
    }
    pub fn battery(&self) -> Result<Battery> {
        Ok(Battery::from_value(&self.get("/system/status/battery")?))
    }
    pub fn storage(&self) -> Result<Storage> {
        Ok(Storage::from_value(&self.get("/system/status/storage")?))
    }
    pub fn firmware_version(&self) -> Result<String> {
        Ok(self.get("/system/status/firmware_version")?.get("value").and_then(Value::as_str).unwrap_or_default().to_string())
    }
    pub fn api_version(&self) -> Result<String> {
        let v = self.json_request("GET", &self.cfg.reg_url("/api_version"), None)?;
        Ok(v.get("value").and_then(Value::as_str).unwrap_or_default().to_string())
    }

    /// PNG of what the reader is showing right now.
    pub fn screenshot_png(&self) -> Result<Vec<u8>> {
        let url = self.cfg.api_url("/system/controls/screen_shot");
        let mut resp = self.send("GET", &url, None, None, SendBody::none())?;
        let status = resp.status().as_u16();
        if status >= 400 {
            return Err(error_from_response(status, &resp.body_mut().read_to_string().unwrap_or_default()));
        }
        Ok(resp.body_mut().with_config().limit(32 * 1024 * 1024).read_to_vec()?)
    }

    // ---------------------------------------------------------------- configuration

    pub fn config(&self) -> Result<DeviceConfig> {
        Ok(DeviceConfig::from_value(&self.get("/system/configs/")?))
    }

    /// `key` is one of date_format, time_format, timeout_to_standby, timezone, owner.
    pub fn set_config(&self, key: &str, value: &str) -> Result<()> {
        const KEYS: [&str; 5] = ["date_format", "time_format", "timeout_to_standby", "timezone", "owner"];
        if !KEYS.contains(&key) {
            return Err(Error::Protocol(format!("unknown setting: {key}")));
        }
        self.put(&format!("/system/configs/{key}"), json!({ "value": value }))?;
        Ok(())
    }

    /// Sets the reader's clock; `utc_iso` looks like "2026-01-31T12:00:00Z".
    pub fn set_datetime(&self, utc_iso: &str) -> Result<()> {
        self.put("/system/configs/datetime", json!({ "value": utc_iso }))?;
        Ok(())
    }

    // ---------------------------------------------------------------- Wi-Fi

    pub fn wifi_list(&self) -> Result<Vec<WifiNetwork>> {
        let v = self.get("/system/configs/wifi_accesspoints")?;
        Ok(v.get("aplist").and_then(Value::as_array).map(|a| a.iter().map(WifiNetwork::from_value).collect()).unwrap_or_default())
    }
    pub fn wifi_scan(&self) -> Result<Vec<WifiScanResult>> {
        let v = self.post("/system/controls/wifi_accesspoints/scan", json!({}))?;
        Ok(v.get("aplist").and_then(Value::as_array).map(|a| a.iter().map(WifiScanResult::from_value).collect()).unwrap_or_default())
    }
    /// Saves a network (DHCP, no proxy). `security` is "psk" or "nonsec".
    pub fn wifi_connect(&self, ssid: &str, security: &str, password: &str, dhcp: bool) -> Result<()> {
        let b64 = base64::engine::general_purpose::STANDARD.encode(ssid.as_bytes());
        self.put(
            "/system/controls/wifi_accesspoints/register",
            json!({
                "ssid": b64, "security": security, "passwd": password, "dhcp": dhcp.to_string(),
                "static_address": "", "gateway": "", "network_mask": "", "dns1": "", "dns2": "", "proxy": "false"
            }),
        )?;
        Ok(())
    }
    pub fn wifi_forget(&self, ssid: &str, security: &str) -> Result<()> {
        use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
        self.delete(&format!("/system/configs/wifi_accesspoints/{}/{}", utf8_percent_encode(ssid, NON_ALPHANUMERIC), utf8_percent_encode(security, NON_ALPHANUMERIC)))?;
        Ok(())
    }
    pub fn wifi_enabled(&self) -> Result<bool> {
        Ok(self.get("/system/configs/wifi")?.get("value").and_then(Value::as_str) == Some("on"))
    }
    pub fn set_wifi_enabled(&self, on: bool) -> Result<()> {
        self.put("/system/configs/wifi", json!({ "value": if on { "on" } else { "off" } }))?;
        Ok(())
    }

    // ---------------------------------------------------------------- library

    /// Every folder and document on the reader.
    pub fn list_entries(&self) -> Result<Vec<Entry>> {
        let v = self.get("/documents2?entry_type=all")?;
        let list = v.get("entry_list").and_then(Value::as_array).cloned().unwrap_or_default();
        let count = v.get("count").and_then(Value::as_u64).unwrap_or(list.len() as u64);
        // The reader caps the flat listing (around 1300 entries); a short list means it was cut, so walk the tree instead.
        if count as usize != list.len() {
            return self.list_entries_recursive();
        }
        Ok(list.iter().filter_map(Entry::from_value).collect())
    }

    fn list_entries_recursive(&self) -> Result<Vec<Entry>> {
        let root = self.resolve_path("Document")?.ok_or_else(|| Error::NotFound("Document".into()))?;
        let mut out = vec![root.clone()];
        let mut stack = vec![root.id];
        while let Some(id) = stack.pop() {
            let v = self.get(&format!("/folders/{id}/entries2"))?;
            for e in v.get("entry_list").and_then(Value::as_array).into_iter().flatten().filter_map(Entry::from_value) {
                if e.kind == EntryKind::Folder {
                    stack.push(e.id.clone());
                }
                out.push(e);
            }
        }
        Ok(out)
    }

    /// Looks an entry up by its full path ("Document/Books/x.pdf"). `Ok(None)` when it does not exist.
    pub fn resolve_path(&self, path: &str) -> Result<Option<Entry>> {
        match self.get(&format!("/resolve/entry/path/{}", quote_plus(path))) {
            Ok(v) => Ok(Entry::from_value(&v)),
            Err(Error::NotFound(_)) => Ok(None),
            // the reader answers 4xx with a JSON message for unknown paths
            Err(Error::Api { status, .. }) if (400..500).contains(&status) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Makes sure a folder path exists (creating missing levels) and returns its id.
    pub fn ensure_folder(&self, path: &str) -> Result<String> {
        let path = path.trim_matches('/');
        if let Some(e) = self.resolve_path(path)? {
            return Ok(e.id);
        }
        let (parent, name) = match path.rsplit_once('/') {
            Some((p, n)) => (p, n),
            None => return Err(Error::NotFound(path.to_string())),
        };
        let parent_id = self.ensure_folder(parent)?;
        self.new_folder(&parent_id, name)?;
        // the reply to the creation call carries no id we can rely on, so look the folder up
        self.resolve_path(path)?.map(|e| e.id).ok_or_else(|| Error::Protocol(format!("folder {path} was not created")))
    }

    pub fn new_folder(&self, parent_id: &str, name: &str) -> Result<()> {
        self.post("/folders2", json!({ "folder_name": name, "parent_folder_id": parent_id }))?;
        Ok(())
    }

    pub fn delete_document(&self, id: &str) -> Result<()> {
        self.delete(&format!("/documents/{id}"))?;
        Ok(())
    }
    pub fn delete_folder(&self, id: &str) -> Result<()> {
        self.delete(&format!("/folders/{id}"))?;
        Ok(())
    }

    fn move_or_copy_body(folder_id: &str, new_name: Option<&str>) -> Value {
        let mut b = json!({ "parent_folder_id": folder_id });
        if let Some(n) = new_name {
            b["file_name"] = json!(n);
        }
        b
    }
    /// Moves a document into a folder, optionally renaming it.
    pub fn move_document(&self, id: &str, folder_id: &str, new_name: Option<&str>) -> Result<()> {
        self.put(&format!("/documents/{id}"), Self::move_or_copy_body(folder_id, new_name))?;
        Ok(())
    }
    pub fn copy_document(&self, id: &str, folder_id: &str, new_name: Option<&str>) -> Result<()> {
        self.post(&format!("/documents/{id}/copy"), Self::move_or_copy_body(folder_id, new_name))?;
        Ok(())
    }

    /// Shows a document on the reader's screen.
    pub fn open_document(&self, id: &str, page: u32) -> Result<()> {
        self.put("/viewer/controls/open2", json!({ "document_id": id, "page": page.max(1) }))?;
        Ok(())
    }

    /// Uploads a PDF into `folder_path` (created when missing). A document with the same name is overwritten in place.
    /// Returns the document id.
    pub fn upload_document(&self, folder_path: &str, name: &str, reader: impl Read, len: u64, on_progress: &mut dyn FnMut(u64)) -> Result<String> {
        let folder_path = folder_path.trim_matches('/');
        let full = format!("{folder_path}/{name}");
        let doc_id = match self.resolve_path(&full)? {
            Some(e) => e.id,
            None => {
                let folder_id = self.ensure_folder(folder_path)?;
                let v = self.post("/documents2", json!({ "file_name": name, "parent_folder_id": folder_id, "document_source": "" }))?;
                v.get("document_id").and_then(Value::as_str).map(str::to_string).ok_or_else(|| Error::Protocol("no document id in the reply".into()))?
            }
        };
        self.put_file(&format!("/documents/{doc_id}/file"), name, reader, len, on_progress)?;
        Ok(doc_id)
    }

    fn put_file(&self, path: &str, name: &str, reader: impl Read, len: u64, on_progress: &mut dyn FnMut(u64)) -> Result<()> {
        let boundary = format!("----inkboard{}", hex(&crate::crypto::random_bytes::<8>()));
        let head = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\nContent-Type: application/pdf\r\n\r\n", quote_plus(name));
        let tail = format!("\r\n--{boundary}--\r\n");
        let total = head.len() as u64 + len + tail.len() as u64;
        let mut body = Counting { inner: std::io::Cursor::new(head.into_bytes()).chain(reader).chain(std::io::Cursor::new(tail.into_bytes())), sent: 0, on_progress };
        let url = self.cfg.api_url(path);
        let mut resp = self.send("PUT", &url, Some(&format!("multipart/form-data; boundary={boundary}")), Some(total), SendBody::from_reader(&mut body))?;
        let status = resp.status().as_u16();
        if status >= 400 {
            return Err(error_from_response(status, &resp.body_mut().read_to_string().unwrap_or_default()));
        }
        Ok(())
    }

    /// Streams a document into `out`. `on_progress` gets (bytes so far, total when the reader says).
    pub fn download_document(&self, id: &str, out: &mut dyn Write, on_progress: &mut dyn FnMut(u64, Option<u64>)) -> Result<u64> {
        let url = self.cfg.api_url(&format!("/documents/{id}/file"));
        let mut resp = self.send("GET", &url, None, None, SendBody::none())?;
        let status = resp.status().as_u16();
        if status >= 400 {
            return Err(error_from_response(status, &resp.body_mut().read_to_string().unwrap_or_default()));
        }
        let total = resp.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
        let mut reader = resp.into_body().into_reader();
        let mut buf = vec![0u8; 64 * 1024];
        let mut done = 0u64;
        loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])?;
            done += n as u64;
            on_progress(done, total);
        }
        Ok(done)
    }

    // ---------------------------------------------------------------- note templates

    pub fn list_templates(&self) -> Result<Vec<Template>> {
        let v = self.get("/viewer/configs/note_templates")?;
        Ok(v.get("template_list")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|t| Template { id: t["note_template_id"].as_str().unwrap_or_default().to_string(), name: t["template_name"].as_str().unwrap_or_default().to_string() }).collect())
            .unwrap_or_default())
    }
    pub fn upload_template(&self, name: &str, reader: impl Read, len: u64, on_progress: &mut dyn FnMut(u64)) -> Result<()> {
        let v = self.post("/viewer/configs/note_templates", json!({ "templateName": name, "document_source": "" }))?;
        let id = v.get("note_template_id").and_then(Value::as_str).ok_or_else(|| Error::Protocol("no template id in the reply".into()))?;
        self.put_file(&format!("/viewer/configs/note_templates/{id}/file"), name, reader, len, on_progress)
    }
    pub fn delete_template(&self, id: &str) -> Result<()> {
        self.delete(&format!("/viewer/configs/note_templates/{id}"))?;
        Ok(())
    }
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
