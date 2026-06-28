import { describe, it, expect } from 'vitest';
import { parsePresupuestoObra, parseGantt, parsePctGantt, parseAPU, esUnidadPorcentaje } from '../apuParser.js';
import { normalizeCodigo } from '../match-helpers.js';

describe('esUnidadPorcentaje — unidades de % (mano de obra/equipo)', () => {
  it('reconoce %mo, %MO, % y variantes', () => {
    expect(esUnidadPorcentaje('%mo')).toBe(true);
    expect(esUnidadPorcentaje('%MO')).toBe(true);
    expect(esUnidadPorcentaje(' %eq')).toBe(true);
    expect(esUnidadPorcentaje('%')).toBe(true);
  });
  it('NO marca unidades normales', () => {
    expect(esUnidadPorcentaje('m')).toBe(false);
    expect(esUnidadPorcentaje('und')).toBe(false);
    expect(esUnidadPorcentaje('kg')).toBe(false);
    expect(esUnidadPorcentaje('')).toBe(false);
  });
});

describe('parseAPU — insumos %mo: el % entero pasa a fracción (no infla ×100)', () => {
  // Bug real Miraflores: HERRAMIENTAS MANUALES (%mo) traía la cantidad como
  // porcentaje entero (2.994) y costo = cantidad×precio quedaba ×100.
  const fila = (m) => { const r = []; for (const [k, v] of Object.entries(m)) r[k] = v; return r; };
  const rows = [
    fila({ 0: 'Partida: 01.01', 12: 'Cant. Total:', 13: '1.00 und' }),
    fila({ 1: 'Trazo y replanteo' }),
    fila({ 1: 'EQUIPO' }),
    // insumo %mo en columnas por defecto (unidad:8, cantidad:9, costo:12, total:13)
    fila({ 0: '370020009', 1: 'HERRAMIENTAS MANUALES', 8: '%mo', 9: 2.994, 12: 534241.17, 13: 15997.07 }),
    // insumo normal de control: no se toca
    fila({ 0: '430020009', 1: 'MADERA TORNILLO', 8: 'p2', 9: 39.88, 12: 12, 13: 478.6 }),
  ];

  it('divide entre 100 la cantidad de la unidad %mo y deja las normales intactas', () => {
    const { partidas } = parseAPU(rows);
    const ins = partidas[0].insumos;
    const herr = ins.find(x => x.codigo === '370020009');
    const madera = ins.find(x => x.codigo === '430020009');
    expect(herr.cantidad).toBeCloseTo(0.02994, 6);          // 2.994% → 0.02994
    expect(herr.cantidad * herr.precio_unitario).toBeCloseTo(15995.18, 1); // = costo real (no ×100)
    expect(madera.cantidad).toBe(39.88);                    // unidad normal: intacta
  });
});

describe('parsePctGantt — % de avance (formato Porcentaje vs número plano)', () => {
  it('celda formateada como Porcentaje (raw fracción) → escala ×100', () => {
    expect(parsePctGantt(0.6401, '64.01%')).toBeCloseTo(64.01, 4);
    expect(parsePctGantt(1, '100.00%')).toBe(100);
    expect(parsePctGantt(0.0901639, '9.02%')).toBeCloseTo(9.01639, 4);
  });
  it('número plano 0-100 (sin %) → tal cual', () => {
    expect(parsePctGantt(64.01, '64.01')).toBe(64.01);
    expect(parsePctGantt(100, '100')).toBe(100);
    expect(parsePctGantt(0, null)).toBe(0);
  });
});

describe('normalizeCodigo — equivalencia de formatos Delphin', () => {
  it('quita el padding de ceros por segmento', () => {
    expect(normalizeCodigo('01.07')).toBe('1.7');
    expect(normalizeCodigo('1.7')).toBe('1.7');
    expect(normalizeCodigo('01.07.01')).toBe('1.7.1');
  });
  it('el cero final es SIGNIFICATIVO (1.10 ≠ 1.1)', () => {
    expect(normalizeCodigo('01.10')).toBe('1.10');
    expect(normalizeCodigo('1.1')).toBe('1.1');
    expect(normalizeCodigo('01.10')).not.toBe(normalizeCodigo('1.1'));
  });
});

describe('parsePresupuestoObra — códigos numéricos con cero final', () => {
  const header = ['Item', 'Descripción', null, null, null, null, null, null, 'Und.', null, 'Metrado', null, 'Precio', null, 'Parcial'];
  const fila = (cod, desc, total = 100) => {
    const r = new Array(15).fill(null);
    r[0] = cod; r[1] = desc; r[8] = 'und'; r[10] = 2; r[12] = total / 2; r[14] = total;
    return r;
  };
  it('usa el texto formateado cuando el raw es número (no pierde "1.10")', () => {
    const rows = [header, fila(1.1, 'Partida uno-diez')];
    // raw 1.10 llega como número 1.1; el texto formateado de la celda dice "1.10"
    const rowsTexto = [header, fila('1.10', 'Partida uno-diez')];
    const p = parsePresupuestoObra(rows, rowsTexto);
    expect(p).toHaveLength(1);
    expect(p[0].codigo).toBe('1.10');
  });
  it('sin rowsTexto cae al String() de siempre (backward compat)', () => {
    const p = parsePresupuestoObra([header, fila('01.07', 'Partida texto')]);
    expect(p[0].codigo).toBe('01.07');
  });
  it('texto formateado NO-código (fecha, separador de miles) cae al String(raw)', () => {
    const rows = [header, fila(1.1, 'Partida uno-uno')];
    // celda con formato raro: el texto formateado no es un código jerárquico
    const rowsTexto = [header, fila('01/01/2026', 'Partida uno-uno')];
    const p = parsePresupuestoObra(rows, rowsTexto);
    expect(p).toHaveLength(1);
    expect(p[0].codigo).toBe('1.1');
  });
});

describe('parseGantt — códigos numéricos con cero final', () => {
  const header = ['Numeracion', 'Nombre de tarea', 'Duración', 'Comienzo', 'Fin', 'Predecesoras', '% completado', 'Días'];
  it('prefiere el texto formateado para el código', () => {
    const rows = [header, [2.1, 'Capítulo dos-diez', 5, null, null, null, 0, 5]];
    const rowsTexto = [header, ['2.10', 'Capítulo dos-diez', '5', null, null, null, '0', '5']];
    const t = parseGantt(rows, rowsTexto);
    expect(t).toHaveLength(1);
    expect(t[0].codigo).toBe('2.10');
  });
  it('texto formateado NO-código cae al String(raw)', () => {
    const rows = [header, [2.1, 'Capítulo dos-uno', 5, null, null, null, 0, 5]];
    const rowsTexto = [header, ['2,1', 'Capítulo dos-uno', '5', null, null, null, '0', '5']];
    const t = parseGantt(rows, rowsTexto);
    expect(t).toHaveLength(1);
    expect(t[0].codigo).toBe('2.1');
  });
});
