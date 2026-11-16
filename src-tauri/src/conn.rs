//! Finding, pairing with and talking to the reader: connection state, device status, settings on the reader, Wi-Fi.

use std::time::Duration;

use dpt_client::discovery::{self, Found};
use dpt_client::{Battery, Client, Config, Credentials, DeviceConfig, Error, PairingSession, Probe, Storage, WifiNetwork, WifiScanResult};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::{AppState, Shared};
use crate::store::{self, DeviceRecord};
use crate::util::{blocking, err, now_iso, CmdResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionState {
    configured: bool,
    addr: Option<String>,
    serial: Option<String>,
    connected: bool,
    legacy_credentials: bool,
}

fn connection_state_of(st: &AppState) -> ConnectionState {
    let device = store::load_device(&st.dir);
    let client = st.client.lock().unwrap().clone();
    ConnectionState {
        configured: device.is_some() && Credentials::exists_in(&st.dir),
        addr: device.as_ref().map(|d| d.addr.clone()),
        serial: device.and_then(|d| d.serial),
        connected: client.map(|c| c.is_authenticated()).unwrap_or(false),
        legacy_credentials: Credentials::legacy_dir().map(|d| Credentials::exists_in(&d)).unwrap_or(false),
    }
}

fn clean_addr(addr: &str) -> CmdResult<String> {
    let a = addr.trim().trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/');
    if a.is_empty() || a.contains(char::is_whitespace) || a.contains('/') {
        return Err("Enter the reader's IP address, like 192.168.1.20.".into());
    }
    Ok(a.to_string())
}

#[tauri::command]
pub async fn connection_state(state: State<'_, Shared>) -> CmdResult<ConnectionState> {
    let st = state.inner().clone();
    blocking(move || connection_state_of(&st)).await
}

#[tauri::command]
pub async fn discover_devices() -> CmdResult<Vec<Found>> {
    blocking(|| discovery::discover(Duration::from_secs(4)).map_err(err)).await?
}

#[tauri::command]
pub async fn probe_device(addr: String) -> CmdResult<Probe> {
    let addr = clean_addr(&addr)?;
    blocking(move || Client::new(Config::new(addr)).probe().map_err(err)).await?
}

#[tauri::command]
pub async fn pair_start(state: State<'_, Shared>, addr: String) -> CmdResult<()> {
    let addr = clean_addr(&addr)?;
    let st = state.inner().clone();
    blocking(move || {
        let session = PairingSession::start(Config::new(addr.clone())).map_err(err)?;
        *st.pairing.lock().unwrap() = Some((addr, session));
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn pair_finish(state: State<'_, Shared>, pin: String) -> CmdResult<ConnectionState> {
    let st = state.inner().clone();
    blocking(move || {
        let (addr, session) = st.pairing.lock().unwrap().take().ok_or("Pairing was not started. Go back and start it again.")?;
        let pairing = session.finish(&pin).map_err(|e| format!("{e} Start pairing again to get a new PIN."))?;
        pairing.credentials.save_to(&st.dir).map_err(err)?;
        sign_in(&st, &addr, &pairing.credentials)?;
        Ok(connection_state_of(&st))
    })
    .await?
}

#[tauri::command]
pub async fn import_legacy_credentials(state: State<'_, Shared>, addr: String) -> CmdResult<ConnectionState> {
    let addr = clean_addr(&addr)?;
    let st = state.inner().clone();
    blocking(move || {
        let dir = Credentials::legacy_dir().ok_or("Could not find your home folder.")?;
        let creds = Credentials::load_from(&dir).map_err(err)?;
        // prove the keys work before keeping a copy
        match sign_in(&st, &addr, &creds) {
            Ok(()) => {
                creds.save_to(&st.dir).map_err(err)?;
                Ok(connection_state_of(&st))
            }
            Err(e) => Err(format!("The reader did not accept those keys ({e}). Pair it instead.")),
        }
    })
    .await?
}

/// Authenticates, remembers the reader (address + serial) and makes the client the active one.
fn sign_in(st: &AppState, addr: &str, creds: &Credentials) -> CmdResult<()> {
    let client = Client::new(Config::new(addr));
    client.authenticate(creds).map_err(err)?;
    let probe = client.probe().ok();
    let serial = probe.as_ref().map(|p| p.serial.clone());
    let model = probe.map(|p| p.model).filter(|m| !m.is_empty());
    store::save_device(&st.dir, &DeviceRecord { addr: addr.to_string(), serial, model }).map_err(err)?;
    *st.client.lock().unwrap() = Some(std::sync::Arc::new(client));
    Ok(())
}

/// Signs in with the saved keys. If the reader moved to another address (DHCP), finds it again by its serial number.
#[tauri::command]
pub async fn connect(state: State<'_, Shared>) -> CmdResult<ConnectionState> {
    let st = state.inner().clone();
    blocking(move || {
        let device = store::load_device(&st.dir).ok_or("No reader is set up yet.")?;
        let creds = Credentials::load_from(&st.dir).map_err(err)?;
        match sign_in(&st, &device.addr, &creds) {
            Ok(()) => {}
            Err(first) => {
                let Some(serial) = device.serial.clone() else { return Err(first) };
                let found = discovery::discover(Duration::from_secs(4)).map_err(|_| first.clone())?;
                let moved = found.into_iter().find(|f| f.serial.as_deref() == Some(serial.as_str())).ok_or_else(|| {
                    format!("{first} The reader was not found on this network either; check that it is awake and its Wi-Fi is on.")
                })?;
                sign_in(&st, &moved.addr, &creds)?;
            }
        }
        Ok(connection_state_of(&st))
    })
    .await?
}

#[tauri::command]
pub async fn forget_device(state: State<'_, Shared>) -> CmdResult<ConnectionState> {
    let st = state.inner().clone();
    blocking(move || {
        *st.client.lock().unwrap() = None;
        *st.pairing.lock().unwrap() = None;
        Credentials::delete_from(&st.dir);
        store::delete_device(&st.dir);
        connection_state_of(&st)
    })
    .await
}

// ------------------------------------------------------------------ status and settings of the reader

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    model: String,
    serial: String,
    color: String,
    firmware: String,
    api_version: String,
    battery: Battery,
    storage: Storage,
    wifi_enabled: bool,
}

#[tauri::command]
pub async fn device_status(state: State<'_, Shared>) -> CmdResult<DeviceStatus> {
    let c = state.client()?;
    blocking(move || -> Result<DeviceStatus, Error> {
        let info = c.info()?;
        Ok(DeviceStatus {
            model: info.model,
            serial: info.serial,
            color: info.color,
            firmware: c.firmware_version()?,
            api_version: c.api_version().unwrap_or_default(),
            battery: c.battery()?,
            storage: c.storage()?,
            wifi_enabled: c.wifi_enabled().unwrap_or(true),
        })
    })
    .await?
    .map_err(err)
}

#[tauri::command]
pub async fn device_screenshot(state: State<'_, Shared>) -> CmdResult<String> {
    use base64::Engine;
    let c = state.client()?;
    let png = blocking(move || c.screenshot_png().map_err(err)).await??;
    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
}

#[tauri::command]
pub async fn device_config(state: State<'_, Shared>) -> CmdResult<DeviceConfig> {
    let c = state.client()?;
    blocking(move || c.config().map_err(err)).await?
}

#[tauri::command]
pub async fn device_set_config(state: State<'_, Shared>, key: String, value: String) -> CmdResult<()> {
    let c = state.client()?;
    blocking(move || c.set_config(&key, &value).map_err(err)).await?
}

#[tauri::command]
pub async fn device_sync_clock(state: State<'_, Shared>) -> CmdResult<()> {
    let c = state.client()?;
    blocking(move || c.set_datetime(&now_iso()).map_err(err)).await?
}

#[tauri::command]
pub async fn wifi_list(state: State<'_, Shared>) -> CmdResult<Vec<WifiNetwork>> {
    let c = state.client()?;
    blocking(move || c.wifi_list().map_err(err)).await?
}

#[tauri::command]
pub async fn wifi_scan(state: State<'_, Shared>) -> CmdResult<Vec<WifiScanResult>> {
    let c = state.client()?;
    blocking(move || c.wifi_scan().map_err(err)).await?
}

#[derive(Deserialize)]
pub struct WifiConnectRequest {
    ssid: String,
    security: String,
    password: String,
    dhcp: bool,
}

#[tauri::command]
pub async fn wifi_connect(state: State<'_, Shared>, req: WifiConnectRequest) -> CmdResult<()> {
    if req.ssid.trim().is_empty() {
        return Err("Enter the network name.".into());
    }
    if req.security != "psk" && req.security != "nonsec" {
        return Err("Unknown security type.".into());
    }
    let c = state.client()?;
    blocking(move || c.wifi_connect(&req.ssid, &req.security, &req.password, req.dhcp).map_err(err)).await?
}

#[tauri::command]
pub async fn wifi_forget(state: State<'_, Shared>, ssid: String, security: String) -> CmdResult<()> {
    let c = state.client()?;
    blocking(move || c.wifi_forget(&ssid, &security).map_err(err)).await?
}

#[tauri::command]
pub async fn wifi_set_enabled(state: State<'_, Shared>, enabled: bool) -> CmdResult<()> {
    let c = state.client()?;
    blocking(move || c.set_wifi_enabled(enabled).map_err(err)).await?
}
