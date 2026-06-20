import { describe, it, expect } from 'vitest';
import { cubre, partidasDeFrente, frentesDePartida, frentesDeUsuario } from '../frente-partidas.js';

// Partidas de prueba (jerarquía por codigo_delfin).
const PARTIDAS = [
  { id: 'p2', codigo_delfin: '02' },
  { id: 'p201', codigo_delfin: '02.01' },
  { id: 'p20101', codigo_delfin: '02.01.01' },
  { id: 'p0210', codigo_delfin: '02.10' },        // límite: '02.1' NO debe cubrirla
  { id: 'p3', codigo_delfin: '03' },
  { id: 'p30501', codigo_delfin: '03.05.01' },
  { id: 'pdel', codigo_delfin: '02.99', deleted_at: '2026-01-01' }, // excluida
];

const FP = [
  { id: 'a1', frente_id: 'F1', codigo_delfin: '02' },           // F1 cubre todo el cap 02
  { id: 'a2', frente_id: 'F1', codigo_delfin: '03.05.01' },     // + un ítem suelto
  { id: 'a3', frente_id: 'F1', codigo_delfin: '02.01' },        // redundante (ya cubierto por 02)
  { id: 'a4', frente_id: 'F2', codigo_delfin: '02.01' },        // F2 cubre 02.01 y sus hijas
  { id: 'a5', frente_id: 'F1', codigo_delfin: '07', deleted_at: '2026-01-01' }, // asignación borrada
  { id: 'a6', frente_id: 'F3', codigo_delfin: '02.1' },         // nodo inexistente; NO cubre 02.10
];

describe('cubre', () => {
  it('cubre exacto y por prefijo de segmento', () => {
    expect(cubre('02', '02')).toBe(true);
    expect(cubre('02', '02.01')).toBe(true);
    expect(cubre('02.01', '02.01.01')).toBe(true);
  });
  it('NO confunde 02.1 con 02.10', () => {
    expect(cubre('02.1', '02.10')).toBe(false);
  });
  it('no cubre hacia arriba ni hermanos', () => {
    expect(cubre('02.01', '02')).toBe(false);
    expect(cubre('02', '03')).toBe(false);
  });
  it('nulls → false', () => {
    expect(cubre(null, '02')).toBe(false);
    expect(cubre('02', null)).toBe(false);
  });
});

describe('partidasDeFrente', () => {
  it('un capítulo cubre todas sus hijas, sin las de otro capítulo', () => {
    const ids = partidasDeFrente('F1', { frentePartidas: FP, partidas: PARTIDAS }).map(p => p.id).sort();
    // 02, 02.01, 02.01.01, 02.10 (del cap 02) + 03.05.01 (ítem suelto). NO 03, NO 02.99(borrada).
    expect(ids).toEqual(['p0210', 'p2', 'p201', 'p20101', 'p30501']);
  });
  it('mezcla de niveles redundante no duplica', () => {
    const res = partidasDeFrente('F1', { frentePartidas: FP, partidas: PARTIDAS });
    const ids = res.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length); // sin duplicados
  });
  it('incluye partidas hijas FUTURAS sin nueva asignación', () => {
    const conNueva = [...PARTIDAS, { id: 'pfut', codigo_delfin: '02.05.09' }];
    const ids = partidasDeFrente('F1', { frentePartidas: FP, partidas: conNueva }).map(p => p.id);
    expect(ids).toContain('pfut');
  });
  it('asignación borrada no cubre nada', () => {
    const ids = partidasDeFrente('F1', { frentePartidas: FP, partidas: PARTIDAS }).map(p => p.id);
    expect(ids).not.toContain('p7'); // el nodo 07 estaba borrado; igual no hay partida 07
  });
  it('nodo inexistente 02.1 no cubre 02.10', () => {
    const ids = partidasDeFrente('F3', { frentePartidas: FP, partidas: PARTIDAS }).map(p => p.id);
    expect(ids).toEqual([]);
  });
  it('frente sin asignaciones → []', () => {
    expect(partidasDeFrente('FX', { frentePartidas: FP, partidas: PARTIDAS })).toEqual([]);
  });
});

describe('frentesDePartida', () => {
  it('una partida cubierta por dos frentes devuelve ambos, sin duplicar', () => {
    const fr = frentesDePartida('p20101', { frentePartidas: FP, partidas: PARTIDAS }).sort();
    expect(fr).toEqual(['F1', 'F2']); // F1 via '02', F2 via '02.01'
  });
  it('partida sin código → []', () => {
    const partidas = [{ id: 'x', codigo_delfin: null }];
    expect(frentesDePartida('x', { frentePartidas: FP, partidas })).toEqual([]);
  });
  it('partida inexistente → []', () => {
    expect(frentesDePartida('nope', { frentePartidas: FP, partidas: PARTIDAS })).toEqual([]);
  });
});

describe('frentesDeUsuario (F2)', () => {
  const FRENTES = [
    { id: 'f1', ingeniero_user_id: 'u1', activo: true },
    { id: 'f2', ingeniero_user_id: 'u1', activo: true },
    { id: 'f3', ingeniero_user_id: 'u2', activo: true },
    { id: 'f4', ingeniero_user_id: 'u1', activo: false },          // inactivo
    { id: 'f5', ingeniero_user_id: 'u1', deleted_at: '2026-01-01' }, // borrado
  ];
  it('devuelve los frentes (varios) del usuario, activos y no borrados', () => {
    const ids = frentesDeUsuario('u1', { frentes: FRENTES }).map(f => f.id).sort();
    expect(ids).toEqual(['f1', 'f2']);
  });
  it('otro usuario ve solo lo suyo', () => {
    expect(frentesDeUsuario('u2', { frentes: FRENTES }).map(f => f.id)).toEqual(['f3']);
  });
  it('userId nulo → []', () => {
    expect(frentesDeUsuario(null, { frentes: FRENTES })).toEqual([]);
  });
  it('usuario sin frentes → []', () => {
    expect(frentesDeUsuario('uX', { frentes: FRENTES })).toEqual([]);
  });
});
