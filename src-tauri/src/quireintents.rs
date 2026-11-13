//! Intents: things the user asked for outside the page (a tray menu item, the
//! quick-note shortcut, a file opened from the file manager, a second launch).
//!
//! The page takes the queue with `take` once the library is open, which is
//! after the passcode is typed. From then on intents reach the page as
//! `quire:intent` window events. Until then they wait here, so nothing reaches
//! a locked library. A page reload drops back to waiting, because the lock
//! screen reloads the page.

use std::sync::{Mutex, MutexGuard};

use serde_json::Value;
use tauri::{
    plugin::{Builder, TauriPlugin},
    webview::PageLoadEvent,
    AppHandle, Manager, Runtime, State,
};

#[derive(Default)]
pub struct Intents {
    queue: Mutex<Vec<Value>>,
    live: Mutex<bool>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Hands an intent to the page now if it is listening, or queues it for `take`.
pub fn send<R: Runtime>(app: &AppHandle<R>, intent: Value) {
    let Some(state) = app.try_state::<Intents>() else {
        return;
    };
    if *lock(&state.live) {
        if let Some(window) = app.get_webview_window("main") {
            // The intent is JSON, which is also a valid JavaScript object literal.
            let script = format!("window.dispatchEvent(new CustomEvent('quire:intent', {{ detail: {intent} }}));");
            if window.eval(&script).is_ok() {
                return;
            }
        }
    }
    lock(&state.queue).push(intent);
}

/// Called by the page once the library is open. Turns live delivery on and returns what was queued.
#[tauri::command]
fn take(state: State<'_, Intents>) -> Vec<Value> {
    *lock(&state.live) = true;
    std::mem::take(&mut *lock(&state.queue))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("quireintents")
        .invoke_handler(tauri::generate_handler![take])
        .setup(|app, _| {
            app.manage(Intents::default());
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                if let Some(state) = webview.try_state::<Intents>() {
                    *lock(&state.live) = false;
                }
            }
        })
        .build()
}
