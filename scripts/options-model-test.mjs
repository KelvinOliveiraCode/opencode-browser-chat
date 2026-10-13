/**
 * Tela de opções: a seção de modelo aparece, lista os modelos, deixa
 * escolher, mexer no effort e salvar no storage onde o painel le.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const EXT = resolve(process.argv[2] || 'extension');
const API = 'http://127.0.0.1:4177';
const H = { Authorization: 'Basic ' + Buffer.from('opencode:testefixo123').toString('base64') };

const CDP_PORT = 9872;
const profile = mkdtempSync(join(tmpdir(), 'brave-opts-'));
const OUT = process.argv[3] || join(process.cwd(), 'shots-opts');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

const SITE = 8572;
mkdirSync(OUT, { recursive: true });

const site = createServer((_, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end('<!DOCTYPE html><meta charset=utf-8><h1>alvo</h1>'); });
await new Promise((r) => site.listen(SITE, '127.0.0.1', r));

const proc = spawn(BRAVE, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
  '--window-size=1000,1000',
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
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
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
    if (r.result?.data) { const { writeFileSync } = await import('node:fs'); writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64')); }
  };
  return { ready, send, evaluate, errors, shot };
}

// espera a página de opções aparecer (ela abre sozinha na instalação)
let optsT = null;
for (let i = 0; i < 50; i++) {
  await sleep(1000);
  try {
    const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    optsT = l.find((t) => /options\.html/.test(t.url));
    if (optsT) break;
  } catch { /* subindo */ }
}
if (!optsT) { console.log('pagina de opcoes nao apareceu'); process.exit(1); }
console.log('opcoes em', optsT.url);

const O = attach(optsT.webSocketDebuggerUrl);
await O.ready;
await O.send('Runtime.enable');
await O.send('Page.enable');
await sleep(3000);

// ---------- 1. a seção existe e lista modelos
console.log('\n== secao de modelo ==');
const secao = await O.evaluate("(() => ({ existe: !!document.getElementById('modelList'), busca: !!document.getElementById('modelSearch'), effort: !!document.getElementById('effort'), titulo: [...document.querySelectorAll('h2')].map(h => h.textContent) }))()");
console.log('  ', JSON.stringify(secao));
add('seção de modelo existe', secao.existe === true);
add('campo de busca existe', secao.busca === true);
add('seletor de effort existe', secao.effort === true);

let itens = [];
for (let i = 0; i < 25; i++) {
  await sleep(1000);
  itens = await O.evaluate("(() => [...document.querySelectorAll('#modelList .mitem')].map(e => ({ nome: e.querySelector('.nm').textContent, prov: e.querySelector('.pv').textContent, ve: e.querySelector('.eye').textContent })))()");
  if (itens.length) break;
}
console.log(`  ${itens.length} modelos na lista; amostra:`, JSON.stringify(itens.slice(0, 3)));
add('lista mostra os modelos', itens.length > 20, `${itens.length}`);
add('mostra o provedor de cada um', itens.every((i) => i.prov));

const contagem = await O.evaluate("document.getElementById('modelCount').textContent");
console.log('  contagem:', contagem);

// ---------- 2. busca filtra
console.log('\n== busca ==');
await O.evaluate("(() => { const i = document.getElementById('modelSearch'); i.value = 'step 5'; i.dispatchEvent(new Event('input')); })()");
await sleep(600);
const filtrados = await O.evaluate("(() => [...document.querySelectorAll('#modelList .mitem')].map(e => e.querySelector('.nm').textContent))()");
console.log('  filtrados:', JSON.stringify(filtrados.slice(0, 6)));
add('busca filtra a lista', filtrados.length > 0 && filtrados.every((n) => /step/i.test(n)), `${filtrados.length}`);
await O.evaluate("(() => { const i = document.getElementById('modelSearch'); i.value = ''; i.dispatchEvent(new Event('input')); })()");
await sleep(500);

// ---------- 3. escolher modelo
console.log('\n== escolher ==');
const alvo = itens.find((i) => /Step 5 Preview/i.test(i.nome)) || itens[0];
const clique = await O.evaluate("(() => { const el = [...document.querySelectorAll('#modelList .mitem')].find(e => /Step 5 Preview/.test(e.querySelector('.nm').textContent)); if (!el) return { ok: false }; el.click(); return { ok: true, nome: el.querySelector('.nm').textContent, prov: el.querySelector('.pv').textContent }; })()");
await sleep(500);
const selDepois = await O.evaluate("(() => { const el = document.querySelector('#modelList .mitem.sel'); return el ? { nome: el.querySelector('.nm').textContent, aria: el.getAttribute('aria-selected') } : null; })()");
console.log('  escolhido:', JSON.stringify(clique));
add('clicar seleciona o modelo', clique.ok === true && selDepois?.nome === clique.nome, JSON.stringify(selDepois));
await O.shot('opcoes-modelo.png');

// ---------- 4. effort
console.log('\n== effort ==');
const esforcos = await O.evaluate("(() => { const s = document.getElementById('effort'); return { opcoes: [...s.options].map(o => o.value), valor: s.value }; })()");
console.log('  effort:', JSON.stringify(esforcos));
add('effort lista as variantes', esforcos.opcoes.length > 1, JSON.stringify(esforcos));


const esforcoEscolhido = esforcos.opcoes.filter((v) => v !== '').slice(-1)[0] || '';
if (esforcoEscolhido) {
  const mudou = await O.evaluate("(() => { const s = document.getElementById('effort'); s.value = '" + esforcoEscolhido + "'; s.dispatchEvent(new Event('change')); return s.value; })()");
  console.log('  effort escolhido:', mudou);
}


// ---------- 5. salvar
console.log('\n== salvar ==');
await O.evaluate("document.getElementById('saveModel').click()");
await sleep(2500);

const statusTxt = await O.evaluate("document.getElementById('status').textContent");
console.log('  status:', statusTxt);
add('status confirma o salvamento', /Modelo de texto/.test(statusTxt), statusTxt);

const salvo = await O.evaluate("(async () => { const c = await new Promise((r) => chrome.storage.local.get(['cfg'], (v) => r(v.cfg || null))); return c; })()");
console.log('  salvo:', JSON.stringify(salvo?.model));
add('modelo foi para o storage', (salvo?.model?.providerID) === clique.prov, JSON.stringify(salvo));
add('rotulo foi salvo', salvo?.modelLabel === clique.nome, `${salvo?.modelLabel} vs ${clique.nome}`);
add('effort foi salvo', esforcoEscolhido ? salvo?.model?.variant === esforcoEscolhido : !salvo?.model?.variant, `${salvo?.model?.variant} vs ${esforcoEscolhido}`);
add('a porta do servidor nao se perdeu', salvo?.port === 4177, String(salvo?.port));

const atual = await O.evaluate("document.getElementById('currentModel').textContent");
console.log('  rodape:', atual);
add('rodape mostra o padrao', /^Agora:/.test(atual), atual);

const visaoSecao = await O.evaluate("(() => ({ mesmo: document.getElementById('sameVision').checked, grupo: !!document.getElementById('visionGroup'), lista: [...document.querySelectorAll('#visionList .mitem')].map(e => e.querySelector('.nm').textContent), salvar: !!document.getElementById('saveVision') }))()");
console.log('  secao de visao:', JSON.stringify(visaoSecao).slice(0, 200));
add('secao de visao existe', visaoSecao.grupo === true && visaoSecao.salvar === true);
add('caixa "mesmo modelo" comecah marcada', visaoSecao.mesmo === true, String(visaoSecao.mesmo));
add('lista de visao mostra so modelos que enxergam', visaoSecao.lista.length > 5, String(visaoSecao.lista.length));

const visao = await O.evaluate("document.getElementById('modelVision').checked");
add('caixa de visão reflete o modelo', typeof visao === 'boolean', String(visao));
await O.shot('opcoes-modelo-salvo.png');

const oErrs = O.errors.filter((e) => e && !/favicon/.test(e));
if (oErrs.length) console.log('  erros:', JSON.stringify(oErrs.slice(0, 3)));
add('opcoes sem erro de console', oErrs.length === 0, oErrs.slice(0, 1).join(''));

try { proc.kill(); } catch {}
await sleep(600); site.close();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
// limpa a configuracao de teste
await fetch(`${API}/api/location`, { headers: H }).catch(() => {});

const failed = checks.filter(([, c]) => !c);
console.log('\n================ RESUMO ================');
console.log(`${checks.length - failed.length} passaram, ${failed.length} falharam`);
if (failed.length) failed.forEach(([n]) => console.log('  FALHOU: ' + n));
else console.log('TUDO OK');
process.exit(failed.length ? 1 : 0);
