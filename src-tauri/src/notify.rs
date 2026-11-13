//! Native notices for the daily reminder and the time-capsule notices. The page
//! sends the text; the shell shows it through the system's notification center.

use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
fn send<R: Runtime>(app: AppHandle<R>, title: String, body: String, tag: Option<String>) -> Result<(), String> {
    // The system notification API has no tag, so repeats of one notice are not merged here.
    let _ = tag;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("quire-notify")
        .invoke_handler(tauri::generate_handler![send])
        .build()
}
