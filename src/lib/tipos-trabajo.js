// ═══════════════════════════════════════════════════════════════════
// JARVEX — Taxonomía del trabajo: qué clase de trabajo es una obra.
//
// POR QUÉ EXISTE ESTE ARCHIVO: la lista de estados de obra estaba duplicada
// entre el CHECK de la mig 001 y tres constantes sueltas en jx-obra.jsx
// (EST_OBRA, EST_OBRA_LBL, EST_OBRA_LEGACY). Cada vez que alguien agregaba un
// estado tenía que acordarse de los cuatro lugares, y ya se había desincronizado
// una vez: el form viejo escribía 'finalizada'/'cancelada', valores que el CHECK
// del server nunca aceptó, y esas filas rebotaban con 23514 al editarse.
//
// LOS DOS EJES QUE AGREGA LA MIG 173:
//
//   naturaleza (tipo_trabajo) — QUÉ se hace: ejecutar, hacer el expediente,
//     supervisar. Son cosas distintas y hoy la app las trataba igual.
//   origen — público o privado. En obra pública aplican reglas propias.
//
// "Bienes y servicios" NO es un tipo_trabajo: es la tabla `trabajos` (mig 174).
// El criterio para separarlo fue que no tiene partidas, cronograma, avance,
// personal de campo ni estructura de costos — no comparte casi nada con una
// obra salvo el nombre.
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

/** Naturaleza del trabajo. Espejo del CHECK obras_tipo_trabajo_check (mig 173). */
export const TIPOS_TRABAJO = [
  { v: 'obra_ejecucion',         label: 'Obra — ejecución',              corto: 'Ejecución' },
  { v: 'obra_expediente',        label: 'Obra — expediente + ejecución',  corto: 'Exp. + ejecución' },
  { v: 'supervision',            label: 'Supervisión',                    corto: 'Supervisión' },
  { v: 'supervision_expediente', label: 'Supervisión de expediente + ejecución', corto: 'Sup. exp. + ejec.' },
];

/** Espejo del CHECK obras_origen_check (mig 173). */
export const ORIGENES = [
  { v: 'publico', label: 'Pública' },
  { v: 'privado', label: 'Privada' },
];

/** Ciclo de vida. Espejo del CHECK de obras.estado (mig 001). */
export const ESTADOS_OBRA = [
  { v: 'planificacion', label: 'Planificación', badge: 'b-blue' },
  { v: 'activo',        label: 'Activo',        badge: 'b-green' },
  { v: 'pausado',       label: 'Pausado',       badge: 'b-yellow' },
  { v: 'terminado',     label: 'Terminado',     badge: 'b-gray' },
  { v: 'cancelado',     label: 'Cancelado',     badge: 'b-red' },
];

/**
 * Valores que el form viejo escribió en Dexie y que el CHECK del server nunca
 * aceptó. Se normalizan al abrir el form, así el próximo guardado sana la fila
 * en lugar de rebotar con 23514.
 */
export const ESTADO_OBRA_LEGACY = { finalizada: 'terminado', cancelada: 'cancelado' };

export const TIPO_TRABAJO_LBL = Object.fromEntries(TIPOS_TRABAJO.map(t => [t.v, t.label]));
export const ORIGEN_LBL       = Object.fromEntries(ORIGENES.map(t => [t.v, t.label]));
export const ESTADO_OBRA_LBL  = Object.fromEntries(ESTADOS_OBRA.map(t => [t.v, t.label]));
export const ESTADO_OBRA_BADGE = Object.fromEntries(ESTADOS_OBRA.map(t => [t.v, t.badge]));

export const TIPO_TRABAJO_DEFAULT = 'obra_ejecucion';
export const ORIGEN_DEFAULT = 'publico';

/** Normaliza un estado, resolviendo los valores legacy. */
export function normalizarEstadoObra(estado) {
  const e = String(estado || '');
  return ESTADO_OBRA_LEGACY[e] || (ESTADO_OBRA_LBL[e] ? e : 'planificacion');
}

export function tipoTrabajoValido(v) { return !!TIPO_TRABAJO_LBL[String(v || '')]; }

/** Etiqueta corta para listados: "Supervisión · Pública". */
export function etiquetaTrabajo(obra) {
  const t = TIPOS_TRABAJO.find(x => x.v === (obra?.tipo_trabajo || TIPO_TRABAJO_DEFAULT));
  const o = ORIGEN_LBL[obra?.origen || ORIGEN_DEFAULT];
  return `${t?.corto || '—'} · ${o || '—'}`;
}

/**
 * ¿Este trabajo lleva estructura de costos (costo directo, utilidad, gastos
 * generales, IGV)?
 *
 * Una SUPERVISIÓN SOLA no la lleva: no construye nada, se cobra por honorarios.
 * Mostrarle ese bloque invita a cargar un presupuesto de obra que después
 * contradice lo que realmente se factura.
 */
export function usaEstructuraCostos(tipoTrabajo) {
  return tipoTrabajo !== 'supervision';
}

/** ¿Lleva partidas, cronograma y avance físico? Misma razón que arriba. */
export function usaPartidas(tipoTrabajo) {
  return tipoTrabajo !== 'supervision';
}

/** ¿Incluye la etapa de expediente técnico? */
export function incluyeExpediente(tipoTrabajo) {
  return tipoTrabajo === 'obra_expediente' || tipoTrabajo === 'supervision_expediente';
}
