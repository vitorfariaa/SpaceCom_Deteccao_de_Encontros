export const HEADER = 'idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida';
const INTEGER = /^\d+$/;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function unquote(value) {
  const text = value.trim();
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new Error('Campo com aspas incompletas');
    const inner = text.slice(1, -1);
    if (inner.includes('"')) throw new Error('Aspas inesperadas no campo');
    return inner;
  }
  if (text.includes('"')) throw new Error('Aspas inesperadas no campo');
  return text;
}

function parseId(text, field) {
  const id = Number(text);
  if (!INTEGER.test(text) || !Number.isSafeInteger(id)) {
    throw new Error(`${field} deve ser um inteiro não negativo seguro`);
  }
  return id;
}

// reaproveita a validacao do timestamp anterior
export function createParser() {
  const common = /^(\d+);(\d*);"([^"]{19})";(-?\d+\.\d{5});(-?\d+\.\d{5});false;$/;
  const noRestrictions = Object.freeze([]);
  let lastTimestamp;
  return function parseLine(line) {
    // trata as linhas mais comuns com timestamp ja validado
    const match = common.exec(line);
    if (match && match[0].length === line.length && match[3] === lastTimestamp) {
      const id = Number(match[1]);
      const faction = match[2] === '' ? '' : Number(match[2]);
      const lat = parseFloat(match[4]);
      const lon = parseFloat(match[5]);
      if (
        Number.isSafeInteger(id) &&
        (faction === '' || Number.isSafeInteger(faction)) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180
      ) {
        return {
          id, faction, timestamp: lastTimestamp, lat, lon,
          protected: false, restrictions: noRestrictions,
        };
      }
    }

    const fields = line.split(';');
    if (fields.length !== 7) throw new Error(`Esperados 7 campos, encontrados ${fields.length}`);
    const id = parseId(unquote(fields[0]), 'idMonitorado');
    const factionText = unquote(fields[1]);
    const faction = factionText === '' ? '' : parseId(factionText, 'faccaoMonitorado');
    const timestamp = unquote(fields[2]);
    if (timestamp !== lastTimestamp) {
      if (!TIMESTAMP.test(timestamp)) throw new Error('Timestamp deve seguir YYYY-MM-DD HH:MM:SS');
      const date = new Date(`${timestamp.replace(' ', 'T')}Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19).replace('T', ' ') !== timestamp) {
        throw new Error('Data ou horário inválido');
      }
      lastTimestamp = timestamp;
    }
    const latText = unquote(fields[3]);
    const lonText = unquote(fields[4]);
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!DECIMAL.test(latText) || !Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Latitude inválida');
    if (!DECIMAL.test(lonText) || !Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('Longitude inválida');
    const protectedText = unquote(fields[5]);
    if (protectedText !== 'true' && protectedText !== 'false') throw new Error('medidaProtetiva deve ser true ou false');
    const restrictionsText = unquote(fields[6]);
    const restrictions = restrictionsText === '' ? [] : [...new Set(restrictionsText.split(',').map(s => parseId(s.trim(), 'idsRestricaoMedida')))];
    restrictions.sort((a, b) => a - b);
    return { id, faction, timestamp, lat, lon, protected: protectedText === 'true', restrictions };
  };
}

export function samePosition(a, b) {
  return a.lat === b.lat && a.lon === b.lon && a.faction === b.faction &&
    a.protected === b.protected && a.restrictions.length === b.restrictions.length &&
    a.restrictions.every((id, i) => id === b.restrictions[i]);
}

// identifica a ultima linha com campos faltando
export function isIncompleteTail(line) {
  return line.split(';').length < 7;
}
