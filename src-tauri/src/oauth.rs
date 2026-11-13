//! Plugin "oauth": the sign-in redirect for accounts in the desktop app.
//!
//! Google and magic-link sign-in open in the system browser. Supabase then sends
//! the browser to http://127.0.0.1:53847/callback, which this plugin listens on.
//! The plugin hands the one-time code back to the window by loading the app again
//! with the code in its address. The web code then finishes the sign-in exactly as
//! it does in a browser. The PKCE verifier stays in the window's sessionStorage,
//! and the same origin keeps it across that reload.
//!
//! From the page (src/cloud/account.js): desktopInvoke('plugin:oauth|listen') before
//! a sign-in starts, then desktopInvoke('plugin:oauth|open_in_browser', { url }).
//! The port must be in the Supabase redirect allow list: http://127.0.0.1:53847/callback

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};
use tauri_plugin_opener::OpenerExt;

/// Fixed, so the Supabase redirect allow list can name it.
pub const PORT: u16 = 53847;
const CALLBACK_PATH: &str = "/callback";

const DONE_PAGE: &str = "<!doctype html><meta charset=\"utf-8\"><title>Quire</title>\
<body style=\"font-family:sans-serif;padding:24px\">\
<h2>You are signed in to Quire</h2><p>You can close this tab and return to Quire.</p></body>";

/// Starts waiting for the browser's return. Each sign-in uses one listener, and a stray request gets a 404.
#[tauri::command]
fn listen<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(listener) => listener,
        // An earlier listener is still waiting for its callback, and it will take this one.
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => return Ok(()),
        Err(error) => return Err(format!("Quire could not open the sign-in port: {error}")),
    };
    std::thread::spawn(move || serve(listener, app));
    Ok(())
}

fn serve<R: Runtime>(listener: TcpListener, app: AppHandle<R>) {
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        match request_target(&stream) {
            Some(target) if target.starts_with(CALLBACK_PATH) && is_plain(&target) => {
                respond(&mut stream, 200, DONE_PAGE);
                let query = target.split_once('?').map(|(_, query)| query).unwrap_or("");
                if let Some(window) = app.get_webview_window("main") {
                    // Only query characters that are safe inside a JavaScript string, so the code cannot break out of it.
                    let _ = window.eval(&format!("location.replace('./index.html?{query}')"));
                }
                return;
            }
            _ => respond(&mut stream, 404, "Not found"),
        }
    }
}

/// The request target of a GET, such as `/callback?code=...`.
fn request_target(stream: &TcpStream) -> Option<String> {
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    parts.next().map(str::to_string)
}

/// Letters, digits and the few URL punctuation marks a sign-in code uses.
fn is_plain(target: &str) -> bool {
    target.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"/?&=_-.%".contains(&byte))
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = if status == 200 { "OK" } else { "Not Found" };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

/// Opens a sign-in address in the default browser. Only Supabase's auth endpoints are accepted.
#[tauri::command]
fn open_in_browser<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    if !url.starts_with("https://") || !url.contains("/auth/v1/") {
        return Err("Only sign-in addresses can be opened from Quire.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("oauth")
        .invoke_handler(tauri::generate_handler![listen, open_in_browser])
        .build()
}
