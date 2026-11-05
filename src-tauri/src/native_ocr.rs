//! OCR through the Windows built-in OCR engine. This gives desktop users a
//! zero-install OCR path; Tesseract remains available as an optional override.
//!
//! WinRT OCR is sensitive to repeated engine creation. All requests are routed
//! to one dedicated thread that owns a single OcrEngine for the process.
#![cfg(windows)]

use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;
use std::time::Duration;

use windows::Graphics::Imaging::BitmapDecoder;
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::core::HSTRING;

enum Request {
    Available(Sender<bool>),
    Recognize(Vec<u8>, Sender<Result<String, String>>),
}

static OCR_QUEUE: OnceLock<Sender<Request>> = OnceLock::new();

fn queue() -> &'static Sender<Request> {
    OCR_QUEUE.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Request>();
        std::thread::Builder::new()
            .name("pdfreader-windows-ocr".to_string())
            .spawn(move || {
                unsafe {
                    let _ = RoInitialize(RO_INIT_MULTITHREADED);
                }
                let engine = OcrEngine::TryCreateFromUserProfileLanguages().ok();
                while let Ok(request) = rx.recv() {
                    match request {
                        Request::Available(reply) => {
                            let _ = reply.send(engine.is_some());
                        }
                        Request::Recognize(bytes, reply) => {
                            let result = match &engine {
                                Some(engine) => pollster::block_on(recognize_png_async(engine, &bytes)),
                                None => Err("Windows OCR has no installed language.".to_string()),
                            };
                            let _ = reply.send(result);
                        }
                    }
                }
            })
            .expect("spawn Windows OCR worker");
        tx
    })
}

pub fn available() -> bool {
    let (reply, receiver) = mpsc::channel();
    if queue().send(Request::Available(reply)).is_err() {
        return false;
    }
    receiver.recv_timeout(Duration::from_secs(5)).unwrap_or(false)
}

/// Recognize text from a PNG buffer using the Windows OCR engine.
pub fn recognize_png(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Ok(String::new());
    }
    let (reply, receiver) = mpsc::channel();
    queue()
        .send(Request::Recognize(bytes.to_vec(), reply))
        .map_err(|_| "Windows OCR worker is unavailable.".to_string())?;
    receiver
        .recv_timeout(Duration::from_secs(120))
        .map_err(|_| "Windows OCR timed out.".to_string())?
}

async fn recognize_png_async(engine: &OcrEngine, bytes: &[u8]) -> Result<String, String> {
    let stream = InMemoryRandomAccessStream::new().map_err(|error| error.to_string())?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(|error| error.to_string())?;
    writer.WriteBytes(bytes).map_err(|error| error.to_string())?;
    writer.StoreAsync().map_err(|error| error.to_string())?.await.map_err(|error| error.to_string())?;
    writer.FlushAsync().map_err(|error| error.to_string())?.await.map_err(|error| error.to_string())?;
    writer.DetachStream().map_err(|error| error.to_string())?;
    stream.Seek(0).map_err(|error| error.to_string())?;

    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|error| error.to_string())?
        .await
        .map_err(|error| error.to_string())?;
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|error| error.to_string())?
        .await
        .map_err(|error| error.to_string())?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|error| error.to_string())?
        .await
        .map_err(|error| error.to_string())?;
    let text: HSTRING = result.Text().map_err(|error| error.to_string())?;
    Ok(text.to_string().trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_ocr_is_available_with_an_installed_language() {
        assert!(available(), "Windows OCR needs an installed OCR language");
    }

    #[test]
    fn windows_ocr_reads_a_png_image() {
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("ocr-sample.png");
        let png = std::fs::read(fixture).expect("read OCR fixture");
        let text = recognize_png(&png).expect("Windows OCR");
        assert!(
            text.to_lowercase().contains("fixture") || text.to_lowercase().contains("pdfium"),
            "unexpected OCR output: {text:?}"
        );
    }
}
