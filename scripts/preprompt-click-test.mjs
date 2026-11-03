/**
 * Clique de verdade num pre-prompt.
 *
 * O teste antigo conferia que o menu APARECIA ao selecionar — mas nunca
 * clicava num item. O clique é justamente onde mora o bug: o menu vive no
 * shadow DOM e o listener está no document, então o alvo chegava
 * retargetado para o host e o `mousedown` fechava tudo antes do `click`.
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
const H = {
  Authorization: 'Basic ' + Buffer.from(`opencode:${PW}`).toString('base64'),
  'Content-Type': 'application/json'
};

const SITE = 8723;
const CDP = 9733;
const profile = mkdtempSync(join(tmpdir(), 'brave-click-'));

// rastreamento: qual fetch devolve text/plain?
process.on('unhandledRejection', (e) => {
  console.log('UNHANDLED:', e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : e);
  process.exit(2);
});
const WORK = mkdtempSync(join(tmpdir(), 'oc-click-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const add = (n, c, x = '') => {
  checks.push([n, !!c, x]);
  console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`);
};

const HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Pagina de teste</title>
<style>body{font:16px system-ui;padding:40px;max-width:760px;margin:auto}
p{padding:14px;background:#eef;border-radius:8px;line-height:1.5}
img{display:block;margin-top:20px;border:1px solid #ccc}</style></head><body>
<h1>Texto para selecionar</h1>
<p id="alvo">Typed Arrays sao visoes tipadas sobre memoria bruta. Este paragrafo serve para testar o menu de pre-prompts da extensao.</p>
<img id="img" width="200" height="120" alt="teste"
 src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==">
</body></html>`;

const site = createServer((_, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(HTML);
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

// o install abre options.html numa aba, e ela fica ativa — atrapalha o painel
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
await sleep(2000);

// pasta e modelo: o prompt precisa sair para a sessão de teste.
// Escrito enquanto o painel já está carregado de propósito: é o caso que o
// listener de storage cobre — sem reconfigurar o cliente da API, o painel
// continuaria conversando na pasta antiga.
await Q.evaluate(`new Promise((r) => chrome.storage.local.get(['cfg'], (v) => {
  const cfg = v.cfg || {};
  cfg.directory = ${JSON.stringify(WORK)};
  // kilo3/step-5-preview-free: kilo4 devolve HTTP 500 (cota estourada)
  cfg.model = { providerID: 'kilo3', id: 'stepfun/step-5-preview-free' };
  cfg.modelLabel = '[K3] Step 5 Preview';
  cfg.useSameVisionModel = true;
  cfg.visionModel = null;
  chrome.storage.local.set({ cfg }, () => r(true));
}))`);
// o listener reconfigura e reconecta; dá tempo de o ping completar
await sleep(2500);

// a pasta de teste precisa existir para o servidor aceitar sessao nela
{
  const s = await (await fetch(`${API}/api/session`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ location: { directory: WORK } })
  })).json();
  if (s?.data?.id) await fetch(`${API}/api/session/${s.data.id}`, { method: 'DELETE', headers: H }).catch(() => {});
}
await sleep(500);

// ------------------------------------------------------------ A. texto
console.log('\n== A. clicar num pre-prompt de TEXTO ==');

// seleciona o alvo e dispara o mouseup que abre o menu
const abriuMenu = await P.evaluate(`new Promise((resolve) => {
  const p = document.getElementById('alvo');
  const r = document.createRange(); r.selectNodeContents(p);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  setTimeout(() => {
    const m = document.getElementById('oc-host').shadowRoot.querySelector('.oc-menu');
    resolve({ hidden: m.hidden, itens: m.querySelectorAll('.oc-item').length });
  }, 500);
})`);
console.log('  menu:', JSON.stringify(abriuMenu));
add('menu de texto abriu', abriuMenu?.hidden === false, JSON.stringify(abriuMenu));

// o teste central: clicar num item de verdade (mousedown + mouseup + click)
const cliqueTexto = await P.evaluate(`new Promise((resolve) => {
  const host = document.getElementById('oc-host');
  const root = host.shadowRoot;
  const menu = root.querySelector('.oc-menu');
  const botoes = [...menu.querySelectorAll('.oc-item')];
  const alvo = botoes.find((b) => /Explicar/i.test(b.textContent));
  if (!alvo) return resolve({ erro: 'item Explicar nao encontrado', itens: botoes.length });

  const r = alvo.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);

  // eventos reais no botão: é aqui que o retarget do shadow DOM aparecia
  const opts = { bubbles: true, composed: true, clientX: x, clientY: y, button: 0 };
  alvo.dispatchEvent(new PointerEvent('pointerdown', opts));
  alvo.dispatchEvent(new MouseEvent('mousedown', opts));
  // o mouseup sai DO BOTÃO, como no uso real: aí o composedPath inclui o
  // menu e o handler não re-renderiza (se saísse do document, o menu
  // voltaria por causa da seleção ainda ativa)
  alvo.dispatchEvent(new PointerEvent('pointerup', opts));
  alvo.dispatchEvent(new MouseEvent('mouseup', opts));
  alvo.dispatchEvent(new MouseEvent('click', opts));

  setTimeout(() => {
    resolve({
      clicado: true,
      menuFechado: menu.hidden,
      painelAberto: root.querySelector('.oc-panel').classList.contains('is-open')
    });
  }, 1200);
})`);
console.log('  resultado do clique:', JSON.stringify(cliqueTexto));

add('o clique fecha o menu de verdade', cliqueTexto?.menuFechado === true, JSON.stringify(cliqueTexto));
add('o clique abriu o painel', cliqueTexto?.painelAberto === true, JSON.stringify(cliqueTexto));

// o pedido tem que ter chegado ao servidor, com o texto selecionado e a instrução
let chegou = null;
const trilha = [];
// 60 tentativas: o prompt leva ~1-5s, mas o modelo as vezes demora mais e
// o balão do usuario so entra quando o SSE devolve o inbox. Com 30s havia
// falso negativo.
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  chegou = await Q.evaluate(`(() => {
    const t = document.getElementById('thread');
    return {
      primeiroBalao: (t.querySelector('.msg-user .bubble')?.innerText || ''),
      msgs: t.querySelectorAll(':scope > .msg').length,
      classes: [...t.querySelectorAll(':scope > .msg')].map((m) => m.className),
      anexos: document.querySelectorAll('#attachments img').length,
      status: document.getElementById('status').textContent,
      sessao: document.getElementById('sessionPicker').value
    };
  })()`);
  if (i < 6 || i % 10 === 0) {
    trilha.push(`${i}s msgs=${chegou?.msgs} status="${chegou?.status}"`);
  }
  if (chegou?.primeiroBalao && /Typed Arrays/.test(chegou.primeiroBalao)) break;
}
console.log('  trilha:', trilha.join(' | '));
console.log('  balão do usuário:', JSON.stringify(chegou?.primeiroBalao || '').slice(0, 220));

add('a mensagem do usuário entrou na conversa',
  /Typed Arrays/.test(chegou?.primeiroBalao || ''), JSON.stringify(chegou?.primeiroBalao || '').slice(0, 100));
add('a instrução interna não vazou na conversa',
  !/CONFIG_OC/.test(chegou?.primeiroBalao || ''), 'sem marcador interno');

// confere no servidor que a mensagem saiu com o conteúdo certo
{
  const sessoes = (await (await fetch(`${API}/api/session?limit=20&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || [];
  let achou = false;
  let trecho = '';
  for (const s of sessoes.filter((x) => !x.parentID).slice(0, 5)) {
    const msgs = (await (await fetch(`${API}/api/session/${s.id}/message?limit=30&order=asc`, { headers: H })).json()).data || [];
    for (const m of msgs.filter((x) => x.type === 'user')) {
      const t = m.payload?.text || m.text || '';
      if (/Typed Arrays/.test(t)) { achou = true; trecho = t; break; }
    }
    if (achou) break;
  }
  add('servidor recebeu o prompt com o texto selecionado', achou, trecho.slice(0, 150).replace(/\n/g, ' '));
  add('o pre-prompt "Explicar" foi montado',
    /Explique o texto abaixo/.test(trecho), trecho.slice(0, 90).replace(/\n/g, ' '));
  add('a página de origem foi junto',
    /127\.0\.0\.1|Pagina de teste/.test(trecho), '');
}

// ------------------------------------------------------------ B. imagem
console.log('\n== B. clicar num pre-prompt de IMAGEM ==');

const abriuImg = await P.evaluate(`new Promise((resolve) => {
  const img = document.getElementById('img');
  img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 300 }));
  setTimeout(() => {
    const m = document.getElementById('oc-host').shadowRoot.querySelector('.oc-menu');
    resolve({ hidden: m.hidden, itens: m.querySelectorAll('.oc-item').length });
  }, 500);
})`);
console.log('  menu:', JSON.stringify(abriuImg));
add('menu de imagem abriu', abriuImg?.hidden === false, JSON.stringify(abriuImg));

const cliqueImg = await P.evaluate(`new Promise((resolve) => {
  const root = document.getElementById('oc-host').shadowRoot;
  const menu = root.querySelector('.oc-menu');
  const alvo = [...menu.querySelectorAll('.oc-item')].find((b) => /Ler texto|Extrair dados/.test(b.textContent));
  if (!alvo) return resolve({ erro: 'item de imagem nao encontrado' });

  const r = alvo.getBoundingClientRect();
  const opts = { bubbles: true, composed: true, clientX: Math.round(r.left + r.width/2), clientY: Math.round(r.top + r.height/2), button: 0 };
  alvo.dispatchEvent(new MouseEvent('mousedown', opts));
  document.dispatchEvent(new MouseEvent('mouseup', opts));
  alvo.dispatchEvent(new MouseEvent('click', opts));
  setTimeout(() => resolve({ painelAberto: root.querySelector('.oc-panel').classList.contains('is-open') }), 1500);
})`);
console.log('  resultado do clique:', JSON.stringify(cliqueImg));
add('o clique no pre-prompt de imagem também age', cliqueImg?.painelAberto === true, JSON.stringify(cliqueImg));

// a miniatura some quando o envio parte (clearAttachments no `finally` do
// send) — então a prova é o servidor: a mensagem de usuário tem de ter
// chegado com arquivo anexado.
let imgNoServidor = null;
const vista = [];
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  const sessoes = (await (await fetch(`${API}/api/session?limit=20&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || [];
  for (const s of sessoes.filter((x) => !x.parentID).slice(0, 5)) {
    const msgs = (await (await fetch(`${API}/api/session/${s.id}/message?limit=30&order=asc`, { headers: H })).json()).data || [];
    for (const m of msgs.filter((x) => x.type === 'user')) {
      const t = m.payload?.text || m.text || '';
      const files = m.payload?.files || m.files || [];
      vista.push({ chars: t.length, arquivos: files.length, inicio: t.slice(0, 60).replace(/\n/g, ' ') });
      // sem acento no teste: o texto real é "visível"
      if (/Transcreva todo o texto|Extraia tudo/.test(t)) {
        imgNoServidor = { arquivos: files.length, mime: files[0]?.mime || files[0]?.type || '(sem mime)', trecho: t.slice(0, 90), textoCompleto: t };
        break;
      }
    }
    if (imgNoServidor) break;
  }
  if (imgNoServidor) break;
}
console.log('  mensagens de usuário no servidor:', JSON.stringify(vista));
console.log('  imagem no servidor:', JSON.stringify(imgNoServidor));
add('a imagem foi anexada e enviada', (imgNoServidor?.arquivos || 0) > 0, JSON.stringify(imgNoServidor));
add('o pre-prompt de imagem foi montado',
  !!imgNoServidor && /Transcreva todo o texto|Extraia tudo/.test(imgNoServidor.textoCompleto || ''),
  (imgNoServidor?.textoCompleto || '').slice(-120).replace(/\n/g, ' '));

// ------------------------------------------------------------ C. fechar
console.log('\n== C. fechar o menu ==');
const fechou = await P.evaluate(`new Promise((resolve) => {
  const root = document.getElementById('oc-host').shadowRoot;
  const menu = root.querySelector('.oc-menu');
  // abre o menu de verdade: forçar hidden=false não basta, o estado
  // interno (state.menu) também precisa existir
  const p = document.getElementById('alvo');
  const r = document.createRange(); r.selectNodeContents(p);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  setTimeout(() => {
    const estavaAberto = !menu.hidden;
    // clique FORA do menu (no corpo da página) deve fechar
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    setTimeout(() => resolve({ estavaAberto, hidden: menu.hidden }), 300);
  }, 500);
})`);
console.log('  fora do menu:', JSON.stringify(fechou));
add('o menu estava aberto antes do clique fora', fechou?.estavaAberto === true, JSON.stringify(fechou));
add('clicar fora fecha o menu', fechou?.hidden === true, JSON.stringify(fechou));

const pErrs = P.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
const qErrs = Q.errors.filter((e) => e && !/favicon|ERR_FILE/.test(e));
add('pagina sem erro de console', pErrs.length === 0, pErrs.slice(0, 2).join(' | '));
add('painel sem erro de console', qErrs.length === 0, qErrs.slice(0, 2).join(' | '));

try { proc.kill(); } catch { /* ok */ }
await sleep(800); site.close();
for (const s of (await (await fetch(`${API}/api/session?limit=20&order=desc&directory=${encodeURIComponent(WORK)}`, { headers: H })).json()).data || []) {
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