//! Lists the readers that answer on the local network: cargo run -p dpt-client --example discover

fn main() {
    match dpt_client::discovery::discover(std::time::Duration::from_secs(4)) {
        Ok(list) if list.is_empty() => println!("no reader answered"),
        Ok(list) => {
            for f in list {
                println!("{} (port {}) model {:?} serial {}", f.addr, f.port, f.model, f.serial.map(|s| format!("...{}", &s[s.len().saturating_sub(4)..])).unwrap_or_default());
            }
        }
        Err(e) => eprintln!("discovery failed: {e}"),
    }
}
