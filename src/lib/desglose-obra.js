// ═══════════════════════════════════════════════════════════════════
// JARVEX — Desglose de un TRABAJO (tanda 2, entrega B).
//
// Cómo se parte por dentro una obra/supervisión, en los grupos que Gabriel
// nombró. Antes esto vivía en DOS lugares que se contradecían: las secciones
// del sidebar (11 encabezados: almacén, compras, maquinaria, ingeniería,
// gestión, contabilidad, ssoma, ambiental, calidad, social, rrhh) y los BLOQUES
// del Inicio. Entrar a una obra no mostraba "la obra": mostraba el menú entero.
//
// Este archivo es el ÚNICO lugar donde se decide a qué grupo pertenece cada
// página del plano OBRA. Lo consumen el Panel del trabajo (jx-trabajos) y el
// sidebar (jx-sidebar), y un test verifica que ninguna página del plano obra
// quede fuera — una página sin grupo desaparecería del panel sin que nadie lo
// note hasta que un usuario no la encuentre.
//
// DOS COSAS NUEVAS de la entrega B, y por qué están acá:
//  · CONTABILIDAD DE LA OBRA: existía, pero suelta en el bloque general. La
//    contabilidad de una obra es la de la empresa/consorcio que la ejecuta.
//  · CADENAS INTERCOMPANY: la cadena A→B→ejecutora es DE UNA OBRA, no del
//    grupo. Vivía en el bloque general de contabilidad y nunca se usó.
//
// `items` = pertenencia CANÓNICA (exclusiva: una página, un grupo) — es la que
// ordena el sidebar. `extra` = páginas que ADEMÁS tiene sentido ofrecer en la
// tarjeta del panel aunque su casa canónica sea otro grupo (los EPP son stock
// para la almacenera y seguridad para la prevencionista). Duplicar en el panel
// está bien; duplicar en el sidebar no (el mismo ítem dos veces en el menú).
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

export const GRUPOS_TRABAJO = [
  {
    id: 'almacen',
    titulo: 'Almacén',
    icon: 'package',
    color: 'var(--amber)',
    desc: 'Stock, movimientos, ubicaciones y vinculación de compras',
    items: ['materiales', 'mov-materiales', 'herramientas', 'mov-herramientas',
      'ubicaciones', 'compras-pendientes', 'caja-chica', 'evidencias', 'plantillas'],
    extra: ['epps-inventario', 'mov-epp', 'insumos-emergencia'],
  },
  {
    id: 'logistica',
    titulo: 'Logística',
    icon: 'truck',
    color: 'var(--blue)',
    desc: 'Solicitudes de insumos, requisiciones y órdenes de compra',
    items: ['solicitud-residente', 'requisiciones', 'ordenes-compra'],
  },
  {
    id: 'gestion',
    titulo: 'Gestión de obra',
    icon: 'hardHat',
    color: 'var(--green)',
    desc: 'Presupuesto, partidas, cronograma, avance, costos y valorizaciones',
    items: ['dashboard-gestion', 'panel-residente', 'importar', 'partidas', 'insumos',
      'control-consumo', 'versiones', 'cronograma', 'avance', 'movimientos-insumos',
      'aprobaciones-reporte', 'rendimiento-ingenieros', 'comparativo', 'costos',
      'valorizaciones', 'incidencias', 'activos-pesados', 'mantenimiento-programado',
      // Ingeniería de frente: el mundo entero del rol `ingeniero`. Va en Gestión
      // de Obra porque es la misma obra mirada desde el frente, no otra área.
      'dashboard-tecnico', 'mis-partidas', 'cronograma-frente', 'salidas-frente',
      'vinculacion-salidas', 'reporte-diario', 'borradores-reporte', 'mis-reportes',
      'plan-real', 'emitir-alerta'],
  },
  {
    id: 'personal',
    titulo: 'Personal y subcontratos',
    icon: 'users',
    color: 'var(--purple)',
    desc: 'Obreros, frentes, asistencia, planillas y subcontratos',
    items: ['personal', 'frentes', 'asistencia', 'personal-contratos', 'planillas',
      'cts', 'gratificaciones', 'plame',
      'subcontratistas', 'subcontratos', 'subcontrato-valorizaciones'],
    extra: ['pagos'],
  },
  {
    id: 'especiales',
    titulo: 'Secciones especiales',
    icon: 'shield',
    color: 'var(--orange)',
    desc: 'Seguridad · Ambiental · Calidad · Social',
    items: ['reporte-especialidad', 'charlas-plan', 'sctr-personal', 'inducciones',
      'charlas-seguridad', 'iperc', 'inspecciones-seguridad', 'capacitaciones',
      'epps-inventario', 'mov-epp', 'epp', 'insumos-persona', 'insumos-emergencia',
      'gestion-ambiental', 'gestion-calidad', 'gestion-social'],
  },
  {
    id: 'contabilidad-obra',
    titulo: 'Contabilidad de la obra',
    icon: 'dollar',
    color: 'var(--amber)',
    // La frase corta que explica el cambio: dentro de una obra no se elige
    // empresa a mano — la obra ya tiene su titular contable.
    desc: 'Los movimientos imputados a esta obra, con su titular contable',
    items: ['movimientos-contables', 'conciliacion-insumos', 'pagos'],
  },
  {
    id: 'cadenas',
    titulo: 'Cadenas intercompany',
    icon: 'compare',
    color: 'var(--purple)',
    desc: 'Proveedor → empresas del grupo → la ejecutora de esta obra',
    items: ['trazabilidad'],
  },
];

/** Id del grupo al que pertenece CANÓNICAMENTE una página, o null. */
export function grupoDePagina(pageId) {
  if (!pageId) return null;
  const g = GRUPOS_TRABAJO.find(x => x.items.includes(pageId));
  return g ? g.id : null;
}

/** Todas las páginas canónicas del desglose, en orden de grupo. */
export function paginasCanonicas() {
  return GRUPOS_TRABAJO.flatMap(g => g.items);
}

/**
 * Los grupos que este usuario ve, con sus páginas resueltas a {id,label,icon}.
 *
 * @param canSee  (pageId) => boolean — el MISMO gate del sidebar
 *                (__canSeeSidebarItem). Deny-by-default afuera, no acá.
 * @param info    (pageId) => { label, icon } | undefined — labels reales del
 *                menú (window.NAV), para no mantener dos juegos de nombres.
 * @returns [{ ...grupo, paginas: [{id,label,icon}] }] sin los grupos vacíos.
 */
export function gruposDelTrabajo({ canSee, info } = {}) {
  const ver = typeof canSee === 'function' ? canSee : () => true;
  const meta = typeof info === 'function' ? info : (id) => ({ label: id });
  return GRUPOS_TRABAJO.map(g => {
    const ids = [...g.items, ...(g.extra || [])];
    const vistos = new Set();
    const paginas = [];
    for (const id of ids) {
      if (vistos.has(id)) continue;       // extra que repite un item propio
      vistos.add(id);
      const m = meta(id);
      if (!m) continue;                    // página que no está en el menú real
      if (!ver(id)) continue;
      paginas.push({ id, label: m.label || id, icon: m.icon });
    }
    return { ...g, paginas };
  }).filter(g => g.paginas.length > 0);
}
