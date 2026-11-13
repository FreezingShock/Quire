// Release builds run as a windowed app, without a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    quire_lib::run()
}
