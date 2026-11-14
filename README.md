# opencode-browser-chat

[English](README.en.md) · **Português (Brasil)**

Extensão de navegador (Manifest V3) que coloca um chat do OpenCode dentro de qualquer aba, com menu de pré-prompts ao selecionar texto ou imagem, anexo de captura de tela e as skills do usuário como base de contexto.

## O que é

Uma extensão Chromium (Brave ou Chrome) que conversa com o servidor local do OpenCode. O chat vive num painel flutuante sobre a página, e o mesmo painel serve para perguntas livres, para transformar texto selecionado em prompt e para enviar imagem (arquivo, colagem ou captura da aba visível) ao modelo.

O projeto não sobe nenhum servidor próprio: quem atende as requisições é o `opencode serve` local, na porta 4177. A extensão é cliente HTTP e consumidora do stream SSE desse servidor.

## Status

Funciona ponta a ponta em ambiente de desenvolvimento, com o servidor OpenCode no `127.0.0.1:4177`. O manifesto declara versão 1.0.0 e `minimum_chrome_version` 116 (`extension/manifest.json`).

Não há pipeline de CI, arquivo de licença no repositório, empacotamento em loja, nem `package.json`: as dependências são zero e cada script é executado manualmente com Node.

## Funcionalidades

Bolha flutuante arrastável, com posição salva em `chrome.storage.local`; duplo clique devolve ao canto (`extension/content.js`).

Painel em iframe com arraste feito dentro do próprio iframe, redimensionamento pela alça no canto e persistência do retângulo (`extension/content.js`, `extension/panel.js`).

Menu de pré-prompts ao selecionar texto, com dez entradas: explicar, aprofundar, resumir, simplificar, responder a isto, como melhorar isto, criticar, verificar fatos, traduzir e argumentos (`extension/lib/prompts.js`).

Menu de contexto em imagem, com seis entradas: descrever, ler texto, avaliar UI, diagramar, gerar prompt e extrair dados (`extension/lib/prompts.js`).

Anexos por arraste (até quatro imagens), colagem da área de transferência e captura da aba visível via `chrome.tabs.captureVisibleTab` (`extension/panel.js`, `extension/background.js`).

Cascata de visão: quando o modelo de texto não enxerga imagem, um segundo modelo descreve a imagem numa sessão separada e a descrição entra como contexto no prompt (`extension/panel.js`).

Streaming ao vivo por SSE: deltas de texto, raciocínio, ferramentas abertas, atividade em três pontinhos, contagem de tokens e botão para interromper (`extension/panel.js`).

Cards de ferramenta recolhíveis, com diff real quando a API manda `metadata.diff` e diff reconstruído quando não manda (`extension/panel.js`).

Markdown próprio no render das mensagens, com blocos de código, tabelas, listas, citação, régua e links (`extension/panel.js`).

Sessões: listar, criar, abrir, fixar no seletor e apagar. A lista ignora sessões de subagente (`extension/lib/api.js`).

Escolha de modelo e de variante (effort) pelo painel, com persistência em `cfg` e aplicação na sessão corrente (`extension/panel.js`).

Tela de opções separada, para host, porta, senha, diretório, modelo de texto, modelo de visão e comportamento (`extension/options.js`).

Roteador de skills injetado como texto na primeira mensagem de cada sessão, marcado com `[CONFIG_OC]` e removido da interface (`extension/lib/skills-inject.js`).

Atalho `Alt+Shift+O`, item de menu de contexto e clique no ícone abrem ou fecham o painel (`extension/manifest.json`, `extension/background.js`).

## Arquitetura

São três camadas, sem build e sem framework.

O content script (`extension/content.js`) roda em todas as páginas, monta tudo dentro de um shadow DOM e cria três coisas: a bolha, o iframe do painel e o menu de pré-prompts. Ele não conhece o OpenCode e não fala HTTP.

O painel (`extension/panel.html`, `extension/panel.js`) é uma extension page carregada no iframe. É ele que mantém a conexão SSE, o histórico da conversa e o estado do streaming.

O service worker (`extension/background.js`) não guarda conexão com o OpenCode. Ele serve de ponte para o que só o worker pode fazer: baixar imagem remota, capturar a aba visível, montar menus de contexto, responder ao atalho e ao clique no ícone.

A comunicação entre content script e painel é por `postMessage`, com mensagens `oc:ready`, `oc:ask`, `oc:fresh`, `oc:toggle`, `oc:geometry`, `oc:dragStart`, `oc:dragMove`, `oc:dragEnd`, `oc:capture`, `oc:captured` e `oc:toast`.

Dentro do painel, três módulos:

`extension/lib/api.js` é o cliente da API v2 do OpenCode, com autenticação Basic (usuário fixo `opencode`), timeouts por requisição e o stream SSE de `/api/event`.

`extension/lib/prompts.js` é script clássico, não módulo, porque content script de MV3 não suporta `import`. Publica `globalThis.OC_PROMPTS`, e é carregado tanto pelo content script quanto pelo painel e pela tela de opções.

`extension/lib/skills-inject.js` monta a instrução do roteador, detecta o marcador e devolve o texto limpo para a interface.

## Stack

Navegador: Manifest V3, service worker, `chrome.storage.local`, `chrome.contextMenus`, `chrome.commands`, `chrome.tabs.captureVisibleTab`.

Linguagem: HTML, CSS e JavaScript sem transpilação. Módulos ES no painel, script clássico no content script.

Servidor: OpenCode CLI (`opencode serve`), porta 4177, autenticação Basic.

Infraestrutura de apoio: scripts PowerShell para subir e parar o servidor, criar o atalho de inicialização e abrir a pasta da extensão; scripts Node (`.mjs`) para testes e diagnóstico.

## Estrutura do repositório

```text
opencode-browser-chat/
  extension/
    manifest.json
    background.js
    content.js
    content.css
    panel.html
    panel.js
    panel.css
    options.html
    options.js
    lib/
      api.js
      prompts.js
      skills-inject.js
    icons/
      icon16.png  icon32.png  icon48.png  icon128.png
  server/
    start.ps1
    stop.ps1
  scripts/
    browser-test.mjs
    capture-test.mjs
    e2e-test.mjs
    load-check.mjs
    make-icons.mjs
    model-default-test.mjs
    new-features-test.mjs
    options-model-test.mjs
    parts-render-test.mjs
    send-repro.mjs
    shot-panel.mjs
    skills-inject-test.mjs
    toolcard-test.mjs
    ui-test.mjs
    vision-cascade-test.mjs
    visual-test.mjs
    abrir-pasta.ps1
    install-startup.ps1
  README.md
  README.en.md
  .gitignore
```

## Pré-requisitos e instalação

Windows com PowerShell 5.1 ou 7, Node 22 ou mais novo (os scripts usam o `WebSocket` global do Node, sem import) e Brave ou Chrome na versão 116 ou mais nova.

O binário do OpenCode precisa estar acessível. O `server\start.ps1` procura nesta ordem: `%APPDATA%\npm\node_modules\@opencode\cli\bin\opencode.exe`, `%LOCALAPPDATA%\opencode\bin\opencode.exe` e o comando `opencode` no PATH, desde que aponte para um `.exe` (`server/start.ps1`).

Não há `npm install` a fazer: o repositório não tem `package.json` nem dependências.

```bash
git clone https://github.com/KelvinOliveiraCode/opencode-browser-chat.git
cd opencode-browser-chat
```

## Como executar

Suba o servidor local. Ele é idempotente: se a porta já estiver ocupada, sai sem fazer nada.

```powershell
powershell -ExecutionPolicy Bypass -File server\start.ps1
powershell -ExecutionPolicy Bypass -File server\start.ps1 -Port 4177 -Password minhaSenha
```

Parar o servidor:

```powershell
powershell -ExecutionPolicy Bypass -File server\stop.ps1
```

Criar o atalho de inicialização do Windows (e remover com `-Remove`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
```

Carregue a extensão em `brave://extensions`, com o modo de desenvolvedor ligado, em "Carregar sem compactação", apontando para a pasta `extension`. O script `scripts\abrir-pasta.ps1` abre o Explorer já com o `manifest.json` selecionado, para não haver dúvida de qual pasta escolher.

Na primeira instalação, a extensão abre a tela de opções. Confira host, porta, senha e pasta de trabalho e clique em "Testar conexão". A senha precisa ser a mesma usada em `OPENCODE_SERVER_PASSWORD` ao subir o servidor.

## Endpoints (se houver API)

Este repositório não expõe API HTTP. Ele consome a API v2 do servidor OpenCode, com autenticação Basic no formato `opencode:<senha>` (`extension/lib/api.js`).

| Método | Rota | Uso no projeto |
|---|---|---|
| GET | `/api/location` | ping e teste de conexão |
| GET | `/api/model?directory=` | catálogo de modelos, com diretório explícito |
| GET | `/api/agent` | lista de agentes |
| GET | `/api/skill` | lista de skills |
| GET | `/api/session` | lista de sessões de topo, com `directory`, `limit`, `order`, `search` e `cursor` |
| POST | `/api/session` | cria sessão |
| GET | `/api/session/{id}` | lê uma sessão |
| DELETE | `/api/session/{id}` | apaga uma sessão |
| GET | `/api/session/{id}/message` | histórico, com `limit` e `order` |
| POST | `/api/session/{id}/prompt` | envia mensagem, com `text`, `files`, `agents` e `delivery` |
| POST | `/api/session/{id}/interrupt` | interrompe a execução |
| POST | `/api/session/{id}/model` | troca o modelo da sessão |
| POST | `/api/session/{id}/agent` | troca o agente da sessão, implementado e sem uso na interface |
| GET | `/api/event` | stream SSE de eventos da sessão |

Eventos de stream tratados no painel: `session.inbox.enqueued`, `session.text.started`, `session.text.delta`, `session.text.ended`, `session.tool.input.started`, `session.tool.input.ended`, `session.tool.called`, `session.tool.success`, `session.tool.failed`, `session.reasoning.started`, `session.step.started`, `session.execution.started`, `session.execution.succeeded`, `session.step.failed`, `session.retry.scheduled`, `session.renamed`, `session.usage.updated`, `session.permission.asked` e `question.asked`.

## Testes e qualidade

Não há linter, formatador, `package.json` ou CI. A verificação é feita por scripts Node executados manualmente.

Dezesseis arquivos `.mjs` vivem em `scripts/`. Doze usam o helper `add(nome, condição, extra)` e o `e2e-test.mjs` usa `check(nome, condição, extra)`; juntos são 157 chamadas `add()` e 22 `check()`, com ramos alternativos que reduzem o número executado por rodada.

| Script | O que verifica |
|---|---|
| `scripts/e2e-test.mjs` | 22 checagens contra o servidor real: auth, catálogo, sessão, SSE, turno com imagem, skills e histórico |
| `scripts/browser-test.mjs` | carrega a extensão no Brave via CDP e confere bolha, menu, painel, status e lista de sessões |
| `scripts/capture-test.mjs` | a captura da aba não inclui o painel; o botão cria sessão nova e o seletor mantém a sessão |
| `scripts/model-default-test.mjs` | o modelo é perguntado na primeira abertura e reaproveitado depois |
| `scripts/new-features-test.mjs` | arraste não gruda no mouse, botão "ver tela" e injeção do roteador fora da conversa |
| `scripts/options-model-test.mjs` | a tela de opções lista modelos, deixa escolher, mexer no effort e salvar |
| `scripts/parts-render-test.mjs` | render de `write`, `edit` e `bash` com dados reais da API |
| `scripts/send-repro.mjs` | envio pelo caminho real da extensão, lendo o que aparece na tela |
| `scripts/skills-inject-test.mjs` | `isInternal`, `stripInternal` e `withInstruction` |
| `scripts/toolcard-test.mjs` | cards começam recolhidos e abrem no clique |
| `scripts/ui-test.mjs` | injeção não aparece na conversa, cards de ferramenta e pontinhos de atividade |
| `scripts/vision-cascade-test.mjs` | a imagem passa pelo modelo de visão e a descrição chega ao modelo de texto |
| `scripts/visual-test.mjs` | fluxo visual completo, com screenshots do menu e do painel |
| `scripts/load-check.mjs` | diagnóstico: carrega no Brave e reporta manifesto aceito e erros de JavaScript |
| `scripts/shot-panel.mjs` | screenshot do painel aberto como aba |
| `scripts/make-icons.mjs` | gera os PNGs de ícone, sem dependências |

O único script que roda sem servidor e sem navegador é o `scripts/skills-inject-test.mjs`:

```bash
node scripts/skills-inject-test.mjs
```

Os demais precisam do servidor no ar e do Brave no caminho fixo `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe` (`scripts/browser-test.mjs`).

```bash
node scripts/e2e-test.mjs
node scripts/browser-test.mjs
node scripts/ui-test.mjs
```

## Decisões técnicas e trade-offs

O painel é uma extension page dentro de iframe, não DOM injetado. Ganha isolamento de CSS e acesso a `chrome.storage`; paga com a ponte `postMessage` para arraste, geometria e captura (`extension/content.js`).

O SSE é mantido pelo painel, não pelo service worker. O worker é descarregado pelo navegador, e a extensão perderia o stream no meio da conversa (`extension/background.js`).

A lista de sessões filtra `parentID` no laço de requisições, antes de cortar em `limit`. Filtrar só no cliente devolveria uma janela cheia de sessões de subagente e nenhuma conversa aberta pela pessoa (`extension/lib/api.js`).

O diretório vai explícito em `/api/model`. Sem ele, o servidor tenta resolver a location padrão e responde 503 (`extension/lib/api.js`).

A autenticação é Basic com usuário fixo `opencode`. É o contrato do servidor, não uma escolha de design da extensão (`extension/lib/api.js`).

A skill não é escolhida na interface. A primeira mensagem de cada sessão recebe a instrução do roteador como texto, marcada entre `[CONFIG_OC]` e `[/CONFIG_OC]`, e o painel esconde o bloco (`extension/lib/skills-inject.js`).

O nome da ferramenta vem de `session.tool.input.started`, porque `session.tool.called` não traz nome. Os dois eventos são casados pelo `id` (`extension/panel.js`).

A cascata de visão roda numa sessão temporária, que é apagada no fim. Se a descrição viesse na sessão da pessoa, o histórico ficaria com um par de turnos de "descreva isto" no meio da conversa (`extension/panel.js`).

O markdown é escrito à mão, em vez de biblioteca externa. Mantém a extensão sem dependências, e o custo é cobertura parcial: listas aninhadas, alinhamento de tabela e blocos aninhados não são tratados (`extension/panel.js`).

## Limitações conhecidas

O ambiente de referência é Windows. Os scripts de servidor são PowerShell e o caminho do Brave está fixo em `scripts/browser-test.mjs` e nos outros testes de navegador.

Os padrões vêm do autor: diretório `C:\Users\Kelvin\Desktop` e senha `testefixo123` (`extension/panel.js`, `extension/options.js`, `server/start.ps1`). O roteador de skills aponta para `C:\Users\Kelvin\Desktop\minhas-skills-unificadas\SKILL.md` (`extension/lib/skills-inject.js`), caminho que precisa existir na máquina.

Servidor remoto não é suportado. A própria tela de opções diz para não usar host remoto (`extension/options.html`), e o manifesto pede `http://127.0.0.1/*` e `http://localhost/*`.

O manifesto pede `<all_urls>` em `host_permissions` e `scripting`, e o content script roda em todas as páginas.

A captura da aba exige janela focada. Sem foco, `captureVisibleTab` não rejeita, e o código usa um prazo de 10 segundos para destravar o botão (`extension/content.js`).

A cascata de visão espera por polling no histórico, com até 60 tentativas de 2,5 segundos, e falha se o modelo de visão não responder nesse intervalo (`extension/panel.js`).

Imagem é reduzida para no máximo 1568 pixels na maior aresta antes de ir ao modelo. GIF e SVG passam sem redimensionar (`extension/background.js`).

A seleção de texto enviada ao modelo é cortada em 6000 caracteres (`extension/content.js`).

O stream SSE é único e global. Eventos de outra sessão são ignorados pela checagem de `sessionID` (`extension/panel.js`).

Não existe arquivo de licença no repositório, apesar de o projeto ser declarado MIT.

## Licença e autor

MIT. Copyright (c) 2026 Kelvin Rebelo de Oliveira. Autor: [Kelvin Oliveira](https://github.com/KelvinOliveiraCode)