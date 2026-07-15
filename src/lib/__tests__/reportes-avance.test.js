import { describe, it, expect } from 'vitest';
import { agregarAvance } from '../reportes-avance.js';

const partidasById = new Map([
  ['pa', { nombre: 'Muros', codigo: '01.01', precioUnit: 100 }],
  ['pb', { nombre: 'Losa', codigo: '01.02', precioUnit: 50 }],
]);
const frentesById = new Map([['f1', 'Frente A'], ['f2', 'Frente B']]);
const ingenierosById = new Map([['i1', 'Ing. Uno'], ['i2', 'Ing. Dos']]);

const avance = [
  { id: 'a1', fecha: '2026-07-10', partida_id: 'pa', frente_id: 'f1', metrado_ejecutado: 10, responsable_id: 'i1', evidencia_id: 'e1' },
  { id: 'a2', fecha: '2026-07-11', partida_id: 'pa', frente_id: 'f1', metrado_ejecutado: 5,  responsable_id: 'i1', evidencia_id: null },
  { id: 'a3', fecha: '2026-07-11', partida_id: 'pb', frente_id: 'f2', metrado_ejecutado: 4,  responsable_id: 'i2', evidencia_id: 'e2' },
  { id: 'old', fecha: '2026-06-01', partida_id: 'pa', frente_id: 'f1', metrado_ejecutado: 99, responsable_id: 'i1' }, // fuera de rango
];
const reportesDia = [
  { id: 'r1', fecha: '2026-07-12', frente_id: 'f2', responsable_id: 'i2', motivo: 'lluvia' },
];
const metas = [
  { id: 'm1', fecha: '2026-07-10', frente_id: 'f1', partida_id: 'pa', meta_metrado: 20 }, // frente A meta 20, real 15 → 75%
  { id: 'm2', fecha: '2026-07-11', frente_id: 'f2', partida_id: 'pb', meta_metrado: 4 },  // frente B meta 4, real 4 → 100%
];
const base = { avance, reportesDia, metas, partidasById, frentesById, ingenierosById, from: '2026-07-06', to: '2026-07-12', topN: 10 };

describe('agregarAvance — KPIs', () => {
  const r = agregarAvance(base);
  it('cuenta reportes en rango (excluye old)', () => { expect(r.kpis.reportes).toBe(3); });
  it('metrado total en rango', () => { expect(r.kpis.metradoTotal).toBe(19); }); // 10+5+4
  it('valor de avance = metrado × precio unitario de la partida', () => { expect(r.kpis.valorAvance).toBe(10 * 100 + 5 * 100 + 4 * 50); }); // 1700
  it('días sin avance = reportes_dia en rango', () => { expect(r.kpis.diasSinAvance).toBe(1); });
  it('frentes e ingenieros activos', () => { expect(r.kpis.frentesActivos).toBe(2); expect(r.kpis.ingenierosActivos).toBe(2); });
});

describe('agregarAvance — rankings', () => {
  const r = agregarAvance(base);
  it('topReportes: Ing. Uno con 2, Ing. Dos con 1', () => {
    expect(r.topReportes[0].nombre).toBe('Ing. Uno');
    expect(r.topReportes[0].reportes).toBe(2);
  });
  it('topAvance por valor: Ing. Uno (1500) sobre Ing. Dos (200)', () => {
    expect(r.topAvance[0].nombre).toBe('Ing. Uno');
    expect(r.topAvance[0].valor).toBe(1500);
  });
  it('ingenieros incluye días sin avance del reporte_dia', () => {
    const i2 = r.ingenieros.find(e => e.nombre === 'Ing. Dos');
    expect(i2.diasSinAvance).toBe(1);
  });
});

describe('agregarAvance — por frente vs meta', () => {
  const r = agregarAvance(base);
  it('Frente A: real 15 / meta 20 = 75% cumplimiento', () => {
    const fa = r.porFrente.find(f => f.nombre === 'Frente A');
    expect(fa.metradoReal).toBe(15); expect(fa.meta).toBe(20);
    expect(fa.cumplimiento).toBeCloseTo(0.75);
  });
  it('Frente A aparece en atrasos (<90%), Frente B no (100%)', () => {
    expect(r.atrasos.map(a => a.nombre)).toContain('Frente A');
    expect(r.atrasos.map(a => a.nombre)).not.toContain('Frente B');
  });
});

describe('agregarAvance — robustez', () => {
  it('sin datos no revienta', () => {
    const r = agregarAvance({});
    expect(r.kpis.reportes).toBe(0); expect(r.topReportes).toEqual([]); expect(r.atrasos).toEqual([]);
  });
});
