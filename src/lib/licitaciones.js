// ═══════════════════════════════════════════════════════════════════
// JARVEX — Postulaciones a procesos de selección (tanda 15, entrega 1).
//
// Este archivo NO vuelve a evaluar a nadie. Toda la evaluación ya vive en
// src/lib/experiencia-profesional.js desde la mig 171 (fusiona periodos
// solapados, separa lo sustentado de lo declarado, mira la colegiatura). Acá
// solo pasan dos cosas:
//
//  1. LA TRADUCCIÓN de una fila de `licitacion_requisitos` al objeto que come
//     evaluarRequisito(). Es un mapeo tonto a propósito: la fila de la base se
//     diseñó campo por campo con la forma de ese objeto (mig 197) justamente
//     para que acá no haya criterio que se pueda desincronizar.
//
//  2. EL VEREDICTO: convertir la lista larga de buscarPlantel() —quién califica
//     para cada puesto— en la única frase que se necesita antes de invertir una
//     semana en un expediente: "¿calificamos, sí o no, y qué falta?".
//
// LA REGLA QUE DEFINE EL VEREDICTO: un puesto con un candidato YA ELEGIDO que
// no cumple es PEOR que un puesto todavía sin elegir. El segundo es trabajo
// pendiente; el primero es una observación segura en la evaluación, porque es
// el nombre que ya está escrito en el expediente. Por eso se cuentan aparte y
// existe `limpio` además de `califica`.
//
// SIN REQUISITOS CARGADOS NO SE CALIFICA. `califica` es false cuando la lista
// está vacía: no saber no es lo mismo que estar bien, y ese matiz es la
// diferencia entre desistir a tiempo y perder la semana.
//
// Puro: sin React, sin Dexie. Solo importa la taxonomía compartida.
// ═══════════════════════════════════════════════════════════════════

import { TIPOS_TRABAJO, ORIGENES } from './tipos-trabajo.js';

// ── Etapas del seguimiento ─────────────────────────────────────────
// Espejo del CHECK licitaciones_etapa_check (mig 197).
export const ETAPAS = [
  { v: 'identificado', label: 'Identificado',           badge: 'b-gray',   corto: 'Identificado' },
  { v: 'requisitos',   label: 'Verificando requisitos', badge: 'b-blue',   corto: 'Requisitos' },
  { v: 'preparacion',  label: 'En preparación',         badge: 'b-yellow', corto: 'Preparación' },
  { v: 'presentado',   label: 'Presentado',             badge: 'b-purple', corto: 'Presentado' },
  { v: 'evaluacion',   label: 'En evaluación',          badge: 'b-purple', corto: 'Evaluación' },
  { v: 'buena_pro',    label: 'Buena pro (ganado)',     badge: 'b-green',  corto: 'Ganado' },
  { v: 'no_ganado',    label: 'No ganado',              badge: 'b-red',    corto: 'No ganado' },
  { v: 'desistido',    label: 'Desistido (no calificábamos)', badge: 'b-gray', corto: 'Desistido' },
];

export const ETAPA_LBL   = Object.fromEntries(ETAPAS.map(e => [e.v, e.label]));
export const ETAPA_BADGE = Object.fromEntries(ETAPAS.map(e => [e.v, e.badge]));
export const ETAPA_DEFAULT = 'identificado';

/** Etapas donde el proceso ya terminó: no hay nada más que preparar. */
export const ETAPAS_CERRADAS = new Set(['buena_pro', 'no_ganado', 'desistido']);
export const esCerrada = (etapa) => ETAPAS_CERRADAS.has(etapa);

/** Etapas donde la fecha de presentación todavía corre en contra. */
export const ETAPAS_EN_JUEGO = new Set(['identificado', 'requisitos', 'preparacion']);

// ── Tipos de proceso ───────────────────────────────────────────────
// La misma taxonomía de `obras` (mig 173) más bienes y servicios, que en la
// app es la tabla `trabajos` (mig 174) y no un tipo_trabajo de obra — pero a
// un proceso de selección de bienes y servicios SÍ se postula.
export const TIPOS_PROCESO = [
  ...TIPOS_TRABAJO,
  { v: 'bienes_servicios', label: 'Bienes y servicios', corto: 'Bienes/servicios' },
];
export const TIPO_PROCESO_LBL = Object.fromEntries(TIPOS_PROCESO.map(t => [t.v, t.label]));
export const TIPO_PROCESO_DEFAULT = 'obra_ejecucion';
export { ORIGENES };

/** Un proceso de bienes/servicios se gana como `trabajo`, no como `obra`. */
export const destinoAlGanar = (tipo) => tipo === 'bienes_servicios' ? 'trabajo' : 'obra';

// ── 1. Traducción fila → requisito ─────────────────────────────────
/**
 * Fila de `licitacion_requisitos` → objeto de evaluarRequisito().
 * `id` y `candidatoPersonalId` viajan de más: evaluarRequisito los ignora y
 * veredictoPlantel los necesita para saber a quién elegimos en cada puesto.
 */
export function requisitoDeFila(fila) {
  const f = fila || {};
  return {
    id: f.id ?? null,
    clase: f.clase || 'personal',
    cargo: f.cargo || '',
    profesion: f.profesion || '',
    mesesMinimos: Number(f.meses_minimos) || 0,
    rubroId: f.rubro_id || null,
    exigeColegiatura: f.exige_colegiatura !== false,
    exigeSustento: f.exige_sustento !== false,
    candidatoPersonalId: f.candidato_personal_id || null,
    fuente: f.fuente || 'manual',
    fuentePagina: f.fuente_pagina ?? null,
    fuenteCita: f.fuente_cita || '',
  };
}

/** Las filas de UNA postulación, ordenadas y solo las de personal. */
export function requisitosDePersonal(filas, licitacionId) {
  return (filas || [])
    .filter(f => !f.deleted_at
      && (!licitacionId || f.licitacion_id === licitacionId)
      && (f.clase || 'personal') === 'personal')
    .sort((a, b) => (a.orden ?? 100) - (b.orden ?? 100)
      || String(a.cargo || '').localeCompare(String(b.cargo || '')))
    .map(requisitoDeFila);
}

// ── 2. El veredicto ────────────────────────────────────────────────
/**
 * @param resultados salida de buscarPlantel(): [{ requisito, candidatos, nCumplen }]
 * @returns {
 *   total, cubiertos, sinNadie, elegidosEnFalta,
 *   califica  todos los puestos tienen al menos alguien que cumple
 *   limpio    además, ningún elegido está en falta
 *   puestos[] { requisito, cubierto, nCumplen, elegido, masCerca }
 * }
 */
export function veredictoPlantel(resultados) {
  const puestos = (resultados || []).map(r => {
    const req = r?.requisito || {};
    const candidatos = r?.candidatos || [];
    const cumplen = candidatos.filter(c => c.cumple);
    const elegidoId = req.candidatoPersonalId || null;
    const elegido = elegidoId
      ? (candidatos.find(c => c?.persona?.id === elegidoId) || null)
      : null;
    // buscarPlantel ya ordenó: los que cumplen arriba, después los que APLICAN
    // por menos meses faltantes. El primero que no cumple pero aplica es, por
    // construcción, al que menos le falta y a quien conviene conseguirle la
    // constancia antes que descartar el puesto.
    const masCerca = candidatos.find(c => !c.cumple && c.aplica) || null;
    return {
      requisitoId: req.id ?? null,
      requisito: req,
      nCumplen: cumplen.length,
      cubierto: cumplen.length > 0,
      elegido,
      elegidoEnFalta: !!(elegido && !elegido.cumple),
      masCerca,
    };
  });

  const sinNadie = puestos.filter(p => !p.cubierto).length;
  const elegidosEnFalta = puestos.filter(p => p.elegidoEnFalta).length;
  const hayPuestos = puestos.length > 0;

  return {
    total: puestos.length,
    cubiertos: puestos.length - sinNadie,
    sinNadie,
    elegidosEnFalta,
    // Sin requisitos cargados no se califica: no saber ≠ estar bien.
    califica: hayPuestos && sinNadie === 0,
    limpio: hayPuestos && sinNadie === 0 && elegidosEnFalta === 0,
    puestos,
  };
}

/** Una línea para la tarjeta de la lista. */
export function resumenVeredicto(v) {
  if (!v || !v.total) return 'Sin requisitos cargados';
  if (!v.califica) return `Faltan ${v.sinNadie} de ${v.total} puestos`;
  if (!v.limpio) return `Califica, pero ${v.elegidosEnFalta} elegido(s) en falta`;
  return `Califica: ${v.cubiertos} de ${v.total} puestos`;
}

// ── 3. Fechas ──────────────────────────────────────────────────────
/** Días desde `hoy` hasta `fecha` ('YYYY-MM-DD'). Negativo = ya pasó. */
export function diasPara(fecha, hoy) {
  const a = String(fecha || '').slice(0, 10);
  const b = String(hoy || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((ta - tb) / 86400000);
}

/**
 * Urgencia de una postulación abierta. En una etapa cerrada la fecha ya no
 * significa nada, y marcar en rojo un proceso que ya se ganó es ruido.
 */
export function urgencia(lic, hoy) {
  if (!lic || esCerrada(lic.etapa)) return { nivel: 'ninguna', dias: null, texto: '' };
  const d = diasPara(lic.fecha_presentacion, hoy);
  if (d == null) return { nivel: 'sin_fecha', dias: null, texto: 'Sin fecha de presentación' };
  if (d < 0)  return { nivel: 'vencida', dias: d, texto: `Venció hace ${Math.abs(d)} día(s)` };
  if (d === 0) return { nivel: 'hoy',    dias: d, texto: 'Se presenta HOY' };
  if (d <= 7)  return { nivel: 'alta',   dias: d, texto: `Faltan ${d} día(s)` };
  return { nivel: 'normal', dias: d, texto: `Faltan ${d} día(s)` };
}

// ── 4. Prellenado al ganar ─────────────────────────────────────────
/**
 * Campos de `obras` que salen de la postulación. NO crea nada: devuelve el
 * borrador para que la pantalla lo muestre y una persona confirme. El paso a
 * Trabajos es manual por decisión de diseño — prellenar no es crear.
 *
 * `ejecutora_company_id` SÍ viaja (mig 035): es la company que lleva el RUC, y
 * eso vale igual si postuló una empresa sola o si lidera un consorcio —
 * `consorcios.company_id` apunta a esa misma fila (mig 172).
 * `ejecutora_tipo` NO viaja: empresa o consorcio es una decisión que no se
 * deduce de con qué RUC se postuló, y errarla desarma la contabilidad de la
 * obra entera. La pantalla la pregunta.
 */
export function prefillObraDesde(lic) {
  const l = lic || {};
  return {
    nombre_obra: l.objeto || '',
    tipo_trabajo: l.tipo_trabajo === 'bienes_servicios' ? 'obra_ejecucion' : (l.tipo_trabajo || 'obra_ejecucion'),
    origen: l.origen || 'publico',
    rubro_id: l.rubro_id || null,
    cliente: l.entidad_convocante || '',
    presupuesto_total: l.valor_referencial ?? null,
    ejecutora_company_id: l.postulante_company_id || null,
    estado: 'planificacion',
  };
}

/** ¿Se puede pasar a Trabajos? Solo si se ganó y todavía no se pasó. */
export function puedePasarATrabajos(lic) {
  if (!lic || lic.deleted_at) return false;
  if (lic.etapa !== 'buena_pro') return false;
  return !lic.obra_id && !lic.trabajo_id;
}
