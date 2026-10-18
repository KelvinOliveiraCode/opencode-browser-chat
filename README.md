# opencode-browser-chat

![JavaScript/TypeScript](https://img.shields.io/badge/JS-TS-yellow?logo=javascript)   ![status: concluido](https://img.shields.io/badge/status-concluido-green)   ![licenca: MIT](https://img.shields.io/badge/licenca-MIT-blue)

## Resumo

Aplicacao web em JavaScript/TypeScript. OpenCode Browser Chat: Floating chat extension for Chromium (Brave/Chrome) with your OpenCode models, text/image selection menus, and skills integration.

## Problema / por que existe

O projeto entrega uma interface ou utilitario web para um recorte especifico, com foco em navegador como ambiente de execucao e sem dependencia de servidor proprio.

## Arquitetura

- Camada de apresentacao: componentes e paginas que renderizam a interface.
- Camada de logica: funcoes e hooks que processam dados e estado.
- Comunicacao: requisicoes HTTP a APIs externas ou dados locais, quando aplicavel.

O build e feito com Vite (ou ferramenta equivalente), gerando arquivos estaticos prontos para hospedagem.

## Tecnologias

- JavaScript / TypeScript
- (nenhum informado no repositorio)

- Sem CI configurado neste repositorio.

Nenhum teste automatizado detectado na varredura.

## O que faz

OpenCode Browser Chat: Floating chat extension for Chromium (Brave/Chrome) with your OpenCode models, text/image selection menus, and skills integration.

## Como rodar

Requisitos: Node.js e npm (ou yarn/pnpm).

```
# instalar dependencias
npm install

# rodar em desenvolvimento
python main.py

# build para producao
npm run build

# rodar testes
pytest
```

## Estrutura do projeto

- scripts/ (18 arquivo(s))
- extension/ (16 arquivo(s))
- server/ (2 arquivo(s))
- .gitignore, README.en.md, README.md


## Trade-offs e decisões

- Build estatico: facil de hospedar (GitHub Pages, Vercel, Netlify) sem servidor.
- Dependencias minimas para reduzir superficie de manutencao.
- Navegador como unico ambiente de execucao necessario.

## Limitações conhecidas

- Funciona no navegador; depende de conexao a internet para recursos externos.
- Nenhum teste automatizado detectado.


## Testes

```
pytest
```

## Licença

Distribuído sob a licenca MIT. Consulte o arquivo `LICENSE` do repositorio.

## Autor

Kelvin Oliveira, https://github.com/KelvinOliveiraCode
Portfolio: https://kelvinoliveiracode.github.io/portfolio/
