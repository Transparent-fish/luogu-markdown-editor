// Desktop shell for the Luogu Markdown editor.
//
// There is deliberately almost nothing here. The application *is* the
// single-file editor (desktop/dist/index.html, a copy of the released
// LuoguMarkdownEditor.html); this process only opens a window around it and
// lends it native file dialogs. Keeping the shell this thin is what stops the
// desktop build from drifting away from the web build.

// Hide the console window that Windows would otherwise attach to a GUI binary.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running the editor window");
}
