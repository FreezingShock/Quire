//! Build script. Each file in features/ named <plugin>.commands declares one feature
//! plugin that this crate defines (src/<plugin>.rs). Every command listed there gets a
//! permission (allow-<command>, plus <plugin>:default for all of them), so the page
//! can call it through a capability in capabilities/<plugin>.json. To add a feature,
//! add a file here. Do not edit this script.
use std::fs;
use tauri_build::{Attributes, DefaultPermissionRule, InlinedPlugin};

fn leak(text: String) -> &'static str {
    Box::leak(text.into_boxed_str())
}

fn main() {
    println!("cargo:rerun-if-changed=features");
    let mut paths: Vec<_> = fs::read_dir("features")
        .map(|dir| dir.filter_map(|entry| entry.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    paths.sort();

    let mut attributes = Attributes::new();
    for path in paths {
        if path.extension().and_then(|ext| ext.to_str()) != Some("commands") {
            continue;
        }
        println!("cargo:rerun-if-changed={}", path.display());
        let plugin = leak(path.file_stem().unwrap().to_string_lossy().into_owned());
        let text = fs::read_to_string(&path).expect("read a features/*.commands file");
        let commands: Vec<&'static str> = text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(|line| leak(line.to_string()))
            .collect();
        let plugin_def = InlinedPlugin::new()
            .commands(Box::leak(commands.into_boxed_slice()))
            .default_permission(DefaultPermissionRule::AllowAllCommands);
        attributes = attributes.plugin(plugin, plugin_def);
    }

    tauri_build::try_build(attributes).expect("tauri-build failed");
}
