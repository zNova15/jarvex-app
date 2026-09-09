// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL BALANCE GENERAL, Y DE DÓNDE SALE CADA NÚMERO (tanda 18, C).
//
// Gabriel, 9-set-2026: quiere el DESGLOSE del Balance General.
//
// ── POR QUÉ HACÍA FALTA ────────────────────────────────────────────
// El Balance mostraba cinco cifras y una nota al pie que decía «simplificación».
// Medido en producción el 9-set, ese resumen deja preguntas que no se pueden
// contestar mirándolo: JARVEX tiene «ingresos cobrados» por S/ −12.920 —una nota
// de crédito registrada como ingreso negativo, que es correcto y desconcertante—
// y VIAJEROS CAJAMARCA por S/ −3.050. Con el total a secas, eso se lee como un
// error del programa. Con el desglose, se lee como lo que es: una NC.
//
// Este archivo calcula lo mismo que antes, pero devolviendo ADEMÁS los
// comprobantes que forman cada línea, ordenados por plata. Ninguna cifra
// cambió de fórmula acá; lo que cambió es que ahora se puede abrir.
//
// ── LA LÍNEA QUE SÍ ES NUEVA: EL ACTIVO FIJO ───────────────────────
// El balance no incluía los bienes de la empresa, y eso no era una
// simplificación: era un descuadre. Cuando GASOMI compra un vibrador de
// concreto por S/ 14.110 y lo paga, esos soles SALEN del efectivo — el balance
// ya los restaba— y no entraba nada a cambio. La empresa aparecía más pobre por
// haber comprado una máquina. Ahora el valor en libros del registro 7.1 (mig
// 181, formato SUNAT) entra en el activo, que es la otra mitad del asiento.
//
// Se toma el ÚLTIMO EJERCICIO CARGADO DE CADA EMPRESA, no la suma de todos: el
// 7.1 lleva una fila por bien y por ejercicio, y sumarlos contaría el mismo
// vibrador tantas veces como años tenga cargados. Lo retirado y lo vendido no
// cuentan: ya no es de la empresa.
//
// ── LO QUE SIGUE SIENDO UNA SIMPLIFICACIÓN, Y SE DICE ──────────────
// El efectivo no sale de las cuentas bancarias sino de la diferencia entre lo
// cobrado y lo pagado; el patrimonio no sale del capital social sino del cuadre.
// Eso no se toca en esta entrega: cambiarlo es rehacer el estado financiero, no
// desglosarlo. Pero cada línea ahora dice de dónde viene.
//
// Puro: sin React, sin Dexie, sin fetch.
// ═══════════════════════════════════════════════════════════════════

import { valorEnLibros } from './activos-fijos.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

/** El valor con el que las pantallas dicen «sin filtrar por empresa». */
export const TODAS = 'todas';

/** Una fila del desglose, con lo mínimo para reconocer el comprobante. */
const filaMov = (m) => ({
  id: m.id,
  fecha: m.date || m.fecha || m.created_at || '',
  documento: m.document_number || '—',
  tercero: m.third_party_name || '—',
  obraId: m.obra_id || null,
  companyId: m.company_id || null,
  monto: round2(m.amount),
});

const porMontoDesc = (a, b) => Math.abs(b.monto) - Math.abs(a.monto);

/**
 * El activo fijo neto de cada empresa, del ÚLTIMO ejercicio que tenga cargado.
 *
 * @returns {{ total, filas, periodos }} — `periodos` es Map(companyId → año),
 *          para que la pantalla pueda decir de qué ejercicio está hablando.
 */
export function activoFijoNeto(activos, companyId = TODAS) {
  const vivos = (activos || []).filter(a => a && !a.deleted_at
    && !['retirado', 'vendido'].includes(String(a.estado || '')))
    .filter(a => companyId === TODAS || a.company_id === companyId);

  // El último ejercicio cargado, empresa por empresa.
  const ultimo = new Map();
  for (const a of vivos) {
    const k = a.company_id || '__sin__';
    const p = Number(a.periodo);
    if (!Number.isFinite(p)) continue;
    if (!ultimo.has(k) || p > ultimo.get(k)) ultimo.set(k, p);
  }

  const filas = [];
  let total = 0;
  for (const a of vivos) {
    const k = a.company_id || '__sin__';
    if (Number(a.periodo) !== ultimo.get(k)) continue;
    const vl = valorEnLibros(a);
    total += vl;
    filas.push({
      id: a.id,
      fecha: a.fecha_adquisicion || '',
      documento: a.codigo_relacionado || '—',
      tercero: a.descripcion || '—',
      companyId: a.company_id || null,
      cuenta: a.cuenta_contable || '—',
      periodo: Number(a.periodo),
      monto: vl,
    });
  }
  return { total: round2(total), filas: filas.sort(porMontoDesc), periodos: ultimo };
}

/**
 * El Balance General de una empresa (o del grupo) en una moneda, con el
 * desglose de cada línea.
 *
 * Las fórmulas son EXACTAMENTE las que tenía la pantalla desde siempre; lo
 * único nuevo es el activo fijo. Se mantienen a propósito: esta entrega
 * desglosa el balance, no lo rehace.
 */
export function calcularBalance({ movs = [], pagos = [], activos = [], companyId = TODAS, moneda = 'PEN' } = {}) {
  const ms = (movs || []).filter(m => m && !m.deleted_at
    && m.currency === moneda
    && m.payment_status !== 'cancelled'
    && (companyId === TODAS || m.company_id === companyId));

  const det = {
    ingresosCobrados: [], costosPagados: [], gastosPagados: [],
    cxc: [], cxp: [],
  };
  let ingresosCobrados = 0, costosPagados = 0, gastosPagados = 0, cxc = 0, cxp = 0;

  for (const m of ms) {
    const a = num(m.amount);
    const pagado = m.payment_status === 'paid';
    const fila = filaMov(m);
    if (m.type === 'income') {
      if (pagado) { ingresosCobrados += a; det.ingresosCobrados.push(fila); }
      else { cxc += a; det.cxc.push(fila); }
    } else if (m.type === 'cost') {
      if (pagado) { costosPagados += a; det.costosPagados.push(fila); }
      else { cxp += a; det.cxp.push(fila); }
    } else if (m.type === 'expense') {
      if (pagado) { gastosPagados += a; det.gastosPagados.push(fila); }
      else { cxp += a; det.cxp.push(fila); }
    }
  }
  for (const k of Object.keys(det)) det[k].sort(porMontoDesc);

  // El efectivo se recorta en 0 si da negativo; el déficit va al pasivo, que es
  // lo que de verdad pasa: si se pagó más de lo que entró, alguien lo financió.
  const efectivoBruto = round2(ingresosCobrados - costosPagados - gastosPagados);
  const efectivo = Math.max(0, efectivoBruto);
  const deficitFinanciamiento = efectivoBruto < 0 ? round2(-efectivoBruto) : 0;

  // El pasivo del cronograma: los pagos programados o vencidos. Los que no
  // tienen empresa se cuentan siempre — es como funcionaba y son del grupo.
  //
  // El filtro por MONEDA sí es nuevo: el balance se muestra en una moneda y
  // sumaba los pagos de todas. Hoy no cambia ningún número —`cronograma_pagos`
  // está vacía en producción— pero un pago en dólares sumado a un balance en
  // soles es una cifra falsa esperando a que alguien cargue el primero. Sin
  // moneda cuenta como soles, que es el default de la app.
  const pagosPendientes = (pagos || []).filter(p => p && !p.deleted_at
    && (p.estado === 'programado' || p.estado === 'vencido')
    && (p.moneda || 'PEN') === moneda
    && (companyId === TODAS || p.company_id === companyId || !p.company_id));
  const pasivoCronograma = round2(pagosPendientes.reduce((s, p) => s + num(p.monto), 0));
  det.cronograma = pagosPendientes.map(p => ({
    id: p.id,
    fecha: p.fecha_programada || '',
    documento: p.documento_ref || p.concepto || '—',
    tercero: p.beneficiario || '—',
    companyId: p.company_id || null,
    estado: p.estado || '',
    monto: round2(p.monto),
  })).sort(porMontoDesc);

  const fijo = activoFijoNeto(activos, companyId);
  det.activoFijo = fijo.filas;

  const activoTotal = round2(efectivo + cxc + fijo.total);
  const pasivoTotal = round2(cxp + pasivoCronograma + deficitFinanciamiento);
  const patrimonio = round2(activoTotal - pasivoTotal);

  return {
    moneda, companyId,
    efectivo, efectivoBruto, cxc, cxp, deficitFinanciamiento,
    ingresosCobrados: round2(ingresosCobrados),
    costosPagados: round2(costosPagados),
    gastosPagados: round2(gastosPagados),
    pasivoCronograma,
    activoFijo: fijo.total,
    periodosActivoFijo: fijo.periodos,
    activoTotal, pasivoTotal, patrimonio,
    pasivoMasPatrimonio: round2(pasivoTotal + patrimonio),
    // Cuadra por construcción; el chequeo se queda igual porque es la red que
    // avisa si alguien toca una fórmula y se olvida de la otra.
    cuadra: Math.abs(activoTotal - (pasivoTotal + patrimonio)) < 0.01,
    countMovs: ms.length,
    countPagos: pagosPendientes.length,
    desglose: det,
  };
}

/**
 * Las líneas del balance, en orden, con la clave de su desglose.
 *
 * La pantalla las recorre en vez de repetir el mismo `<tr>` diez veces, y así
 * agregar una línea es agregar una entrada acá. `detalle` es null cuando la
 * línea no se puede abrir (el patrimonio no tiene comprobantes: es un cuadre).
 */
export function lineasDeBalance(b) {
  const lineas = [
    {
      seccion: 'activo', codigo: '10', clave: 'efectivo',
      label: 'Efectivo y equivalentes (ingresos cobrados − pagos)',
      monto: b.efectivo,
      // El efectivo es el único que se arma con tres listas: una que suma y dos
      // que restan. Se muestran separadas porque la pregunta «¿por qué el
      // efectivo es cero?» se contesta viendo cuál de las tres pesa.
      partes: [
        { titulo: 'Ingresos cobrados', signo: 1, filas: b.desglose.ingresosCobrados, total: b.ingresosCobrados },
        { titulo: 'Costos pagados', signo: -1, filas: b.desglose.costosPagados, total: b.costosPagados },
        { titulo: 'Gastos pagados', signo: -1, filas: b.desglose.gastosPagados, total: b.gastosPagados },
      ],
      nota: b.efectivoBruto < 0
        ? `Dio ${b.efectivoBruto.toFixed(2)}: se pagó más de lo que entró. El negativo no se muestra acá — va al pasivo como déficit de financiamiento.`
        : null,
    },
    {
      seccion: 'activo', codigo: '12', clave: 'cxc',
      label: 'Cuentas por cobrar comerciales',
      monto: b.cxc, filas: b.desglose.cxc,
      nota: 'Facturas emitidas que todavía no se cobraron.',
    },
  ];

  // El activo fijo solo aparece si la empresa tiene registro 7.1 cargado: una
  // línea en cero que nadie puede llenar desde acá sería ruido.
  if (b.desglose.activoFijo.length > 0) {
    const anios = [...new Set(b.desglose.activoFijo.map(f => f.periodo))].sort();
    lineas.push({
      seccion: 'activo', codigo: '33', clave: 'activoFijo',
      label: 'Inmuebles, maquinaria y equipo (neto de depreciación)',
      monto: b.activoFijo, filas: b.desglose.activoFijo,
      nota: `Valor en libros del registro de activos fijos (formato 7.1), ejercicio ${anios.join(' y ')}. `
        + 'Es la otra mitad del asiento: la plata salió del efectivo y a cambio entró el bien.',
    });
  }

  lineas.push(
    {
      seccion: 'pasivo', codigo: '42', clave: 'cxp',
      label: 'Cuentas por pagar comerciales (movs pendientes)',
      monto: b.cxp, filas: b.desglose.cxp,
      nota: 'Comprobantes recibidos que todavía no se pagaron.',
    },
    {
      seccion: 'pasivo', codigo: '46', clave: 'cronograma',
      label: 'Cuentas por pagar diversas (cronograma)',
      monto: b.pasivoCronograma, filas: b.desglose.cronograma,
      nota: 'Pagos programados o vencidos que todavía no se liquidaron.',
    },
  );
  if (b.deficitFinanciamiento > 0) {
    lineas.push({
      seccion: 'pasivo', codigo: '45', clave: 'deficit',
      label: 'Déficit de financiamiento (efectivo neg.)',
      monto: b.deficitFinanciamiento, filas: null,
      nota: 'Se pagó más de lo que se cobró: la diferencia la puso alguien y figura como deuda.',
    });
  }
  lineas.push({
    seccion: 'patrimonio', codigo: '59', clave: 'patrimonio',
    label: 'Resultados acumulados (Activo − Pasivo)',
    monto: b.patrimonio, filas: null,
    nota: 'No sale de comprobantes: es el cuadre. Por eso el balance cuadra siempre.',
  });
  return lineas;
}
