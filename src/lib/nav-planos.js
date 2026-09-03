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
  'inicio', 'captura-magica', 'captura-campo', 'obras', 'dashboard', 'reportes',
  // Trabajos es la entrada de primer nivel: lista obras, supervisiones y
  // bienes/servicios. No puede exigir obra activa — es donde se elige.
  'trabajos',
  'proveedores',
  // Empresas + su contabilidad de empresa (por entidad legal, no por obra).
  // Flujo de caja/proyectado son por-empresa (cronograma_pagos no tiene obra_id).
  // 'trazabilidad' YA NO está acá: la cadena intercompany es de UNA obra
  // (tanda 2, entrega B) → plano obra, dentro del workspace del trabajo.
  // 'contabilidad' es el BLOQUE principal: el resumen de la contabilidad de
  // cada entidad (empresas y trabajos) con el vínculo a cada una (tanda 2D).
  'empresas', 'contabilidad', 'cont-dashboard', 'intercompany', 'consolidado',
  // Un bien o servicio NO pertenece a ninguna obra: si no está acá, la app le
  // exige obra activa para abrirlo.
  'bienes-servicios',
  'cuentas-bancarias', 'plan-cuentas', 'libro-diario', 'balance-general',
  'estado-resultados', 'comprobantes', 'libros-electronicos', 'config-sunat',
  'comparativo-periodos', 'flujo-caja', 'flujo-proyectado', 'compras-categoria', 'ordenes-intercompany', 'guias-remision',
  'analisis-insumos',   // análisis global cross-obra de compras por insumo/proveedor
  // Plantel profesional para postular: es del GRUPO, no de una obra. Sin esta
  // línea planoDe() lo daba por 'obra' y el sidebar lo filtraba en el plano
  // general — el ítem existía en el menú y NO se veía nunca.
  'profesionales',
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
  contabilidad: new Set(['contabilidad', 'cont-dashboard', 'empresas', 'bienes-servicios', 'movimientos-contables', 'intercompany',
    'consolidado', 'cuentas-bancarias', 'flujo-caja', 'flujo-proyectado',
    'plan-cuentas', 'libro-diario', 'balance-general', 'estado-resultados', 'comprobantes',
    'libros-electronicos', 'config-sunat', 'comparativo-periodos', 'compras-categoria', 'ordenes-intercompany', 'guias-remision',
    'analisis-insumos']),
  // Trabajos y su ficha: el área a la que se entra desde el bloque Trabajos.
  trabajos: new Set(['trabajos', 'obras', 'bienes-servicios']),
  // Licitaciones: el bloque de primer nivel de la tanda 2. Hoy solo el
  // Registro Profesional; el buscador de procesos a postular todavía no existe.
  licitaciones: new Set(['profesionales']),
  direccion: new Set(['dashboard-ejecutivo', 'kpis-obra', 'cumplimiento-cronograma', 'alertas', 'busqueda']),
  admin: new Set(['usuarios', 'roles', 'solicitudes', 'configuracion', 'conflictos', 'audit-log']),
};

/** Área general de una página: 'contabilidad' | 'trabajos' | 'licitaciones' | 'direccion' | 'admin' | 'general'. */
export const areaDe = (id) => {
  for (const a in AREA) if (AREA[a].has(id)) return a;
  return 'general';
};

// Roles que trabajan en lo global o entre varias obras → aterrizan en Inicio.
// ESPEJO de ROLES_GLOBALES en obras-asignadas.js (que decide qué obras ve) y
// de es_rol_global() en la mig 175 (que lo hace cumplir en el servidor).
const ROLES_GLOBALES = new Set(['admin', 'gerente', 'contador', 'ayudante_contador', 'tesorero', 'licitaciones']);

/**
 * A dónde aterriza un usuario al entrar.
 *
 * Reescrito en la tanda 2D (pedido de Gabriel, 3-sep-2026): un usuario de obra
 * NO tiene por qué pasar por la pantalla de bloques del grupo — de esos cinco
 * bloques solo puede abrir uno. Entra a lo suyo:
 *
 * @returns {{ page: string, obraId: string|null }}
 *   - rol campo → su portal de captura (lo único que puede usar).
 *   - roles GLOBALES (admin/gerente/contadora/…) → Inicio, los cinco bloques.
 *   - rol de OBRA con UNA obra → DIRECTO al desglose de esa obra (panel-obra).
 *   - rol de OBRA con varias → la lista de SUS trabajos, para que elija.
 *   - rol de OBRA sin ninguna → también la lista, que es donde la pantalla le
 *     dice que no tiene trabajos asignados y a quién pedirle acceso. Nunca al
 *     Inicio: un almacenero sin obras ahí veía bloques que no puede abrir.
 */
export function resolveLanding({ rol, obrasAsignadas = [] } = {}) {
  // Rol campo (cuenta compartida con PIN): aterriza DIRECTO en el portal de
  // captura — es lo único que puede usar.
  if (rol === 'campo') return { page: 'captura-campo', obraId: null };
  if (ROLES_GLOBALES.has(rol)) return { page: 'inicio', obraId: null };
  if (!rol) return { page: 'inicio', obraId: null };
  const asignadas = Array.isArray(obrasAsignadas) ? obrasAsignadas : [];
  // Una sola obra: el desglose del trabajo, no la página suelta de su rol. El
  // panel es un lanzador que ya solo ofrece las secciones que ese rol puede
  // abrir, así que sirve igual para la almacenera que para la prevencionista.
  if (asignadas.length === 1) return { page: 'panel-obra', obraId: asignadas[0] };
  return { page: 'trabajos', obraId: null };
}
