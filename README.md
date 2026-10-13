# OpenCode Chat Flutuante

Extensão para o Brave (e qualquer Chromium) que abre uma janela de chat flutuante
com **seus** modelos do OpenCode, disparada direto da seleção de texto ou imagem
da página. As respostas usam a biblioteca **minhas-skills-unificadas** como base.

---

## Como funciona

```
página  →  content script (shadow DOM)
            ├─ botão flutuante arrastável
            ├─ menu de pre-prompts ao selecionar texto
            └─ menu de pre-prompts ao clicar direito numa imagem
                        │
                        ▼
          <iframe> panel.html  →  API v2 do OpenCode (127.0.0.1:4177)
                                 └─ SSE /api/event para streaming
```

O painel é uma *extension page* dentro de um `<iframe>`: tem acesso a
`chrome.storage` e não é afetado pelo CSS do site. Todo o CSS do painel é
isolado; a UI na página vive num shadow DOM.

---

## Instalação

### 1. Subir o servidor do OpenCode

```powershell
powershell -ExecutionPolicy Bypass -File server\start.ps1
```

Sobe `opencode serve` em `127.0.0.1:4177` com a senha `testefixo123`.
Para parar: `server\stop.ps1`.

Para subir sozinho a cada login:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
```

Cria o atalho `OpenCode Chat - servidor.lnk` na pasta de Inicialização do
Windows. É idempotente: rodar duas vezes não abre dois servidores. Para
remover: `scripts\install-startup.ps1 -Remove`.

> A senha precisa bater com a da extensão. Se mudar, ajuste em
> `server\start.ps1 -Password ...` **e** na página de opções.

### 2. Carregar a extensão no Brave

1. Abra `brave://extensions`
2. Ligue **Modo de desenvolvedor**
3. **Carregar sem compactação** e escolha **esta pasta exata**:

```
C:\Users\Kelvin\Desktop\opencode-browser-chat\extension
```

> A pasta `opencode-browser-chat` (a do projeto) **não** tem `manifest.json`.
> Se você selecionar ela, o Brave responde "arquivo de manifesto não existe ou
> não pode ser lido". Só a subpasta `extension` tem o manifesto na raiz.
>
> Atalho: `scripts\abrir-pasta.ps1` abre a pasta certa já selecionada.

### 3. Abrir o chat

Clique no botão flutuante ( canto direito ). Arraste para mover, duplo clique
devolve ao canto. `Alt+Shift+O` abre e fecha.

---

## Menu de seleção

Selecione um texto e o menu aparece com 10 ações:

| Ação | O que faz | Skill |
|---|---|---|
| Explicar | do zero, com analogia | — |
| Aprofundar | implícito, histórico, contraexemplos | — |
| Resumir | 3–5 frases | — |
| Simplificar | linguagem direta | — |
| Responder a isto | abre o chat pronto pra pergunta | — |
| Como melhorar isto | sugestões com trecho a trocar | `antislop-copywriting` |
| Criticar | erros e lógica frágil | — |
| Verificar fatos | o que checar na web | `grounded-citations` |
| Traduzir | PT-BR natural | — |
| Argumentos | a favor e contra | — |

Clicar em qualquer uma **abre o painel já com o prompt enviado**.

**Botão direito numa imagem** abre 6 ações de visão: Descrever, Ler texto
(OCR), Avaliar UI, Diagramar, Gerar prompt, Extrair dados.

---

## Skills

> **A parte das skills fica oculta.** Antes da primeira mensagem de cada
> sessão o painel manda uma instrução interna pedindo que o modelo leia o
> roteador de `minhas-skills-unificadas`. Ela viaja marcada com
> `[CONFIG_OC]…[/CONFIG_OC]`, o painel tira esse bloco antes de desenhar, e
> você vê só a sua mensagem.

Nao ha parte de skills na interface - voce nao escolhe nada.

Antes da **primeira** mensagem de cada sessao, o painel injeta uma instrucao
pedindo que o modelo leia o roteador em
`C:\Users\Kelvin\Desktop\minhas-skills-unificadas\SKILL.md`, decida o produto
final e abra a skill correspondente. O roteador tambem vai anexado como skill,
entao a tabela de roteamento ja esta no contexto.

A instrucao e marcada com `[CONFIG_OC]...[/CONFIG_OC]` e **nao aparece na
conversa**: o painel reconhece o marcador e desenha so a sua mensagem.

---

## Modelos

Em **Configurações** você escolhe **dois** modelos, com *effort* cada:
o de **texto** e o de **visão**. Os dois são independentes.

> `effort` é o nível de raciocínio (`low` / `medium` / `high`). Quanto mais
> alto, melhor a resposta e mais lenta a geração.

### Um modelo só

Com *"Usar o mesmo modelo de texto"* marcado, a imagem anexada vai direto para
o modelo de texto — que precisa enxergar imagem. É o comportamento antigo.

### Dois modelos

Desmarcando, entra em cena um segundo modelo **só para a visão**. Aí o fluxo
muda:

1. a imagem vai para o modelo de visão, que devolve uma **descrição** do que vê;
2. essa descrição entra como contexto no prompt do modelo de texto;
3. o modelo de texto responde **sem nunca ver a imagem**.

A sessão do modelo de visão é criada e descartada na hora, então o histórico da
sua conversa fica limpo, sem um par de turnos de "descreva isto" no meio.

Serve para dois casos: quando o modelo que você prefere para conversar **não
tem visão**, e quando o de visão é melhor descrevendo do que raciocinando. No
effort do de visão, `low` costuma bastar — a tarefa é descrever, não pensar.

### Primeira vez

Sem nenhum escolhido, abrir o painel pergunta o modelo. A escolha fica guardada
e vale para toda conversa nova; as sessões já existentes mantêm o modelo que
nasceram com.

---

O botão **modelo** lista os modelos que a sua conta tem, com filtro de busca
e seletor de variante (`low`/`high`/`xhigh`/...).

A escolha vira o **padrão**: fica guardada e é usada em toda sessão nova, sem
perguntar de novo. A guarda é só da extensão — o que você escolhe no CLI não
mexe aqui.

Na **primeira vez**, abrir o painel abre o seletor sozinho: não há modelo
escolhido, então o servidor responderia pelo default dele e você nem saberia
qual foi. Escolhido um, a conversa começa com ele. Fechar o seletor sem
escolher não trava nada: a próxima vez que você abrir o painel ele volta, e o
envio avisa que falta escolher.

Na pergunta automática a variante vai na `default`, sem um segundo modal — você
foi pedido para escolher o *modelo*, não o nível de raciocínio. Abrindo o
botão na mão, a variante continua sendo perguntada.

---

## Enquanto o modelo trabalha

Três pontinhos pulando dizem **o que** ele está fazendo: pensando, lendo o
arquivo, codando, pesquisando na web, rodando o comando, delegando a um
subagente. O rótulo vem do nome da ferramenta que entrou no stream, então
acompanha o trabalho de verdade — não é um "carregando" genérico.

Os cartões de cada ferramenta (`read`, `edit`, `shell`, `webfetch`) vêm
**recolhidos**: uma conversa longa emenda vários em sequência e o conteúdo de
cada um empurraria a resposta do modelo para fora da tela. Um clique abre e
mostra o diff, a saída ou o preview; outro fecha. O estado também está no
`aria-expanded` do cabeçalho.

---

## Ver a tela

O botão **ver tela** na barra anexa a aba visível atual à próxima mensagem.

O botão **ver tela** na barra anexa a aba visível atual à próxima mensagem,
para o modelo olhar a página como você vê. Só fica habilitado com um modelo
que tem visão — a checagem usa o capability `image` do catálogo real de
`/api/model`.

A captura vem do `chrome.tabs.captureVisibleTab` (só o service worker tem
acesso), é reduzida para 1568px e anexada como JPEG.

> O próprio painel **não aparece** no print: ele é escondido antes da captura e
> devolvido depois. O modelo vê a página, não a janela de chat.

---

## Sessões

O seletor mostra as mesmas sessões do `opencode session list` do CLI.

A API devolve também os **subagentes** (as sessões filhas que o `task` cria):
no projeto do Desktop, das 200 linhas que o servidor mandava, só 33 eram
conversas de verdade e 167 eram filhos de subagente. Aqui as linhas com
`parentID` são descartadas e a paginação continua até encher a lista — filtrar
só a primeira página de 200 deixaria a lista quase vazia de conversas reais.

Clique no botão flutuante sempre começa uma sessão nova. Só continua uma
antiga se você escolher no seletor.

---

## O que aparece no painel

| Bloco | Como aparece |
|---|---|
| **raciocínio** | `<details>` recolhido, com a duração quando a API manda |
| **texto** | markdown: código, tabelas, listas, blockquote |
| **edit / write** | card com **diff colorido** — `+` verde, `−` vermelho, cabeçalho `@@` e contador `+n −n` |
| **bash / shell** | comando resumido + saída |
| **read** | caminho + preview do arquivo |
| **grep / glob** | padrão buscado + resultados |
| **websearch / webfetch** | consulta ou URL + retorno |
| **todowrite** | checklist com ☑ feito / ◐ em andamento / ☐ pendente e prioridade |
| **skill** | qual skill foi carregada |
| **question** | pergunta e a resposta dada |
| **erro** | card vermelho com a mensagem do provedor |
| **retry** | linha de tentativa com o motivo |

Cada card de ferramenta é uma linha resumida (`✓ editar  …\projeto\src\app.tsx`)
que expande no clique. Durante a geração, os cards aparecem em tempo real:
o input da ferramenta é transmitindo caractere a caractere
(`session.tool.input.ended`) e o resultado entra quando chega.

**Diff:** a API só manda `metadata.diff` quando o arquivo está sob snapshot
do OpenCode — na prática, dentro de um repositório git. Fora disso o painel
reconstrói o diff a partir de `oldString`/`newString` (edit) ou `content`
(write), então você sempre vê o que mudou.

---

## Atalhos

| Atalho | Ação |
|---|---|
| `Alt+Shift+O` | abre/fecha o painel |
| `Ctrl+N` (no painel) | sessão nova |
| `Enter` | envia |
| `Shift+Enter` | nova linha |
| `Esc` | fecha o modal / interrompe a geração |
| botão direito na imagem | menu de visão |
| arrastar o botão | move; duplo clique reseta |

Também dá para colar imagem (Ctrl+V) e arrastar arquivo de imagem para dentro
do painel.

---

## Opções

`brave://extensions` → **Opções** na extensão, ou pelo ícone na barra.

- endereço, porta e senha do servidor
- pasta de trabalho (define onde as sessões são gravadas)
- ligar/desligar botão flutuante, menu de texto, menu de imagem
- se o menu de imagem substitui o menu nativo do navegador

---

## Testes

```powershell
# contrato da API contra o servidor real
node scripts\e2e-test.mjs

# extensão carregada no Brave, via CDP
node scripts\browser-test.mjs extension

# render das partes (cria sessão real, força write+edit+bash, confere o DOM)
node scripts\parts-render-test.mjs extension shots

# envio real pelo caminho da extensão: botão -> sessão -> prompt -> resposta
node scripts\send-repro.mjs extension shots

# print da tela sem o painel + sessão nova ao clicar no botão
node scripts\capture-test.mjs extension shots

# modelo padrão: 1ª vez pergunta, depois lembra
node scripts\model-default-test.mjs extension

# só carregar a extensão e ver se o content script entra
node scripts\load-check.mjs extension

# screenshots do painel
node scripts\shot-panel.mjs extension shots
```

---

## Arquivos

```
extension/
  manifest.json
  content.js          botão flutuante + menus (shadow DOM)
  content.css
  panel.html/css/js   janela de chat
  options.html/js     configurações
  background.js       service worker (bridge de imagem, menu de contexto)
  lib/prompts.js      os 16 pre-prompts + mapa de skills
  lib/api.js          cliente da API v2 do OpenCode
  icons/
server/
  start.ps1  stop.ps1
scripts/
  e2e-test.mjs  browser-test.mjs  shot-panel.mjs  make-icons.mjs
```

---

## Notas

- **Autenticação**: HTTP Basic, usuário fixo `opencode`, senha do
  `OPENCODE_SERVER_PASSWORD`. Guardada só no `chrome.storage.local` deste
  navegador.
- **Anexos**: a API só aceita `data:` URL. Imagens remotas são baixadas e
  redimensionadas (max 1568px, JPEG 85%) pelo content script ou, se o CORS
  bloquear, pelo service worker.
- **Sessões**: cada menu de pre-prompt abre uma sessão nova por padrão
  (configurável). O histórico fica na pasta de trabalho escolhida.
- O SSE fica na página do painel, não no service worker — worker do MV3 é
  descarregado pelo Chrome e derrubaria o stream.