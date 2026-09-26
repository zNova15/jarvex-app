// Roles canónicos del sistema — única fuente de verdad para el lado servidor.
//
// Antes de esto había copias divergentes de esta lista en varios archivos
// (api/create-user.js sin 'licitaciones', api/asistente-solicitud.js con
// nombres que no existen: 'almacenera', 'jefe_almacen', 'residente'). Debe
// coincidir con ROL_KEYS de src/components/jx-admin.jsx (fuente de verdad del
// lado cliente, que además decide menús y permisos — no se importa desde acá
// porque /lib no puede depender de /src).
//
// IMPORTANTE: este archivo NO debe tener `export default` (ver nota de
// api-helpers.js sobre el límite de functions de Vercel).
export const ROLES_CANONICOS = [
  'admin', 'gerente', 'ingeniero_residente', 'ingeniero', 'supervisor',
  'almacenero', 'asistente_admin', 'contador', 'ayudante_contador', 'tesorero',
  'jefe_compras', 'rrhh', 'prevencionista', 'ing_ambiental', 'ing_calidad',
  'ing_social', 'maestro_obra', 'licitaciones', 'solo_lectura',
  'campo',   // cuenta compartida del portal de captura de campo (mig 155)
];

export function esRolCanonico(rol) {
  return ROLES_CANONICOS.includes(rol);
}
