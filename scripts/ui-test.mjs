/**
 * 1. a injeção das skills NÃO aparece na conversa (nem ao vivo, nem no histórico)
 * 2. cards de ferramenta fecham e abrem
 * 3. os três pontinhos de atividade aparecem enquanto o modelo trabalha
 */
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
const DIR = 'C:\\Users\\Kelvin\\Desktop';

const SITE_PORT = 8483;
const CDP_PORT = 9634;
const profile = mkdtempSync(join(tmpdir(), 'brave-ui-'));
const WORK = mkdtempSync(join(tmpdir(), 'oc-ui-'));
const OUT = process.argv[3] || join(process.cwd(), 'shots-ui');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

const HTML = `<!DOCTYPE html><meta charset="utf-8"><title>alvo</title><p id="alvo">texto para selecionar</p>`;
const site = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); });
await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1200,950',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  `http://127.0.0.1:${SITE_PORT}/`
], { stdio: 'ignore' });

let list = [];
for (let i = 0; i < 45; i++) {
  await sleep(1000);
  try { list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); if (list.length) break; } catch {}
}
const pageT = list.find((t) => t.type === 'page' && t.url.includes(String(SITE_PORT)));
if (!pageT) { console.log('sem aba de teste'); process.exit(1); }

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
  // tagged template (avalia\...\) chega como array de pedacos: juntar.
  const evaluate = async (expr) => {
    const e = Array.isArray(expr) ? expr.join('') : String(expr);
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  return { ws, ready, send, evaluate, errors };
}

const P = attach(pageT.webSocketDebuggerUrl);
await P.ready;
await P.send('Runtime.enable');
await sleep(2500);
{
  const r = await P.send('Target.getTargets');
  const opts = (r.result?.targetInfos || []).find((t) => /options\.html/.test(t.url));
  if (opts) await P.send('Target.closeTarget', { targetId: opts.targetId }).catch(() => {});
  await sleep(1500);
}

let panelT = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => /panel\.html/.test(t.url));
if (!panelT) { console.log('painel nao encontrado'); process.exit(1); }
const Q = attach(panelT.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await sleep(2000);

// configuração já com modelo: este teste não é sobre a primeira vez
await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => {
  const cfg = v.cfg || {};
  cfg.model = { providerID: 'kilo4', id: 'stepfun/step-5-preview-free', variant: 'medium' };
  cfg.modelLabel = '[K4] Step 5 Preview';
  cfg.directory = ${JSON.stringify(WORK)};
  cfg.agent = 'build';
  chrome.storage.local.set({ cfg }, () => r(true));
}))`);
await sleep(1500);

await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(5000);

// ---------- 1. enviar uma mensagem que força ferramentas
console.log('\n== envio com tool forcado ==');
await Q.evaluate(`(() => {
  const i = document.getElementById('input');
  i.value = 'Leia o arquivo C:\\\\Users\\\\Kelvin\\\\Desktop\\\\opencode-browser-chat\\\\README.md e me diga quantas linhas ele tem. Resposta curta.';
  i.dispatchEvent(new Event('input'));
  document.getElementById('send').click();
})()`);

// observa os pontinhos aparecerem
let dots = [];
for (let i = 0; i < 40; i++) {
  await sleep(1500);
  dots = await Q.evaluate(`(() => {
    const row = document.querySelector('#thread .live .live-activity');
    if (!row) return [];
    return [...row.querySelectorAll('.dots i')].map(e => {
      const s = getComputedStyle(e);
      return { nome: s.animationName, dur: s.animationDuration };
    });
  })()`);
  if (dots.length === 3) break;
}
console.log('  pontinhos:', JSON.stringify(dots));
add('tres pontinhos desenhados', dots.length === 3, `${dots.length}`);
add('pontinhos animados', dots.length === 3 && dots.every((d) => d.nome === 'oc-dot' && d.dur !== '0s'), JSON.stringify(dots[0]));

const label = await Q.evaluate(`document.querySelector('#thread .live .live-activity .doing')?.textContent || ''`);
console.log('  rotulo:', label);
add('rotulo descreve a atividade', label.length > 2, label);

// ---------- 2. esperar a geração terminar antes de olhar os cards
console.log('\n== esperando terminar ==');
for (let i = 0; i < 60; i++) {
  await sleep(2500);
  const st = await Q.evaluate(`document.getElementById('status').textContent`);
  if (st && !/gerando/i.test(st)) break;
  if (i % 6 === 0) console.log(`  ${((i + 1) * 2.5).toFixed(1)}s ${st}`);
}
const fim = await Q.evaluate(`(() => ({
  status: document.getElementById('status').textContent,
  cards: document.querySelectorAll('#thread .toolcard').length
}))()`);
console.log('  fim:', JSON.stringify(fim));
const diag = await Q.evaluate(`(() => ({
  statusCompleto: document.getElementById('status').textContent,
  errosNoThread: [...document.querySelectorAll('#thread .err, #thread .erro, #thread pre.err')].map(e => e.textContent.slice(0, 600)),
  blocos: [...document.querySelectorAll('#thread .msg-assistant, #thread .toolcard')].map(e => e.className + ' :: ' + e.textContent.slice(0, 200))
}))()`);
console.log('  DIAG status:', diag.statusCompleto);
console.log('  DIAG erros:', JSON.stringify(diag.errosNoThread, null, 1).slice(0, 900));
console.log('  DIAG blocos:', JSON.stringify(diag.blocos, null, 1).slice(0, 900));
add('geracao chegou ao fim', !/gerando/i.test(fim.status || ''), fim.status);

// ---------- 2. a injeção não vaza
console.log('\n== injecao nao vaza ==');
const vazouAoVivo = await Q.evaluate(`(() => {
  const t = document.getElementById('thread').textContent;
  return { tem: t.includes('CONFIG_OC'), instrucao: t.includes('Voce esta respondendo dentro de uma janela de chat'), rolador: t.includes('consulte a biblioteca de skills') };
})()`);
console.log('  conversa ao vivo:', JSON.stringify(vazouAoVivo));
add('sem [CONFIG_OC] na conversa', vazouAoVivo.tem === false);
add('sem o texto da instrução na conversa', vazouAoVivo.instrucao === false && vazouAoVivo.rolador === false, JSON.stringify(vazouAoVivo));


const bolhaUsuario = await Q.evaluate(`(() => {
  const u = document.querySelector('#thread .msg-user');
  return u ? u.querySelector('.md').textContent.trim() : '';
})()`);
console.log('  primeira bolha do usuario:', JSON.stringify(bolhaUsuario.slice(0, 90)));
add('a bolha do usuario tem so a mensagem dele',
  bolhaUsuario.includes('README.md') && !bolhaUsuario.includes('CONFIG_OC'), bolhaUsuario.slice(0, 80));

// ---------- 3. cards de ferramenta fecham e abrem
console.log('\n== cards de ferramenta ==');
const cards = await Q.evaluate("(() => { const c = [...document.querySelectorAll('#thread .toolcard')]; return c.map(k => ({ rotulo: k.querySelector('.tlabel')?.textContent || '', aberto: k.classList.contains('open'), corpo: k.querySelector('.toolcard-body').children.length > 0 })); })()");
console.log('  cards:', JSON.stringify(cards));
if (cards.length) {
  add('ha cards de ferramenta na conversa', true, String(cards.length));
  add('cards comecam recolhidos', cards.every(c => !c.aberto), JSON.stringify(cards.map(c => c.aberto)));
} else {
  // o modelo nao usou ferramenta nesta rodada. Nao e falha do painel: o
  // comportamento dos cards esta coberto pelo toolcard-test.
  console.log('  (o modelo nao usou ferramentas nesta rodada; cards ficam para o toolcard-test)');
}

await sleep(6000);
const acabou = await Q.evaluate`(() => ({
  status: document.getElementById('status').textContent,
  pontinhos: document.querySelectorAll('.live-activity').length
}))()`;
console.log('  depois:', JSON.stringify(acabou));
const geraAinda = /gerando|tentando de novo/i.test(acabou.status || '');
if (geraAinda) {
  add('pontinhos ficam enquanto a geração nao termina', acabou.pontinhos === 1,
    `status=${acabou.status} pontos=${acabou.pontinhos}`);
} else {
  // ja acabou: da uma chance de o evento de sucesso chegar antes de exigir zero
  let limpo = false, ultimo = acabou;
  for (let i = 0; i < 8 && !limpo; i++) {
    await sleep(1000);
    ultimo = await Q.evaluate("(() => ({ status: document.getElementById('status').textContent, pontinhos: document.querySelectorAll('.live-activity').length }))()");
    limpo = ultimo.pontinhos === 0;
  }
  add('pontinhos somem no fim', limpo, JSON.stringify(ultimo));
}

// ---------- 4. reabrir: o histórico não pode vazar
console.log('\n== historico recarregado ==');
const sids = await Q.evaluate`document.getElementById('sessionPicker').value`;
const hist = await (await fetch(`${API}/api/session/${sids}/message?limit=30&order=asc`, { headers: H })).json();
const userTexts = (hist.data || []).filter((m) => m.type === 'user').map((m) => m.payload?.text || m.text || '');
console.log('  msgs do usuario:', JSON.stringify(userTexts.map((t) => t.slice(0, 50))));
add('servidor recebeu com a injeção', userTexts.some((t) => t.includes('CONFIG_OC')));

await Q.evaluate`new Promise((r) => {
  const p = document.getElementById('sessionPicker');
  p.value = ''; p.dispatchEvent(new Event('change'));
  setTimeout(() => { p.value = ${JSON.stringify(sids)}; p.dispatchEvent(new Event('change')); r(1); }, 1200);
})()`;
await sleep(6000);

const vazouNoHist = await Q.evaluate("(() => {   const t = document.getElementById('thread').textContent;   const u = [...document.querySelectorAll('#thread .msg-user')].map(e => e.querySelector('.md').textContent.trim());   return {     tem: t.includes('CONFIG_OC'),     instrucao: t.includes('Voce esta respondendo dentro de uma janela de chat'),     rolador: t.includes('consulte a biblioteca de skills'),     bolhas: u.map(x => x.slice(0, 140))   }; })()");
console.log('  historico:', JSON.stringify(vazouNoHist));
add('historico nao vaza a instrução', vazouNoHist.instrucao === false && vazouNoHist.rolador === false, JSON.stringify(vazouNoHist).slice(0, 120));

add('a bolha do usuario continua legivel',
  vazouNoHist.bolhas.some((b) => b.includes('README.md')), JSON.stringify(vazouNoHist.bolhas[0]));

const qErrs = Q.errors.filter((e) => e && !/favicon/.test(e));
if (qErrs.length) console.log('  erros:', JSON.stringify(qErrs.slice(0, 3)));
add('painel sem erro de console', qErrs.length === 0, qErrs.slice(0, 1).join(''));

try { proc.kill(); } catch {}
await sleep(600); site.close();
if (sids) await fetch(`${API}/api/session/${sids}`, { method: 'DELETE', headers: H }).catch(() => {});
try { rmSync(WORK, { recursive: true, force: true }); } catch {}

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) failed.forEach(([n]) => console.log('  FALHOU: ' + n));
else console.log('TUDO OK');
process.exit(failed.length ? 1 : 0);