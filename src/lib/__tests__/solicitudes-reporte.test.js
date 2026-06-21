import { describe, it, expect } from 'vitest';
import {
  solicitudActiva, solicitudesPendientes, construirAvancesDeSolicitud,
  puedeEditarReporte, esperaDecision, esTerminal,
} from '../solicitudes-reporte.js';

const SOLS = [
  { id: 's1', frente_id: 'F2', fecha: '2026-06-20', solicitante_user_id: 'u1', estado: 'aprobado', created_at: '2026-06-20T08:00:00Z' },
  { id: 's2', frente_id: 'F2', fecha: '2026-06-20', solicitante_user_id: 'u1', estado: 'rechazado', created_at: '2026-06-20T07:00:00Z' },
  { id: 's3', frente_id: 'F3', fecha: '2026-06-20', solicitante_user_id: 'u1', estado: 'enviado', created_at: '2026-06-20T09:00:00Z' },
  { id: 's4', frente_id: 'F2', fecha: '2026-06-20', solicitante_user_id: 'u2', estado: 'solicitado', created_at: '2026-06-20T06:00:00Z' },
  { id: 's5', frente_id: 'F2', fecha: '2026-06-20', solicitante_user_id: 'u1', estado: 'aceptado', created_at: '2026-06-19T08:00:00Z', deleted_at: 'x' },
];

describe('solicitudActiva', () => {
  it('toma la más reciente del mismo frente/fecha/usuario, ignora borradas', () => {
    const s = solicitudActiva(SOLS, { frenteId: 'F2', fecha: '2026-06-20', userId: 'u1' });
    expect(s.id).toBe('s1');   // s5 borrada, s2 más vieja
  });
  it('devuelve null si no hay coincidencia', () => {
    expect(solicitudActiva(SOLS, { frenteId: 'F9', fecha: '2026-06-20', userId: 'u1' })).toBeNull();
  });
});

describe('solicitudesPendientes', () => {
  it('lista solicitado + enviado, en orden de creación', () => {
    const r = solicitudesPendientes(SOLS);
    expect(r.map(s => s.id)).toEqual(['s4', 's3']);  // s4 06:00 antes que s3 09:00
  });
});

describe('estados', () => {
  it('puedeEditarReporte: aprobado o devuelto', () => {
    expect(puedeEditarReporte({ estado: 'aprobado' })).toBe(true);
    expect(puedeEditarReporte({ estado: 'devuelto' })).toBe(true);
    expect(puedeEditarReporte({ estado: 'solicitado' })).toBe(false);
    expect(puedeEditarReporte(null)).toBe(false);
  });
  it('esperaDecision: solicitado o enviado', () => {
    expect(esperaDecision({ estado: 'solicitado' })).toBe(true);
    expect(esperaDecision({ estado: 'enviado' })).toBe(true);
    expect(esperaDecision({ estado: 'aprobado' })).toBe(false);
  });
  it('esTerminal: aceptado o rechazado', () => {
    expect(esTerminal({ estado: 'aceptado' })).toBe(true);
    expect(esTerminal({ estado: 'rechazado' })).toBe(true);
    expect(esTerminal({ estado: 'enviado' })).toBe(false);
  });
});

describe('construirAvancesDeSolicitud', () => {
  const PART = [{ id: 'p1', metrado_contratado: 100, codigo_delfin: '02.01' }];
  const AV = [{ partida_id: 'p1', metrado_ejecutado: 20 }];  // real previo = 20
  const sol = {
    obra_id: 'O1', frente_id: 'F2', fecha: '2026-06-20', solicitante_user_id: 'u1',
    reporte_payload: [{ partida_id: 'p1', descripcion: 'vaciado', metrado: 30 }, { partida_id: 'pX', metrado: 5 }],
  };
  it('recalcula el % acumulado con el real actual + metrado de la línea', () => {
    let n = 0; const newId = () => `n${++n}`;
    const { avanceRows, partidaUpdates } = construirAvancesDeSolicitud(sol, { partidas: PART, avances: AV, newId });
    expect(avanceRows.length).toBe(2);
    const r1 = avanceRows[0];
    expect(r1.id).toBe('n1');
    expect(r1.metrado_ejecutado).toBe(30);
    expect(r1.responsable_id).toBe('u1');
    expect(r1.frente_id).toBe('F2');
    expect(r1.porcentaje_avance_reportado).toBe(50);   // (20+30)/100 = 50%
    expect(partidaUpdates).toEqual([{ id: 'p1', porcentaje_avance: 50 }]);  // pX sin metrado_contratado → sin update
  });
  it('payload vacío → nada que aplicar', () => {
    const r = construirAvancesDeSolicitud({ ...sol, reporte_payload: [] }, { partidas: PART, avances: AV });
    expect(r.avanceRows).toEqual([]);
    expect(r.partidaUpdates).toEqual([]);
  });
});
