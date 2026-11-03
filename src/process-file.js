import { closeSync, existsSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { performance } from 'node:perf_hooks';
import { ALGORITHMS, createStats, detectTimestamp } from './detector.js';
import { createParser, HEADER, isIncompleteTail, samePosition } from './parser.js';

const BUFFER_SIZE = 1024 * 1024;
const MAX_LINE_LENGTH = 1024 * 1024;

class JsonArrayWriter {
  constructor(fd) {
    this.fd = fd;
    this.parts = ['[\n'];
    this.length = 2;
    this.count = 0;
  }
  append(encounter) {
    const text = `${this.count++ ? ',\n' : ''}${JSON.stringify(encounter)}`;
    this.parts.push(text);
    this.length += text.length;
    if (this.length >= BUFFER_SIZE) this.flush();
  }
  flush() {
    const buffer = Buffer.from(this.parts.join(''), 'utf8');
    let offset = 0;
    while (offset < buffer.length) offset += writeSync(this.fd, buffer, offset, buffer.length - offset);
    this.parts = [];
    this.length = 0;
  }
  finish() {
    this.parts.push(this.count ? '\n]\n' : ']\n');
    this.flush();
  }
}

// le um timestamp por vez e so substitui a saida quando termina
export function processFile(inputPath, outputPath, { algorithm = 'auto', allowTruncatedTail = false } = {}) {
  if (!ALGORITHMS.includes(algorithm)) throw new Error(`Algoritmo inválido: ${algorithm}`);
  const input = resolve(inputPath);
  const output = resolve(outputPath);
  if (input === output || (existsSync(output) && realpathSync(input) === realpathSync(output))) {
    throw new Error('Entrada e saída devem ser arquivos diferentes');
  }
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  const start = performance.now();
  const stats = createStats();
  const warnings = [];
  const parse = createParser();
  let inputFd;
  let outputFd;
  let lineNumber = 0;
  let headerRead = false;
  let timestamp;
  const positions = new Map();
  let bytes = 0;

  try {
    inputFd = openSync(input, 'r');
    outputFd = openSync(temporary, 'wx');
    const writer = new JsonArrayWriter(outputFd);
    const emit = encounter => writer.append(encounter);
    const flushTimestamp = () => {
      detectTimestamp([...positions.values()], emit, stats, algorithm);
      positions.clear();
    };

    function consumeLine(rawLine, unterminated = false) {
      lineNumber++;
      if (rawLine.length > MAX_LINE_LENGTH) throw new Error(`Linha ${lineNumber}: excede o limite de 1 MiB`);
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!headerRead) {
        if (line.replace(/^\uFEFF/, '') !== HEADER) throw new Error(`Linha ${lineNumber}: cabeçalho inválido`);
        headerRead = true;
        return;
      }
      if (line.trim() === '') return;
      let point;
      try {
        point = parse(line);
      } catch (error) {
        if (allowTruncatedTail && unterminated && isIncompleteTail(line)) {
          stats.skippedTruncatedLines++;
          warnings.push(`Linha ${lineNumber} incompleta no fim do arquivo foi ignorada; resultado parcial, limitado às posições completas disponíveis.`);
          return;
        }
        throw new Error(`Linha ${lineNumber}: ${error.message}`);
      }
      if (timestamp !== undefined && point.timestamp < timestamp) {
        throw new Error(`Linha ${lineNumber}: timestamps fora de ordem; ordene a entrada cronologicamente`);
      }
      if (timestamp !== point.timestamp) {
        flushTimestamp();
        timestamp = point.timestamp;
      }
      stats.records++;
      const previous = positions.get(point.id);
      if (previous) {
        if (!samePosition(previous, point)) throw new Error(`Linha ${lineNumber}: posições conflitantes para ID ${point.id} no mesmo timestamp`);
        stats.duplicateRecords++;
      } else positions.set(point.id, point);
    }

    const buffer = Buffer.allocUnsafe(BUFFER_SIZE);
    const decoder = new StringDecoder('utf8');
    let carry = '';
    let size;
    while ((size = readSync(inputFd, buffer, 0, buffer.length, null)) > 0) {
      bytes += size;
      const chunk = carry + decoder.write(buffer.subarray(0, size));
      let startIndex = 0;
      let newline;
      while ((newline = chunk.indexOf('\n', startIndex)) !== -1) {
        consumeLine(chunk.slice(startIndex, newline));
        startIndex = newline + 1;
      }
      // guarda o pedaco da linha que ficou para o proximo bloco
      carry = chunk.slice(startIndex);
      if (carry.length > MAX_LINE_LENGTH) throw new Error(`Linha ${lineNumber + 1}: excede o limite de 1 MiB`);
    }
    carry += decoder.end();
    if (carry.length) consumeLine(carry, true);
    if (!headerRead) throw new Error('Arquivo vazio: cabeçalho ausente');
    flushTimestamp();
    writer.finish();
    closeSync(outputFd);
    outputFd = undefined;
    closeSync(inputFd);
    inputFd = undefined;
    renameSync(temporary, output);
    return {
      input, output, algorithm, status: warnings.length ? 'partial' : 'complete',
      ...stats, bytes, elapsedMs: performance.now() - start, warnings,
    };
  } finally {
    if (inputFd !== undefined) closeSync(inputFd);
    if (outputFd !== undefined) closeSync(outputFd);
    rmSync(temporary, { force: true });
  }
}
