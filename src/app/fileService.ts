import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DocumentMeta, ExportOptions } from "../types";
import { createDemoPdf } from "../data/demo";
import { makeId } from "../features/annotate/model";

const browserFiles = new Map<string, Uint8Array>();
const pathToDocId = new Map<string, string>();
const docToPath = new Map<string, string>();
const demoBytes = new Map<string, Uint8Array>();

export function isDesktop(): boolean {
  return isTauri();
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function guessType(bytes: Uint8Array): string {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }
  return "application/octet-stream";
}

async function readBrowserFile(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return bytes;
}

export async function openFromSystem(): Promise<
  Array<{ path: string; name: string; bytes: Uint8Array }>
> {  if (isDesktop()) {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: "PDF documents", extensions: ["pdf"] }],
    });
    if (!selected) return [];
    const paths = Array.isArray(selected) ? selected : [selected];
    const results = [];
    for (const path of paths) {
      const data = await invoke<ArrayBuffer | number[]>("read_file", { path });
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
      results.push({ path, name: basename(path), bytes });
    }
    return results;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.multiple = true;
    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      const results = [];
      for (const file of files) {
        results.push({ path: file.name, name: file.name, bytes: await readBrowserFile(file) });
      }
      resolve(results);
    });
    input.click();
  });
}

export async function openPathFromSystem(path: string): Promise<{ path: string; name: string; bytes: Uint8Array }> {
  if (!isDesktop()) throw new Error("Recent local files are available in the desktop app.");
  const data = await invoke<ArrayBuffer | number[]>("read_file", { path });
  return { path, name: basename(path), bytes: data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data) };
}

export async function loadDemoPdf(): Promise<{ path: string; name: string; bytes: Uint8Array }> {
  if (!demoBytes.has("demo")) {
    demoBytes.set("demo", await createDemoPdf());
  }
  return {
    path: "pdfreader://welcome",
    name: "A quieter way to read.pdf",
    bytes: demoBytes.get("demo")!,
  };
}

export function registerDocument(
  path: string,
  name: string,
  bytes: Uint8Array,
  pageCount: number,
): DocumentMeta {
  const canonical = path || `untitled-${Date.now()}.pdf`;
  const existingId = pathToDocId.get(canonical);
  const id = existingId ?? makeId("doc");
  pathToDocId.set(canonical, id);
  docToPath.set(id, canonical);
  browserFiles.set(id, bytes);
  return {
    id,
    name,
    path: canonical.startsWith("pdfreader://") ? undefined : canonical,
    pageCount,
    size: bytes.byteLength,
    source: canonical.startsWith("pdfreader://") ? "demo" : isDesktop() ? "local" : "browser",
    openedAt: Date.now(),
  };
}

export async function getDocumentBytes(docId: string): Promise<Uint8Array> {
  const cached = browserFiles.get(docId);
  if (cached) return cached;
  const path = docToPath.get(docId);
  if (!path) throw new Error("The document is no longer available.");
  if (path.startsWith("pdfreader://")) {
    const bytes = demoBytes.get("demo");
    if (!bytes) throw new Error("The demonstration PDF is unavailable.");
    return bytes;
  }
  if (isDesktop()) {
    const data = await invoke<ArrayBuffer | number[]>("read_file", { path });
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
    browserFiles.set(docId, bytes);
    return bytes;
  }
  throw new Error("Open the file again; browser storage does not retain it.");
}

export async function writeExport(
  bytes: Uint8Array,
  defaultName: string,
  mime: string,
): Promise<string | null> {
  if (isDesktop()) {
    const destination = await saveDialog({
      defaultPath: defaultName,
      filters: filtersForName(defaultName),
    });
    if (!destination) return null;
    await invoke("write_file", { path: destination, data: Array.from(bytes) });
    return destination;
  }
  const blob = new Blob([toBlobPart(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = defaultName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return defaultName;
}

export async function writeBlob(blob: Blob, defaultName: string): Promise<string | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return writeExport(bytes, defaultName, blob.type || "application/octet-stream");
}

export function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function writeTextFile(text: string, defaultName: string): Promise<string | null> {
  const bytes = new TextEncoder().encode(text);
  return writeExport(bytes, defaultName, "text/plain;charset=utf-8");
}

export async function writePdfBytes(bytes: Uint8Array, suggestedName: string): Promise<string | null> {
  return writeExport(bytes, suggestedName, "application/pdf");
}

function filtersForName(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return [{ name: "PDF document", extensions: ["pdf"] }];
  if (ext === "docx") return [{ name: "Word document", extensions: ["docx"] }];
  if (ext === "md") return [{ name: "Markdown", extensions: ["md"] }];
  if (ext === "txt") return [{ name: "Text", extensions: ["txt"] }];
  if (ext === "png") return [{ name: "PNG image", extensions: ["png"] }];
  if (ext === "zip") return [{ name: "ZIP archive", extensions: ["zip"] }];
  return [{ name: "All files", extensions: ["*"] }];
}

export async function openPathsFromNative(
  onPaths: (paths: string[]) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => {};
  const unlisten = await listen<string[]>("open-paths", (event) => {
    if (Array.isArray(event.payload)) onPaths(event.payload);
  });
  // Startup and single-instance paths are queued natively. Drain after the
  // listener exists so a fast launch cannot lose the file association event.
  try {
    const pending = await invoke<string[]>("take_pending_paths");
    if (Array.isArray(pending) && pending.length > 0) onPaths(pending);
  } catch {
    // The command is unavailable in browser preview builds.
  }
  return unlisten;
}

export function fileSize(bytes: Uint8Array): number {
  return bytes.byteLength;
}

export function typeOfBytes(bytes: Uint8Array): string {
  return guessType(bytes);
}
