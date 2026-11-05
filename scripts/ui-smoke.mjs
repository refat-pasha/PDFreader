// UI smoke test: drives an already-running Chrome with --remote-debugging-port=9222.
// Usage: node scripts/ui-smoke.mjs <url> <screenshot-path>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CDP = "http://127.0.0.1:9222";
const url = process.argv[2] ?? "http://127.0.0.1:1420";
const screenshot = process.argv[3] ?? "tests/.artifacts/app.png";
const clean = process.argv.includes("--clean");

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
      } else if (message.method) {
        events.push(message);
      }
    };
    socket.onerror = reject;
  });
}

async function findPageTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${CDP}/json`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("No Chrome page target became available on port 9222.");
}

const target = await findPageTarget();
const cdp = await connect(target.webSocketDebuggerUrl);

try {
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1560,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Page.navigate", { url });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  if (clean) {
    await cdp.send("Runtime.evaluate", { expression: "localStorage.clear()" });
    await cdp.send("Page.reload", { ignoreCache: true });
  }
  await new Promise((resolve) => setTimeout(resolve, 6000));

  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(() => ({
      title: document.title,
      panes: document.querySelectorAll('.pane').length,
      tabs: document.querySelectorAll('.tab').length,
      canvases: document.querySelectorAll('canvas.page-canvas').length,
      textSpans: document.querySelectorAll('.page-text-layer span').length,
      pageLoading: document.querySelectorAll('.page-loading').length,
      toolButtons: document.querySelectorAll('.tool-button').length,
      sidebar: !!document.querySelector('.sidebar'),
      status: document.querySelector('.statusbar')?.innerText?.replace(/\\s+/g, ' ').trim(),
      boot: !!document.querySelector('.boot-screen'),
      bodyText: document.body.innerText.slice(0, 400)
    }))()`,
    returnByValue: true,
    awaitPromise: false,
  });

  const errors = cdp.events
    .filter(
      (message) =>
        message.method === "Runtime.exceptionThrown" ||
        (message.method === "Log.entryAdded" && message.params?.entry?.level === "error"),
    )
    .map((message) =>
      message.method === "Runtime.exceptionThrown"
        ? message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text
        : `${message.params.entry.text} ${message.params.entry.url ?? ""}`.trim(),
    );

  mkdirSync(dirname(screenshot), { recursive: true });
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(screenshot, Buffer.from(shot.data, "base64"));

  console.log(JSON.stringify({ url, screenshot, state: evaluation.result.value, errors }, null, 2));
  process.exitCode = errors.length ? 1 : 0;
} finally {
  cdp.close();
}
