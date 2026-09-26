// ═══════════════════════════════════════════════════════════════════
// JARVEX — ¿Qué puede ver este dispositivo? (tanda E, 26-set-2026)
//
// El pull incremental guarda UN watermark por tabla y por dispositivo. Eso
// alcanza mientras lo que el usuario puede ver no cambie. Cuando cambia, el
// cursor ya está por delante de filas que recién ahora le corresponden, y
// nunca las baja:
//   · a un ingeniero le designan otra obra (existente): el histórico de esa
//     obra tiene updated_at viejos → invisibles hasta un «Forzar resync»;
//   · en una PC compartida entra otra persona (Gabriel, 25-set: «hay PCs
//     compartidas por turnos»): hereda los datos del anterior y un cursor que
//     avanzó bajo OTRA RLS;
//   · a un rol se le cierra una tabla en el servidor (mig 234, cuentas
//     bancarias del personal): el pull deja de traerla, pero la copia local
//     queda para siempre.
//
// Este módulo es la parte PURA de esa decisión. El SyncEngine la aplica:
//   · otro usuario en el dispositivo → se borra lo sincronizado del anterior
//     (nunca lo pendiente: es trabajo sin subir) y se resetean los cursores;
//   · mismo usuario con otro rol u otras obras → se resetean los cursores
//     (full pull con reconcile: baja lo nuevo y quita lo que ya no ve);
//   · tablas que el rol no lee → se vacía la copia local.
// El alcance lo dice el SERVIDOR (`__yo` de sync_pull, mig 235): es lo mismo
// que usa la RLS, no lo que el cliente cree.
// ═══════════════════════════════════════════════════════════════════
import { ROLES_CONTABILIDAD } from './escritura-contable.js';

/**
 * Huella del alcance que devolvió sync_pull. null si la respuesta no la trae
 * (servidor sin la mig 235): sin huella no se decide nada.
 * Los roles globales no dependen de sus obras (es_rol_global() pasa el cerco
 * de obra), así que el servidor manda `obras: null` y la huella lo refleja.
 */
export function firmaAlcance(yo) {
  if (!yo || typeof yo !== 'object' || Array.isArray(yo)) return null;
  const rol = typeof yo.rol === 'string' ? yo.rol : '';
  const obras = Array.isArray(yo.obras)
    ? [...yo.obras].map(String).sort().join(',')
    : '*';
  return `${rol}|${yo.global ? 'global' : 'obra'}|${obras}`;
}

/**
 * ¿Quién usó este dispositivo la última vez?
 *   'primera' → no hay registro (dispositivo nuevo o primera vez con esta
 *               versión): se anota y no se toca nada — no se sabe de quién
 *               son los datos, y asumir otro usuario costaría una re-descarga
 *               completa en cada equipo el día del deploy.
 *   'mismo'   → sigue el mismo usuario.
 *   'otro'    → entró otra persona.
 */
export function decidirPorUsuario(guardado, uid) {
  if (!uid) return 'mismo';
  if (!guardado?.uid) return 'primera';
  return guardado.uid === uid ? 'mismo' : 'otro';
}

/**
 * ¿Cambió lo que el servidor le deja ver?
 *   'primera' → no había huella guardada: se anota.
 *   'igual'   → nada que hacer.
 *   'cambio'  → otro rol u otras obras: re-bajar todo.
 */
export function decidirPorAlcance(guardado, firma) {
  if (!firma) return 'igual';
  if (!guardado?.firma) return 'primera';
  return guardado.firma === firma ? 'igual' : 'cambio';
}

// ── Tablas que el servidor NO deja leer a todos ────────────────────────
// ESPEJO de los cercos de LECTURA por rol (`lectura_cerco_select`). Hoy solo
// la mig 234: las cuentas bancarias del personal las leen admin, contador y
// ayudante_contador. El test alcance-sync.test.js compara con la migración.
export const CERCO_LECTURA = Object.freeze({
  personal_cuentas_bancarias: ROLES_CONTABILIDAD,
});

/** Tablas que el rol NO puede leer en el servidor (su copia local sobra). */
export function tablasQueElRolNoLee(rol) {
  if (!rol) return [];
  return Object.entries(CERCO_LECTURA)
    .filter(([, roles]) => !roles.includes(rol))
    .map(([tabla]) => tabla);
}

// Estados de una fila local que NO se pueden borrar: trabajo que todavía no
// llegó al servidor (o que espera que alguien resuelva un conflicto). Las
// evidencias suman los estados de su propio pipeline de subida.
export const ESTADOS_QUE_NO_SE_BORRAN = Object.freeze([
  'pending_create', 'pending_update', 'pending_delete', 'failed', 'conflict',
  'pending_upload', 'uploaded',
]);

/** ¿Esta fila local se puede descartar porque se vuelve a bajar del server? */
export function filaDescartable(fila) {
  if (!fila || fila.demo === true) return false;
  return !ESTADOS_QUE_NO_SE_BORRAN.includes(fila.sync_status);
}
