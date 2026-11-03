import test from 'node:test';
import assert from 'node:assert/strict';
import { createParser } from '../src/parser.js';

const timestamp = '2024-01-01 00:00:00';
const seed = `1;;"${timestamp}";0.00000;0.00000;false;`;

function warmedParser() {
  const parse = createParser();
  parse(seed);
  return parse;
}

test('linhas comuns preservam ids, faccao e coordenadas sem alterar posicoes anteriores', () => {
  const parse = warmedParser();
  const first = parse(`2;0;"${timestamp}";-31.93195;-40.61438;false;`);
  const second = parse(`3;2;"${timestamp}";90.00000;-180.00000;false;`);
  assert.deepEqual(first, {
    id: 2, faction: 0, timestamp, lat: -31.93195, lon: -40.61438,
    protected: false, restrictions: [],
  });
  assert.deepEqual(second, {
    id: 3, faction: 2, timestamp, lat: 90, lon: -180,
    protected: false, restrictions: [],
  });
  assert.notEqual(first, second);
});

test('formatos alternativos continuam aceitos depois de linhas comuns', () => {
  const parse = warmedParser();
  const position = parse(`"2";"3";${timestamp};+1.25;".5";false;""`);
  assert.deepEqual(position, {
    id: 2, faction: 3, timestamp, lat: 1.25, lon: 0.5,
    protected: false, restrictions: [],
  });
  assert.equal(parse(`3;;"${timestamp}";0;0;false;`).faction, '');
  assert.equal(Object.is(parse(`4;;"${timestamp}";-0.00000;0.00000;false;`).lat, -0), true);
});

test('restricoes continuam validadas, deduplicadas e ordenadas', () => {
  const parse = warmedParser();
  const victim = parse(`2;;"${timestamp}";0.00000;0.00000;true;"10,3,10"`);
  assert.equal(victim.protected, true);
  assert.deepEqual(victim.restrictions, [3, 10]);
  const other = parse(`3;;"${timestamp}";0.00000;0.00000;false;"2"`);
  assert.equal(other.protected, false);
  assert.deepEqual(other.restrictions, [2]);
});

test('timestamp novo passa pela validacao de formato e calendario', () => {
  const parse = createParser();
  assert.throws(() => parse(seed.replace(timestamp, '2024-02-30 00:00:00')), /Data ou horário inválido/);
  parse(seed);
  assert.throws(() => parse(seed.replace(timestamp, '2024-01-01 24:00:00')), /Data ou horário inválido/);
  assert.throws(() => parse(seed.replace(timestamp, '2024-1-01 00:00:00')), /Timestamp/);
  assert.equal(parse(seed.replace(timestamp, '2024-02-29 00:00:00')).timestamp, '2024-02-29 00:00:00');
});

test('atalho rejeita coordenadas fora do limite, ids inseguros e numeros com sufixos', () => {
  const parse = warmedParser();
  for (const invalid of [
    `2;;"${timestamp}";90.00001;0.00000;false;`,
    `2;;"${timestamp}";0.00000;-180.00001;false;`,
    `9007199254740992;;"${timestamp}";0.00000;0.00000;false;`,
    `2;9007199254740992;"${timestamp}";0.00000;0.00000;false;`,
    `2;;"${timestamp}";1.00000x;0.00000;false;`,
    `2;;"${timestamp}";0.00000;1.00000x;false;`,
    `2;;"${timestamp}";NaN;0.00000;false;`,
    `2;;"${timestamp}";0.00000;0.00000;yes;`,
    `2;;"${timestamp}";0.00000;0.00000;true;"3,x"`,
    `${seed};`,
  ]) assert.throws(() => parse(invalid), invalid);
  assert.equal(parse(`9007199254740991;;"${timestamp}";0.00000;0.00000;false;`).id, Number.MAX_SAFE_INTEGER);
});
