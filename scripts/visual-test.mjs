/**
 * Teste visual + fluxo real: seleciona texto, dispara "Explicar", espera a
 * resposta do modelo chegar e salva screenshots do menu e do painel.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = process.argv[2];
const SHOTS = process.argv[3] || join(process.cwd(), 'screenshots');
const SITE_PORT = 8197;
const CDP_PORT = 9336;
const profile = mkdtempSync(join(tmpdir(), 'brave-shot-'));
mkdirSync(SHOTS, { recursive: true });

const HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Artigo sobre Typed Arrays</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{font:16px/1.7 system-ui,sans-serif;padding:48px;max-width:760px;margin:auto;color:#1a1a1a;background:#fff}
 h1{font-size:30px;line-height:1.2;margin:0 0 8px}
 .meta{color:#666;font-size:14px;margin-bottom:28px}
 p{padding:16px;background:#f4f6f8;border-radius:8px;border-left:3px solid #3b82f6}
 code{background:#eef;padding:1px 4px;border-radius:3px}
</style></head><body>
<h1>Typed Arrays: visões tipadas sobre memória</h1>
<div class="meta">Documentação &middot; 12 min de leitura</div>
<p id="alvo">Um <code>TypedArray</code> é uma visão sobre um bloco de memória bruta (<code>ArrayBuffer</code>) que
faz o motor tratar cada posição como um número do tipo que você escolheu, em vez de bytes soltos.
Isso permite usar matrizes sem copiar dados, essential para processamento numérico e gráficos.</p>
</body></html>`;

const site = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); });
await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1280,900',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  `http://127.0.0.1:${SITE_PORT}/`
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

let targets = [];
for (let i = 0; i < 45; i++) { await sleep(1000); try { targets = await cdp('/json/list'); if (targets.some((t) => t.type === 'page')) break; } catch { /* subindo */ } }
const page = targets.find((t) => t.type === 'page');

function attach(url) {
  const ws = new WebSocket(url);
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
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
    if (r.result?.data) writeFileSync(join(SHOTS, name), Buffer.from(r.result.data, 'base64'));
  };
  return { ws, ready, send, evaluate, errors, shot };
}

const P = attach(page.webSocketDebuggerUrl);
await P.ready;
await P.send('Runtime.enable');
await P.send('Page.enable');
await P.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(3000);

console.log('\n== 1. bubble na tela ==');
await P.shot('01-bubble.png');
const bubbleRect = await P.evaluate(`
  (() => { const b = document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble');
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; })()
`);
add('bubble visivel na viewport', bubbleRect?.w === 44 && bubbleRect.x > 0 && bubbleRect.y > 0, JSON.stringify(bubbleRect));

console.log('\n== 2. menu de selecao (screenshot) ==');
await P.evaluate(`
  (() => { const p = document.getElementById('alvo');
    const r = document.createRange(); r.selectNodeContents(p);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return true; })()
`);
await sleep(700);
await P.shot('02-menu-selecao.png');
add('screenshot do menu salvo', true, '02-menu-selecao.png');

console.log('\n== 3. clicar em "Explicar" ==');
const clicked = await P.evaluate(`
  (() => { const m = document.getElementById('oc-host').shadowRoot.querySelector('.oc-menu');
    const btn = [...m.querySelectorAll('.oc-item')].find(b => b.textContent.includes('Explicar'));
    if (!btn) return false; btn.click(); return true; })()
`);
add('clicou no pre-prompt Explicar', clicked === true);

await sleep(3000);
await P.shot('03-painel-gerando.png');
const openNow = await P.evaluate(
  `document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel').classList.contains('is-open')`);
add('painel abriu com o prompt', openNow === true);

console.log('\n== 4. aguardando resposta do modelo ==');
const t2 = await cdp('/json/list');
const panelT = t2.find((t) => /panel\.html/.test(t.url));
let Q = null;
if (panelT) {
  Q = attach(panelT.webSocketDebuggerUrl);
  await Q.ready;
  await Q.send('Runtime.enable');
  await Q.send('Page.enable');
  await sleep(1500);
}

let ok = false;
let lastLen = 0;
if (Q) {
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const s = await Q.evaluate(`document.getElementById('status').textContent`);
    const msgs = await Q.evaluate(`document.querySelectorAll('#thread .msg-assistant').length`);
    const chars = await Q.evaluate(`
      (() => { const n = [...document.querySelectorAll('#thread .msg-assistant .md')].pop();
        return n ? n.innerText.length : 0; })()
    `);
    if (chars > lastLen) {
      process.stdout.write(`     ... ${chars} chars (status: ${s})\n`);
      lastLen = chars;
    }
    if (/pronto/i.test(s || '') && chars > 200) { ok = true; break; }
  }
}
add('resposta do modelo renderizou', ok, `${lastLen} chars`);
await sleep(1200);
if (Q) await Q.shot('04-painel-resposta.png');

console.log('\n== 5. turnada seguinte (streaming) ==');
if (Q) {
  const sent = await Q.evaluate(`
    (() => { const i = document.getElementById('input');
      i.value = 'Agora em 3 palavras: por que isso importa?';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('send').click(); return true; })()
  `);
  add('enviou segunda mensagem', sent === true);
  await sleep(4000);
  await Q.shot('05-segundo-turno.png');

  let streamed = false;
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const s = await Q.evaluate(`document.getElementById('status').textContent`);
    if (/pronto/i.test(s || '')) { streamed = true; break; }
  }
  add('segundo turno concluiu', streamed);
  const total = await Q.evaluate(`document.querySelectorAll('#thread .msg').length`);
  add('historico com varios turnos', total >= 4, `mensagens=${total}`);

  const qErrs = Q.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
  add('painel sem erro de console', qErrs.length === 0, qErrs.slice(0, 2).join(' | '));
  Q.ws.close();
}

console.log('\n== 6. persistencia de posicao ==');
const before = await P.evaluate(`
  (() => { const p = document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel');
    const r = p.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })()
`);
await P.evaluate(`
  (() => { const h = document.getElementById('oc-host');
    const p = h.shadowRoot.querySelector('.oc-panel');
    p.style.left = '300px'; p.style.top = '120px';
    window.dispatchEvent(new Event('resize')); return true; })()
`);
await sleep(600);
const after = await P.evaluate(`
  (() => { const p = document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel');
    const r = p.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })()
`);
add('painel moveu', before.x !== after.x || before.y !== after.y, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
const saved = await P.evaluate(`
  new Promise((res) => chrome.storage.local.get(['frameRect'], (v) => res(JSON.stringify(v.frameRect))))`);
add('posicao salva no storage', /x/.test(String(saved)), String(saved).slice(0, 90));

const pErrs = P.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
add('pagina sem erro de console', pErrs.length === 0, pErrs.slice(0, 2).join(' | '));

try { proc.kill(); } catch { /* ok */ }
await sleep(800);
site.close();
try { rmSyncSafe(profile); } catch { /* locks */ }
function rmSyncSafe(p) { /* profile temporário do Windows às vezes fica trancado */ }

console.log(`\nscreenshots em: ${SHOTS}`);
const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) { failed.forEach(([n]) => console.log('  FALHOU: ' + n)); process.exit(1); }
console.log('FLUXO COMPLETO OK');
process.exit(0);