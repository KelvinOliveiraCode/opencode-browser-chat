/**
 * Markdown do chat, do zero.
 *
 * O renderizador anterior era linha por linha e quebrava em casos que aparecem
 * o tempo todo na resposta de um modelo:
 *
 *   - parágrafo com mais de uma linha virava vários <p> separados;
 *   - bloco de código sem fechamento (a geração parou no meio) despejava os
 *     crases no chat;
 *   - o bloco de código era interpolado como " B0 " e depois enfiado dentro de
 *     um <p>, que é HTML inválido;
 *   - closeTable() empurrava um segundo </tbody></table> em vez de fechar;
 *   - blockquote com duas linhas virava dois elementos.
 *
 * Este aqui é um parser de blocos de verdade: extrai os códigos antes, agrupa
 * parágrafos, listas aninhadas, tabelas com alinhamento e blockquote contínuo.
 */

const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/;

/** Escapa HTML e protege o resultado contra re-processamento. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Inline: código, negrito, itálico, riscado e link.
 *
 * O código entra num placeholder antes das outras regras, senão
 * `**negrito**` dentro de um bloco de código viraria <strong>.
 */
function inline(src) {
  const trechos = [];
  // 1. código inline viramplaceholder
  let t = esc(src).replace(/(`+)([^`]+?)\1/g, (_, ticks, code) => {
    const i = trechos.length;
    trechos.push(`<code>${code}</code>`);
    return `\u0000${i}\u0000`;
  });

  // 2. link
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, txt, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${txt}</a>`);

  // 3. negrito e itálico juntos: ***x*** e **x**
  t = t.replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  // itálico por asterisco só no começo da palavra, para não comer 2 * 3
  t = t.replace(/(^|[\s(\[])\*([^*\n]+?)\*(?=$|[\s).,;:!?\]])/g, '$1<em>$2</em>');

  // 4. sublinhado por _
  t = t.replace(/(^|[\s(\[])_([^_\n]+?)_(?=$|[\s).,;:!?\]])/g, '$1<em>$2</em>');

  // 5. riscado
  t = t.replace(/~~([^~]+?)~~/g, '<del>$1</del>');

  // 6. sobras de cerca: '```js' solto no meio da frase (modelo que escreve a
  //    cerca inline com três crases). Sem par, não é code span — vira código
  //    da palavra seguinte, que é o que a pessoa lê como intenção.
  t = t.replace(/`{2,}(\S+)/g, '<code>$1</code>');

  // 7. devolve o código
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => trechos[Number(i)]);
}

/** Alinha a tabela a partir da linha |---|---| */
function alinhamento(cells) {
  return cells.map((c) => {
    const l = /^:-+/.test(c);
    const r = /-+:/.test(c);
    if (l && r) return 'center';
    if (r) return 'right';
    return 'left';
  });
}

function blocoCodigo(lang, code) {
  const rot = lang
    ? `<div class="code-head"><span class="code-lang">${esc(lang)}</span><button class="code-copy" title="Copiar" aria-label="Copiar código"><svg viewBox="0 0 24 24" width="14" height="14"><rect x="9" y="9" width="10" height="10" rx="2"/><path d="M5 9H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div>`
    : '';
  return `<div class="codeblock${lang ? ' has-lang' : ''}">${rot}<pre><code>${esc(code)}</code></pre></div>`;
}

function lista(itens, ordenada, nivel) {
  const tag = ordenada ? 'ol' : 'ul';
  const ini = ordenada && itens.length && itens[0].n !== undefined
    ? ` start="${itens[0].n}"`
    : '';
  return `<${tag}${ini}>` + itens.map((it) => {
    const dentro = it.itens && it.itens.length
      ? '\n' + lista(it.itens, ordenada, nivel + 1)
      : '';
    // it.txt jah vem renderizado: passar pelo inline de novo escaparia o
    // <br> que a continuação de linha colocou
    return `<li><span>${it.txt}</span>${dentro}</li>`;
  }).join('') + `</${tag}>`;
}

/**
 * Renderiza markdown em HTML.
 * Nunca lança: um markdown estranho sai como texto, não como tela branca.
 */
export function renderMarkdown(src) {
  const texto = String(src ?? '').replace(/\r\n?/g, '\n');
  if (!texto.trim()) return '';

  const linhas = texto.split('\n');
  const fora = [];
  let i = 0;

  const soltaParagrafo = (acum) => {
    if (!acum.length) return;
    // uma quebra de linha dentro do parágrafo vira <br>: o modelo escreve
    // parágrafos longos e cada linha não é um parágrafo novo
    fora.push('<p>' + acum.join('<br>') + '</p>');
  };

  while (i < linhas.length) {
    const linha = linhas[i];

    // ---------------- bloco de código
    const fence = FENCE.exec(linha);
    if (fence) {
      const indent = fence[1].replace(/\t/g, '  ');
      const marca = fence[2][0].repeat(3);
      const lang = fence[3];
      const corpo = [];
      i++;
      // fecha na marca igual ou no fim do texto (geração cortada no meio)
      while (i < linhas.length && !new RegExp('^' + indent + marca + '+[ \\t]*$').test(linhas[i])) {
        corpo.push(linhas[i]);
        i++;
      }
      if (i < linhas.length) i++;   // consome o fence de fecho
      const codigo = corpo.join('\n');
      fora.push(blocoCodigo(lang, codigo));
      continue;
    }

    // ---------------- linha vazia
    if (!linha.trim()) { i++; continue; }

    // ---------------- heading
    const h = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(linha);
    if (h) {
      fora.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }

    // ---------------- hr
    if (/^[ \t]{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/.test(linha)) {
      fora.push('<hr>');
      i++;
      continue;
    }

    // ---------------- tabela
    if (/^[ \t]{0,3}\|/.test(linha) && i + 1 < linhas.length &&
        /^[ \t]{0,3}\|?[\s:|-]*-[\s:|-]*$/.test(linhas[i + 1]) && linhas[i + 1].includes('-')) {
      const split = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const cabeca = split(linha);
      const alin = alinhamento(split(linhas[i + 1]));
      i += 2;
      const corpo = [];
      while (i < linhas.length && /^[ \t]{0,3}\|/.test(linhas[i])) {
        corpo.push(split(linhas[i]));
        i++;
      }
      const th = cabeca.map((c, k) => `<th style="text-align:${alin[k] || 'left'}">${inline(c)}</th>`).join('');
      const tr = corpo.map((r) => {
        const tds = [];
        for (let k = 0; k < cabeca.length; k++) tds.push(`<td style="text-align:${alin[k] || 'left'}">${inline(r[k] ?? '')}</td>`);
        return '<tr>' + tds.join('') + '</tr>';
      }).join('');
      fora.push(`<div class="tablewrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }

    // ---------------- blockquote (linhas contíguas viram um)
    if (/^[ \t]{0,3}>/.test(linha)) {
      const acum = [];
      while (i < linhas.length && /^[ \t]{0,3}>/.test(linhas[i])) {
        acum.push(linhas[i].replace(/^[ \t]{0,3}>[ \t]?/, ''));
        i++;
      }
      fora.push('<blockquote>' + acum.map(inline).join('<br>') + '</blockquote>');
      continue;
    }

    // ---------------- lista (com aninhamento por indentação)
    if (/^[ \t]*([-*+]|\d+[.)])[ \t]+/.test(linha)) {
      const raiz = { itens: [] };
      const pilha = [{ node: raiz, indent: -1 }];
      while (i < linhas.length) {
        const l = linhas[i];
        const m = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/.exec(l);
        if (!m) break;

        const indent = m[1].replace(/\t/g, '  ').length;
        const ordenada = /\d/.test(m[2]);
        const inicio = ordenada ? Number(/(\d+)/.exec(m[2])[1]) : undefined;
        const item = { txt: inline(m[3]), itens: [], n: inicio };

        while (pilha.length > 1 && indent <= pilha[pilha.length - 1].indent) pilha.pop();
        pilha[pilha.length - 1].node.itens.push(item);
        pilha.push({ node: item, indent });
        i++;

        // continuação do item: linha sem marcador, indentada mais que ele.
        // Só a indentação não basta — a linha precisa estar sob este item.
        while (i < linhas.length) {
          const c = linhas[i];
          if (FENCE.test(c)) break;
          const cont = /^([ \t]+)(\S.*)$/.exec(c);
          if (!cont) break;
          if (cont[1].replace(/\t/g, '  ').length <= indent) break;
          // outro item de lista é tratado pelo laço de fora, não aqui
          if (/^[ \t]*([-*+]|\d+[.)])[ \t]+/.test(c)) break;
          item.txt += '<br>' + inline(cont[2].trim());
          i++;
        }
      }
      const temOrdenada = (function tem(n) {
        return n.itens.some((x) => x.n !== undefined || tem(x));
      })(raiz);
      fora.push(lista(raiz.itens, temOrdenada, 0));
      continue;
    }

    // ---------------- parágrafo
    const acum = [];
    while (i < linhas.length && linhas[i].trim() &&
           !FENCE.test(linhas[i]) &&
           !/^[ \t]{0,3}(#{1,6})[ \t]+/.test(linhas[i]) &&
           !/^[ \t]{0,3}>/.test(linhas[i]) &&
           !/^[ \t]*([-*+]|\d+[.)])[ \t]+/.test(linhas[i]) &&
           !/^[ \t]{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/.test(linhas[i]) &&
           !/^[ \t]{0,3}\|/.test(linhas[i])) {
      acum.push(inline(linhas[i].trim()));
      i++;
    }
    if (acum.length) soltaParagrafo(acum);
    else i++;
  }

  return fora.join('\n');
}

export { inline as renderInline };
