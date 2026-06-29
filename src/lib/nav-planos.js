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
  // Empresas + su contabilidad de empresa (por entidad legal, no por obra).
  // Flujo de caja/proyectado son por-empresa (cronograma_pagos no tiene obra_id).
  'empresas', 'cont-dashboard', 'intercompany', 'trazabilidad', 'consolidado',
  'cuentas-bancarias', 'plan-cuentas', 'libro-diario', 'balance-general',
  'estado-resultados', 'comprobantes', 'libros-electronicos', 'config-sunat',
  'comparativo-periodos', 'flujo-caja', 'flujo-proyectado',
  // Dirección / Ejecutivo (vistas cross-obra)
  'dashboard-ejecutivo', 'kpis-obra', 'cumplimiento-cronograma', 'alertas', 'busqueda',
  // Administración
  'usuarios', 'roles', 'solicitudes', 'configuracion', 'conflictos', 'audit-log',
]);

/** Plano de una página: 'general' (global) | 'obra' (workspace). */
export const planoDe = (id) => GENERAL_ITEMS.has(id) ? 'general' : 'obra';

// ── ÁREAS del plano GENERAL ────────────────────────────────────────
// El plano general se sub-divide en áreas para que el sidebar muestre SOLO la
// relevante (entrar a "Contabilidad" no debe mostrar Administración). El área de
// una página se usa solo cuando estás en el plano general.
// 'movimientos-contables' es plano 'obra' por defecto (workspace, scopeado a la
// obra) pero también se ofrece en el área 'contabilidad' (vista general con
// selector) — por eso figura acá.
const AREA = {
  contabilidad: new Set(['cont-dashboard', 'empresas', 'movimientos-contables', 'intercompany',
    'trazabilidad', 'consolidado', 'cuentas-bancarias', 'flujo-caja', 'flujo-proyectado',
    'plan-cuentas', 'libro-diario', 'balance-general', 'estado-resultados', 'comprobantes',
    'libros-electronicos', 'config-sunat', 'comparativo-periodos']),
  direccion: new Set(['dashboard-ejecutivo', 'kpis-obra', 'cumplimiento-cronograma', 'alertas', 'busqueda']),
  admin: new Set(['usuarios', 'roles', 'solicitudes', 'configuracion', 'conflictos', 'audit-log']),
};

/** Área general de una página: 'contabilidad' | 'direccion' | 'admin' | 'general'. */
export const areaDe = (id) => {
  for (const a in AREA) if (AREA[a].has(id)) return a;
  return 'general';
};

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
