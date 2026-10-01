// Desktop shell for the Luogu Markdown editor.
//
// There is deliberately almost nothing here. The application *is* the single-file
// editor (desktop/dist/index.html, a copy of the released LuoguMarkdownEditor.html);
// this process only opens a window around it and lends it native file access.
// Keeping the shell this thin is what stops the desktop build from drifting away
// from the web build.

// Hide the console window that Windows would otherwise attach to a GUI binary.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

/// Directory the executable lives in, if it can be determined.
fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(|p| p.to_path_buf())
}

/// Portable mode is opted into by dropping a marker file next to the executable.
///
/// A portable build must keep everything it writes inside its own folder — that is
/// the whole point of carrying it on a USB stick. The webview would otherwise put
/// localStorage (where drafts live) under the user profile, so the editor would
/// silently "lose" its documents when the stick moved to another machine.
fn portable_data_dir() -> Option<PathBuf> {
    let dir = exe_dir()?;
    // Either an explicit marker, or an already-present data folder from a previous run.
    let marker = dir.join("portable.txt");
    let data = dir.join("data");
    if marker.exists() || data.is_dir() {
        std::fs::create_dir_all(&data).ok()?;
        Some(data)
    } else {
        None
    }
}

fn main() {
    if let Some(data) = portable_data_dir() {
        // Must be set before the webview is created, hence before Builder::run.
        // WebView2 (Windows) reads this env var; the others follow WEBKIT/XDG.
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &data);
        std::env::set_var("XDG_DATA_HOME", data.join("xdg-data"));
        std::env::set_var("XDG_CONFIG_HOME", data.join("xdg-config"));
        std::env::set_var("XDG_CACHE_HOME", data.join("xdg-cache"));
        std::env::set_var("LUOGU_PORTABLE", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![is_portable])
        .run(tauri::generate_context!())
        .expect("error while running the editor window");
}

/// Lets the UI show whether it is running from a portable copy.
#[tauri::command]
fn is_portable() -> bool {
    std::env::var("LUOGU_PORTABLE").is_ok()
}
