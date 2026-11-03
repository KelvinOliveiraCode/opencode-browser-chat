/** Roda o renderMarkdown no markdown real das sessoes e procura vazamento. */
import { renderMarkdown } from '../extension/lib/markdown.js';

const API = 'http://127.0.0.1:4177';
const H = { Authorization: 'Basic ' + Buffer.from('opencode:testefixo123').toString('base64') };
const DIR = 'C:\\Users\\Kelvin\\Desktop';

const sessoes = await (await fetch(`${API}/api/session?limit=200&order=desc&directory=${encodeURIComponent(DIR)}`, { headers: H })).json();
const topLevel = (sessoes.data || []).filter((s) => !s.parentID).slice(0, 20);

let ruins = 0, blocos = 0, tabelas = 0, casos = 0;
const exemplos = [];

for (const s of topLevel) {
  const msgs = await (await fetch(`${API}/api/session/${s.id}/message?limit=50&order=asc`, { headers: H })).json();
  for (const m of msgs.data || []) {
    for (const p of m.content || []) {
      if (p.type !== 'text' || !p.text) continue;
      casos++;
      const html = renderMarkdown(p.text);
      // bloco de codigo que nao virou .codeblock
      const fencesAbrindo = (p.text.match(/```/g) || []).length;
      const codeblocks = (html.match(/<div class="codeblock/g) || []).length;
      const pres = (html.match(/<pre>/g) || []).length;
      if (pres !== codeblocks) { ruins++; exemplos.push('pre/' + pres + ' != codeblock/' + codeblocks); }
      if (fencesAbrindo % 2 !== 0) {
        // fence sem fechar: o texto bruto tem crase sobrando, mas o html nao pode ter
        exemplos.push('fence impar (' + fencesAbrindo + ')');
      }
      // crase sobrando FORA de pre/code no html
      const semCodigo = html.replace(/<div class="codeblock[\s\S]*?<\/div>/g, '').replace(/<pre>[\s\S]*?<\/pre>/g, '');
      const craseFora = (semCodigo.match(/```/g) || []).length;
      if (craseFora > 0) { ruins++; exemplos.push('crase fora: ' + JSON.stringify(p.text.slice(0, 80))); }
      // <pre> como FILHO direto de <p> (regex preciso: sem < entre os dois)
      if (/<p>[^<]*<pre/.test(html) || /<p>[^<]*<div class="codeblock/.test(html)) {
        ruins++; exemplos.push('pre/codigo dentro de p');
      }
      // tabela nao fechada
      const abertas = (html.match(/<table>/g) || []).length;
      const fechadas = (html.match(/<\/table>/g) || []).length;
      if (abertas !== fechadas) { ruins++; exemplos.push('tabela ' + abertas + '/' + fechadas); }
      blocos += codeblocks; tabelas += abertas;
    }
  }
}

console.log(`mensagens de texto: ${casos}`);
console.log(`blocos de codigo renderizados: ${blocos}`);
console.log(`tabelas renderizadas: ${tabelas}`);
console.log(`problemas: ${ruins}`);
exemplos.slice(0, 10).forEach((e) => console.log('  - ' + e));
process.exit(ruins ? 1 : 0);