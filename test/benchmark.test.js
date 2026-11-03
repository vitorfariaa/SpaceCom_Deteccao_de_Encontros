import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HEADER } from '../src/parser.js';

test('benchmark mede as repeticoes e rejeita entrada truncada', t => {
  const dir = mkdtempSync(join(tmpdir(), 'spacecom-benchmark-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'sample.txt');
  const output = join(dir, 'report.json');
  const script = fileURLToPath(new URL('../scripts/benchmark.js', import.meta.url));
  const valid = [
    HEADER,
    '1;;"2024-01-01 00:00:00";0;0;false;',
    '2;;"2024-01-01 00:00:00";0;0;false;',
  ].join('\n');
  writeFileSync(input, valid);
  const run = (...args) => spawnSync(process.execPath, [script, '--input', input, '--output', output, ...args], {
    cwd: dir, encoding: 'utf8',
  });
  const success = run('--runs', '2', '--algorithm', 'grid');
  assert.equal(success.status, 0, success.stderr);
  const saved = readFileSync(output, 'utf8');
  const report = JSON.parse(saved);
  assert.equal(report.runs, 2);
  assert.equal(report.results[0].samples.length, 2);
  assert.equal(report.results[0].encounters, 1);
  assert.equal(report.results[0].status, 'complete');
  assert.ok(report.sumMeanMs > 0);
  assert.match(report.results[0].outputSha256, /^[a-f0-9]{64}$/);
  writeFileSync(input, `${valid}\n3;;"2024-01-01`);
  const failure = run('--runs', '1');
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Linha 4/);
  assert.equal(readFileSync(output, 'utf8'), saved);
  assert.equal(existsSync(join(dir, 'encounters.json')), false);
});
