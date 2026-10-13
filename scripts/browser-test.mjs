/**
 * Verificação real no Brave via CDP.
 *
 * A página de teste é servida por HTTP porque content scripts não são
 * injetados em file:// sem "permitir acesso a URLs de arquivo".
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
// caminho absoluto: o --load-extension do Chromium ignora caminho relativo em
// silencio (a extensão não carrega e o teste falha depois, sem causa visível)
const EXT = resolve(process.argv[2] || 'extension');
const SITE_PORT = 8199;
const CDP_PORT = 9334;
const profile = mkdtempSync(join(tmpdir(), 'brave-ext-'));

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Pagina de teste</title>
<style>body{font:16px system-ui;padding:40px;max-width:720px;margin:auto}
p{padding:14px;background:#eef;border-radius:8px}</style></head><body>
<h1>Texto para selecionar</h1>
<p id="alvo">Typed Arrays sao visoes tipadas sobre memoria bruta. Este paragrafo serve para testar o menu de pre-prompts da extensao.</p>
<img id="img" width="120" height="80" alt="teste" src="${PNG}">
</body></html>`;

const site = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});
await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));
console.log(`pagina de teste em http://127.0.0.1:${SITE_PORT}`);

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--no-sandbox',
  // Chrome/Brave 137+ desativam --load-extension por padrão.
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--disable-extensions-except=${EXT}`,
  `--load-extension=${EXT}`,
  `http://127.0.0.1:${SITE_PORT}/`
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = async (path) => (await fetch(`http://127.0.0.1:${CDP_PORT}${path}`)).json();

let targets = [];
for (let i = 0; i < 45; i++) {
  await sleep(1000);
  try { targets = await cdp('/json/list'); if (targets.some((t) => t.type === 'page')) break; } catch { /* subindo */ }
}
if (!targets.some((t) => t.type === 'page')) { console.log('FALHA: sem CDP'); process.exit(1); }

const extTargets = targets.filter((t) => t.url.startsWith('chrome-extension://'));
console.log('extensoes:', extTargets.length);
extTargets.forEach((t) => console.log('   ', t.url.split('/')[2]));

const page = targets.find((t) => t.type === 'page' && t.url.includes(String(SITE_PORT)));
console.log('pagina:', page.url);

const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

function attach(wsUrl, tag) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '');
    }
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  return { ws, ready, send, evaluate, errors, tag };
}

const P = attach(page.webSocketDebuggerUrl, 'pagina');
await P.ready;
await P.send('Runtime.enable');
await P.send('Page.enable');
await sleep(3500);

console.log('\n== content script ==');
const hostOk = await P.evaluate(`!!document.getElementById('oc-host')`);
add('host injetado', hostOk === true, String(hostOk));

const bubble = await P.evaluate(`
  (() => { const h = document.getElementById('oc-host'); if (!h?.shadowRoot) return { noShadow: true };
    const b = h.shadowRoot.querySelector('.oc-bubble');
    return { found: !!b, count: h.shadowRoot.querySelectorAll('.oc-bubble').length,
             rect: b ? JSON.stringify(b.getBoundingClientRect()) : null }; })()
`);
add('bubble no shadow DOM', bubble?.found === true, JSON.stringify(bubble).slice(0, 160));
add('apenas 1 bubble', bubble?.count === 1, `count=${bubble?.count}`);

console.log('\n== menu de selecao ==');
const menuOk = await P.evaluate(`
  new Promise((resolve) => {
    const p = document.getElementById('alvo');
    if (!p) return resolve({ erro: 'sem #alvo' });
    const r = document.createRange(); r.selectNodeContents(p);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    setTimeout(() => {
      const m = document.getElementById('oc-host').shadowRoot.querySelector('.oc-menu');
      resolve({ hidden: m.hidden, items: m.querySelectorAll('.oc-item').length,
                labels: [...m.querySelectorAll('.oc-lb')].map(e => e.textContent) });
    }, 400);
  })
`);
add('menu aparece na selecao', menuOk?.hidden === false, JSON.stringify(menuOk).slice(0, 200));
add('10 pre-prompts', menuOk?.items === 10, `items=${menuOk?.items}`);

console.log('\n== menu de imagem ==');
const imgMenu = await P.evaluate(`
  new Promise((resolve) => {
    const img = document.getElementById('img');
    if (!img) return resolve({ erro: 'sem #img' });
    img.dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, clientX: 120, clientY: 200 }));
    setTimeout(() => {
      const m = document.getElementById('oc-host').shadowRoot.querySelector('.oc-menu');
      resolve({ hidden: m.hidden, items: m.querySelectorAll('.oc-item').length,
                head: m.querySelector('.oc-menu-head').textContent.trim(),
                skills: m.querySelectorAll('.oc-skill').length });
    }, 400);
  })
`);
add('menu de imagem aparece', imgMenu?.hidden === false, JSON.stringify(imgMenu).slice(0, 200));
add('6 pre-prompts de imagem', imgMenu?.items === 6, `items=${imgMenu?.items}`);
add('rotulo de skill visivel', imgMenu?.skills > 0, `skills=${imgMenu?.skills}`);

console.log('\n== painel ==');
const iframeSrc = await P.evaluate(
  `document.getElementById('oc-host').shadowRoot.querySelector('iframe').src`);
add('iframe -> panel.html', /panel\.html$/.test(iframeSrc || ''), iframeSrc);

await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(3500);

const isOpen = await P.evaluate(
  `document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel').classList.contains('is-open')`);
add('painel abriu no clique', isOpen === true, String(isOpen));

const geo = await P.evaluate(`
  (() => { const p = document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel');
    const r = p.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; })()
`);
add('painel com tamanho util', geo?.w > 300 && geo?.h > 200, JSON.stringify(geo));

const targets2 = await cdp('/json/list');
const panelT = targets2.find((t) => /panel\.html/.test(t.url));
if (panelT) {
  const Q = attach(panelT.webSocketDebuggerUrl, 'painel');
  await Q.ready;
  await Q.send('Runtime.enable');
  // um perfil novo abre a pergunta "qual seu modelo padrao?" e fica esperando
  // resposta; este teste nao responde, entao ja plantamos um modelo escolhido
  await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => {
    const cfg = v.cfg || {};
    cfg.model = { providerID: 'kilo4', id: 'stepfun/step-5-preview-free', variant: 'medium' };
    cfg.modelLabel = '[K4] Step 5 Preview';
    chrome.storage.local.set({ cfg }, () => r(true));
  }))`);
  await sleep(3000);

  // abrir pelo botão começa sessão nova, então o painel já reporta a sessão
  // em vez de "conectado". As duas respostas provam que falou com o servidor.
  const st = await Q.evaluate(`document.getElementById('status').textContent`);
  add('painel falou com o servidor OpenCode', /conectado|pronto|sessão/i.test(st || ''), st);

  const dot = await Q.evaluate(`document.getElementById('statusDot').className`);
  add('indicador de status online', /\bok\b/.test(dot || ''), dot);

  // a UI de skills foi removida: o roteador é injetado automaticamente
  const semSkillsUI = await Q.evaluate(`!document.getElementById('skillsBtn') && !document.getElementById('skillsLabel')`);
  add('sem UI de skills (roteador é automático)', semSkillsUI === true, `skillsBtn=${semSkillsUI}`);
  const eyeOk = await Q.evaluate(`!!document.getElementById('eyeBtn')`);
  add('botão "ver tela" presente', eyeOk === true, String(eyeOk));

  const mdl = await Q.evaluate(`document.getElementById('modelLabel').textContent`);
  console.log('  modelo padrao:', mdl);

  const opts = await Q.evaluate(`document.getElementById('sessionPicker').options.length`);
  add('sessoes listadas', opts > 1, `options=${opts}`);

  const thread = await Q.evaluate(`document.querySelectorAll('#thread .msg').length`);
  console.log('  mensagens no painel:', thread);

  const qErrs = Q.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
  add('painel sem erro de console', qErrs.length === 0, qErrs.slice(0, 2).join(' | '));
  Q.ws.close();
} else {
  add('frame do painel encontrado no CDP', false, 'não listado');
}

const pErrs = P.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
add('pagina sem erro de console', pErrs.length === 0, pErrs.slice(0, 2).join(' | '));

try { proc.kill(); } catch { /* ja encerrado */ }
await sleep(1000);
site.close();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* locks */ }

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) { failed.forEach(([n]) => console.log('  FALHOU: ' + n)); process.exit(1); }
console.log('EXTENSAO OK');
process.exit(0);