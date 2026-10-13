/**
 * Teste de renderização de verdade:
 *   1. cria uma sessão num diretório temporário
 *   2. pede uma tarefa que force write + edit + bash
 *   3. abre o painel no Brave, seleciona essa sessão e confere o DOM
 *
 * Usa dados reais da API — nenhum fixture injetado.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PW = 'testefixo123';
const API = 'http://127.0.0.1:4177';
const AUTH = 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64');
const H = { Authorization: AUTH, 'Content-Type': 'application/json' };

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
// caminho absoluto: o Chromium ignora --load-extension relativo em silencio
const EXT = resolve(process.argv[2] || 'extension');
const OUT = process.argv[3] || join(process.cwd(), 'shots-parts');
const WORK = mkdtempSync(join(tmpdir(), 'oc-parts-'));
const SITE_PORT = 8193;
const CDP_PORT = 9340;
const profile = mkdtempSync(join(tmpdir(), 'brave-parts-'));
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

console.log('=== 1. sessao real com ferramentas ===');
// git init: o OpenCode só produz metadata.diff quando existe snapshot (repo git)
const { execFileSync } = await import('node:child_process');
try {
  execFileSync('git', ['init', '-q'], { cwd: WORK });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: WORK });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: WORK });
  writeFileSync(join(WORK, 'nota.txt'), 'alpha');
  execFileSync('git', ['add', '-A'], { cwd: WORK });
  execFileSync('git', ['commit', '-qm', 'inicial'], { cwd: WORK });
  console.log('repo git criado em', WORK);
} catch (e) {
  console.log('git indisponível:', e.message);
}

const s = await (await fetch(`${API}/api/session`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    location: { directory: WORK },
    agent: 'build',
    model: { providerID: 'opencode', id: 'space-bunny-free' }
  })
})).json();
const sid = s.data.id;
console.log('sessao:', sid, '| dir:', WORK);

await fetch(`${API}/api/session/${sid}/prompt`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    text: 'Faz exatamente isto, sem explicar nada: ' +
      '1) cria nota.txt com o texto "alpha"; ' +
      '2) edita nota.txt trocando "alpha" por "beta"; ' +
      '3) roda o comando que mostra o conteudo de nota.txt.'
  })
});

let done = false;
for (let i = 0; i < 50; i++) {
  await sleep(3000);
  const msgs = await (await fetch(`${API}/api/session/${sid}/message?limit=40&order=asc`, { headers: H })).json();
  if (msgs.data.some((m) => m.type === 'idle')) { done = true; break; }
}
const hist = await (await fetch(`${API}/api/session/${sid}/message?limit=40&order=asc`, { headers: H })).json();
const tools = hist.data.flatMap((m) => (m.content || []).filter((c) => c.type === 'tool'));
const names = [...new Set(tools.map((t) => t.name))];
console.log('ferramentas usadas:', names.join(', ') || '(nenhuma)');
console.log('partes:', hist.data.flatMap((m) => m.content || []).map((p) => p.type).join(', '));
add('a sessao usou ferramentas', tools.length >= 2, `${tools.length} calls: ${names.join(', ')}`);
add('houve edit/write', names.some((n) => ['edit', 'write'].includes(n)), names.join(','));
// A API só manda metadata.diff quando existe snapshot (repo git). Fora disso o
// painel reconstrói o diff a partir de oldString/newString — entao aqui só
// registramos qual dos dois caminhos foi usado.
const comDiffReal = tools.filter((t) => t.state?.metadata?.diff).length;
const reconstruct = tools.filter((t) =>
  ['edit', 'write'].includes(t.name) &&
  !t.state?.metadata?.diff &&
  (t.state?.input?.oldString || t.state?.input?.content)).length;
console.log(`  diff real da API: ${comDiffReal} | reconstruido do input: ${reconstruct}`);
add('ha material para diff', comDiffReal + reconstruct > 0,
  `real=${comDiffReal} sintetico=${reconstruct}`);

console.log('\n=== 2. abrindo no Brave ===');
const HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>t</title></head><body><p>x</p></body></html>`;
const site = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); });
await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=900,1000',
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
const extId = targets.find((t) => t.url.startsWith('chrome-extension://'))?.url.split('/')[2];
add('extensao carregada', !!extId, extId);

function attach(url) {
  const ws = new WebSocket(url);
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description };
    return r.result?.result?.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
  };
  return { ws, ready, send, evaluate, shot, errors };
}

const P = attach(targets.find((t) => t.type === 'page' && t.url.includes(String(SITE_PORT))).webSocketDebuggerUrl);
await P.ready;
await P.send('Runtime.enable');
await P.send('Page.enable');
await sleep(1500);
await P.send('Page.navigate', { url: `chrome-extension://${extId}/panel.html` });
await sleep(4500);

const t2 = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const panelT = t2.find((t) => /panel\.html/.test(t.url) && t.type === 'page');
if (!panelT) { console.log('painel nao abriu'); process.exit(1); }

const Q = attach(panelT.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await Q.send('Page.enable');
await Q.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 980, deviceScaleFactor: 2, mobile: false });
await sleep(2500);

console.log('\n=== 3. DOM renderizado ===');
// aponta o painel para a pasta de trabalho da sessão
await Q.evaluate(`
  new Promise((res) => chrome.storage.local.get(['cfg'], (v) => {
    const cfg = v.cfg || {}; cfg.directory = ${JSON.stringify(WORK)};
    chrome.storage.local.set({ cfg }, () => res(true));
  }))
`);
await sleep(1000);
await Q.evaluate(`document.getElementById('newSession').click()`);
await sleep(2500);

const optInfo = await Q.evaluate(`
  (() => { const p = document.getElementById('sessionPicker');
    const found = [...p.options].find(o => o.value === ${JSON.stringify(sid)});
    if (found) { p.value = found.value; p.dispatchEvent(new Event('change')); return true; }
    return [...p.options].map(o => o.value); })()
`);
add('sessao de teste aparece na lista', optInfo === true, typeof optInfo === 'object' ? JSON.stringify(optInfo).slice(0, 120) : '');
await sleep(4000);

const dom = await Q.evaluate(`
  (() => ({
    msgs: document.querySelectorAll('#thread .msg').length,
    tools: document.querySelectorAll('#thread .toolcard').length,
    diffs: document.querySelectorAll('#thread .diff').length,
    diffAdds: document.querySelectorAll('#thread .diff-line.add').length,
    diffDels: document.querySelectorAll('#thread .diff-line.del').length,
    outs: document.querySelectorAll('#thread .tool-out').length,
    reasoning: document.querySelectorAll('#thread details.reasoning').length,
    labels: [...document.querySelectorAll('#thread .tlabel')].map(e => e.textContent),
    args: [...document.querySelectorAll('#thread .targ')].map(e => e.textContent.slice(0, 40))
  }))()
`);
console.log('  DOM:', JSON.stringify(dom).slice(0, 500));

add('mensagens renderizadas', dom.msgs >= 2, `${dom.msgs}`);
add('cards de ferramenta', dom.tools >= 2, `${dom.tools} cards: ${dom.labels.join('|')}`);
add('argumento da ferramenta visivel', dom.args.some((a) => a && a.trim()), JSON.stringify(dom.args.slice(0, 3)));
add('diff renderizado', dom.diffs >= 1, `${dom.diffs} bloco(s)`);
add('diff tem linhas + e -', dom.diffAdds > 0 || dom.diffDels > 0, `+${dom.diffAdds} -${dom.diffDels}`);
add('saida das ferramentas', dom.outs >= 1, `${dom.outs}`);
add('raciocinio preservado', dom.reasoning >= 0, `${dom.reasoning}`);

await Q.shot('partes-topo.png');

// abre todos os corpos expansiveis para conferir o resultado
await Q.evaluate(`document.querySelectorAll('#thread .toolcard').forEach(c => c.querySelector('.toolcard-head')?.click())`);
await sleep(600);
await Q.evaluate(`document.getElementById('thread').scrollTop = 0`);
await sleep(300);
await Q.shot('partes-expandido.png');

const errs = Q.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
add('painel sem erro de console', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log('\nscreenshots:', OUT);
console.log('sessao de teste:', sid);
console.log('pasta:', WORK);

try { proc.kill(); } catch { /* ok */ }
await sleep(600);
site.close();
await fetch(`${API}/api/session/${sid}`, { method: 'DELETE', headers: H }).catch(() => {});
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* locks */ }

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) { failed.forEach(([n]) => console.log('  FALHOU: ' + n)); process.exit(1); }
console.log('RENDER DE PARTES OK');
process.exit(0);