/**
 * Modelo padrão:
 *  1. sem cfg.model, abrir o painel pergunta o modelo
 *  2. escolher guarda e reaproveita
 *  3. com modelo salvo, abrir de novo não pergunta
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
// caminho absoluto: o Chromium ignora --load-extension relativo em silêncio
const EXT = resolve(process.argv[2] || 'extension');
const API = 'http://127.0.0.1:4177';
const PW = 'testefixo123';
const H = { Authorization: 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64') };

const SITE_PORT = 8394;
const CDP_PORT = 9548;
const profile = mkdtempSync(join(tmpdir(), 'brave-model-'));
const WORK = mkdtempSync(join(tmpdir(), 'oc-model-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

const site = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!DOCTYPE html><meta charset="utf-8"><h1>alvo</h1>'); });
await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1100,900',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  `http://127.0.0.1:${SITE_PORT}/`
], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 45; i++) {
  await sleep(1000);
  try {
    targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    if (targets.some((t) => t.type === 'page' && t.url.includes(String(SITE_PORT)))) break;
  } catch { /* subindo */ }
}
const pageT = targets.find((t) => t.type === 'page' && t.url.includes(String(SITE_PORT)));
if (!pageT) {
  console.log('FALHA: nenhuma aba de teste. URLs vistas:');
  for (const t of targets) console.log(`  ${t.type}  ${t.url}`);
  console.log(`(extensao: ${EXT})`);
  try { proc.kill(); } catch { /* ok */ }
  site.close();
  process.exit(1);
}

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
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  return { ws, ready, send, evaluate, errors };
}

const P = attach(pageT.webSocketDebuggerUrl);
await P.ready;
await P.send('Runtime.enable');
await sleep(3000);

let panelT = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => /panel\.html/.test(t.url));
if (!panelT) { console.log('painel nao encontrado'); process.exit(1); }
const Q = attach(panelT.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await sleep(2500);

// só o diretório: modelo é o que estamos testando
await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => {
  const cfg = v.cfg || {};
  cfg.directory = ${JSON.stringify(WORK)};
  // limpa o modelo de proposito: sem isso o DEFAULTS ja traz o [K4] e a
  // primeira vez nunca pergunta - que e justamente o comportamento novo
  cfg.model = null;
  cfg.modelLabel = '';
  chrome.storage.local.set({ cfg }, () => r(true));
}))`);
await sleep(1500);

const cfgAntes = await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => r(v.cfg?.model ?? null)))`);
console.log('modelo antes de qualquer uso:', JSON.stringify(cfgAntes));
add('perfil novo começa sem modelo', cfgAntes === null, JSON.stringify(cfgAntes));

const clicar = () => P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);

// ---------- 1. primeira vez pergunta
console.log('\n== 1. primeira vez ==');
await clicar();
await sleep(5000);

const modal = await Q.evaluate(`(() => ({
  aberto: !document.getElementById('modal').hidden,
  titulo: document.getElementById('modalTitle').textContent,
  linhas: document.querySelectorAll('#modalList .row').length,
  rotuloBotao: document.getElementById('modelLabel').textContent
}))()`);
console.log('  modal:', JSON.stringify(modal));
add('modal de modelo abriu sozinho', modal.aberto === true, JSON.stringify(modal).slice(0, 120));
add('modal lista modelos', modal.linhas > 5, `${modal.linhas} linhas`);
add('botao mostra "escolher modelo"', /escolher modelo/i.test(modal.rotuloBotao), modal.rotuloBotao);

// ---------- 2. escolher guarda
console.log('\n== 2. escolher e guardar ==');
const escolhido = await Q.evaluate(`(() => {
  const alvo = [...document.querySelectorAll('#modalList .row')]
    .find(r => /space bunny free/i.test(r.textContent));
  if (!alvo) return { ok: false, linhas: document.querySelectorAll('#modalList .row').length };
  const nome = alvo.querySelector('.t').textContent;
  alvo.click();
  return { ok: true, nome };
})()`);
console.log('  escolhido:', JSON.stringify(escolhido));
add('modelo pode ser escolhido na lista', escolhido.ok === true, JSON.stringify(escolhido));

// na pergunta automática não pode vir modal de variante
await sleep(1200);
const variantModal = await Q.evaluate(`(() => ({
  aberto: !document.getElementById('modal').hidden,
  titulo: document.getElementById('modalTitle').textContent
}))()`);
console.log('  modal seguinte:', JSON.stringify(variantModal));
add('pergunta automatica nao empilha modal de variante',
  variantModal.aberto === false || !/variante/i.test(variantModal.titulo || ''),
  JSON.stringify(variantModal));

await sleep(3000);
const depois = await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => r({
  model: v.cfg?.model ?? null, label: v.cfg?.modelLabel ?? null
})))`);
console.log('  salvo:', JSON.stringify(depois));
add('escolha foi para o storage', !!depois.model, JSON.stringify(depois).slice(0, 120));
add('rotulo do botao virou o nome do modelo',
  depois.label && depois.label === escolhido.nome, `${depois.label} vs ${escolhido.nome}`);
add('modal fechou depois de escolher',
  (await Q.evaluate(`document.getElementById('modal').hidden`)) === true);

// a sessão criada precisa ter recebido o modelo
const sessao = await Q.evaluate(`document.getElementById('sessionPicker').value`);
if (sessao) {
  const info = await (await fetch(`${API}/api/session/${sessao}`, { headers: H })).json();
  console.log('  modelo na sessao:', JSON.stringify(info?.data?.model));
  add('sessao nasceu com o modelo escolhido',
    info?.data?.model?.id === depois.model?.id, JSON.stringify(info?.data?.model));
}

// ---------- 3. segunda vez nao pergunta
console.log('\n== 3. de novo nao pergunta ==');
await clicar();   // fecha
await sleep(1200);
await clicar();   // abre
await sleep(5000);

const segunda = await Q.evaluate(`(() => ({
  modalAberto: !document.getElementById('modal').hidden,
  rotulo: document.getElementById('modelLabel').textContent,
  status: document.getElementById('status').textContent
}))()`);
console.log('  2a abertura:', JSON.stringify(segunda));
add('com modelo salvo o modal nao abre', segunda.modalAberto === false, JSON.stringify(segunda));
add('rotulo continua o modelo escolhido', segunda.rotulo === escolhido.nome, segunda.rotulo);

// ---------- 4. trocar de modelo
console.log('\n== 4. trocar de modelo ==');
await Q.evaluate(`document.getElementById('modelBtn').click()`);
await sleep(2500);
const trocou = await Q.evaluate(`(() => {
  const linhas = [...document.querySelectorAll('#modalList .row')];
  const outro = linhas.find(r => !r.classList.contains('active') && r.querySelector('.t'));
  if (!outro) return { ok: false, linhas: linhas.length };
  const nome = outro.querySelector('.t').textContent;
  outro.click();
  return { ok: true, nome };
})()`);
// no botão manual a variante ainda é perguntada; responde se aparecer
await sleep(1200);
const precisouVariante = await Q.evaluate(`(() => {
  if (document.getElementById('modal').hidden) return false;
  if (!/variante/i.test(document.getElementById('modalTitle').textContent)) return false;
  document.querySelector('#modalList .row')?.click();
  return true;
})()`);
if (precisouVariante) console.log('  (modal de variante respondido)');
await sleep(3500);
const cfgFinal = await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => r(v.cfg?.modelLabel ?? null)))`);
console.log('  trocou para:', JSON.stringify(trocou), '| salvo:', cfgFinal);
add('trocar de modelo atualiza o padrao', trocou.ok && cfgFinal === trocou.nome, `${cfgFinal} vs ${trocou.nome}`);

const qErrs = Q.errors.filter((e) => e && !/favicon/.test(e));
if (qErrs.length) console.log('\nerros do painel:', JSON.stringify(qErrs.slice(0, 3)));
add('painel sem erro', qErrs.length === 0, qErrs.slice(0, 1).join(''));

try { proc.kill(); } catch { /* ok */ }
await sleep(600); site.close();
for (const d of [WORK]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* lock */ } }

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) failed.forEach(([n]) => console.log('  FALHOU: ' + n));
else console.log('TUDO OK');
process.exit(failed.length ? 1 : 0);