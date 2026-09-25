import { describe, it, expect } from 'vitest';
import { desplazarCronograma, inicioDelCronograma } from '../simulador-cronograma.js';
import { simularOrdenes } from '../simulador-ordenes.js';

const PARTIDAS = [
  { id: 'p1', fecha_inicio_planificada: '2026-04-01', fecha_fin_planificada: '2026-04-30' },
  { id: 'p2', fecha_inicio_planificada: '2026-06-10', fecha_fin_planificada: '2026-07-05' },
  { id: 'p3', fecha_inicio_planificada: null },
  { id: 'p4', fecha_inicio_planificada: '2026-03-15', deleted_at: '2026-01-01' },
];
const PLAZO = { inicio: '2026-04-01', fin: '2026-12-31' };

describe('inicioDelCronograma', () => {
  it('manda el plazo del trabajo si lo tiene', () => {
    expect(inicioDelCronograma({ partidas: PARTIDAS, plazo: PLAZO })).toBe('2026-04-01');
  });
  it('sin plazo, la partida viva que arranca primero (la borrada no cuenta)', () => {
    expect(inicioDelCronograma({ partidas: PARTIDAS })).toBe('2026-04-01');
  });
  it('sin nada devuelve null, no una fecha inventada', () => {
    expect(inicioDelCronograma({ partidas: [{ id: 'x' }] })).toBe(null);
  });
});

describe('desplazarCronograma — el arranque del modo Simulación (§15.3)', () => {
  it('con «fechas del Gantt» no corre nada', () => {
    const r = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'gantt', hoy: '2026-09-24' });
    expect(r.activo).toBe(false);
    expect(r.reprogramacion).toEqual({});
    expect(r.plazo).toBe(PLAZO);
  });

  it('«como si empezara hoy» corre TODO el cronograma los mismos días, plazo incluido', () => {
    const r = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'hoy', hoy: '2026-10-01' });
    expect(r.activo).toBe(true);
    expect(r.deltaDias).toBe(183);
    expect(r.inicioNuevo).toBe('2026-10-01');
    expect(r.reprogramacion.p1).toEqual({ inicio: '2026-10-01', fin: '2026-10-30' });
    expect(r.reprogramacion.p2).toEqual({ inicio: '2026-12-10', fin: '2027-01-04' });
    // El plazo total no cambia: la decisión de Gabriel es respetar el fin.
    expect(r.plazo).toEqual({ inicio: '2026-10-01', fin: '2027-07-02' });
  });

  it('la partida sin fecha y la borrada no se inventan fechas', () => {
    const r = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'hoy', hoy: '2026-10-01' });
    expect(r.reprogramacion.p3).toBeUndefined();
    expect(r.reprogramacion.p4).toBeUndefined();
  });

  it('una fecha elegida también puede ir hacia atrás', () => {
    const r = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'fecha', arranqueFecha: '2026-03-01', hoy: '2026-09-24' });
    expect(r.deltaDias).toBe(-31);
    expect(r.reprogramacion.p1.inicio).toBe('2026-03-01');
  });

  it('«una fecha» sin fecha escrita todavía no corre nada y dice por qué', () => {
    const r = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'fecha', arranqueFecha: null, hoy: '2026-09-24' });
    expect(r.activo).toBe(false);
    expect(r.motivo).toBe('sin_fecha');
  });

  it('sin cronograma que correr lo dice', () => {
    const r = desplazarCronograma({ partidas: [{ id: 'x' }], arranque: 'hoy', hoy: '2026-09-24' });
    expect(r.activo).toBe(false);
    expect(r.motivo).toBe('sin_cronograma');
  });

  it('el motor lo come como una reprogramación: el insumo cae en el mes corrido', () => {
    const insumosPartida = [{
      id: 'i1', partida_id: 'p1', insumo_codigo: 'MAT-1', nombre_insumo: 'CEMENTO PORTLAND TIPO I',
      unidad: 'bls', tipo_insumo: 'material', cantidad_presupuestada: 100, precio_presupuestado: 30,
      costo_presupuestado: 3000,
    }];
    const d = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'hoy', hoy: '2026-10-01' });
    const c = simularOrdenes({
      insumosPartida, partidas: PARTIDAS, hoy: '2026-10-01', anclaje: 'cero',
      cronograma: 'reprogramado', reprogramacion: d.reprogramacion, plazo: d.plazo,
    });
    expect(c.propuestas.map(p => p.periodo)).toEqual(['2026-10']);
  });
});
