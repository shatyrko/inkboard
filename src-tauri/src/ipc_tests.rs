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
use crate::{dashboards, settings};

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
