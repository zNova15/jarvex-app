import { describe, it, expect } from 'vitest';
import {
  sugerirUnidadCompra, normalizarCompra, resolverCompra, cantidadesDeCompra,
  KG_POR_METRO_VARILLA, LARGO_VARILLA_M,
} from '../simulador-compra.js';

// Los nombres son los REALES del presupuesto de Miraflores (medido el
// 24-set-2026, obra 984bacda…): el expediente dice la presentación en el
// nombre, y eso es lo único que se lee. Donde no la dice, no se inventa.

describe('la presentación de compra sale del NOMBRE del insumo', () => {
  it('tubería con largo en el nombre → tubo de ese largo', () => {
    const casos = [
      ['TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', 6],
      ['TUBERIA PVC SP C-7.5 DE 2" x 5 m NTP 399.002', 5],
      ['TUBERIA PVC SP C-10 DE 1" X 5 m NTP 399.002', 5],
      ['TUBERIA PVC SAL 2" x 3 m NTP 399.003', 3],
      ['TUBO DE FIERRO GALVANIZADO 1" X 6m', 6],
      ['TUBERIA PVC SP C-7.5 DE 2 1/2" x 5m NTP 399.002', 5],
    ];
    for (const [nombre, largo] of casos) {
      const s = sugerirUnidadCompra(nombre, 'm');
      expect(s, nombre).not.toBeNull();
      expect(s.factor).toBe(largo);
      expect(s.unidadCompra).toBe(`tubo de ${largo} m`);
    }
  });

  it('sin largo en el nombre, la tubería se queda en metros', () => {
    // «TUBERIA HDPE SDR 11 PE 4710 DE 4"» son S/ 352.280 y viene en rollo o
    // en tiras según el diámetro: el nombre no lo dice y no se adivina.
    expect(sugerirUnidadCompra('TUBERIA HDPE SDR 11 PE 4710 DE 4"', 'm')).toBeNull();
    expect(sugerirUnidadCompra('TUBERIA DE FIERRO GALVANIZADO 1 1/2"', 'm')).toBeNull();
  });

  it('lo que no es tubo no se lee como tubo aunque traiga una medida', () => {
    // «x0.70m» es el largo de un soporte; «x2mm» es un espesor.
    expect(sugerirUnidadCompra('SOPORTE METÁLICO ACERO INOXIDABLE 1"x1"x0.70m', 'm')).toBeNull();
    expect(sugerirUnidadCompra('TUBO RECTANGULAR NEGRO 75x50x2mm', 'm')).toBeNull();
    expect(sugerirUnidadCompra('ANGULO DE ACERO DE 1 1/4"X1 1/4"3/16" m', 'm')).toBeNull();
  });

  it('el largo solo vale en la unidad metro', () => {
    expect(sugerirUnidadCompra('TUBERIA PVC SP C-10 DE 1" X 5 m NTP 399.002', 'und')).toBeNull();
  });

  it('madera con escuadría → pieza, en pies tablares', () => {
    const s = sugerirUnidadCompra('MADERA TORNILLO 1"x 8"x8\'', 'p²');
    expect(s.factor).toBe(5.3333);           // 1 × 8 × 8 / 12
    expect(s.unidadCompra).toBe('pieza de 1"x8"x8\'');
    expect(sugerirUnidadCompra('MADERA TORNILLO 2"x 3"x8\'', 'p²').factor).toBe(4);
  });

  it('madera sin escuadría se queda en pies²', () => {
    // S/ 478.654 de Miraflores: la mayor línea de madera, sin medidas.
    expect(sugerirUnidadCompra('MADERA TORNILLO PARA ENCOFRADO', 'p²')).toBeNull();
  });

  it('varilla corrugada: solo con el diámetro, con el peso de la norma', () => {
    const s = sugerirUnidadCompra('ACERO CORRUGADO fy=4200 GRADO 60 DE 1/2"', 'kg');
    // Es el mismo 8,946 kg que ya usa Órdenes (ayuda de «ordenes»).
    expect(s.factor).toBe(8.946);
    expect(s.unidadCompra).toBe('varilla de 1/2" x 9 m');
    expect(sugerirUnidadCompra('ACERO CORRUGADO 3/8" GRADO 60', 'kg').factor).toBe(5.04);
    expect(sugerirUnidadCompra('FIERRO CORRUGADO 8mm', 'kg').factor).toBe(3.555);
    expect(LARGO_VARILLA_M).toBe(9);
    expect(KG_POR_METRO_VARILLA['1"']).toBe(3.973);
  });

  it('el acero del expediente de Miraflores NO trae diámetro: se queda en kg', () => {
    expect(sugerirUnidadCompra('ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60', 'kg')).toBeNull();
  });

  it('«1 3/8"» no se confunde con la de 3/8"', () => {
    expect(sugerirUnidadCompra('ACERO CORRUGADO 1 3/8" GRADO 60', 'kg')).toBeNull();
  });

  it('el alambre y los clavos van por kilo: no son varilla', () => {
    expect(sugerirUnidadCompra('ALAMBRE NEGRO RECOCIDO N° 8', 'kg')).toBeNull();
    expect(sugerirUnidadCompra('CLAVOS PARA MADERA CON CABEZA DE 3"', 'kg')).toBeNull();
  });
});

describe('lo fijado a mano', () => {
  it('normalizar descarta lo inválido y nunca tira', () => {
    expect(normalizarCompra(null)).toEqual({});
    expect(normalizarCompra('x')).toEqual({});
    expect(normalizarCompra({ factor: 0, lote: -1, colchonPct: 'abc' })).toEqual({});
    expect(normalizarCompra({ factor: 6, unidadCompra: ' tubo ', lote: 2, colchonPct: 5 }))
      .toEqual({ factor: 6, unidadCompra: 'tubo', lote: 2, colchonPct: 5 });
  });

  it('una unidad sin factor no se guarda: no dice cuánto cubre', () => {
    expect(normalizarCompra({ unidadCompra: 'tubo' })).toEqual({});
  });

  it('el colchón se topa en 100%', () => {
    expect(normalizarCompra({ colchonPct: 250 }).colchonPct).toBe(100);
  });

  it('manual gana sobre el nombre, el nombre sobre el expediente', () => {
    const tubo = { nombre: 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', unidad: 'm' };
    expect(resolverCompra(null, tubo)).toMatchObject({ factor: 6, origen: 'nombre', lote: 1, colchonPct: 0 });
    expect(resolverCompra({ factor: 5, unidadCompra: 'tubo de 5 m' }, tubo))
      .toMatchObject({ factor: 5, unidadCompra: 'tubo de 5 m', origen: 'manual' });
    // «Pedir en metros» es una decisión explícita, no la ausencia de una.
    expect(resolverCompra({ factor: 1, unidadCompra: 'm' }, tubo))
      .toMatchObject({ factor: 1, unidadCompra: 'm', origen: 'manual' });
    expect(resolverCompra(null, { nombre: 'ARENA GRUESA', unidad: 'm³' }))
      .toMatchObject({ factor: 1, unidadCompra: 'm³', origen: 'expediente' });
  });

  it('el colchón es 0% salvo que alguien lo ponga (decisión de Gabriel)', () => {
    for (const nombre of ['CEMENTO PORTLAND TIPO I (42.5 kg)', 'ARENA GRUESA', 'PIEDRA CHANCADA 1/2"']) {
      expect(resolverCompra(null, { nombre, unidad: 'bol' }).colchonPct).toBe(0);
    }
    // Poner solo colchón no toca la unidad que dice el nombre.
    const r = resolverCompra({ colchonPct: 3 }, { nombre: 'TUBERIA PVC SAL 2" x 3 m NTP 399.003', unidad: 'm' });
    expect(r).toMatchObject({ colchonPct: 3, factor: 3, origen: 'nombre' });
  });
});

describe('redondeo ACUMULADO, no por período', () => {
  it('el caso del plan: 3,37 bolsas por mes no se piden como 4 + 4 + 4', () => {
    const r = cantidadesDeCompra([3.37, 3.37, 3.37]);
    expect(r.map(x => x.cantidad)).toEqual([4, 3, 4]);
    // 11 bolsas para 10,11 necesarias: nunca más de una de sobra.
    expect(r.reduce((s, x) => s + x.cantidad, 0)).toBe(11);
  });

  it('un mes que no llega al lote se junta con el anterior', () => {
    // 0,39 m³ de arena por mes: nadie pide 0,39 m³.
    const r = cantidadesDeCompra([0.39, 0.39, 0.39, 0.39]);
    expect(r.map(x => x.cantidad)).toEqual([1, 0, 1, 0]);
    expect(r[0].alcanzaHasta).toBe(1);   // lo del primer mes alcanza el segundo
    expect(r[2].alcanzaHasta).toBe(3);
  });

  it('el ruido de coma flotante no agrega una unidad', () => {
    // 16 unidades repartidas parejo en 3 meses suman 15,999999… o
    // 16,000000…1; sin tolerancia eso pedía 17 (medido: MONITOREO DE
    // CALIDAD DE AGUA, S/ 1.500 de más).
    const tercio = 16 / 3;
    const r = cantidadesDeCompra([tercio, tercio, tercio]);
    expect(r.reduce((s, x) => s + x.cantidad, 0)).toBe(16);
  });

  it('con factor: los metros se piden en tubos', () => {
    // 1.000 m por mes en tubos de 6 m: 166,67 por mes → 167 + 167 + 166.
    const r = cantidadesDeCompra([1000, 1000, 1000], { factor: 6 });
    expect(r.map(x => x.cantidad)).toEqual([167, 167, 166]);
  });

  it('con lote: de a 5, y el total no se pasa en más de un lote', () => {
    const r = cantidadesDeCompra([2, 2, 2, 2], { lote: 5 });
    expect(r.map(x => x.cantidad)).toEqual([5, 0, 5, 0]);
    expect(r.reduce((s, x) => s + x.cantidad, 0) - 8).toBeLessThan(5);
  });

  it('un lote con decimales (medio m³) también funciona', () => {
    // 0,3 → 0,5 · 0,6 → 1,0 · 0,9 → ya cubierto por el 1,0.
    const r = cantidadesDeCompra([0.3, 0.3, 0.3], { lote: 0.5 });
    expect(r.map(x => x.cantidad)).toEqual([0.5, 0.5, 0]);
  });

  it('una necesidad exacta no se toca', () => {
    expect(cantidadesDeCompra([120, 80]).map(x => x.cantidad)).toEqual([120, 80]);
  });

  it('una necesidad negativa o basura se trata como cero', () => {
    expect(cantidadesDeCompra([-3, 'x', 2]).map(x => x.cantidad)).toEqual([0, 0, 2]);
  });
});
