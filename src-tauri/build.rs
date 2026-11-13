use tauri_build::{Attributes, InlinedPlugin};

fn main() {
    // Each desktop feature is an inline plugin, so its commands get permissions of their own.
    // capabilities/<feature>.json grants them to the main window.
    let attributes = Attributes::new()
        .plugin("quire-intents", InlinedPlugin::new().commands(&["take"]))
        .plugin("quire-tray", InlinedPlugin::new().commands(&["set_enabled"]))
        .plugin("quire-notify", InlinedPlugin::new().commands(&["send"]))
        .plugin("quire-autostart", InlinedPlugin::new().commands(&["set_enabled"]))
        .plugin("quire-files", InlinedPlugin::new().commands(&["read_text"]))
        .plugin("quire-updater", InlinedPlugin::new().commands(&["check", "install"]));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
