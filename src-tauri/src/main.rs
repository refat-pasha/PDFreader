// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
fn configure_optional_fixed_webview2() {
    use std::path::PathBuf;

    if std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").is_some() {
        return;
    }
    if let Some(explicit) = std::env::var_os("PDFREADER_WEBVIEW2_RUNTIME") {
        let candidate = PathBuf::from(explicit);
        if candidate.join("msedgewebview2.exe").is_file() {
            std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", candidate);
            return;
        }
    }
    let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") else {
        return;
    };
    let root = PathBuf::from(local_app_data).join("PDFreader").join("WebView2Fixed");
    let Ok(entries) = std::fs::read_dir(&root) else {
        return;
    };
    let mut candidates = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.join("msedgewebview2.exe").is_file() {
            candidates.push(path);
        } else if path.is_dir() {
            if let Ok(children) = std::fs::read_dir(&path) {
                for child in children.flatten() {
                    let child_path = child.path();
                    if child_path.join("msedgewebview2.exe").is_file() {
                        candidates.push(child_path);
                    }
                }
            }
        }
    }
    candidates.sort();
    if let Some(runtime) = candidates.pop() {
        std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", runtime);
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    configure_optional_fixed_webview2();
    pdfreader_lib::run()
}
