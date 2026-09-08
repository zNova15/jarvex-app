// ═══════════════════════════════════════════════════════════════════
// EL REQUISITO REAL, PALABRA POR PALABRA.
//
// Este archivo no inventa casos: transcribe el requisito del "Jefe de
// Supervisión del Proyecto" del Anexo 13 (Modelo de Bases EPS — Chilete,
// Gobierno Regional de Cajamarca, proceso de selección N° 022-2026) que
// Gabriel trajo el 8-set-2026, y comprueba que el verificador contesta lo que
// contestaría un evaluador leyendo las bases.
//
// EL CASO QUE JUSTIFICA TODO ESTO es `un solo trabajo largo NO califica`: con
// el modelo de la mig 197 esa persona pasaba, porque solo se miraban los meses
// acumulados. Un verificador que dice "sí" cuando la respuesta es "no" es peor
// que no tener verificador — es justo la semana que este módulo evita perder.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { evaluarRequisito, contarParticipaciones, cargoCoincide,
         recortarAVentana, mesesDesdeColegiatura } from '../experiencia-profesional.js';
import { requisitoDeFila } from '../licitaciones.js';

const HOY = '2026-09-08';

// ── El requisito, como lo escribieron las bases ───────────────────
//   «Jefe de Supervisión del Proyecto — Experiencia no menor de 03 años,
//    sustentada con copia de diploma de incorporación al Colegio respectivo.
//    Sustentar como mínimo 02 participaciones como Residente de obra y/o
//    Supervisor de obra y/o Inspector de obra y/o Gerente de obra y/o Gerente
//    de proyecto y/o Ingeniero residente y/o Ingeniero supervisor y/o Jefe de
//    Obra y/o Jefe de Supervisión de Obra en la ejecución de obras iguales o
//    similares al objeto de la convocatoria, por un plazo no menor a 02 meses
//    cada participación en los últimos 10 años.»
const FILA_JEFE_SUPERVISION = {
  id: 'req-jefe', licitacion_id: 'L-chilete', clase: 'personal', orden: 10,
  cargo: 'Jefe de Supervisión del Proyecto',
  profesion: 'Ingeniero Civil',
  meses_generales_minimos: 36,          // «no menor de 03 años»
  participaciones_minimas: 2,           // «como mínimo 02 participaciones»
  meses_por_participacion: 2,           // «no menor a 02 meses cada participación»
  ventana_anios: 10,                    // «en los últimos 10 años»
  cargos_equivalentes: [
    'Residente de obra', 'Supervisor de obra', 'Inspector de obra',
    'Gerente de obra', 'Gerente de proyecto', 'Ingeniero residente',
    'Ingeniero supervisor', 'Jefe de Obra', 'Jefe de Supervisión de Obra',
  ],
  meses_minimos: 0,                     // las bases no piden meses acumulados acá
  exige_colegiatura: true, exige_sustento: true,
};
const REQ = requisitoDeFila(FILA_JEFE_SUPERVISION);

const ficha = (o = {}) => ({
  profesion: 'Ingeniero Civil',
  colegiatura_numero: 'CIP 98765',
  colegiatura_habil_hasta: '2027-06-30',
  colegiatura_fecha: '2010-03-15',      // colegiado hace 16 años
  cv_evidencia_id: 'cv1',
  ...o,
});

let n = 0;
const exp = (o = {}) => ({
  id: `e${++n}`, personal_id: 'p1',
  cargo: 'Residente de obra', evidencia_id: 'const1',
  fecha_inicio: '2022-01-01', fecha_fin: '2022-08-31',
  ...o,
});

const cand = (experiencias, f = {}) => ({
  persona: { id: 'p1', nombres: 'Ana', apellidos: 'Quiroz' },
  ficha: ficha(f), experiencias,
});

describe('cargoCoincide — los diez sinónimos por puesto', () => {
  const eq = FILA_JEFE_SUPERVISION.cargos_equivalentes;
  it('acepta el cargo exacto y el que lo contiene', () => {
    expect(cargoCoincide('Residente de obra', eq)).toBe(true);
    expect(cargoCoincide('INGENIERO RESIDENTE DE OBRA', eq)).toBe(true);
    expect(cargoCoincide('Jefe de Supervisión de Obra', eq)).toBe(true);
  });
  it('tolera tildes y mayúsculas (las constancias vienen como vienen)', () => {
    expect(cargoCoincide('supervision de obra', ['Supervisión de obra'])).toBe(true);
  });
  it('rechaza un cargo que las bases no listaron', () => {
    expect(cargoCoincide('Asistente de almacén', eq)).toBe(false);
    expect(cargoCoincide('Topógrafo', eq)).toBe(false);
  });
  it('lista vacía = las bases no acotaron el cargo, pasa todo', () => {
    expect(cargoCoincide('Lo que sea', [])).toBe(true);
    expect(cargoCoincide('', [])).toBe(true);
  });
  it('con lista pero sin cargo en la constancia, no se puede afirmar que coincide', () => {
    expect(cargoCoincide('', eq)).toBe(false);
  });
});

describe('recortarAVentana — «en los últimos 10 años»', () => {
  it('deja pasar lo que está dentro', () => {
    const p = { ini: 19000, fin: 19100 };
    expect(recortarAVentana(p, 10, HOY)).toEqual(p);
  });
  it('sin ventana no toca nada', () => {
    const p = { ini: 1, fin: 2 };
    expect(recortarAVentana(p, 0, HOY)).toEqual(p);
    expect(recortarAVentana(p, null, HOY)).toEqual(p);
  });
  it('descarta lo que quedó entero afuera', () => {
    expect(recortarAVentana({ ini: 0, fin: 100 }, 10, HOY)).toBeNull();
  });
});

describe('mesesDesdeColegiatura — los 03 años de experiencia general', () => {
  it('cuenta desde la incorporación al colegio', () => {
    expect(mesesDesdeColegiatura({ colegiatura_fecha: '2024-09-08' }, HOY)).toBeCloseTo(24.4, 0);
  });
  it('sin la fecha devuelve null, no cero', () => {
    expect(mesesDesdeColegiatura({ colegiatura_habil_hasta: '2027-01-01' }, HOY)).toBeNull();
  });
});

describe('contarParticipaciones — no se fusionan', () => {
  it('DOS OBRAS SIMULTÁNEAS son DOS participaciones (y un solo año de meses)', () => {
    const r = contarParticipaciones([
      exp({ fecha_inicio: '2023-01-01', fecha_fin: '2023-12-31' }),
      exp({ fecha_inicio: '2023-03-01', fecha_fin: '2023-10-31' }),
    ], { hoy: HOY, mesesPorParticipacion: 2, ventanaAnios: 10 });
    expect(r.n).toBe(2);
  });

  it('descarta las más cortas que el mínimo por participación', () => {
    const r = contarParticipaciones([
      exp({ fecha_inicio: '2023-01-01', fecha_fin: '2023-06-30' }),
      exp({ fecha_inicio: '2024-01-01', fecha_fin: '2024-01-20' }),   // 20 días
    ], { hoy: HOY, mesesPorParticipacion: 2, ventanaAnios: 10 });
    expect(r.n).toBe(1);
    expect(r.descartadasPorCorta).toBe(1);
  });

  it('descarta las de un cargo que las bases no aceptan, y lo dice', () => {
    const r = contarParticipaciones([
      exp({ cargo: 'Residente de obra' }),
      exp({ cargo: 'Asistente de almacén' }),
    ], { hoy: HOY, mesesPorParticipacion: 2, ventanaAnios: 10,
         cargosEquivalentes: FILA_JEFE_SUPERVISION.cargos_equivalentes });
    expect(r.n).toBe(1);
    expect(r.descartadasPorCargo).toBe(1);
  });

  it('descarta lo anterior a la ventana de 10 años', () => {
    const r = contarParticipaciones([
      exp({ fecha_inicio: '2010-01-01', fecha_fin: '2011-12-31' }),   // hace 15 años
      exp({ fecha_inicio: '2023-01-01', fecha_fin: '2023-12-31' }),
    ], { hoy: HOY, mesesPorParticipacion: 2, ventanaAnios: 10 });
    expect(r.n).toBe(1);
  });

  it('cuenta aparte las que tienen constancia', () => {
    const r = contarParticipaciones([
      exp(), exp({ evidencia_id: null }),
    ], { hoy: HOY, mesesPorParticipacion: 2, ventanaAnios: 10 });
    expect(r.n).toBe(2);
    expect(r.nSustentadas).toBe(1);
  });
});

describe('evaluarRequisito contra el Jefe de Supervisión de Chilete', () => {
  it('🔴 EL FALSO ✅ QUE ESTO CIERRA: un solo trabajo largo NO califica', () => {
    // Cinco años seguidos como Residente, con constancia. Con el modelo viejo
    // (solo meses) pasaba. Las bases piden DOS participaciones: no califica.
    const r = evaluarRequisito(
      cand([exp({ fecha_inicio: '2019-01-01', fecha_fin: '2023-12-31' })]),
      REQ, { hoy: HOY });
    expect(r.cumple).toBe(false);
    expect(r.participaciones).toBe(1);
    expect(r.participacionesFaltantes).toBe(1);
    expect(r.bloqueos.join(' ')).toContain('1 de las 2 participaciones');
  });

  it('dos obras distintas, con constancia y en la ventana: CALIFICA', () => {
    const r = evaluarRequisito(cand([
      exp({ fecha_inicio: '2021-01-01', fecha_fin: '2021-10-31', cargo: 'Residente de obra' }),
      exp({ fecha_inicio: '2023-02-01', fecha_fin: '2023-11-30', cargo: 'Supervisor de obra' }),
    ]), REQ, { hoy: HOY });
    expect(r.cumple).toBe(true);
    expect(r.participaciones).toBe(2);
    expect(r.bloqueos).toEqual([]);
  });

  it('dos participaciones pero una de tres semanas: NO califica', () => {
    const r = evaluarRequisito(cand([
      exp({ fecha_inicio: '2021-01-01', fecha_fin: '2021-10-31' }),
      exp({ fecha_inicio: '2023-02-01', fecha_fin: '2023-02-21' }),
    ]), REQ, { hoy: HOY });
    expect(r.cumple).toBe(false);
    expect(r.bloqueos.join(' ')).toMatch(/más corta/);
  });

  it('dos participaciones pero una fuera de los 10 años: NO califica', () => {
    const r = evaluarRequisito(cand([
      exp({ fecha_inicio: '2008-01-01', fecha_fin: '2009-12-31' }),
      exp({ fecha_inicio: '2023-02-01', fecha_fin: '2023-11-30' }),
    ]), REQ, { hoy: HOY });
    expect(r.cumple).toBe(false);
    expect(r.participaciones).toBe(1);
  });

  it('dos participaciones pero una en un cargo que las bases no listan: NO califica', () => {
    const r = evaluarRequisito(cand([
      exp({ fecha_inicio: '2021-01-01', fecha_fin: '2021-10-31', cargo: 'Residente de obra' }),
      exp({ fecha_inicio: '2023-02-01', fecha_fin: '2023-11-30', cargo: 'Jefe de almacén' }),
    ]), REQ, { hoy: HOY });
    expect(r.cumple).toBe(false);
    expect(r.bloqueos.join(' ')).toMatch(/cargo que las bases no acepta/);
  });

  it('una de las dos sin constancia: NO califica (solo vale lo presentable)', () => {
    const r = evaluarRequisito(cand([
      exp({ fecha_inicio: '2021-01-01', fecha_fin: '2021-10-31' }),
      exp({ fecha_inicio: '2023-02-01', fecha_fin: '2023-11-30', evidencia_id: null }),
    ]), REQ, { hoy: HOY });
    expect(r.cumple).toBe(false);
    expect(r.bloqueos.join(' ')).toMatch(/sin constancia/);
  });

  it('colegiado hace menos de 03 años: NO califica por experiencia general', () => {
    const r = evaluarRequisito(cand([
      exp({ fecha_inicio: '2024-01-01', fecha_fin: '2024-10-31' }),
      exp({ fecha_inicio: '2025-02-01', fecha_fin: '2025-11-30' }),
    ], { colegiatura_fecha: '2025-01-01' }), REQ, { hoy: HOY });
    expect(r.cumple).toBe(false);
    expect(r.bloqueos.join(' ')).toMatch(/experiencia general/);
  });

  it('SIN fecha de colegiatura AVISA pero no bloquea: descartar por un campo vacío es el error caro', () => {
    const r = evaluarRequisito(cand([
      exp({ fecha_inicio: '2021-01-01', fecha_fin: '2021-10-31' }),
      exp({ fecha_inicio: '2023-02-01', fecha_fin: '2023-11-30' }),
    ], { colegiatura_fecha: null }), REQ, { hoy: HOY });
    expect(r.cumple).toBe(true);
    expect(r.avisos.join(' ')).toMatch(/fecha de colegiatura/);
  });

  it('la colegiatura vencida sigue bloqueando (no se puede presentar hoy)', () => {
    const r = evaluarRequisito(cand([
      exp({ fecha_inicio: '2021-01-01', fecha_fin: '2021-10-31' }),
      exp({ fecha_inicio: '2023-02-01', fecha_fin: '2023-11-30' }),
    ], { colegiatura_habil_hasta: '2026-01-01' }), REQ, { hoy: HOY });
    expect(r.cumple).toBe(false);
    expect(r.bloqueos.join(' ')).toMatch(/vencida/);
  });

  it('otra profesión no aplica, por más participaciones que tenga', () => {
    const r = evaluarRequisito(cand([
      exp({ fecha_inicio: '2021-01-01', fecha_fin: '2021-10-31' }),
      exp({ fecha_inicio: '2023-02-01', fecha_fin: '2023-11-30' }),
    ], { profesion: 'Arquitecto' }), REQ, { hoy: HOY });
    expect(r.aplica).toBe(false);
    expect(r.cumple).toBe(false);
  });
});

describe('retrocompatibilidad — un requisito viejo se evalúa igual que antes', () => {
  it('sin los campos de la mig 198, ningún criterio nuevo se activa', () => {
    const viejo = requisitoDeFila({
      cargo: 'Residente', profesion: 'Ingeniero Civil', meses_minimos: 12,
    });
    expect(viejo.participacionesMinimas).toBe(0);
    expect(viejo.ventanaAnios).toBeNull();
    expect(viejo.cargosEquivalentes).toEqual([]);
    const r = evaluarRequisito(
      cand([exp({ fecha_inicio: '2019-01-01', fecha_fin: '2023-12-31', cargo: 'Lo que sea' })]),
      viejo, { hoy: HOY });
    expect(r.cumple).toBe(true);
  });
});
