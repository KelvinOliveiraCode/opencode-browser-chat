/** Carrega a extensão no Brave e reporta se o manifesto foi aceito. */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = process.argv[2];
const SITE = 8477;
const CDP = 9623;
const profile = mkdtempSync(join(tmpdir(), 'brave-load-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const site = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!DOCTYPE html><meta charset="utf-8"><h1>alvo</h1><p id="alvo">texto</p>'); });
await new Promise((r) => site.listen(SITE, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  `http://127.0.0.1:${SITE}/`
], { stdio: 'ignore' });

let list = [];
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  try { list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); if (list.length) break; } catch { /* subindo */ }
}

const page = list.find((t) => t.type === 'page' && t.url.includes(String(SITE)));
console.log('CDP ok:', !!page, '| alvos:', list.length);
console.log('extensao em /json/list:', list.filter((t) => /chrome-extension/.test(t.url)).map((t) => t.url).slice(0, 3));

await sleep(3000);
let ok = false;
if (page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const errs = [];
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  });
  let id = 0; const pend = new Map();
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await send('Runtime.enable');
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const h = document.getElementById('oc-host'); return h ? { host: true, shadow: !!h.shadowRoot, bubble: !!h.shadowRoot?.querySelector('.oc-bubble'), panel: !!h.shadowRoot?.querySelector('iframe') } : { host: false }; })()`,
    returnByValue: true
  });
  ok = r.result?.result?.value;
  console.log('content script:', JSON.stringify(ok));
  console.log('erros JS:', JSON.stringify(errs.filter((e) => !/favicon/.test(e)).slice(0, 3)));
  ws.close();
}

try { proc.kill(); } catch { /* ok */ }
await sleep(600); site.close();
console.log(ok?.host ? 'CARREGOU OK' : 'FALHOU AO CARREGAR');
process.exit(ok?.host ? 0 : 1);