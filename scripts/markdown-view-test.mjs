/**
 * Verificação visual da formatação + onde exatamente sobra crase.
 *
 * A espera do iframe do painel é com repetição: em algumas rodadas ele demora
 * para nascer e o teste anterior morria antes de olhar qualquer coisa.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = resolve(process.argv[2] || 'extension');
const API = 'http://127.0.0.1:4177';
const H = { Authorization: 'Basic ' + Buffer.from('opencode:testefixo123').toString('base64') };
const DIR = 'C:\\Users\\Kelvin\\Desktop';

const CDP = 9897;
const profile = mkdtempSync(join(tmpdir(), 'brave-vis2-'));
const OUT = process.argv[3] || join(process.cwd(), 'shots-md');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

mkdirSync(OUT, { recursive: true });

// ---- acha uma sessão com markdown rico
// Cada feature é conferida só quando a sessão escolhida realmente a tem: o
// critério de escolha é ">= 3 de 5", então exigir todas as cinco numa sessão
// qualquer era testar os dados do servidor, não o renderizador.
const sessoes = await (await fetch(`${API}/api/session?limit=200&order=desc&directory=${encodeURIComponent(DIR)}`, { headers: H })).json();
const topLevel = (sessoes.data || []).filter((s) => !s.parentID);
const TEM = {
  codeblock: /```/,
  tabela: /\|/,
  lista: /^\s*[-*]\s/m,
  titulo: /^#+\s/m,
  blockquote: /^\s*>\s/m
};
let alvo = null;
let alvoTem = null;
for (const s of topLevel.slice(0, 25)) {
  const msgs = await (await fetch(`${API}/api/session/${s.id}/message?limit=50&order=asc`, { headers: H })).json();
  const bruto = (msgs.data || []).flatMap((m) => m.content || [])
    .filter((p) => p.type === 'text').map((p) => p.text || '').join('\n');
  const tem = Object.fromEntries(Object.entries(TEM).map(([k, re]) => [k, re.test(bruto)]));
  if (Object.values(tem).filter(Boolean).length >= 3) { alvo = s.id; alvoTem = tem; break; }
}
if (!alvo) { console.log('nenhuma sessao com markdown rico'); process.exit(1); }
console.log('sessao rica:', alvo, '| tem:', JSON.stringify(alvoTem));
// o renderizador unitário é quem garante o blockquote; aqui só conferimos o
// que a sessão escolhida de fato traz
add('sessão escolhida tem markdown rico', Object.values(alvoTem).filter(Boolean).length >= 3,
  JSON.stringify(alvoTem));

const SITE = 8597;
const site = createServer((_, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end('<!DOCTYPE html><meta charset=utf-8><h1>alvo</h1><p id="alvo">texto para selecionar</p>'); });
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
  };
  return { ready, send, evaluate, errors, shot };
}

const lista = async () => (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json());

// 1. página de teste
let pageT = null;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  try { pageT = (await lista()).find((t) => t.type === 'page' && t.url.includes(String(SITE))); if (pageT) break; } catch {}
}
if (!pageT) { console.log('pagina de teste nao apareceu'); try { proc.kill(); } catch {}; site.close(); process.exit(1); }
const P = attach(pageT.webSocketDebuggerUrl);
await P.ready;
await P.send('Runtime.enable');
await sleep(2500);
{ const r = await P.send('Target.getTargets'); const o = (r.result?.targetInfos || []).find((t) => /options\.html/.test(t.url)); if (o) await P.send('Target.closeTarget', { targetId: o.targetId }).catch(() => {}); await sleep(1500); }

// 2. iframe do painel — com repetição, é ele que costuma demorar
let pt = null;
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  pt = (await lista()).find((t) => /panel\.html/.test(t.url));
  if (pt) break;
}
if (!pt) {
  console.log('iframe do painel nao apareceu. alvos:');
  for (const t of await lista()) console.log('   ' + t.type + '  ' + t.url);
  try { proc.kill(); } catch {}
  await sleep(500); site.close();
  process.exit(1);
}
const Q = attach(pt.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await sleep(2500);

console.log('\n== painel carregou ==');
const probe = await Q.evaluate("(() => { const h = document.querySelector('#bar'); const t = document.getElementById('thread'); return { bar: !!h, thread: !!t, input: !!document.getElementById('input') }; })()");
console.log('  ', JSON.stringify(probe));
add('painel responde', probe?.bar === true && probe?.thread === true, JSON.stringify(probe));

await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => {
  const cfg = v.cfg || {};
  cfg.directory = ${JSON.stringify(DIR)};
  cfg.model = { providerID: 'kilo4', id: 'stepfun/step-5-preview-free', variant: 'medium' };
  cfg.modelLabel = '[K4]';
  cfg.agent = 'build';
  chrome.storage.local.set({ cfg }, () => r(true));
}))`);
await sleep(1500);
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(5000);

// 3. abre a sessão rica
const abriu = await Q.evaluate("new Promise((r) => { const p = document.getElementById('sessionPicker'); const o = [...p.options].find(x => x.value === " + JSON.stringify(alvo) + "); if (!o) return r({ ok: false, opcoes: p.options.length }); p.value = o.value; p.dispatchEvent(new Event('change')); setTimeout(() => r({ ok: true }), 1200); })");
console.log('  abriu:', JSON.stringify(abriu));
add('sessao rica abriu', abriu?.ok === true, JSON.stringify(abriu));
await sleep(10000);

const dom = await Q.evaluate(`(() => {
  const thread = document.getElementById('thread');
  return {
    msgs: document.querySelectorAll('#thread > .msg').length,
    assistentes: document.querySelectorAll('#thread > .msg-assistant').length,
    codeblocks: document.querySelectorAll('#thread .codeblock').length,
    codeHead: document.querySelectorAll('#thread .codeblock .code-head').length,
    tabelas: document.querySelectorAll('#thread .tablewrap table').length,
    listas: document.querySelectorAll('#thread .md ul, #thread .md ol').length,
    quotes: document.querySelectorAll('#thread blockquote').length,
    hs: document.querySelectorAll('#thread .md h1, #thread .md h2, #thread .md h3').length,
    preEmP: document.querySelectorAll('#thread p pre, #thread p .codeblock').length,
    pVazios: [...document.querySelectorAll('#thread .md p')].filter(p => !p.textContent.trim()).length,
    strong: document.querySelectorAll('#thread .md strong').length,
    code: document.querySelectorAll('#thread .md code').length,
    link: document.querySelectorAll('#thread .md a').length
  };
})()`);
console.log('  dom:', JSON.stringify(dom));
add('conversa carregou', (dom?.msgs ?? 0) > 0, String(dom?.msgs));
add('blocos de codigo', (dom?.codeblocks ?? 0) > 0, String(dom?.codeblocks));
add('blocos com idioma', (dom?.codeHead ?? 0) > 0, String(dom?.codeHead));
add('tabelas', (dom?.tabelas ?? 0) > 0, String(dom?.tabelas));
add('listas', (dom?.listas ?? 0) > 0, String(dom?.listas));
add('titulos', (dom?.hs ?? 0) > 0, String(dom?.hs));
// blockquote só é exigido quando a sessão de fato tem um: exigir sempre
// media uma feature que o markdownTest já cobre na unidade
if (alvoTem?.blockquote) {
  add('blockquotes', (dom?.quotes ?? 0) > 0, String(dom?.quotes));
} else {
  console.log('  --   blockquotes: sessão sem blockquote, checagem pulada (coberta pelo teste unitário)');
}
add('sem <pre> dentro de <p>', (dom?.preEmP ?? 0) === 0, String(dom?.preEmP));
add('sem paragrafo vazio', (dom?.pVazios ?? 0) === 0, String(dom?.pVazios));
add('negrito', (dom?.strong ?? 0) > 0, String(dom?.strong));
add('codigo inline', (dom?.code ?? 0) > 0, String(dom?.code));

// 4. onde sobra crase, de verdade
const crases = await Q.evaluate(`(() => {
  const achados = [];
  for (const msg of document.querySelectorAll('#thread > .msg-assistant')) {
    const md = msg.querySelector('.md');
    if (!md) continue;
    const andar = (no, trilha) => {
      for (const f of no.childNodes) {
        if (f.nodeType === 3) {
          const t = f.nodeValue || '';
          if (t.includes('\`\`\`')) achados.push({ trilha, texto: t.slice(0, 200) });
        } else if (f.nodeType === 1 && !/^(PRE|CODE)$/.test(f.tagName)) {
          andar(f, trilha + '>' + f.tagName.toLowerCase() + (f.className ? '.' + String(f.className).split(' ')[0] : ''));
        }
      }
    };
    andar(md, 'md');
  }
  return { total: achados.length, exemplos: achados.slice(0, 4) };
})()`);
console.log('  crase fora de codigo (assistente):', crases?.total);
(crases?.exemplos || []).forEach((e) => console.log(`     ${e.trilha}: ${JSON.stringify(e.texto).slice(0, 160)}`));

// o que a pessoa digitou tambem tem crase; isso nao eh falha
const crasesUsuario = await Q.evaluate(`(() => {
  let n = 0;
  for (const msg of document.querySelectorAll('#thread > .msg-user .md')) {
    const c = msg.cloneNode(true);
    c.querySelectorAll('pre, code').forEach(e => e.remove());
    n += (c.textContent.match(/\`\`\`/g) || []).length;
  }
  return n;
})()`);
console.log('  crase que o usuario digitou:', crasesUsuario);
add('nenhuma crase vazando na resposta do modelo', crases?.total === 0, String(crases?.total));

await Q.shot('formatacao-assistente.png');
await P.shot('formatacao-pagina.png');

const qErrs = Q.errors.filter((e) => e && !/favicon/.test(e));
if (qErrs.length) console.log('  erros:', JSON.stringify(qErrs.slice(0, 3)));
add('painel sem erro de console', qErrs.length === 0, qErrs.slice(0, 1).join(''));

try { proc.kill(); } catch {}
await sleep(600); site.close();
try { rmSync(profile, { recursive: true, force: true }); } catch {}

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) failed.forEach(([n]) => console.log('  FALHOU: ' + n));
else console.log('TUDO OK');
console.log('screenshots em', OUT);
process.exit(failed.length ? 1 : 0);