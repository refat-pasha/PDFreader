// Session-recovery smoke test through Chrome DevTools Protocol.
import { mkdirSync, writeFileSync } from "node:fs";

const CDP = "http://127.0.0.1:9222";
const url = process.argv[2] ?? "http://127.0.0.1:4173";

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    socket.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++nextId;
            pending.set(id, { res, rej });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => socket.close(),
      });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { res, rej } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? rej(new Error(JSON.stringify(message.error))) : res(message.result);
      }
    };
    socket.onerror = reject;
  });
}

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("No page target.");
const cdp = await connect(page.webSocketDebuggerUrl);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evalJs = async (expression) => {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Evaluation failed");
  return result.result.value;
};

try {
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1560, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url });
  await wait(5000);

  const before = await evalJs(`(() => ({
    page: document.querySelector('.pane-page-box')?.value,
    tabs: document.querySelectorAll('.tab').length,
    markup: document.querySelector('.statusbar')?.innerText.match(/(\\d+) markup/)?.[1]
  }))()`);

  const addBookmark = async (label) => {
    await evalJs(`document.querySelector('[aria-label="Page bookmarks"]')?.click()`);
    await wait(200);
    await evalJs(`(() => {
      const input = document.querySelector('.bookmark-form input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(label)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.form.requestSubmit();
    })()`);
    await wait(300);
  };
  await addBookmark("Start");
  await evalJs(`document.querySelector('[aria-label="Next page"]')?.click()`);
  await wait(1200);
  await addBookmark("Details");
  await wait(1200);
  const changed = await evalJs(`document.querySelector('.pane-page-box')?.value`);
  await wait(1200); // persistence debounce + flush
  await cdp.send("Page.reload", { ignoreCache: true });
  await wait(6000);
  await evalJs(`document.querySelector('[aria-label="Page bookmarks"]')?.click()`);
  await wait(400);
  const restored = await evalJs(`(() => ({
    page: document.querySelector('.pane-page-box')?.value,
    tabs: document.querySelectorAll('.tab').length,
    markup: document.querySelector('.statusbar')?.innerText.match(/(\\d+) markup/)?.[1],
    boot: !!document.querySelector('.boot-screen'),
    bookmarks: [...document.querySelectorAll('.bookmark-jump')].map(el => el.innerText.replace(/\\s+/g, ' ').trim())
  }))()`);
  await evalJs(`document.querySelector('.bookmark-jump')?.click()`);
  await wait(600);
  const bookmarkJump = await evalJs(`document.querySelector('.pane-page-box')?.value`);

  mkdirSync("tests/.artifacts", { recursive: true });
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("tests/.artifacts/session-restored.png", Buffer.from(shot.data, "base64"));
  console.log(JSON.stringify({ before, changed, restored, bookmarkJump }, null, 2));
  process.exitCode =
    changed === "2" &&
    restored.page === "2" &&
    restored.tabs === before.tabs &&
    restored.boot === false &&
    restored.bookmarks.length === 2 &&
    restored.bookmarks[0].includes("Start") &&
    bookmarkJump === "1"
      ? 0
      : 1;
} finally {
  cdp.close();
}
