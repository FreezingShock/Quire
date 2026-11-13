//! System tray (menu bar on macOS). Off by default: closing the window quits
//! Quire. When the user turns the tray on, closing the window hides it instead,
//! and the tray menu starts a new entry, a quick note, or brings the window back.

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    plugin::{Builder, TauriPlugin},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, State, WindowEvent,
};

use crate::intents;

const TRAY_ID: &str = "quire";

#[derive(Default)]
pub struct TrayFlag(AtomicBool);

impl TrayFlag {
    pub fn enabled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Shows the main window and brings it to the front.
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn set_enabled<R: Runtime>(app: AppHandle<R>, enabled: bool, flag: State<'_, TrayFlag>) -> Result<(), String> {
    flag.0.store(enabled, Ordering::SeqCst);
    if enabled {
        if app.tray_by_id(TRAY_ID).is_none() {
            build(&app).map_err(|error| error.to_string())?;
        }
    } else {
        let _ = app.remove_tray_by_id(TRAY_ID);
    }
    Ok(())
}

fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "new-entry", "New entry", true, None::<&str>)?,
            &MenuItem::with_id(app, "quick-note", "Quick note", true, None::<&str>)?,
            &MenuItem::with_id(app, "open", "Open Quire", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit Quire", true, None::<&str>)?,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Quire")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "new-entry" => {
                show_main(app);
                intents::send(app, json!({ "name": "new-entry" }));
            }
            "quick-note" => {
                show_main(app);
                intents::send(app, json!({ "name": "quick-note" }));
            }
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("quire-tray")
        .invoke_handler(tauri::generate_handler![set_enabled])
        .setup(|app, _| {
            app.manage(TrayFlag::default());
            Ok(())
        })
        .on_window_ready(|window| {
            let app = window.app_handle().clone();
            let hide_window = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if app.state::<TrayFlag>().enabled() {
                        api.prevent_close();
                        let _ = hide_window.hide();
                    }
                }
            });
        })
        .build()
}
