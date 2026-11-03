/**
 * Teste do renderizador de markdown. Cada caso aqui jah quebrou alguma vez.
 */
import { renderMarkdown } from '../extension/lib/markdown.js';

let passou = 0, falhou = 0;
const checa = (nome, md, espera) => {
  const html = renderMarkdown(md);
  const ok = espera(html);
  if (ok) { passou++; console.log('  ok   ' + nome); }
  else {
    falhou++;
    console.log('  FAIL ' + nome);
    console.log('       entrada: ' + JSON.stringify(md).slice(0, 120));
    console.log('       saida:   ' + html.slice(0, 300).replace(/\n/g, '\\n'));
  }
};

console.log('== paragrafos ==');
// o defeito classico: duas linhas de um paragrafo viravam dois <p>
checa('duas linhas = um paragrafo, nao dois',
  'primeira linha\nsegunda linha',
  (h) => (h.match(/<p>/g) || []).length === 1 && h.includes('<br>'));
checa('linha vazia separa paragrafos',
  'um\n\ndois',
  (h) => (h.match(/<p>/g) || []).length === 2);

console.log('\n== codigo ==');
checa('bloco de codigo fechado',
  'texto\n```js\nconst a = 1;\n```\ndepois',
  (h) => h.includes('<div class="codeblock') && h.includes('const a = 1;') && h.includes('code-lang') && h.includes('js'));
checa('bloco sem fechar nao despeja crase',
  'antes\n```python\nx = 1\n',
  (h) => !h.includes('```') && h.includes('x = 1'));
checa('codigo com <b> nao executa html',
  '```\n<script>alert(1)</script>\n```',
  (h) => !h.includes('<script>') && h.includes('&lt;script&gt;'));
checa('cerca com 4 crases fecha com 4',
  '````\na\n````',
  (h) => !h.includes('````') && h.includes('a'));
checa('cercas diferentes: ~~~ nao fecha bloco de ```',
  '```\na\n~~~',
  (h) => h.includes('~~~') && h.includes('<code>'));
checa('bloco ~~~ fecha com ~~~',
  '~~~\na\n~~~',
  (h) => !h.includes('~~~') && h.includes('a'));
checa('codigo inline nao vira strong',
  'use `**nao**` aqui',
  (h) => h.includes('<code>**nao**</code>') && !h.includes('<strong>nao'));

console.log('\n== listas ==');
checa('lista simples',
  '- um\n- dois',
  (h) => /<ul><li><span>um<\/span><\/li><li><span>dois<\/span><\/li><\/ul>/.test(h));
checa('lista aninhada',
  '- um\n  - um.a\n- dois',
  (h) => (h.match(/<ul>/g) || []).length === 2 && h.includes('um.a'));
checa('lista ordenada guarda o start',
  '3. tres\n4. quatro',
  (h) => h.includes('<ol start="3">'));
checa('lista com continuação de linha',
  '- um\n  continua\n- dois',
  (h) => h.includes('um<br>continua') && h.includes('dois'));
checa('asterisco nao confunde com hr',
  '* italico *',
  (h) => !h.includes('<hr>'));

console.log('\n== tabelas ==');
checa('tabela fecha o </table>',
  '| a | b |\n|---|---|\n| 1 | 2 |',
  (h) => h.includes('</table>') && h.includes('<th') && h.includes('<td') && h.split('</table>').length === 2);
checa('tabela com alinhamento',
  '| a | b |\n|:--|--:|\n| 1 | 2 |',
  (h) => h.includes('text-align:left') && h.includes('text-align:right'));
checa('linha | sozinha no meio nao inventa tabela',
  'a | b\n\nc | d',
  (h) => !h.includes('<table>') && h.includes('a | b'));

console.log('\n== blockquote ==');
checa('blockquote de duas linhas vira um',
  '> um\n> dois',
  (h) => (h.match(/<blockquote>/g) || []).length === 1 && h.includes('um<br>dois'));

console.log('\n== inline ==');
checa('negrito', '**x**', (h) => h.includes('<strong>x</strong>'));
checa('italico', '*x*', (h) => h.includes('<em>x</em>'));
checa('italico por _', '_x_', (h) => h.includes('<em>x</em>'));
cheka: {
  const html = renderMarkdown('2 * 3 = 6');
  if (!html.includes('<em>')) { passou++; console.log('  ok   asterisco de multiplicacao nao vira italico'); }
  else { falhou++; console.log('  FAIL asterisco de multiplicacao virou italico: ' + html); }
}
checa('link', '[txt](https://a.com)', (h) => h.includes('<a href="https://a.com"') && h.includes('target="_blank"'));
checa('riscado', '~~x~~', (h) => h.includes('<del>x</del>'));
checa('html escapa', '<b>x</b>', (h) => !h.includes('<b>'));

console.log('\n== varios ==');
checa('vazio', '', (h) => h === '');
checa('so espaco', '   \n  ', (h) => h === '');
checa('null nao estoura', null, (h) => h === '');
checa('heading', '## Tit', (h) => h.includes('<h2>Tit</h2>'));
checa('hr', '---', (h) => h.includes('<hr>'));
checa('crlf', 'a\r\nb', (h) => h.includes('a<br>b'));
checa('mundo real',
`# Relatorio

Aqui vai um **resumo** com \`codigo\`.

| item | qtd |
|------|-----|
| a    | 1   |

- um
- dois
  - aninhado

> nota

\`\`\`ts
const x: number = 1;
\`\`\`
`,
  (h) => h.includes('<h1>Relatorio</h1>') &&
        h.includes('<strong>resumo</strong>') &&
        h.includes('<table>') && h.includes('</table>') &&
        (h.match(/<ul>/g) || []).length === 2 &&
        h.includes('<blockquote>nota</blockquote>') &&
        h.includes('const x: number = 1;'));

console.log('\n================ RESULTADO ================');
console.log(`${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
