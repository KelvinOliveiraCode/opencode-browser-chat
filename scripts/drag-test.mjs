/**
 * Arraste do painel e do botão.
 *
 * Cobre os modos de falha que existiam antes:
 *   - o painel multiplicava o deslocamento do cursor (a âncora era a posição
 *     corrente, não a do início do gesto)
 *   - o arraste morria quando o cursor saía do iframe
 *   - o canto de redimensionar ficava sob a curva do border-radius e nunca
 *     recebia o clique
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = resolve(process.argv[2] || 'extension');
const SITE = 8833;
const CDP = 9833;
const profile = mkdtempSync(join(tmpdir(), 'brave-arraste-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => {
  checks.push([n, !!c, x]);
  console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`);
};

const site = createServer((_, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end('<!DOCTYPE html><meta charset="utf-8"><title>alvo</title>' +
    '<div style="height:1500px">rolagem</div>');
});
await new Promise((r) => site.listen(SITE, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
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
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description || '');
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

const geom = () => P.evaluate(`(() => {
  const p = document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel');
  const r = p.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
})()`);

const pega = () => P.evaluate(`(() => {
  const b = document.getElementById('oc-host').shadowRoot.querySelector('.oc-dragbar');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), h: Math.round(r.height) };
})()`);

const pegaGrip = () => P.evaluate(`(() => {
  const g = document.getElementById('oc-host').shadowRoot.querySelector('.oc-grip');
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: Math.round(r.width) };
})()`);

await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(4500);

const vp = await P.evaluate(`({ w: window.innerWidth, h: window.innerHeight })`);
console.log('  viewport:', JSON.stringify(vp));

// ==================================================== 1. arraste 1:1
console.log('\n== 1. o painel acompanha o cursor na medida ==');
const g0 = await geom();
const grab = await pega();
console.log(`  inicio: x=${g0.x} y=${g0.y} ${g0.w}x${g0.h} | faixa y=${grab.y} altura=${grab.h}`);

await P.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grab.x, y: grab.y, button: 'left', clickCount: 1, buttons: 1 });
await sleep(120);
const amostras = [];
for (let i = 1; i <= 12; i++) {
  const dx = i * 15, dy = i * 8;
  await P.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grab.x + dx, y: grab.y + dy, button: 'left', buttons: 1 });
  await sleep(80);
  amostras.push({ dx, dy, ...(await geom()) });
}
await P.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grab.x + 180, y: grab.y + 96, button: 'left', buttons: 0 });
await sleep(600);

console.log('  (cursor -> painel):', JSON.stringify(amostras.map((a) => `${a.dx}->${a.x - g0.x}`)));
const xExato = amostras.every((a) => Math.abs((a.x - g0.x) - a.dx) <= 4);
add('cada passo do cursor vale um passo do painel', xExato,
  `pior erro=${Math.max(...amostras.map((a) => Math.abs((a.x - g0.x) - a.dx)))}px`);

const g1 = await geom();
const dyReal = g1.y - g0.y;
add('o arraste não multiplica o movimento', Math.abs(dyReal - 96) <= 4, `dy=${dyReal} esperado 96`);
add('a altura do painel não muda ao arrastar', g1.h === g0.h, `${g0.h} -> ${g1.h}`);

// ==================================================== 2. limite da tela
console.log('\n== 2. arrastar até a borda trava no limite, sem congelar ==');
// vai bem longe para a direita, forçando o clamp
const g2a = await geom();
const grab2 = await pega();
await P.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grab2.x, y: grab2.y, button: 'left', clickCount: 1, buttons: 1 });
await sleep(120);
const trilha = [];
for (let i = 1; i <= 20; i++) {
  await P.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grab2.x + i * 30, y: grab2.y, button: 'left', buttons: 1 });
  await sleep(70);
  trilha.push((await geom()).x - g2a.x);
}
await P.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grab2.x + 600, y: grab2.y, button: 'left', buttons: 0 });
await sleep(600);
console.log('  deslocamento por passo:', JSON.stringify(trilha));
const g2 = await geom();
const maxX = vp.w - g2.w - 8;
add('o painel encosta no limite e não atravessa', g2.x === maxX, `x=${g2.x}, limite=${maxX}`);
add('continua respondendo depois de encostar', trilha[trilha.length - 1] === maxX - g2a.x,
  `parou em ${trilha[trilha.length - 1]}`);
add('nunca sai da viewport pela esquerda', g2.x >= 8, `x=${g2.x}`);

// ==================================================== 3. não gruda
console.log('\n== 3. soltar encerra o gesto ==');
const parado = await geom();
await P.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 700, button: 'none', buttons: 0 });
await P.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 350, y: 760, button: 'none', buttons: 0 });
await sleep(400);
const solto = await geom();
add('o painel não se move depois de soltar', parado.x === solto.x && parado.y === solto.y,
  `${parado.x},${parado.y} -> ${solto.x},${solto.y}`);

// ==================================================== 4. gesture repetido
console.log('\n== 4. arrastar de novo ==');
const g4a = await geom();
const grab4 = await pega();
await P.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grab4.x, y: grab4.y, button: 'left', clickCount: 1, buttons: 1 });
await sleep(120);
for (let i = 1; i <= 8; i++) {
  await P.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grab4.x - i * 20, y: grab4.y, button: 'left', buttons: 1 });
  await sleep(70);
}
await P.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grab4.x - 160, y: grab4.y, button: 'left', buttons: 0 });
await sleep(600);
const g4 = await geom();
add('o segundo arraste também funciona', Math.abs((g4a.x - g4.x) - 160) <= 4,
  `andou ${g4a.x - g4.x}px, esperado 160`);

// ==================================================== 5. resize
console.log('\n== 5. redimensionar pelo canto ==');
// leva o painel para o canto superior esquerdo: assim o canto inferior
// direito tem espaço para crescer DENTRO da janela (arrastar para fora da
// viewport não gera evento nenhum, e pareceria que o resize parou)
{
  const gb = await geom();
  const gbGrab = await pega();
  await P.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gbGrab.x, y: gbGrab.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(100);
  await P.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gbGrab.x - (gb.x - 8), y: gbGrab.y - (gb.y - 8), button: 'left', buttons: 1 });
  await sleep(150);
  await P.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gbGrab.x, y: gbGrab.y, button: 'left', buttons: 0 });
  await sleep(500);
  const gbDepois = await geom();
  console.log(`  reposicionado para ${gbDepois.x},${gbDepois.y}`);
}

const g5a = await geom();
const grip = await pegaGrip();
add('o canto de redimensionar existe', !!grip, JSON.stringify(grip));
if (grip) {
  const roomRight = vp.w - grip.cx;
  const roomDown = vp.h - grip.cy;
  const dx = Math.min(120, roomRight - 4);
  const dy = Math.min(60, roomDown - 4);
  await P.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grip.cx, y: grip.cy, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(120);
  const passos = 6;
  for (let i = 1; i <= passos; i++) {
    await P.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: grip.cx + Math.round((dx * i) / passos),
      y: grip.cy + Math.round((dy * i) / passos),
      button: 'left', buttons: 1
    });
    await sleep(70);
  }
  await P.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip.cx + dx, y: grip.cy + dy, button: 'left', buttons: 0 });
  await sleep(600);
  const g5 = await geom();
  console.log(`  ${g5a.w}x${g5a.h} -> ${g5.w}x${g5.h} (pedido +${dx}/+${dy})`);
  add('o redimensionamento responde na medida', Math.abs((g5.w - g5a.w) - dx) <= 6 && Math.abs((g5.h - g5a.h) - dy) <= 6,
    `+${g5.w - g5a.w} largura, +${g5.h - g5a.h} altura`);
  add('a largura não passa da janela', g5.w <= vp.w - 16, `w=${g5.w}, janela=${vp.w}`);
}

// ==================================================== 6. botão flutuante
console.log('\n== 6. arrastar o botão flutuante ==');
const bolha = () => P.evaluate(`(() => {
  const b = document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble');
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), left: Math.round(r.x), top: Math.round(r.y) };
})()`);
const b0 = await bolha();
await P.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b0.x, y: b0.y, button: 'left', clickCount: 1, buttons: 1 });
await sleep(120);
for (let i = 1; i <= 8; i++) {
  await P.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b0.x - i * 12, y: b0.y - i * 9, button: 'left', buttons: 1 });
  await sleep(70);
}
await P.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b0.x - 96, y: b0.y - 72, button: 'left', buttons: 0 });
await sleep(600);
const b1 = await bolha();
console.log(`  botão: ${b0.left},${b0.top} -> ${b1.left},${b1.top}`);
add('o botão acompanha o cursor', Math.abs((b0.left - b1.left) - 96) <= 6 && Math.abs((b0.top - b1.top) - 72) <= 6,
  `delta ${b0.left - b1.left},${b0.top - b1.top}`);
const painelAberto = await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel').classList.contains('is-open')`);
add('arrastar o botão não abre nem fecha o painel', painelAberto === true, `aberto=${painelAberto}`);

// ==================================================== 7. posição guardada
console.log('\n== 7. a posição fica guardada ==');
// chrome.storage só existe no contexto da extensão: a leitura sai do painel
const panelT = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json())
  .find((t) => /panel\.html/.test(t.url));
let salvo = null;
if (panelT) {
  const Q = attach(panelT.webSocketDebuggerUrl);
  await Q.ready;
  await Q.send('Runtime.enable');
  salvo = await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['frameRect'], (v) => r(v.frameRect || null)))`);
  Q.ws.close();
}
const g7 = await geom();
add('o storage tem a posição final',
  !!salvo && Math.abs((salvo.x || 0) - g7.x) < 40 && Math.abs((salvo.y || 0) - g7.y) < 40,
  `storage=${JSON.stringify(salvo)} tela=${g7.x},${g7.y}`);

const erros = P.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
add('pagina sem erro de console', erros.length === 0, erros.slice(0, 2).join(' | '));

try { proc.kill(); } catch { /* ok */ }
await sleep(800); site.close();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* lock */ }

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) { failed.forEach(([n]) => console.log('  FALHOU: ' + n)); process.exit(1); }
console.log('TUDO OK');
process.exit(0);