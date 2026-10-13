/**
 * Pre-prompts do menu de seleção e mapa de skills.
 *
 * Script clássico (sem ES module): content scripts do MV3 não suportam
 * `import`, e este arquivo é carregado tanto pelo content script quanto
 * pela página do painel. Tudo é publicado em globalThis.OC_PROMPTS.
 *
 * Cada pre-prompt vira uma mensagem de usuário que carrega o contexto
 * (texto e/ou imagem selecionada), a página de origem e a skill da
 * biblioteca que deve orientar a resposta.
 *
 * A skill entra via `agents: [{ name }]` no body do prompt (API v2 do
 * OpenCode), que injoca o SKILL.md inteiro no contexto do modelo.
 */

(function () {
  const SKILL_ROUTER = 'minhas-skills-unificadas';

  const TEXT_PROMPTS = [
    {
      id: 'explicar',
      label: 'Explicar',
      hint: 'O que é isso, do zero',
      icon: '?',
      skill: null,
      template:
        'Explique o texto abaixo para quem não manja do assunto.\n\n' +
        '## Texto selecionado\n{{texto}}\n\n' +
        '## Página de origem\n{{pagina}}\n\n' +
        'Comece pelo significado do termo central em uma frase, depois desenrole. ' +
        'Use uma analogia concreta do dia a dia se ajudar. Máximo 6 parágrafos.'
    },
    {
      id: 'aprofundar',
      label: 'Aprofundar',
      hint: 'Mais detalhe e contexto',
      icon: '+',
      skill: null,
      template:
        'Aprofunde o texto abaixo.\n\n' +
        '## Texto selecionado\n{{texto}}\n\n' +
        '## Página de origem\n{{pagina}}\n\n' +
        'Cubra: (1) o que está implícito e não está escrito, (2) o histórico ou a origem do assunto, ' +
        '(3) casos extremos e contraexemplos, (4) o que costuma ser mal-entendido. ' +
        'Seja específico, sem encher linguiça.'
    },
    {
      id: 'resumir',
      label: 'Resumir',
      hint: 'Tópicos em 3-5 frases',
      icon: '=',
      skill: null,
      template:
        'Resuma o texto abaixo.\n\n' +
        '## Texto selecionado\n{{texto}}\n\n' +
        '## Página de origem\n{{pagina}}\n\n' +
        'Entregue 3 a 5 frases com os pontos essenciais e, se houver, uma lista curta das conclusões. ' +
        'Nada de preâmbulo: comece direto pelo conteúdo.'
    },
    {
      id: 'simplificar',
      label: 'Simplificar',
      hint: 'Linguagem direta',
      icon: '↓',
      skill: null,
      template:
        'Reescreva o texto abaixo em linguagem simples.\n\n' +
        '## Texto selecionado\n{{texto}}\n\n' +
        '## Página de origem\n{{pagina}}\n\n' +
        'Mantenha todo o conteúdo factual. Troque jargão por palavra comum, frases longas por curtas. ' +
        'Devolva só o texto reescrito.'
    },
    {
      id: 'responder',
      label: 'Responder a isto',
      hint: 'Abre o chat já com o assunto',
      icon: '→',
      skill: null,
      template:
        'Vou discutir o texto abaixo. Leia e me diga o que entende dele em 2 frases, ' +
        'depois fique pronto para minha pergunta.\n\n' +
        '## Texto selecionado\n{{texto}}\n\n' +
        '## Página de origem\n{{pagina}}'
    },
    {
      id: 'melhorar',
      label: 'Como melhorar isto',
      hint: 'Sugestões acionáveis',
      icon: '*',
      skill: 'antislop-copywriting',
      template:
        'Avalie o texto abaixo e diga como melhorá-lo.\n\n' +
        '## Texto selecionado\n{{texto}}\n\n' +
        '## Página de origem\n{{pagina}}\n\n' +
        'Aplique o filtro anti-slop de copy: apague vício de frase, corte adjetivo que não informa ' +
        'e troque genérico por concreto. Entregue no máximo 6 sugestões, cada uma com o trecho exato ' +
        'a trocar e a versão reescrita.'
    },
    {
      id: 'criticar',
      label: 'Criticar',
      hint: 'Erros e lógica frágil',
      icon: '!',
      skill: null,
      template:
        'Critique o texto abaixo com rigor.\n\n' +
        '## Texto selecionado\n{{texto}}\n\n' +
        '## Página de origem\n{{pagina}}\n\n' +
        'Aponte: afirmações sem fonte, generalizações, raciocínio frágil, o que falta e o que é ' +
        'exagerado. Separe "erro" de "opinião". Seja direto.'
    },
    {
      id: 'verificar',
      label: 'Verificar fatos',
      hint: 'O que checar na web',
      icon: 'v',
      skill: 'grounded-citations',
      template:
        'Verifique as afirmações factuais do texto abaixo.\n\n' +
        '## Texto selecionado\n{{texto}}\n\n' +
        '## Página de origem\n{{pagina}}\n\n' +
        'Liste as checagens em ordem de prioridade. Para cada uma: o que verificar, onde procurar ' +
        'e qual resultado esperado. Marque como NÃO VERIFICADO o que você não checar.'
    },
    {
      id: 'traduzir',
      label: 'Traduzir',
      hint: 'PT-BR natural',
      icon: 'A',
      skill: null,
      template:
        'Traduza o texto abaixo para português do Brasil.\n\n' +
        '## Texto a traduzir\n{{texto}}\n\n' +
        'Tradução natural, não literal. Se o original estiver em PT-BR, diga isso e não traduza. ' +
        'Devolva só a tradução.'
    },
    {
      id: 'argumentos',
      label: 'Argumentos',
      hint: 'A favor e contra',
      icon: '±',
      skill: null,
      template:
        'Mapeie os argumentos do texto abaixo.\n\n' +
        '## Texto selecionado\n{{texto}}\n\n' +
        '## Página de origem\n{{pagina}}\n\n' +
        'Duas listas curtas: o que o texto sustenta e o que ele deixa de fora. ' +
        'Marque qual premissa é a mais frágil.'
    }
  ];

  const IMAGE_PROMPTS = [
    {
      id: 'descrever',
      label: 'Descrever',
      hint: 'O que está na imagem',
      icon: 'o',
      template: 'Descreva esta imagem em detalhe. Texto visível, layout, cores e o que a imagem comunica.'
    },
    {
      id: 'ocr',
      label: 'Ler texto',
      hint: 'Extrair o que está escrito',
      icon: 'T',
      template:
        'Transcreva todo o texto visível nesta imagem, na ordem de leitura. ' +
        'Se algo estiver ilegível, marque como [ilegível] em vez de inventar.'
    },
    {
      id: 'interface',
      label: 'Avaliar UI',
      hint: 'Crítica de interface',
      icon: 'U',
      skill: 'impeccable',
      template:
        'Avalie esta imagem de interface.\n\n' +
        'Aponte: hierarquia visual, contraste, alinhamento, densidade, estados ausentes, ' +
        'e o que parece gerado por IA sem critério. Seja concreto e cite o que vê na imagem. ' +
        'Depois liste as 5 correções de maior impacto.'
    },
    {
      id: 'diagrama',
      label: 'Diagramar',
      hint: 'Desenhar o que mostra',
      icon: 'D',
      skill: 'diagram-design',
      template:
        'Transforme o que esta imagem mostra em um diagrama. ' +
        'Descreva a estrutura e os rótulos em texto antes de dizer qual diagrama usar.'
    },
    {
      id: 'prompt-imagem',
      label: 'Gerar prompt',
      hint: 'Prompt para recriar',
      icon: '✦',
      skill: 'imagem-prompts',
      template:
        'Escreva 3 prompts de geração de imagem que reproduzam o estilo desta imagem. ' +
        'Inclua assunto, enquadramento, luz, lente e paleta. Não inclua o texto que aparece na imagem.'
    },
    {
      id: 'ocr-json',
      label: 'Extrair dados',
      hint: 'Tabelas e formulários',
      icon: '{}',
      template:
        'Se esta imagem tiver tabela, formulário ou dados estruturados, extraia tudo e devolva ' +
        'em JSON válido, usando "" para campo vazio. Se não houver dados estruturados, ' +
        'descreva a imagem e pare.'
    }
  ];

  const PAGE_PROMPT =
    'Analise a página abaixo.\n\n## Página\n{{pagina}}\n\n' +
    'Diga: o que é esta página, para quem é e qual é a proposta central. Máximo 5 frases.';

  function buildTextPrompt(item, selection, page) {
    return item.template.replace('{{texto}}', selection).replace('{{pagina}}', page);
  }

  function buildImagePrompt(item, page) {
    return item.template.replace('{{pagina}}', page);
  }

  function describePage(url, title) {
    return `URL: ${url}\nTítulo: ${title}`;
  }

  /** Roteia texto livre para a skill certa, sem o modelo adivinhar. */
  function suggestSkill(text) {
    const t = (text || '').toLowerCase();
    const rules = [
      [/vídeo|video|render|hyperframes|remotion|legenda|shorts?|reels?|storyboard/, 'hyperframes'],
      [/apresenta|deck|slides|slide/, 'slideshow'],
      [/landing page|\bsite\b|interface|\bui\b|design system|cores?|paleta/, 'web-design-workflow'],
      [/bug|erro|não funciona|stacktrace|exception|falha/, 'investigate-first'],
      [/refator|reorganiz|clean up|simplificar código/, 'safe-refactor'],
      [/teste|tdd|cobertura/, 'test-driven-development'],
      [/pesquis|buscar na web|procurar fonte/, 'busca-e-rerank'],
      [/pdf|ocr|documento escaneado/, 'pdf-e-ocr'],
      [/transcri|whisper/, 'ffmpeg-skill'],
      [/áudio|audio|voz|tts|narração/, 'media-use'],
      [/engenharia de prompt|crie um prompt/, 'prompt-engineer'],
      [/copy|headline|cta|texto de venda|landing copy/, 'antislop-copywriting'],
      [/só uma resposta|seja breve|resumo curto/, 'simple-english']
    ];
    for (const [re, skill] of rules) if (re.test(t)) return skill;
    return null;
  }

  globalThis.OC_PROMPTS = {
    SKILL_ROUTER,
    TEXT_PROMPTS,
    IMAGE_PROMPTS,
    PAGE_PROMPT,
    buildTextPrompt,
    buildImagePrompt,
    describePage,
    suggestSkill
  };
})();