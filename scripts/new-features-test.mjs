/**
 * Foco nas três mudanças, sem depender da ordem dos testes:
 *   A. drag do painel não gruda
 *   B. modelo com visão anexa a captura da aba
 *   C. a injeção do roteador não aparece na conversa
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = process.argv[2];
const OUT = process.argv[3] || join(process.cwd(), 'shots-novo');
const API = 'http://127.0.0.1:4177';
const PW = 'testefixo123';
const AUTH = 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64');
const H = { Authorization: AUTH, 'Content-Type': 'application/json' };

const SITE_PORT = 8191;
const CDP_PORT = 9342;
const profile = mkdtempSync(join(tmpdir(), 'brave-foco-'));
const WORK = mkdtempSync(join(tmpdir(), 'oc-foco-'));
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

// sessão limpa para inspecionar a injeção sem ruído de conversa antiga
const sess = await (await fetch(`${API}/api/session`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ location: { directory: WORK }, agent: 'plan', model: { providerID: 'opencode', id: 'space-bunny-free' } })
})).json();
const SID = sess.data.id;
console.log('sessão limpa:', SID);

// página com uma marca visual grande, para provar que a captura pegou a tela
const HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Alvo</title>
<style>body{font:16px system-ui;padding:50px;background:#fff;color:#111;margin:0}
h1{font-size:32px}
.faixa{height:340px;background:#1d4ed8;color:#fff;display:grid;place-items:center;
font:800 40px system-ui;border-radius:8px;margin:18px 0}
.vermelho{height:340px;background:#dc2626;color:#fff;display:grid;place-items:center;
font:800 40px system-ui;border-radius:8px;margin:18px 0}
p{font:700 26px system-ui;color:#111}</style></head><body>
<h1>Página para a captura</h1>
<p>MARCA-TEXTO-ALPHA</p>
<div class="faixa">FAIXA AZUL</div>
<div class="vermelho">FAIXA VERMELHA</div>
</body></html>`;

const site = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); });
await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1000,820',
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
const pageT = targets.find((t) => t.type === 'page' && t.url.includes(String(SITE_PORT)));

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
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  const mouse = (type, x, y, extra = {}) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
  };
  return { ws, ready, send, evaluate, errors, mouse, shot };
}

const P = attach(pageT.webSocketDebuggerUrl);
await P.ready;
await P.send('Runtime.enable');
await P.send('Page.enable');
await P.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 820, deviceScaleFactor: 1, mobile: false });
await sleep(3000);

// ============================================ A. drag
console.log('\n== A. arraste ==');
// o iframe do painel nasce junto com o content script, antes de abrir: dá
// para configurar o storage antes do primeiro uso
let panelT = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json())
  .find((t) => /panel\.html/.test(t.url));
if (!panelT) { console.log('iframe do painel nao encontrado'); process.exit(1); }
const Q = attach(panelT.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await Q.send('Page.enable');
await sleep(2500);

await Q.evaluate(`new Promise((res) => chrome.storage.local.get(['cfg'], (v) => {
  const cfg = v.cfg || {};
  cfg.model = { providerID: 'opencode', id: 'space-bunny-free' };
  cfg.modelLabel = 'Space Bunny Free';
  cfg.directory = ${JSON.stringify(WORK)};
  chrome.storage.local.set({ cfg }, () => res(true));
}))`);

await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(4000);

// tira os controles de cima do caminho para pegar o espaço vazio da barra
const gap = await Q.evaluate(`
  (() => {
    document.querySelectorAll('#bar button, #bar select').forEach(b => b.style.pointerEvents = 'none');
    const r = document.getElementById('bar').getBoundingClientRect();
    const width = r.width;
    const left = document.getElementById('bar').querySelector('.bar-left').getBoundingClientRect();
    const right = document.getElementById('bar').querySelector('.bar-right').getBoundingClientRect();
    return { y: Math.round(r.y + r.height / 2), x: Math.round((left.right + right.left) / 2) };
  })()
`);
console.log('  ponto de arrasto:', JSON.stringify(gap));

const geoA = await P.evaluate(`(() => { const p = document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel');
  const r = p.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })()`);

await Q.mouse('mousePressed', gap.x, gap.y);
await sleep(150);
for (let i = 1; i <= 10; i++) {
  await Q.mouse('mouseMoved', gap.x + i * 22, gap.y + i * 12);
  await sleep(70);
}
await Q.mouse('mouseReleased', gap.x + 220, gap.y + 120);
await sleep(900);

const geoB = await P.evaluate(`(() => { const p = document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel');
  const r = p.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })()`);
console.log('  antes:', JSON.stringify(geoA), '-> depois:', JSON.stringify(geoB));
add('painel se moveu', geoB.x !== geoA.x || geoB.y !== geoA.y, `${JSON.stringify(geoA)} -> ${JSON.stringify(geoB)}`);

// mousemove na página depois: não pode arrastar mais
await P.mouse('mouseMoved', 120, 700);
await P.mouse('mouseMoved', 300, 760);
await sleep(600);
const geoC = await P.evaluate(`(() => { const p = document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel');
  const r = p.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })()`);
add('não gruda no mouse depois de soltar', geoC.x === geoB.x && geoC.y === geoB.y,
  `${JSON.stringify(geoB)} -> ${JSON.stringify(geoC)}`);

const saved = await Q.evaluate(`new Promise((res) => {
  chrome.storage.local.get(['frameRect'], (v) => res(v.frameRect || null));
})`);
add('posição persistida no storage',
  !!saved && Math.abs((saved.x || 0) - geoB.x) < 60 && Math.abs((saved.y || 0) - geoB.y) < 60,
  JSON.stringify(saved));

await Q.evaluate(`document.querySelectorAll('#bar button, #bar select').forEach(b => b.style.pointerEvents = '')`);

// ============================================ B. ver a tela
console.log('\n== B. modelo vê a tela ==');
const models = (await (await fetch(`${API}/api/model`, { headers: H })).json()).data;
const vision = models.find((m) => m.providerID === 'opencode' && m.id === 'space-bunny-free');
add('modelo de teste tem visão', String(vision?.capabilities?.input || '').includes('image'),
  vision?.capabilities?.input);

// o modelo e a pasta já foram configurados antes de abrir o painel
const eye = await Q.evaluate(`({
  exists: !!document.getElementById('eyeBtn'),
  disabled: document.getElementById('eyeBtn')?.disabled,
  title: document.getElementById('eyeBtn')?.title,
  label: document.getElementById('eyeLabel')?.textContent
})`);
console.log('  botão:', JSON.stringify(eye));
add('botão "ver tela" habilitado com modelo com visão', eye.exists && eye.disabled === false, JSON.stringify(eye).slice(0, 110));

const cap = await Q.evaluate(`new Promise((res) => {
  const btn = document.getElementById('eyeBtn');
  if (!btn) return res({ erro: 'botao ausente' });
  btn.click();
  setTimeout(() => {
    const att = document.getElementById('attachments');
    const img = att?.querySelector('img');
    res({
      escondido: att?.hidden,
      imgs: att?.querySelectorAll('img').length,
      len: (img?.src || '').length,
      prefix: (img?.src || '').slice(0, 22)
    });
  }, 5000);
})`);
console.log('  captura:', JSON.stringify(cap).slice(0, 220));
const toastTxt = await Q.evaluate(`document.querySelector('.toast')?.textContent || '(sem toast)'`);
console.log('  toast:', toastTxt);
add('captura anexada', cap.imgs === 1 && cap.len > 3000, JSON.stringify(cap).slice(0, 130));
add('é JPEG em data URL', String(cap.prefix || '').startsWith('data:image/jpeg'), cap.prefix);

await Q.shot('tela-anexada.png');

const pixels = await Q.evaluate(`(async () => {
  const img = document.querySelector('#attachments img');
  if (!img) return null;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let azuis = 0, vermelhos = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 80 && d[i+1] < 110 && d[i+2] > 150) azuis++;
    if (d[i] > 170 && d[i+1] < 90 && d[i+2] < 90) vermelhos++;
  }
  const total = d.length / 4;
  return { pctAzul: +(azuis/total*100).toFixed(1), pctVerm: +(vermelhos/total*100).toFixed(1) };
})()`);
console.log('  pixels:', JSON.stringify(pixels));
add('a captura pegou a página real', !!pixels && pixels.pctAzul > 3 && pixels.pctVerm > 3, JSON.stringify(pixels));

// ============================================ C. injeção oculta
console.log('\n== C. injeção do roteador ==');
// cria a sessão pelo próprio painel, já com a pasta de teste configurada,
// e a identifica do lado do servidor pela mais recente
await Q.evaluate(`document.getElementById('newSession').click()`);
await sleep(3500);

const novaSessao = (await (await fetch(
  `${API}/api/session?limit=5&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data
  ?.sort((a, b) => b.time.created - a.time.created)[0]?.id;
console.log('  sessão criada pelo painel:', novaSessao);
add('painel criou sessão na pasta de teste', !!novaSessao, String(novaSessao).slice(0, 20));

await Q.evaluate(`(() => {
  document.getElementById('input').value = 'O que voce ve nessa imagem? Uma frase.';
  document.getElementById('input').dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(300);
await Q.evaluate(`document.getElementById('send').click()`);
await sleep(4000);

const visivel = await Q.evaluate(`({
  thread: document.getElementById('thread').innerText,
  textoEnviado: document.getElementById('input').value
})`);
console.log('  thread:', JSON.stringify(visivel.thread).slice(0, 240));
add('a conversa não mostra a instrução interna',
  !/CONFIG_OC|minhas-skills-unificadas|roteador/i.test(visivel.thread), 'sem marcador');
add('a mensagem do usuário aparece', /O que voce ve/i.test(visivel.thread), '');

// o servidor recebeu a instrução?
await sleep(3000);
const hist = (await (await fetch(`${API}/api/session/${novaSessao}/message?limit=10&order=asc`, { headers: H })).json()).data;
const firstUser = hist.find((m) => m.type === 'user');
const raw = firstUser?.payload?.text || firstUser?.text || '';
console.log('  servidor recebeu:', JSON.stringify(raw).slice(0, 320));
add('o servidor recebeu a instrução interna', /CONFIG_OC/.test(raw) && /minhas-skills-unificadas/.test(raw), '');
add('a instrução vem antes do pedido do usuário',
  raw.indexOf('CONFIG_OC') >= 0 && raw.indexOf('CONFIG_OC') < raw.indexOf('O que voce ve'), '');
add('o roteador veio anexado como skill',
  (firstUser?.payload?.agents || []).some((a) => a.name === 'minhas-skills-unificadas'),
  JSON.stringify(firstUser?.payload?.agents || []));

let waited = 0;
while (waited < 60000) {
  await sleep(3000); waited += 3000;
  const st = await Q.evaluate(`document.getElementById('status').textContent`);
  if (/pronto/i.test(st || '')) break;
}
const depois = await Q.evaluate(`document.getElementById('thread').innerText`);
console.log('  thread depois:', JSON.stringify(depois.slice(-320)));
add('o modelo respondeu', /ver|azul|vermelho|imagem|página/i.test(depois.slice(-400)), '');
add('a resposta não cita a instrução interna',
  !/CONFIG_OC|minhas-skills-unificadas/.test(depois), '');

await Q.shot('resposta.png');

const rErrs = Q.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
const pErrs = P.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
add('painel sem erro de console', rErrs.length === 0, rErrs.slice(0, 2).join(' | '));
add('pagina sem erro de console', pErrs.length === 0, pErrs.slice(0, 2).join(' | '));

try { proc.kill(); } catch { /* ok */ }
await sleep(600);
site.close();
await fetch(`${API}/api/session/${SID}`, { method: 'DELETE', headers: H }).catch(() => {});

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
console.log('screenshots:', OUT);
if (failed.length) { failed.forEach(([n]) => console.log('  FALHOU: ' + n)); process.exit(1); }
console.log('TUDO OK');
process.exit(0);