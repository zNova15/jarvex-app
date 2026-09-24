import { describe, it, expect } from 'vitest';
import {
  simularOrdenes, coberturaPrevia,
  periodoDe, periodosEntre, semanaISO, etiquetaPeriodo, sumarDias, diasEntre,
  ANCLAJES, CRONOGRAMAS, REPARTOS, UMBRAL_TRAMO_LARGO_DIAS,
} from '../simulador-ordenes.js';
import { clasificarInsumoDePresupuesto } from '../insumo-clasificador.js';

// ── LOS DATOS SON LOS REALES ──────────────────────────────────────
// Medidos contra producción el 22-set-2026 (Plan Miraflores,
// obra_id 984bacda-97ae-4744-bf5f-a8ab03f48d8d):
//
//   Plazo 30-abr-2026 → 30-dic-2026 · 1.718 partidas · 6.722 líneas
//   TUBERIA PVC UF S25 8"   · partida de 73 días · S/ 450.839  (tramo largo)
//   COMPRESORA NEUMATICA    · `hm`, S/ 366.759 en 9 partidas   (alquiler)
//   HERRAMIENTAS MANUALES   · `%mo`, 1.115 filas, S/ 132.493   (sobre)
//   ACARREO A MANO O ACEMILA· `glb`, partida de 239 días       (sobre servicio)
//   ZAPATOS PUNTA DE ACERO  · `par`, S/ 13.210                 (EPP)
//   PEON                    · `hh`, S/ 2.867.839               (nunca se compra)
const PLAZO = { inicio: '2026-04-30', fin: '2026-12-30' };

const CEMENTO = '210020001';
const TUBERIA = '020005001';

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

// Una partida corta (6 días, el promedio real) y una larga (73 días, la de
// la tubería PVC).
const P_CORTA = partida('p-corta', '2026-06-01', '2026-06-07');
const P_LARGA = partida('p-larga', '2026-06-01', '2026-08-13', 'SUM. Y COLOC. DE TUBERIA PVC UF ISO 4435 DN=8"');
const partidas = [P_CORTA, P_LARGA];

describe('períodos', () => {
  it('el mes sale por string, sin pasar por Date (nada de corrimiento UTC)', () => {
    expect(periodoDe('2026-07-01', 'mes')).toBe('2026-07');
    // El caso que rompía el Libro Diario: new Date('2026-01-01') en Perú da
    // el 31-dic del año anterior.
    expect(periodoDe('2026-01-01', 'mes')).toBe('2026-01');
  });

  it('la semana es ISO y respeta el año-semana', () => {
    expect(semanaISO('2026-01-01')).toBe('2026-W01');
    // 2026-12-28 es lunes de la W53 de 2026; 2026-12-31 cae en la misma.
    expect(semanaISO('2026-06-01')).toBe('2026-W23');
    expect(periodoDe('2026-06-03', 'semana')).toBe('2026-W23');
  });

  it('periodosEntre cubre el tramo completo en meses y en semanas', () => {
    expect(periodosEntre('2026-06-01', '2026-08-13', 'mes'))
      .toEqual(['2026-06', '2026-07', '2026-08']);
    expect(periodosEntre('2026-06-01', '2026-06-07', 'mes')).toEqual(['2026-06']);
    // 01-jun (lunes W23) a 07-jun (domingo W23) = una sola semana.
    expect(periodosEntre('2026-06-01', '2026-06-07', 'semana')).toEqual(['2026-W23']);
    expect(periodosEntre('2026-06-01', '2026-06-08', 'semana')).toEqual(['2026-W23', '2026-W24']);
  });

  it('un tramo invertido no bloquea: devuelve el período del inicio', () => {
    expect(periodosEntre('2026-08-01', '2026-06-01', 'mes')).toEqual(['2026-08']);
  });

  it('cruza el año sin perder meses', () => {
    expect(periodosEntre('2026-11-15', '2027-01-10', 'mes'))
      .toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('sumarDias y diasEntre no tocan la zona local', () => {
    expect(sumarDias('2026-02-28', 1)).toBe('2026-03-01');   // 2026 no es bisiesto
    expect(sumarDias('2026-06-01', -15)).toBe('2026-05-17');
    expect(diasEntre('2026-06-01', '2026-08-13')).toBe(73);
  });

  it('las etiquetas son las que lee Gabriel', () => {
    expect(etiquetaPeriodo('2026-10')).toBe('octubre 2026');
    expect(etiquetaPeriodo('2026-W41')).toBe('semana 41 de 2026');
  });
});

describe('clasificación de la línea de presupuesto (§4)', () => {
  it('`equipo` en `hm` es alquiler aunque el nombre diga compresora', () => {
    const r = clasificarInsumoDePresupuesto({
      tipo_insumo: 'equipo', unidad: 'hm',
      nombre_insumo: 'COMPRESORA NEUMATICA 250 - 330 PCM - 87 HP (inc. combust.)',
    });
    expect(r.categoria).toBe('servicios');
    expect(r.esSobre).toBe(false);
  });

  it('`equipo` en `par`/`und` que es EPP sale como EPP, no como alquiler', () => {
    expect(clasificarInsumoDePresupuesto({ tipo_insumo: 'equipo', unidad: 'par', nombre_insumo: 'ZAPATOS PUNTA DE ACERO' }).subcategoria).toBe('epp');
    expect(clasificarInsumoDePresupuesto({ tipo_insumo: 'equipo', unidad: 'und', nombre_insumo: 'LENTES DE SEGURIDAD' }).subcategoria).toBe('epp');
  });

  it('un `equipo` que la regex no reconoce NO puede terminar en material', () => {
    const r = clasificarInsumoDePresupuesto({ tipo_insumo: 'equipo', unidad: 'und', nombre_insumo: 'ESCALERA TELESCOPICA DE 10m' });
    expect(r.subcategoria).toBe('herramienta');
  });

  it('`%mo` y `glb` son sobres, y el sobre es un eje aparte de la categoría', () => {
    const herr = clasificarInsumoDePresupuesto({ tipo_insumo: 'equipo', unidad: '%mo', nombre_insumo: 'HERRAMIENTAS MANUALES' });
    expect(herr.esSobre).toBe(true);
    expect(herr.categoria).toBe('herramientas');

    const flete = clasificarInsumoDePresupuesto({ tipo_insumo: 'material', unidad: 'glb', nombre_insumo: 'FLETE TERRESTRE SANEAMIENTO PM YSC' });
    expect(flete.esSobre).toBe(true);
    expect(flete.categoria).toBe('servicios');

    const tijeral = clasificarInsumoDePresupuesto({ tipo_insumo: 'material', unidad: 'glb', nombre_insumo: 'SUMINISTRO DE TIJERAL METALICO DE L=29.00M DE TUB. A500' });
    expect(tijeral.esSobre).toBe(true);
    expect(tijeral.categoria).toBe('materiales');
  });

  it('`mes` también es un sobre: plata mensual reservada sin decir qué se compra (ronda 2)', () => {
    // Las tres líneas reales de Miraflores (S/ 30.800), todas `material`.
    for (const nombre of ['GASTOS OPERATIVOS', 'MATERIAL PARA CAPACITACIÓN A PERSONAL', 'TRANSPORTE DE RESIDUOS DE OBRA DURANTE LA EJECUCIÓN']) {
      expect(clasificarInsumoDePresupuesto({ tipo_insumo: 'material', unidad: 'mes', nombre_insumo: nombre }).esSobre).toBe(true);
    }
    expect(clasificarInsumoDePresupuesto({ tipo_insumo: 'material', unidad: 'MES ', nombre_insumo: 'GASTOS OPERATIVOS' }).esSobre).toBe(true);
  });

  it('la mano de obra la decide la columna, no el nombre', () => {
    expect(clasificarInsumoDePresupuesto({ tipo_insumo: 'mano_obra', unidad: 'hh', nombre_insumo: 'PEON' }).categoria).toBe('mano_obra');
  });
});

describe('reparto por cronograma', () => {
  const insumos = [
    ip('p-corta', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 1000, 30, CEMENTO),
    ip('p-larga', 'material', 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', 'm', 3000, 150, TUBERIA),
  ];

  it('un tramo corto no se reparte: cae entero en el mes del inicio', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: [insumos[0]], partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    expect(propuestas).toHaveLength(1);
    expect(propuestas[0].periodo).toBe('2026-06');
    expect(propuestas[0].lineas[0].cantidad).toBe(1000);
  });

  it('un tramo largo con «parejo» se parte en los meses que toca', () => {
    const { propuestas, resumen } = simularOrdenes({
      insumosPartida: [insumos[1]], partidas, hoy: '2026-05-01', anclaje: 'cero', reparto: 'parejo',
    });
    expect(propuestas.map(p => p.periodo)).toEqual(['2026-06', '2026-07', '2026-08']);
    // 1.000 m por mes, pedidos en tubos de 6 m (lo dice el nombre, tanda
    // 2.2): 166,67 tubos por mes redondeados ACUMULADO dan 167 + 167 + 166 =
    // 500 tubos = los 3.000 m exactos.
    expect(propuestas.map(p => p.lineas[0].necesidad)).toEqual([1000, 1000, 1000]);
    expect(propuestas.map(p => p.lineas[0].cantidad)).toEqual([167, 167, 166]);
    expect(propuestas[0].lineas[0].unidad).toBe('tubo de 6 m');
    // La plata total no cambia por repartirla.
    expect(resumen.montoPropuesto).toBe(450000);
    expect(resumen.lineasTramoLargo).toBe(1);
  });

  it('«todo al inicio» pone los S/ 450.000 en un solo mes', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: [insumos[1]], partidas, hoy: '2026-05-01', anclaje: 'cero', reparto: 'inicio',
    });
    expect(propuestas).toHaveLength(1);
    expect(propuestas[0].periodo).toBe('2026-06');
    expect(propuestas[0].monto).toBe(450000);
  });

  it('la reprogramación manual pisa el Gantt, y lo no movido cae de vuelta al Gantt', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'cero',
      cronograma: 'reprogramado', reparto: 'inicio',
      reprogramacion: { 'p-larga': { inicio: '2026-09-01', fin: '2026-11-15' } },
    });
    const tuberia = propuestas.find(p => p.lineas.some(l => l.insumo_codigo === TUBERIA));
    expect(tuberia.periodo).toBe('2026-09');
    const cemento = propuestas.find(p => p.lineas.some(l => l.insumo_codigo === CEMENTO));
    expect(cemento.periodo).toBe('2026-06');      // no se movió: sigue el Gantt
  });

  it('«sin cronograma» ignora las partidas y reparte parejo en el plazo', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: [insumos[0]], partidas, hoy: '2026-05-01', anclaje: 'cero',
      cronograma: 'sin_cronograma', plazo: PLAZO, reparto: 'parejo',
    });
    // 30-abr a 30-dic = 9 meses.
    expect(propuestas).toHaveLength(9);
    expect(propuestas[0].periodo).toBe('2026-04');
    expect(propuestas[8].periodo).toBe('2026-12');
  });

  it('«sin cronograma» sin plazo no inventa nada: va a pendientes', () => {
    const { propuestas, pendientes } = simularOrdenes({
      insumosPartida: [insumos[0]], partidas, hoy: '2026-05-01',
      cronograma: 'sin_cronograma', plazo: null,
    });
    expect(propuestas).toHaveLength(0);
    expect(pendientes[0].motivo).toBe('sin_plazo');
    expect(pendientes[0].monto).toBe(30000);
  });

  it('la anticipación adelanta el pedido al mes anterior', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: [insumos[0]], partidas, hoy: '2026-04-01', anclaje: 'cero',
      anticipacionDias: 15,
    });
    expect(propuestas[0].periodo).toBe('2026-05');   // 01-jun − 15 días
  });

  it('en semanas parte el tramo largo semana a semana', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: [insumos[1]], partidas, hoy: '2026-05-01', anclaje: 'cero',
      granularidad: 'semana', reparto: 'parejo',
    });
    expect(propuestas[0].periodo).toBe('2026-W23');
    expect(propuestas).toHaveLength(11);            // 01-jun → 13-ago
    expect(propuestas.reduce((s, p) => s + p.monto, 0)).toBeCloseTo(450000, 1);
  });
});

describe('estrategias que pueden no tener con qué contestar (§3.3)', () => {
  const tuberia = ip('p-larga', 'material', 'TUBERIA PVC UF S25 DE 8"', 'm', 3000, 150, TUBERIA);

  it('«por cuadrilla» sin la dotación cargada NO cae a parejo: va a pendientes', () => {
    const { propuestas, pendientes } = simularOrdenes({
      insumosPartida: [tuberia], partidas, hoy: '2026-05-01', anclaje: 'cero',
      reparto: 'cuadrilla', cuadrillas: [],
    });
    expect(propuestas).toHaveLength(0);
    expect(pendientes[0].motivo).toBe('falta_cuadrillas');
  });

  it('«por cuadrilla» reparte proporcional a la gente que entra', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: [tuberia], partidas, hoy: '2026-05-01', anclaje: 'cero',
      reparto: 'cuadrilla',
      cuadrillas: [
        { fecha: '2026-06-10', personas: 10 },
        { fecha: '2026-07-10', personas: 30 },
      ],
    });
    const porPeriodo = Object.fromEntries(propuestas.map(p => [p.periodo, p.lineas[0].cantidad]));
    expect(porPeriodo['2026-06']).toBe(750);        // 10/40
    expect(porPeriodo['2026-07']).toBe(2250);       // 30/40
  });

  it('una cuadrilla anterior al tramo se recorta al inicio, no se pierde', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: [tuberia], partidas, hoy: '2026-05-01', anclaje: 'cero',
      reparto: 'cuadrilla', cuadrillas: [{ fecha: '2026-03-01', personas: 5 }],
    });
    expect(propuestas).toHaveLength(1);
    expect(propuestas[0].periodo).toBe('2026-06');
    expect(propuestas[0].lineas[0].cantidad).toBe(3000);
  });

  it('«manual» sin reparto fijado va a pendientes; con reparto, lo respeta', () => {
    const sin = simularOrdenes({
      insumosPartida: [tuberia], partidas, hoy: '2026-05-01', anclaje: 'cero', reparto: 'manual',
    });
    expect(sin.pendientes[0].motivo).toBe('falta_reparto_manual');

    const con = simularOrdenes({
      insumosPartida: [tuberia], partidas, hoy: '2026-05-01', anclaje: 'cero', reparto: 'manual',
      repartoManual: { 'p-larga': { '2026-06': 1, '2026-08': 3 } },
    });
    const porPeriodo = Object.fromEntries(con.propuestas.map(p => [p.periodo, p.lineas[0].cantidad]));
    expect(porPeriodo['2026-06']).toBe(750);
    expect(porPeriodo['2026-08']).toBe(2250);
  });

  it('una partida sin fecha no se planifica con una fecha inventada', () => {
    const huerfana = ip('p-sin-fecha', 'material', 'ARENA GRUESA', 'm3', 50, 60, '050001');
    const { pendientes } = simularOrdenes({
      insumosPartida: [huerfana],
      partidas: [...partidas, partida('p-sin-fecha', null, null)],
      hoy: '2026-05-01',
    });
    expect(pendientes[0].motivo).toBe('sin_fecha');
  });
});

describe('anclaje (§3.1)', () => {
  // Una partida del arranque de la obra (30-abr, el plazo real), ya
  // vencida cuando se corre la simulación el 20-may.
  const P_VENCIDA = partida('p-vencida', '2026-04-30', '2026-05-06');
  const insumos = [
    ip('p-vencida', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 400, 30, CEMENTO),
    ip('p-corta', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 1000, 30, CEMENTO),
  ];
  const conVencida = [...partidas, P_VENCIDA];

  it('«hoy» arrastra lo vencido al período actual, no lo borra', () => {
    const { propuestas, resumen } = simularOrdenes({
      insumosPartida: insumos, partidas: conVencida, hoy: '2026-05-20', anclaje: 'hoy',
    });
    const mayo = propuestas.find(p => p.periodo === '2026-05');
    expect(mayo.lineas[0].cantidad).toBe(400);
    expect(mayo.lineas[0].arrastrado).toBe(true);
    expect(resumen.montoArrastrado).toBe(12000);
    // Nada se perdió: mayo + junio = el presupuesto entero.
    expect(resumen.montoPropuesto).toBe(42000);
  });

  it('«restante» descarta lo vencido y DICE cuánto descartó', () => {
    const { propuestas, resumen } = simularOrdenes({
      insumosPartida: insumos, partidas: conVencida, hoy: '2026-05-20', anclaje: 'restante',
    });
    expect(propuestas.map(p => p.periodo)).toEqual(['2026-06']);
    expect(resumen.montoOmitidoPorPasado).toBe(12000);
    expect(resumen.montoPropuesto).toBe(30000);
  });

  it('«cero» reconstruye desde el expediente, sin arrastrar ni omitir', () => {
    const { propuestas, resumen } = simularOrdenes({
      insumosPartida: insumos, partidas: conVencida, hoy: '2026-05-20', anclaje: 'cero',
    });
    expect(propuestas.map(p => p.periodo)).toEqual(['2026-04', '2026-06']);
    expect(resumen.montoArrastrado).toBe(0);
    expect(resumen.montoOmitidoPorPasado).toBe(0);
  });
});

describe('nada se pide dos veces (§7)', () => {
  const insumos = [
    ip('p-corta', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 1000, 30, CEMENTO),
    ip('p-larga', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 600, 30, CEMENTO),
  ];

  it('lo ya comprado se descuenta de los períodos más viejos primero', () => {
    const { propuestas, resumen } = simularOrdenes({
      insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'restante',
      reparto: 'inicio',
      yaComprado: { [CEMENTO]: 1200 },
    });
    // 1.600 pedidas − 1.200 compradas = 400, y junio (1.000) se cubre entero.
    const total = propuestas.reduce((s, p) => s + p.lineas.reduce((t, l) => t + l.cantidad, 0), 0);
    expect(total).toBe(400);
    expect(resumen.descontado.cantidad).toBe(1200);
    expect(resumen.descontado.monto).toBe(36000);
  });

  it('una orden viva reserva; una anulada libera', () => {
    const base = { insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'restante', reparto: 'inicio' };
    const viva = simularOrdenes({
      ...base,
      ordenes: [{ id: 'oc1', estado: 'emitida' }],
      ocItems: [{ id: 'i1', orden_compra_id: 'oc1', insumo_codigo: CEMENTO, cantidad: 500 }],
    });
    expect(viva.resumen.descontado.cantidad).toBe(500);

    const anulada = simularOrdenes({
      ...base,
      ordenes: [{ id: 'oc1', estado: 'anulada' }],
      ocItems: [{ id: 'i1', orden_compra_id: 'oc1', insumo_codigo: CEMENTO, cantidad: 500 }],
    });
    expect(anulada.resumen.descontado.cantidad).toBe(0);
  });

  it('EL CASO REAL: las 62 líneas sin insumo_codigo NO se asumen en cero', () => {
    // Las 14 órdenes emitidas de Miraflores son retroactivas y ninguna de
    // sus 62 líneas tiene código. Descontar 0 en silencio diría «no hay
    // nada pedido» y la pantalla invitaría a pedirlo todo otra vez.
    const ocItems = Array.from({ length: 62 }, (_, i) => ({
      id: `i${i}`, orden_compra_id: 'oc1', insumo_codigo: null,
      cantidad: 10, precio_unitario: 100, subtotal: 1000,
    }));
    const { resumen } = simularOrdenes({
      insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'restante',
      ordenes: [{ id: 'oc1', estado: 'emitida' }], ocItems,
    });
    expect(resumen.descontado.cantidad).toBe(0);
    expect(resumen.ocSinImputar.lineas).toBe(62);
    expect(resumen.ocSinImputar.monto).toBe(62000);
  });

  it('el anclaje «cero» a propósito NO descuenta: es una auditoría', () => {
    const { resumen } = simularOrdenes({
      insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'cero',
      yaComprado: { [CEMENTO]: 1200 },
    });
    expect(resumen.descontado.cantidad).toBe(0);
    expect(resumen.montoPropuesto).toBe(48000);
  });

  it('con `yaComprado` en mano, la orden ya facturada no se resta dos veces', () => {
    const { resumen } = simularOrdenes({
      insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'restante',
      yaComprado: { [CEMENTO]: 500 },
      ordenes: [{ id: 'oc1', estado: 'emitida', accounting_movement_id: 'mov1' }],
      ocItems: [{ id: 'i1', orden_compra_id: 'oc1', insumo_codigo: CEMENTO, cantidad: 500 }],
    });
    expect(resumen.descontado.cantidad).toBe(500);
  });

  it('coberturaPrevia suma comprado + ordenado por código', () => {
    const { cubierto, sinImputar } = coberturaPrevia({
      yaComprado: new Map([[CEMENTO, 100]]),
      ordenes: [{ id: 'oc1', estado: 'emitida' }],
      ocItems: [
        { id: 'i1', orden_compra_id: 'oc1', insumo_codigo: CEMENTO, cantidad: 50 },
        { id: 'i2', orden_compra_id: 'oc1', insumo_codigo: null, cantidad: 9, subtotal: 900 },
      ],
    });
    expect(cubierto.get(CEMENTO)).toBe(150);
    expect(sinImputar).toEqual({ lineas: 1, monto: 900 });
  });
});

describe('sobres — partidas sin lista de insumos (§4.1)', () => {
  const sobreHerramientas = [
    ip('p-corta', 'equipo', 'HERRAMIENTAS MANUALES', '%mo', 1, 120),
    ip('p-larga', 'equipo', 'HERRAMIENTAS MANUALES', '%mo', 1, 380),
  ];

  it('un sobre no entra a una propuesta con cantidad: va por su carril', () => {
    const { propuestas, sobres, resumen } = simularOrdenes({
      insumosPartida: sobreHerramientas, partidas, hoy: '2026-05-01', anclaje: 'cero', reparto: 'parejo',
    });
    expect(propuestas).toHaveLength(0);
    expect(sobres).toHaveLength(1);
    expect(sobres[0].techo).toBe(500);
    expect(sobres[0].enPartidas).toBe(2);
    expect(sobres[0].partidaIds.sort()).toEqual(['p-corta', 'p-larga']);
    expect(sobres[0].descripcionLibre).toBe(true);
    expect(resumen.montoSobres).toBe(500);
  });

  it('el sobre se reparte por período igual que el resto', () => {
    const { sobres } = simularOrdenes({
      insumosPartida: sobreHerramientas, partidas, hoy: '2026-05-01', anclaje: 'cero', reparto: 'parejo',
    });
    const porPeriodo = Object.fromEntries(sobres[0].porPeriodo.map(p => [p.periodo, p.monto]));
    expect(porPeriodo['2026-06']).toBeCloseTo(120 + 380 / 3, 2);
    expect(porPeriodo['2026-07']).toBeCloseTo(380 / 3, 2);
    expect(porPeriodo['2026-08']).toBeCloseTo(380 / 3, 2);
  });

  it('sin consumo informado el disponible es null, NO el techo entero', () => {
    const { sobres, resumen } = simularOrdenes({
      insumosPartida: sobreHerramientas, partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    expect(sobres[0].consumido).toBeNull();
    expect(sobres[0].disponible).toBeNull();
    expect(sobres[0].consumoInformado).toBe(false);
    expect(resumen.consumoSobresInformado).toBe(false);
  });

  it('con el consumo informado queda el saldo del sobre', () => {
    const { sobres } = simularOrdenes({
      insumosPartida: sobreHerramientas, partidas, hoy: '2026-05-01', anclaje: 'cero',
      consumoSobres: { 'herramientas manuales|%mo': 180 },
    });
    expect(sobres[0].consumido).toBe(180);
    expect(sobres[0].disponible).toBe(320);
  });

  it('un sobre de servicio (FLETE `glb`) y uno de material (TIJERAL) se separan', () => {
    const { sobres } = simularOrdenes({
      insumosPartida: [
        ip('p-larga', 'material', 'FLETE TERRESTRE SANEAMIENTO PM YSC', 'glb', 1, 59742),
        ip('p-larga', 'material', 'SUMINISTRO DE TIJERAL METALICO DE L=29.00M', 'glb', 1, 39460),
      ],
      partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    expect(sobres.map(s => s.categoria)).toEqual(['servicios', 'materiales']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// QUÉ ES cada sobre (clasificación IUPC) — el pedido de Gabriel del 22-set:
// «de allí se sacan varios grupos que podríamos asignarle, por ejemplo, a un
// proveedor ferretero, otro a una librería».
//
// La subcategoría del simulador tiene CUATRO cajones y no alcanza para eso:
// el flete, el monitoreo ambiental y las publicaciones caen los tres en
// «servicios», y no se le compran al mismo proveedor. El IUPC los separa.
//
// Los doce nombres de acá abajo NO son inventados: son los doce sobres reales
// de la obra de Miraflores, leídos de producción el 22-set-2026. Un test con
// nombres de laboratorio («FLETE») no prueba nada — lo que rompe al
// clasificador es «FLETE TERRESTRE SANEAMIENTO PM YSC».
// ═══════════════════════════════════════════════════════════════════
describe('el sobre dice QUÉ ES, no solo en qué cajón cae', () => {
  const sobreReal = (nombre, unidad = 'glb', tipo = 'material') =>
    ip('p-larga', tipo, nombre, unidad, 1, 1000);

  const corridaDe = (nombres) => simularOrdenes({
    insumosPartida: nombres.map(n => (Array.isArray(n) ? sobreReal(...n) : sobreReal(n))),
    partidas, hoy: '2026-05-01', anclaje: 'cero',
  }).sobres;

  it('los tres fletes del expediente caen en el MISMO grupo', () => {
    // Son tres nombres distintos y un solo transportista.
    const sobres = corridaDe([
      'FLETE TERRESTRE SANEAMIENTO PM YSC',
      'FLETE TERRESTRE AGUA PM Y SC',
      'ACARREO DE MATERIAL A MANO O ACEMILA AGUA PC Y SC',
    ]);
    expect(sobres.map(s => s.iupc.codigo)).toEqual(['S03', 'S03', 'S03']);
    expect(sobres[0].iupc.etiqueta).toMatch(/Flete/i);
    expect(sobres[0].iupc.tipo).toBe('servicio');
  });

  it('la herramienta manual NO cae con los fletes: es la compra de la ferretería', () => {
    const [herramienta, flete] = corridaDe([
      ['HERRAMIENTAS MANUALES', '%mo', 'equipo'],
      'FLETE TERRESTRE AGUA PM Y SC',
    ]);
    expect(herramienta.iupc.codigo).toBe('37');
    expect(herramienta.iupc.tipo).toBe('herramienta');
    expect(flete.iupc.codigo).toBe('S03');
    // Las dos son «servicios»/«herramientas» para el simulador, pero lo que
    // importa acá es que NO comparten proveedor.
    expect(herramienta.iupc.codigo).not.toBe(flete.iupc.codigo);
  });

  it('las publicaciones salen separadas: ésa es la imprenta, no la ferretería', () => {
    const [pub] = corridaDe(['PUBLICACIONES']);
    expect(pub.iupc.codigo).toBe('S12');
    expect(pub.iupc.etiqueta).toMatch(/publicaciones/i);
    expect(pub.iupc.banda).toBe('alta');
  });

  it('cada uno de los 12 sobres reales sale con un código y una banda', () => {
    const REALES = [
      'ACARREO DE MATERIAL A MANO O ACEMILA AGUA PC Y SC',
      ['HERRAMIENTAS MANUALES', '%mo', 'equipo'],
      'ACARREO DE MATERIAL A MANO O ACEMILA SANEAMIENTO PM Y SC',
      'FLETE TERRESTRE SANEAMIENTO PM YSC',
      'SUMINISTRO DE TIJERAL METALICO DE L=29.00M DE TUB. A500',
      'FLETE TERRESTRE AGUA PM Y SC',
      'MOVILIDAD',
      ['MOVILIZACION Y DESMOVILIZACION DE EQUIPOS Y MAQUINARIA', 'glb', 'equipo'],
      'PRESENTACION Y APROBACION DEL PLAN DE MONITOREO AL M.C.',
      'INSTALACION DE DE ESTRUCTURA METALICA',
      'SUMINISTRO DE PLACA DE ANCLAJE DE ESTRUCTURA METALICA',
      'PUBLICACIONES',
    ];
    const sobres = corridaDe(REALES);
    expect(sobres).toHaveLength(12);
    for (const s of sobres) {
      expect(s.iupc.codigo, `sobre sin código: ${s.nombre}`).toBeTruthy();
      expect(s.iupc.etiqueta, `sobre sin etiqueta: ${s.nombre}`).toBeTruthy();
      expect(s.iupc.banda, `sobre sin banda: ${s.nombre}`).toBeTruthy();
      expect(s.iupc.score).toBeGreaterThan(0);
    }
    // Medido el 22-set-2026 contra producción: 9 de los 12 con banda alta.
    // Es un PISO, no una foto — si una mejora del diccionario sube el número,
    // el test no tiene por qué romperse; lo que no puede es bajar en silencio.
    const altas = sobres.filter(s => s.iupc.banda === 'alta').length;
    expect(altas).toBeGreaterThanOrEqual(9);
  });

  it('un nombre que nadie reconoce dice «sin clasificar», no un código plausible', () => {
    const [raro] = corridaDe(['XKCD ZZZQQ 9999']);
    expect(raro.iupc.codigo).toBe('sin_clasificar');
  });

  it('el diccionario propio le gana a la base oficial', () => {
    const nombre = 'FLETE TERRESTRE AGUA PM Y SC';
    const [base] = corridaDe([nombre]);
    expect(base.iupc.codigo).toBe('S03');

    // La misma corrida, con un término que Gabriel escribió en el Catálogo.
    const { sobres } = simularOrdenes({
      insumosPartida: [sobreReal(nombre)],
      partidas, hoy: '2026-05-01', anclaje: 'cero',
      terminosCustom: [{ termino: nombre, clasificacion_codigo: '37' }],
    });
    expect(sobres[0].iupc.codigo).toBe('37');
  });
});

describe('mano de obra: referencia, nunca una orden (§5)', () => {
  const insumos = [
    ip('p-corta', 'mano_obra', 'PEON', 'hh', 800, 20.07),
    ip('p-corta', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 100, 30, CEMENTO),
  ];

  it('las HH salen por `manoObra` y jamás por `propuestas`', () => {
    const { propuestas, manoObra, resumen } = simularOrdenes({
      insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    expect(propuestas.every(p => p.categoria !== 'mano_obra')).toBe(true);
    expect(manoObra).toHaveLength(1);
    expect(manoObra[0].cantidad).toBe(800);
    expect(manoObra[0].unidad).toBe('hh');
    expect(manoObra[0].esReferencia).toBe(true);
    expect(resumen.montoManoObra).toBe(16056);
  });

  it('la cobertura apunta al comprable, no al presupuesto total', () => {
    // §2 del plan: en Miraflores el 47% es planilla. Si la barra apuntara al
    // total nunca llegaría al 100% y se leería como un atraso que no existe.
    const { resumen } = simularOrdenes({
      insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    expect(resumen.montoPresupuesto).toBe(19056);
    expect(resumen.montoComprable).toBe(3000);
    expect(resumen.montoManoObra).toBe(16056);
    expect(resumen.cobertura).toBe(1);
  });
});

describe('filtro de categorías (§3.4)', () => {
  const insumos = [
    ip('p-corta', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 100, 30, CEMENTO),
    ip('p-corta', 'equipo', 'ZAPATOS PUNTA DE ACERO', 'par', 20, 85),
    ip('p-corta', 'equipo', 'COMPRESORA NEUMATICA 250 - 330 PCM', 'hm', 40, 120),
    ip('p-corta', 'mano_obra', 'PEON', 'hh', 800, 20.07),
  ];

  it('sin filtro salen las tres categorías comprables, y la mano de obra aparte', () => {
    const { propuestas, manoObra } = simularOrdenes({
      insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    expect([...new Set(propuestas.map(p => p.categoria))].sort())
      .toEqual(['herramientas', 'materiales', 'servicios']);
    expect(manoObra).toHaveLength(1);
  });

  it('el filtro deja una sola categoría y dice cuánto dejó afuera', () => {
    const { propuestas, resumen } = simularOrdenes({
      insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'cero',
      categorias: ['servicios'],
    });
    expect(propuestas).toHaveLength(1);
    expect(propuestas[0].subcategoria).toBe('servicio');
    expect(propuestas[0].monto).toBe(4800);
    expect(resumen.lineasFiltradas).toBe(3);
    expect(resumen.montoFiltrado).toBe(3000 + 1700 + 16056);
  });

  it('el filtro no cambia el denominador de la cobertura', () => {
    // El comprable de la obra es el mismo se mire lo que se mire; si el
    // filtro lo encogiera, filtrar «servicios» mostraría 100% de cobertura.
    const todo = simularOrdenes({ insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'cero' });
    const soloServicios = simularOrdenes({ insumosPartida: insumos, partidas, hoy: '2026-05-01', anclaje: 'cero', categorias: ['servicios'] });
    expect(soloServicios.resumen.montoComprable).toBe(todo.resumen.montoComprable);
    expect(soloServicios.resumen.cobertura).toBeLessThan(1);
  });
});

describe('las propuestas que ve Gabriel', () => {
  it('se agrupan por período y RUBRO DE PROVEEDOR, con el título del §1', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: [
        ip('p-corta', 'equipo', 'ZAPATOS PUNTA DE ACERO', 'par', 20, 85),
        ip('p-corta', 'equipo', 'LENTES DE SEGURIDAD', 'und', 40, 12),
        ip('p-corta', 'equipo', 'COMPRESORA NEUMATICA 250 - 330 PCM', 'hm', 40, 120),
      ],
      partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    const seg = propuestas.find(p => p.rubro === 'seguridad');
    expect(seg.titulo).toBe('Seguridad y señalización — primera dotación');
    expect(seg.lineas).toHaveLength(2);
    // La compresora es un alquiler de maquinaria: otro proveedor, otra orden.
    const maq = propuestas.find(p => p.rubro !== 'seguridad');
    expect(maq.titulo).toMatch(/— junio 2026$/);
    expect(maq.lineas).toHaveLength(1);
  });

  // El pedido de Gabriel del 22-set, en un test: la orden tiene que poder
  // mandarse a UN proveedor. Antes estos cinco caían juntos en «Materiales»
  // porque el S10 los trae a todos con tipo_insumo='material'.
  it('una orden por proveedor: el cemento con sus aditivos, la señal con los cachacos', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: [
        ip('p-corta', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 100, 30, CEMENTO),
        ip('p-corta', 'material', 'ADITIVO IMPERMEABILIZANTE', 'gal', 10, 50),
        ip('p-corta', 'material', 'ARENA GRUESA', 'm³', 20, 60),
        ip('p-corta', 'material', 'SEÑAL INFORMATIVA DE MADERA (INCLUYE POSTE DE MADERA)', 'und', 5, 210),
        ip('p-corta', 'material', 'MALLA CERCADORA NARANJA', 'rll', 10, 300),
        ip('p-corta', 'material', 'EXAMENES MÉDICOS PREOCUPACIONALES', 'und', 30, 250),
        ip('p-corta', 'material', 'MONITOREO DE CALIDAD DE AGUA', 'und', 4, 1500),
      ],
      partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    const de = (rubro) => propuestas.find(p => p.rubro === rubro);

    // El ejemplo textual de Gabriel: cemento + aditivo + agregado, una orden.
    expect(de('concreto').lineas.map(l => l.nombre).sort()).toEqual([
      'ADITIVO IMPERMEABILIZANTE', 'ARENA GRUESA', 'CEMENTO PORTLAND TIPO I (42.5 kg)',
    ]);
    // Y el otro: la señal DE MADERA no va con el encofrado, va con la malla.
    expect(de('seguridad').lineas.map(l => l.nombre).sort()).toEqual([
      'MALLA CERCADORA NARANJA', 'SEÑAL INFORMATIVA DE MADERA (INCLUYE POSTE DE MADERA)',
    ]);
    // Los dos servicios que el S10 llamaba «material» salen por su lado, y no
    // juntos entre sí: el de salud y el ambiental no son el mismo proveedor.
    expect(de('salud').lineas.map(l => l.nombre)).toEqual(['EXAMENES MÉDICOS PREOCUPACIONALES']);
    expect(de('ambiental').lineas.map(l => l.nombre)).toEqual(['MONITOREO DE CALIDAD DE AGUA']);
    // Ninguna orden mezcla rubros.
    expect(new Set(propuestas.map(p => p.rubro)).size).toBe(propuestas.length);

    // Y CADA LÍNEA viaja con su clasificación, que es lo que la pantalla
    // muestra al abrir la orden para que se vea por qué entró ahí. Sin este
    // contrato el rubro es una caja negra: una línea mal clasificada se ve
    // rara y no hay forma de saber de dónde salió.
    for (const p of propuestas) {
      for (const l of p.lineas) {
        expect(l.iupc?.codigo, `línea sin clasificación: ${l.nombre}`).toBeTruthy();
        expect(l.iupc?.etiqueta, `línea sin etiqueta: ${l.nombre}`).toBeTruthy();
        expect(l.rubro).toBe(p.rubro);
      }
    }
  });

  it('el mismo insumo en dos partidas del mismo mes se junta en una línea', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: [
        ip('p-corta', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 400, 30, CEMENTO),
        ip('p-corta', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 600, 30, CEMENTO),
      ],
      partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    expect(propuestas[0].lineas).toHaveLength(1);
    expect(propuestas[0].lineas[0].cantidad).toBe(1000);
    expect(propuestas[0].lineas[0].precio_unitario).toBe(30);
  });

  it('el precio por defecto es el del expediente (§6), no un precio de mercado', () => {
    const { propuestas } = simularOrdenes({
      insumosPartida: [ip('p-corta', 'material', 'ACERO CORRUGADO fy = 4200', 'kg', 1000, 4.32, '30020002')],
      partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    expect(propuestas[0].lineas[0].precio_unitario).toBe(4.32);
  });

  it('una línea sin precio se planifica igual, pero marcada', () => {
    const sinPrecio = {
      id: 'ip-x', obra_id: 'o1', partida_id: 'p-corta', tipo_insumo: 'material',
      nombre_insumo: 'ARENA GRUESA', unidad: 'm3', cantidad_presupuestada: 50,
      precio_presupuestado: null, costo_presupuestado: null, insumo_codigo: '050001',
    };
    const { propuestas, resumen } = simularOrdenes({
      insumosPartida: [sinPrecio], partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    expect(propuestas[0].lineas[0].cantidad).toBe(50);
    expect(propuestas[0].lineas[0].montoConocido).toBe(false);
    expect(propuestas[0].tieneMontoIncompleto).toBe(true);
    expect(resumen.lineasSinPrecio).toBe(1);
  });

  it('las líneas borradas no entran', () => {
    const { propuestas, resumen } = simularOrdenes({
      insumosPartida: [
        { ...ip('p-corta', 'material', 'CEMENTO', 'bol', 100, 30, CEMENTO), deleted_at: '2026-05-01T00:00:00Z' },
      ],
      partidas, hoy: '2026-05-01', anclaje: 'cero',
    });
    expect(propuestas).toHaveLength(0);
    expect(resumen.lineasPresupuesto).toBe(0);
  });

  it('un presupuesto vacío devuelve una corrida vacía, no una excepción', () => {
    const r = simularOrdenes({ insumosPartida: [], partidas: [], hoy: '2026-05-01' });
    expect(r.propuestas).toEqual([]);
    expect(r.sobres).toEqual([]);
    expect(r.manoObra).toEqual([]);
    expect(r.pendientes).toEqual([]);
    expect(r.resumen.cobertura).toBe(0);
  });

  it('los ejes inválidos caen al default en vez de romper', () => {
    const { resumen } = simularOrdenes({
      insumosPartida: [], partidas: [], hoy: '2026-05-01',
      granularidad: 'trimestre', anclaje: 'cuando sea', cronograma: 'magia', reparto: 'a ojo',
    });
    expect(resumen.granularidad).toBe('mes');
    expect(resumen.anclaje).toBe('hoy');
    expect(resumen.cronograma).toBe('gantt');
    expect(resumen.reparto).toBe('parejo');
  });
});

describe('las constantes que la pantalla va a ofrecer', () => {
  it('los cuatro ejes están completos y el umbral es el medido', () => {
    expect(ANCLAJES).toEqual(['hoy', 'restante', 'cero']);
    expect(CRONOGRAMAS).toEqual(['gantt', 'reprogramado', 'sin_cronograma']);
    expect(REPARTOS).toEqual(['parejo', 'inicio', 'cuadrilla', 'manual']);
    expect(UMBRAL_TRAMO_LARGO_DIAS).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════
// RONDA 2, TANDA 2.2 — cantidades que se pueden pedir
// (docs/plan-simulador-ordenes.md §12.1 punto 1, §12.2, §12.3)
// ═══════════════════════════════════════════════════════════════════
describe('cantidades comprables (tanda 2.2)', () => {
  // Una partida de 3 meses, para que el reparto parejo parta en tres.
  const P3 = partida('p3', '2026-06-01', '2026-08-20');
  const cemento = (cant) => ip('p3', 'material', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', cant, 30, CEMENTO);
  const tubo = (cant) => ip('p3', 'material', 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', 'm', cant, 150, TUBERIA);
  const base = { partidas: [P3], hoy: '2026-05-01', anclaje: 'cero', reparto: 'parejo' };
  const lineasDe = (propuestas, clave) => propuestas.flatMap(p => p.lineas
    .filter(l => l.clave === clave).map(l => ({ ...l, periodo: p.periodo })));

  it('EL CASO DEL PLAN: «3,37 bol» por mes ya no sale — y no se sobrepide todos los meses', () => {
    const { propuestas, resumen } = simularOrdenes({ ...base, insumosPartida: [cemento(10.11)] });
    const ls = lineasDe(propuestas, CEMENTO);
    expect(ls.map(l => l.cantidad)).toEqual([4, 3, 4]);
    expect(ls.map(l => l.necesidad)).toEqual([3.37, 3.37, 3.37]);
    // 11 bolsas para 10,11: la de más es el redondeo, y se dice aparte.
    expect(resumen.montoPropuesto).toBe(330);
    expect(resumen.montoRedondeo).toBe(26.7);
  });

  it('el redondeo no infla la cobertura: se mide contra lo del expediente', () => {
    const { resumen } = simularOrdenes({ ...base, insumosPartida: [cemento(10.11)] });
    expect(resumen.cobertura).toBe(1);
    expect(resumen.montoComprable).toBe(303.3);
  });

  it('un mes que ya cubrió el redondeo de otro sale de la orden, y el otro lo dice', () => {
    // 1,2 bolsas en tres meses: 0,4 por mes. Se pide 1 en junio, 0 en julio
    // (alcanza) y 1 en agosto.
    const { propuestas } = simularOrdenes({ ...base, insumosPartida: [cemento(1.2)] });
    const ls = lineasDe(propuestas, CEMENTO);
    expect(ls.map(l => [l.periodo, l.cantidad])).toEqual([['2026-06', 1], ['2026-08', 1]]);
    expect(ls[0].alcanzaHasta).toBe('2026-07');
    expect(ls[0].etiquetaAlcanzaHasta).toBe('julio 2026');
    expect(ls[1].alcanzaHasta).toBe(null);
  });

  it('la tubería se pide en tubos porque el nombre dice «x 6m», y el precio es por tubo', () => {
    const { propuestas, resumen } = simularOrdenes({ ...base, insumosPartida: [tubo(600)] });
    const ls = lineasDe(propuestas, TUBERIA);
    expect(ls.map(l => l.cantidad)).toEqual([34, 33, 33]);  // 100 tubos = 600 m
    expect(ls[0]).toMatchObject({
      unidad: 'tubo de 6 m', unidadExpediente: 'm', factor: 6, precio_unitario: 900, compraOrigen: 'nombre',
    });
    expect(resumen.montoPropuesto).toBe(90000);             // no cambia la plata
  });

  it('lo fijado a mano gana sobre el nombre (el tubo era de 5 m, o se pide en metros)', () => {
    const de5 = simularOrdenes({
      ...base, insumosPartida: [tubo(600)], compras: { [TUBERIA]: { unidadCompra: 'tubo de 5 m', factor: 5 } },
    });
    expect(lineasDe(de5.propuestas, TUBERIA).reduce((s, l) => s + l.cantidad, 0)).toBe(120);
    const metros = simularOrdenes({
      ...base, insumosPartida: [tubo(600)], compras: { [TUBERIA]: { unidadCompra: 'm', factor: 1 } },
    });
    expect(lineasDe(metros.propuestas, TUBERIA).map(l => l.cantidad)).toEqual([200, 200, 200]);
  });

  it('la clave de la línea NO cambia con la unidad de compra: las decisiones sobreviven', () => {
    const a = simularOrdenes({ ...base, insumosPartida: [tubo(600)] });
    const b = simularOrdenes({
      ...base, insumosPartida: [tubo(600)], compras: { [TUBERIA]: { unidadCompra: 'm', factor: 1 } },
    });
    expect(a.propuestas.map(p => p.lineas[0].clave)).toEqual(b.propuestas.map(p => p.lineas[0].clave));
    expect(a.propuestas.map(p => p.id)).toEqual(b.propuestas.map(p => p.id));
  });

  it('el colchón es 0% por defecto: sin fijarlo, se pide lo del expediente', () => {
    const { resumen } = simularOrdenes({ ...base, insumosPartida: [cemento(300)] });
    expect(resumen.montoColchon).toBe(0);
    expect(resumen.insumosConColchon).toBe(0);
    expect(resumen.montoPropuesto).toBe(9000);
  });

  it('el colchón por insumo suma cantidad y plata, y se dice aparte', () => {
    const { propuestas, resumen } = simularOrdenes({
      ...base, insumosPartida: [cemento(300)], compras: { [CEMENTO]: { colchonPct: 5 } },
    });
    const ls = lineasDe(propuestas, CEMENTO);
    expect(ls.map(l => l.cantidad)).toEqual([105, 105, 105]);
    expect(ls[0].colchonPct).toBe(5);
    expect(resumen.montoColchon).toBe(450);
    expect(resumen.insumosConColchon).toBe(1);
    // La cobertura no pasa del 100% por el colchón: es plata de más.
    expect(resumen.cobertura).toBe(1);
  });

  it('el colchón va ANTES del descuento: lo ya pedido con colchón no se vuelve a pedir', () => {
    // 300 + 5% = 315 hacen falta; ya hay 315 pedidas → nada.
    const { propuestas, resumen } = simularOrdenes({
      ...base, anclaje: 'restante', insumosPartida: [cemento(300)],
      compras: { [CEMENTO]: { colchonPct: 5 } }, yaComprado: { [CEMENTO]: 315 },
    });
    expect(propuestas).toHaveLength(0);
    expect(resumen.montoColchon).toBe(0);
  });

  it('el lote junta meses: la arena de a 5 m³', () => {
    const arena = ip('p3', 'material', 'ARENA GRUESA', 'm³', 6, 90, '040001');
    const { propuestas } = simularOrdenes({ ...base, insumosPartida: [arena], compras: { '040001': { lote: 5 } } });
    expect(lineasDe(propuestas, '040001').map(l => [l.periodo, l.cantidad])).toEqual([['2026-06', 5], ['2026-08', 5]]);
  });

  it('la mano de obra NO se redondea: son HH de referencia para la dotación', () => {
    const peon = ip('p3', 'mano_obra', 'PEON', 'hh', 100, 20, '470101');
    const { manoObra } = simularOrdenes({ ...base, insumosPartida: [peon], categorias: ['mano_obra'] });
    expect(manoObra.map(m => m.cantidad)).toEqual([33.3333, 33.3333, 33.3333]);
  });

  it('NADA SE PIDE DOS VECES en otra unidad: 100 tubos requisados descuentan 600 m, no 100', () => {
    const { propuestas, resumen } = simularOrdenes({
      ...base, anclaje: 'restante', insumosPartida: [tubo(1200)],
      requisiciones: [{ id: 'r1', estado: 'borrador' }],
      requisicionItems: [{
        id: 'ri1', requisicion_id: 'r1', insumo_codigo: TUBERIA, cantidad: 100,
        unidad: 'tubo de 6 m', factor_presupuesto: 6, precio_estimado: 900,
      }],
    });
    expect(resumen.descontado.cantidad).toBe(600);
    expect(lineasDe(propuestas, TUBERIA).reduce((s, l) => s + l.cantidad, 0)).toBe(100);
  });

  it('coberturaPrevia: el factor de la orden y de la requisición lleva a la unidad del presupuesto', () => {
    const { cubierto } = coberturaPrevia({
      ordenes: [{ id: 'oc1', estado: 'borrador' }],
      ocItems: [{ id: 'i1', orden_compra_id: 'oc1', insumo_codigo: TUBERIA, cantidad: 10, factor_presupuesto: 6 }],
      requisiciones: [{ id: 'r1', estado: 'borrador' }],
      requisicionItems: [
        { id: 'ri1', requisicion_id: 'r1', insumo_codigo: TUBERIA, cantidad: 5, factor_presupuesto: 6 },
        // Sin factor = misma unidad: lo escrito antes de la 2.2.
        { id: 'ri2', requisicion_id: 'r1', insumo_codigo: CEMENTO, cantidad: 7 },
        // Un factor basura no puede hacer desaparecer lo pedido.
        { id: 'ri3', requisicion_id: 'r1', insumo_codigo: CEMENTO, cantidad: 3, factor_presupuesto: 0 },
      ],
    });
    expect(cubierto.get(TUBERIA)).toBe(90);
    expect(cubierto.get(CEMENTO)).toBe(10);
  });
});
