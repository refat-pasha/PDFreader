// Interaction smoke test through Chrome DevTools Protocol.
// Usage: node scripts/ui-actions.mjs <url>
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CDP = "http://127.0.0.1:9222";
const url = process.argv[2] ?? "http://127.0.0.1:1420";
const downloadDir = "tests/.artifacts/downloads";
rmSync(downloadDir, { recursive: true, force: true });
mkdirSync(downloadDir, { recursive: true });

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    const events = [];
    socket.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++nextId;
            pending.set(id, { res, rej });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        events,
        close: () => socket.close(),
      });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { res, rej } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rej(new Error(JSON.stringify(message.error)));
        else res(message.result);
      } else if (message.method) events.push(message);
    };
    socket.onerror = reject;
  });
}

const targets = await (await fetch(`${CDP}/json`)).json();
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("No page target.");
const cdp = await connect(target.webSocketDebuggerUrl);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evalJs = async (expression) => {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Evaluation failed");
  return result.result.value;
};

try {
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir }).catch(() => undefined);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1560,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Page.navigate", { url });
  await wait(4500);

  const checks = {};
  checks.initial = await evalJs(`(() => ({
    panes: document.querySelectorAll('.pane').length,
    canvases: document.querySelectorAll('canvas.page-canvas').length,
    status: document.querySelector('.statusbar')?.innerText.replace(/\\s+/g, ' '),
    pageRect: (() => { const r = document.querySelector('.page-shell')?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,width:r.width,height:r.height} : null })()
  }))()`);

  await evalJs(`document.querySelector('[aria-label="Pen"]')?.click()`);
  await wait(300);
  checks.paletteOpen = await evalJs(`!!document.querySelector('.floating-palette')`);

  const rect = checks.initial.pageRect;
  const points = [
    { x: rect.x + rect.width * 0.25, y: rect.y + rect.height * 0.32 },
    { x: rect.x + rect.width * 0.42, y: rect.y + rect.height * 0.36 },
    { x: rect.x + rect.width * 0.58, y: rect.y + rect.height * 0.31 },
  ];
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: points[0].x, y: points[0].y, button: "left", clickCount: 1 });
  for (const point of points.slice(1)) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "left", buttons: 1 });
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: points[2].x, y: points[2].y, button: "left", clickCount: 1 });
  await wait(500);
  checks.afterDraw = await evalJs(`(() => ({
    markup: document.querySelector('.statusbar')?.innerText.match(/(\\d+) markup/)?.[1],
    paths: document.querySelectorAll('.page-annotation-layer path').length
  }))()`);

  // Eraser must remove a mark on click, not just select it.
  await evalJs(`document.querySelector('[aria-label="Eraser"]')?.click()`);
  await wait(200);
  await evalJs(`(() => {
    const hit = document.querySelector('.page-annotation-layer rect[style*="pointer-events"]');
    const rect = hit?.getBoundingClientRect();
    if (!hit || !rect) return false;
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 77 }));
    return true;
  })()`);
  await wait(400);
  checks.afterErase = await evalJs(`(() => ({
    markup: document.querySelector('.statusbar')?.innerText.match(/(\\d+) markup/)?.[1]
  }))()`);

  await evalJs(`document.querySelector('[aria-label="Select"]')?.click()`);
  await wait(300);
  checks.textLayer = await evalJs(`(() => ({
    spans: document.querySelectorAll('.page-text-layer span').length,
    selectable: getComputedStyle(document.querySelector('.page-text-layer')).userSelect
  }))()`);
  await evalJs(`(() => {
    const spans = [...document.querySelectorAll('.page-text-layer span')].filter(s => s.textContent.trim()).slice(0, 4);
    if (spans.length < 2) return false;
    const range = document.createRange();
    range.setStart(spans[0].firstChild, 0);
    range.setEnd(spans[spans.length - 1].firstChild, spans[spans.length - 1].textContent.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('.page-text-layer').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return selection.toString().trim().length > 0;
  })()`);
  await wait(400);
  checks.selectionToolbar = await evalJs(`(() => ({
    visible: !!document.querySelector('.selection-toolbar'),
    selected: window.getSelection()?.toString().trim().slice(0, 80)
  }))()`);
  const selectionShot = await cdp.send("Page.captureScreenshot", { format: "png" });
  const selectionPath = "tests/.artifacts/selection-toolbar.png";
  mkdirSync(dirname(selectionPath), { recursive: true });
  writeFileSync(selectionPath, Buffer.from(selectionShot.data, "base64"));
  await evalJs(`document.querySelector('.selection-action')?.click()`);
  await wait(500);
  checks.afterHighlight = await evalJs(`(() => ({
    markup: document.querySelector('.statusbar')?.innerText.match(/(\\d+) markup/)?.[1],
    highlightRects: document.querySelectorAll('.page-annotation-layer rect[fill]').length
  }))()`);
  const highlightShot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("tests/.artifacts/highlighted.png", Buffer.from(highlightShot.data, "base64"));

  await evalJs(`(() => {
    const spans = [...document.querySelectorAll('.page-text-layer span')].filter(s => s.textContent.trim()).slice(0, 3);
    if (spans.length < 2) return false;
    const range = document.createRange();
    range.setStart(spans[0].firstChild, 0);
    range.setEnd(spans[spans.length - 1].firstChild, spans[spans.length - 1].textContent.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('.page-text-layer').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  })()`);
  await wait(400);
  await evalJs(`[...document.querySelectorAll('.selection-action')].find(button => button.textContent.includes('Quote'))?.click()`);
  await wait(600);
  checks.quoteNote = await evalJs(`(() => ({
    panel: !!document.querySelector('.notes-panel'),
    body: document.querySelector('.notes-panel .note-editor')?.value ?? "",
    title: document.querySelector('.notes-panel .note-title-input')?.value ?? ""
  }))()`);

  await evalJs(`document.querySelector('[aria-label="Search document"]')?.click()`);
  await wait(300);
  await evalJs(`(() => {
    const input = document.querySelector('.search-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'quiet');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.form.requestSubmit();
  })()`);
  await wait(1600);
  checks.search = await evalJs(`(() => ({
    results: document.querySelectorAll('.search-result').length,
    panel: !!document.querySelector('.search-input')
  }))()`);
  await evalJs(`document.querySelector('.search-result')?.click()`);
  await wait(900);
  checks.searchHighlights = await evalJs(`document.querySelectorAll('.page-text-layer span.search-hit').length`);

  await evalJs(`document.querySelector('[aria-label="Split pane"]')?.click()`);
  await wait(1800);
  checks.afterSplit = await evalJs(`(() => ({
    panes: document.querySelectorAll('.pane').length,
    canvases: document.querySelectorAll('canvas.page-canvas').length,
    pageInputs: document.querySelectorAll('.pane-page-box').length,
    dividers: document.querySelectorAll('.pane-divider').length,
    widths: [...document.querySelectorAll('.pane-wrapper')].map(el => Math.round(el.getBoundingClientRect().width))
  }))()`);
  await evalJs(`(() => {
    const divider = document.querySelector('.pane-divider');
    divider.focus();
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  })()`);
  await wait(500);
  checks.afterResize = await evalJs(`(() => ({
    widths: [...document.querySelectorAll('.pane-wrapper')].map(el => Math.round(el.getBoundingClientRect().width)),
    value: document.querySelector('.pane-divider')?.getAttribute('aria-valuenow')
  }))()`);

  await evalJs(`document.querySelector('.app-menubar [aria-label="Notes"]')?.click()`);
  await wait(500);
  checks.notes = await evalJs(`(() => ({
    panel: !!document.querySelector('.notes-panel'),
    editor: !!document.querySelector('.notes-panel textarea.note-editor'),
    title: document.querySelector('.notes-panel .note-title-input')?.value
  }))()`);
  await evalJs(`document.querySelector('[aria-label="Export all notes as Markdown"]')?.click()`);
  await wait(700);
  checks.noteExport = await evalJs(`([...document.querySelectorAll('.toast')].map(t => t.innerText).find(text => text.includes('notebook')) ?? '')`);

  await evalJs(`document.querySelector('.app-menubar [aria-label="Export"]')?.click()`);
  await wait(500);
  checks.exportModal = await evalJs(`(() => ({
    modal: !!document.querySelector('#export-title'),
    formats: document.querySelectorAll('.format-card').length
  }))()`);
  await evalJs(`(() => { const buttons=[...document.querySelectorAll('.format-card')]; buttons.find(b=>b.innerText.includes('Markdown'))?.click(); })()`);
  await wait(200);
  await evalJs(`document.querySelector('.modal-footer .button-primary')?.click()`);
  await wait(3500);
  checks.afterExport = await evalJs(`(() => ({
    modalStillOpen: !!document.querySelector('#export-title'),
    toasts: [...document.querySelectorAll('.toast')].map(t=>t.innerText)
  }))()`);
  checks.downloads = existsSync(downloadDir) ? readdirSync(downloadDir) : [];

  await evalJs(`document.querySelector('[aria-label="Close export dialog"]')?.click()`);
  await wait(300);

  await evalJs(`document.querySelector('.app-menubar [aria-label="Export"]')?.click()`);
  await wait(400);
  checks.modalFocus = await evalJs(`!!document.activeElement?.closest('.modal')`);
  checks.modalRole = await evalJs(`document.querySelector('#export-title')?.closest('.modal')?.getAttribute('role')`);
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(400);
  checks.escapeClosed = await evalJs(`!document.querySelector('#export-title')`);

  await evalJs(`document.querySelector('[aria-label="Recent files"]')?.click()`);
  await wait(300);
  checks.recentMenu = await evalJs(`(() => ({
    open: !!document.querySelector('.recent-menu'),
    empty: document.querySelector('.recent-empty')?.textContent?.trim() ?? ""
  }))()`);
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  console.log(JSON.stringify(checks, null, 2));
  const passed =
    checks.initial.canvases === 1 &&
    checks.paletteOpen === true &&
    Number(checks.afterDraw.markup) >= 1 &&
    Number(checks.afterErase.markup) < Number(checks.afterDraw.markup) &&
    checks.textLayer.spans > 0 &&
    checks.textLayer.selectable === "text" &&
    checks.selectionToolbar.visible === true &&
    Number(checks.afterHighlight.markup) > Number(checks.afterDraw.markup) &&
    checks.search.results > 0 &&
    checks.searchHighlights > 0 &&
    checks.quoteNote.panel === true &&
    checks.quoteNote.body.includes("PDFreader") &&
    checks.afterSplit.panes === 2 &&
    checks.afterSplit.canvases === 2 &&
    checks.afterSplit.dividers === 1 &&
    checks.afterResize.widths[0] > checks.afterSplit.widths[0] &&
    Number(checks.afterResize.value) > 50 &&
    checks.notes.panel === true &&
    checks.noteExport.length > 0 &&
    checks.exportModal.modal === true &&
    checks.modalFocus === true &&
    checks.modalRole === "dialog" &&
    checks.escapeClosed === true &&
    checks.recentMenu.open === true;
  process.exitCode = passed ? 0 : 1;
} finally {
  cdp.close();
}
