// Password-protected PDF flow verification via CDP.
import { resolve } from "node:path";

const CDP = "http://127.0.0.1:9222";
const url = process.argv[2] ?? "http://127.0.0.1:4173";
const fixture = resolve("tests/fixtures/encrypted-sample.pdf");

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

const submitPassword = async (password) => {
  await evalJs(`(() => {
    const input = document.querySelector('.password-dialog input[type="password"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(password)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.form.requestSubmit();
    return true;
  })()`);
};

try {
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1560, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url });
  await wait(4500);
  await evalJs(`localStorage.clear()`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await wait(4500);

  const documentNode = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const inputNode = await cdp.send("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector: 'input[type="file"][accept*="pdf"]',
  });
  if (!inputNode.nodeId) throw new Error("PDF file input not found.");
  await cdp.send("DOM.setFileInputFiles", { nodeId: inputNode.nodeId, files: [fixture] });
  await wait(2200);

  const prompt = await evalJs(`(() => ({
    visible: !!document.querySelector('.password-dialog'),
    title: document.querySelector('#password-title')?.textContent,
    label: document.querySelector('.password-dialog .modal-description')?.textContent
  }))()`);

  await submitPassword("wrong-password");
  await wait(1800);
  const retry = await evalJs(`(() => ({
    visible: !!document.querySelector('.password-dialog'),
    incorrect: document.querySelector('.form-error')?.textContent ?? ""
  }))()`);

  await submitPassword("readerpass");
  await wait(3500);
  const unlocked = await evalJs(`(() => ({
    dialog: !!document.querySelector('.password-dialog'),
    tab: document.querySelector('.tab[aria-selected="true"] .tab-name')?.textContent,
    canvas: !!document.querySelector('canvas.page-canvas'),
    pageInput: document.querySelector('.pane-page-box')?.value
  }))()`);
  console.log(JSON.stringify({ prompt, retry, unlocked }, null, 2));
  process.exitCode =
    prompt.visible && prompt.title === "Password required" &&
    retry.visible && retry.incorrect.includes("not accepted") &&
    !unlocked.dialog && unlocked.tab === "encrypted-sample.pdf" && unlocked.canvas
      ? 0
      : 1;
} finally {
  cdp.close();
}
