import { invoke, isTauri } from "@tauri-apps/api/core";

export type NativePdfInfo = {
  page_count: number;
  engine: string;
  engine_version: string;
};

export function nativePdfAvailable(): boolean {
  return isTauri();
}

export async function nativePageCount(path: string): Promise<number | null> {
  if (!nativePdfAvailable() || !path) return null;
  try {
    const info = await invoke<NativePdfInfo>("native_pdf_info", { path });
    return info.page_count;
  } catch {
    return null;
  }
}

export async function renderNativePagePng(
  path: string,
  pageNumber: number,
  targetWidth: number,
): Promise<Uint8Array | null> {
  if (!nativePdfAvailable() || !path) return null;
  try {
    const data = await invoke<ArrayBuffer | number[]>("render_pdf_page_png", {
      path,
      page: pageNumber,
      targetWidth,
    });
    return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
  } catch {
    return null;
  }
}
