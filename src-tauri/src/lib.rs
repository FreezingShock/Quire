//! The Quire desktop shell. It opens the bundled web app (dist-desktop/) in a
//! native window. Entries stay in the webview's IndexedDB, so the app behaves
//! as it does in the browser, offline included.

mod app;
mod fonts;
mod oauth;

use tauri::{Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// Runs before any page script. Web code reads this flag to detect the shell
/// (see src/desktop.js and docs/desktop.md). Keep the shape stable.
fn desktop_init_script() -> String {
    format!(
        r#"Object.defineProperty(globalThis, "__QUIRE_DESKTOP__", {{ value: Object.freeze({{ shell: "tauri", version: "{version}", platform: "{platform}" }}), enumerable: false, configurable: false }});"#,
        version = env!("CARGO_PKG_VERSION"),
        platform = std::env::consts::OS,
    )
}

/// True for the bundled app itself. The webview serves it from tauri://localhost
/// on macOS and Linux, and from http(s)://tauri.localhost on Windows.
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        // about:blank, blob: and data: URLs are created by the page itself.
        "about" | "blob" | "data" => true,
        _ => false,
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(app::init())
        .plugin(fonts::init())
        .plugin(oauth::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Quire")
                .inner_size(1100.0, 760.0)
                .min_inner_size(360.0, 480.0)
                .initialization_script(&desktop_init_script())
                // Links to other sites (Spotify, YouTube, export pages) open in the
                // default browser, so the journal window never navigates away.
                .on_navigation(move |url| {
                    if is_app_url(&url) {
                        true
                    } else {
                        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                        false
                    }
                });
            // Quire draws its own title bar (styles/window-chrome.css). On macOS the
            // system keeps the traffic lights, drawn over the page at top left.
            #[cfg(target_os = "macos")]
            let window = window.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
            #[cfg(not(target_os = "macos"))]
            let window = window.decorations(false);
            window.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Quire desktop app");
}
