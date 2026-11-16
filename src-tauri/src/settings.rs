use serde::Deserialize;
use tauri::State;

use crate::state::Shared;
use crate::store::{self, AppSettings};
use crate::util::{err, CmdResult};

#[tauri::command]
pub fn settings_get(state: State<'_, Shared>) -> AppSettings {
    store::load_settings(&state.dir)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    allow_commands: Option<bool>,
    dashboard_folder: Option<String>,
    display_after_push: Option<bool>,
}

#[tauri::command]
pub fn settings_set(state: State<'_, Shared>, patch: SettingsPatch) -> CmdResult<AppSettings> {
    let mut s = store::load_settings(&state.dir);
    if let Some(v) = patch.allow_commands {
        s.allow_commands = v;
    }
    if let Some(v) = patch.dashboard_folder {
        s.dashboard_folder = store::normalize_remote_folder(&v);
    }
    if let Some(v) = patch.display_after_push {
        s.display_after_push = v;
    }
    store::save_settings(&state.dir, &s).map_err(err)?;
    Ok(s)
}
