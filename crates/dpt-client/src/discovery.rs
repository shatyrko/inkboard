//! Finding readers on the local network (mDNS service `_digitalpaper._tcp`).

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent};

use crate::client::{Client, Config};
use crate::error::{Error, Result};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub addr: String,
    pub port: u16,
    pub name: String,
    pub serial: Option<String>,
    pub model: Option<String>,
}

const SERVICE: &str = "_digitalpaper._tcp.local.";

/// Listens for `timeout` and returns every reader that announced itself, with model and serial when it answers a probe.
pub fn discover(timeout: Duration) -> Result<Vec<Found>> {
    let daemon = ServiceDaemon::new().map_err(|e| Error::Network(e.to_string()))?;
    let rx = daemon.browse(SERVICE).map_err(|e| Error::Network(e.to_string()))?;
    let deadline = Instant::now() + timeout;
    let mut found: HashMap<String, Found> = HashMap::new();
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                // prefer IPv4: the reader's HTTP listeners are reachable that way without a scope id
                let ip = info.get_addresses().iter().map(|a| a.to_ip_addr()).min_by_key(|a| matches!(a, IpAddr::V6(_)));
                if let Some(ip) = ip {
                    let name = info.get_fullname().split("._digitalpaper").next().unwrap_or("Digital Paper").replace("\\032", " ");
                    found.entry(ip.to_string()).or_insert(Found { addr: ip.to_string(), port: info.get_port(), name, serial: None, model: None });
                }
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = daemon.shutdown();
    let mut list: Vec<Found> = found.into_values().collect();
    for f in &mut list {
        if let Ok(p) = Client::new(Config::new(f.addr.clone())).probe() {
            f.serial = Some(p.serial);
            f.model = Some(p.model);
        }
    }
    list.sort_by(|a, b| a.addr.cmp(&b.addr));
    Ok(list)
}
