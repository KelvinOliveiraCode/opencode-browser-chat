/** Casos de crase dentro de lista, tabela e texto solto. */
import { renderMarkdown } from '../extension/lib/markdown.js';

const casos = [
  ['cerca dentro de item de lista', '- use isto:\n  ```bash\n  npm i\n  ```'],
  ['cerca dentro de tabela', '| a | b |\n|---|---|\n| ```x``` | 1 |'],
  ['cerca solta no texto', 'texto com ```js no meio'],
  ['cerca entre itens', '- item\n\n```\ncodigo\n```\n\n- outro'],
  ['crase tripla no meio da palavra', 'aaa```bbb'],
  ['item com crase simples', '- use `npm i` agora'],
];

let ruins = 0;
for (const [nome, entrada] of casos) {
  const html = renderMarkdown(entrada);
  // procura crase fora de qualquer <code>/<pre>
  const limpo = html
    .replace(/<div class="codeblock[\s\S]*?<\/div>/g, '')
    .replace(/<pre>[\s\S]*?<\/pre>/g, '')
    .replace(/<code>[\s\S]*?<\/code>/g, '');
  const sobrou = (limpo.match(/``/g) || []).length;
  const ok = sobrou === 0;
  if (!ok) ruins++;
  console.log(`${ok ? ' ok  ' : 'FAIL'} ${nome}`);
  console.log('       in : ' + JSON.stringify(entrada));
  console.log('       out: ' + html.replace(/\n/g, '\\n'));
  if (!ok) console.log('       crase sobrando fora de codigo');
}
console.log(`\n${casos.length - ruins} ok, ${ruins} falharam`);
process.exit(ruins ? 1 : 0);