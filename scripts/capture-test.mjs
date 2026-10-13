/**
 * Verifica as duas mudanças:
 *  1. a captura da tela NÃO inclui o painel de chat
 *  2. clicar no botão flutuante abre sessão nova; escolher no seletor mantém
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
// caminho absoluto: o Chromium ignora --load-extension relativo em silencio
const EXT = resolve(process.argv[2] || 'extension');
const OUT = process.argv[3] || join(process.cwd(), 'shots-captura');
const API = 'http://127.0.0.1:4177';
const PW = 'testefixo123';
const H = { Authorization: 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64'), 'Content-Type': 'application/json' };

const SITE_PORT = 8189;
const CDP_PORT = 9344;
const profile = mkdtempSync(join(tmpdir(), 'brave-cap-'));
const WORK = mkdtempSync(join(tmpdir(), 'oc-cap-'));
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

// página com faixas grandes de cor: se o painel entrar no print, o azul some
const HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Alvo</title>
<style>html,body{margin:0;font:16px system-ui}
.faixa{height:260px;display:grid;place-items:center;font:800 44px system-ui;color:#fff}
.a{background:#1d4ed8}.b{background:#dc2626}.c{background:#059669}
p{padding:18px;font:700 26px system-ui;color:#111}</style></head><body>
<p>MARCA-TEXTO-ALPHA</p>
<div class="faixa a">FAIXA AZUL</div>
<div class="faixa b">FAIXA VERMELHA</div>
<div class="faixa c">FAIXA VERDE</div>
</body></html>`;

const site = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); });
await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1000,900',
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
  };
  return { ws, ready, send, evaluate, errors, shot };
}

const P = attach(pageT.webSocketDebuggerUrl);
await P.ready;
await P.send('Runtime.enable');
await P.send('Page.enable');
await P.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(3000);

// Na instalação a extensão abre options.html numa aba e ela fica sendo a aba
// ativa: o captureVisibleTab fotografaria a página de opções. Fechar a aba e
// focar a janela cedo resolve — fazer isso depois de anexar ao painel congela
// o iframe e a captura trava.
{
  const r = await P.send('Target.getTargets');
  const opts = (r.result?.targetInfos || []).find((t) => /options\.html/.test(t.url));
  if (opts) {
    await P.send('Target.closeTarget', { targetId: opts.targetId }).catch(() => {});
    console.log('  aba de opcoes fechada');
    await sleep(1500);
  }
  await P.send('Page.bringToFront').catch(() => {});
  await sleep(1500);
}

// pega o iframe do painel (ele nasce com o content script)
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

// ---------- 1. clique no botão abre sessão nova
console.log('\n== 1. clique abre sessão nova ==');
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(4000);

const s1 = await Q.evaluate(`(async () => {
  const id = await new Promise((r) => chrome.storage.local.get(['cfg'], () => r(1)));
  return { sessao: (await (async () => {
    const sel = document.getElementById('sessionPicker');
    return sel.value;
  })()), opcoes: document.getElementById('sessionPicker').options.length };
})()`);
console.log('  após 1º clique:', JSON.stringify(s1));

const list1 = (await (await fetch(`${API}/api/session?limit=20&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data;
console.log('  sessões criadas:', list1.length);
add('primeiro clique criou sessão', list1.length >= 1, `${list1.length}`);

// fecha e clica de novo
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(1200);
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(4000);
const list2 = (await (await fetch(`${API}/api/session?limit=20&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data;
console.log('  sessões após 2º clique:', list2.length);
add('segundo clique criou outra sessão', list2.length >= 2, `${list2.length}`);

// ---------- 2. escolher no seletor mantém a sessão
console.log('\n== 2. seletor mantém a sessão ==');
const escolhida = list2[1]?.id;
const pick = await Q.evaluate(`(() => {
  const p = document.getElementById('sessionPicker');
  const o = [...p.options].find(x => x.value === ${JSON.stringify(escolhida)});
  if (!o) return { ok: false, opcoes: p.options.length };
  p.value = o.value;
  p.dispatchEvent(new Event('change'));
  return { ok: true, id: o.value };
})()`);
console.log('  selecionou:', JSON.stringify(pick));
await sleep(3000);
const antes3 = list2.length;
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(1200);
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(4000);
const list3 = (await (await fetch(`${API}/api/session?limit=20&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data;
console.log(`  sessões depois de escolher e clicar 2x: ${list3.length} (era ${antes3})`);
add('escolher sessão impede criar nova ao clicar', list3.length === antes3, `${antes3} -> ${list3.length}`);
const sessAtual = await Q.evaluate(`document.getElementById('sessionPicker').value`);
add('continua na sessão escolhida', sessAtual === escolhida, sessAtual);

// ---------- 3. a captura não inclui o painel
console.log('\n== 3. captura sem o painel ==');
const geo = await P.evaluate(`(() => { const p = document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel');
  const r = p.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
console.log('  painel em:', JSON.stringify(geo));

const antes = await Q.evaluate(`({
  disabled: document.getElementById('eyeBtn').disabled,
  title: document.getElementById('eyeBtn').title,
  label: document.getElementById('eyeLabel').textContent
})`);
console.log('  botão antes:', JSON.stringify(antes));

// A captura depende de a janela estar focada, e quem vem depois fica em
// segundo plano. Repetir algumas vezes: nesse ambiente a janelaoscila entre
// focada e não focada, e captureVisibleTab trava quando não está.
const cap = await Q.evaluate(`new Promise((res) => {
  const btn = document.getElementById('eyeBtn');
  btn.disabled = false;
  let mid = null;
  const h = (e) => { if (e.data?.type === 'oc:captured') mid = e.data.dataUrl; };
  window.addEventListener('message', h);
  let tentativas = 0;
  const tentar = () => {
    if (++tentativas > 5) {
      window.removeEventListener('message', h);
      const img = document.querySelector('#attachments img');
      return res({ recebeu: !!mid, viaHandler: img ? { len: img.src.length } : null,
                   tentativas, label: document.getElementById('eyeLabel').textContent });
    }
    btn.click();
    setTimeout(() => {
      if (mid) {
        window.removeEventListener('message', h);
        const img = document.querySelector('#attachments img');
        return res({ recebeu: true, viaHandler: img ? { len: img.src.length } : null,
                     tentativas, label: document.getElementById('eyeLabel').textContent });
      }
      tentar();
    }, 4000);
  };
  tentar();
})`);

console.log('  captura:', JSON.stringify(cap).slice(0, 140));
const capToast = await Q.evaluate(`document.querySelector('.toast')?.textContent || '(sem toast)'`);
console.log('  toast:', capToast);
// o service worker responde se chamado direto?
const direto = await Q.evaluate(`new Promise((res) => {
  chrome.runtime.sendMessage({ type: 'oc:captureVisibleTab' }, (r) =>
    res(r ? { ok: r.ok, erro: r.error || null, len: (r.dataUrl || '').length } : { semResposta: true }));
  setTimeout(() => res({ timeout: true }), 8000);
})`);
console.log('  service worker direto:', JSON.stringify(direto));
add('captura anexada', (cap.viaHandler?.len || 0) > 3000, JSON.stringify(cap).slice(0, 90));

// salva o JPEG que o painel recebeu, para inspecao direta
const dump = await Q.evaluate(`(async () => {
  const img = document.querySelector('#attachments img');
  if (!img) return null;
  const r = await fetch(img.src);
  const b = await r.arrayBuffer();
  let s = ''; const u = new Uint8Array(b);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
})()`);
if (dump) {
  writeFileSync(join(OUT, 'captura-recebida.jpg'), Buffer.from(dump, 'base64'));
  console.log('  jpg salvo: captura-recebida.jpg', dump.length, 'chars');
}

// a imagem da página: mede as faixas. o painel é escuro (#0e1014) e opaco.
const analise = await Q.evaluate(`(async () => {
  const img = document.querySelector('#attachments img');
  if (!img) return null;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let escuro = 0, azul = 0, vermelho = 0, verde = 0, branco = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i+1], b = d[i+2];
    const lum = 0.299*r + 0.587*gg + 0.114*b;
    if (lum < 40) escuro++;
    else if (lum > 235) branco++;
    if (b > 140 && r < 80 && gg < 120) azul++;
    if (r > 150 && gg < 90 && b < 90) vermelho++;
    if (gg > 110 && r < 90 && b < 110) verde++;
  }
  const total = d.length / 4;
  return {
    pctEscuro: +(escuro/total*100).toFixed(1),
    pctAzul: +(azul/total*100).toFixed(1),
    pctVerm: +(vermelho/total*100).toFixed(1),
    pctVerde: +(verde/total*100).toFixed(1),
    dim: [c.width, c.height]
  };
})()`);
console.log('  análise da imagem:', JSON.stringify(analise));

// a página de teste é quase toda faixa colorida: se o painel cobrisse boa
// parte, o escuro do painel dominaria
add('captura contém a página (pouco escuro = sem painel)',
  !!analise && analise.pctEscuro < 12, JSON.stringify(analise));
add('captura tem as três faixas da página',
  !!analise && analise.pctAzul > 10 && analise.pctVerm > 10 && analise.pctVerde > 10, JSON.stringify(analise));

await Q.shot('painel-com-captura.png');

// o painel volta visível depois
const voltou = await P.evaluate(`(() => {
  const p = document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel');
  return { visivel: p.style.visibility !== 'hidden', aberto: p.classList.contains('is-open') };
})()`);
add('painel volta visível depois da captura', voltou.visivel === true, JSON.stringify(voltou));

const qErrs = Q.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
const pErrs = P.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
add('painel sem erro', qErrs.length === 0, qErrs.slice(0, 2).join(' | '));
add('pagina sem erro', pErrs.length === 0, pErrs.slice(0, 2).join(' | '));

try { proc.kill(); } catch { /* ok */ }
await sleep(600);
site.close();
for (const s of list3) await fetch(`${API}/api/session/${s.id}`, { method: 'DELETE', headers: H }).catch(() => {});

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
console.log('screenshots:', OUT);
if (failed.length) { failed.forEach(([n]) => console.log('  FALHOU: ' + n)); process.exit(1); }
console.log('TUDO OK');
process.exit(0);
