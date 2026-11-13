//! Linked folders for the desktop app. The Mac and Linux webviews have no
//! folder picker, so the web code (src/folders-native.js) uses these commands
//! there. On Windows the browser's own picker is used instead.
//!
//! Page code can read and write only inside folders the person picked with the
//! native dialog. Those folders are kept in a plain text file in the app's data
//! folder. The page cannot add one, so a script on the page cannot widen the list.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::ipc::Response;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

/// The file, in the app data folder, that lists the picked folders, one per line.
const LIST_FILE: &str = "linked-folders.txt";

/// The folders the person picked. Each entry is a canonical directory path.
#[derive(Default)]
pub struct PickedFolders(Mutex<Vec<PathBuf>>);

fn list_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join(LIST_FILE))
}

fn load_picked<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    list_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|text| {
            text.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default()
}

fn save_picked<R: Runtime>(app: &AppHandle<R>, folders: &[PathBuf]) -> Result<(), String> {
    let path = list_path(app).ok_or("the app data folder is not available")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text: String = folders.iter().map(|folder| format!("{}\n", folder.display())).collect();
    fs::write(&path, text).map_err(|e| e.to_string())
}

fn lock_error() -> String {
    "the list of linked folders is unavailable".to_string()
}

/// A folder the person picked, found by its canonical path. Anything else is refused.
fn picked_dir(picked: &PickedFolders, dir: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(dir).map_err(|e| format!("cannot open that folder: {e}"))?;
    let list = picked.0.lock().map_err(|_| lock_error())?;
    if list.iter().any(|folder| *folder == canonical) {
        Ok(canonical)
    } else {
        Err("that folder was not picked in Quire".to_string())
    }
}

/// One file directly inside a picked folder. Names with a separator, and symbolic links, are refused.
fn picked_file(picked: &PickedFolders, dir: &str, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err("that file name is not allowed".to_string());
    }
    let path = picked_dir(picked, dir)?.join(name);
    if let Ok(meta) = fs::symlink_metadata(&path) {
        if meta.file_type().is_symlink() {
            return Err("links inside a linked folder are not followed".to_string());
        }
    }
    Ok(path)
}

/// Milliseconds since the Unix epoch, or 0 when the platform gives no time.
fn millis(time: std::io::Result<SystemTime>) -> f64 {
    time.ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Shows the native folder picker. Returns the chosen folder's path, or null when the person cancels.
#[tauri::command]
async fn pick_folder<R: Runtime>(app: AppHandle<R>, picked: State<'_, PickedFolders>) -> Result<Option<String>, String> {
    let chosen = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok());
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let canonical = fs::canonicalize(&chosen).map_err(|e| e.to_string())?;
    let shown = canonical.display().to_string();
    if shown.contains('\n') {
        return Err("that folder name has a line break, which Quire cannot keep".to_string());
    }
    let mut list = picked.0.lock().map_err(|_| lock_error())?;
    if !list.contains(&canonical) {
        list.push(canonical);
        save_picked(&app, &list)?;
    }
    Ok(Some(shown))
}

/// Forgets a picked folder, so Quire can no longer read or write in it.
#[tauri::command]
fn forget_folder<R: Runtime>(app: AppHandle<R>, picked: State<'_, PickedFolders>, dir: String) -> Result<(), String> {
    let target = PathBuf::from(&dir);
    let mut list = picked.0.lock().map_err(|_| lock_error())?;
    let before = list.len();
    list.retain(|folder| *folder != target && folder.display().to_string() != dir);
    if list.len() != before {
        save_picked(&app, &list)?;
    }
    Ok(())
}

/// The files directly inside a picked folder, as (name, size in bytes, modified in ms).
#[tauri::command]
fn list_folder(picked: State<'_, PickedFolders>, dir: String) -> Result<Vec<(String, u64, f64)>, String> {
    let folder = picked_dir(&picked, &dir)?;
    let mut files = Vec::new();
    for entry in fs::read_dir(&folder).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if !meta.is_file() {
            continue;
        }
        files.push((entry.file_name().to_string_lossy().into_owned(), meta.len(), millis(meta.modified())));
    }
    Ok(files)
}

/// A file's size in bytes and modified time in ms.
#[tauri::command]
fn stat_file(picked: State<'_, PickedFolders>, dir: String, name: String) -> Result<(u64, f64), String> {
    let path = picked_file(&picked, &dir, &name)?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok((meta.len(), millis(meta.modified())))
}

/// A file's bytes, returned raw so the page gets an ArrayBuffer.
#[tauri::command]
fn read_file(picked: State<'_, PickedFolders>, dir: String, name: String) -> Result<Response, String> {
    let path = picked_file(&picked, &dir, &name)?;
    Ok(Response::new(fs::read(&path).map_err(|e| e.to_string())?))
}

/// Writes a file, through a temporary file in the same folder, so a failed write never leaves half a file.
#[tauri::command]
fn write_file(picked: State<'_, PickedFolders>, dir: String, name: String, data: Vec<u8>) -> Result<(), String> {
    let path = picked_file(&picked, &dir, &name)?;
    let folder: &Path = path.parent().ok_or("the folder is not available")?;
    let temp = folder.join(format!(".{name}.quire-tmp"));
    fs::write(&temp, &data).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e.to_string()
    })
}

/// The plugin. Its commands are called as `plugin:folders|<command>` from page code.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("folders")
        .invoke_handler(tauri::generate_handler![pick_folder, forget_folder, list_folder, stat_file, read_file, write_file])
        .setup(|app, _api| {
            app.manage(PickedFolders(Mutex::new(load_picked(app))));
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quire-folders-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::canonicalize(&dir).unwrap()
    }

    fn picked_with(folders: &[PathBuf]) -> PickedFolders {
        PickedFolders(Mutex::new(folders.to_vec()))
    }

    #[test]
    fn a_picked_folder_is_allowed_and_any_other_folder_is_refused() {
        let picked_dir = scratch("picked");
        let other_dir = scratch("other");
        let picked = picked_with(std::slice::from_ref(&picked_dir));
        assert!(picked_dir_ok(&picked, &picked_dir));
        assert!(!picked_dir_ok(&picked, &other_dir));
        // A sub-folder of a picked folder is not picked, so it is refused too.
        let child = picked_dir.join("child");
        fs::create_dir_all(&child).unwrap();
        assert!(!picked_dir_ok(&picked, &child));
    }

    #[test]
    fn file_names_with_separators_or_dot_segments_are_refused() {
        let dir = scratch("names");
        let picked = picked_with(std::slice::from_ref(&dir));
        let dir_str = dir.display().to_string();
        for name in ["", ".", "..", "../escape.md", "sub/x.md", "sub\\x.md"] {
            assert!(picked_file(&picked, &dir_str, name).is_err(), "should refuse {name:?}");
        }
        assert!(picked_file(&picked, &dir_str, "Trip.md").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn a_symbolic_link_inside_a_picked_folder_is_refused() {
        let dir = scratch("links");
        let outside = scratch("outside");
        fs::write(outside.join("secret.md"), "private").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.md"), dir.join("link.md")).unwrap();
        let picked = picked_with(std::slice::from_ref(&dir));
        assert!(picked_file(&picked, &dir.display().to_string(), "link.md").is_err());
    }

    /// The same check the commands make: the folder must canonicalize to one of the picked folders.
    fn picked_dir_ok(picked: &PickedFolders, dir: &Path) -> bool {
        picked_dir(picked, &dir.display().to_string()).is_ok()
    }
}
