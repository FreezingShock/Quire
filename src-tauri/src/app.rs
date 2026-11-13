//! Plugin "app": small facts about the desktop shell for page code.
//! From the page: desktopInvoke('plugin:app|info'), which resolves to { version, platform }.
//! The plugin name must match features/app.commands and capabilities/app.json.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[tauri::command]
fn info() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
    })
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("app")
        .invoke_handler(tauri::generate_handler![info])
        .build()
}
