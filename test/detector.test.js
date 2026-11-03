import test from 'node:test';
import assert from 'node:assert/strict';
import { createStats, detectTimestamp, encounterType, SWEEP_LIMIT } from '../src/detector.js';
import { DEG_TO_RAD, EARTH_RADIUS_METERS, haversineMeters } from '../src/geo.js';

const timestamp = '2024-01-01 00:00:00';
function point(id, lat = 0, lon = 0, options = {}) {
  return { id, lat, lon, timestamp, faction: '', protected: false, restrictions: [], ...options };
}
function detect(points, algorithm = 'auto') {
  const output = [];
  const stats = createStats();
  detectTimestamp([...points], value => output.push(value), stats, algorithm);
  return { output, stats };
}
const key = encounter => encounter.monitoradosEncontro.join(':');

test('Haversine usa raio de 6.371.000 m e reproduz a distância do gabarito', () => {
  assert.equal(haversineMeters(point(1), point(2)), 0);
  assert.ok(Math.abs(haversineMeters(point(1, -31.93195, -40.61438), point(2, -31.93187, -40.61435)) - 9.33522817789823) < 1e-8);
  assert.ok(Math.abs(haversineMeters(point(1, 0, 0), point(2, 0, 180)) - Math.PI * EARTH_RADIUS_METERS) < 1e-6);
});

for (const algorithm of ['auto', 'sweep', 'grid']) {
  test(`${algorithm}: limite estrito, IDs ordenados e unicidade`, () => {
    const longitude = meters => meters / EARTH_RADIUS_METERS / DEG_TO_RAD;
    for (const meters of [0, 19.999999, 20, 20.000001]) {
      const a = point(9);
      const b = point(3, 0, longitude(meters));
      const { output } = detect([a, b], algorithm);
      assert.equal(output.length, haversineMeters(a, b) < 20 ? 1 : 0);
      if (output.length) assert.deepEqual(output[0].monitoradosEncontro, [3, 9]);
    }
    const { output } = detect([point(3), point(1), point(2)], algorithm);
    assert.equal(output.length, 3);
    assert.equal(new Set(output.map(key)).size, 3);
    assert.deepEqual(Object.keys(output[0]).sort(), ['tipo', 'monitoradosEncontro', 'timestamp', 'posicoes', 'distanciaMetros'].sort());
  });

  test(`${algorithm}: atravessa antimeridiano, polos e fronteiras de células`, () => {
    for (const positions of [
      [point(1, 0, 179.99999), point(2, 0, -179.99999)],
      [point(1, 89.99999, -120), point(2, 89.99999, 60)],
      [point(1, -89.99999, -120), point(2, -89.99999, 60)],
      [point(1, -0.00001, -0.00001), point(2, 0.00001, 0.00001)],
      [point(1, -35, -74), point(2, -34.99999, -73.99999)],
    ]) assert.equal(detect(positions, algorithm).output.length, 1);
  });
}

test('classificação: protetiva tem precedência, depois facção, depois genérico', () => {
  const a = point(1, 0, 0, { faction: 2 });
  const b = point(2, 0, 0, { faction: 2 });
  assert.equal(encounterType(a, b), 'faccao');
  assert.equal(encounterType({ ...a, protected: true, restrictions: [2] }, b), 'protetiva');
  assert.equal(encounterType(b, { ...a, protected: true, restrictions: [2] }), 'protetiva');
  assert.equal(encounterType(point(1), point(2)), 'generico');
  assert.equal(encounterType(a, { ...b, faction: 3 }), 'generico');
  assert.equal(encounterType({ ...a, protected: false, restrictions: [2] }, b), 'faccao');
  assert.equal(encounterType(point(1, 0, 0, { protected: true, restrictions: [9] }), point(2)), 'generico');
});

test('auto usa grade para lotes maiores que o limite da varredura', () => {
  const points = Array.from({ length: SWEEP_LIMIT + 1 }, (_, i) => point(i, -40 + i / 10, 20));
  const { stats } = detect(points);
  assert.equal(stats.batches.grid, 1);
  assert.equal(stats.encounters, 0);
});

// calcula a distancia por vetores para conferir o haversine
function sphericalDistance(a, b) {
  const vector = p => {
    const lat = p.lat * Math.PI / 180;
    const lon = p.lon * Math.PI / 180;
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  };
  const u = vector(a);
  const v = vector(b);
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return 6_371_000 * Math.atan2(Math.hypot(...cross), dot);
}

test('as duas estratégias e auto coincidem com força bruta independente em dados aleatórios', () => {
  let seed = 123456789;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 16; trial++) {
    const points = [];
    for (let i = 0; i < 350; i++) {
      if (i % 4 === 0 || points.length === 0) {
        points.push(point(i, random() * 179.8 - 89.9, random() * 360 - 180));
      } else {
        const base = points[i - i % 4];
        points.push(point(i, base.lat + (random() - 0.5) * 0.001, base.lon + (random() - 0.5) * 0.001));
      }
    }
    const expected = [];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        if (sphericalDistance(points[i], points[j]) < 20) expected.push(`${i}:${j}`);
      }
    }
    expected.sort();
    for (const algorithm of ['sweep', 'grid', 'auto']) {
      const { output } = detect(points, algorithm);
      assert.deepEqual(output.map(key).sort(), expected, `${algorithm}, tentativa ${trial}`);
    }
  }
});
