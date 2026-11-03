/**
 * Content script: bubble flutuante, menu de pre-prompts e painel embutido.
 *
 * Tudo vive dentro de um shadow DOM para não colidir com o CSS da página.
 * O painel é uma extension page em <iframe>: tem acesso a chrome.storage e
 * não é afetada pelo CSS do site.
 *
 * lib/prompts.js é carregado antes deste arquivo (mesmo escopo isolado) e
 * publica globalThis.OC_PROMPTS.
 */

const {
  TEXT_PROMPTS,
  IMAGE_PROMPTS,
  buildTextPrompt,
  buildImagePrompt,
  describePage
} = globalThis.OC_PROMPTS;

const EXTENSION_ORIGIN = chrome.runtime.getURL('').slice(0, -1);
// Nonce por carregamento: autentica o canal com o iframe do painel sem
// depender de origem (o content script roda no contexto da página, então
// a origem vista pelo painel é a do site, não a da extensão).
// Uint8Array -> join('') sem separador; um Uint32Array viraria "123,456" e a
// vírgula acabaria dentro da query string do iframe.
const OC_NONCE = Array.from(crypto.getRandomValues(new Uint8Array(16)))
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');
// A origem da própria página, para o painel poder responder com
// `targetOrigin` correto: postar para window.parent usando a origem da
// EXTENSÃO faz o navegador descartar a mensagem em silêncio.
const PARENT_ORIGIN = location.origin;
const PANEL_URL = `${chrome.runtime.getURL('panel.html')}?oc=${OC_NONCE}&from=${encodeURIComponent(PARENT_ORIGIN)}`;

/** Embrulha toda mensagem para o painel com o nonce do canal. */
function toPanel(msg) {
  return { ...msg, oc: OC_NONCE };
}

if (!window.__ocChatInjected) {
  window.__ocChatInjected = true;
  boot();
}

function boot() {
  const state = {
    panelOpen: false,
    panelReady: false,
    bubble: { x: null, y: null },
    frame: { x: 0, y: 0, w: 480, h: 720 },
    dragging: null,
    resize: null,
    menu: null,
    lastSelection: null,
    settings: {}
  };

  // ---------------------------------------------------------------- storage

  /** Tamanho inicial do painel, cabendo na janela com folga para arrastar. */
  function tamanhoInicial() {
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    return {
      x: 0, y: 0,
      w: Math.max(360, Math.min(480, vw - 120)),
      h: Math.max(320, Math.min(720, vh - 120))
    };
  }

  async function loadSettings() {
    const got = await chrome.storage.local.get([
      'bubblePos', 'frameRect', 'settings'
    ]);
    state.bubble = got.bubblePos || { x: null, y: null };
    // Sem posição salva, o tamanho segue a janela. Fixar 480x720 deixava o
    // painel colado no topo e no fundo numa tela baixa — sobravam ~70px de
    // folga vertical, e qualquer arraste era imediatamente travado pelo
    // clamp. A margem de 120px devolve espaço para mover.
    state.frame = got.frameRect
      ? Object.assign({ x: 0, y: 0, w: 480, h: 720 }, got.frameRect)
      : tamanhoInicial();
    state.settings = Object.assign(
      {
        showBubble: true,
        selectionMenu: true,
        imageMenu: true,
        preventImageContextMenu: true,
        maxImageEdge: 1568,
        autoOpenOnPrompt: true
      },
      got.settings || {}
    );
    return state.settings;
  }

  function save(keys) {
    return chrome.storage.local.set(keys);
  }

  // Debounced storage writes for frequent updates (drag, resize)
  let saveTimer = null;
  const pendingSaves = new Map();
  function saveDebounced(keys, delay = 300) {
    for (const [k, v] of Object.entries(keys)) pendingSaves.set(k, v);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const toSave = Object.fromEntries(pendingSaves);
      pendingSaves.clear();
      chrome.storage.local.set(toSave);
    }, delay);
  }

  // ------------------------------------------------------------------ styles

  const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }

.oc-bubble {
  position: fixed;
  width: 44px; height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,.14);
  background: #16181d;
  color: #e8eaed;
  display: grid; place-items: center;
  cursor: grab;
  pointer-events: auto;
  box-shadow: 0 6px 20px rgba(0,0,0,.34);
  transition: transform .12s ease, background .12s ease;
  z-index: 2;
}
.oc-bubble:hover { transform: scale(1.06); background: #1d2026; }
.oc-bubble:active { cursor: grabbing; }
.oc-bubble.is-open { background: #2563eb; border-color: #3b82f6; }
.oc-bubble:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
.oc-bubble svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.oc-bubble .oc-badge {
  position: absolute; top: -3px; right: -3px;
  min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: #ef4444; color: #fff;
  font: 600 10px/16px system-ui, sans-serif; text-align: center;
}

.oc-panel {
  position: fixed;
  pointer-events: auto;
  border-radius: 12px;
  overflow: hidden;
  background: #0e1014;
  border: 1px solid rgba(255,255,255,.12);
  box-shadow: 0 18px 60px rgba(0,0,0,.5);
  z-index: 1;
  display: none;
  flex-direction: column;
}
.oc-panel.is-open { display: flex; }
.oc-panel iframe { width: 100%; flex: 1 1 auto; border: 0; display: block; min-height: 0; }

/* Faixa de arraste: fica ACIMA do iframe e é a única que o pai controla. */
.oc-dragbar {
  flex: 0 0 auto;
  height: 18px;
  pointer-events: auto;
  background: #14171c;
  border-bottom: 1px solid rgba(255,255,255,.08);
  cursor: grab;
  display: grid;
  place-items: center;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.oc-dragbar:hover { background: #1a1e25; }
.oc-dragbar:active, .oc-dragbar.is-dragging { cursor: grabbing; background: #1e232b; }
.oc-dragbar:focus-visible { outline: 2px solid #60a5fa; outline-offset: -2px; }
.oc-grip-dots {
  width: 34px; height: 4px;
  border-radius: 2px;
  background-image: radial-gradient(circle, rgba(255,255,255,.26) 1px, transparent 1px);
  background-size: 6px 4px;
  background-position: 0 0;
  opacity: .8;
}
.oc-dragbar:hover .oc-grip-dots { background-image: radial-gradient(circle, rgba(255,255,255,.42) 1px, transparent 1px); }

/* Canto de redimensionar.
   Vive FORA do painel, como irmão: dentro dele o border-radius de 12px
   recortava a área de clique justamente no canto, e o evento ia para o painel
   em vez do grip — o redimensionamento simplesmente não respondia. */
.oc-grip {
  position: fixed;
  width: 24px; height: 24px;
  /* o host é pointer-events:none (para não atrapalhar a página), então cada
     peça que precisa de clique declara o seu. Sem isto o grip, que é irmão do
     painel, herdava none e não recebia nada. */
  pointer-events: auto;
  cursor: nwse-resize;
  z-index: 2;
  touch-action: none;
  display: none;
}
.oc-grip.is-open { display: block; }
.oc-grip::after {
  content: ""; position: absolute; right: 5px; bottom: 5px;
  width: 9px; height: 9px;
  border-right: 2px solid rgba(255,255,255,.3);
  border-bottom: 2px solid rgba(255,255,255,.3);
  border-radius: 0 0 2px 0;
  transition: border-color .12s ease;
}
.oc-grip:hover::after, .oc-grip:active::after { border-color: rgba(255,255,255,.65); }

/* Véu do arraste.
   O painel é um iframe de outra origem: quando o cursor entra nele, os
   pointermove deixam de chegar na página — e o setPointerCapture não
   atravessa essa fronteira. Como o painel para no limite da tela mas o
   cursor não, o arraste "soltava" justo quando batia na borda.

   O véu cobre a viewport inteira durante o gesto, fica ACIMA do iframe e
   garante que todos os eventos continuem chegando aqui. */
.oc-veil {
  position: fixed;
  inset: 0;
  z-index: 3;
  display: none;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
/* o host é pointer-events:none, então o véu precisa declarar o seu —
   sem isto ele cobre a tela mas não recebe nenhum evento */
.oc-veil.is-on { display: block; pointer-events: auto; }

.oc-menu {
  position: fixed;
  pointer-events: auto;
  min-width: 232px; max-width: 290px;
  background: #16181d;
  border: 1px solid rgba(255,255,255,.13);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5);
  padding: 5px;
  z-index: 3;
  color: #e8eaed;
  font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  max-height: 62vh; overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #3a3f4a transparent;
}
.oc-menu::-webkit-scrollbar { width: 8px; }
.oc-menu::-webkit-scrollbar-thumb { background: #3a3f4a; border-radius: 4px; }
.oc-menu[hidden] { display: none; }

.oc-menu-head {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px 7px;
  font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase;
  color: #8b929e; border-bottom: 1px solid rgba(255,255,255,.08);
  margin-bottom: 4px;
}
.oc-menu-head .oc-close {
  margin-left: auto; cursor: pointer; color: #8b929e; font-size: 13px;
  line-height: 1; padding: 2px 4px; border-radius: 4px;
}
.oc-menu-head .oc-close:hover { color: #fff; background: rgba(255,255,255,.08); }

.oc-item {
  display: flex; align-items: center; gap: 9px;
  width: 100%; padding: 6px 8px;
  background: none; border: 0; border-radius: 7px;
  color: #e8eaed; font: inherit; text-align: left; cursor: pointer;
}
.oc-item:hover, .oc-item:focus-visible { background: #262a32; outline: none; }
.oc-item .oc-ic {
  width: 20px; height: 20px; flex: 0 0 20px;
  display: grid; place-items: center;
  border-radius: 5px; background: #262a32;
  font-size: 11px; color: #b9c0cc;
}
.oc-item:hover .oc-ic { background: #333844; color: #fff; }
.oc-item .oc-tx { min-width: 0; }
.oc-item .oc-lb { display: block; font-size: 13px; font-weight: 500; }
.oc-item .oc-hn { display: block; font-size: 11px; color: #8b929e; }
.oc-item .oc-skill {
  margin-left: auto; font-size: 9.5px; color: #7dd3fc;
  background: rgba(56,189,248,.12); padding: 2px 5px; border-radius: 4px;
  max-width: 74px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.oc-foot {
  margin-top: 5px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.08);
  font-size: 10.5px; color: #6f7682; padding-left: 8px; padding-right: 8px;
}
`;

  // -------------------------------------------------------------------- DOM

  const host = document.createElement('div');
  host.id = 'oc-host';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.append(style);

  const bubble = document.createElement('button');
  bubble.className = 'oc-bubble';
  bubble.type = 'button';
  bubble.title = 'OpenCode Chat (Alt+Shift+O)';
  bubble.setAttribute('aria-label', 'Abrir chat do OpenCode');
  bubble.innerHTML = `
    <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.2A8 8 0 0 1 13 4a8 8 0 0 1 8 8Z"/><path d="M9 11h6M9 14.5h4"/></svg>
  `;
  root.append(bubble);

  const panel = document.createElement('div');
  panel.className = 'oc-panel';

  // Faixa de arraste, desenhada AQUI (no content script) e não dentro do
  // iframe. O painel é uma extension page: outra origem, outro processo —
  // o cursor sair dos limites dela faz os eventos pararem de chegar, e o
  // arraste "grudava" ou simplesmente congelava. Com a faixa no mesmo
  // mundo do painel, o arraste acontece inteiro aqui: sem postMessage por
  // movimento e sem depender do iframe continuar recebendo eventos.
  const barra = document.createElement('div');
  barra.className = 'oc-dragbar';
  barra.title = 'Arrastar para mover o painel';
  barra.innerHTML = '<span class="oc-grip-dots" aria-hidden="true"></span>';
  panel.append(barra);

  const frame = document.createElement('iframe');
  frame.src = PANEL_URL;
  frame.title = 'Chat OpenCode';
  frame.allow = 'clipboard-write';
  panel.append(frame);
  const grip = document.createElement('div');
  grip.className = 'oc-grip';
  grip.title = 'Arrastar para redimensionar';
  const veil = document.createElement('div');
  veil.className = 'oc-veil';
  root.append(grip);
  root.append(veil);
  root.append(panel);

  const menu = document.createElement('div');
  menu.className = 'oc-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  root.append(menu);

  (document.body || document.documentElement).append(host);

  // ------------------------------------------------------------- geometria

  /**
   * Aplica a geometria do painel na tela.
   *
   * `sync` vem false durante o arraste: a cada movimento era enviada uma
   * `oc:geometry` de volta ao iframe, e o painel recalculava a partir dela —
   * ida-e-volta por frame, com um frame de atraso. Quem arraste agora é a
   * faixa do pai, que não precisa de nada do iframe.
   */
  function clampFrame({ sync = true } = {}) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const f = state.frame;
    f.w = Math.max(360, Math.min(f.w, vw - 16));
    f.h = Math.max(320, Math.min(f.h, vh - 16));
    f.x = Math.max(8, Math.min(f.x, vw - f.w - 8));
    f.y = Math.max(8, Math.min(f.y, vh - f.h - 8));
    panel.style.width = `${f.w}px`;
    panel.style.height = `${f.h}px`;
    panel.style.left = `${f.x}px`;
    panel.style.top = `${f.y}px`;
    // o canto de redimensionar acompanha o painel, sobreposto a ele
    grip.style.left = `${f.x + f.w - 24}px`;
    grip.style.top = `${f.y + f.h - 24}px`;
    if (!sync) return;
    try {
      frame.contentWindow?.postMessage(toPanel({ type: 'oc:geometry', x: f.x, y: f.y }), EXTENSION_ORIGIN);
    } catch { /* iframe ainda não carregou */ }
  }

  function placeBubble() {
    const b = state.bubble;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (b.x == null || b.y == null) {
      b.x = vw - 60;
      b.y = Math.max(60, Math.round(vh * 0.35));
    }
    b.x = Math.max(6, Math.min(b.x, vw - 50));
    b.y = Math.max(6, Math.min(b.y, vh - 50));
    bubble.style.left = `${b.x}px`;
    bubble.style.top = `${b.y}px`;
  }

  function applyVisibility() {
    const show = state.settings.showBubble !== false;
    bubble.style.display = show ? '' : 'none';
    if (!show && !state.panelOpen) host.style.display = 'none';
    else host.style.display = '';
  }

  // ---------------------------------------------------------------- painel

  /**
   * Abre o painel.
   *
   * Com `payload` (veio de um pre-prompt do menu), o painel já recebe o
   * pedido pronto. Sem payload — clique no botão — avisamos o painel para
   * começar uma sessão nova: a regra é que abrir pelo ícone sempre recomeça,
   * e só se continua uma sessão antiga escolhendo-a no seletor.
   */
  function openPanel(payload) {
    state.panelOpen = true;
    if (!state.panelReady) {
      state.pending = payload || null;
      state.pendingFresh = !payload;
    } else if (payload) {
      frame.contentWindow.postMessage(toPanel({ type: 'oc:ask', payload }), EXTENSION_ORIGIN);
    } else {
      frame.contentWindow.postMessage(toPanel({ type: 'oc:fresh' }), EXTENSION_ORIGIN);
    }
    panel.classList.add('is-open');
    grip.classList.add('is-open');
    bubble.classList.add('is-open');
    bubble.setAttribute('aria-label', 'Fechar chat do OpenCode');
    clampFrame();
    if (!state.frameLoaded) {
      state.frameLoaded = true;
      frame.addEventListener('load', () => { state.panelReady = true; }, { once: true });
    }
  }

  function closePanel() {
    state.panelOpen = false;
    panel.classList.remove('is-open');
    grip.classList.remove('is-open');
    bubble.classList.remove('is-open');
    bubble.setAttribute('aria-label', 'Abrir chat do OpenCode');
  }

  function togglePanel() {
    state.panelOpen ? closePanel() : openPanel(null);
  }

  bubble.addEventListener('click', (e) => {
    if (state.dragMoved) { state.dragMoved = false; return; }
    e.preventDefault();
    togglePanel();
  });

  bubble.addEventListener('dblclick', () => {
    state.bubble = { x: null, y: null };
    placeBubble();
    save({ bubblePos: state.bubble });
  });

  // -------------------------------------------------------------- drag bubble
  //
  // Mesmo véu do painel: o botão é pequeno e o cursor sai dele em dois
  // movimentos, então sem isso o arraste morria no primeiro passo.

  bubble.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    state.dragging = {
      kind: 'bubble',
      startX: e.clientX,
      startY: e.clientY,
      anchorX: state.bubble.x,
      anchorY: state.bubble.y,
      moved: false
    };
    state.dragMoved = false;
    ligaVeu();
  });

  function moverBubula(clientX, clientY) {
    const d = state.dragging;
    if (d?.kind !== 'bubble') return;
    d.moved = true;
    state.bubble.x = d.anchorX + (clientX - d.startX);
    state.bubble.y = d.anchorY + (clientY - d.startY);
    placeBubble();
  }

  // o véu atende o painel e o botão na mesma passada
  veil.addEventListener('pointermove', (e) => {
    if (state.dragging?.kind === 'bubble') { e.preventDefault(); moverBubula(e.clientX, e.clientY); }
  });

  bubble.addEventListener('pointerup', () => {
    if (state.dragging?.kind !== 'bubble') return;
    state.dragMoved = state.dragging.moved;
    state.dragging = null;
    desligaVeu();
    saveDebounced({ bubblePos: state.bubble });
  });

  // ------------------------------------------------------------ drag do painel
  //
  // Tudo acontece aqui, no mesmo mundo do painel. A faixa de arraste é um
  // elemento do shadow DOM: o ponteiro capturado nele continua delivering
  // eventos mesmo fora da janela, e não há postMessage por movimento.
  //
  // A âncora é a posição do painel no MOINTO do arraste. Antes, o cálculo
  // usava a posição corrente (`geo.x + delta`), e cada passo reacumulava o
  // deslocamento anterior: 15 px de cursor viravam 15, 45, 90, 150… na tela.

  // ------------------------------------------------------------ drag do painel
  //
  // Tudo acontece aqui, no mesmo mundo do painel — nada de postMessage por
  // movimento. Dois detalhes que fazem a diferença:
  //
  // 1. A âncora é a posição do painel no MOINTO do arraste. Antes, o cálculo
  //    usava a posição corrente (`geo.x + delta`), e cada passo reacumulava o
  //    deslocamento anterior: 15 px de cursor viravam 15, 45, 90, 150… na tela.
  //
  // 2. Durante o gesto aparece um véu sobre a viewport inteira. O painel é um
  //    iframe de outra origem: quando o cursor entra nele, os pointermove
  //    deixam de chegar na página e o setPointerCapture não atravessa essa
  //    fronteira. Como o painel trava no limite da tela mas o cursor segue,
  //    o arraste morria exatamente na borda. Com o véu por cima, o cursor
  //    nunca chega ao iframe.

  function ligaVeu() { veil.classList.add('is-on'); }
  function desligaVeu() { veil.classList.remove('is-on'); }

  /** Aplica o gesto em curso a partir da posição do cursor. */
  function aplicarGesto(clientX, clientY) {
    if (state.dragging?.kind === 'painel') {
      const d = state.dragging;
      state.frame.x = d.anchorX + (clientX - d.startX);
      state.frame.y = d.anchorY + (clientY - d.startY);
      clampFrame({ sync: false });
      return;
    }
    if (state.resize) {
      state.frame.w = state.resize.sw + (clientX - state.resize.sx);
      state.frame.h = state.resize.sh + (clientY - state.resize.sy);
      clampFrame({ sync: false });
    }
  }

  function fimGesto() {
    let guardou = false;
    if (state.dragging?.kind === 'painel') {
      state.dragging = null;
      barra.classList.remove('is-dragging');
      guardou = true;
    }
    if (state.resize) {
      state.resize = null;
      guardou = true;
    }
    desligaVeu();
    if (guardou) saveDebounced({ frameRect: state.frame });
  }

  barra.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    state.dragging = {
      kind: 'painel',
      startX: e.clientX,
      startY: e.clientY,
      anchorX: state.frame.x,
      anchorY: state.frame.y,
      pointerId: e.pointerId
    };
    barra.classList.add('is-dragging');
    ligaVeu();
  });

  // --------------------------------------------------------------- resize

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    state.resize = { sx: e.clientX, sy: e.clientY, sw: state.frame.w, sh: state.frame.h, pointerId: e.pointerId };
    ligaVeu();
  });

  // o véu é quem recebe o movimento enquanto o gesto dura
  veil.addEventListener('pointermove', (e) => {
    if (state.dragging?.kind === 'bubble') { e.preventDefault(); moverBubula(e.clientX, e.clientY); return; }
    if (!state.dragging && !state.resize) return;
    e.preventDefault();
    aplicarGesto(e.clientX, e.clientY);
  });

  veil.addEventListener('pointerup', fimGesto);
  veil.addEventListener('pointercancel', fimGesto);
  // a página também pode ter ficado atrás do véu num gesto que começou lá
  window.addEventListener('pointerup', fimGesto, true);
  window.addEventListener('pointercancel', fimGesto, true);
  window.addEventListener('blur', fimGesto, true);

  window.addEventListener('message', (ev) => {
    // Security: validate origin is our extension
    if (ev.origin !== EXTENSION_ORIGIN) return;
    const msg = ev.data;
    if (!msg || typeof msg !== 'object' || !msg.type) return;

    if (msg.type === 'oc:ready') {
      state.panelReady = true;
      if (state.pending) {
        frame.contentWindow.postMessage(toPanel({ type: 'oc:ask', payload: state.pending }), EXTENSION_ORIGIN);
        state.pending = null;
      } else if (state.pendingFresh) {
        frame.contentWindow.postMessage(toPanel({ type: 'oc:fresh' }), EXTENSION_ORIGIN);
        state.pendingFresh = false;
      }
      return;
    }

    if (msg.type === 'oc:close') { closePanel(); return; }

    if (msg.type === 'oc:frame') {
      Object.assign(state.frame, msg.rect || {});
      state.frameOpen = !!msg.open;
      panel.classList.toggle('is-open', msg.open);
      grip.classList.toggle('is-open', !!msg.open);
      bubble.classList.toggle('is-open', !!msg.open);
      clampFrame();
      if (msg.persist) saveDebounced({ frameRect: state.frame });
      return;
    }

    // O arraste do painel é todo local (faixa de arraste). O painel dentro do
    // iframe só manda a posição de onde foi arrastado, que virou irrelevante.

    if (msg.type === 'oc:capture') {
      captureTabForPanel().catch(() => {});
      return;
    }
  });

  /**
   * Pede ao service worker a captura da aba visível e devolve ao painel.
   * Só o worker tem chrome.tabs.captureVisibleTab — o content script não.
   */
  /**
   * Captura a aba para o modelo olhar.
   *
   * O painel é escondido antes e devolvido depois: captureVisibleTab fotografa
   * a aba como está na tela, e o próprio painel entrando no print seria inútil
   * — o modelo veria a janela de chat no lugar do conteúdo.
   *
   * Dois requestAnimationFrame antes de capturar: com um só, o compositor pode
   * ainda não ter pintado o quadro sem o painel.
   */
  /**
   * Espera o compositor repintar depois de esconder o painel.
   *
   * Só esperar requestAnimationFrame não basta: quando a janela está em
   * segundo plano o rAF não roda, e o compositor repinta no seu próprio
   * tempo — captureVisibleTab nesse intervalo devolve um frame ANTIGO, com o
   * painel ainda desenhado, e o modelo recebe o print da própria janela de
   * chat. Por isso o piso de tempo é o que garante isso, e o rAF só adianta
   * quando a janela está focada.
   */
  function waitPaint(ms = 300) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      let painted = false;
      // o rAF, quando existe, marca que a janela está ativa: aí 2 quadros
      // bastam e o piso de tempo vira só uma rede de segurança
      requestAnimationFrame(() => requestAnimationFrame(() => {
        painted = true;
        maybeFim();
      }));
      function maybeFim() {
        const passou = Date.now() - t0;
        if (passou >= ms || (painted && passou >= 60)) resolve();
        else setTimeout(maybeFim, 30);
      }
      setTimeout(maybeFim, ms);
    });
  }

  // Uma captura por vez: chamadas sobrepostas brigariam pela
  // visibilidade do painel (o `finally` de uma devolvia o painel enquanto a
  // outra ainda estava fotografando, e o print saía com o chat na frente) e
  // ainda saturavam o captureVisibleTab do worker, que devolve uma por vez.
  let capturaEmCurso = null;

  function captureTabForPanel() {
    if (capturaEmCurso) return capturaEmCurso;
    capturaEmCurso = correrCaptura().finally(() => { capturaEmCurso = null; });
    return capturaEmCurso;
  }

  async function correrCaptura() {
    const visibilidade = panel.style.visibility;
    panel.style.visibility = 'hidden';
    await waitPaint();

    try {
      // captureVisibleTab trava quando a janela não está focada e não rejeita
      // — não volta nunca. O worker tem prazo próprio; aqui a rede final,
      // generosa porque reiniciar a pergunta é melhor que perder a captura.
      const res = await Promise.race([
        chrome.runtime.sendMessage({ type: 'oc:captureVisibleTab' }),
        new Promise((r) => setTimeout(() => r({ ok: false, error: 'a janela do navegador não está focada' }), 12000))
      ]);
      if (!res?.ok || !res?.dataUrl) {
        toastPanel('Não consegui capturar: ' + (res?.error || 'resposta vazia'));
        return;
      }
      frame.contentWindow.postMessage(toPanel({
        type: 'oc:captured',
        dataUrl: res.dataUrl,
        width: res.width,
        height: res.height
      }), EXTENSION_ORIGIN);
    } catch (err) {
      toastPanel('Falha na captura: ' + err.message);
    } finally {
      panel.style.visibility = visibilidade;
    }
  }

  function toastPanel(text) {
    frame.contentWindow.postMessage(toPanel({ type: 'oc:toast', text }), EXTENSION_ORIGIN);
  }

  // ---------------------------------------------------------------- menu

  function closeMenu() {
    menu.hidden = true;
    menu.innerHTML = '';
    state.menu = null;
  }

  function renderMenu({ kind, items, x, y, footer }) {
    menu.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'oc-menu-head';
    head.innerHTML = `<span>${kind === 'image' ? 'Imagem' : 'Texto selecionado'}</span>`;
    const close = document.createElement('span');
    close.className = 'oc-close';
    close.textContent = '\u2715';
    close.title = 'Fechar (Esc)';
    close.addEventListener('click', closeMenu);
    head.append(close);
    menu.append(head);

    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'oc-item';
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.innerHTML = `
        <span class="oc-ic"></span>
        <span class="oc-tx">
          <span class="oc-lb"></span>
          ${item.hint ? '<span class="oc-hn"></span>' : ''}
        </span>
      `;
      btn.querySelector('.oc-ic').textContent = item.icon;
      btn.querySelector('.oc-lb').textContent = item.label;
      if (item.hint) btn.querySelector('.oc-hn').textContent = item.hint;
      if (item.skill) {
        const tag = document.createElement('span');
        tag.className = 'oc-skill';
        tag.textContent = item.skill;
        tag.title = `Skill: ${item.skill}`;
        btn.append(tag);
      }
      btn.addEventListener('click', () => {
        // O contexto tem que ser lido ANTES de fechar: closeMenu() zera
        // state.menu, e sem esse retrato o pre-prompt de imagem caía no ramo
        // de texto, achava seleção vazia e não fazia nada — menu abria,
        // clique não tinha efeito nenhum.
        const alvo = state.menu
          ? { kind: state.menu.kind, src: state.menu.src }
          : null;
        closeMenu();
        runItem(item, alvo);
      });
      menu.append(btn);
    }

    if (footer) {
      const f = document.createElement('div');
      f.className = 'oc-foot';
      f.textContent = footer;
      menu.append(f);
    }

    menu.hidden = false;
    menu.style.visibility = 'hidden';
    menu.style.left = '0px';
    menu.style.top = '0px';
    const r = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(6, Math.min(x, vw - r.width - 8));
    const top = Math.max(6, Math.min(y, vh - r.height - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = '';
    const first = menu.querySelector('.oc-item');
    if (first) first.focus({ preventScroll: true });
  }

  function pageInfo() {
    return describePage(location.href, document.title || '(sem título)');
  }

  function selectedText() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
    return sel.toString().trim();
  }

  function askWithText(promptText, skills, files) {
    const payload = {
      prompt: promptText,
      skills: skills || [],
      files: files || [],
      page: pageInfo(),
      newSession: state.settings.autoOpenOnPrompt !== false
    };
    if (state.panelOpen && state.panelReady) {
      frame.contentWindow.postMessage(toPanel({ type: 'oc:ask', payload }), EXTENSION_ORIGIN);
    } else {
      openPanel(payload);
    }
  }

  function runItem(item, alvo) {
    // `alvo` é o retrato do menu feito antes de fechar — ver o comentário no
    // listener do clique. Sem ele, state.menu já era null aqui.
    const menu = alvo || state.menu;
    if (menu && menu.kind === 'image') {
      const src = menu.src;
      captureImage(src)
        .then((file) => {
          askWithText(buildImagePrompt(item, pageInfo()), item.skill ? [item.skill] : [],
            file ? [file] : [{ uri: src, name: fileNameFromUrl(src), mime: mimeFromUrl(src) }]);
        })
        .catch(() => {
          // Sem a imagem o prompt perde o sentido: "leia o texto desta imagem"
          // sem imagem nenhuma. Avisa em vez de mandar pela metade.
          askWithText(buildImagePrompt(item, pageInfo()), item.skill ? [item.skill] : []);
          toastPanel(
            'Não consegui pegar esta imagem (provável bloqueio de cross-origin). ' +
            'Abra a imagem numa aba e tente de novo, ou use "ver tela" no painel.'
          );
        });
      return;
    }
    const text = state.lastSelection || selectedText();
    if (!text) return;
    askWithText(buildTextPrompt(item, text, pageInfo()), item.skill ? [item.skill] : []);
  }

  function fileNameFromUrl(u) {
    try {
      const url = new URL(u, location.href);
      // data URL não tem arquivo: o pathname seria "image/png;base64,AAA..."
      // e o nome viraria lixo. O mime é a única pista útil.
      if (url.protocol === 'data:') {
        const mime = mimeFromDataUrl(u);
        const ext = (mime.split('/')[1] || 'png').replace('+xml', '').replace('jpeg', 'jpg');
        return `imagem.${ext}`;
      }
      const n = decodeURIComponent(url.pathname.split('/').pop() || '');
      return n || 'imagem';
    } catch { return 'imagem'; }
  }

  /**
   * mime de uma data URL: `image/png;base64,...` -> `image/png`.
   *
   * Sem esta função o `captureImage` estourava ReferenceError em toda imagem
   * inline, o `catch` do runItem assumia, e o pre-prompt saía sem imagem
   * nenhuma — a pessoa pedia "ler o texto da imagem" e o modelo recebia só
   * o texto.
   */
  function mimeFromDataUrl(u) {
    const m = /^data:([^;,]+)[;,]/.exec(u || '');
    return m && m[1].startsWith('image/') ? m[1] : '';
  }

  function mimeFromUrl(u) {
    const m = /\.(\w+)(?:\?|$)/.exec(u.split('?')[0] || '');
    const ext = (m && m[1] || '').toLowerCase();
    return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' })[ext] || 'image/png';
  }

  /**
   * Captura a imagem como data URL.
   * 1) canvas (funciona para mesma origem ou servidor com CORS)
   * 2) delega ao service worker, que tem permissão de host
   * Detecta cross-origin sem CORS e sugere abrir em nova aba
   */
  async function captureImage(src) {
    const maxEdge = state.settings.maxImageEdge || 1568;

    if (typeof src === 'string' && src.startsWith('data:')) {
      return {
        uri: src,
        name: fileNameFromUrl(src),
        mime: mimeFromDataUrl(src) || mimeFromUrl(src)
      };
    }

    // Check if cross-origin without CORS likely
    let isCrossOrigin = false;
    try {
      const srcUrl = new URL(src, location.href);
      isCrossOrigin = srcUrl.origin !== location.origin;
    } catch { /* invalid URL, treat as same-origin */ }

    try {
      const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      return { uri: canvas.toDataURL('image/jpeg', 0.85), name: fileNameFromUrl(src), mime: 'image/jpeg' };
    } catch (err) {
      // If cross-origin and CORS failed, give helpful hint
      if (isCrossOrigin && (err.name === 'TypeError' || err.message.includes('CORS') || err.message.includes('cross-origin'))) {
        const hint = ' (imagem cross-origin sem CORS — abra a imagem em nova aba e tente de novo)';
        throw new Error(`CORS bloqueado${hint}`);
      }
      // else fall through to service worker
    }

    const viaWorker = await chrome.runtime.sendMessage({ type: 'oc:fetchImage', src });
    if (!viaWorker?.uri) throw new Error('não foi possível capturar a imagem');
    return { uri: viaWorker.uri, name: fileNameFromUrl(src), mime: viaWorker.mime || mimeFromUrl(src) };
  }

  // ------------------------------------------------------- eventos de seleção

  /**
   * O evento veio de dentro do menu?
   *
   * O menu vive num shadow DOM, então um listener no `document` NÃO recebe o
   * botão: o alvo é retargetado para o host (#oc-host) e
   * `menu.contains(e.target)` dava sempre falso. Resultado: o `mousedown`
   * fechava o menu antes do `click`, o botão saía do DOM e clicar num
   * pre-prompt não fazia nada.
   *
   * `composedPath()` devolve o caminho real, atravessando a sombra.
   */
  function dentroDoMenu(e) {
    if (typeof e.composedPath === 'function') return e.composedPath().includes(menu);
    return menu.contains(e.target);
  }

  let selectTimer = null;
  document.addEventListener('mouseup', (e) => {
    if (state.menu?.kind === 'image') return;
    if (state.dragging) return;
    // clique dentro do menu não pode re-renderizar (o botão morreria antes
    // do próprio click)
    if (dentroDoMenu(e)) return;
    clearTimeout(selectTimer);
    selectTimer = setTimeout(() => maybeShowTextMenu(), 40);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.menu) {
      e.preventDefault();
      closeMenu();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (state.menu && !dentroDoMenu(e)) closeMenu();
  });

  function maybeShowTextMenu() {
    if (state.settings.selectionMenu === false) return;
    const text = selectedText();
    if (!text || text.length < 2) { closeMenu(); return; }
    const sel = window.getSelection();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { closeMenu(); return; }

    state.lastSelection = text.slice(0, 6000);
    state.menu = { kind: 'text', text: state.lastSelection, src: null };
    // rect from getBoundingClientRect is viewport-relative; menu is fixed-position
    renderMenu({
      kind: 'text',
      items: TEXT_PROMPTS,
      x: rect.left,
      y: rect.bottom + 6,
      footer: text.length > 6000 ? `Selecionado: ${text.length} caracteres (enviando 6.000)` : null
    });
  }

  document.addEventListener('contextmenu', (e) => {
    if (state.settings.imageMenu === false) return;
    const img = e.target instanceof Element ? e.target.closest('img') : null;
    if (!img || !img.src) return;
    if (state.settings.preventImageContextMenu) e.preventDefault();
    state.menu = { kind: 'image', src: img.src, text: '' };
    renderMenu({
      kind: 'image',
      items: IMAGE_PROMPTS,
      x: e.clientX,
      y: e.clientY,
      footer: `Origem: ${fileNameFromUrl(img.src)}`
    });
  });

  window.addEventListener('scroll', () => { if (state.menu) closeMenu(); }, true);

  // Rede de segurança: se o pointerup acontecer fora da janela (alt-tab, clique
  // em outra aba) o estado ficaria preso e o próximo movimento do mouse
  // arrastaria o painel sozinho.
  const endAnyDrag = () => {
    if (state.dragging?.kind === 'bubble') {
      state.dragMoved = state.dragging.moved;
      state.dragging = null;
      desligaVeu();
      saveDebounced({ bubblePos: state.bubble });
      return;
    }
    if (state.dragging || state.resize) fimGesto();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (state.dragging || state.resize)) endAnyDrag();
  });

  window.addEventListener('resize', () => {
    placeBubble();
    clampFrame();
    if (state.menu) closeMenu();
  });

  // ------------------------------------------------------------------ init

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      state.settings = Object.assign(state.settings, changes.settings.newValue || {});
      applyVisibility();
      if (state.settings.showBubble === false) closePanel();
    }
    if (area === 'local' && changes.frameRect) {
      Object.assign(state.frame, changes.frameRect.newValue || {});
      clampFrame();
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'oc:toggle') { togglePanel(); sendResponse({ open: state.panelOpen }); }
    else if (msg.type === 'oc:isOpen') sendResponse({ open: state.panelOpen });
    else if (msg.type === 'oc:askFromBackground') {
      const payload = msg.payload;
      if (state.panelOpen && state.panelReady) {
        frame.contentWindow.postMessage(toPanel({ type: 'oc:ask', payload }), EXTENSION_ORIGIN);
      } else openPanel(payload);
      sendResponse({ ok: true });
    }
    return true;
  });

  loadSettings().then(() => {
    applyVisibility();
    placeBubble();
    clampFrame();
  });
}