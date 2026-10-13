/**
 * Cliente da API v2 do OpenCode (servidor local).
 *
 * Contrato verificado contra opencode v2.0.27:
 *   POST /api/session                                  -> cria sessão
 *   POST /api/session/{id}/prompt                      -> envia mensagem (steer/queue)
 *   GET  /api/session/{id}/message                     -> histórico projetado
 *   POST /api/session/{id}/interrupt                    -> interrompe execução
 *   GET  /api/event                                    -> SSE de todos os eventos
 *   GET  /api/model | /api/agent | /api/skill | /api/session
 *
 * Autenticação: HTTP Basic com usuário fixo "opencode" e a senha do servidor.
 */

export const DEFAULT_PORT = 4177;

export class OpencodeClient extends EventTarget {
  constructor() {
    super();
    this.host = '127.0.0.1';
    this.port = DEFAULT_PORT;
    this.password = '';
    this.directory = '';
    this.stream = null;
    this.streamAbort = null;
    this.connected = false;
  }

  get base() {
    return `http://${this.host}:${this.port}`;
  }

  configure(cfg = {}) {
    if (cfg.host) this.host = cfg.host;
    if (cfg.port) this.port = Number(cfg.port);
    if (cfg.password !== undefined) this.password = cfg.password;
    if (cfg.directory !== undefined) this.directory = cfg.directory;
  }

  authHeader() {
    const raw = `opencode:${this.password}`;
    const bytes = new TextEncoder().encode(raw);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return `Basic ${btoa(bin)}`;
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  async request(path, { method = 'GET', body, timeout = 30000, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: this.authHeader(),
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
      if (!res.ok) {
        const err = new Error(json?.message || `HTTP ${res.status}`);
        err.status = res.status;
        err.tag = json?._tag;
        err.body = json;
        throw err;
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ping: /api/location responde rápido e exige auth. */
  async ping() {
    const res = await this.request('/api/location', { timeout: 6000 });
    this.connected = true;
    return res;
  }

  async models() {
    // o diretório vai sempre explícito: sem ele o servidor tenta resolver a
    // location padrão e responde 503 "Location plugins did not finish
    // activating" — o catálogo de modelos fica indisponível
    const q = this.directory
      ? `/api/model?directory=${encodeURIComponent(this.directory)}`
      : '/api/model';
    const res = await this.request(q, { timeout: 60000 });
    return res?.data ?? [];
  }

  async agents() {
    const res = await this.request('/api/agent', { timeout: 20000 });
    return res?.data ?? [];
  }

  async skills() {
    const res = await this.request('/api/skill', { timeout: 30000 });
    return (res?.data ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description }));
  }

  /**
   * Sessões do projeto, igual ao `opencode session list` do CLI.
   *
   * A API devolve subagentes junto: no projeto do Desktop, 200 linhas vindas
   * do servidor eram só 33 conversas e 167 filhos de subagente (k4-ling31,
   * k4-step5 e companhia). O CLI esconde os filhos, então aqui também:
   * quem tem parentID não é sessão que a pessoa abriu.
   *
   * O filtro é no servidor (client-side seria tarde demais com limit: 60 —
   * viriam 60 linhas quase todas de subagente e nenhuma conversa de verdade).
   */
  async listSessions({ directory, limit = 60, order = 'desc', search } = {}) {
    const topLevel = [];
    let cursor;
    // pagina até encher a lista ou o servidor parar de devolver cursor
    for (let pagina = 0; pagina < 12 && topLevel.length < limit; pagina++) {
      const q = new URLSearchParams();
      if (directory) q.set('directory', directory);
      // pede janela grande: quase tudo que volta é subagente
      q.set('limit', String(Math.max(limit, 200)));
      if (order) q.set('order', order);
      if (search) q.set('search', search);
      if (cursor) q.set('cursor', cursor);

      const res = await this.request(`/api/session?${q}`, { timeout: 30000 });
      const lote = res?.data ?? [];
      if (!lote.length) break;

      for (const s of lote) if (!s.parentID) topLevel.push(s);
      cursor = res?.cursor?.next;
      if (!cursor) break;
    }
    return topLevel.slice(0, limit);
  }

  async createSession({ directory, model, agent } = {}) {
    const res = await this.request('/api/session', {
      method: 'POST',
      timeout: 30000,
      body: {
        location: { directory: directory || this.directory },
        ...(model ? { model } : {}),
        ...(agent ? { agent } : {})
      }
    });
    return res.data;
  }

  async getSession(id) {
    const res = await this.request(`/api/session/${id}`, { timeout: 15000 });
    return res.data;
  }

  /** Encerra uma sessão. Usada pela cascata de visão, que some com a dela. */
  async deleteSession(id) {
    await this.request(`/api/session/${id}`, { method: 'DELETE', timeout: 15000 });
  }

  async messages(id, { limit = 100, order = 'asc' } = {}) {
    const res = await this.request(`/api/session/${id}/message?limit=${limit}&order=${order}`, {
      timeout: 30000
    });
    return res?.data ?? [];
  }

  async prompt(id, { text, files = [], skills = [], delivery = 'steer' } = {}) {
    // `skills` chega em duas formas: string ('nome-da-skill') ou o objeto
    // {name} que o roteador monta. Embrulhar sem normalizar mandava
    // agents[0].name = {name: '...'} e o servidor respondia
    // "Expected string at [agents][0][name]" — quebrando todo envio.
    const agents = skills
      .map((s) => (typeof s === 'string' ? s : s?.name))
      .filter((name) => typeof name === 'string' && name.length > 0)
      .map((name) => ({ name }));

    const res = await this.request(`/api/session/${id}/prompt`, {
      method: 'POST',
      timeout: 30000,
      body: {
        text,
        ...(files.length ? { files } : {}),
        ...(agents.length ? { agents } : {}),
        delivery
      }
    });
    return res?.data;
  }

  async interrupt(id) {
    return this.request(`/api/session/${id}/interrupt`, { method: 'POST', timeout: 10000 });
  }

  async setModel(id, model) {
    return this.request(`/api/session/${id}/model`, { method: 'POST', timeout: 15000, body: { model } });
  }

  async setAgent(id, agent) {
    return this.request(`/api/session/${id}/agent`, { method: 'POST', timeout: 15000, body: { agent } });
  }

  /**
   * Stream SSE de /api/event.
   *
   * Formato real observado:
   *   data: {"type":"session.text.delta","data":{"sessionID":"ses_..","delta":"..."}}
   * Eventos usados pelo painel:
   *   session.text.started / .delta / .ended
   *   session.execution.started / .succeeded
   *   session.renamed, session.usage.updated, session.retry.scheduled
   *   session.step.started / .failed, session.tool.called / .failed
   */
  /**
   * Abre o SSE.
   *
   * Importante: NÃO devolve a promise do loop. Quem chama costuma fazer
   * `await openStream()` e ficaria preso enquanto o stream estivesse vivo.
   * Erros de conexão chegam pelo evento 'stream-error'.
   */
  async openStream() {
    this.closeStream();
    const controller = new AbortController();
    this.streamAbort = controller;

    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          const res = await fetch(`${this.base}/api/event`, {
            headers: { Authorization: this.authHeader(), Accept: 'text/event-stream' },
            signal: controller.signal
          });
          if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
          this.connected = true;
          this.emit('stream-open', {});

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              for (const line of chunk.split('\n')) {
                if (!line.startsWith('data:')) continue;
                const raw = line.slice(5).trim();
                if (!raw) continue;
                try {
                  const evt = JSON.parse(raw);
                  this.emit('event', evt);
                } catch { /* heartbeat ou frame inválido */ }
              }
            }
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          this.connected = false;
          this.emit('stream-error', { error: err });
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };
    this.stream = run();
    // resolve no próximo tick: quem chamou não fica preso no loop
    return undefined;
  }

  /** Aguarda o stream ficar pronto (primeiro SSE aberto) ou o tempo limite. */
  waitForStream(timeout = 5000) {
    const self = this;
    if (self.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        self.removeEventListener('stream-open', onOpen);
        self.removeEventListener('stream-error', onErr);
        resolve(value);
      };
      const onOpen = () => finish(true);
      const onErr = () => finish(false);
      const timer = setTimeout(() => finish(!!self.connected), timeout);
      self.addEventListener('stream-open', onOpen);
      self.addEventListener('stream-error', onErr);
    });
  }

  closeStream() {
    if (this.streamAbort) this.streamAbort.abort();
    this.streamAbort = null;
    this.stream = null;
    this.connected = false;
  }
}

/** Extrai o texto de uma mensagem projetada (v2 tem dois formatos). */
export function messageText(msg) {
  if (!msg) return '';
  if (typeof msg.text === 'string') return msg.text;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c) => c.type === 'text' && !c.synthetic)
      .map((c) => c.text)
      .join('\n\n');
  }
  return '';
}

/** Partes de uma mensagem, para render blocos e anexos. */
export function messageParts(msg) {
  if (!msg) return [];
  if (Array.isArray(msg.content)) return msg.content;
  if (typeof msg.text === 'string') return [{ type: 'text', text: msg.text }];
  return [];
}