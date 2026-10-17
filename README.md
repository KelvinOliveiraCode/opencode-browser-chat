# OpenCode Chat Flutuante

![JavaScript](https://img.shields.io/badge/language-JavaScript-F7DF1E?logo=javascript)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4)

Extensao para navegadores Chromium (Brave, Chrome, Edge) que coloca um chat com os modelos locais do OpenCode numa janela flutuante sobre qualquer pagina. Acionada por selecao de texto, clique direito em imagem ou pelo atalho Alt+Shift+O.

## Problema / Por que existe

O OpenCode roda no terminal e nao tem interface propria no navegador. Quem esta lendo uma pagina e quer explicar, resumir ou alterar um trecho precisa copiar, mudar de janela e colar no terminal, o que interrompe o fluxo. Esta extensao leva o chat com os modelos do OpenCode para dentro da pagina que esta aberta.

## O que faz

- Botao flutuante arrastavel que abre uma janela de chat; duplo clique devolve o botao ao canto, e Alt+Shift+O abre e fecha o painel.
- Menu ao selecionar texto com dez acoes: Explicar, Aprofundar, Resumir, Simplificar, Responder a isto, Como melhorar isto, Criticar, Verificar fatos, Traduzir e Argumentos. Clicar numa acao abre o painel com o prompt ja enviado.
- Clique direito numa imagem com seis acoes de visao: Descrever, Ler texto, Avaliar UI, Diagramar, Gerar prompt e Extrair dados.
- Dois modelos independentes, texto e visao. Quando a imagem deve ser vista primeiro, ela vai para o modelo de visao, que devolve uma descricao usada como contexto pelo modelo de texto; o modelo de texto nunca ve a imagem.
- Botao ver tela que captura a pagina visível (reduzida a 1568 pixels, JPEG) e a anexa à próxima mensagem. O painel e escondido durante a captura, entao o modelo ve a pagina, nao a janela de chat.
- Streaming letra a letra; cartoes de ferramenta (leitura, edicao, shell, busca) vao recolhidos e abrem no clique; raciocínio aparece em bloco colapsavel com duracao quando a API envia.
- Busca na conversa com Ctrl+F, exportacao em Markdown, JSON e HTML com modelo, agente e data, copia de blocos de codigo e navegacao por teclado (j, k, c, Esc).
- Pagina de opcoes para endereço, porta e senha do servidor, pasta de trabalho, agente, modelos e ativacao dos menus.

## Stack

- Manifest V3, service worker em background.js, content script em content.js com shadow DOM, e painel como pagina de extensao (panel.html, panel.js, panel.css) dentro de iframe.
- API v2 do OpenCode local em http://127.0.0.1:4177, autenticacao HTTP Basic com usuario fixo opencode; streaming por SSE em /api/event.
- JavaScript puro, sem build e sem dependencias externas; modulos ES nativos do navegador.
- lib/api.js: cliente da API v2 (sessoes, prompts, interrupcao, SSE). lib/prompts.js: pre-prompts do menu e mapa de skills. lib/markdown.js: render de markdown. lib/skills-inject.js: injecao da biblioteca de skills como instrucao interna.

## Como funciona

```
pagina  ->  content script (shadow DOM)
            ├─ botao flutuante arrastavel
            ├─ menu de pre-prompts na selecao de texto
            └─ menu de pre-prompts ao clicar direito numa imagem
                           |
                           v
      iframe panel.html (pagina de extensao)  ->  API v2 do OpenCode (127.0.0.1:4177)
                                                 via SSE /api/event
```

O content script roda no contexto da pagina, entao o painel vive num iframe de outra origem para ter acesso ao chrome.storage e nao sofrer com o CSS do site. A ponte entre eles usa um nonce por carregamento (?oc= na URL do iframe), porque a origem que o painel enxerga e a do site, nao a da extensao.

O SSE fica na pagina do painel: o service worker do Manifest V3 e descarregado pelo Chrome e derrubaria o fluxo de eventos ao vivo.

A captura de tela (ver tela) so e possivel no service worker, que tem chrome.tabs.captureVisibleTab. O painel pede a captura por postMessage, o worker fotografa a aba ativa, reduz para 1568 pixels e devolve como data URL.

Antes da primeira mensagem de cada sessao, o painel envia uma instrucao interna marcada com [CONFIG_OC]...[/CONFIG_OC] pedindo que o modelo leia o roteador de habilidades em C:\Users\Kelvin\Desktop\minhas-skills-unificadas\SKILL.md. O bloco e removido antes de desenhar; o usuario so ve a propria mensagem.

## Como rodar

Pre-requisito: ter o OpenCode CLI instalado.

1. Suba o servidor local:

powershell -ExecutionPolicy Bypass -File server\start.ps1

O servidor sobe em http://127.0.0.1:4177 com a senha testefixo123. Para parar: server\stop.ps1.

2. Carregue a extensao no navegador:

- Abra brave://extensions (ou chrome://extensions).
- Ative o Modo de desenvolvedor.
- Clique em Carregar sem compactacao e selecione exatamente a pasta extension (nao a raiz do projeto; so ela contem o manifest.json).
- O atalho scripts\abrir-pasta.ps1 abre essa pasta pronta.

3. Abra brave://extensions -> Opcoes da extensao e confirme endereço, porta, senha e pasta de trabalho do servidor.

4. Clique no botao flutuante (canto direito da pagina) ou pressione Alt+Shift+O para abrir o chat.

A senha precisa bater com a do servidor. Se mudar, ajuste em server\start.ps1 -Password ... e na pagina de opcoes.

## Estrutura do projeto

extension/
  manifest.json            manifesto Manifest V3
  background.js            service worker (captura de tela, imagens, menu de contexto, atalhos)
  content.js               botao flutuante e menus no shadow DOM da pagina
  content.css              estilos do botao, painel, menus e grip de redimensionar
  panel.html / panel.js / panel.css   janela de chat (pagina de extensao em iframe)
  options.html / options.js           configuracoes do servidor e comportamento
  lib/api.js               cliente da API v2 do OpenCode
  lib/prompts.js           pre-prompts do menu e mapa de skills
  lib/markdown.js          render de markdown
  lib/skills-inject.js     injecao da biblioteca de skills na primeira mensagem
  icons/                   icones de 16, 32, 48 e 128 pixels
server/
  start.ps1  stop.ps1  restart.ps1   sobe, para e reinicia o servidor local
scripts/
  *.mjs                    testes de navegador e de contrato da API (precisam do servidor no ar)
shots/                     capturas da interface

## Trade-offs e decisoes

- Painel como pagina de extensao dentro de iframe: o stream SSE sobrevive ao descarregamento do service worker e o CSS do site nao entra no chat. O preco e a comunicacao por postMessage entre mundos diferentes.
- Ponte autenticada por nonce, nao por origem: o content script roda no contexto da pagina, entao a origem vista pelo painel e a do site. O nonce (?oc=) e o que valida o canal; uma pagina estranha nao consegue injetar comando no painel.
- Captura apenas no service worker: chrome.tabs.captureVisibleTab nao esta disponivel no content script.
- Modelo de visao separado: a sessao temporaria de descricao de imagem e apagada depois, para nao poluir o historico com pares de turnos descreva isto.
- Sem build e sem dependencias: qualquer um pode inspecionar os arquivos e carregar a pasta direto no modo de desenvolvedor.
- Clicar no botao flutuante sempre começa uma sessao nova; so se continua uma sessao antiga escolhendo-a no seletor.

## Limitações conhecidas

- Exige o servidor do OpenCode rodando localmente (http://127.0.0.1:4177). Sem servidor, o painel mostra servidor offline.
- A primeira mensagem de uma sessao nova pode receber HTTP 500 (cold start do servidor: plugins e modelo ainda carregando). A extensao reenvia uma vez; se falhar de novo, o servidor pode precisar de mais tempo.
- Ver tela exige que a aba do painel esteja em foco e que a janela do navegador esteja focada; caso contrario, a extensao avisa em vez de travar.
- Imagens remotas de origem cruzada sem CORS podem falhar na captura. Abra a imagem numa aba e tente de novo, ou use ver tela.
- Duas instancias do painel abertas ao mesmo tempo nao sao suportadas; o stream SSE e unico.
- Mudar senha, porta ou pasta de trabalho nas opcoes vale para novas abas; abas ja abertas precisam ser recarregadas para o botao aparecer.
- Na primeira vez, nenhuma mensagem e enviada ate escolher um modelo.
- Os caminhos da biblioteca de skills estao fixos em C:\Users\Kelvin\Desktop\minhas-skills-unificadas\SKILL.md; a injecao e automatica e nao aparece na interface.

## Licenca

Nao ha arquivo LICENSE no repositorio. O codigo e do autor; entre em contato antes de copiar ou reutilizar.

## Autor

Kelvin
