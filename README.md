# opencode-browser-chat

[![HTML/CSS/JS](https://img.shields.io/badge/HTML-CSS-JS-orange)](https://developer.mozilla.org/)   ![status: concluido](https://img.shields.io/badge/status-concluido-green)   ![licenca: MIT](https://img.shields.io/badge/licenca-MIT-blue)

## Resumo

OpenCode Browser Chat: Floating chat extension for Chromium (Brave/Chrome) with your OpenCode models, text/image selection menus, and skills integration.
## Problema / Por que existe

O projeto aborda um recorte prático e automatiza uma tarefa que, feita manualmente, é repetitiva e propensa a erro. O foco está em transformar dados ou processos em saída confiável, com código legível, testável e extensível.
## Arquitetura

Arquivos de código (28):
- `options.html`
- `panel.html`
- `content.css`
- `panel.css`
- `background.js`
- `content.js`
- `api.js`
- `prompts.js`
- `skills-inject.js`
- `options.js`
- `panel.js`
- `manifest.json`
- `browser-test.mjs`
- `capture-test.mjs`
- `e2e-test.mjs`
## Padrões de Projeto e Técnicas Identificadas

- Custom CSS styling
- ESM build scripts (.mjs)
- JSON data catalog
- Single-page HTML entry
- Vanilla JavaScript logic
## O que faz

OpenCode Browser Chat: Floating chat extension for Chromium (Brave/Chrome) with your OpenCode models, text/image selection menus, and skills integration.
## Como rodar

Abra o arquivo `index.html` diretamente no navegador, ou sirva localmente:

```bash
python -m http.server 8080
# acesse http://localhost:8080
```
## Estrutura do Projeto

- `options.html`
- `panel.html`
- `content.css`
- `panel.css`
- `background.js`
- `content.js`
- `api.js`
- `prompts.js`
- `skills-inject.js`
- `options.js`
- `panel.js`
- `manifest.json`
- `browser-test.mjs`
- `capture-test.mjs`
- `e2e-test.mjs`
- `load-check.mjs`
- `make-icons.mjs`
- `model-default-test.mjs`
- `new-features-test.mjs`
- `options-model-test.mjs`
- `parts-render-test.mjs`
- `send-repro.mjs`
- `shot-panel.mjs`
- `skills-inject-test.mjs`
- `toolcard-test.mjs`
## Trade-offs e Decisões Técnicas

- Arquivo único (ou poucos): fácil de hospedar em qualquer servidor estático (GitHub Pages, Netlify, Vercel) e de auditar linha a linha.
- Sem build, sem servidor, sem banco de dados.
- Dados em snapshot (quando aplicável), não em tempo real ,  o usuário confirma na fonte oficial linkada.
- Tema claro/escuro persistido em `localStorage` sem JavaScript externo.
## Limitações Conhecidas

- Sem backend; funcionalidade limitada ao navegador.
- Dados estáticos ou em snapshot; confirme valores em fontes oficiais.
- Não há autenticação nem multi-usuário.
## Testes

Nenhum teste automatizado detectado (projeto de documentação/guia).
## Licença

Distribuído sob a licença MIT. Consulte o arquivo `LICENSE` do repositório.
## Autor

Kelvin Oliveira ,  https://github.com/KelvinOliveiraCode
Portfolio: https://kelvinoliveiracode.github.io/portfolio/
