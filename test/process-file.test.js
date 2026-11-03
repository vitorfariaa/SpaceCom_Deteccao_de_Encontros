import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HEADER, createParser } from '../src/parser.js';
import { processFile } from '../src/process-file.js';

const row = (id, time = '2024-01-01 00:00:00', lat = '0', lon = '0', faction = '', protectedValue = 'false', restrictions = '') =>
  `${id};${faction};"${time}";${lat};${lon};${protectedValue};${restrictions}`;

function fixture(t, content) {
  const dir = mkdtempSync(join(tmpdir(), 'spacecom-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'input.txt');
  const output = join(dir, 'output.json');
  writeFileSync(input, content);
  return { dir, input, output };
}

test('não compara timestamps diferentes; mantém encontros sucessivos separados', t => {
  const data = [HEADER, row(1), row(2), row(1, '2024-01-01 00:00:05'), row(2, '2024-01-01 00:00:05'), row(3, '2024-01-01 00:00:10')].join('\n');
  const { input, output } = fixture(t, data);
  const stats = processFile(input, output);
  assert.equal(stats.encounters, 2);
  assert.equal(stats.timestamps, 3);
  const result = JSON.parse(readFileSync(output, 'utf8'));
  assert.deepEqual(result.map(e => e.timestamp), ['2024-01-01 00:00:00', '2024-01-01 00:00:05']);
});

test('deduplica registros iguais e rejeita posições conflitantes', t => {
  const { dir, input, output } = fixture(t, [HEADER, row(1), row(1), row(2)].join('\n'));
  const stats = processFile(input, output);
  assert.equal(stats.encounters, 1);
  assert.equal(stats.duplicateRecords, 1);
  const originalOutput = readFileSync(output, 'utf8');
  writeFileSync(input, [HEADER, row(1), row(1, undefined, '1')].join('\n'));
  assert.throws(() => processFile(input, output), /conflitantes/);
  assert.equal(readFileSync(output, 'utf8'), originalOutput);
  assert.equal(readdirSync(dir).some(name => name.endsWith('.tmp')), false);
});

test('aceita BOM, CRLF, LF, campos entre aspas, restrições múltiplas e última linha sem newline', t => {
  const data = [`\uFEFF${HEADER}`, row(1, undefined, '0', '0', '', 'true', '"2,3"'), row(2), row(3)].join('\r\n');
  const { input, output } = fixture(t, data);
  assert.equal(processFile(input, output).encounters, 3);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')).map(e => e.tipo).sort(), ['generico', 'protetiva', 'protetiva']);
});

test('somente cauda incompleta sem newline pode ser tolerada explicitamente', t => {
  const valid = [HEADER, row(1), row(2)].join('\n');
  const { input, output } = fixture(t, `${valid}\n3;;"2024-01-01`);
  assert.throws(() => processFile(input, output), /Linha 4/);
  const result = processFile(input, output, { allowTruncatedTail: true });
  assert.equal(result.status, 'partial');
  assert.equal(result.skippedTruncatedLines, 1);
  assert.equal(result.encounters, 1);
  writeFileSync(input, `${valid}\n3;;"2024-01-01\n`);
  assert.throws(() => processFile(input, output, { allowTruncatedTail: true }), /Linha 4/);
  writeFileSync(input, `${valid}\n${row(3, undefined, 'banana')}`);
  assert.throws(() => processFile(input, output, { allowTruncatedTail: true }), /Latitude inválida/);
});

test('rejeita arquivo vazio, cabeçalho inválido, ordem temporal incorreta e sobrescrita da entrada', t => {
  const { input, output } = fixture(t, '');
  assert.throws(() => processFile(input, output), /vazio/);
  writeFileSync(input, 'incorreto\n');
  assert.throws(() => processFile(input, output), /cabeçalho/);
  writeFileSync(input, [HEADER, row(1, '2024-01-01 00:00:05'), row(2)].join('\n'));
  assert.throws(() => processFile(input, output), /fora de ordem/);
  assert.throws(() => processFile(input, input), /diferentes/);
});

test('cabeçalho sem posições gera array vazio válido', t => {
  const { input, output } = fixture(t, HEADER);
  assert.equal(processFile(input, output).encounters, 0);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), []);
});

test('valida campos, coordenadas, booleanos e datas sem coerções silenciosas', () => {
  const parse = createParser();
  for (const invalid of [
    row('abc'), row('-1'), row('9007199254740992'), row(1, undefined, ''),
    row(1, undefined, 'NaN'), row(1, undefined, '91'), row(1, undefined, '0', '181'),
    row(1, undefined, '0', '0', 'abc'), row(1, undefined, '0', '0', '', 'yes'),
    row(1, undefined, '0', '0', '', 'true', '"2,x"'), row(1, '2024-02-30 00:00:00'),
    row(1, '2024-01-01 24:00:00'), row(1, '2024-1-1 00:00:00'),
  ]) assert.throws(() => parse(invalid), invalid);
  assert.equal(parse(row(1, '2024-02-29 00:00:00')).timestamp, '2024-02-29 00:00:00');
});

test('leitura atravessa fronteiras do buffer de 1 MiB sem perder linhas', t => {
  const lines = [HEADER];
  for (let id = 0; id < 30_000; id++) lines.push(row(id, undefined, '-30', String(id / 1000)));
  const { input, output } = fixture(t, lines.join('\n'));
  // separa os pontos por mais de 90 metros na mesma latitude
  const stats = processFile(input, output);
  assert.equal(stats.records, 30_000);
  assert.equal(stats.encounters, 0);
  assert.equal(stats.batches.grid, 1);
});

test('CLI gera JSON e relatório, retorna erro para entrada inválida', t => {
  const { dir, input, output } = fixture(t, [HEADER, row(1), row(2)].join('\n'));
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const success = spawnSync(process.execPath, [cli, '--input', input, '--output', output], { encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr);
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  assert.equal(report.results[0].encounters, 1);
  const failure = spawnSync(process.execPath, [cli, '--invalid'], { encoding: 'utf8' });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Argumento desconhecido/);
});
