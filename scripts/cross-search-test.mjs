// Cross-document search verification via CDP.
import { resolve } from "node:path";

const CDP = "http://127.0.0.1:9222";
const url = process.argv[2] ?? "http://127.0.0.1:4173";
const fixture = resolve("tests/fixtures/native-sample.pdf");

function connect(wsUrl) {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    socket.onopen = () =>
      resolvePromise({
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
  await cdp.send("DOM.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1560, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url });
  await wait(5000);
  await evalJs(`localStorage.clear()`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await wait(5000);

  const documentNode = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const inputNode = await cdp.send("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector: 'input[type="file"][accept*="pdf"]',
  });
  if (!inputNode.nodeId) throw new Error("PDF file input not found.");
  await cdp.send("DOM.setFileInputFiles", { nodeId: inputNode.nodeId, files: [fixture] });
  await wait(2500);

  const afterOpen = await evalJs(`(() => ({
    tabs: document.querySelectorAll('.tab').length,
    title: document.querySelector('.tab[aria-selected="true"] .tab-name')?.textContent
  }))()`);
  await evalJs(`document.querySelector('[aria-label="Search document"]')?.click()`);
  await wait(300);
  await evalJs(`[...document.querySelectorAll('.search-scope-button')].find(button => button.textContent.includes('All open'))?.click()`);
  await evalJs(`(() => {
    const input = document.querySelector('.search-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'fixture');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.form.requestSubmit();
  })()`);
  await wait(2000);
  const results = await evalJs(`(() => ({
    count: document.querySelectorAll('.search-result').length,
    first: document.querySelector('.search-result')?.innerText,
    allScope: [...document.querySelectorAll('.search-scope-button')].find(b => b.textContent.includes('All open'))?.getAttribute('aria-pressed')
  }))()`);
  await evalJs(`document.querySelector('.search-result')?.click()`);
  await wait(1200);
  const jumped = await evalJs(`document.querySelector('[aria-selected="true"] .tab-name')?.textContent`);
  console.log(JSON.stringify({ afterOpen, results, jumped }, null, 2));
  process.exitCode = afterOpen.tabs === 2 && results.count === 2 && results.allScope === "true" && jumped === "native-sample.pdf" ? 0 : 1;
} finally {
  cdp.close();
}
