/**
 * Pre-prompts de seleção e de imagem, pelo caminho real.
 *
 * O menu nasce do content script na página. O teste seleciona texto de verdade,
 * clica num item do menu e confere:
 *   - o painel abriu;
 *   - a mensagem que chegou no servidor tem o texto selecionado, a página de
 *     origem e a instrução de adaptar ao contexto;
 *   - o modelo respondeu.
 *
 * Depois repete pelo menu de imagem (botão direito), checando que a imagem
 * segue anexada e que o prompt também manda analisar o contexto da imagem.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = resolve(process.argv[2] || 'extension');
const API = 'http://127.0.0.1:4177';
const H = { Authorization: 'Basic ' + Buffer.from('opencode:testefixo123').toString('base64'), 'Content-Type': 'application/json' };

const CDP = 9901;
const profile = mkdtempSync(join(tmpdir(), 'brave-pre-'));
const OUT = process.argv[3] || join(process.cwd(), 'shots-pre');
const WORK = mkdtempSync(join(tmpdir(), 'oc-pre-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

mkdirSync(OUT, { recursive: true });

const MODEL = { providerID: 'kilo4', id: 'stepfun/step-5-preview-free', variant: 'medium' };

// página com um texto que parece técnica mas é anúncio — o tipo de caso em que
// uma resposta genérica erra feio
const HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Blog da Acme</title><style>body{font:16px system-ui;padding:30px;max-width:640px}</style></head><body>
<h1>Novo plano Acme Pro</h1>
<p id="alvo">O Acme Pro custa R$ 49 por mês e inclui automação de relatórios,
suporte em horário comercial e integração com os principais ERPs do mercado.
Quem assina até sexta-feira ganha três meses de migração assistida.</p>
</body></html>`;

const SITE = 8601;
const site = createServer((_, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(HTML); });
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
  return { ws, ready, send, evaluate, errors, shot };
}

const lista = async () => (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json());

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

let pt = null;
for (let i = 0; i < 40; i++) { await sleep(1000); pt = (await lista()).find((t) => /panel\.html/.test(t.url)); if (pt) break; }
if (!pt) { console.log('painel nao apareceu'); try { proc.kill(); } catch {}; await sleep(400); site.close(); process.exit(1); }
const Q = attach(pt.webSocketDebuggerUrl);
await Q.ready;
await Q.send('Runtime.enable');
await Q.send('Log.enable');
const logsPainel = [];
Q.ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.consoleAPICalled') { logsPainel.push(m.params.args.map(a => (typeof a.value === 'string' ? a.value : JSON.stringify(a.value))).join(' ')); } });
await sleep(2500);

await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => {
  const cfg = v.cfg || {};
  cfg.directory = ${JSON.stringify(WORK)};
  cfg.model = ${JSON.stringify(MODEL)};
  cfg.modelLabel = '[K4]';
  cfg.agent = 'build';
  chrome.storage.local.set({ cfg }, () => r(true));
}))`);
await sleep(1500);

// ---------- 1. selecionar texto abre o menu
console.log('\n== menu de selecao ==');
const menu = await P.evaluate(`new Promise((resolve) => {
  const p = document.getElementById('alvo');
  const r = document.createRange(); r.selectNodeContents(p);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  setTimeout(() => {
    const m = document.getElementById('oc-host').shadowRoot.querySelector('.oc-menu');
    resolve({ visivel: m && !m.hidden, itens: m ? m.querySelectorAll('.oc-item').length : 0,
              rotulos: m ? [...m.querySelectorAll('.oc-lb')].map(e => e.textContent) : [] });
  }, 500);
})`);
console.log('  menu:', JSON.stringify(menu));
add('menu aparece ao selecionar', menu?.visivel === true, JSON.stringify(menu).slice(0, 100));
add('tem os 10 pre-prompts', (menu?.itens ?? 0) === 10, String(menu?.itens));
add('inclui Explicar', (menu?.rotulos || []).includes('Explicar'), JSON.stringify(menu?.rotulos?.slice(0, 4)));

// ---------- 2. clicar num pre-prompt
console.log('\n== clicar em Explicar ==');
const painelAntes = await P.evaluate("!!document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel').classList.contains('is-open')");
console.log('  painel aberto antes:', painelAntes);

const clicou = await P.evaluate(`(() => {
  const m = document.getElementById('oc-host').shadowRoot.querySelector('.oc-menu');
  const item = [...m.querySelectorAll('.oc-item')].find(e => /Explicar/.test(e.textContent));
  if (!item) return { ok: false };
  item.click();
  return { ok: true, rotulo: item.textContent.trim() };
})()`);
console.log('  clicou:', JSON.stringify(clicou));
add('clicou no pre-prompt', clicou?.ok === true);
await sleep(4000);

const painelDepois = await P.evaluate("!!document.getElementById('oc-host').shadowRoot.querySelector('.oc-panel').classList.contains('is-open')");
console.log('  painel aberto depois:', painelDepois);
add('o painel abriu', painelDepois === true, String(painelDepois));

// o eco vem pelo evento de stream (session.inbox.enqueued), entao pode
// levar alguns segundos para pintar na conversa
let eco = '';
for (let i = 0; i < 20 && eco.length < 20; i++) {
  await sleep(500);
  eco = await Q.evaluate(`(() => {
    const u = document.querySelector('#thread .msg-user .md');
    return u ? u.textContent.trim().slice(0, 120) : '';
  })()`);
}
console.log('  eco na conversa:', JSON.stringify(eco));
add('a seleção aparece como mensagem do usuário', eco.length > 20, JSON.stringify(eco));

// ---------- 3. o que foi para o servidor
console.log('\n== prompt no servidor ==');
let principal = null;
for (let i = 0; i < 70; i++) {
  await sleep(2500);
  const sid = await Q.evaluate("document.getElementById('sessionPicker').value");
  if (!sid) continue;
  const msgs = await (await fetch(`${API}/api/session/${sid}/message?limit=20&order=asc`, { headers: H })).json();
  const user = (msgs.data || []).filter((m) => m.type === 'user').pop();
  const txt = user?.payload?.text || user?.text || '';
  if (txt.includes('Acme Pro')) { principal = { txt, files: user?.payload?.files || [], agents: user?.payload?.agents || [] }; break; }
  if (i % 8 === 0) console.log(`  ${(i + 1) * 2.5}s…`);
}

if (!principal) {
  add('o prompt chegou no servidor', false, 'nao achei');
} else {
  const t = principal.txt;
  console.log('  prompt:', JSON.stringify(t.slice(0, 260)));
  add('o prompt chegou no servidor', true);
  add('leva o texto selecionado', t.includes('Acme Pro custa R$ 49'));
  add('leva a página de origem', t.includes('Blog da Acme') && t.includes('URL:'));
  add('manda analisar o contexto', t.includes('analise o contexto'));
  add('manda adaptar ao tipo de material',
    t.includes('técnico, jornalístico, publicitário') || t.includes('Adapte tom'));
  add('mantém a instrução do pre-prompt', /Explique o texto abaixo/.test(t));
  // a injeção das skills continua oculta — confere na TELA, porque o
  // servidor guarda o prompt completo de propósito
  const visto = await Q.evaluate("document.getElementById('thread').textContent");
  add('a injeção das skills não aparece na conversa',
    !visto.includes('CONFIG_OC') && !visto.includes('minhas-skills-unificadas'));

  // o modelo respondeu?
  const sid0 = await Q.evaluate("document.getElementById('sessionPicker').value");
  let partes = '';
  let erroResp = null;
  for (let i = 0; i < 60; i++) {
    await sleep(2500);
    const st = await Q.evaluate("document.getElementById('status').textContent");
    const m2 = await (await fetch(API + '/api/session/' + sid0 + '/message?limit=20&order=asc', { headers: H })).json();
    const ult = (m2.data || []).filter((m) => m.type === 'assistant').pop();
    partes = (ult?.content || []).filter((p) => p.type === 'text').map((p) => p.text || '').join('\n');
    erroResp = ult?.error || null;
    if (erroResp || (partes.trim().length > 20 && !/gerando|tentando/i.test(st || ''))) break;
    if (i % 8 === 0) console.log(`    ${(i + 1) * 2.5}s ${st} (${partes.length} chars)`);
  }
  console.log('  resposta:', JSON.stringify(partes.slice(0, 180)));
  add('o modelo respondeu', partes.trim().length > 20, String(partes.length));
  add('sem erro na resposta', !erroResp, JSON.stringify(erroResp || '').slice(0, 120));
}

// ---------- 4. menu de imagem
console.log('\n== menu de imagem ==');
// volta ao topo e injeta uma imagem na página
await P.evaluate("window.scrollTo(0,0)");
await sleep(500);
// espia o que o content script manda para o painel
await P.evaluate(`window.__vistos = [];
const f = document.getElementById('oc-host').shadowRoot.querySelector('iframe');
const alvo = f.contentWindow;
const orig = alvo.postMessage.bind(alvo);
alvo.postMessage = (m, ...rest) => {
  try { __vistos.push({ tipo: m && m.type, arquivos: m && m.payload && m.payload.files ? m.payload.files.length : 0,
    mime: m && m.payload && m.payload.files && m.payload.files[0] && m.payload.files[0].mime,
    bytes: m && m.payload && m.payload.files && m.payload.files[0] ? (m.payload.files[0].uri || '').length : 0,
    prompt: m && m.payload && m.payload.prompt ? m.payload.prompt.slice(0, 50) : '' }); } catch (e) { __vistos.push({ erro: String(e) }); }
  return orig(m, ...rest);
};
1`);
const imgMenu = await P.evaluate(`new Promise((resolve) => {
  // gera o PNG dentro da propria pagina com canvas: data URL de verdade,
  // que eh o que o content script precisa para anexar
  const c = document.createElement("canvas");
  c.width = 320; c.height = 200;
  const g = c.getContext("2d");
  g.fillStyle = "#1d4ed8"; g.fillRect(0, 0, 320, 200);
  g.fillStyle = "#fff"; g.font = "bold 46px sans-serif";
  g.fillText("MARCA-77", 40, 120);
  const img = document.createElement("img");
  img.id = "ocImgTeste";
  img.src = c.toDataURL("image/png");
  document.body.append(img);
  img.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 200 }));
  setTimeout(() => {
    const m = document.getElementById("oc-host").shadowRoot.querySelector(".oc-menu");
    resolve({ visivel: m && !m.hidden, itens: m ? m.querySelectorAll(".oc-item").length : 0,
              rotulos: m ? [...m.querySelectorAll(".oc-lb")].map(e => e.textContent) : [] });
  }, 500);
})`);
console.log('  menu:', JSON.stringify(imgMenu));
add('tem os 6 pre-prompts de imagem', (imgMenu?.itens ?? 0) === 6, String(imgMenu?.itens));

const clicouImg = await P.evaluate(`(() => {
  const m = document.getElementById('oc-host').shadowRoot.querySelector('.oc-menu');
  const item = [...m.querySelectorAll('.oc-item')].find(e => /Ler texto/.test(e.textContent));
  if (!item) return { ok: false };
  item.click();
  return { ok: true, rotulo: item.textContent.trim() };
})()`);
console.log('  clicou:', JSON.stringify(clicouImg));
add('clicou no pre-prompt de imagem', clicouImg?.ok === true);

await sleep(4000);
// a miniatura aparece antes do envio, mas o send limpa os anexos no fim;
// o que prova que a imagem chegou eh o payload no servidor
let imgNoServidor = null;
let ultimoUser = null;
for (let i = 0; i < 40; i++) {
  await sleep(2500);
  const sid = await Q.evaluate("document.getElementById('sessionPicker').value");
  if (!sid) continue;
  const m3 = await (await fetch(API + '/api/session/' + sid + '/message?limit=20&order=asc', { headers: H })).json();
  const users = (m3.data || []).filter((m) => m.type === 'user');
  const u = users[users.length - 1];
  if (u) {
    // a API as vezes devolve plano (msg.files) e as vezes aninhado (msg.payload.files)
    const arq = u.files || u.payload?.files || [];
    ultimoUser = {
      texto: (u.text || u.payload?.text || '').slice(0, 90),
      arquivos: arq.length,
      mime: arq[0]?.mime,
      bytes: (arq[0]?.data || arq[0]?.uri || '').length
    };
    if (arq.length) { imgNoServidor = ultimoUser; break; }
  }
}
console.log('  ultima mensagem do usuario:', JSON.stringify(ultimoUser));
// despejo cru: as vezes o arquivo está num campo que eu não estou olhando
const cru = await Q.evaluate("(() => { const p = document.getElementById('sessionPicker'); const o = p.options[p.selectedIndex]; return o ? o.value : ''; })()");
if (cru) {
  const m4 = await (await fetch(API + '/api/session/' + cru + '/message?limit=10&order=asc', { headers: H })).json();
  const us = (m4.data || []).filter((x) => x.type === 'user');
  if (us.length) {
    const ult = us[us.length - 1];
    console.log('  payload cru:', JSON.stringify({
      chaves: Object.keys(ult),
      payloadChaves: Object.keys(ult.payload || {}),
      files: ult.files || (ult.payload ? ult.payload.files : null),
      textoTam: (ult.text || (ult.payload ? ult.payload.text : '') || '').length
    }).slice(0, 700));
  }
}
const telaImg = await Q.evaluate("(() => ({ bolhas: document.querySelectorAll('#thread .msg').length, anexos: document.querySelectorAll('#attachments img').length, toast: document.querySelector('.toast')?.textContent || '', status: document.getElementById('status').textContent }))()");
console.log('  painel:', JSON.stringify(telaImg));
add('a imagem foi anexada ao prompt', !!imgNoServidor && imgNoServidor.arquivos > 0, JSON.stringify(imgNoServidor || ultimoUser));
console.log('  console do painel:', JSON.stringify(logsPainel.filter(l => String(l).includes('__DBG_'))));
const vistos = await P.evaluate('JSON.stringify(window.__vistos || [])');
console.log('  payloads para o painel:', vistos);

const qErrs = Q.errors.filter((e) => e && !/favicon/.test(e));
if (qErrs.length) console.log('  erros:', JSON.stringify(qErrs.slice(0, 3)));
add('painel sem erro de console', qErrs.length === 0, qErrs.slice(0, 1).join(''));
await Q.shot('preprompt-texto.png');

try { proc.kill(); } catch {}
await sleep(600); site.close();
const sessoes = await (await fetch(`${API}/api/session?limit=30&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json();
for (const s of sessoes.data || []) await fetch(`${API}/api/session/${s.id}`, { method: 'DELETE', headers: H }).catch(() => {});
try { rmSync(WORK, { recursive: true, force: true }); } catch {}
try { rmSync(profile, { recursive: true, force: true }); } catch {}

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) failed.forEach(([n]) => console.log('  FALHOU: ' + n));
else console.log('TUDO OK');
console.log('screenshots em', OUT);
process.exit(failed.length ? 1 : 0);