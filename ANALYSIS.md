# Análise Profunda: OpenCode Browser Chat Extension

> **Status:** os itens marcados ✅ foram corrigidos e validados por teste.
> Os demais continuam no backlog. Ver `README.md` para o comportamento atual.

## Visão Geral

A extensão **OpenCode Chat Flutuante** é uma implementação sólida que traz o
OpenCode CLI para o navegador. O código demonstra boas práticas: shadow DOM
para isolamento, extension page (iframe) para SSE persistente, service worker
para ponte de imagem/captura, e integração completa com a API v2.

---

## Bugs Corrigidos (✅)

### 1. ✅ **Ponte com o painel silenciosamente morta** — o mais grave
**Arquivo:** `panel.js` / `content.js`

O content script roda no contexto da **página**, então a origem que o painel vê
num `postMessage` é a do **site**, não a da extensão. Duas consequências:

- Validar a origem da extensão no painel derrubava **toda** a ponte: o painel
  ficava mudo, nunca abria sessão, e o botão flutuante não fazia nada —
  sem erro no console.
- Na volta, usar a origem da extensão como `targetOrigin` fazia o navegador
  **descartar** as mensagens em silêncio.

**Correção:** nonce por carregamento. O iframe nasce com `?oc=<nonce>`, e o
painel só aceita mensagens que venham do `window.parent` **e** tragam o nonce.
Na volta, o painel usa a origem da página, passada em `?from=`.

### 2. ✅ **Sessão de visão vazada**
**Arquivo:** `panel.js` (`descreverImagem`)

A cascata criava um `OpencodeClient` separado só para descrever a imagem. Se a
rede caísse, a sessão temporária sobrevivia. Agora usa a instância
compartilhada, com `AbortController` e prazo de 2 min.

### 3. ✅ **Tool card duplicado**
**Arquivo:** `panel.js` (`liveTool`)

Na reconexão do SSE, `session.tool.input.started` repetia e criava um segundo
card para o mesmo `callId`.

### 4. ✅ **`captureVisibleTab` fotografava a aba errada**
**Arquivo:** `background.js`

O `captureVisibleTab` fotografa a aba **ativa** da janela. Com o painel numa
aba de fundo — ou logo após o install, que abre `options.html` — o modelo
recebia o print de outra página, sem aviso. Agora o worker confere se a aba
ativa é a do painel e recusa com mensagem clara.

### 5. ✅ **Captura travada sem recuperação**
**Arquivo:** `background.js` / `content.js`

Com a janela encoberta, o `captureVisibleTab` **trava sem rejeitar** — o painel
ficava invisível para sempre. Agora há prazo no worker e rede final no content
script, e a mensagem diz o que fazer.

### 6. ✅ **Painel dentro da própria foto**
**Arquivo:** `content.js` (`waitPaint`)

Só esperar `requestAnimationFrame` não bastava: em aba sem foco o rAF não roda,
e o compositor devolvia um quadro **antigo**, com o painel ainda desenhado.
Agora há piso de tempo real.

### 7. ✅ **Capturas sobrepostas brigando pela visibilidade**
**Arquivo:** `content.js`

Cliques repetidos empilhavam pedidos; o `finally` de uma devolvia o painel
enquanto a outra ainda fotografava. Agora há uma captura por vez.

### 8. ✅ **`$ is not defined`**
**Arquivo:** `panel.js`

`const $` havia sumido na manutenção, derrubando o painel inteiro.

### 9. ✅ **Origem trocada nos `postMessage`**
**Arquivo:** `panel.js` / `content.js`

Onze chamadas usavam `'*'`. Todas agora vão para a origem correta, com o nonce
autenticando o canal.

### 10. ✅ **Menu de seleção em página rolada**
**Arquivo:** `content.js` (`maybeShowTextMenu`)

Misturava coordenada de viewport (`getBoundingClientRect`) com de documento
(`scrollY`). O menu aparecia deslocado em página longa.

### 11. ✅ **Imagem cross-origin sem explicação**
**Arquivo:** `content.js` (`captureImage`)

Falha de CORS era silenciosa. Agora diz o que houve e o que fazer.

### 12. ✅ **Agente errado ao abrir sessão antiga**
**Arquivo:** `panel.js` (`loadSession`)

O seletor mostrava o agente salvo no config, não o da sessão aberta.

### 13. ✅ **Escrita a cada `pointermove`**
**Arquivo:** `content.js`

Arrastar e redimensionar gravavam no `storage` a cada evento. Agora é
*debounced* com escrita em lote.

### 14. ✅ **Streams SSE concorrentes**
**Arquivo:** `lib/api.js`

Guard explícito para impedir streams órfãos em reconexões.

### 15. ✅ **Clicar num pré-prompt não fazia nada**
**Arquivo:** `content.js` (`mousedown` / `mouseup`)

O menu vive dentro de um shadow DOM, mas os listeners estão no `document`.
Eventos que saem de um shadow root chegam **retargetados** para o host
(`#oc-host`), então `menu.contains(e.target)` era sempre `false`:

1. `mousedown` → `closeMenu()` → o botão sai do DOM
2. `click` nunca chega a disparar
3. o menu fecha e nada acontece

Correção: `dentroDoMenu(e)` usa `e.composedPath()`, que atravessa a sombra.

> Passou despercebido porque os testes conferiam que o menu **aparecia** —
> nenhum deles **clicava** num item. `preprompt-click-test.mjs` cobre isso
> agora.

### 16. ✅ **Pré-prompt de imagem saía sem a imagem**
**Arquivo:** `content.js` (`mimeFromDataUrl`)

A função tinha desaparecido numa edição anterior. `captureImage` estourava
`ReferenceError` em toda imagem inline (data URL), o `.catch` do `runItem`
assumia e mandava o prompt **sozinho** — a pessoa pedia "ler o texto da
imagem" e o modelo recebia só texto, sem arquivo nenhum.

### 17. ✅ **A resposta sumia quando a geração terminava**
**Arquivo:** `panel.js` (`finalizeLive` / `clearLive`)

`finalizeLive()` chamava `clearLive()`, que fazia `app.liveEl?.remove()` — o
balão era **removido do DOM** no instante em que a resposta acabava de chegar.
Por isso o texto só aparecia ao fechar e reabrir o painel (aí o histórico é
relido do servidor).

Agora o balão é *selado*: perde a classe `live` e o cursor, e fica na tela.
`clearLive()` ficou só para a limpeza de verdade (trocar de sessão).

### 18. ✅ **Resposta e pensamento apareciam antes da pergunta**
**Arquivo:** `panel.js` (`send` / `inserirUsuario`)

O `send()` cria o balão do modelo na hora, mas a mensagem do usuário só entra
quando o SSE traz `session.inbox.enqueued` — e esse evento chega depois. O
resultado: balão do modelo, cartões de ferramenta e "pensando…" ficavam acima
da pergunta que os produziu.

Agora `renderUserBubble` usa `inserirUsuario()`, que coloca o balão do usuário
antes do primeiro assistente que vier depois do último usuário já desenhado.
Vale tanto para o balão transmitindo (`.live`) quanto para um já selado.

### 19. ✅ **Arraste do painel multiplicava o movimento**
**Arquivo:** `panel.js`

O cálculo era `geo.x + e.clientX - dragOffX`, usando a posição **corrente** como
âncora. Cada passo somava o deslocamento inteiro de novo: 15 px de cursor
viravam 15, 45, 90, 150, 225, 315… (medido). O segundo arraste andava 688 px
em vez de 160.

Agora a âncora é a posição do painel no **início** do gesto.

### 20. ✅ **Arraste congelava ao passar sobre o iframe**
**Arquivo:** `panel.js` / `content.js`

O painel é uma extension page — outra origem. Quando o cursor entrava nela, os
`pointermove` deixavam de chegar na página, e o `setPointerCapture` **não**
atravessa essa fronteira. Como o painel trava no limite da tela mas o cursor
segue, o arraste morria exatamente na borda (medido: 0 px de deslocamento).

Duas correções:

- O arraste passou a acontecer inteiro no content script, numa **faixa de
  arraste** desenhada no shadow DOM do pai — nada de postMessage por
  movimento, e o iframe sai da conta.
- Um **véu** cobre a viewport durante o gesto, para o cursor nunca alcançar o
  iframe.

### 21. ✅ **Redimensionar nunca respondia**
**Arquivo:** `content.js` (`.oc-grip`)

O canto ficava em `right:0; bottom:0` — exatamente na curva do
`border-radius: 12px` do painel, que recorta a área de clique. O evento ia
para o painel, não para o grip. Confirmado por `composedPath()`:
`["oc-panel is-open", …]`.

Agora o grip é **irmão** do painel (fora do raio) e declara
`pointer-events: auto` — o `#oc-host` é `pointer-events: none`, e sem isso o
grip herdava `none` e não recebia nada.

### 22. ✅ **Painel sem espaço para se mover**
**Arquivo:** `content.js` (`tamanhoInicial`)

O tamanho fixo de 480×720 numa janela de 805px de altura deixava 69px de
folga vertical: qualquer arraste batia no clamp de imediato. O tamanho inicial
agora segue a janela, deixando 120px de margem.

### 23. ✅ **Modo do agente e modelo escolhido não eram salvos**
**Arquivo:** `panel.js` (`loadSession`), `panel.js`/`options.js` (`DEFAULTS`)

Três defeitos em cadeia, reportados pelo usuário:

- **`loadSession` sobrescrevia a escolha do usuário.** Ele gravava
  `app.cfg.agent` com o modo da sessão aberta. Como `connect()` carrega uma
  sessão ao abrir, o modo voltava para o da sessão a cada troca — a escolha
  parecia não ser salva. Agora o modo da sessão fica em `app.sessionAgent`
  (só exibição) e `cfg.agent` continua sendo o padrão do usuário.
- **O rótulo do modelo mostrava `[object Object]`.** `loadConfig` jogava o
  objeto `app.cfg.model` direto em `textContent`, e o navegador convertia para
  `"[object Object]"`. Agora usa `app.cfg.modelLabel`.
- **O listener de storage não reconfigurava a pasta.** Só host/porta/senha
  disparavam `api.configure()`. Trocar o diretório nas opções não tinha efeito
  no painel já aberto — ele seguia conversando na pasta antiga.

### 24. ✅ **Primeira mensagem falhava sempre (HTTP 500 / timeout)**
**Arquivo:** `lib/api.js` (`prompt`, `request`), `DEFAULTS`

- O servidor devolve **500 na primeira chamada de uma sessão nova** (cold
  start: plugins/modelo ainda carregando). Medido: 19s e 500 na primeira,
  26ms nas seguintes. Foi adicionado reenvio único nesse caso.
- O timeout do prompt era 30s. Um modelo lento estourava o prazo do cliente e
  a pessoa via `signal is aborted without reason` — erro que não diz nada.
  Agora são 120s e o aborto é traduzido para "tempo esgotado em Ns".
- Os `DEFAULTS` apontavam `kilo4/stepfun/step-5-preview-free`, que passou a
  devolver 500 (cota estourada). Trocado para `kilo3/step-5-preview-free`,
  medido em 1s.

---

## Features Implementadas (✅)

| Feature | Como usar |
|---|---|
| **Busca na conversa** | `Ctrl+F` — filtra e destaca sem tirar o foco |
| **Exportar conversa** | `Ctrl+E` — Markdown, JSON ou HTML com modelo/agente/data |
| **Copiar bloco de código** | botão no cabeçalho de cada bloco com idioma |
| **Navegação por teclado** | `j`/`k` entre mensagens, `c` copia código em foco |

---

## Backlog (não implementado)

### Otimizações

| Item | Esforço | Impacto |
|---|---|---|
| SSE único compartilhado entre abas (Shared Worker) | Alto | Médio |
| Batch de deltas no streaming (hoje re-renderiza o markdown inteiro) | Médio | Alto |
| Virtualizar a lista de sessões | Médio | Baixo |
| WebP/AVIF quando o modelo suportar | Baixo | Baixo |
| Injetar o roteador só quando o prompt pedir skill | Médio | Médio |
| Retry com backoff para 5xx nos outros endpoints | Médio | Baixo |

### Features (gap vs CLI)

| Item | Esforço | Impacto |
|---|---|---|
| **Permission prompts nativos** (hoje é toast "vá ao terminal") | Alto | Alto |
| **Explorer de arquivos** / tree do workspace | Alto | Alto |
| **Visualização de subagentes** em árvore | Médio | Médio |
| **Branch/fork de sessão** a partir de um turno | Alto | Alto |
| **Trocar modelo no meio da sessão** | Baixo | Alto |
| **Painel de custo** por sessão/modelo | Médio | Médio |
| **Gerenciar skills** (ver, habilitar, adicionar) | Médio | Médio |
| **Múltiplos projetos** (hoje um `directory` só) | Médio | Médio |
| **Entrada por voz** (Web Speech API) | Médio | Baixo |
| **Compartilhar sessão** por link | Alto | Baixo |
| **Tema claro** / alto contraste | Baixo | Baixo |

### Arquitetura

| Item | Esforço | Impacto |
|---|---|---|
| Migração para TypeScript | Alto | Médio (longo prazo) |
| Bundler (Vite/esbuild) | Alto | Médio |
| Error boundary + recuperação de crash no painel | Médio | Alto |
| Logging estruturado | Baixo | Médio |
| CSP mais restritiva + Trusted Types | Médio | Médio |

---

## Bugs rejeitados na análise (mantidos como estão)

Nem tudo que a análise inicial imaginou era defeito. Estes foram
verificados contra o servidor real e **não** precisaram de correção:

- **`options.js` não recarrega modelos ao mudar a pasta** — `carregarModelos()`
  já lê o valor direto do input, não do storage. Comportamento correto.
- **Blockquote não renderizado** — o `renderMarkdown` está correto (há teste
  unitário). O teste de integração é que pegava uma sessão que talvez não
  tivesse blockquote, e exigia mesmo assim.
- **Prompt retorna vazio no `e2e-test`** — o modelo estava sem cota naquele
  momento. Nada a ver com a extensão.

---

## Como validar

Toda correção acima tem cobertura. Detalhes em `README.md`, seção **Testes**.

```
markdown-test               32/32   unitário do parser
skills-inject-test          14/14   unitário da injeção do roteador
preprompt-click-test        16/16   CLICAR num pré-prompt (texto e imagem)
config-persistence-test      9/9    agente e modelo sobrevivem a troca de sessão
streaming-test              17/17   texto ao vivo, ordem dos balões, resposta persiste
drag-test                   15/15   arraste 1:1, limites da tela, redimensionar, botão
browser-test                20/20   content script, menus, canal com o painel
model-default-test          14/14   modelo padrão
capture-test                10/10   "ver tela" sem o painel na foto
vision-cascade-test          8/8    imagem -> visão -> texto
options-model-test          19/19   dois modelos + effort
new-features-test           18/18   arraste, captura, injeção oculta
markdown-view-test          15/15   render de conversa real
```

> **Sobre o 500 do cold start:** o servidor do OpenCode devolve 500 na
> primeira chamada de cada sessão nova enquanto carrega plugins/modelo.
> `api.prompt()` reenvia uma vez nesse caso. Se a primeira mensagem ainda
> falhar, o servidor pode precisar de mais tempo — veja o log em
> `%TEMP%\opencode-browser-chat-4177.log`.