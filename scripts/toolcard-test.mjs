/** Cards de ferramenta: recolhidos por padrão, e abrem/fecham no clique.
 *  Usa uma sessao historica com tools de verdade (a do parts-render-test),
 *  entao nao depende de geracao ao vivo — so do render do historico. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = resolve(process.argv[2] || 'extension');
const API = 'http://127.0.0.1:4177';
const PW = 'testefixo123';
const H = { Authorization: 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64'), 'Content-Type': 'application/json' };
const OUT = process.argv[3] || join(process.cwd(), 'shots-cards');

const CDP_PORT = 9751;
const profile = mkdtempSync(join(tmpdir(), 'brave-card-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

// acha uma sessao que tenha tool cards no historico
const sessoes = await (await fetch(`${API}/api/session?limit=100&order=desc&directory=${encodeURIComponent('C:\\Users\\Kelvin\\Desktop')}`, { headers: H })).json();
let alvo = null;
for (const s of sessoes.data || []) {
  const msgs = await (await fetch(`${API}/api/session/${s.id}/message?limit=50&order=asc`, { headers: H })).json();
  const tools = (msgs.data || []).flatMap((m) => m.content || []).filter((p) => p.type === 'tool');
  const read = tools.find((p) => (p.name || '') === 'read');
  const edit = tools.find((p) => (p.name || '') === 'edit' || (p.name || '') === 'write');
  if (read && edit) { alvo = { id: s.id, read: read.id, edit: edit.id, nomes: tools.map((p) => p.name).slice(0, 8) }; break; }
}
if (!alvo) { console.log('nenhuma sessao com read+edit no historico'); process.exit(1); }
console.log('sessao:', alvo.id, '| tools:', JSON.stringify(alvo.nomes));

const SITE = 8551;
const site = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!DOCTYPE html><meta charset="utf-8"><h1>alvo</h1>'); });
await new Promise((r) => site.listen(SITE, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  `http://127.0.0.1:${SITE}/`
], { stdio: 'ignore' });

let list = [];
for (let i = 0; i < 45; i++) {
  await sleep(1000);
  try { list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); if (list.length) break; } catch {}
}
const pageT = list.find((t) => t.type === 'page' && t.url.includes(String(SITE)));

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

const P = attach(pageT.webSocketDebuggerUrl);
await P.ready;
await P.send('Runtime.enable');
await sleep(2500);
{
  const r = await P.send('Target.getTargets');
  const o = (r.result?.targetInfos || []).find((t) => /options\.html/.test(t.url));
  if (o) await P.send('Target.closeTarget', { targetId: o.targetId }).catch(() => {});
  await sleep(1500);
}

let panelT = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => /panel\.html/.test(t.url));
if (!panelT) { console.log('painel nao encontrado'); process.exit(1); }
const Q = attach(panelT.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await sleep(2000);

await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => {
  const cfg = v.cfg || {};
  cfg.directory = 'C:\\Users\\Kelvin\\Desktop';
  cfg.model = { providerID: 'kilo4', id: 'stepfun/step-5-preview-free', variant: 'medium' };
  cfg.modelLabel = '[K4] Step 5 Preview';
  chrome.storage.local.set({ cfg }, () => r(true));
}))`);
await sleep(1500);
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(4500);

// abre a sessao com tools no historico
await Q.evaluate(`new Promise((r) => {
  const p = document.getElementById('sessionPicker');
  const o = [...p.options].find(x => x.value === ${JSON.stringify(alvo.id)});
  if (!o) return r({ ok: false });
  p.value = o.value; p.dispatchEvent(new Event('change'));
  setTimeout(() => r({ ok: true }), 1000);
})()`);
await sleep(7000);

const estado = await Q.evaluate(`(() => {
  const cards = [...document.querySelectorAll('#thread .toolcard')];
  return {
    total: cards.length,
    comCorpo: cards.filter(k => k.querySelector('.toolcard-body').children.length > 0).length,
    abertos: cards.filter(k => k.classList.contains('open')).length,
    corposVisiveis: cards.filter(k => k.querySelector('.toolcard-body').offsetHeight > 0).length,
    rotulos: cards.slice(0, 6).map(k => k.querySelector('.tlabel')?.textContent)
  };
})()`);
console.log('  cards:', JSON.stringify(estado));
add('ha cards de ferramenta', estado.total > 0, `${estado.total}`);
add('todos comecam recolhidos', estado.abertos === 0, `abertos=${estado.abertos}`);
add('nenhum corpo visivel de saida', estado.corposVisiveis === 0, `visiveis=${estado.corposVisiveis}`);
add('cards tem rotulo', (estado.rotulos || []).every((r) => !!r), JSON.stringify(estado.rotulos));

const um = await Q.evaluate(`(() => {
  const k = [...document.querySelectorAll('#thread .toolcard')].find(c => c.querySelector('.toolcard-body').children.length > 0);
  return k ? { rotulo: k.querySelector('.tlabel').textContent, i: [...document.querySelectorAll('#thread .toolcard')].indexOf(k) } : null;
})()`);
console.log('  alvo do clique:', JSON.stringify(um));

if (um) {
  const clic = await Q.evaluate(`(() => {
    const k = [...document.querySelectorAll('#thread .toolcard')][${um.i}];
    k.querySelector('.toolcard-head').click();
    return {
      aberto: k.classList.contains('open'),
      corpo: k.querySelector('.toolcard-body').offsetHeight > 0,
      caret: k.querySelector('.caret').textContent,
      aria: k.querySelector('.toolcard-head').getAttribute('aria-expanded')
    };
  })()`);
  console.log('  1 clique:', JSON.stringify(clic));
  add('clicar abre o corpo', clic.aberto === true && clic.corpo === true, JSON.stringify(clic));
  add('caret muda', typeof clic.caret === 'string' && clic.caret.length === 1, clic.caret);

  const clic2 = await Q.evaluate(`(() => {
    const k = [...document.querySelectorAll('#thread .toolcard')][${um.i}];
    k.querySelector('.toolcard-head').click();
    return {
      aberto: k.classList.contains('open'),
      corpo: k.querySelector('.toolcard-body').offsetHeight > 0,
      aria: k.querySelector('.toolcard-head').getAttribute('aria-expanded')
    };
  })()`);
  console.log('  2 clique:', JSON.stringify(clic2));
  add('clicar de novo fecha o corpo', clic2.aberto === false && clic2.corpo === false, JSON.stringify(clic2));
  add('cabeçalho expõe o estado', clic.aria === 'true' && clic2.aria === 'false', `${clic.aria}/${clic2.aria}`);

  // o diff do edit continua la dentro
  const expr = '(() => { const k = [...document.querySelectorAll("#thread .toolcard")][' + um.i +
    ']; k.querySelector(".toolcard-head").click(); return k.querySelector(".toolcard-body").innerHTML.slice(0, 200); })()';
  const conteudo = await Q.evaluate(expr);
  console.log('  conteudo:', JSON.stringify(conteudo).slice(0, 180));
  add('o corpo tem o diff/saida', /diff|tool-out/.test(conteudo || ''), JSON.stringify(conteudo).slice(0, 80));
} else {
  console.log('  (nenhum card com corpo)');
}

const qErrs = Q.errors.filter((e) => e && !/favicon/.test(e));
if (qErrs.length) console.log('  erros:', JSON.stringify(qErrs.slice(0, 2)));
add('painel sem erro de console', qErrs.length === 0, qErrs.slice(0, 1).join(''));

try { proc.kill(); } catch {}
await sleep(600); site.close();
try { rmSync(profile, { recursive: true, force: true }); } catch {}

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) failed.forEach(([n]) => console.log('  FALHOU: ' + n));
else console.log('TUDO OK');
process.exit(failed.length ? 1 : 0);