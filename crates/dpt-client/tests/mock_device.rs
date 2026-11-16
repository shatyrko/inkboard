//! The client against a small stand-in for the reader's HTTP API. It checks the parts that went wrong in other
//! implementations: the signed-nonce login, session renewal, a sized (not chunked) multipart upload, path encoding.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;

use dpt_client::{Client, Config, Credentials, EntryKind};
use rsa::pkcs8::EncodePublicKey;
use rsa::PrivateKey;
use serde_json::{json, Value};
use tiny_http::{Header, Method, Response, Server};

#[derive(Default)]
struct State {
    /// documents by id: (name, parent id, bytes)
    docs: HashMap<String, (String, String, Vec<u8>)>,
    folders: HashMap<String, (String, String)>, // id -> (path, parent)
    sessions: u32,
    reject_next: bool,
    last_upload_headers: Vec<(String, String)>,
    log: Vec<String>,
}

struct Mock {
    port: u16,
    state: Arc<Mutex<State>>,
    creds: Credentials,
}

fn json_response(v: Value, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(v.to_string())
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
}

fn start() -> Mock {
    let key = PrivateKey::new(&mut getrandom::SysRng, 2048).unwrap();
    let public = key.to_public_key();
    let creds = Credentials::new("client-1".into(), Credentials::pem_from_key(&key).unwrap());
    let _ = public.to_public_key_pem(rsa::pkcs8::LineEnding::LF).unwrap();

    let server = Server::http("127.0.0.1:0").unwrap();
    let port = server.server_addr().to_ip().unwrap().port();
    let state = Arc::new(Mutex::new(State::default()));
    {
        let mut s = state.lock().unwrap();
        s.folders.insert("root".into(), ("Document".into(), "".into()));
    }
    let st = state.clone();
    let pubkey = public.clone();
    thread::spawn(move || {
        for mut req in server.incoming_requests() {
            let url = req.url().to_string();
            let method = req.method().clone();
            let cookie = req.headers().iter().find(|h| h.field.equiv("Cookie")).map(|h| h.value.to_string());
            let mut body = Vec::new();
            let content_length = req.body_length();
            let chunked = req.headers().iter().any(|h| h.field.equiv("Transfer-Encoding"));
            req.as_reader().read_to_end(&mut body).unwrap();
            let mut s = st.lock().unwrap();
            s.log.push(format!("{method} {url}"));
            let authed = cookie.as_deref() == Some(&format!("Credentials=session{}", s.sessions)) && s.sessions > 0;

            let resp: Response<_> = if url.starts_with("/auth/nonce/") {
                json_response(json!({ "nonce": "nonce-value" }), 200)
            } else if url == "/auth" && method == Method::Put {
                let v: Value = serde_json::from_slice(&body).unwrap();
                let sig = base64_decode(v["nonce_signed"].as_str().unwrap());
                if pubkey.pkcs1v15_verify::<rsa::sha2::Sha256>(b"nonce-value", &sig).is_ok() && v["client_id"] == "client-1" {
                    s.sessions += 1;
                    let c = format!("Credentials=session{}; Path=/; Secure", s.sessions);
                    json_response(json!({}), 200).with_header(Header::from_bytes("Set-Cookie", c).unwrap())
                } else {
                    json_response(json!({ "message": "bad signature" }), 401)
                }
            } else if !authed || s.reject_next {
                s.reject_next = false;
                json_response(json!({ "error_code": "40100", "message": "Authentication is required." }), 401)
            } else if url == "/ping" {
                Response::from_string("").with_status_code(204)
            } else if url.starts_with("/documents2?entry_type=all") {
                let mut list: Vec<Value> = s.folders.iter().map(|(id, (path, parent))| json!({
                    "entry_id": id, "entry_name": path.rsplit('/').next().unwrap(), "entry_path": path, "entry_type": "folder", "parent_folder_id": parent
                })).collect();
                for (id, (name, parent, data)) in &s.docs {
                    let ppath = &s.folders[parent].0;
                    list.push(json!({
                        "entry_id": id, "entry_name": name, "entry_path": format!("{ppath}/{name}"), "entry_type": "document",
                        "document_type": "normal", "parent_folder_id": parent, "file_size": data.len().to_string(), "total_page": "3"
                    }));
                }
                json_response(json!({ "count": list.len(), "entry_list": list }), 200)
            } else if let Some(p) = url.strip_prefix("/resolve/entry/path/") {
                let path = p.replace("%2F", "/").replace('+', " ");
                let found = s.folders.iter().find(|(_, (fp, _))| *fp == path).map(|(id, (fp, parent))| json!({
                    "entry_id": id, "entry_name": fp.rsplit('/').next().unwrap(), "entry_path": fp, "entry_type": "folder", "parent_folder_id": parent
                })).or_else(|| s.docs.iter().find_map(|(id, (name, parent, _))| {
                    (format!("{}/{}", s.folders[parent].0, name) == path).then(|| json!({
                        "entry_id": id, "entry_name": name, "entry_path": path, "entry_type": "document", "parent_folder_id": parent
                    }))
                }));
                match found {
                    Some(v) => json_response(v, 200),
                    None => json_response(json!({ "message": "not found" }), 404),
                }
            } else if url == "/folders2" && method == Method::Post {
                let v: Value = serde_json::from_slice(&body).unwrap();
                let parent = v["parent_folder_id"].as_str().unwrap().to_string();
                let path = format!("{}/{}", s.folders[&parent].0, v["folder_name"].as_str().unwrap());
                let id = format!("folder-{}", s.folders.len());
                s.folders.insert(id, (path, parent));
                json_response(json!({}), 200)
            } else if url == "/documents2" && method == Method::Post {
                let v: Value = serde_json::from_slice(&body).unwrap();
                let id = format!("doc-{}", s.docs.len() + 1);
                s.docs.insert(id.clone(), (v["file_name"].as_str().unwrap().into(), v["parent_folder_id"].as_str().unwrap().into(), vec![]));
                json_response(json!({ "document_id": id }), 200)
            } else if url.starts_with("/documents/") && url.ends_with("/file") && method == Method::Put {
                s.last_upload_headers = vec![
                    ("content-length".into(), content_length.map(|n| n.to_string()).unwrap_or_default()),
                    ("chunked".into(), chunked.to_string()),
                ];
                let id = url.trim_start_matches("/documents/").trim_end_matches("/file").to_string();
                // the file bytes are between the blank line after the part headers and the closing boundary
                let text = body.clone();
                let start = text.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
                let end = text.windows(4).rposition(|w| w == b"\r\n--").unwrap();
                s.docs.get_mut(&id).unwrap().2 = text[start..end].to_vec();
                Response::from_string("").with_status_code(204)
            } else if url.starts_with("/documents/") && url.ends_with("/file") && method == Method::Get {
                let id = url.trim_start_matches("/documents/").trim_end_matches("/file");
                Response::from_data(s.docs[id].2.clone()).with_header(Header::from_bytes("Content-Type", "application/pdf").unwrap())
            } else if url.starts_with("/documents/") && method == Method::Delete {
                s.docs.remove(url.trim_start_matches("/documents/"));
                Response::from_string("").with_status_code(204)
            } else if url.starts_with("/documents/") && method == Method::Put {
                let v: Value = serde_json::from_slice(&body).unwrap();
                let id = url.trim_start_matches("/documents/");
                let d = s.docs.get_mut(id).unwrap();
                d.1 = v["parent_folder_id"].as_str().unwrap().into();
                if let Some(n) = v["file_name"].as_str() {
                    d.0 = n.into();
                }
                Response::from_string("").with_status_code(204)
            } else if url == "/system/configs/" {
                json_response(json!({ "date_format": {"value": "yyyy/M/d"}, "time_format": {"value": "24hour"}, "timeout_to_standby": {"value": "30"}, "timezone": {"value": "Europe/Berlin"}, "owner": {"value": "Test"} }), 200)
            } else if url.starts_with("/system/configs/") && method == Method::Put {
                Response::from_string("").with_status_code(204)
            } else {
                json_response(json!({ "message": format!("unhandled {method} {url}") }), 404)
            };
            drop(s);
            let _ = req.respond(resp);
        }
    });
    Mock { port, state, creds }
}

fn base64_decode(s: &str) -> Vec<u8> {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes().filter(|c| *c != b'=') {
        buf = (buf << 6) | A.iter().position(|a| *a == c).unwrap() as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    out
}

fn client_for(m: &Mock) -> Client {
    let mut cfg = Config::new("127.0.0.1");
    cfg.api_port = m.port;
    cfg.reg_port = m.port;
    cfg.https = false;
    Client::new(cfg)
}

#[test]
fn login_signs_the_nonce_and_keeps_the_session_cookie() {
    let m = start();
    let c = client_for(&m);
    assert!(!c.is_authenticated());
    c.authenticate(&m.creds).unwrap();
    assert!(c.is_authenticated());
}

#[test]
fn a_rejected_session_is_renewed_once() {
    let m = start();
    let c = client_for(&m);
    c.authenticate(&m.creds).unwrap();
    m.state.lock().unwrap().reject_next = true;
    assert_eq!(c.config().unwrap().timezone, "Europe/Berlin");
    assert_eq!(m.state.lock().unwrap().sessions, 2, "the client logged in again after the 401");
}

#[test]
fn wrong_key_is_refused() {
    let m = start();
    let c = client_for(&m);
    let other = PrivateKey::new(&mut getrandom::SysRng, 2048).unwrap();
    let bad = Credentials::new("client-1".into(), Credentials::pem_from_key(&other).unwrap());
    assert!(c.authenticate(&bad).is_err());
}

#[test]
fn upload_creates_folders_sends_a_sized_body_and_round_trips() {
    let m = start();
    let c = client_for(&m);
    c.authenticate(&m.creds).unwrap();

    let pdf: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
    let mut progress = Vec::new();
    let id = c.upload_document("Document/Dashboards/Deep", "Page one.pdf", std::io::Cursor::new(pdf.clone()), pdf.len() as u64, &mut |n| progress.push(n)).unwrap();
    assert!(progress.last().copied().unwrap() >= pdf.len() as u64);

    {
        let s = m.state.lock().unwrap();
        let headers: HashMap<_, _> = s.last_upload_headers.iter().cloned().collect();
        assert_eq!(headers["chunked"], "false", "the reader needs a Content-Length, not chunked encoding");
        assert!(headers["content-length"].parse::<usize>().unwrap() > pdf.len());
        assert_eq!(s.docs[&id].2, pdf);
    }

    let mut out = Vec::new();
    c.download_document(&id, &mut out, &mut |_, _| {}).unwrap();
    assert_eq!(out, pdf);

    // uploading the same name again overwrites instead of creating a second document
    let again: Vec<u8> = vec![7; 1000];
    let id2 = c.upload_document("Document/Dashboards/Deep", "Page one.pdf", std::io::Cursor::new(again.clone()), 1000, &mut |_| {}).unwrap();
    assert_eq!(id, id2);
    assert_eq!(m.state.lock().unwrap().docs.len(), 1);
}

#[test]
fn listing_move_and_delete() {
    let m = start();
    let c = client_for(&m);
    c.authenticate(&m.creds).unwrap();
    let id = c.upload_document("Document/A", "x.pdf", std::io::Cursor::new(vec![1, 2, 3]), 3, &mut |_| {}).unwrap();
    let b = c.ensure_folder("Document/B").unwrap();

    c.move_document(&id, &b, Some("y.pdf")).unwrap();
    let entries = c.list_entries().unwrap();
    let doc = entries.iter().find(|e| e.kind == EntryKind::Document).unwrap();
    assert_eq!((doc.name.as_str(), doc.path.as_str(), doc.size), ("y.pdf", "Document/B/y.pdf", 3));

    c.delete_document(&id).unwrap();
    assert!(c.list_entries().unwrap().iter().all(|e| e.kind == EntryKind::Folder));
    assert!(c.resolve_path("Document/B/y.pdf").unwrap().is_none());
}
