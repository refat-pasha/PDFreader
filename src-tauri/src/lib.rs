use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager};

mod native_pdf;
#[cfg(windows)]
mod native_ocr;

const MAX_READ_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 1536 * 1024 * 1024;

/// Paths received before the webview has mounted its event listener. The
/// frontend drains this queue immediately on startup, so Explorer / second-
/// instance launches cannot be lost in the event/listener race.
#[derive(Default)]
struct PendingPaths(Mutex<Vec<String>>);

#[derive(Debug, thiserror::Error)]
enum FileError {
    #[error("The path is not valid: {0}")]
    InvalidPath(String),
    #[error("The file does not exist or is not a regular file.")]
    NotFound,
    #[error("The file is larger than the 1 GiB safety limit.")]
    TooLarge,
    #[error("The file type is not supported by this operation.")]
    UnsupportedType,
    #[error("Native PDF engine error: {0}")]
    Pdf(String),
    #[error("I/O error: {0}")]
    Io(String),
}

impl From<std::io::Error> for FileError {
    fn from(value: std::io::Error) -> Self {
        FileError::Io(value.to_string())
    }
}

impl serde::Serialize for FileError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

fn canonical_pdf(path: String) -> Result<PathBuf, FileError> {
    let canonical = fs::canonicalize(&path)
        .map_err(|_| FileError::InvalidPath(path.clone()))?;
    if !canonical.is_file() {
        return Err(FileError::NotFound);
    }
    let metadata = fs::metadata(&canonical).map_err(|error| FileError::Io(error.to_string()))?;
    if metadata.len() > MAX_READ_BYTES {
        return Err(FileError::TooLarge);
    }
    if canonical.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("pdf")) != Some(true) {
        return Err(FileError::UnsupportedType);
    }
    Ok(canonical)
}

/// Read a PDF from disk. The renderer receives an opaque ArrayBuffer;
/// all path validation and the size ceiling happen on the native side.
#[tauri::command]
fn read_file(path: String) -> Result<tauri::ipc::Response, FileError> {
    read_pdf_bytes(path).map(tauri::ipc::Response::new)
}

fn read_pdf_bytes(path: String) -> Result<Vec<u8>, FileError> {
    let canonical = canonical_pdf(path)?;
    fs::read(canonical).map_err(|error| FileError::Io(error.to_string()))
}

/// Write an exported artifact atomically. The destination must live in an
/// existing directory and use an allowlisted export extension.
#[tauri::command]
fn write_file(path: String, data: Vec<u8>) -> Result<(), FileError> {
    if data.len() > MAX_WRITE_BYTES {
        return Err(FileError::TooLarge);
    }
    let destination = PathBuf::from(&path);
    let parent = destination
        .parent()
        .ok_or_else(|| FileError::InvalidPath(path.clone()))?;
    if !parent.is_dir() {
        return Err(FileError::InvalidPath(path.clone()));
    }
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    const ALLOWED: &[&str] = &["pdf", "docx", "doc", "md", "txt", "png", "jpg", "jpeg", "zip", "json"];
    if !ALLOWED.contains(&extension.as_str()) {
        return Err(FileError::UnsupportedType);
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let temp = parent.join(format!(".pdfreader-save-{nonce}.tmp"));
    {
        let mut file = fs::File::create(&temp).map_err(|error| FileError::Io(error.to_string()))?;
        file.write_all(&data).map_err(|error| FileError::Io(error.to_string()))?;
        file.sync_all().map_err(|error| FileError::Io(error.to_string()))?;
    }

    if !destination.exists() {
        fs::rename(&temp, &destination).map_err(|error| FileError::Io(error.to_string()))?;
        return Ok(());
    }

    let backup = parent.join(format!(".pdfreader-save-{nonce}.bak"));
    fs::rename(&destination, &backup).map_err(|error| FileError::Io(error.to_string()))?;
    match fs::rename(&temp, &destination) {
        Ok(()) => {
            let _ = fs::remove_file(&backup);
            Ok(())
        }
        Err(error) => {
            let _ = fs::rename(&backup, &destination);
            let _ = fs::remove_file(&temp);
            Err(FileError::Io(error.to_string()))
        }
    }
}

#[tauri::command]
fn get_platform_info(app: tauri::AppHandle) -> serde_json::Value {
    let tesseract = find_tesseract().is_some();
    #[cfg(windows)]
    let windows_ocr = native_ocr::available();
    #[cfg(not(windows))]
    let windows_ocr = false;
    serde_json::json!({
        "app": "PDFreader",
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "pdfium": native_pdf::resolve_pdfium_dll(Some(&app)).is_some(),
        "libreoffice": find_libreoffice().is_some(),
        "tesseract": tesseract,
        "windows_ocr": windows_ocr,
        "ocr": tesseract || windows_ocr,
    })
}

#[tauri::command]
fn native_pdf_info(app: tauri::AppHandle, path: String) -> Result<native_pdf::NativePdfInfo, FileError> {
    let canonical = canonical_pdf(path)?;
    native_pdf::page_count(Some(&app), &canonical, None).map_err(FileError::Pdf)
}

#[tauri::command]
fn render_pdf_page_png(
    app: tauri::AppHandle,
    path: String,
    page: u16,
    target_width: u32,
) -> Result<tauri::ipc::Response, FileError> {
    let canonical = canonical_pdf(path)?;
    native_pdf::render_page_png(Some(&app), &canonical, page, target_width, None)
        .map(tauri::ipc::Response::new)
        .map_err(FileError::Pdf)
}

/// Open the Windows default-apps page. Windows deliberately does not allow an
/// application to set itself as the default PDF handler silently; the user makes
/// the choice in Settings after the installer registers the association.
#[tauri::command]
fn open_default_apps() -> Result<(), FileError> {
    std::process::Command::new("explorer.exe")
        .arg("ms-settings:defaultapps")
        .spawn()
        .map(|_| ())
        .map_err(|error| FileError::Io(error.to_string()))
}

/// OCR one rendered page through an installed Tesseract binary. OCR is optional
/// and never required for reading or normal export.
#[tauri::command]
fn ocr_image(data: Vec<u8>, language: String) -> Result<String, FileError> {
    if data.is_empty() || data.len() > 128 * 1024 * 1024 {
        return Err(FileError::TooLarge);
    }
    if let Some(tesseract) = find_tesseract() {
        if !language
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '+' || character == '_')
        {
            return Err(FileError::UnsupportedType);
        }
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let work = std::env::temp_dir().join(format!("pdfreader-ocr-{nonce}"));
        fs::create_dir_all(&work)?;
        let input = work.join("page.png");
        fs::write(&input, &data)?;
        let result = std::process::Command::new(tesseract)
            .arg(&input)
            .arg("stdout")
            .arg("-l")
            .arg(&language)
            .output();
        let _ = fs::remove_dir_all(&work);
        let output = result.map_err(|error| FileError::Io(error.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(FileError::Io(format!(
                "OCR failed: {}",
                stderr.lines().next().unwrap_or("Tesseract returned an error.").trim()
            )));
        }
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    #[cfg(windows)]
    {
        return native_ocr::recognize_png(&data).map_err(FileError::Pdf);
    }
    #[cfg(not(windows))]
    {
        let _ = language;
        Err(FileError::UnsupportedType)
    }
}

fn find_libreoffice() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.exe"),
        PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
    ];
    candidates.into_iter().find(|path| path.is_file()).or_else(|| {
        std::env::var_os("LIBREOFFICE_PATH")
            .map(PathBuf::from)
            .filter(|path| path.is_file())
    })
}

fn find_tesseract() -> Option<PathBuf> {
    [
        PathBuf::from(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

/// Convert a DOCX payload to legacy Word 97 with an installed LibreOffice.
/// The process is argument-array based, scoped to a unique temporary directory,
/// and never exposes a shell.
#[tauri::command]
fn convert_docx_to_doc(data: Vec<u8>, filename: String) -> Result<Vec<u8>, FileError> {
    let office = find_libreoffice().ok_or(FileError::UnsupportedType)?;
    if data.len() > MAX_WRITE_BYTES {
        return Err(FileError::TooLarge);
    }
    let safe_stem = Path::new(&filename)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, ' ' | '-' | '_'))
        .collect::<String>();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let work = std::env::temp_dir().join(format!("pdfreader-office-{nonce}"));
    fs::create_dir_all(&work)?;
    let input = work.join(format!("{safe_stem}.docx"));
    fs::write(&input, &data)?;

    let mut child = std::process::Command::new(&office)
        .arg("--headless")
        .arg("--norestore")
        .arg("--nolockcheck")
        .arg("--nodefault")
        .arg(format!("-env:UserInstallation=file:///{}", work.join("profile").to_string_lossy().replace('\\', "/")))
        .arg("--convert-to")
        .arg("doc:MS Word 97")
        .arg("--outdir")
        .arg(&work)
        .arg(&input)
        .spawn()
        .map_err(|error| FileError::Io(error.to_string()))?;

    let started = SystemTime::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if started.elapsed().map(|duration| duration.as_secs() > 180).unwrap_or(true) {
                    let _ = child.kill();
                    let _ = fs::remove_dir_all(&work);
                    return Err(FileError::Io("LibreOffice conversion timed out.".into()));
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            Err(error) => {
                let _ = fs::remove_dir_all(&work);
                return Err(FileError::Io(error.to_string()));
            }
        }
    }

    let output = work.join(format!("{safe_stem}.doc"));
    let bytes = fs::read(&output).map_err(|_| {
        FileError::Io("LibreOffice did not produce a Word 97 file.".into())
    })?;
    let _ = fs::remove_dir_all(&work);
    Ok(bytes)
}

fn pdf_paths_from_args() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter(|arg| arg.to_ascii_lowercase().ends_with(".pdf"))
        .filter(|arg| Path::new(arg).is_file())
        .collect()
}

#[tauri::command]
fn take_pending_paths(state: tauri::State<'_, PendingPaths>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut paths| std::mem::take(&mut *paths))
        .unwrap_or_default()
}

fn emit_open_paths(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<PendingPaths>() {
        if let Ok(mut pending) = state.0.lock() {
            for path in &paths {
                if !pending.contains(path) {
                    pending.push(path.clone());
                }
            }
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
        let _ = window.unminimize();
    }
    let _ = app.emit("open-paths", paths);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PendingPaths::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths: Vec<String> = args
                .into_iter()
                .filter(|arg| !arg.starts_with('-'))
                .filter(|arg| arg.to_ascii_lowercase().ends_with(".pdf"))
                .filter(|arg| Path::new(arg).is_file())
                .collect();
            emit_open_paths(app, paths);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Queue and broadcast startup paths immediately. The queue is what
            // guarantees delivery if the webview is not listening yet.
            emit_open_paths(app.handle(), pdf_paths_from_args());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            get_platform_info,
            native_pdf_info,
            render_pdf_page_png,
            convert_docx_to_doc,
            ocr_image,
            open_default_apps,
            take_pending_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running PDFreader");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let base = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("target")
            .join("test-tmp");
        let directory = base.join(format!("pdfreader-test-{label}-{nonce}"));
        fs::create_dir_all(&directory).expect("create test dir");
        directory
    }

    const MINIMAL_PDF: &[u8] = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";

    #[test]
    fn reads_a_pdf_from_disk() {
        let directory = temp_dir("read");
        let file = directory.join("sample.pdf");
        fs::write(&file, MINIMAL_PDF).unwrap();
        let bytes = read_pdf_bytes(file.to_string_lossy().to_string()).expect("read pdf");
        assert_eq!(bytes, MINIMAL_PDF);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_non_pdf_and_missing_files() {
        let directory = temp_dir("reject");
        let text_file = directory.join("notes.txt");
        fs::write(&text_file, b"hello").unwrap();
        assert!(read_pdf_bytes(text_file.to_string_lossy().to_string()).is_err());
        assert!(read_pdf_bytes(directory.join("missing.pdf").to_string_lossy().to_string()).is_err());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn writes_and_replaces_an_export_atomically() {
        let directory = temp_dir("write");
        let target = directory.join("annotated.pdf");
        write_file(
            target.to_string_lossy().to_string(),
            b"%PDF-first".to_vec(),
        )
        .expect("first write");
        assert_eq!(fs::read(&target).unwrap(), b"%PDF-first");
        write_file(
            target.to_string_lossy().to_string(),
            b"%PDF-second".to_vec(),
        )
        .expect("replacement write");
        assert_eq!(fs::read(&target).unwrap(), b"%PDF-second");
        let leftovers: Vec<_> = fs::read_dir(&directory)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                name.starts_with(".pdfreader-save-")
            })
            .collect();
        assert!(leftovers.is_empty(), "temporary or backup files were left behind");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_unsafe_export_extensions() {
        let directory = temp_dir("extension");
        let target = directory.join("payload.exe");
        assert!(write_file(target.to_string_lossy().to_string(), vec![1, 2, 3]).is_err());
        let _ = fs::remove_dir_all(directory);
    }
}
