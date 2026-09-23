// ═══════════════════════════════════════════════════════════════════
// Clasificar el presupuesto: la lista que Gabriel se sienta a corregir.
//
// Lo que estos tests protegen no es el cálculo (es una suma), sino las tres
// decisiones de producto que hacen que la lista se pueda TERMINAR:
//
//   1. una fila por NOMBRE, no por línea — 6.722 líneas de Miraflores son 432
//      decisiones, no 6.722;
//   2. ordenada por PLATA, para que abandonar a la mitad siga sirviendo;
//   3. lo que alguien ya decidió a mano se marca y sale del «por revisar»,
//      porque si no la lista nunca baja de tamaño.
//
// Los nombres son los reales del expediente, leídos de producción el
// 22-set-2026. Un test con «MATERIAL A» no prueba nada de un clasificador.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  resumirInsumosDePresupuesto, resumenDeClasificacion, filtrarClasificacion,
} from '../clasificacion-presupuesto.js';

const fila = (partida_id, nombre, unidad, tipo, cantidad, precio) => ({
  obra_id: 'o1', partida_id, nombre_insumo: nombre, unidad, tipo_insumo: tipo,
  cantidad_presupuestada: cantidad, precio_presupuestado: precio,
});

// Un pedazo real del presupuesto de Miraflores.
const PRESUPUESTO = [
  fila('p1', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 'material', 100, 30),
  fila('p2', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 'material', 200, 30),  // mismo nombre, otra partida
  fila('p1', 'ARENA GRUESA', 'm³', 'material', 20, 60),
  fila('p3', 'SEÑAL INFORMATIVA DE MADERA (INCLUYE POSTE DE MADERA)', 'und', 'material', 5, 210),
  fila('p3', 'MALLA CERCADORA NARANJA', 'rll', 'material', 10, 300),
  fila('p4', 'MONITOREO DE CALIDAD DE AGUA', 'und', 'material', 4, 1500),
  fila('p4', 'EXAMENES MÉDICOS PREOCUPACIONALES', 'und', 'material', 30, 250),
  fila('p5', 'XKCD ZZZQQ 9999', 'und', 'material', 1, 80),          // nadie lo reconoce
  fila('p5', '   ', 'und', 'material', 1, 10),                       // fila basura: se descarta
];

describe('una fila por NOMBRE, no por línea', () => {
  it('el mismo insumo en dos partidas es UNA decisión, con las dos partidas sumadas', () => {
    const filas = resumirInsumosDePresupuesto(PRESUPUESTO);
    const cemento = filas.find(f => f.nombre.startsWith('CEMENTO'));
    expect(cemento.lineas).toBe(2);
    expect(cemento.nPartidas).toBe(2);
    expect(cemento.monto).toBe(9000);   // 100×30 + 200×30
  });

  it('una fila sin nombre no entra: no se puede clasificar la nada', () => {
    const filas = resumirInsumosDePresupuesto(PRESUPUESTO);
    expect(filas.every(f => f.nombre.trim())).toBe(true);
    // 9 filas crudas: dos son el mismo cemento y una no tiene nombre.
    expect(filas).toHaveLength(7);
  });

  it('sale ordenado por PLATA: abandonar a la mitad igual sirve', () => {
    const filas = resumirInsumosDePresupuesto(PRESUPUESTO);
    const montos = filas.map(f => f.monto);
    expect(montos).toEqual([...montos].sort((a, b) => b - a));
    expect(filas[0].nombre).toContain('CEMENTO');
  });
});

describe('cada fila dice qué es y con quién se compra', () => {
  it('trae la clasificación y el rubro de proveedor', () => {
    const filas = resumirInsumosDePresupuesto(PRESUPUESTO);
    const porNombre = (t) => filas.find(f => f.nombre.includes(t));

    expect(porNombre('CEMENTO').codigo).toBe('21');
    expect(porNombre('CEMENTO').rubro).toBe('concreto');
    expect(porNombre('ARENA').rubro).toBe('concreto');       // va con el cemento

    // Las dos que el nombre mandaba al lado equivocado (regla de desempate).
    expect(porNombre('SEÑAL INFORMATIVA').codigo).toBe('83');
    expect(porNombre('MALLA CERCADORA').codigo).toBe('83');
    expect(porNombre('SEÑAL INFORMATIVA').rubro).toBe('seguridad');

    // Y los dos que el S10 llamaba «material» y son servicios de otro rubro.
    expect(porNombre('MONITOREO').rubro).toBe('ambiental');
    expect(porNombre('EXAMENES').rubro).toBe('salud');
  });

  it('lo que no reconoce lo DICE, no se inventa un código', () => {
    const filas = resumirInsumosDePresupuesto(PRESUPUESTO);
    const raro = filas.find(f => f.nombre.startsWith('XKCD'));
    expect(raro.sinClasificar).toBe(true);
    expect(raro.codigo).toBe('sin_clasificar');
    expect(raro.rubro).toBe('sin_clasificar');
  });

  it('un término propio MANUAL manda, y la fila queda marcada como decidida', () => {
    // Es la corrección deliberada de la regla 8: le gana hasta al Anexo 2.
    const terminosCustom = [{ termino: 'ARENA GRUESA', clasificacion_codigo: '83', origen: 'manual' }];
    const filas = resumirInsumosDePresupuesto(PRESUPUESTO, { terminosCustom });
    const arena = filas.find(f => f.nombre === 'ARENA GRUESA');
    expect(arena.codigo).toBe('83');
    expect(arena.decidido).toBe(true);
  });

  it('un término PROVISIONAL no alcanza para pisar la norma', () => {
    // Los que deja una decisión de la bandeja o la IA entran después de la
    // ley. Si la pantalla guardara así, el cambio no se vería — por eso
    // escribe `origen:'manual'`.
    const terminosCustom = [{ termino: 'ARENA GRUESA', clasificacion_codigo: '83', origen: 'decision' }];
    const filas = resumirInsumosDePresupuesto(PRESUPUESTO, { terminosCustom });
    expect(filas.find(f => f.nombre === 'ARENA GRUESA').decidido).toBe(false);
  });
});

describe('el resumen dice si vale la pena sentarse', () => {
  it('cuenta lo que falta y CUÁNTA PLATA hay ahí', () => {
    const filas = resumirInsumosDePresupuesto(PRESUPUESTO);
    const r = resumenDeClasificacion(filas);
    expect(r.total).toBe(7);
    expect(r.sinClasificar).toBe(1);
    expect(r.montoSinClasificar).toBe(80);
    expect(r.rubros).toBeGreaterThan(3);
  });

  it('lo ya decidido sale del «por revisar»: si no, la lista nunca baja', () => {
    const terminosCustom = [{ termino: 'XKCD ZZZQQ 9999', clasificacion_codigo: '37', origen: 'manual' }];
    const antes = resumenDeClasificacion(resumirInsumosDePresupuesto(PRESUPUESTO));
    const despues = resumenDeClasificacion(resumirInsumosDePresupuesto(PRESUPUESTO, { terminosCustom }));
    expect(despues.sinClasificar).toBe(antes.sinClasificar - 1);
    expect(despues.porRevisar).toBeLessThan(antes.porRevisar);
    expect(despues.decididas).toBe(1);
  });
});

describe('los filtros de la pantalla', () => {
  const filas = resumirInsumosDePresupuesto(PRESUPUESTO);

  it('«sin clasificar» deja solo lo que el motor no reconoció', () => {
    const out = filtrarClasificacion(filas, { filtro: 'sin' });
    expect(out).toHaveLength(1);
    expect(out[0].nombre).toContain('XKCD');
  });

  it('«por revisar» no muestra lo que ya está resuelto con confianza alta', () => {
    const out = filtrarClasificacion(filas, { filtro: 'dudosas' });
    expect(out.every(f => f.sinClasificar || f.banda !== 'alta')).toBe(true);
  });

  it('la búsqueda mira el nombre Y la clasificación', () => {
    expect(filtrarClasificacion(filas, { busca: 'cemento' })).toHaveLength(1);
    // Por el nombre de la clasificación, aunque el insumo no diga «seguridad».
    const porClasificacion = filtrarClasificacion(filas, { busca: 'seguridad' });
    expect(porClasificacion.map(f => f.nombre).sort()).toEqual([
      'MALLA CERCADORA NARANJA', 'SEÑAL INFORMATIVA DE MADERA (INCLUYE POSTE DE MADERA)',
    ]);
  });
});
