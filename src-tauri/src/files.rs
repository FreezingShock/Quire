//! Opening Quire files from the file manager: a double-clicked backup restores,
//! and a Day One export or Markdown file imports. Covers the first launch
//! (argv), a second launch (single instance) and macOS's open-file event.
//!
//! The page can only read a file the user opened in this session. That keeps
//! the file command from being a general file reader.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

use serde_json::json;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, State,
};

use crate::{intents, tray};

/// The largest file Quire will read. A year of entries with pictures fits well under this.
const MAX_BYTES: u64 = 64 * 1024 * 1024;
const TYPES: [&str; 4] = ["json", "md", "markdown", "txt"];

#[derive(Default)]
pub struct Opened(Mutex<HashSet<PathBuf>>);

fn opened(state: &Opened) -> MutexGuard<'_, HashSet<PathBuf>> {
    state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A file Quire will open: a readable file of a known type under the size limit.
fn openable(path: &Path) -> bool {
    let known = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| TYPES.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    known && path.metadata().map(|meta| meta.is_file() && meta.len() <= MAX_BYTES).unwrap_or(false)
}

/// Remembers the file, brings Quire forward, and asks the page to open it.
pub fn open_path<R: Runtime>(app: &AppHandle<R>, path: PathBuf) {
    if !openable(&path) {
        return;
    }
    if let Some(state) = app.try_state::<Opened>() {
        opened(&state).insert(path.clone());
    }
    tray::show_main(app);
    intents::send(app, json!({ "name": "open-file", "path": path.to_string_lossy() }));
}

#[tauri::command]
fn read_text(path: String, state: State<'_, Opened>) -> Result<String, String> {
    let path = PathBuf::from(&path);
    if !opened(&state).contains(&path) || !openable(&path) {
        return Err("Quire can only read a file you opened in it.".into());
    }
    std::fs::read_to_string(&path).map_err(|error| error.to_string())
}

/// Runs on every launch. The first instance's argv names a file when the user double-clicked one.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("quire-files")
        .invoke_handler(tauri::generate_handler![read_text])
        .setup(|app, _| {
            app.manage(Opened::default());
            for arg in std::env::args_os().skip(1) {
                open_path(app, PathBuf::from(arg));
            }
            Ok(())
        })
        .build()
}

/// The single-instance plugin. A second launch hands its argv to the running window and exits.
pub fn single_instance<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_single_instance::init(|app, args, _cwd| {
        tray::show_main(app);
        for arg in args.into_iter().skip(1) {
            open_path(app, PathBuf::from(arg));
        }
    })
}

/// macOS sends double-clicked files as an event, not as argv. Other systems never send it.
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: tauri::RunEvent) {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    if let tauri::RunEvent::Opened { urls } = event {
        for url in urls {
            if let Ok(path) = url.to_file_path() {
                open_path(app, path);
            }
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let _ = (app, event);
}
