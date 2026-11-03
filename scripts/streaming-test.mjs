/**
 * Streaming ao vivo: o texto aparece enquanto gera, continua na tela quando
 * termina, e a pergunta vem ANTES da resposta.
 *
 * Antes, `finalizeLive()` chamava `clearLive()`, que removia o balão do DOM:
 * a resposta sumia da tela e só voltava ao fechar/reabrir o painel. E o
 * balão do modelo nascia no `send()`, antes do SSE devolver a mensagem do
 * usuário — então a resposta aparecia acima da pergunta.
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
const H = { Authorization: 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64') };

const SITE = 8761;
const CDP = 9761;
const profile = mkdtempSync(join(tmpdir(), 'brave-stream-'));
const WORK = mkdtempSync(join(tmpdir(), 'oc-stream-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => {
  checks.push([n, !!c, x]);
  console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`);
};

const site = createServer((_, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end('<!DOCTYPE html><meta charset="utf-8"><h1>alvo</h1>');
});
await new Promise((r) => site.listen(SITE, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1100,900',
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
      errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    }
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

const panelT = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json())
  .find((t) => /panel\.html/.test(t.url));
if (!panelT) { console.log('painel nao encontrado'); process.exit(1); }
const Q = attach(panelT.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await Q.send('Page.enable');
await sleep(2000);

await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => {
  const cfg = v.cfg || {};
  cfg.directory = ${JSON.stringify(WORK)};
  cfg.model = { providerID: 'opencode', id: 'space-bunny-free' };
  cfg.modelLabel = 'Space Bunny Free';
  cfg.useSameVisionModel = true;
  cfg.visionModel = null;
  chrome.storage.local.set({ cfg }, () => r(true));
}))`);
await P.evaluate(`document.getElementById('oc-host').shadowRoot.querySelector('.oc-bubble').click()`);
await sleep(5000);

//_snapshot: a ordem dos balões + o texto de cada um
const snap = () => Q.evaluate(`(() => {
  const t = document.getElementById('thread');
  const msgs = [...t.querySelectorAll(':scope > .msg')];
  return {
    ordem: msgs.map((m) => m.classList.contains('msg-user') ? 'user' : 'assistente'),
    live: msgs.filter((m) => m.classList.contains('live')).length,
   userTexto: (t.querySelector('.msg-user .bubble')?.innerText || '').slice(0, 80),
    assistenteTexto: (t.querySelector('.msg-assistant .bubble')?.innerText || '').slice(0, 80),
    assistenteBolos: t.querySelectorAll('.msg-assistant').length,
    cursor: t.querySelectorAll('.cursor').length,
    status: document.getElementById('status').textContent
  };
})()`);

// ------------------------------------------------------------ envio
console.log('\n== 1. o texto aparece enquanto gera ==');

const PERGUNTA = 'Responde com uma frase curta sobre cores.';
await Q.evaluate(`(() => {
  const i = document.getElementById('input');
  i.value = ${JSON.stringify(PERGUNTA)};
  i.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('send').click();
  return true;
})()`);

// observa enquanto o modelo escreve
let viuParcial = false;
let viuUsuarioAntes = null;
for (let i = 0; i < 90; i++) {
  await sleep(700);
  const s = await snap();
  const txt = s?.assistenteTexto || '';
  if (txt.trim().length > 0 && /pensando/.test(s.status + txt)) viuParcial = true;
  if (!viuUsuarioAntes && s?.userTexto) {
    viuUsuarioAntes = { ordem: s.ordem, idxUser: s.ordem.indexOf('user'), idxAss: s.ordem.indexOf('assistente') };
  }
  if (/pronto/i.test(s?.status || '')) break;
}

const durante = await snap();
console.log('  durante:', JSON.stringify(durante).slice(0, 260));

add('a mensagem do usuário aparece', (durante?.userTexto || '').length > 0, durante?.userTexto);
add('o modelo começa a responder na tela', (durante?.assistenteTexto || '').length > 0, durante?.assistenteTexto);
add('a resposta tem conteúdo além do cursor',
  (durante?.assistenteTexto || '').replace(/pensando…?/g, '').trim().length > 0,
  JSON.stringify((durante?.assistenteTexto || '').slice(-60)));

// ------------------------------------------------------------ ordem
console.log('\n== 2. a pergunta vem antes da resposta ==');
console.log('  ordem dos balões:', JSON.stringify(durante?.ordem));
add('a conversa começa pelo usuário',
  durante?.ordem?.[0] === 'user', JSON.stringify(durante?.ordem));
add('a resposta vem depois da pergunta',
  durante?.ordem?.indexOf('assistente') > 0, JSON.stringify(durante?.ordem));
add('não há dois balões de usuário',
  (durante?.ordem || []).filter((r) => r === 'user').length === 1,
  JSON.stringify(durante?.ordem));

// ------------------------------------------------------------ depois
console.log('\n== 3. a resposta continua na tela depois de terminar ==');
// espera o status virar "pronto"
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  const s = await Q.evaluate(`document.getElementById('status').textContent`);
  if (/pronto/i.test(s || '')) break;
}
await sleep(1500);

const depois = await snap();
console.log('  depois:', JSON.stringify(depois).slice(0, 300));

add('a resposta NÃO foi apagada ao terminar',
  (depois?.assistenteTexto || '').trim().length > 0, JSON.stringify((depois?.assistenteTexto || '').slice(0, 90)));
add('não sobrou balão "live" depois de pronto',
  (depois?.live || 0) === 0, `live=${depois?.live}`);
add('o cursor de digitação sumiu', (depois?.cursor || 0) === 0, `cursor=${depois?.cursor}`);
add('a ordem continua usuário -> resposta',
  depois?.ordem?.[0] === 'user' && (depois?.ordem || []).indexOf('assistente') > 0,
  JSON.stringify(depois?.ordem));
add('o botão de parar virou o de enviar',
  (await Q.evaluate(`(() => ({
    stop: document.getElementById('stop').hidden,
    send: document.getElementById('send').hidden
  }))()`))?.stop === true,
  JSON.stringify(await Q.evaluate(`(() => ({
    stop: document.getElementById('stop').hidden,
    send: document.getElementById('send').hidden
  }))()`)));

// a prova mais dura: o texto da tela tem que bater com o do servidor
{
  const sessoes = (await (await fetch(`${API}/api/session?limit=10&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || [];
  let doServidor = '';
  for (const s of sessoes.filter((x) => !x.parentID).slice(0, 3)) {
    const msgs = (await (await fetch(`${API}/api/session/${s.id}/message?limit=20&order=asc`, { headers: H })).json()).data || [];
    for (const m of msgs.filter((x) => x.type === 'assistant')) {
      for (const p of (m.content || [])) if (p.type === 'text' && p.text) doServidor += p.text + '\n';
    }
    if (doServidor.trim()) break;
  }
  const naTela = (depois?.assistenteTexto || '').trim();
  const alvo = doServidor.trim().slice(0, 40);
  console.log('  servidor:', JSON.stringify(doServidor.trim().slice(0, 90)));
  console.log('  na tela:', JSON.stringify(naTela.slice(0, 90)));
  add('o que está na tela é a resposta do servidor',
    !!alvo && naTela.length > 0 && naTela.replace(/\s+/g, ' ').includes(alvo.replace(/\s+/g, ' ').slice(0, 25)),
    `tela=${JSON.stringify(naTela.slice(0, 60))}`);
}

// ------------------------------------------------------------ Fechar/abrir
console.log('\n== 4. recarregar a sessão pelo seletor não duplica ==');
// clicar no bubble abre uma sessão NOVA (comportamento proposital), então
// para revisitar a conversa o caminho é o seletor de sessão
const sid = await Q.evaluate(`document.getElementById('sessionPicker').value`);
console.log('  sessão em foco:', sid);

// sai para outra sessão e volta
await Q.evaluate(`(() => {
  const p = document.getElementById('sessionPicker');
  const outra = [...p.options].find((o) => o.value && o.value !== p.value);
  if (outra) { p.value = outra.value; p.dispatchEvent(new Event('change')); }
  return !!outra;
})()`);
await sleep(3500);

const trocou = await snap();
console.log('  trocou:', JSON.stringify(trocou).slice(0, 160));

await Q.evaluate(`(() => {
  const p = document.getElementById('sessionPicker');
  p.value = ${JSON.stringify(sid)};
  p.dispatchEvent(new Event('change'));
  return true;
})()`);
await sleep(4000);

const reaberto = await snap();
console.log('  reaberto:', JSON.stringify(reaberto).slice(0, 220));

// quantos assistentes o servidor realmente tem? se o DOM tiver mais, é
// duplicação no render; se tiver o mesmo, o modelo mandou duas mensagens
let hist = null;
{
  const sessoes = (await (await fetch(`${API}/api/session?limit=10&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || [];
  for (const s of sessoes.filter((x) => !x.parentID).slice(0, 3)) {
    const msgs = (await (await fetch(`${API}/api/session/${s.id}/message?limit=40&order=asc`, { headers: H })).json()).data || [];
    if (msgs.some((m) => m.type === 'assistant')) {
      hist = {
        tipos: msgs.map((m) => `${m.type}:${(m.content || []).map((p) => p.type).join('+') || '?'}`),
        assistentes: msgs.filter((m) => m.type === 'assistant').length
      };
      break;
    }
  }
}
console.log('  histórico:', JSON.stringify(hist));

add('sair e voltar não duplica o usuário',
  (reaberto?.ordem || []).filter((r) => r === 'user').length === 1, JSON.stringify(reaberto?.ordem));
add('o DOM bate com o histórico do servidor',
  !!hist && (reaberto?.assistenteBolos || 0) === hist.assistentes,
  `DOM=${reaberto?.assistenteBolos} servidor=${hist?.assistentes} tipos=${JSON.stringify(hist?.tipos)}`);
add('a resposta reaparece ao voltar para a sessão',
  (reaberto?.assistenteTexto || '').trim().length > 0, JSON.stringify((reaberto?.assistenteTexto || '').slice(0, 70)));

const pErrs = P.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
const qErrs = Q.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
add('painel sem erro de console', qErrs.length === 0, qErrs.slice(0, 2).join(' | '));
add('pagina sem erro de console', pErrs.length === 0, pErrs.slice(0, 2).join(' | '));

try { proc.kill(); } catch { /* ok */ }
await sleep(800); site.close();
for (const s of (await (await fetch(`${API}/api/session?limit=10&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || []) {
  if (!s.parentID) await fetch(`${API}/api/session/${s.id}`, { method: 'DELETE', headers: H }).catch(() => {});
}
try { rmSync(profile, { recursive: true, force: true }); } catch { /* lock */ }
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* lock */ }

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) { failed.forEach(([n]) => console.log('  FALHOU: ' + n)); process.exit(1); }
console.log('TUDO OK');
process.exit(0);