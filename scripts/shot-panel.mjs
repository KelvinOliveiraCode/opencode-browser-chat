/**
 * Screenshot do painel aberto como aba real (o iframe é OOPIF e sairia preto).
 * Uso: node scripts/shot-panel.mjs <extDir> <outDir> [--empty]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = process.argv[2];
const OUT = process.argv[3];
const EMPTY = process.argv.includes('--empty');
const SITE_PORT = 8195;
const CDP_PORT = 9338;
const profile = mkdtempSync(join(tmpdir(), 'brave-panel-'));
mkdirSync(OUT, { recursive: true });

const HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Doc</title>
<style>body{font:16px/1.7 system-ui;padding:48px}</style></head>
<body><h1>Doc</h1><p>conteudo</p></body></html>`;
const site = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); });
await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=900,820',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  `http://127.0.0.1:${SITE_PORT}/`
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();

let targets = [];
for (let i = 0; i < 45; i++) {
  await sleep(1000);
  try {
    targets = await cdp('/json/list');
    if (targets.some((t) => t.type === 'page' && t.url.includes(String(SITE_PORT)))) break;
  } catch { /* subindo */ }
}
const extId = targets.find((t) => t.url.startsWith('chrome-extension://'))?.url.split('/')[2];
if (!extId) { console.log('extensao nao carregou'); process.exit(1); }
console.log('extension id:', extId);

// abre o painel como aba real, em janela com tamanho controlado
const page = targets.find((t) => t.type === 'page' && t.url.includes(String(SITE_PORT)));
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
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
    else console.log('  screenshot falhou:', name);
  };
  return { ws, ready, send, evaluate, shot, errors };
}

const P = attach(page.webSocketDebuggerUrl);
await P.ready;
await P.send('Runtime.enable');
await P.send('Page.enable');
await sleep(1500);

// navega para o painel
await P.send('Page.navigate', { url: `chrome-extension://${extId}/panel.html` });
await sleep(4500);

const after = await cdp('/json/list');
const panelT = after.find((t) => /panel\.html/.test(t.url) && t.type === 'page');
if (!panelT) {
  console.log('painel nao abriu como aba');
  await P.shot('debug.png');
  process.exit(1);
}

const Q = attach(panelT.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await Q.send('Page.enable');
await Q.send('Emulation.setDeviceMetricsOverride', {
  width: 460, height: 700, deviceScaleFactor: 2, mobile: false
});
await sleep(2500);

if (!EMPTY) {
  await Q.evaluate(`
    (() => {
      document.getElementById('empty').hidden = true;
      const t = document.getElementById('thread');

      const u = document.createElement('div');
      u.className = 'msg msg-user';
      u.innerHTML = '<div class="bubble"><div class="md">' +
        '<p>Explique o texto abaixo para quem não manja do assunto.</p>' +
        '<p>## Texto selecionado</p>' +
        '<p>Um <code>TypedArray</code> é uma visão sobre um bloco de memória bruta ' +
        '(<code>ArrayBuffer</code>) que faz o motor tratar cada posição como um número do tipo escolhido.</p>' +
        '<p>## Página de origem</p><p>URL: https://exemplo.dev/typed-arrays</p></div></div>';
      t.append(u);

      const a = document.createElement('div');
      a.className = 'msg msg-assistant';
      a.innerHTML =
        '<div class="msg-meta"><span class="who">modelo</span>' +
        '<span>opencode/space-bunny-free</span><span class="spacer"></span>' +
        '<span class="tok">30.149 in · 683 out</span></div>' +
        '<details class="reasoning"><summary>raciocínio</summary>' +
        '<div class="rbody">O texto cita ArrayBuffer e TypedArray. Vou explicar pela analogia de uma ' +
        'gaveta com compartimentos de tamanho fixo, depois dar o exemplo de Uint8Array(1024).</div></details>' +
        '<div class="tools"><div class="tool">✓ minhas-skills-unificadas</div></div>' +
        '<div class="bubble"><div class="md">' +
        '<p><strong>Em uma frase:</strong> um Typed Array é uma janela que você coloca sobre um bloco ' +
        'de bytes e que passa a dizer &ldquo;aqui dentro tem números de 4 bytes, sem decimais&rdquo;.</p>' +
        '<h2>Como funciona</h2>' +
        '<p>O <code>ArrayBuffer</code> guarda os bytes crus. O Typed Array é a visão tipada sobre eles — ' +
        'você escolhe o tipo e o motor sabe quantos bytes ocupa cada posição.</p>' +
        '<ul><li><code>Int8Array</code> — inteiros de 8 bits</li>' +
        '<li><code>Float32Array</code> — ponto flutuante de 32 bits</li></ul>' +
        '<pre><code>const buf = new ArrayBuffer(1024);\\nconst view = new Uint8Array(buf);</code></pre>' +
        '<blockquote>O ganho é não copiar: gráficos e cálculo numérico leem direto da memória.</blockquote>' +
        '<p>Se quiser, posso comparar com <code>DataView</code>.</p></div></div>' +
        '<div class="msg-actions"><button>copiar</button><button>repetir</button></div>';
      t.append(a);

      const u2 = document.createElement('div');
      u2.className = 'msg msg-user';
      u2.innerHTML = '<div class="bubble"><div class="md"><p>E a diferença para um array normal?</p></div></div>';
      t.append(u2);

      const live = document.createElement('div');
      live.className = 'msg msg-assistant';
      live.innerHTML = '<div class="msg-meta"><span class="who">modelo</span>' +
        '<span>opencode/step-5-preview-free</span></div>' +
        '<div class="bubble"><div class="md cursor">A diferença é que um array normal guarda objetos ' +
        'na memória gerenciada, enquanto o Typed Array aponta direto para bytes</div></div>';
      t.append(live);

      t.scrollTop = 0;
      return true;
    })()
  `);
  await sleep(600);
}

await Q.shot(EMPTY ? 'painel-vazio.png' : 'painel-conversa.png');

await Q.evaluate(`document.getElementById('modelBtn').click()`);
await sleep(800);
await Q.shot('painel-modelos.png');
await Q.evaluate(`document.getElementById('modalClose').click()`);
await sleep(300);

await Q.evaluate(`document.getElementById('input').value='Como isso se compara com DataView?';
  document.getElementById('input').dispatchEvent(new Event('input',{bubbles:true}));
  document.getElementById('input').focus();`);
await sleep(400);
await Q.shot('painel-composer.png');

const errs = Q.errors.filter((e) => e && !/favicon|ERR_FILE|ERR_FILE_NOT_FOUND/.test(e));
console.log('erros no painel:', errs.length ? errs.slice(0, 3).join(' | ') : 'nenhum');
console.log('ok ->', OUT);

try { proc.kill(); } catch { /* ok */ }
await sleep(700);
site.close();
process.exit(0);