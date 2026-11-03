import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { haversineMeters } from '../src/geo.js';

const directory = resolve(process.argv[2] ?? 'outputs');
const encounterKey = encounter => `${encounter.timestamp}|${[...encounter.monitoradosEncontro].sort((a, b) => a - b).join(':')}|${encounter.tipo}`;
const fields = ['tipo', 'monitoradosEncontro', 'timestamp', 'posicoes', 'distanciaMetros'].sort();

function readOutput(path) {
  const encounters = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(Array.isArray(encounters), `${path}: deve ser array`);
  const keys = new Set();
  for (const encounter of encounters) {
    assert.deepEqual(Object.keys(encounter).sort(), fields);
    assert.ok(['generico', 'faccao', 'protetiva'].includes(encounter.tipo));
    assert.match(encounter.timestamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const ids = encounter.monitoradosEncontro;
    assert.equal(ids.length, 2);
    assert.ok(ids.every(Number.isSafeInteger));
    assert.notEqual(ids[0], ids[1]);
    assert.deepEqual(Object.keys(encounter.posicoes).sort(), ids.map(String).sort());
    for (const position of Object.values(encounter.posicoes)) {
      assert.deepEqual(Object.keys(position).sort(), ['lat', 'lon']);
      assert.ok(Number.isFinite(position.lat) && Math.abs(position.lat) <= 90);
      assert.ok(Number.isFinite(position.lon) && Math.abs(position.lon) <= 180);
    }
    const distance = haversineMeters(encounter.posicoes[ids[0]], encounter.posicoes[ids[1]]);
    assert.ok(Number.isFinite(encounter.distanciaMetros) && encounter.distanciaMetros >= 0 && encounter.distanciaMetros < 20);
    assert.ok(Math.abs(distance - encounter.distanciaMetros) < 1e-6);
    const pairTimestamp = encounterKey(encounter).split('|').slice(0, 2).join('|');
    assert.ok(!keys.has(pairTimestamp), `Par duplicado: ${pairTimestamp}`);
    keys.add(pairTimestamp);
  }
  return encounters;
}

try {
  for (const n of [1, 2]) {
    const actual = readOutput(join(directory, `dataset${n}.json`));
    const referencePath = join(directory, `respostas${n}.json`);
    // compara com o gabarito quando ele estiver disponivel
    if (!existsSync(referencePath)) {
      console.log(`dataset${n}: gabarito ausente; comparação externa não realizada.`);
      continue;
    }
    const expected = readOutput(referencePath);
    const byKey = new Map(actual.map(value => [encounterKey(value), value]));
    assert.equal(actual.length, expected.length, `dataset${n}: quantidade divergente`);
    for (const reference of expected) {
      const match = byKey.get(encounterKey(reference));
      assert.ok(match, `Encontro ausente: ${encounterKey(reference)}`);
      assert.deepEqual(match.posicoes, reference.posicoes);
      assert.ok(Math.abs(match.distanciaMetros - reference.distanciaMetros) < 1e-6);
    }
    console.log(`dataset${n}: ${actual.length}/${expected.length} encontros corretos; nenhum falso positivo.`);
  }
  const files = readdirSync(directory).filter(name => /^dataset\d+\.json$/.test(name));
  for (const name of files) readOutput(join(directory, name));
  console.log(`Estrutura, unicidade e distâncias verificadas em ${files.length} arquivos gerados.`);
} catch (error) {
  console.error(`Verificação falhou: ${error.message}`);
  process.exitCode = 1;
}
