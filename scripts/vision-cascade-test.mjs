/**
 * Cascata de visão — pelo caminho real, via ponte oc:ask.
 *
 * As funções do painel vivem num módulo ES e não são acessíveis pelo
 * Runtime.evaluate, então o teste não as chama: injeta o pedido pela mesma
 * ponte que o menu de pre-prompts usa e observa o resultado no servidor.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = resolve(process.argv[2] || 'extension');
const API = 'http://127.0.0.1:4177';
const H = { Authorization: 'Basic ' + Buffer.from('opencode:testefixo123').toString('base64'), 'Content-Type': 'application/json' };

const CDP_PORT = 9882;
const profile = mkdtempSync(join(tmpdir(), 'brave-vis-'));
const WORK = mkdtempSync(join(tmpdir(), 'oc-vis-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

// modelo de texto (sem visao não é o critério, só precisa ser diferente) e o de visão
const TEXTO = { providerID: 'kilo1', id: 'stepfun/step-3.7-flash:free', variant: 'medium' };
const VISAO = { providerID: 'kilo4', id: 'stepfun/step-5-preview-free', variant: 'low' };

const SITE = 8582;
const site = createServer((_, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end('<!DOCTYPE html><meta charset=utf-8><h1>alvo</h1>'); });
await new Promise((r) => site.listen(SITE, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1200,950',
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
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expr) => {
    const e = Array.isArray(expr) ? expr.join('') : String(expr);
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  return { ready, send, evaluate, errors };
}

let pageUrl = null;
for (let i = 0; i < 50; i++) {
  await sleep(1000);
  try {
    const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const t = l.find((x) => x.type === 'page' && x.url.includes(String(SITE)));
    if (t) { pageUrl = t.webSocketDebuggerUrl; break; }
  } catch { /* sobe */ }
}
if (!pageUrl) { console.log('pagina nao apareceu'); process.exit(1); }

const P = attach(pageUrl);
await P.ready;
await P.send('Runtime.enable');
await sleep(2500);
{ const r = await P.send('Target.getTargets'); const o = (r.result?.targetInfos || []).find((t) => /options\.html/.test(t.url)); if (o) await P.send('Target.closeTarget', { targetId: o.targetId }).catch(() => {}); await sleep(1200); }

let pt = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => /panel\.html/.test(t.url));
if (!pt) { console.log('painel nao encontrado'); process.exit(1); }
const Q = attach(pt.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await sleep(2000);

await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => {
  const cfg = v.cfg || {};
  cfg.directory = ${JSON.stringify(WORK)};
  cfg.model = ${JSON.stringify(TEXTO)};
  cfg.modelLabel = 'texto';
  cfg.visionModel = ${JSON.stringify(VISAO)};
  cfg.visionLabel = 'visao';
  cfg.useSameVisionModel = false;
  chrome.storage.local.set({ cfg }, () => r(true));
}))`);
await sleep(1500);

await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(5000);

// imagem de verdade: faixa verde com texto, como um "tela"
const jpg = await Q.evaluate(`(async () => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 300;
  const g = c.getContext('2d');
  g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, 400, 300);
  g.fillStyle = '#fff'; g.font = 'bold 54px sans-serif';
  g.fillText('MARCA-77', 60, 170);
  return c.toDataURL('image/jpeg', .9);
})()`);

// ponte real: o que o menu de pre-prompts usa
const pedir = (prompt, files) => Q.evaluate(
  "window.postMessage({ type: 'oc:ask', payload: { prompt: " + JSON.stringify(prompt) +
  ", newSession: true, files: " + JSON.stringify(files) + " } }, '*'); 1");

// ---------- 1. texto puro: nada de sessão de visão
console.log('\n== texto puro (nao deve cascata) ==');
const antes1 = (await (await fetch(`${API}/api/session?limit=30&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || [];
console.log(`  sessoes antes: ${antes1.length}`);
await pedir('Diga apenas: ok', []);
await sleep(12000);
const depois1 = (await (await fetch(`${API}/api/session?limit=30&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || [];
console.log(`  sessoes depois: ${depois1.length}`);
add('texto puro cria só uma sessão', depois1.length === antes1.length + 1, `${antes1.length} -> ${depois1.length}`);

// ---------- 2. com imagem: cascata
console.log('\n== com imagem (deve cascata) ==');
const antes2 = (await (await fetch(`${API}/api/session?limit=30&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || [];
console.log(`  sessoes antes: ${antes2.length}`);
await pedir('O que esta escrito na tela? Responda so o que leu.', [{ uri: jpg, name: 'tela.jpg', mime: 'image/jpeg' }]);
console.log('  pedido enviado, esperando a cascata...');

let principal = null;
for (let i = 0; i < 70; i++) {
  await sleep(2500);
  const sids = await Q.evaluate("document.getElementById('sessionPicker').value");
  if (!sids) continue;
  const msgs = await (await fetch(`${API}/api/session/${sids}/message?limit=20&order=asc`, { headers: H })).json();
  const user = (msgs.data || []).filter((m) => m.type === 'user').pop();
  const txt = user?.payload?.text || user?.text || '';
  if (txt.includes('O que esta escrito na tela?')) {
    principal = { txt, files: user?.payload?.files || [], id: user.id };
    break;
  }
  if (i % 8 === 0) console.log(`  ${(i + 1) * 2.5}s…`);
}

if (!principal) {
  add('modelo de texto recebeu o prompt', false, 'nunca chegou');
} else {
  console.log('  prompt:', JSON.stringify(principal.txt.slice(0, 200)));
  add('modelo de texto recebeu o prompt', true);
  add('a pergunta do usuário está no prompt', principal.txt.includes('O que esta escrito na tela?'));
  add('veio com a descrição do modelo de visão',
    principal.txt.includes('Outro modelo, com visão, descreveu a imagem'), JSON.stringify(principal.txt.slice(0, 100)));
  add('a descrição menciona o conteúdo da imagem',
    /MARCA-77|azul|faixa/i.test(principal.txt), JSON.stringify(principal.txt.slice(-200)));
  add('a imagem NAO foi anexada ao modelo de texto',
    (principal.files || []).length === 0, `${(principal.files || []).length} anexos`);
}

// a sessão da visão existe na hora, mas é encerrada no fim
const fim = (await (await fetch(`${API}/api/session?limit=30&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || [];
console.log(`  sessoes no fim: ${fim.length}`);
add('a sessão do modelo de visão foi encerrada', fim.length === antes2.length + 1, `${antes2.length} -> ${fim.length}`);

// o painel mostrou o que estava fazendo
const atividade = await Q.evaluate("document.querySelector('.live-activity .doing')?.textContent || ''");
console.log('  atividade agora:', atividade);

const qErrs = Q.errors.filter((e) => e && !/favicon/.test(e));
if (qErrs.length) console.log('  erros:', JSON.stringify(qErrs.slice(0, 3)));
add('painel sem erro de console', qErrs.length === 0, qErrs.slice(0, 1).join(''));

try { proc.kill(); } catch {}
await sleep(600); site.close();
for (const s of fim) await fetch(`${API}/api/session/${s.id}`, { method: 'DELETE', headers: H }).catch(() => {});
try { rmSync(WORK, { recursive: true, force: true }); } catch {}
try { rmSync(profile, { recursive: true, force: true }); } catch {}

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) failed.forEach(([n]) => console.log('  FALHOU: ' + n));
else console.log('TUDO OK');
process.exit(failed.length ? 1 : 0);