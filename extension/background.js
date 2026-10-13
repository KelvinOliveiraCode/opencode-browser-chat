/**
 * Service worker: bridge de imagem, menu de contexto, atalhos e instalação.
 *
 * O worker não guarda conexão com o OpenCode — quem mantém o SSE é a
 * página do painel (extension page), que não é descarregada pelo Chrome.
 */

const apiUrlBase = () => 'http://127.0.0.1:4177';

/** Baixa a imagem e devolve como data URL (o worker tem permissão de host). */
async function fetchImageAsDataUrl(src, maxEdge = 1568) {
  const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('não é imagem');

  if (blob.type === 'image/gif' || blob.type === 'image/svg+xml') {
    return {
      uri: await blobToDataUrl(blob),
      mime: blob.type
    };
  }

  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return { uri: await blobToDataUrl(out), mime: 'image/jpeg' };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await buildContextMenus();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  }
});

chrome.runtime.onStartup.addListener(() => buildContextMenus());

let menusBuilt = false;

async function buildContextMenus() {
  if (menusBuilt) return;
  menusBuilt = true;
  await chrome.contextMenus.removeAll().catch(() => {});
  chrome.contextMenus.create({
    id: 'oc-root',
    title: 'OpenCode: explicar seleção',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'oc-panel',
    title: 'Abrir o painel de chat',
    contexts: ['action', 'page', 'selection', 'image']
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'oc-panel') {
    chrome.tabs.sendMessage(tab.id, { type: 'oc:toggle' }).catch(() => {});
    return;
  }
  if (info.menuItemId === 'oc-root' && info.selectionText) {
    const payload = {
      prompt: `Explique o texto abaixo para quem não manja do assunto.\n\n` +
        `## Texto selecionado\n${info.selectionText.trim()}\n\n` +
        `## Página de origem\nURL: ${info.pageUrl}\n\n` +
        `Comece pelo significado do termo central em uma frase, depois desenrole. ` +
        `Use uma analogia concreta se ajudar. Máximo 6 parágrafos.`,
      skills: [],
      files: [],
      page: `URL: ${info.pageUrl}`,
      newSession: true
    };
    chrome.tabs.sendMessage(tab.id, { type: 'oc:askFromBackground', payload }).catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'oc:toggle' }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'oc:toggle' }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'oc:fetchImage') {
    fetchImageAsDataUrl(msg.src, msg.maxEdge)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // resposta assíncrona
  }

  // Captura a aba visível para o modelo "ver" a tela.
  // Só o service worker tem acesso a chrome.tabs.captureVisibleTab — e
  // precisa de <all_urls> em host_permissions (a extensão já tem).
  if (msg?.type === 'oc:captureVisibleTab') {
    const win = sender?.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(win, { format: 'jpeg', quality: 78 })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg?.type === 'oc:ping') {
    sendResponse({ ok: true, api: apiUrlBase(), from: sender?.id || null });
    return true;
  }
  return false;
});