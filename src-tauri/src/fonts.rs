//! Installed fonts for the desktop shell. The web picker asks for these through
//! `desktopInvoke('plugin:fonts|list_system_fonts')` (see src/fonts.js and
//! docs/desktop.md). The WebView cannot always list fonts, so the shell reads
//! the system font folders itself and returns the family names.

use std::collections::BTreeSet;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Family names of every font installed for this user or the whole system, A to Z, without duplicates.
#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    let mut families = BTreeSet::new();
    for face in database.faces() {
        for (name, _language) in &face.families {
            let name = name.trim();
            if !name.is_empty() && name.len() <= 80 {
                families.insert(name.to_string());
            }
        }
    }
    families.into_iter().collect()
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("fonts")
        .invoke_handler(tauri::generate_handler![list_system_fonts])
        .build()
}
