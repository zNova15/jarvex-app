import { describe, it, expect } from 'vitest';
import { resumenFrente, planVsReal, rollupMensual, rendimientoPartida, rendimientoConjunto, ventanaPartida, rollupAvancePorCodigo, hojasDeCapitulo, consolidarInsumos } from '../mi-frente.js';

describe('hojasDeCapitulo', () => {
  const P = [
    { id: 'c', codigo_delfin: '02.01' },
    { id: 'h1', codigo_delfin: '02.01.01' },
    { id: 'h2', codigo_delfin: '02.01.02' },
    { id: 'o', codigo_delfin: '02.02.01' },   // de otro capítulo
  ];
  it('devuelve solo las hojas descendientes del capítulo', () => {
    const r = hojasDeCapitulo('02.01', P).map(p => p.id).sort();
    expect(r).toEqual(['h1', 'h2']);
  });
});

describe('consolidarInsumos', () => {
  const INS = [
    { insumo_codigo: '210020001', nombre_insumo: 'CEMENTO', tipo_insumo: 'material', unidad: 'bol', cantidad_presupuestada: 10, costo_presupuestado: 300 },
    { insumo_codigo: '210020001', nombre_insumo: 'CEMENTO', tipo_insumo: 'material', unidad: 'bol', cantidad_presupuestada: 5, costo_presupuestado: 150 },
    { insumo_codigo: '470020001', nombre_insumo: 'OPERARIO', tipo_insumo: 'mano_obra', unidad: 'hh', cantidad_presupuestada: 8, costo_presupuestado: 200 },
  ];
  it('agrupa por código, suma cantidades/costos y ordena por costo desc', () => {
    const r = consolidarInsumos(INS);
    expect(r.length).toBe(2);
    expect(r[0].codigo).toBe('210020001');   // mayor costo (450) primero
    expect(r[0].cantidad).toBe(15);
    expect(r[0].costo).toBe(450);
    expect(r[0].nPartidas).toBe(2);
    expect(r[1].codigo).toBe('470020001');
  });
});

describe('rollupAvancePorCodigo', () => {
  const P = [
    { id: 'c', codigo_delfin: '02', porcentaje_avance: 0 },          // capítulo (no aporta)
    { id: 'c1', codigo_delfin: '02.01', porcentaje_avance: 0 },      // capítulo
    { id: 'h1', codigo_delfin: '02.01.01', porcentaje_avance: 100, costo_total_presupuestado: 300 }, // hoja
    { id: 'h2', codigo_delfin: '02.01.02', porcentaje_avance: 0, costo_total_presupuestado: 100 },   // hoja
  ];
  it('pondera por costo el avance de las hojas hacia sus capítulos', () => {
    const m = rollupAvancePorCodigo(P);
    expect(m.get('02.01')).toBeCloseTo(75, 5);   // (100*300 + 0*100)/400 = 75
    expect(m.get('02')).toBeCloseTo(75, 5);       // mismo: solo cuelgan esas 2 hojas
  });
  it('no genera entrada para una hoja (solo capítulos)', () => {
    expect(rollupAvancePorCodigo(P).has('02.01.01')).toBe(false);
  });
});

const PART = [
  { id: 'p1', codigo_delfin: '02.01', porcentaje_avance: 40 },
  { id: 'p2', codigo_delfin: '02.02', porcentaje_avance: 60 },
];
const MOVS = [
  { id: 'm1', tipo_movimiento: 'salida', frente_id: 'F1' },
  { id: 'm2', tipo_movimiento: 'salida', frente_id: 'F1' },
  { id: 'm3', tipo_movimiento: 'salida', frente_id: 'F2' },   // otro frente
  { id: 'm4', tipo_movimiento: 'entrada', frente_id: 'F1' },  // no es salida
  { id: 'm5', tipo_movimiento: 'salida', frente_id: 'F1', deleted_at: 'x' },
];
const AV = [
  { id: 'a1', partida_id: 'p1', fecha: '2026-06-10', metrado_ejecutado: 5 },
  { id: 'a2', partida_id: 'p1', fecha: '2026-06-11', metrado_ejecutado: 3 },
  { id: 'a3', partida_id: 'p2', fecha: '2026-05-30', metrado_ejecutado: 7 },  // otro mes
  { id: 'a4', partida_id: 'p9', fecha: '2026-06-10', metrado_ejecutado: 99 }, // otra partida
];

describe('resumenFrente', () => {
  it('cuenta partidas, promedia avance, cuenta salidas del frente y suma metrado real', () => {
    const r = resumenFrente({ partidasDelFrente: PART, movimientos: MOVS, avances: AV, frenteId: 'F1' });
    expect(r.nPartidas).toBe(2);
    expect(r.avancePromedio).toBe(50);     // (40+60)/2
    expect(r.nSalidas).toBe(2);            // m1,m2 (no m3 otro frente, no m4 entrada, no m5 borrado)
    expect(r.metradoReal).toBe(15);        // 5+3 (p1) + 7 (p2); a4 es de otra partida
  });
});

describe('planVsReal', () => {
  const METAS = [
    { id: 'g1', partida_id: 'p1', fecha: '2026-06-10', meta_metrado: 4 },
    { id: 'g2', partida_id: 'p2', fecha: '2026-06-10', meta_metrado: 10 },
  ];
  it('compara meta vs real por partida en una fecha', () => {
    const r = planVsReal({ partidasDelFrente: PART, metas: METAS, avances: AV, fecha: '2026-06-10' });
    const p1 = r.find(x => x.partida.id === 'p1');
    expect(p1.metaMetrado).toBe(4);
    expect(p1.realMetrado).toBe(5);   // a1
    expect(p1.desvio).toBe(1);        // 5-4
    const p2 = r.find(x => x.partida.id === 'p2');
    expect(p2.metaMetrado).toBe(10);
    expect(p2.realMetrado).toBe(0);   // no hay avance de p2 ese día
    expect(p2.desvio).toBe(-10);
  });
});

describe('rollupMensual', () => {
  it('suma metrado real por partida del mes, ignora otros meses y partidas sin avance', () => {
    const r = rollupMensual({ partidasDelFrente: PART, avances: AV, mes: '2026-06' });
    expect(r.length).toBe(1);                 // solo p1 tiene avance en junio
    expect(r[0].partida.id).toBe('p1');
    expect(r[0].metradoMes).toBe(8);          // 5+3
  });
});

describe('rendimientoPartida', () => {
  const P = { id: 'pX', metrado_contratado: 100, fecha_inicio_planificada: '2026-06-01', fecha_fin_planificada: '2026-06-10' };
  const av = (metrado) => [{ id: 'a', partida_id: 'pX', metrado_ejecutado: metrado }];
  it('meta diaria = metrado / dias planificados', () => {
    const r = rendimientoPartida(P, [], '2026-06-05');
    expect(r.diasPlan).toBe(10);
    expect(r.metaDiaria).toBe(10);
    expect(r.esperadoAcum).toBe(50); // 10/dia × 5 dias transcurridos
  });
  it('atrasado → rojo; al día → verde; intermedio → ámbar', () => {
    expect(rendimientoPartida(P, av(30), '2026-06-05').semaforo).toBe('rojo');   // 30/50=0.6
    expect(rendimientoPartida(P, av(48), '2026-06-05').semaforo).toBe('verde');  // 48/50=0.96
    expect(rendimientoPartida(P, av(40), '2026-06-05').semaforo).toBe('ambar');  // 40/50=0.8
  });
  it('sin fechas planificadas → sin_dato', () => {
    expect(rendimientoPartida({ id: 'pY', metrado_contratado: 50 }, av(10), '2026-06-05').semaforo).toBe('sin_dato');
  });
});

describe('ventanaPartida', () => {
  it('días inclusive entre inicio y fin', () => {
    const r = ventanaPartida({ fecha_inicio_planificada: '2026-06-02', fecha_fin_planificada: '2026-06-11' });
    expect(r.completa).toBe(true);
    expect(r.dias).toBe(10);   // 2→11 de junio inclusive
    expect(r.ini).toBe('2026-06-02');
    expect(r.fin).toBe('2026-06-11');
  });
  it('falta una fecha → incompleta, dias null', () => {
    expect(ventanaPartida({ fecha_inicio_planificada: '2026-06-02' }).completa).toBe(false);
    expect(ventanaPartida({}).dias).toBe(null);
  });
  it('fecha truthy pero no parseable → incompleta (no NaN)', () => {
    const r = ventanaPartida({ fecha_inicio_planificada: '2026-06-02', fecha_fin_planificada: 'pendiente' });
    expect(r.completa).toBe(false);
    expect(r.dias).toBe(null);
  });
});

describe('rendimientoConjunto', () => {
  const P1 = { id: 'p1', metrado_contratado: 100, fecha_inicio_planificada: '2026-06-01', fecha_fin_planificada: '2026-06-10' }; // metaDiaria 10, esperado@05 = 50
  const P2 = { id: 'p2', metrado_contratado: 200, fecha_inicio_planificada: '2026-06-01', fecha_fin_planificada: '2026-06-10' }; // metaDiaria 20, esperado@05 = 100
  const SINPLAN = { id: 'p3', metrado_contratado: 50 }; // sin fechas → sin_dato, no pondera
  const AVS = [
    { id: 'a1', partida_id: 'p1', metrado_ejecutado: 48 },   // 48/50 = 0.96 → verde
    { id: 'a2', partida_id: 'p2', metrado_ejecutado: 60 },   // 60/100 = 0.6 → rojo
  ];
  it('índice ponderado = Σreal / Σesperado y semáforo agregado', () => {
    const r = rendimientoConjunto([P1, P2, SINPLAN], AVS, '2026-06-05');
    expect(r.nPartidas).toBe(3);
    expect(r.conDato).toBe(2);                         // p3 sin plan no pondera
    expect(r.realAcum).toBe(108);                      // 48+60
    expect(r.esperadoAcum).toBe(150);                  // 50+100
    expect(r.indice).toBeCloseTo(0.72, 2);             // 108/150
    expect(r.semaforo).toBe('rojo');                   // 0.72 < 0.75
    expect(r.conteo).toEqual({ verde: 1, ambar: 0, rojo: 1, sin_dato: 1 });
  });
  it('dedup: una partida repetida (2 frentes) cuenta una sola vez', () => {
    const r = rendimientoConjunto([P1, P1], AVS, '2026-06-05');
    expect(r.nPartidas).toBe(1);
    expect(r.realAcum).toBe(48);
  });
  it('sin partidas con plan → sin_dato', () => {
    const r = rendimientoConjunto([SINPLAN], AVS, '2026-06-05');
    expect(r.indice).toBe(null);
    expect(r.semaforo).toBe('sin_dato');
  });
});
