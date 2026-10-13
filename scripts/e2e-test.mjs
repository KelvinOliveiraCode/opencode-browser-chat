/**
 * Teste E2E do fluxo da extensão contra o servidor real.
 * Reusa exatamente o mesmo contrato que lib/api.js implementa.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'extension');
const apiUrl = pathToFileURL(join(root, 'lib', 'api.js')).href;

globalThis.OC_PROMPTS = (() => {
  const src = readFileSync(join(root, 'lib', 'prompts.js'), 'utf8');
  new Function(src)();
  return globalThis.OC_PROMPTS;
})();

const { OpencodeClient, messageParts } = await import(apiUrl);

const api = new OpencodeClient();
api.configure({
  host: '127.0.0.1', port: 4177, password: 'testefixo123',
  directory: 'C:\\Users\\Kelvin\\Desktop'
});

const ok = [];
const fail = [];
function check(name, cond, extra = '') {
  (cond ? ok : fail).push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra ? ' :: ' + extra : ''}`);
}

console.log('\n== 1. ping / auth ==');
const loc = await api.ping().catch((e) => ({ err: e.message }));
check('ping responde', !!loc && !!loc.directory, loc?.directory || loc?.err);

let authErr = null;
const bad = new OpencodeClient();
bad.configure({ port: 4177, password: 'senha-errada' });
await bad.ping().catch((e) => { authErr = e; });
check('senha errada -> 401', authErr?.status === 401, `status=${authErr?.status}`);

console.log('\n== 2. catalogo ==');
const models = await api.models();
check('lista de modelos', models.length > 0, `${models.length} modelos`);
const vision = models.filter((m) => (m.capabilities?.input || '').includes('image'));
check('existe modelo com visao', vision.length > 0, `${vision.length} com image`);
const skills = await api.skills();
check('lista de skills', skills.length > 0, `${skills.length} skills`);
const hasRouter = skills.some((s) => s.id === 'minhas-skills-unificadas');
check('router de skills presente', hasRouter);
const agents = await api.agents();
check('lista de agentes', agents.length > 0, `${agents.length}`);

console.log('\n== 3. sessao ==');
const session = await api.createSession({
  directory: api.directory,
  model: { providerID: 'kilo4', id: 'stepfun/step-5-preview-free' },
  agent: 'plan'
});
check('cria sessao', !!session.id, session.id);
check('sessao tem model', session.model?.id === 'stepfun/step-5-preview-free', JSON.stringify(session.model));

const list = await api.listSessions({ directory: api.directory, limit: 5 });
check('lista sessoes do diretorio', list.length > 0, `${list.length}`);

console.log('\n== 4. streaming SSE ==');
const events = [];
api.addEventListener('event', (e) => {
  const t = e.detail?.type;
  if (e.detail?.data?.sessionID === session.id) events.push(t);
});
api.addEventListener('stream-error', (e) => console.log('  stream err:', e.detail?.error?.message));
await api.openStream();
await new Promise((r) => setTimeout(r, 1500));

const P = globalThis.OC_PROMPTS;
const built = P.buildTextPrompt(
  P.TEXT_PROMPTS.find((p) => p.id === 'explicar'),
  'Typed Arrays sao visoes tipadas sobre memoria bruta.',
  P.describePage('https://exemplo.dev/doc', 'Typed Arrays')
);
check('pre-prompt montado', built.includes('Typed Arrays') && built.includes('exemplo.dev'));

const admitted = await api.prompt(session.id, { text: built, skills: [], delivery: 'steer' });
check('prompt admitido', !!admitted?.id, admitted?.id);

let waited = 0;
while (waited < 45000) {
  await new Promise((r) => setTimeout(r, 1500));
  waited += 1500;
  if (events.includes('session.execution.succeeded')) break;
}
check('eventos de texto chegaram',
  events.includes('session.text.delta') || events.includes('session.text.ended'),
  events.filter((e) => e.startsWith('session.text')).join(',') || 'nenhum');

const msgs = await api.messages(session.id, { limit: 50, order: 'asc' });
const assistant = msgs.find((m) => m.type === 'assistant');
const parts = assistant ? messageParts(assistant) : [];
const answer = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
check('resposta do assistente existe', answer.trim().length > 0, `${answer.length} chars`);
check('sem erro na mensagem', !assistant?.error, JSON.stringify(assistant?.error || null));
console.log('\n  RESPOSTA:', answer.slice(0, 260).replace(/\n/g, ' '));
check('uso de tokens registrado', (assistant?.tokens?.input || 0) > 0,
  `in=${assistant?.tokens?.input} out=${assistant?.tokens?.output}`);

console.log('\n== 5. turno com imagem ==');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const imgPrompt = P.buildImagePrompt(P.IMAGE_PROMPTS[0], P.describePage('https://exemplo.dev/img', 'img'));
const admittedImg = await api.prompt(session.id, {
  text: imgPrompt,
  files: [{ uri: png, name: 'pixel.png', mime: 'image/png' }]
});
check('anexo de imagem aceito', !!admittedImg?.id, admittedImg?.id);

let w2 = 0;
const before = events.length;
while (w2 < 45000) {
  await new Promise((r) => setTimeout(r, 1500));
  w2 += 1500;
  if (events.slice(before).includes('session.execution.succeeded')) break;
}
const msgs2 = await api.messages(session.id, { limit: 50, order: 'asc' });
const assistants = msgs2.filter((m) => m.type === 'assistant');
const lastAns = assistants[assistants.length - 1];
const lastText = lastAns ? messageParts(lastAns).filter((p) => p.type === 'text').map((p) => p.text).join('') : '';
check('modelo respondeu sobre a imagem', lastText.trim().length > 0, lastText.slice(0, 160));
console.log('\n  RESPOSTA IMAGEM:', lastText.slice(0, 200).replace(/\n/g, ' '));

console.log('\n== 6. skills injetadas ==');
const s2 = await api.createSession({
  directory: api.directory,
  model: { providerID: 'kilo4', id: 'stepfun/step-5-preview-free' },
  agent: 'plan'
});
const skillProbe = await api.prompt(s2.id, {
  text: 'Qual skill da minha biblioteca devo carregar para criar um video explicativo? 1 frase.',
  skills: ['minhas-skills-unificadas']
});
check('prompt com skill admitido', !!skillProbe?.id);
let w3 = 0;
while (w3 < 50000) {
  await new Promise((r) => setTimeout(r, 2000));
  w3 += 2000;
  const m = await api.messages(s2.id, { limit: 20, order: 'asc' }).catch(() => []);
  const a = m.find((x) => x.type === 'assistant');
  if (a?.time?.completed) break;
}
const m3 = await api.messages(s2.id, { limit: 20, order: 'asc' });
const a3 = m3.find((m) => m.type === 'assistant');
const t3 = a3 ? messageParts(a3).filter((p) => p.type === 'text').map((p) => p.text).join('') : '';
check('skill mudou o comportamento', /hyperframes|story-and-vo|motion|video/i.test(t3), t3.slice(0, 200));
console.log('\n  RESPOSTA SKILL:', t3.slice(0, 240).replace(/\n/g, ' '));

console.log('\n== 7. historico e limpeza ==');
const hist = await api.messages(session.id, { limit: 50, order: 'asc' });
check('historico traz user e assistant', hist.some((m) => m.type === 'user') && hist.some((m) => m.type === 'assistant'),
  hist.map((m) => m.type).join(','));

await api.request(`/api/session/${session.id}`, { method: 'DELETE', timeout: 20000 }).catch(() => {});
await api.request(`/api/session/${s2.id}`, { method: 'DELETE', timeout: 20000 }).catch(() => {});
const gone = await api.request(`/api/session/${session.id}`, { timeout: 8000 }).then(() => false).catch(() => true);
check('sessao de teste excluida', gone);

api.closeStream();
await new Promise((r) => setTimeout(r, 300));

console.log('\n================ RESUMO ================');
console.log(`${ok.length} passaram, ${fail.length} falharam`);
if (fail.length) {
  console.log('\nFALHAS:');
  fail.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
console.log('TUDO OK');
process.exit(0);