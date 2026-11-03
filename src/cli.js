#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { ALGORITHMS } from './detector.js';
import { processFile } from './process-file.js';

const HELP = `Detecção de encontros — Node.js 18+

Uso:
  npm start
  npm run generate
  node src/cli.js --input inputs/dataset1.txt --output outputs/dataset1.json

Opções:
  --input <caminho>         Arquivo ou diretório de .txt/.csv (padrão: inputs)
  --output <caminho>        Diretório ou, para entrada única, arquivo .json (padrão: outputs)
  --algorithm auto|sweep|grid  Estratégia espacial (padrão: auto)
  --allow-truncated-tail    Ignora somente última linha incompleta, sem newline
  --report <arquivo.json>   Relatório (padrão: <diretório de saída>/report.json)
  --help                   Exibe esta ajuda

O modo estrito é o padrão. npm run generate permite ignorar uma última linha
incompleta e registra resultado parcial no relatório quando isso acontece.
`;

function parseArguments(args) {
  const options = { input: 'inputs', output: 'outputs', algorithm: 'auto', allowTruncatedTail: false };
  const values = { '--input': 'input', '--output': 'output', '--algorithm': 'algorithm', '--report': 'report' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--allow-truncated-tail') options.allowTruncatedTail = true;
    else if (values[arg]) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Falta valor para ${arg}`);
      options[values[arg]] = args[++i];
    } else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (!ALGORITHMS.includes(options.algorithm)) throw new Error('Use --algorithm auto, sweep ou grid');
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
  } else {
    const input = resolve(options.input);
    const output = resolve(options.output);
    const directoryInput = statSync(input).isDirectory();
    const files = directoryInput
      ? readdirSync(input).filter(name => /\.(txt|csv)$/i.test(name) && statSync(join(input, name)).isFile())
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(name => join(input, name))
      : [input];
    if (files.length === 0) throw new Error('Nenhum arquivo .txt ou .csv encontrado');
    const fileOutput = extname(output).toLowerCase() === '.json' && !(existsSync(output) && statSync(output).isDirectory());
    if (directoryInput && fileOutput) throw new Error('Entrada em diretório requer saída em diretório');
    const outputDirectory = fileOutput ? dirname(output) : output;
    const reportPath = resolve(options.report ?? join(outputDirectory, 'report.json'));
    const targets = files.map(file => fileOutput ? output : join(outputDirectory, `${basename(file, extname(file))}.json`));
    if (new Set(targets).size !== targets.length) throw new Error('Entradas com o mesmo nome gerariam saídas conflitantes');
    if ([...files, ...targets].includes(reportPath)) throw new Error('O relatório deve ter caminho diferente das entradas e saídas');
    const results = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`Processando ${basename(file)}...`);
      try {
        const result = processFile(file, targets[i], options);
        results.push(result);
        console.log(`  ${result.records.toLocaleString('pt-BR')} posições; ${result.encounters} encontros; ${(result.elapsedMs / 1000).toFixed(3)} s${result.status === 'partial' ? ' (PARCIAL)' : ''}`);
        for (const warning of result.warnings) console.warn(`  Aviso: ${warning}`);
      } catch (error) {
        results.push({ input: file, output: targets[i], status: 'failed', error: error.message });
        console.error(`  Erro: ${error.message}`);
        process.exitCode = 1;
      }
    }
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      nodeVersion: process.version,
      platform: `${process.platform}/${process.arch}`,
      options: { algorithm: options.algorithm, allowTruncatedTail: options.allowTruncatedTail },
      results,
    }, null, 2)}\n`);
    console.log(`Relatório: ${reportPath}`);
  }
} catch (error) {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
}
