/**
 * Os modos de agente e o rotulo do modelo.
 *
 * Dois modos de falha que existiam:
 *  1. o rotulo do modelo mostrava "[object Object]" - um objeto era jogado em
 *     textContent em vez do nome;
 *  2. o modo escolhido (plan/build/orchestrator) nao sobrevivia: o loadSession
 *     sobrescrevia `cfg.agent` com o modo da sessao, entao a escolha do
 *     usuario era apagada a cada troca de conversa.
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
const H = {
  Authorization: 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64'),
  'Content-Type': 'application/json'
};

const SITE = 8855;
const CDP = 9855;
const profile = mkdtempSync(join(tmpdir(), 'brave-agente-'));
const WORK = mkdtempSync(join(tmpdir(), 'oc-agente-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => {
  checks.push([n, !!c, x]);
  console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`);
};

const site = createServer((_, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end('<!DOCTYPE html><meta charset="utf-8"><title>alvo</title>');
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
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description || '');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
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
  return { ws, ready, send, evaluate, errors };
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
if (!pageT) { console.log('sem aba de teste'); process.exit(1); }

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

const panelT = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json())
  .find((t) => /panel\.html/.test(t.url));
if (!panelT) { console.log('painel nao encontrado'); process.exit(1); }
const Q = attach(panelT.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await Q.send('Page.enable');
await sleep(2000);

const cfgLido = () => Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => r(v.cfg || null)))`);
const rotulo = () => Q.evaluate(`document.getElementById('modelLabel').textContent`);
const agente = () => Q.evaluate(`document.getElementById('agentPicker').value`);

// =============================================== 1. rótulo do modelo
console.log('\n== 1. o rótulo do modelo ==');
// modelo salvo no storage, com o rótulo junto
await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => {
  const cfg = v.cfg || {};
  cfg.directory = ${JSON.stringify(WORK)};
  cfg.model = { providerID: 'opencode', id: 'space-bunny-free' };
  cfg.modelLabel = 'Space Bunny Free';
  cfg.agent = 'build';
  chrome.storage.local.set({ cfg }, () => r(true));
}))`);
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(5000);

const rot = await rotulo();
console.log('  rótulo:', JSON.stringify(rot));
add('o rótulo mostra o nome, não "object"',
  !!rot && rot.length > 0 && rot !== '[object Object]' && rot !== 'undefined' && rot !== 'null', rot);

// =============================================== 2. trocar o agente salva
console.log('\n== 2. trocar o modo de agente ==');
await Q.evaluate(`(() => {
  const s = document.getElementById('agentPicker');
  s.value = 'orchestrator';
  s.dispatchEvent(new Event('change'));
  return true;
})()`);
await sleep(1200);

const cfgDepois = await cfgLido();
const agenteDepois = await agente();
console.log('  seletor:', agenteDepois, '| storage:', JSON.stringify(cfgDepois?.agent));
add('o modo escolhido aparece no seletor', agenteDepois === 'orchestrator', agenteDepois);
add('o modo escolhido foi para o storage', cfgDepois?.agent === 'orchestrator', JSON.stringify(cfgDepois?.agent));
add('o modelo não se perdeu ao salvar o agente',
  cfgDepois?.model?.id === 'space-bunny-free', JSON.stringify(cfgDepois?.model));
add('o rótulo não se perdeu ao salvar o agente',
  cfgDepois?.modelLabel === 'Space Bunny Free', JSON.stringify(cfgDepois?.modelLabel));

// =============================================== 3. sessão antiga não apaga a escolha
console.log('\n== 3. abrir uma sessão antiga não apaga a escolha ==');
{
  const s = await (await fetch(`${API}/api/session`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ location: { directory: WORK }, agent: 'plan' })
  })).json();
  if (s?.data?.id) {
    globalThis.__sessaoAntiga = s.data.id;
    await fetch(`${API}/api/session/${s.data.id}/message?limit=5`, { headers: H }).catch(() => {});
  }
}
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(1800);
await Q.evaluate(`document.querySelectorAll('#bar button, #bar select').forEach((b) => (b.style.pointerEvents = ''))`);
await sleep(600);

const sessoes = (await (await fetch(`${API}/api/session?limit=10&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || [];
const antiga = sessoes.find((s) => !s.parentID);
let trocou = null;
if (antiga) {
  trocou = await Q.evaluate(`(() => {
    const p = document.getElementById('sessionPicker');
    const o = [...p.options].find((x) => x.value === ${JSON.stringify(antiga.id)});
    if (!o) return { ok: false };
    p.value = o.value;
    p.dispatchEvent(new Event('change'));
    return { ok: true, id: o.value };
  })()`);
}
console.log('  trocou para:', JSON.stringify(trocou));
await sleep(4000);

const cfgCarregou = await cfgLido();
console.log('  agente no storage após carregar sessão:', JSON.stringify(cfgCarregou?.agent));
add('a escolha do usuário sobreviveu à troca de sessão',
  cfgCarregou?.agent === 'orchestrator', JSON.stringify(cfgCarregou?.agent));

// =============================================== 4. a sessão antiga mantém o agente dela
console.log('\n== 4. a sessão antiga mantém o agente dela ==');
let agenteNoServidor = null;
if (antiga) {
  const info = await (await fetch(`${API}/api/session/${antiga.id}`, { headers: H })).json();
  agenteNoServidor = info?.data?.agent;
}
console.log('  agente da sessão no servidor:', agenteNoServidor);
add('a sessão antiga não foi contaminada', agenteNoServidor === 'plan', String(agenteNoServidor));

// =============================================== 5. limpeza
{
  const lista = (await (await fetch(`${API}/api/session?limit=10&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || [];
  for (const s of lista) await fetch(`${API}/api/session/${s.id}`, { method: 'DELETE', headers: H }).catch(() => {});
}

const pErrs = P.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
const qErrs = Q.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
add('página sem erro de console', pErrs.length === 0, pErrs.slice(0, 2).join(' | '));
add('painel sem erro de console', qErrs.length === 0, qErrs.slice(0, 2).join(' | '));

try { proc.kill(); } catch { /* ok */ }
await sleep(800); site.close();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* lock */ }
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* lock */ }

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) { failed.forEach(([n]) => console.log('  FALHOU: ' + n)); process.exit(1); }
console.log('TUDO OK');
process.exit(0);
