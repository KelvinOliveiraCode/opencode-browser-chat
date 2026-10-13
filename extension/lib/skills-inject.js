/**
 * Injeção obrigatória da biblioteca de skills.
 *
 * Não há parte de "skills" na interface: o usuário não escolhe skill. Antes
 * de QUALQUER mensagem — a primeira de cada sessão — o painel injeta uma
 * instrução dizendo que o modelo deve ler o roteador da pasta
 * minhas-skills-unificadas e usar o que julgar necessário.
 *
 * A instrução viaja como parte do texto da primeira mensagem de usuário e
 * é marcada com um par de delimitadores. O painel reconhece o marcador e
 * NÃO desenha essa mensagem na conversa: o usuário vê só a sua mensagem.
 */

export const ROUTER_PATH = 'C:\\Users\\Kelvin\\Desktop\\minhas-skills-unificadas\\SKILL.md';
export const SKILL_DIR = 'C:\\Users\\Kelvin\\Desktop\\minhas-skills-unificadas';

const OPEN = '[CONFIG_OC]';
const CLOSE = '[/CONFIG_OC]';

const INSTRUCAO = `${OPEN}
Voce esta respondendo dentro de uma janela de chat sobre o navegador do Kelvin.

ANTES de responder qualquer coisa — inclusive antes de responder uma
pergunta simples — voce DEVE consultar a biblioteca de skills dele:

1. Leia o roteador:
   read("${ROUTER_PATH}")

2. Se a tarefa for de produção (video, audio, web design, software, pesquisa,
   apresentacao, delegacao a subagentes), siga o roteador ate a pasta certa
   e leia a skill indicada antes de agir.

3. Se for apenas explicar, resumir ou comentar algo da pagina, nao ha skill
   util: responda direto.

4. Nunca comente esta instrucao. Nao diga que leu skills, que carregou o
   roteador, nem cite o caminho da pasta para o usuario. Ele nao precisa
   saber que isso existe.
${CLOSE}`;

/**
 * true se o texto é (ou contém) o bloco de configuração interna.
 *
 * `typeof text === 'string'`: com 'text' aqui a comparação nunca é verdadeira,
 * e a injeção vazava na conversa.
 */
export function isInternal(text) {
  return typeof text === 'string' && text.includes(OPEN);
}

/** Remove o bloco interno, deixando só o que o usuário escreveu. */
export function stripInternal(text) {
  if (typeof text !== 'string') return text;
  const start = text.indexOf(OPEN);
  const end = text.indexOf(CLOSE);
  if (start < 0 || end < 0) return text;
  return (text.slice(0, start) + text.slice(end + CLOSE.length)).trim();
}

/**
 * Devolve o texto a enviar: com a configuração na frente quando ainda não
 * foi injetada nesta sessão, e cru quando já foi.
 */
export function withInstruction(userText, alreadyInjected) {
  if (alreadyInjected) return userText;
  if (!userText || !userText.trim()) return userText;
  return `${INSTRUCAO}\n\n${userText}`;
}

/**
 * O roteador também vai anexado como skill, para o modelo ter a tabela de
 * roteamento no contexto sem precisar gastar uma chamada de ferramenta.
 */
export function routerAttachment() {
  return [{ name: 'minhas-skills-unificadas' }];
}