/**
 * Reproduz o envio pelo caminho real da extensão e lê o que aparece na tela.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
// caminho absoluto: o Chromium ignora --load-extension relativo em silencio
const EXT = resolve(process.argv[2] || 'extension');
const OUT = process.argv[3] || join(process.cwd(), 'shots-envio');
const API = 'http://127.0.0.1:4177';
const PW = 'testefixo123';
const H = { Authorization: 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64') };

const SITE_PORT = 8291;
const CDP_PORT = 9447;
const profile = mkdtempSync(join(tmpdir(), 'brave-env-'));
const WORK = mkdtempSync(join(tmpdir(), 'oc-env-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

const HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Alvo</title>
<style>body{margin:0;font:16px system-ui;padding:20px}h1{font-size:40px}</style></head>
<body><h1>Pagina de teste</h1><p>conteudo qualquer</p></body></html>`;

const site = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); });
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
  const sendM = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evaluate = async (expr) => {
    const r = await sendM('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  const shot = async (name) => {
    const r = await sendM('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
  };
  return { ws, ready, send: sendM, evaluate, errors, shot };
}

const P = attach(pageT.webSocketDebuggerUrl);
await P.ready;
await P.send('Runtime.enable'); await P.send('Page.enable');
await P.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(3000);

let panelT = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => /panel\.html/.test(t.url));
if (!panelT) { console.log('painel nao encontrado'); process.exit(1); }
const Q = attach(panelT.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable'); await Q.send('Page.enable');
await sleep(2500);

await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => {
  const cfg = v.cfg || {};
  cfg.model = { providerID: 'kilo4', id: 'stepfun/step-5-preview-free', variant: 'medium' };
  cfg.modelLabel = '[K4] Step 5 Preview';
  cfg.directory = ${JSON.stringify(WORK)};
  chrome.storage.local.set({ cfg }, () => r(true));
}))`);
await sleep(2000);

// abre pelo botão
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(5000);

const sessao = await Q.evaluate(`document.getElementById('sessionPicker').value`);
console.log('\nsessao aberta:', sessao);

// o modelo realmente foi aplicado?
const sessInfo = sessao ? await (await fetch(`${API}/api/session/${sessao}`, { headers: H })).json() : null;
console.log('modelo da sessao:', JSON.stringify(sessInfo?.data?.model));

// ---- envia texto simples pelo caminho real
console.log('\n== envio de texto ==');
await Q.evaluate(`(() => {
  const inp = document.getElementById('input');
  inp.value = 'Responda apenas: ok';
  inp.dispatchEvent(new Event('input'));
  document.getElementById('send').click();
})()`);

let visto = null;
for (let i = 0; i < 30; i++) {
  await sleep(3000);
  visto = await Q.evaluate(`(() => ({
    status: document.getElementById('status').textContent,
    msgs: document.querySelectorAll('#thread .msg').length,
    erro: [...document.querySelectorAll('#thread .err, #thread .erro, #thread .msg.err')]
      .map(e => e.textContent.slice(0, 300)),
    vazio: document.getElementById('empty')?.hidden
  }))()`);
  console.log(`  ${(i + 1) * 3}s status="${visto.status}" msgs=${visto.msgs}`);
  if (visto.erro.length) { console.log('  ERRO NA TELA:', JSON.stringify(visto.erro)); break; }
  // sai quando a geracao realmente acabou (status sai de "gerando")
  if (visto.msgs > 0 && !/gerando/i.test(visto.status || '')) break;
}
await Q.shot('envio-texto.png');

const st = visto.status || '';
add('envio nao deu erro de HTTP', !/falha|HTTP|Invalid|invalid/i.test(st), st);
add('status chegou ao fim', !/gerando/i.test(st), st);
add('houve resposta na conversa', visto.msgs >= 2, `msgs=${visto.msgs}`);

// a conexao SSE sobreviveu?
const conexao = await Q.evaluate(`(() => ({
  status: document.getElementById('statusDot').className,
  texto: document.getElementById('status').textContent
}))()`);
console.log('  conexao:', JSON.stringify(conexao));

// o servidor continua de pe?
const vivo = await fetch(`${API}/api/location`, { headers: H }).then((r) => r.ok).catch(() => false);
add('servidor no ar depois do envio', vivo === true, String(vivo));

// ---- e com uma imagem de verdade?
console.log('\n== envio com imagem ==');
const jpeg = await Q.evaluate(`new Promise((res) => {
  const c = document.createElement('canvas');
  c.width = 400; c.height = 300;
  const g = c.getContext('2d');
  g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, 400, 300);
  g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif';
  g.fillText('IMAGEM', 90, 160);
  res(c.toDataURL('image/jpeg', 0.85));
})`);
console.log('  jpeg gerado:', jpeg.length, 'chars');

const sess2 = await (await fetch(`${API}/api/session`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ location: { directory: WORK }, model: { providerID: 'kilo4', id: 'stepfun/step-5-preview-free', variant: 'medium' } })
})).json();
const sid2 = sess2.data.id;

const r2 = await fetch(`${API}/api/session/${sid2}/prompt`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'O que diz a imagem?', files: [{ uri: jpeg, name: 'tela.jpg', mime: 'image/jpeg' }] })
});
console.log('  POST imagem:', r2.status, (await r2.text()).slice(0, 200));

const qErrs = Q.errors.filter((e) => e && !/favicon/.test(e));
const pErrs = P.errors.filter((e) => e && !/favicon/.test(e));
if (qErrs.length) console.log('\nerros do painel:', JSON.stringify(qErrs.slice(0, 3)));
if (pErrs.length) console.log('erros da pagina:', JSON.stringify(pErrs.slice(0, 3)));

try { proc.kill(); } catch { /* ok */ }
await sleep(600);
site.close();
for (const s of [sessao, sid2]) if (s) await fetch(`${API}/api/session/${s}`, { method: 'DELETE', headers: H }).catch(() => {});

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) failed.forEach(([n]) => console.log('  FALHOU: ' + n));
else console.log('TUDO OK');
process.exit(failed.length ? 1 : 0);