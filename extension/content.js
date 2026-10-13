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

const PANEL_URL = chrome.runtime.getURL('panel.html');

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

  async function loadSettings() {
    const got = await chrome.storage.local.get([
      'bubblePos', 'frameRect', 'settings'
    ]);
    state.bubble = got.bubblePos || { x: null, y: null };
    state.frame = Object.assign({ x: 0, y: 0, w: 480, h: 720 }, got.frameRect || {});
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
}
.oc-panel.is-open { display: block; }
.oc-panel iframe { width: 100%; height: 100%; border: 0; display: block; }

.oc-grip {
  position: absolute; right: 0; bottom: 0;
  width: 16px; height: 16px; cursor: nwse-resize;
  z-index: 2;
}
.oc-grip::after {
  content: ""; position: absolute; right: 3px; bottom: 3px;
  width: 7px; height: 7px;
  border-right: 2px solid rgba(255,255,255,.35);
  border-bottom: 2px solid rgba(255,255,255,.35);
  border-radius: 0 0 2px 0;
}

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
  const frame = document.createElement('iframe');
  frame.src = PANEL_URL;
  frame.title = 'Chat OpenCode';
  frame.allow = 'clipboard-write';
  panel.append(frame);
  const grip = document.createElement('div');
  grip.className = 'oc-grip';
  panel.append(grip);
  root.append(panel);

  const menu = document.createElement('div');
  menu.className = 'oc-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  root.append(menu);

  (document.body || document.documentElement).append(host);

  // ------------------------------------------------------------- geometria

  function clampFrame() {
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
    // O iframe só conhece coordenadas relativas a ele. Para o arraste
    // funcionar, o painel precisa saber onde o iframe está na viewport.
    try {
      frame.contentWindow?.postMessage({ type: 'oc:geometry', x: f.x, y: f.y }, '*');
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
      frame.contentWindow.postMessage({ type: 'oc:ask', payload }, '*');
    } else {
      frame.contentWindow.postMessage({ type: 'oc:fresh' }, '*');
    }
    panel.classList.add('is-open');
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

  bubble.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    state.dragging = {
      kind: 'bubble',
      offX: e.clientX - state.bubble.x,
      offY: e.clientY - state.bubble.y,
      moved: false
    };
    state.dragMoved = false;
    bubble.setPointerCapture(e.pointerId);
  });

  bubble.addEventListener('pointermove', (e) => {
    if (!state.dragging || state.dragging.kind !== 'bubble') return;
    state.dragging.moved = true;
    state.bubble.x = e.clientX - state.dragging.offX;
    state.bubble.y = e.clientY - state.dragging.offY;
    placeBubble();
  });

  bubble.addEventListener('pointerup', (e) => {
    if (state.dragging && state.dragging.kind === 'bubble') {
      state.dragMoved = state.dragging.moved;
      state.dragging = null;
      try { bubble.releasePointerCapture(e.pointerId); } catch { /* já liberado */ }
      save({ bubblePos: state.bubble });
    }
  });

  // ------------------------------------------------------------ drag do painel
  // O cabeçalho vive dentro do iframe; lá ele avisa e aqui movemos.

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    state.resize = { sx: e.clientX, sy: e.clientY, sw: state.frame.w, sh: state.frame.h };
    grip.setPointerCapture(e.pointerId);
  });

  grip.addEventListener('pointermove', (e) => {
    if (!state.resize) return;
    state.frame.w = state.resize.sw + (e.clientX - state.resize.sx);
    state.frame.h = state.resize.sh + (e.clientY - state.resize.sy);
    clampFrame();
  });

  grip.addEventListener('pointerup', (e) => {
    if (!state.resize) return;
    state.resize = null;
    try { grip.releasePointerCapture(e.pointerId); } catch { /* já liberado */ }
    save({ frameRect: state.frame });
  });

  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object' || !msg.type) return;

    if (msg.type === 'oc:ready') {
      state.panelReady = true;
      if (state.pending) {
        frame.contentWindow.postMessage({ type: 'oc:ask', payload: state.pending }, '*');
        state.pending = null;
      } else if (state.pendingFresh) {
        frame.contentWindow.postMessage({ type: 'oc:fresh' }, '*');
        state.pendingFresh = false;
      }
      return;
    }

    if (msg.type === 'oc:close') { closePanel(); return; }

    if (msg.type === 'oc:frame') {
      Object.assign(state.frame, msg.rect || {});
      state.frameOpen = !!msg.open;
      panel.classList.toggle('is-open', msg.open);
      bubble.classList.toggle('is-open', !!msg.open);
      clampFrame();
      if (msg.persist) save({ frameRect: state.frame });
      return;
    }

    if (msg.type === 'oc:dragStart') {
      // O painel faz o arrasto inteiro DENTRO do iframe, com pointer capture.
      // Antes os listeners ficavam aqui na janela pai e paravam de chegar
      // assim que o cursor saía do iframe — o cursor ficava "grudado".
      state.dragging = true;
      return;
    }

    if (msg.type === 'oc:dragMove') {
      if (!state.dragging) return;
      // coordenadas absolutas da viewport, vindas do iframe
      state.frame.x = msg.x;
      state.frame.y = msg.y;
      clampFrame();
      return;
    }

    if (msg.type === 'oc:dragEnd') {
      state.dragging = false;
      save({ frameRect: state.frame });
      return;
    }

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
   * Espera o compositor repintar.
   *
   * requestAnimationFrame NÃO roda em aba sem foco — e depender só dele
   * deixava o painel invisível para sempre quando a captura acontecia com a
   * aba em segundo plano. O timer garante que o fluxo sempre continue.
   */
  function waitPaint(ms = 140) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, ms);
    });
  }

  async function captureTabForPanel() {
    const visibilidade = panel.style.visibility;
    panel.style.visibility = 'hidden';
    await waitPaint();

    try {
      // captureVisibleTab trava quando a janela não está focada e não rejeita
      // — não volta nunca. Sem este prazo o painel ficava invisível para
      // sempre, porque o finally só roda quando a promise assenta.
      const res = await Promise.race([
        chrome.runtime.sendMessage({ type: 'oc:captureVisibleTab' }),
        new Promise((r) => setTimeout(() => r({ ok: false, error: 'a janela do navegador não está focada' }), 10000))
      ]);
      if (!res?.ok || !res?.dataUrl) {
        toastPanel('Não consegui capturar: ' + (res?.error || 'resposta vazia'));
        return;
      }
      frame.contentWindow.postMessage({
        type: 'oc:captured',
        dataUrl: res.dataUrl,
        width: res.width,
        height: res.height
      }, '*');
    } catch (err) {
      toastPanel('Falha na captura: ' + err.message);
    } finally {
      panel.style.visibility = visibilidade;
    }
  }

  function toastPanel(text) {
    frame.contentWindow.postMessage({ type: 'oc:toast', text }, '*');
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
        closeMenu();
        runItem(item);
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
      frame.contentWindow.postMessage({ type: 'oc:ask', payload }, '*');
    } else {
      openPanel(payload);
    }
  }

  function runItem(item) {
    if (state.menu && state.menu.kind === 'image') {
      const src = state.menu.src;
      captureImage(src)
        .then((file) => {
          askWithText(buildImagePrompt(item, pageInfo()), item.skill ? [item.skill] : [],
            file ? [file] : [{ uri: src, name: fileNameFromUrl(src), mime: mimeFromUrl(src) }]);
        })
        .catch(() => {
          askWithText(buildImagePrompt(item, pageInfo()), item.skill ? [item.skill] : []);
        });
      return;
    }
    const text = state.lastSelection || selectedText();
    if (!text) return;
    askWithText(buildTextPrompt(item, text, pageInfo()), item.skill ? [item.skill] : []);
  }

  function fileNameFromUrl(u) {
    try {
      const p = new URL(u, location.href).pathname;
      const n = decodeURIComponent(p.split('/').pop() || '');
      return n || 'imagem';
    } catch { return 'imagem'; }
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
   */
  async function captureImage(src) {
    const maxEdge = state.settings.maxImageEdge || 1568;
    try {
      const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
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
    } catch { /* canvas ou rede falhou */ }

    const viaWorker = await chrome.runtime.sendMessage({ type: 'oc:fetchImage', src });
    if (!viaWorker?.uri) throw new Error('não foi possível capturar a imagem');
    return { uri: viaWorker.uri, name: fileNameFromUrl(src), mime: viaWorker.mime || mimeFromUrl(src) };
  }

  // ------------------------------------------------------- eventos de seleção

  let selectTimer = null;
  document.addEventListener('mouseup', (e) => {
    if (state.menu?.kind === 'image') return;
    if (state.dragging) return;
    if (menu.contains(e.target)) return;
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
    if (state.menu && !menu.contains(e.target)) closeMenu();
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
    renderMenu({
      kind: 'text',
      items: TEXT_PROMPTS,
      x: rect.left + window.scrollX,
      y: rect.bottom + window.scrollY + 6,
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

  // Rede de segurança do arraste: se o pointerup acontecer fora da janela
  // (alt-tab, clique em outra aba) o estado ficaria preso e o próximo
  // movimento do mouse arrastaria o painel sozinho.
  const endAnyDrag = () => {
    if (!state.dragging) return;
    const wasPanel = state.dragging === true;
    state.dragging = null;
    if (wasPanel) save({ frameRect: state.frame });
  };
  window.addEventListener('pointerup', endAnyDrag, true);
  window.addEventListener('pointercancel', endAnyDrag, true);
  window.addEventListener('blur', endAnyDrag, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.dragging) endAnyDrag();
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
        frame.contentWindow.postMessage({ type: 'oc:ask', payload }, '*');
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