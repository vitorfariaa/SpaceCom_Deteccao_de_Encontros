import { earthCell, ENCOUNTER_RADIUS_METERS, haversineMeters, LATITUDE_WINDOW } from './geo.js';

export const ALGORITHMS = ['auto', 'sweep', 'grid'];
export const SWEEP_LIMIT = 256;

export function encounterType(a, b) {
  if ((a.protected && a.restrictions.includes(b.id)) ||
      (b.protected && b.restrictions.includes(a.id))) return 'protetiva';
  if (a.faction !== '' && a.faction === b.faction) return 'faccao';
  return 'generico';
}

function comparePair(first, second, emit, stats) {
  stats.distanceCalculations++;
  // ordena os ids para manter o mesmo formato na saida
  const [a, b] = first.id < second.id ? [first, second] : [second, first];
  const distance = haversineMeters(a, b);
  if (distance >= ENCOUNTER_RADIUS_METERS) return;
  const tipo = encounterType(a, b);
  stats.encounters++;
  stats.byType[tipo]++;
  emit({
    tipo,
    monitoradosEncontro: [a.id, b.id],
    timestamp: a.timestamp,
    posicoes: {
      [a.id]: { lat: a.lat, lon: a.lon },
      [b.id]: { lat: b.lat, lon: b.lon },
    },
    distanciaMetros: distance,
  });
}

function sweep(points, emit, stats) {
  points.sort((a, b) => a.lat - b.lat || a.id - b.id);
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    for (let j = i + 1; j < points.length; j++) {
      const b = points[j];
      // amplia apenas o filtro para evitar erros de arredondamento
      if (b.lat - a.lat > LATITUDE_WINDOW + 1e-12) break;
      comparePair(a, b, emit, stats);
    }
  }
}

function grid(points, emit, stats) {
  const cells = new Map();
  for (const point of points) {
    const [x, y, z] = earthCell(point);
    // consulta os pontos anteriores para nao repetir o par
    for (let dx = -1; dx <= 1; dx++) {
      const column = cells.get(x + dx);
      if (!column) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const row = column.get(y + dy);
        if (!row) continue;
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = row.get(z + dz);
          if (bucket) for (const other of bucket) comparePair(other, point, emit, stats);
        }
      }
    }
    let column = cells.get(x);
    if (!column) cells.set(x, column = new Map());
    let row = column.get(y);
    if (!row) column.set(y, row = new Map());
    let bucket = row.get(z);
    if (!bucket) row.set(z, bucket = []);
    bucket.push(point);
  }
}

export function createStats() {
  return {
    records: 0, duplicateRecords: 0, skippedTruncatedLines: 0,
    timestamps: 0, maxPositionsPerTimestamp: 0, distanceCalculations: 0,
    encounters: 0, byType: { generico: 0, faccao: 0, protetiva: 0 },
    batches: { sweep: 0, grid: 0 },
  };
}

// processa as posicoes de um unico timestamp
export function detectTimestamp(points, emit, stats = createStats(), algorithm = 'auto') {
  if (!ALGORITHMS.includes(algorithm)) throw new Error(`Algoritmo inválido: ${algorithm}`);
  if (points.length === 0) return stats;
  stats.timestamps++;
  stats.maxPositionsPerTimestamp = Math.max(stats.maxPositionsPerTimestamp, points.length);
  const selected = algorithm === 'auto' ? (points.length <= SWEEP_LIMIT ? 'sweep' : 'grid') : algorithm;
  stats.batches[selected]++;
  if (selected === 'sweep') sweep(points, emit, stats);
  else grid(points, emit, stats);
  return stats;
}
