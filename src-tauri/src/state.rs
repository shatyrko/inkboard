use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use dpt_client::{Client, PairingSession};
use sysinfo::System;

use crate::util::CmdResult;

pub struct AppState {
    /// the config directory everything is stored under
    pub dir: PathBuf,
    pub client: Mutex<Option<Arc<Client>>>,
    /// a pairing that has asked the reader for a PIN and waits for the user to type it
    pub pairing: Mutex<Option<(String, PairingSession)>>,
    pub sys: Mutex<System>,
}

pub type Shared = Arc<AppState>;

impl AppState {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, client: Mutex::new(None), pairing: Mutex::new(None), sys: Mutex::new(System::new().expect("system information is unavailable")) }
    }

    /// The signed-in client, or an error the UI can show next to a Connect button.
    pub fn client(&self) -> CmdResult<Arc<Client>> {
        self.client.lock().unwrap().clone().ok_or_else(|| "Not connected to a reader.".to_string())
    }
}
