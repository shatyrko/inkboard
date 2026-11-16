//! Facts about this computer for the dashboard's System widget.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Disks, System};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskStat {
    pub mount: String,
    pub total: u64,
    pub available: u64,
}

#[derive(Debug, Serialize)]
pub struct ComputerBattery {
    pub level: u32,
    pub charging: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub swap_used: u64,
    pub swap_total: u64,
    pub uptime_secs: u64,
    pub load: [f64; 3],
    pub disks: Vec<DiskStat>,
    pub battery: Option<ComputerBattery>,
    pub os: String,
    pub hostname: String,
}

/// CPU usage needs two samples; the first call waits one sampling interval, later calls reuse the previous sample.
pub fn collect(sys: &Mutex<System>) -> SystemStats {
    let mut sys = sys.lock().unwrap();
    let first = sys.cpus().is_empty();
    sys.refresh_cpu_usage();
    if first {
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL + Duration::from_millis(50));
        sys.refresh_cpu_usage();
    }
    sys.refresh_memory();
    let load = System::load_average().map(|l| [l.one, l.five, l.fifteen]).unwrap_or_default();
    let mut disks: Vec<DiskStat> = Disks::new_with_refreshed_list()
        .map(|list| {
            list.iter()
                .filter(|d| !d.is_removable() && d.total_space() > 0)
                .map(|d| DiskStat { mount: d.mount_point().to_string_lossy().into_owned(), total: d.total_space(), available: d.available_space() })
                .collect()
        })
        .unwrap_or_default();
    disks.sort_by(|a, b| a.mount.cmp(&b.mount));
    disks.dedup_by(|a, b| a.total == b.total && a.available == b.available);
    SystemStats {
        cpu_percent: sys.global_cpu_usage(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
        swap_used: sys.used_swap(),
        swap_total: sys.total_swap(),
        uptime_secs: System::uptime().unwrap_or_default(),
        load,
        disks,
        battery: computer_battery(),
        os: System::long_os_version().or_else(|_| System::name()).unwrap_or_default(),
        hostname: System::host_name().unwrap_or_default(),
    }
}

#[cfg(target_os = "linux")]
fn computer_battery() -> Option<ComputerBattery> {
    for entry in std::fs::read_dir("/sys/class/power_supply").ok()?.flatten() {
        let dir = entry.path();
        if std::fs::read_to_string(dir.join("type")).ok()?.trim() != "Battery" {
            continue;
        }
        let level: u32 = std::fs::read_to_string(dir.join("capacity")).ok()?.trim().parse().ok()?;
        let status = std::fs::read_to_string(dir.join("status")).unwrap_or_default();
        return Some(ComputerBattery { level, charging: status.trim() == "Charging" });
    }
    None
}

#[cfg(not(target_os = "linux"))]
fn computer_battery() -> Option<ComputerBattery> {
    None
}
