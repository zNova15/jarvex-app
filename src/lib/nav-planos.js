// ═══════════════════════════════════════════════════════════════════
// JARVEX — Planos de navegación (General / Obra).
//
// La navegación se reorganiza en dos planos:
//  · GENERAL: global, sin obra (Empresas y su contabilidad, Proveedores,
//    Clientes, Captura Mágica, Usuarios, Configuración, dirección/ejecutivo).
//  · OBRA: workspace enfocado de UNA obra (almacén, compras, gestión de obra,
//    contabilidad de la obra, RRHH, SSOMA, ingeniería, maquinaria).
//
// El "modo" de la UI se DERIVA de la página actual (planoDe). resolveLanding
// decide a dónde aterriza cada rol al entrar. Helper PURO, unit-testeable.
// ═══════════════════════════════════════════════════════════════════

// Páginas del plano GENERAL (todo lo que no esté acá = 'obra').
export const GENERAL_ITEMS = new Set([
  'inicio', 'captura-magica', 'obras', 'dashboard', 'reportes',
  'proveedores',
  // Empresas + su contabilidad de empresa (por entidad legal, no por obra)
  'empresas', 'cont-dashboard', 'intercompany', 'trazabilidad', 'consolidado',
  'cuentas-bancarias', 'plan-cuentas', 'libro-diario', 'balance-general',
  'estado-resultados', 'comprobantes', 'libros-electronicos', 'config-sunat',
  'comparativo-periodos',
  // Dirección / Ejecutivo (vistas cross-obra)
  'dashboard-ejecutivo', 'kpis-obra', 'cumplimiento-cronograma', 'alertas', 'busqueda',
  // Administración
  'usuarios', 'roles', 'solicitudes', 'configuracion', 'conflictos', 'audit-log',
]);

/** Plano de una página: 'general' (global) | 'obra' (workspace). */
export const planoDe = (id) => GENERAL_ITEMS.has(id) ? 'general' : 'obra';

// Roles que trabajan en lo global o entre varias obras → aterrizan en Inicio.
const ROLES_GLOBALES = new Set(['admin', 'gerente', 'contador', 'ayudante_contador', 'tesorero']);

/**
 * A dónde aterriza un usuario al entrar.
 * @returns {{ page: string, obraId: string|null }}
 *   - roles globales (admin/gerente/contador/…) → Inicio.
 *   - operativos con UNA obra asignada → su workspace + su página de siempre.
 *   - operativos con 0 ó varias obras → Inicio (que elija).
 */
export function resolveLanding({ rol, obrasAsignadas = [], homePorRol = {} } = {}) {
  if (ROLES_GLOBALES.has(rol)) return { page: 'inicio', obraId: null };
  if (Array.isArray(obrasAsignadas) && obrasAsignadas.length === 1) {
    return { page: homePorRol[rol] || 'dashboard-gestion', obraId: obrasAsignadas[0] };
  }
  return { page: 'inicio', obraId: null };
}
