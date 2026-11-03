/**
 * Diagnóstico: por que o balão do usuário não aparece no thread?
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = resolve(process.argv[2] || 'extension');
const API = 'http://127.0.0.1:4177';
const PW = 'testefixo123';
const H = { Authorization: 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64'), 'Content-Type': 'application/json' };

const SITE = 8844;
const CDP = 9844;
const profile = mkdtempSync(join(tmpdir(), 'brave-dbg3-'));
const WORK = mkdtempSync(join(tmpdir(), 'oc-dbg3-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const site = createServer((_, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end('<!DOCTYPE html><meta charset="utf-8"><h1>alvo</h1><p id="alvo">Texto para selecionar e testar o menu de pre-prompts.</p>');
});
await new Promise((r) => site.listen(SITE, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1100,900',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  `http://127.0.0.1:${SITE}/`
], { stdio: 'ignore' });

function attach(url) {
  const ws = new WebSocket(url);
  let id = 0; const pending = new Map(); const errors = []; const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || '');
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  return { ws, ready, send, evaluate, errors, logs };
}

let pageT = null;
for (let i = 0; i < 45; i++) {
  await sleep(1000);
  try {
    const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    pageT = l.find((t) => t.type === 'page' && t.url.includes(String(SITE)));
    if (pageT) break;
  } catch { /* subindo */ }
}
if (!pageT) { console.log('sem aba'); process.exit(1); }

const P = attach(pageT.webSocketDebuggerUrl);
await P.ready;
await P.send('Runtime.enable');
await P.send('Page.enable');
await sleep(3000);
{
  const r = await P.send('Target.getTargets');
  const o = (r.result?.targetInfos || []).find((t) => /options\.html/.test(t.url));
  if (o) { await P.send('Target.closeTarget', { targetId: o.targetId }).catch(() => {}); await sleep(1200); }
  await P.send('Page.bringToFront').catch(() => {});
  await sleep(800);
}

const panelT = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => /panel\.html/.test(t.url));
if (!panelT) { console.log('painel nao encontrado'); process.exit(1); }
const Q = attach(panelT.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await Q.send('Page.enable');
await sleep(2000);

// abre o painel primeiro
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(4000);

// NÃO abre o painel de propósito: é assim que o teste falha. O pre-prompt
// precisa trazer o painel consigo.
console.log('== painel fechado, enviando pre-prompt pela ponte ==');

const pedir = (prompt) => P.evaluate(`(() => {
  const frame = document.getElementById('oc-host').shadowRoot.querySelector('iframe');
  const oc = new URL(frame.src).searchParams.get('oc');
  frame.contentWindow.postMessage({ oc, type: 'oc:ask', payload: { prompt: ${JSON.stringify(prompt)}, newSession: true, files: [] } }, new URL(frame.src).origin);
  return 1;
})()`);

await pedir('Ola, diga apenas: oi');
await sleep(12000);

// re-localiza a aba da pagina: depois de fechar a aba de opcoes e dar
// bringToFront, o alvo preso antes pode ter saido de foco
const pageT2 = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json())
  .find((t) => t.type === 'page' && t.url.includes(String(SITE)));
console.log('  aba da pagina agora:', pageT2?.url);
console.log('  era a mesma aba?', pageT2?.webSocketDebuggerUrl === pageT.webSocketDebuggerUrl);

const P2 = attach(pageT2.webSocketDebuggerUrl);
await P2.ready;
const temHost = await P2.evaluate(`!!document.getElementById('oc-host')`);
console.log('  #oc-host existe na aba atual?', temHost);

const estado = await Q.evaluate(`(() => {
  const t = document.getElementById('thread');
  const root = document.getElementById('oc-host')?.shadowRoot;
  return {
    msgs: t.querySelectorAll(':scope > .msg').length,
    classes: [...t.querySelectorAll(':scope > .msg')].map((m) => m.className),
    userTexto: (t.querySelector('.msg-user .bubble')?.innerText || '').slice(0, 120),
    assistenteTexto: (t.querySelector('.msg-assistant .bubble')?.innerText || '').slice(0, 120),
    status: document.getElementById('status').textContent,
    sessionPicker: document.getElementById('sessionPicker').value,
    painelAberto: root ? root.querySelector('.oc-panel').classList.contains('is-open') : 'sem host',
    input: document.getElementById('input').value
  };
})()`);
console.log('  estado:', JSON.stringify(estado, null, 1));

// quantas sessões existem no WORK?
const sessoes = (await (await fetch(`${API}/api/session?limit=10&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || [];
console.log('  sessoes no WORK:', sessoes.filter((s) => !s.parentID).length);
for (const s of sessoes.filter((x) => !x.parentID).slice(0, 2)) {
  const msgs = (await (await fetch(`${API}/api/session/${s.id}/message?limit=10&order=asc`, { headers: H })).json()).data || [];
  console.log(`    sessao ${s.id.slice(0, 20)}: ${msgs.map((m) => m.type).join(',')}`);
  for (const m of msgs.filter((x) => x.type === 'user')) {
    console.log('      texto:', (m.payload?.text || m.text || '').slice(0, 90).replace(/\n/g, ' '));
  }
}

// o SSE está conectado?
const sseOk = await Q.evaluate(`document.getElementById('status').textContent`);
console.log('  status do painel:', sseOk);

console.log('\n  console do painel:', JSON.stringify(Q.logs.slice(0, 12)));
console.log('  erros do painel:', JSON.stringify(Q.errors.slice(0, 5)));

try { proc.kill(); } catch { /* ok */ }
await sleep(800); site.close();
for (const s of sessoes) await fetch(`${API}/api/session/${s.id}`, { method: 'DELETE', headers: H }).catch(() => {});
try { rmSync(profile, { recursive: true, force: true }); } catch { /* lock */ }
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* lock */ }
process.exit(0);
