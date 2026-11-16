//! Calls the commands the way the window does (through Tauri's IPC layer, with camelCase arguments), so a renamed
//! argument or a changed result shape fails here instead of in the UI. Nothing here needs a reader.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

use crate::state::AppState;
use crate::{dashboards, mtp, settings};

fn temp_dir(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("inkboard-ipc-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn app(dir: PathBuf) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
    let app = mock_builder()
        .manage(Arc::new(AppState::new(dir)))
        .invoke_handler(tauri::generate_handler![
            settings::settings_get,
            settings::settings_set,
            dashboards::dashboards_list,
            dashboards::dashboards_load,
            dashboards::dashboards_save,
            dashboards::dashboards_delete,
            dashboards::dashboard_export_pdf,
            dashboards::run_command,
            dashboards::read_image,
            dashboards::dashboard_publish,
            mtp::readers_list,
            mtp::mtp_status,
            mtp::mtp_list,
            mtp::mtp_upload,
            mtp::mtp_download,
            mtp::mtp_delete,
            mtp::mtp_new_folder,
            mtp::mtp_rename,
            mtp::mtp_move,
        ])
        .build(tauri::generate_context!())
        .unwrap();
    WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap()
}

fn request(cmd: &str, body: InvokeBody) -> InvokeRequest {
    InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "tauri://localhost".parse().unwrap(),
        body,
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

fn call(w: &tauri::WebviewWindow<tauri::test::MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
    get_ipc_response(w, request(cmd, InvokeBody::Json(args))).map(|b| b.deserialize::<Value>().unwrap())
}

#[test]
fn settings_round_trip_with_camel_case_fields() {
    let w = app(temp_dir("settings"));
    assert_eq!(call(&w, "settings_get", json!({})).unwrap()["dashboardFolder"], "Document/Dashboards");
    let out = call(&w, "settings_set", json!({ "patch": { "allowCommands": true, "dashboardFolder": "Screens" } })).unwrap();
    assert_eq!(out["allowCommands"], true);
    assert_eq!(out["dashboardFolder"], "Document/Screens");
    assert_eq!(call(&w, "settings_get", json!({})).unwrap()["allowCommands"], true);
}

#[test]
fn dashboards_save_list_load_delete() {
    let w = app(temp_dir("dash"));
    assert_eq!(call(&w, "dashboards_list", json!({})).unwrap(), json!([]));
    call(&w, "dashboards_save", json!({ "doc": { "id": "daily-1", "name": "Daily", "pages": [{ "id": "p1" }] } })).unwrap();
    let list = call(&w, "dashboards_list", json!({})).unwrap();
    assert_eq!(list[0]["id"], "daily-1");
    assert_eq!(list[0]["name"], "Daily");
    assert!(list[0]["updated"].as_str().unwrap().ends_with('Z'));
    assert_eq!(call(&w, "dashboards_load", json!({ "id": "daily-1" })).unwrap()["pages"][0]["id"], "p1");
    call(&w, "dashboards_delete", json!({ "id": "daily-1" })).unwrap();
    assert_eq!(call(&w, "dashboards_list", json!({})).unwrap(), json!([]));
}

#[test]
fn dashboard_ids_cannot_leave_the_folder() {
    let w = app(temp_dir("traversal"));
    assert!(call(&w, "dashboards_save", json!({ "doc": { "id": "../evil", "name": "x" } })).is_err());
    assert!(call(&w, "dashboards_load", json!({ "id": "../../etc/passwd" })).is_err());
    assert!(call(&w, "dashboards_delete", json!({ "id": "a/b" })).is_err());
}

#[test]
fn commands_are_refused_until_enabled() {
    let w = app(temp_dir("cmd"));
    let err = call(&w, "run_command", json!({ "command": "echo hi" })).unwrap_err();
    assert!(err.as_str().unwrap().contains("disabled"), "{err}");
    call(&w, "settings_set", json!({ "patch": { "allowCommands": true } })).unwrap();
    if cfg!(unix) {
        assert_eq!(call(&w, "run_command", json!({ "command": "printf ok" })).unwrap(), "ok");
    }
}

#[test]
fn export_pdf_takes_raw_pixels_and_headers() {
    let dir = temp_dir("export");
    let w = app(dir.clone());
    let dest = dir.join("out.pdf");
    let meta = json!({ "name": "Test", "folder": "", "display": false, "pages": [{ "width": 20, "height": 10, "links": [] }, { "width": 20, "height": 10, "links": [{ "x": 0, "y": 0, "w": 10, "h": 5, "page": 1 }] }] });
    let mut req = request("dashboard_export_pdf", InvokeBody::Raw(vec![200u8; 2 * 20 * 10]));
    req.headers.insert("x-meta", urlencode(&meta.to_string()).parse().unwrap());
    req.headers.insert("x-dest", urlencode(dest.to_str().unwrap()).parse().unwrap());
    get_ipc_response(&w, req).unwrap();
    let pdf = std::fs::read(&dest).unwrap();
    assert!(pdf.starts_with(b"%PDF-1.4"));
    assert!(String::from_utf8_lossy(&pdf).contains("/Count 2"));

    // a pixel buffer of the wrong size is refused with a readable message
    let mut bad = request("dashboard_export_pdf", InvokeBody::Raw(vec![0u8; 5]));
    bad.headers.insert("x-meta", urlencode(&meta.to_string()).parse().unwrap());
    bad.headers.insert("x-dest", urlencode(dest.to_str().unwrap()).parse().unwrap());
    assert!(get_ipc_response(&w, bad).is_err());
}

#[test]
fn read_image_returns_a_data_url_and_rejects_other_files() {
    let dir = temp_dir("img");
    let w = app(dir.clone());
    let png = dir.join("p.png");
    std::fs::write(&png, [0x89, b'P', b'N', b'G']).unwrap();
    let url = call(&w, "read_image", json!({ "path": png.to_str().unwrap() })).unwrap();
    assert!(url.as_str().unwrap().starts_with("data:image/png;base64,"));
    let txt = dir.join("x.txt");
    std::fs::write(&txt, "no").unwrap();
    assert!(call(&w, "read_image", json!({ "path": txt.to_str().unwrap() })).is_err());
}

fn urlencode(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

// ------------------------------------------------------------------ USB readers, against mtp-rs's virtual device

use mtp_rs::virtual_device::{register_virtual_device, VirtualDeviceConfig, VirtualStorageConfig};

/// A fake USB reader that `list_devices` and `open_by_serial` find like a real one. Returns its reader id.
fn virtual_reader(tag: &str) -> String {
    let dir = temp_dir(&format!("virt-{tag}")).join("store");
    std::fs::create_dir_all(&dir).unwrap();
    let cfg = VirtualDeviceConfig {
        manufacturer: "ONYX".into(),
        model: "VirtualSlate".into(),
        serial: format!("virtual-{tag}-{}", std::process::id()),
        storages: vec![VirtualStorageConfig { description: "Internal shared storage".into(), capacity: 64 * 1024 * 1024, backing_dir: dir, read_only: false }],
        supports_rename: true,
        ..Default::default()
    };
    mtp::reader_id(&register_virtual_device(&cfg))
}

fn names(list: &Value) -> Vec<String> {
    list.as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap().to_string()).collect()
}

#[test]
fn usb_readers_are_listed_with_a_readable_name() {
    let id = virtual_reader("list");
    let w = app(temp_dir("usb-list"));
    let readers = call(&w, "readers_list", json!({})).unwrap();
    let r = readers.as_array().unwrap().iter().find(|r| r["id"] == id.as_str()).expect("the virtual reader is listed");
    assert_eq!(r["kind"], "mtp");
    assert_eq!(r["name"], "Virtual Slate");
    assert_eq!(r["maker"], "ONYX");
    assert_eq!(r["link"], "usb");
    assert_eq!(r["connected"], true);
}

#[test]
fn usb_reader_status_reports_storage() {
    let id = virtual_reader("status");
    let w = app(temp_dir("usb-status"));
    let s = call(&w, "mtp_status", json!({ "id": id })).unwrap();
    assert_eq!(s["model"], "VirtualSlate");
    assert_eq!(s["storages"][0]["name"], "Internal shared storage");
    assert_eq!(s["storages"][0]["total"], 64 * 1024 * 1024);
}

#[test]
fn usb_reader_file_manager_round_trip() {
    let id = virtual_reader("files");
    let dir = temp_dir("usb-files");
    let w = app(dir.clone());
    let storage = call(&w, "mtp_status", json!({ "id": id })).unwrap()["storages"][0]["id"].as_u64().unwrap();

    let books = call(&w, "mtp_new_folder", json!({ "id": id, "storage": storage, "parent": null, "name": "Books" })).unwrap().as_u64().unwrap();
    let other = call(&w, "mtp_new_folder", json!({ "id": id, "storage": storage, "parent": null, "name": "Other" })).unwrap().as_u64().unwrap();

    let local = dir.join("Sample Book.pdf");
    std::fs::write(&local, vec![7u8; 300_000]).unwrap();
    let res = call(&w, "mtp_upload", json!({ "id": id, "storage": storage, "parent": books, "paths": [local.to_str().unwrap(), "/definitely/missing.pdf"] })).unwrap();
    assert_eq!(res[0]["ok"], true);
    assert_eq!(res[1]["ok"], false);

    let listing = call(&w, "mtp_list", json!({ "id": id, "storage": storage, "parent": books })).unwrap();
    assert_eq!(names(&listing), ["Sample Book.pdf"]);
    assert_eq!(listing[0]["kind"], "file");
    assert_eq!(listing[0]["size"], 300_000);
    let file = listing[0]["handle"].as_u64().unwrap();

    // uploading the same name again replaces the file instead of making a second one
    std::fs::write(&local, vec![9u8; 1000]).unwrap();
    call(&w, "mtp_upload", json!({ "id": id, "storage": storage, "parent": books, "paths": [local.to_str().unwrap()] })).unwrap();
    let listing = call(&w, "mtp_list", json!({ "id": id, "storage": storage, "parent": books })).unwrap();
    assert_eq!(listing.as_array().unwrap().len(), 1);
    assert_eq!(listing[0]["size"], 1000);
    let file = listing[0]["handle"].as_u64().unwrap_or(file);

    call(&w, "mtp_rename", json!({ "id": id, "storage": storage, "handle": file, "name": "Renamed.pdf" })).unwrap();
    call(&w, "mtp_move", json!({ "id": id, "storage": storage, "handle": file, "parent": other })).unwrap();
    assert!(call(&w, "mtp_list", json!({ "id": id, "storage": storage, "parent": books })).unwrap().as_array().unwrap().is_empty());
    let moved = call(&w, "mtp_list", json!({ "id": id, "storage": storage, "parent": other })).unwrap();
    assert_eq!(names(&moved), ["Renamed.pdf"]);

    let copy = dir.join("copy.pdf");
    call(&w, "mtp_download", json!({ "id": id, "storage": storage, "handle": moved[0]["handle"], "dest": copy.to_str().unwrap() })).unwrap();
    assert_eq!(std::fs::read(&copy).unwrap(), vec![9u8; 1000]);

    // deleting a folder takes everything inside it along
    call(&w, "mtp_delete", json!({ "id": id, "storage": storage, "handle": other })).unwrap();
    let root = call(&w, "mtp_list", json!({ "id": id, "storage": storage, "parent": null })).unwrap();
    assert_eq!(names(&root), ["Books"]);

    assert!(call(&w, "mtp_new_folder", json!({ "id": id, "storage": storage, "parent": null, "name": "a/b" })).is_err());
}

#[test]
fn unknown_usb_readers_give_a_clear_error() {
    let w = app(temp_dir("usb-missing"));
    let err = call(&w, "mtp_status", json!({ "id": "mtp:deadbeef" })).unwrap_err();
    assert!(err.as_str().unwrap().contains("not plugged in"), "{err}");
}

fn publish(w: &tauri::WebviewWindow<tauri::test::MockRuntime>, meta: Value, pixels: Vec<u8>) -> Result<Value, Value> {
    let mut req = request("dashboard_publish", InvokeBody::Raw(pixels));
    req.headers.insert("x-meta", urlencode(&meta.to_string()).parse().unwrap());
    get_ipc_response(w, req).map(|b| b.deserialize::<Value>().unwrap())
}

#[test]
fn dashboards_are_saved_to_a_usb_reader_as_pdf_or_png() {
    let id = virtual_reader("publish");
    let w = app(temp_dir("usb-publish"));
    let storage = call(&w, "mtp_status", json!({ "id": id })).unwrap()["storages"][0]["id"].as_u64().unwrap();
    let page = json!({ "width": 40, "height": 30, "links": [] });

    // PDF into the default folder, twice: the second push replaces the first
    for _ in 0..2 {
        let out = publish(&w, json!({ "name": "Day plan", "folder": "", "display": false, "pages": [page], "target": { "kind": "mtp", "readerId": id, "folder": "", "format": "pdf" } }), vec![128; 40 * 30]).unwrap();
        assert_eq!(out["path"], "Documents/Inkboard/Day plan.pdf");
        assert_eq!(out["pages"], 1);
    }
    let root = call(&w, "mtp_list", json!({ "id": id, "storage": storage, "parent": null })).unwrap();
    let docs = root.as_array().unwrap().iter().find(|e| e["name"] == "Documents").unwrap()["handle"].clone();
    let inkboard = call(&w, "mtp_list", json!({ "id": id, "storage": storage, "parent": docs })).unwrap()[0]["handle"].clone();
    let files = call(&w, "mtp_list", json!({ "id": id, "storage": storage, "parent": inkboard })).unwrap();
    assert_eq!(names(&files), ["Day plan.pdf"]);

    // PNG pages into a chosen folder: one file per page
    let out = publish(&w, json!({ "name": "Wall", "folder": "", "display": false, "pages": [page, page], "target": { "kind": "mtp", "readerId": id, "folder": "Pictures/Screens", "format": "png" } }), vec![200; 2 * 40 * 30]).unwrap();
    assert_eq!(out["path"], "Pictures/Screens");
    let pictures = call(&w, "mtp_list", json!({ "id": id, "storage": storage, "parent": null })).unwrap().as_array().unwrap().iter().find(|e| e["name"] == "Pictures").unwrap()["handle"].clone();
    let screens = call(&w, "mtp_list", json!({ "id": id, "storage": storage, "parent": pictures })).unwrap()[0]["handle"].clone();
    let mut pngs = names(&call(&w, "mtp_list", json!({ "id": id, "storage": storage, "parent": screens })).unwrap());
    pngs.sort();
    assert_eq!(pngs, ["Wall - 1.png", "Wall - 2.png"]);

    // a pixel buffer of the wrong size is refused
    assert!(publish(&w, json!({ "name": "Bad", "folder": "", "display": false, "pages": [page], "target": { "kind": "mtp", "readerId": id, "folder": "", "format": "png" } }), vec![0; 5]).is_err());
}
