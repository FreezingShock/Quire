//! Updates. Quire checks GitHub Releases once a day (the page asks), and when a
//! newer build is there it installs it and restarts. The builds are not
//! code-signed, so Windows and macOS warn on a first install. Updates are
//! checked against Tauri's own update signature (see the public key in
//! tauri.conf.json), which is not an OS certificate.
//!
//! The updater plugin is registered in lib.rs once tauri.conf.json carries the
//! endpoint and public key. Until then, both commands report that no update
//! is available, so the app runs without it.

use std::sync::Mutex;

use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, State,
};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update found by `check`, held until the page asks to install it.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

/// The version of a newer build, or null when there is none. Never fails the page: a failed check is just no update.
#[tauri::command]
async fn check<R: Runtime>(app: AppHandle<R>, pending: State<'_, Pending>) -> Result<Option<String>, String> {
    let Ok(updater) = app.updater() else {
        return Ok(None);
    };
    let update = match updater.check().await {
        Ok(update) => update,
        Err(error) => {
            eprintln!("update check failed: {error}");
            return Ok(None);
        }
    };
    let version = update.as_ref().map(|found| found.version.clone());
    *pending.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = update;
    Ok(version)
}

/// Downloads and installs the update found by `check`, then restarts Quire.
/// The page saves before it calls this.
#[tauri::command]
async fn install<R: Runtime>(app: AppHandle<R>, pending: State<'_, Pending>) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
        .ok_or_else(|| "No update is waiting to install.".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    app.restart();
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("quire-updater")
        .invoke_handler(tauri::generate_handler![check, install])
        .setup(|app, _| {
            app.manage(Pending::default());
            Ok(())
        })
        .build()
}
