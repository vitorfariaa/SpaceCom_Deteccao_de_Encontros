import { cpus, platform, release, tmpdir } from 'node:os';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ALGORITHMS } from '../src/detector.js';
import { processFile } from '../src/process-file.js';

function digestOutput(path) {
  // ordena os encontros antes de calcular o hash
  const values = JSON.parse(readFileSync(path, 'utf8'));
  return createHash('sha256').update(values.map(value => JSON.stringify(value)).sort().join('\n')).digest('hex');
}

if (process.argv[2] === '--worker') {
  const [, , , input, output, algorithm] = process.argv;
  const result = processFile(input, output, { algorithm });
  const maxRssKiB = process.resourceUsage().maxRSS;
  console.log(JSON.stringify({
    ...result, maxRssKiB, outputSha256: digestOutput(output),
  }));
} else {
  let temporary;
  try {
    const options = { input: 'inputs', output: 'outputs/benchmark.json', runs: 3, algorithm: 'auto' };
    for (let i = 2; i < process.argv.length; i += 2) {
      const argument = process.argv[i];
      const value = process.argv[i + 1];
      if (!['--input', '--output', '--runs', '--algorithm'].includes(argument) || !value) {
        throw new Error('Uso: npm run benchmark -- [--input arquivo|diretório] [--output relatório.json] [--runs 3] [--algorithm auto|sweep|grid]');
      }
      options[argument.slice(2)] = argument === '--runs' ? Number(value) : value;
    }
    if (!Number.isSafeInteger(options.runs) || options.runs < 1) throw new Error('--runs deve ser inteiro positivo');
    if (!ALGORITHMS.includes(options.algorithm)) throw new Error('Algoritmo inválido');
    const input = resolve(options.input);
    const files = statSync(input).isDirectory()
      ? readdirSync(input).filter(name => /\.(txt|csv)$/i.test(name) && statSync(join(input, name)).isFile())
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(name => join(input, name))
      : [input];
    if (files.length === 0) throw new Error('Nenhum dataset encontrado');
    if (files.includes(resolve(options.output))) throw new Error('Relatório não pode sobrescrever uma entrada');
    temporary = mkdtempSync(join(tmpdir(), 'spacecom-benchmark-'));
    const results = [];
    for (const file of files) {
      const samples = [];
      let referenceHash;
      for (let run = 1; run <= options.runs; run++) {
        console.log(`${basename(file)}: execução ${run}/${options.runs} (${options.algorithm})...`);
        const output = join(temporary, 'encounters.json');
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', file, output, options.algorithm], { encoding: 'utf8' });
        if (child.status !== 0) throw new Error(child.stderr || `Subprocesso encerrou com status ${child.status}`);
        const sample = JSON.parse(child.stdout);
        if (referenceHash && referenceHash !== sample.outputSha256) throw new Error(`Resultados inconsistentes em ${file}`);
        referenceHash = sample.outputSha256;
        samples.push({ elapsedMs: sample.elapsedMs, maxRssKiB: sample.maxRssKiB });
        if (run === 1) {
          const baseline = resolve('outputs', `${basename(file, extname(file))}.json`);
          if (existsSync(baseline) && digestOutput(baseline) !== sample.outputSha256) {
            throw new Error(`Resultado do benchmark diverge de ${baseline}`);
          }
          results.push({
            dataset: basename(file), bytes: sample.bytes, records: sample.records,
            encounters: sample.encounters, status: sample.status, warnings: sample.warnings,
            byType: sample.byType, timestamps: sample.timestamps,
            maxPositionsPerTimestamp: sample.maxPositionsPerTimestamp,
            distanceCalculations: sample.distanceCalculations, outputSha256: sample.outputSha256,
          });
        }
        console.log(`  ${(sample.elapsedMs / 1000).toFixed(3)} s; ${(sample.maxRssKiB / 1024).toFixed(1)} MiB RSS máximo; ${sample.encounters} encontros`);
      }
      const times = samples.map(sample => sample.elapsedMs).sort((a, b) => a - b);
      Object.assign(results.at(-1), {
        samples,
        meanMs: times.reduce((a, b) => a + b, 0) / times.length,
        medianMs: times.length % 2 ? times[Math.floor(times.length / 2)] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2,
        minMs: times[0], maxMs: times.at(-1),
        maxRssKiB: Math.max(...samples.map(sample => sample.maxRssKiB)),
      });
    }
    const report = {
      generatedAt: new Date().toISOString(),
      environment: { node: process.version, os: `${platform()} ${release()}`, arch: process.arch, cpu: cpus()[0]?.model },
      methodology: 'Processo novo por amostra. O tempo inclui leitura, validacao, deteccao e escrita, sem o startup do Node. O cache do sistema operacional nao e limpo. O RSS inclui o runtime. Entradas invalidas sao rejeitadas.',
      algorithm: options.algorithm, runs: options.runs,
      sumMeanMs: results.reduce((sum, result) => sum + result.meanMs, 0),
      results,
    };
    mkdirSync(dirname(resolve(options.output)), { recursive: true });
    writeFileSync(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Soma dos tempos médios: ${(report.sumMeanMs / 1000).toFixed(3)} s. Relatório: ${options.output}`);
  } catch (error) {
    console.error(`Benchmark falhou: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}
