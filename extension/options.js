/**
 * Página de opções: configuração do servidor, comportamento e os dois modelos.
 *
 * São dois seletores independentes: o modelo de texto (o padrão da conversa) e
 * o modelo de visão. Quando os dois diferem, uma imagem anexada passa primeiro
 * pelo de visão, que descreve o que vê, e essa descrição segue como contexto
 * para o de texto — que pode não enxergar imagem alguma.
 */
const { SKILL_ROUTER } = globalThis.OC_PROMPTS;

const DEFAULTS = {
  host: '127.0.0.1',
  port: 4177,
  password: 'testefixo123',
  directory: 'C:\\Users\\Kelvin\\Desktop',
  model: { providerID: 'kilo4', id: 'stepfun/step-5-preview-free', variant: 'medium' },
  modelLabel: '[K4] Step 5 Preview',
  agent: 'plan',
  skills: [SKILL_ROUTER],
  skillsLabel: '',
  // null = usa o mesmo modelo de texto (comportamento de antes)
  visionModel: null,
  visionLabel: '',
  useSameVisionModel: true
};

const SETTINGS_DEFAULTS = {
  showBubble: true,
  selectionMenu: true,
  imageMenu: true,
  preventImageContextMenu: true,
  maxImageEdge: 1568,
  autoOpenOnPrompt: true
};

const $ = (id) => document.getElementById(id);

function status(msg, kind) {
  const el = $('status');
  el.hidden = false;
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.textContent = msg;
}

// ---------------------------------------------------------------- servidor

async function load() {
  const got = await chrome.storage.local.get(['cfg', 'settings']);
  const cfg = Object.assign({}, DEFAULTS, got.cfg || {});
  $('host').value = cfg.host;
  $('port').value = cfg.port;
  $('password').value = cfg.password;
  $('directory').value = cfg.directory;

  const s = Object.assign({}, SETTINGS_DEFAULTS, got.settings || {});
  for (const key of ['showBubble', 'selectionMenu', 'imageMenu',
    'preventImageContextMenu', 'autoOpenOnPrompt']) {
    $(key).checked = !!s[key];
  }

  // os dois seletores dividem a mesma lista de modelos
  await carregarModelos();
  texto.carregar(cfg.model);
  visao.carregar(cfg.visionModel, cfg.useSameVisionModel !== false);

  // o estado da caixa "mesmo modelo" tambem precisa vir do storage
  const mesmo = cfg.useSameVisionModel !== false;
  $('sameVision').checked = mesmo;
  $('visionGroup').classList.toggle('off', mesmo);
  $('visionSearch').disabled = mesmo;
  $('visionEffort').disabled = mesmo;
}

async function saveCfg() {
  const got = await chrome.storage.local.get(['cfg']);
  const cfg = Object.assign({}, DEFAULTS, got.cfg || {});
  cfg.host = $('host').value.trim() || DEFAULTS.host;
  cfg.port = Number($('port').value) || DEFAULTS.port;
  cfg.password = $('password').value;
  cfg.directory = $('directory').value.trim();
  await chrome.storage.local.set({ cfg });
  status('Configuração salva. Recarregue as abas abertas para o botão aparecer.', 'ok');
}

async function saveSettings() {
  const settings = {};
  for (const key of ['showBubble', 'selectionMenu', 'imageMenu',
    'preventImageContextMenu', 'autoOpenOnPrompt']) {
    settings[key] = $(key).checked;
  }
  await chrome.storage.local.set({ settings });
  status('Comportamento salvo. Vale para as abas já abertas.', 'ok');
}

async function test() {
  const host = $('host').value.trim() || '127.0.0.1';
  const port = Number($('port').value) || 4177;
  const pw = $('password').value;
  status('Testando…');

  const raw = `opencode:${pw}`;
  const bytes = new TextEncoder().encode(raw);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const auth = 'Basic ' + btoa(bin);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`http://${host}:${port}/api/location`, {
      headers: { Authorization: auth },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const json = await res.json().catch(() => null);

    if (res.ok) {
      status(`Conectado. Servidor em ${json?.directory || host}`, 'ok');
    } else if (res.status === 401) {
      status('Senha errada. Confira o OPENCODE_SERVER_PASSWORD usado para iniciar o servidor.', 'err');
    } else {
      status(`Erro HTTP ${res.status}.`, 'err');
    }
  } catch (err) {
    status(`Não respondeu em http://${host}:${port}. O servidor está rodando? (${err.message})`, 'err');
  }
}

// ------------------------------------------------------------ modelos

let listaModelos = [];

function authHeader() {
  const host = $('host').value.trim() || '127.0.0.1';
  const port = Number($('port').value) || 4177;
  const pw = $('password').value;
  const raw = `opencode:${pw}`;
  const bytes = new TextEncoder().encode(raw);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'Basic ' + btoa(bin);
}

function baseUrl() {
  const host = $('host').value.trim() || '127.0.0.1';
  const port = Number($('port').value) || 4177;
  return `http://${host}:${port}`;
}

function veImagem(m) {
  return ((m && m.capabilities && m.capabilities.input) || []).includes('image');
}

function chave(m) {
  return m ? `${m.providerID}/${m.id || m.modelID}` : '';
}

function acharNaLista(ref) {
  if (!ref) return null;
  return listaModelos.find((m) => m.providerID === ref.providerID &&
    (m.id || m.modelID) === ref.id) || null;
}

async function carregarModelos() {
  for (const p of [texto, visao]) {
    $(p.id.list).innerHTML = '<div class="none">carregando modelos…</div>';
    $(p.id.count).textContent = '';
  }
  try {
    const res = await fetch(
      `${baseUrl()}/api/model?directory=${encodeURIComponent($('directory').value.trim())}`,
      { headers: { Authorization: authHeader() } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    listaModelos = Array.isArray(json?.data) ? json.data : [];
    texto.pintar();
    visao.pintar();
  } catch (err) {
    for (const p of [texto, visao]) {
      $(p.id.list).innerHTML = `<div class="none">nao consegui ler os modelos: ${err.message}</div>`;
    }
  }
}

/**
 * Um seletor de modelo.
 *
 * `ids` liga cada peça ao elemento do HTML, porque os nomes dos dois seletores
 * não seguem o mesmo padrão (o de texto usa `effort`, o de visão
 * `visionEffort`). `soVisao` restringe a lista a modelos que enxergam imagem:
 * no seletor de visão, um modelo sem visão não faria sentido.
 */
function makePicker(ids, { soVisao = false } = {}) {
  const p = { id: ids, soVisao, escolhido: null, atual: null };

  p.filtrados = () => {
    const q = ($(p.id.search).value || '').trim().toLowerCase();
    let vis = listaModelos;
    if (soVisao) vis = vis.filter(veImagem);
    if (q) {
      vis = vis.filter((m) => `${m.name || m.id} ${m.providerID} ${m.id}`.toLowerCase().includes(q));
    }
    return vis.slice().sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'pt-BR'));
  };

  p.pintar = () => {
    const vis = p.filtrados();
    const alvo = $(p.id.list);
    alvo.innerHTML = '';

    if (!listaModelos.length && !soVisao) {
      alvo.innerHTML = '<div class="none">carregando modelos…</div>';
      return;
    }
    if (!vis.length) {
      alvo.innerHTML = `<div class="none">${soVisao ? 'nenhum modelo com visão' : 'nenhum modelo com esse filtro'}</div>`;
      $(p.id.count).textContent = '0 de ' + listaModelos.length;
      return;
    }
    $(p.id.count).textContent = `${vis.length} de ${listaModelos.length} modelos`;

    for (const m of vis) {
      const ehAtual = chave(p.escolhido) === chave(m) && !!p.escolhido;
      const linha = document.createElement('div');
      linha.className = 'mitem' + (ehAtual ? ' sel' : '');
      linha.setAttribute('role', 'option');
      linha.setAttribute('aria-selected', ehAtual ? 'true' : 'false');

      const marca = document.createElement('span');
      marca.className = 'mkey';
      marca.textContent = ehAtual ? '>' : ' ';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = m.name || m.id;
      const pv = document.createElement('span');
      pv.className = 'pv';
      pv.textContent = m.providerID;
      const olho = document.createElement('span');
      olho.className = 'eye';
      olho.textContent = veImagem(m) ? 've' : '';
      linha.append(marca, nm, pv, olho);

      linha.addEventListener('click', () => {
        p.escolhido = m;
        p.pintar();
        p.preencherEffort();
      });
      alvo.append(linha);
    }
  };

  p.preencherEffort = () => {
    const sel = $(p.id.effort);
    if (!sel) return;
    const m = p.escolhido;
    const variantes = ((m && m.variants) || []).map((v) => v.id).filter(Boolean);
    sel.innerHTML = '';
    const padrao = document.createElement('option');
    padrao.value = '';
    padrao.textContent = variantes.length ? `padrao do modelo (${variantes[0]})` : 'padrao do modelo';
    sel.append(padrao);
    for (const v of variantes) sel.append(new Option(v, v));

    const a = p.atual;
    const ehOMesmo = a && m && chave(a) === chave(m);
    sel.value = ehOMesmo && a.variant && variantes.includes(a.variant) ? a.variant : '';

    if (p.id.vision) $(p.id.vision).checked = veImagem(m);
  };

  p.mostrarAtual = () => {
    const c = p.atual;
    const el = $(p.id.current);
    if (!el) return;
    if (!c) {
      el.textContent = soVisao
        ? 'Usando o mesmo modelo de texto.'
        : 'Nenhum escolhido: o painel pergunta na primeira vez.';
      return;
    }
    const nome = acharNaLista(c);
    const esforco = c.variant ? ` · effort ${c.variant}` : ' · effort padrao';
    el.textContent = `Agora: ${nome?.name || c.id} (${chave(c)})${esforco}`;
  };

  p.carregar = (ref, desativado) => {
    p.atual = ref || null;
    p.desativado = !!desativado;
    p.escolhido = acharNaLista(ref);
    p.pintar();
    if (p.escolhido) p.preencherEffort();
    p.mostrarAtual();
  };

  p.salvar = async () => {
    const m = p.escolhido;
    if (!m) { status('Escolha um modelo na lista antes de salvar.', 'err'); return false; }
    const sel = $(p.id.effort);
    const effort = sel ? sel.value : '';
    const model = { providerID: m.providerID, id: m.id || m.modelID };
    if (effort) model.variant = effort;
    p.atual = model;
    p.escolhido = null;
    p.pintar();
    p.mostrarAtual();
    return model;
  };

  $(p.id.search)?.addEventListener('input', p.pintar);
  return p;
}

const texto = makePicker({
  search: 'modelSearch', list: 'modelList', effort: 'effort',
  vision: 'modelVision', current: 'currentModel', count: 'modelCount'
});

const visao = makePicker({
  search: 'visionSearch', list: 'visionList', effort: 'visionEffort',
  vision: 'visionVision', current: 'currentvision', count: 'visionCount'
}, { soVisao: true });

// ------------------------------------------------------- salvar modelos

$('saveModel').addEventListener('click', async () => {
  const model = await texto.salvar();
  if (!model) return;
  const got = await chrome.storage.local.get(['cfg']);
  const cfg = Object.assign({}, DEFAULTS, got.cfg || {});
  cfg.model = model;
  cfg.modelLabel = acharNaLista(model)?.name || model.id;
  await chrome.storage.local.set({ cfg });
  const onde = model.variant ? `effort ${model.variant}` : 'effort padrao do modelo';
  status(`Modelo de texto: ${cfg.modelLabel} (${onde}). Vale para as conversas novas.`, 'ok');
});

$('saveVision').addEventListener('click', async () => {
  const mesmo = $('sameVision').checked;
  const got = await chrome.storage.local.get(['cfg']);
  const cfg = Object.assign({}, DEFAULTS, got.cfg || {});

  if (mesmo) {
    cfg.useSameVisionModel = true;
    cfg.visionModel = null;
    cfg.visionLabel = '';
    status('Visão: mesmo modelo de texto. Uma imagem anexada vai direto para ele.', 'ok');
  } else {
    const model = await visao.salvar();
    if (!model) return;
    cfg.useSameVisionModel = false;
    cfg.visionModel = model;
    cfg.visionLabel = acharNaLista(model)?.name || model.id;
    const onde = model.variant ? `effort ${model.variant}` : 'effort padrao do modelo';
    status(`Modelo de visão: ${cfg.visionLabel} (${onde}). A imagem passa por ele antes do modelo de texto.`, 'ok');
  }
  await chrome.storage.local.set({ cfg });
});

// liga/desliga o seletor de visão junto com o "mesmo modelo"
$('sameVision').addEventListener('change', () => {
  const mesmo = $('sameVision').checked;
  $('visionGroup').classList.toggle('off', mesmo);
  $('visionSearch').disabled = mesmo;
  $('visionEffort').disabled = mesmo;
  visao.pintar();
});

$('reloadModels').addEventListener('click', carregarModelos);
$('save').addEventListener('click', saveCfg);
$('save2').addEventListener('click', saveSettings);
$('test').addEventListener('click', test);

load();
