use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use image::ImageFormat;
use pdfium_render::prelude::{
    PdfDocument, PdfRenderConfig, Pdfium, PdfiumError, PdfiumLibraryBindings,
};
use serde::Serialize;

static PDFIUM_ENGINE: OnceLock<Result<Mutex<Pdfium>, String>> = OnceLock::new();

const BUNDLED_PDFIUM_VERSION: &str = "8138";

#[derive(Debug, Serialize)]
pub struct NativePdfInfo {
    pub page_count: usize,
    pub engine: &'static str,
    pub engine_version: &'static str,
}

pub fn resolve_pdfium_dll(app: Option<&tauri::AppHandle>) -> Option<PathBuf> {
    use tauri::Manager;

    if let Some(explicit) = std::env::var_os("PDFIUM_DLL_PATH") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let candidates = [
                resource_dir.join("resources/pdfium/bin/pdfium.dll"),
                resource_dir.join("pdfium/bin/pdfium.dll"),
                resource_dir.join("bin/pdfium.dll"),
                resource_dir.join("pdfium.dll"),
            ];
            for candidate in candidates {
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    // Development/test fallback. Release builds resolve the bundled resource
    // before this path, which does not exist on another machine.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/pdfium/bin/pdfium.dll");
    dev.is_file().then_some(dev)
}

fn bind_pdfium(dll: &Path) -> Result<Pdfium, PdfiumError> {
    let bindings: Box<dyn PdfiumLibraryBindings> = Pdfium::bind_to_library(dll)?;
    Ok(Pdfium::new(bindings))
}

fn engine(app: Option<&tauri::AppHandle>) -> Result<&'static Mutex<Pdfium>, String> {
    PDFIUM_ENGINE
        .get_or_init(|| {
            let dll = resolve_pdfium_dll(app).ok_or_else(|| {
                "PDFium runtime was not found. Reinstall PDFreader or set PDFIUM_DLL_PATH."
                    .to_string()
            })?;
            let pdfium =
                bind_pdfium(&dll).map_err(|error| format!("Could not load PDFium: {error}"))?;
            Ok(Mutex::new(pdfium))
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn with_pdfium<T>(
    app: Option<&tauri::AppHandle>,
    operation: impl FnOnce(&Pdfium) -> Result<T, PdfiumError>,
) -> Result<T, String> {
    let pdfium = engine(app)?;
    let guard = pdfium
        .lock()
        .map_err(|_| "The native PDF engine lock was poisoned.".to_string())?;
    operation(&guard).map_err(|error| format!("PDFium: {error}"))
}

fn open_document<'a>(
    pdfium: &'a Pdfium,
    path: &Path,
    password: Option<&str>,
) -> Result<PdfDocument<'a>, PdfiumError> {
    pdfium.load_pdf_from_file(path, password)
}

pub fn page_count(
    app: Option<&tauri::AppHandle>,
    path: &Path,
    password: Option<&str>,
) -> Result<NativePdfInfo, String> {
    with_pdfium(app, |pdfium| {
        let document = open_document(pdfium, path, password)?;
        Ok(NativePdfInfo {
            page_count: document.pages().len() as usize,
            engine: "PDFium",
            engine_version: BUNDLED_PDFIUM_VERSION,
        })
    })
}

/// Render one page (1-based) to PNG bytes using the native PDFium engine.
pub fn render_page_png(
    app: Option<&tauri::AppHandle>,
    path: &Path,
    page_number: u16,
    target_width: u32,
    password: Option<&str>,
) -> Result<Vec<u8>, String> {
    if page_number == 0 {
        return Err("Page numbers start at 1.".to_string());
    }
    if !(32..=8192).contains(&target_width) {
        return Err("Render width must be between 32 and 8192 pixels.".to_string());
    }
    with_pdfium(app, |pdfium| {
        let document = open_document(pdfium, path, password)?;
        let pages = document.pages();
        if page_number as usize > pages.len() as usize {
            return Err(PdfiumError::PageIndexOutOfBounds);
        }
        let page = pages.get((page_number - 1) as i32)?;
        let config = PdfRenderConfig::new().set_target_width(target_width as i32);
        let bitmap = page.render_with_config(&config)?;
        let image = bitmap.as_image()?;
        let mut cursor = Cursor::new(Vec::<u8>::new());
        image
            .write_to(&mut cursor, ImageFormat::Png)
            .map_err(|_| PdfiumError::PdfiumLibraryInternalError(
                pdfium_render::prelude::PdfiumInternalError::Unknown,
            ))?;
        Ok(cursor.into_inner())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("native-sample.pdf")
    }

    #[test]
    fn pdfium_native_engine_reads_page_count() {
        let info = page_count(None, &fixture(), None).expect("PDFium should read the fixture");
        assert_eq!(info.page_count, 2);
        assert_eq!(info.engine, "PDFium");
    }

    #[test]
    fn pdfium_native_engine_renders_png() {
        let png = render_page_png(None, &fixture(), 1, 400, None).expect("PDFium should render");
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
        assert!(png.len() > 1_000);
    }

    #[test]
    fn pdfium_rejects_out_of_range_page() {
        assert!(render_page_png(None, &fixture(), 9, 400, None).is_err());
    }
}
