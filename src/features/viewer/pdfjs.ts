import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type LoadedPdf = {
  pdf: PDFDocumentProxy;
  /** Raw bytes retained only when export/persistence needs them. */
  bytes?: Uint8Array;
  cleanup: () => Promise<void>;
};

const loadingTasks = new Map<string, Promise<LoadedPdf>>();
const passwordCache = new Map<string, string>();
const fingerprintCache = new WeakMap<Uint8Array, string>();

export type PasswordProvider = (label: string, incorrect: boolean) => Promise<string | null>;
let passwordProvider: PasswordProvider | null = null;

/** The desktop shell installs this so encrypted PDFs can ask for a password. */
export function setPasswordProvider(provider: PasswordProvider | null): void {
  passwordProvider = provider;
}

/** Stable, cheap identity for password reuse across re-loads of the same bytes. */
function fingerprintBytes(bytes: Uint8Array): string {
  const cached = fingerprintCache.get(bytes);
  if (cached) return cached;
  let hash = 0x811c9dc5;
  const step = Math.max(1, Math.floor(bytes.length / 65536));
  for (let index = 0; index < bytes.length; index += step) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= bytes.length;
  const value = (hash >>> 0).toString(36);
  fingerprintCache.set(bytes, value);
  return value;
}

export async function loadPdf(
  key: string,
  getBytes: () => Promise<Uint8Array>,
  options: { retainBytes?: boolean; label?: string } = {},
): Promise<LoadedPdf> {
  const existing = loadingTasks.get(key);
  if (existing) return existing;

  const task = (async () => {
    const bytes = await getBytes();
    const fingerprint = fingerprintBytes(bytes);
    let suppliedPassword: string | null = null;
    // PDF.js transfers the buffer to its worker, which detaches the caller's view.
    // Keep the original bytes intact for export/recovery and give the worker its own copy.
    const workerBytes = bytes.slice();
    const loadingTask = pdfjsLib.getDocument({
      data: workerBytes,
      useWorkerFetch: false,
      disableFontFace: false,
      cMapPacked: true,
    });
    loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      if (reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD) {
        passwordCache.delete(fingerprint);
      }
      const cached = passwordCache.get(fingerprint);
      if (cached) {
        suppliedPassword = cached;
        updatePassword(cached);
        return;
      }
      if (!passwordProvider) {
        void loadingTask.destroy();
        return;
      }
      void passwordProvider(
        options.label ?? "this PDF",
        reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD,
      )
        .then((password) => {
          if (password === null) {
            void loadingTask.destroy();
            return;
          }
          suppliedPassword = password;
          updatePassword(password);
        })
        .catch(() => {
          void loadingTask.destroy();
        });
    };
    const pdf = await loadingTask.promise;
    if (suppliedPassword) passwordCache.set(fingerprint, suppliedPassword);
    return {
      pdf,
      bytes: options.retainBytes ? bytes : undefined,
      cleanup: async () => {
        loadingTasks.delete(key);
        await loadingTask.destroy();
      },
    };
  })();

  loadingTasks.set(key, task);
  try {
    return await task;
  } catch (error) {
    loadingTasks.delete(key);
    throw error;
  }
}

export function releasePdf(key: string): void {
  const pending = loadingTasks.get(key);
  if (!pending) return;
  loadingTasks.delete(key);
  void pending
    .then((loaded) => loaded.cleanup())
    .catch(() => undefined);
}

type PendingRender = {
  task: { cancel: () => void; promise: Promise<void> };
  settled: Promise<void>;
};

const pendingByCanvas = new WeakMap<HTMLCanvasElement, PendingRender>();

export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation: number,
  registerTask?: (cancel: () => void) => void,
): Promise<void> {
  // PDF.js allows only one render per canvas. A cancelled render is not finished
  // until its promise settles, so a replacement render must wait for it.
  const previous = pendingByCanvas.get(canvas);
  if (previous) {
    try {
      previous.task.cancel();
    } catch {
      // The previous render may already have completed.
    }
    await previous.settled.catch(() => undefined);
  }

  const viewport = page.getViewport({ scale, rotation });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();

  if (previous) pendingByCanvas.delete(canvas);
  const task = page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  } as never);
  const entry: PendingRender = {
    task: task as unknown as PendingRender["task"],
    settled: task.promise.then(
      () => undefined,
      () => undefined,
    ),
  };
  pendingByCanvas.set(canvas, entry);
  registerTask?.(() => {
    try {
      task.cancel();
    } catch {
      // A completed task cannot be cancelled; this is expected during fast navigation.
    }
  });
  try {
    await task.promise;
  } finally {
    if (pendingByCanvas.get(canvas) === entry) pendingByCanvas.delete(canvas);
  }
}

export type SimpleTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function extractPageText(
  page: PDFPageProxy,
): Promise<{ text: string; items: SimpleTextItem[] }> {
  const content = await page.getTextContent();
  const items: SimpleTextItem[] = [];
  const lines: string[] = [];
  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const item = raw as {
      str: string;
      transform: number[];
      width: number;
      height: number;
    };
    if (!item.str) continue;
    items.push({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      height: item.height || Math.abs(item.transform[3]),
    });
    lines.push(item.str);
  }
  return { text: lines.join(" ").replace(/\s+/g, " ").trim(), items };
}

export function getPageSize(page: PDFPageProxy, rotation = 0): { width: number; height: number } {
  const viewport = page.getViewport({ scale: 1, rotation });
  return { width: viewport.width, height: viewport.height };
}

/**
 * Build the selectable/accessible text layer above a page canvas.
 * Returns a cancellation function for rapid page or zoom changes.
 */
export async function renderTextLayer(
  page: PDFPageProxy,
  container: HTMLElement,
  scale: number,
  rotation: number,
): Promise<() => void> {
  const viewport = page.getViewport({ scale, rotation });
  const textContent = await page.getTextContent();
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container,
    viewport,
  });
  await textLayer.render();
  return () => textLayer.cancel();
}

export { pdfjsLib };
export type { PDFDocumentProxy, PDFPageProxy };
