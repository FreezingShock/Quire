//! The quick-capture shortcut: Ctrl+Alt+Q on Windows, Cmd+Option+Q on macOS.
//! It works from any app. It shows Quire and asks the page for a quick note,
//! which waits behind the passcode like every other intent.

use serde_json::json;
use tauri::{plugin::{Builder, TauriPlugin}, AppHandle, Runtime};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

use crate::{quireintents as intents, quiretray as tray};

fn quick_capture() -> Shortcut {
    let modifiers = if cfg!(target_os = "macos") {
        Modifiers::SUPER | Modifiers::ALT
    } else {
        Modifiers::CONTROL | Modifiers::ALT
    };
    Shortcut::new(Some(modifiers), Code::KeyQ)
}

fn on_shortcut<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, event: tauri_plugin_global_shortcut::ShortcutEvent) {
    if event.state() == ShortcutState::Pressed && *shortcut == quick_capture() {
        tray::show_main(app);
        intents::send(app, json!({ "name": "quick-note" }));
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let shortcut = quick_capture();
    let builder = tauri_plugin_global_shortcut::Builder::new().with_handler(on_shortcut);
    match builder.with_shortcut(shortcut) {
        Ok(builder) => builder.build(),
        // A key another app already owns: Quire still runs, and only this shortcut is missing.
        Err(_) => tauri_plugin_global_shortcut::Builder::new().build(),
    }
}

/// Keeps `Builder` in scope for the registration above without an unused import.
#[allow(dead_code)]
fn _plugin_name() -> &'static str {
    let _ = Builder::<tauri::Wry>::new("quire-shortcut");
    "quire-shortcut"
}
