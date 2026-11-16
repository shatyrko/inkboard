//! Read-only smoke test against a real reader:
//!   cargo run -p dpt-client --example probe -- <address> [credentials-dir]
//! The credentials directory defaults to ~/.config/dpt (keys made by dpt-rp1-py work as they are).

use dpt_client::{Client, Config, Credentials};
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let addr = args.next().ok_or("usage: probe <address> [credentials-dir]")?;
    let dir = args.next().map(PathBuf::from).or_else(Credentials::legacy_dir).ok_or("no credentials directory")?;

    let client = Client::new(Config::new(addr));
    let probe = client.probe()?;
    println!("probe: model {} api {:?}", probe.model, probe.api_version);

    client.authenticate(&Credentials::load_from(&dir)?)?;
    println!("authenticated: {}", client.is_authenticated());
    let info = client.info()?;
    println!("info: {} / sku {}", info.model, info.sku);
    println!("firmware: {}", client.firmware_version()?);
    println!("battery: {:?}", client.battery()?);
    println!("storage: {:?}", client.storage()?);
    let cfg = client.config()?;
    println!("config: {} / {} / standby {} / tz {}", cfg.date_format, cfg.time_format, cfg.timeout_to_standby, cfg.timezone);
    println!("wifi: {} saved networks, enabled {}", client.wifi_list()?.len(), client.wifi_enabled()?);
    let entries = client.list_entries()?;
    let docs = entries.iter().filter(|e| e.kind == dpt_client::EntryKind::Document).count();
    println!("library: {} entries ({} documents)", entries.len(), docs);
    println!("templates: {}", client.list_templates()?.len());
    let png = client.screenshot_png()?;
    println!("screenshot: {} bytes, png signature {}", png.len(), png.starts_with(&[0x89, b'P', b'N', b'G']));
    Ok(())
}
