// ═══════════════════════════════════════════════════════════════════
// JARVEX — Quién ESCRIBE la contabilidad y las obras (tanda B, 25-set-2026).
//
// Regla de Gabriel (respuesta 1 de la revisión Ola 1):
//   · La contabilidad la modifican solo el administrador y los roles de
//     contabilidad: la contadora jefe (contador) y las asistentes
//     (ayudante_contador).
//   · Los movimientos contables los edita DIRECTO el admin y la contadora
//     jefe; las asistentes SOLICITAN el cambio. Eso vive en la pantalla
//     (jx-contabilidad.jsx, `canEditExisting`), no acá: las asistentes sí
//     escriben la tabla en sus flujos (Captura Mágica, detracciones,
//     vínculos, Libro Diario), y cortárselo en el servidor rompía su trabajo.
//   · Las obras las modifica solo el administrador.
//   · La almacenera registra la RECEPCIÓN de las facturas: en
//     accounting_movements puede tocar solo las columnas de recepción y las
//     marcas de recibido/negado de cada ítem. Lo hace cumplir el trigger
//     `accounting_movements_solo_recepcion` de la mig 233.
//
// ESPEJO de la mig 233 (`escritura_cerco_*`). Si se cambia una lista acá, se
// cambia allá en el mismo commit: el test escritura-contable.test.js compara
// las dos y falla si difieren. Una pantalla que deja escribir a un rol que
// el servidor rechaza es peor que no dejarlo: el cambio se guarda en el
// dispositivo, la pantalla dice «listo» y el push rebota para siempre.
// ═══════════════════════════════════════════════════════════════════

/** Escriben contabilidad (movimientos, empresas, proveedores, activos…). */
export const ROLES_CONTABILIDAD = Object.freeze(['admin', 'contador', 'ayudante_contador']);

/** Modifican obras. */
export const ROLES_OBRAS = Object.freeze(['admin']);

/**
 * Registran la recepción de facturas en el almacén (Compras Pendientes,
 * ingreso con factura, «¿llegó?»). En accounting_movements SOLO pueden cambiar
 * COLUMNAS_RECEPCION y CLAVES_ITEM_RECEPCION; el servidor rechaza el resto.
 */
export const ROLES_RECEPCION = Object.freeze(['almacenero', 'supervisor', 'maestro_obra', 'jefe_compras', 'gerente']);

/** Columnas de accounting_movements que un rol de recepción puede cambiar. */
export const COLUMNAS_RECEPCION = Object.freeze([
  'recepcion_status', 'recepcion_movimiento_id', 'recepcion_fecha', 'recepcion_por',
  'recepcion_observaciones', 'recepcion_completada_at', 'recepcion_completada_por',
]);

/** Claves de cada `notas.items_factura[i]` que escribe la recepción. */
export const CLAVES_ITEM_RECEPCION = Object.freeze([
  'recibido', 'material_id', 'tipo_insumo', 'factor_conv', 'recepcion_modo', 'mov_vinculado_id',
  'rechazado', 'rechazo_motivo', 'rechazo_por', 'rechazo_fecha',
]);

/** Tabla → roles que pueden INSERT / UPDATE (el borrado físico ya era solo admin). */
export const CERCO_ESCRITURA = Object.freeze({
  accounting_movements:       { insert: ROLES_CONTABILIDAD, update: [...ROLES_CONTABILIDAD, ...ROLES_RECEPCION] },
  companies:                  { insert: ROLES_CONTABILIDAD, update: ROLES_CONTABILIDAD },
  proveedores:                { insert: ROLES_CONTABILIDAD, update: ROLES_CONTABILIDAD },
  activos_fijos:              { insert: ROLES_CONTABILIDAD, update: ROLES_CONTABILIDAD },
  transformaciones:           { insert: ROLES_CONTABILIDAD, update: ROLES_CONTABILIDAD },
  personal_cuentas_bancarias: { insert: ROLES_CONTABILIDAD, update: ROLES_CONTABILIDAD },
  obras:                      { insert: ROLES_OBRAS,        update: ROLES_OBRAS },
});

/** ¿El rol escribe contabilidad? */
export function puedeEscribirContabilidad(rol) {
  return ROLES_CONTABILIDAD.includes(String(rol || ''));
}

/** ¿El rol modifica obras? */
export function puedeEditarObras(rol) {
  return ROLES_OBRAS.includes(String(rol || ''));
}

/**
 * ¿El servidor le acepta a este rol esta operación sobre esta tabla?
 * Tablas fuera del cerco → `null` (esta lib no opina; decide la matriz).
 */
export function puedeEscribirTabla(tabla, rol, op = 'update') {
  const c = CERCO_ESCRITURA[tabla];
  if (!c) return null;
  return (c[op] || []).includes(String(rol || ''));
}

/**
 * Para el push del SyncEngine: ¿tiene sentido subir filas de esta tabla?
 * `null` si la tabla no está en el cerco.
 */
export function puedeEmpujarTabla(tabla, rol) {
  const c = CERCO_ESCRITURA[tabla];
  if (!c) return null;
  const r = String(rol || '');
  return c.insert.includes(r) || c.update.includes(r);
}
