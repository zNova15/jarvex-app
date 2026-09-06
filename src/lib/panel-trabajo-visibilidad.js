// ═══════════════════════════════════════════════════════════════════
// JARVEX — Quién ve los bloques sensibles del Panel del Trabajo.
//
// EL PEDIDO (Gabriel, 5-sep-2026): «hay información que no debería estar
// mostrándose a todos. El equipo de trabajo y quién ejecuta este trabajo
// debería estar netamente guardado para que lo pueda visualizar solamente el
// administrador y la jefa de contabilidad».
//
// Antes se gateaban por PERMISO DE MENÚ (`canSee('empresas')`,
// `canSee('usuarios')`, `canSee('personal')`, `canSee('movimientos-contables')`),
// que es una puerta mucho más ancha de lo que parece: cualquier rol con acceso
// a Personal veía la lista completa del equipo designado, y cualquiera con
// acceso a Movimientos Contables veía el reparto de plata de la obra entre las
// empresas del grupo.
//
// Ahora es una ALLOWLIST DE ROLES, explícita y corta. Es más restrictivo a
// propósito: ampliarla es una decisión de Gabriel, no un efecto secundario de
// darle a alguien otro permiso de menú.
//
// ⚠ ESTO ES UNA PUERTA DE INTERFAZ, NO UN CERCO DE SEGURIDAD.
// Los datos siguen llegando al navegador (la contabilidad viene del store de
// movimientos; el equipo se consulta a `obra_usuarios`). Sirve para que la
// pantalla no muestre lo que no corresponde, no para impedir que alguien
// decidido lo lea. El cerco de verdad son las policies RLS (migs 177/178).
// Si esta información pasa a ser confidencial de verdad, hay que cerrarla
// también en el servidor.
//
// Puro: sin React, sin Dexie.
// ═══════════════════════════════════════════════════════════════════

/**
 * Roles que ven los bloques sensibles del panel: el administrador y la
 * Contadora Jefe. Los dos son roles GLOBALES (ven todas las obras), así que
 * no hay que cruzarlo además con la designación a la obra.
 *
 * Para ampliarlo, agregar el rol acá — y solo acá.
 */
export const ROLES_PANEL_SENSIBLE = new Set(['admin', 'contador']);

/**
 * ¿Este rol ve "QUIÉN EJECUTA ESTE TRABAJO" + "CONTABILIDAD DE LA OBRA"
 * (el reparto por empresa) + los chips de COMPROBANTES y EGRESOS?
 */
export function puedeVerFichaTrabajo(rol) {
  return ROLES_PANEL_SENSIBLE.has(String(rol || ''));
}

/** ¿Este rol ve "EQUIPO DE ESTE TRABAJO" (quiénes están designados)? */
export function puedeVerEquipoTrabajo(rol) {
  return ROLES_PANEL_SENSIBLE.has(String(rol || ''));
}

export default { ROLES_PANEL_SENSIBLE, puedeVerFichaTrabajo, puedeVerEquipoTrabajo };
