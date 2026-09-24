import { describe, it, expect } from 'vitest';
import {
  sortearEnfoques, montoMinimoSugerido,
  ENFOQUES_SORTEO, ENFOQUE_LABEL, ENFOQUE_ICONO, ENFOQUE_RESUMEN,
} from '../simulador-sorteo.js';

// ── FIXTURE: seis meses, cuatro rubros distintos + un tramo largo ────
const partida = (id, inicio, fin, nombre = 'PARTIDA') => ({
  id, obra_id: 'o1', nombre_partida: nombre,
  fecha_inicio_planificada: inicio, fecha_fin_planificada: fin,
});
const ip = (partida_id, tipo_insumo, nombre_insumo, unidad, cantidad, precio, codigo = null) => ({
  id: `ip-${partida_id}-${nombre_insumo}-${Math.random()}`,
  obra_id: 'o1', partida_id, tipo_insumo, nombre_insumo, unidad,
  cantidad_presupuestada: cantidad, precio_presupuestado: precio,
  costo_presupuestado: cantidad * precio,
  insumo_codigo: codigo,
});

const CEMENTO = '210020001';
const ZAPATOS = '390010001';
const COMPRESORA = '650010001';
const TUBERIA = '020005001';

const P1 = partida('p1', '2026-06-01', '2026-06-07');
const P2 = partida('p2', '2026-07-01', '2026-07-07');
const P3 = partida('p3', '2026-08-01', '2026-08-07');
const P4 = partida('p4', '2026-09-01', '2026-09-07');
const P5 = partida('p5', '2026-10-01', '2026-10-07');
const P6 = partida('p6', '2026-11-01', '2026-11-07');
const P_LARGA = partida('p-larga', '2026-06-01', '2026-08-13', 'SUM. Y COLOC. DE TUBERIA PVC UF ISO 4435 DN=8"');
const partidas = [P1, P2, P3, P4, P5, P6, P_LARGA];

const insumosPartida = [
  ip('p1', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 400, 30, CEMENTO),
  ip('p2', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 300, 30, CEMENTO),
  ip('p3', 'material', 'ZAPATOS PUNTA DE ACERO', 'par', 50, 60, ZAPATOS),
  ip('p4', 'material', 'ZAPATOS PUNTA DE ACERO', 'par', 40, 60, ZAPATOS),
  ip('p5', 'equipo', 'COMPRESORA NEUMATICA', 'hm', 20, 400, COMPRESORA),
  ip('p6', 'equipo', 'COMPRESORA NEUMATICA', 'hm', 15, 400, COMPRESORA),
  ip('p-larga', 'material', 'TUBERIA PVC UF S25 DE 8" x 6m', 'm', 400, 32, TUBERIA),
];

const args = { insumosPartida, partidas, hoy: '2026-05-01', anclaje: 'cero', reparto: 'parejo' };

describe('montoMinimoSugerido — medido contra la obra, no de oficio', () => {
  it('con suficientes propuestas, es 1,5× la mediana, redondeado a la centena', () => {
    // Medido con esta obra: 9 propuestas en la corrida mensual sin mínimo.
    expect(montoMinimoSugerido(args)).toBe(6600);
    expect(montoMinimoSugerido(args) % 100).toBe(0);
  });

  it('con pocas propuestas (menos de 4) no hay mediana que signifique algo: 0', () => {
    const chica = {
      insumosPartida: [ip('p1', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 100, 30, CEMENTO)],
      partidas: [P1], hoy: '2026-05-01', anclaje: 'cero',
    };
    expect(montoMinimoSugerido(chica)).toBe(0);
  });

  it('nunca hereda reparto «cuadrilla» ni «manual»: mediría casi nada', () => {
    // Sin dotación de cuadrilla ni reparto manual fijado, esas dos estrategias
    // no tienen con qué contestar (tanda 1) — heredarlas mediría sobre una
    // corrida vacía. El mínimo tiene que salir igual que con 'parejo'.
    expect(montoMinimoSugerido({ ...args, reparto: 'cuadrilla' })).toBe(montoMinimoSugerido(args));
    expect(montoMinimoSugerido({ ...args, reparto: 'manual' })).toBe(montoMinimoSugerido(args));
  });
});

describe('sortearEnfoques', () => {
  const out = sortearEnfoques(args);

  it('devuelve los tres enfoques, en el orden fijo', () => {
    expect(out.map(c => c.id)).toEqual(ENFOQUES_SORTEO);
    expect(ENFOQUES_SORTEO).toEqual(['caja_ajustada', 'cero_desabastecimiento', 'pocas_ordenes']);
    for (const c of out) {
      expect(c.nombre).toBe(ENFOQUE_LABEL[c.id]);
      expect(c.icono).toBe(ENFOQUE_ICONO[c.id]);
      expect(c.resumenTexto).toBe(ENFOQUE_RESUMEN[c.id]);
    }
  });

  it('cada corrida es la del motor REAL: nada de números inventados', () => {
    // Los mismos que corrida directa contra simulador-ordenes con esos params.
    const caja = out.find(c => c.id === 'caja_ajustada');
    expect(caja.corrida.propuestas.length).toBe(9);
    expect(caja.corrida.resumen.cobertura).toBe(1);
    const cero = out.find(c => c.id === 'cero_desabastecimiento');
    expect(cero.corrida.propuestas.length).toBe(7);
    const pocas = out.find(c => c.id === 'pocas_ordenes');
    expect(pocas.corrida.propuestas.length).toBe(4);
  });

  it('el colchón NUNCA aparece entre las perillas que un enfoque toca (CLAUDE.md §8)', () => {
    for (const c of out) {
      expect(Object.keys(c.overrides)).not.toContain('colchonPct');
      expect(Object.keys(c.overrides).sort()).toEqual(['anticipacionDias', 'frecuencia', 'montoMinimoOrden', 'reparto']);
    }
  });

  it('caja_ajustada: sin anticipación, sin monto mínimo, mensual', () => {
    const caja = out.find(c => c.id === 'caja_ajustada');
    expect(caja.overrides).toEqual({ reparto: 'parejo', anticipacionDias: 0, frecuencia: 'mensual', montoMinimoOrden: 0 });
  });

  it('cero_desabastecimiento: todo el tramo largo al inicio + 15 días de anticipación', () => {
    const cero = out.find(c => c.id === 'cero_desabastecimiento');
    expect(cero.overrides).toEqual({ reparto: 'inicio', anticipacionDias: 15, frecuencia: 'mensual', montoMinimoOrden: 0 });
  });

  it('pocas_ordenes: trimestral + el mínimo medido de esta obra (no un valor fijo)', () => {
    const pocas = out.find(c => c.id === 'pocas_ordenes');
    expect(pocas.overrides).toEqual({ reparto: 'parejo', anticipacionDias: 0, frecuencia: 'trimestral', montoMinimoOrden: 6600 });
  });

  it('MENOS órdenes que el resto: es su razón de ser', () => {
    const [caja, cero, pocas] = out;
    expect(pocas.corrida.propuestas.length).toBeLessThan(cero.corrida.propuestas.length);
    expect(cero.corrida.propuestas.length).toBeLessThan(caja.corrida.propuestas.length);
  });

  it('nunca elige reparto «cuadrilla» ni «manual» aunque la base sea esa', () => {
    for (const c of sortearEnfoques({ ...args, reparto: 'cuadrilla' })) {
      expect(['parejo', 'inicio']).toContain(c.params.reparto);
    }
    for (const c of sortearEnfoques({ ...args, reparto: 'manual' })) {
      expect(['parejo', 'inicio']).toContain(c.params.reparto);
    }
  });

  it('respeta el anclaje, el cronograma, las categorías y frecuenciaPorRubro de la base', () => {
    const base = {
      ...args, anclaje: 'restante', cronograma: 'sin_cronograma',
      categorias: ['materiales'], frecuenciaPorRubro: { seguridad: 'unica' },
    };
    for (const c of sortearEnfoques(base)) {
      expect(c.params.anclaje).toBe('restante');
      expect(c.params.cronograma).toBe('sin_cronograma');
      expect(c.params.categorias).toEqual(['materiales']);
      expect(c.params.frecuenciaPorRubro).toEqual({ seguridad: 'unica' });
    }
  });

  it('el porqué cita los números REALES de su propia corrida, no un texto genérico', () => {
    const caja = out.find(c => c.id === 'caja_ajustada');
    expect(caja.porQue).toContain('9 orden(es)');
    expect(caja.porQue).toContain('100%');
    const pocas = out.find(c => c.id === 'pocas_ordenes');
    expect(pocas.porQue).toContain('4 orden(es)');
    expect(pocas.porQue).toContain('6,600');
  });

  it('si el mínimo medido da 0, el porqué lo dice en vez de fingir un umbral', () => {
    const chica = sortearEnfoques({
      insumosPartida: [ip('p1', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 100, 30, CEMENTO)],
      partidas: [P1], hoy: '2026-05-01', anclaje: 'cero',
    });
    const pocas = chica.find(c => c.id === 'pocas_ordenes');
    expect(pocas.overrides.montoMinimoOrden).toBe(0);
    expect(pocas.porQue).toMatch(/no tiene suficientes órdenes chicas/);
  });
});
