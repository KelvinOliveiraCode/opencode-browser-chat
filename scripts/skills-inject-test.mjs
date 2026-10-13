/** stripInternal / isInternal: o que garante que a injeção não vaza. */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = 'C:\\Users\\Kelvin\\Desktop\\opencode-browser-chat\\extension\\lib\\skills-inject.js';
const mod = await import('file://' + SRC.replace(/\\/g, '/'));

const { isInternal, stripInternal, withInstruction } = mod;
const checks = [];
const add = (n, c, x = '') => { checks.push([n, !!c, x]); console.log(`  ${c ? ' ok ' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`); };

// 1. o texto que o painel realmente manda
const real = withInstruction('Ola, tudo bem?', false);
console.log('--- texto enviado ao servidor ---');
console.log(real.split('\n').slice(0, 3).join('\n') + '\n  ...');

add('withInstruction coloca a instrução na frente', real.startsWith('[CONFIG_OC]'), real.slice(0, 20));
add('withInstruction preserva a mensagem do usuário', real.includes('Ola, tudo bem?'));
add('isInternal detecta o marcador', isInternal(real) === true);
add('isInternal descarta texto comum', isInternal('Ola, tudo bem?') === false);

const limpo = stripInternal(real);
add('stripInternal remove a injeção', !limpo.includes('CONFIG_OC'), limpo);
add('stripInternal deixa só a mensagem', limpo === 'Ola, tudo bem?', JSON.stringify(limpo));

// 2. segunda mensagem da mesma sessão não leva injeção
const segunda = withInstruction('outra pergunta', true);
add('com injected=true nao reenvia a instrução', !segunda.includes('CONFIG_OC'), segunda);

// 3. bordas: texto sem marcador, sem texto, tipos errados
add('stripInternal em texto comum é idêntico', stripInternal('abc') === 'abc');
add('isInternal em null é false', isInternal(null) === false);
add('isInternal em undefined é false', isInternal(undefined) === false);
add('stripInternal em null devolve null', stripInternal(null) === null);
add('stripInternal em undefined devolve undefined', stripInternal(undefined) === undefined);
add('withInstruction em vazio é vazio', withInstruction('   ', false).trim() === '');

// 4. a injeção no MEIO do texto também sai
const noMeio = 'antes [CONFIG_OC]\ncoisa interna\n[/CONFIG_OC] depois';
add('marcador no meio também é removido',
  stripInternal(noMeio) === 'antes  depois', JSON.stringify(stripInternal(noMeio)));

console.log('\n================ RESULTADO ================');
const failed = checks.filter(([, c]) => !c);
console.log(`${checks.length - failed.length}/${checks.length} passaram`);
failed.forEach(([n]) => console.log('  FALHOU: ' + n));
process.exit(failed.length ? 1 : 0);