// ═══════════════════════════════════════════════════════════════════
// JARVEX — Desglose de una EMPRESA (tanda 2E).
//
// El pedido de Gabriel, textual (3-sep-2026, probando staging):
//   «cada empresa va a tener su desglose al igual que las obras que tienen sus
//    propias secciones […] tú estás haciendo simplemente el desglose de la
//    parte contable y eso está mal».
//
// La entrega 2C había resuelto la mitad: una ficha con cuatro pestañas, toda
// contable. Una empresa del grupo es más que sus libros — tiene su identidad
// legal, su plata en bancos, su gente, sus trabajos, sus equipos y sus
// documentos ante SUNAT. Este archivo es el ESPEJO de `desglose-obra.js`: la
// única fuente de verdad de en qué se parte una empresa, para que el Panel de
// la empresa y el menú no se contradigan.
//
// DOS CLASES DE SECCIÓN, y la diferencia importa:
//   · `interna`  — se dibuja DENTRO del panel (la empresa ya está elegida, no
//     hay a dónde navegar). Son las que viven en jx-empresa-detalle.jsx.
//   · `pagina`   — abre una pantalla que ya existe en el menú. Al entrar se
//     deja la empresa elegida en `window.__empresaActivaId` para que esa
//     pantalla pueda preseleccionarla.
//
// `permiso` = el id de página cuyo permiso gobierna la sección. Se pasa por el
// MISMO gate del sidebar (`__canSeeSidebarItem`), así nadie ve una tarjeta que
// después muere en "Sin acceso" — igual que en el Panel del trabajo.
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

export const SECCIONES_EMPRESA = [
  {
    id: 'ficha',
    titulo: 'Ficha de la empresa',
    icon: 'building',
    color: 'var(--purple)',
    desc: 'RUC, razón social, régimen tributario, representante legal y domicilio fiscal',
    tipo: 'interna',
    permiso: 'empresas',
  },
  {
    id: 'contabilidad',
    titulo: 'Contabilidad',
    icon: 'dollar',
    color: 'var(--green)',
    desc: 'Ingresos, costos, gastos y utilidad de esta entidad legal',
    tipo: 'interna',
    permiso: 'movimientos-contables',
  },
  {
    id: 'inventario',
    titulo: 'Compras e inventario',
    icon: 'package',
    color: 'var(--amber)',
    desc: 'Qué compró: insumos, cantidades, proveedores y última compra',
    tipo: 'interna',
    permiso: 'empresas',
  },
  {
    id: 'personal',
    titulo: 'Personal',
    icon: 'users',
    color: 'var(--purple)',
    desc: 'La gente de los trabajos que ejecuta, agrupada por forma de pago',
    tipo: 'interna',
    permiso: 'personal',
  },
  {
    id: 'trabajos',
    titulo: 'Trabajos',
    icon: 'hardHat',
    color: 'var(--amber)',
    desc: 'Obras y bienes/servicios que ejecuta o de los que es socia',
    tipo: 'interna',
    permiso: 'trabajos',
  },
  {
    id: 'tesoreria',
    titulo: 'Tesorería',
    icon: 'dollar',
    color: 'var(--blue)',
    desc: 'Cuentas bancarias de la empresa y sus pagos programados',
    tipo: 'interna',
    permiso: 'cuentas-bancarias',
    // El hook ya acepta company_id, así que la vista se arma acá adentro; el
    // enlace lleva a la pantalla completa para operar.
    verMas: 'cuentas-bancarias',
  },
  {
    id: 'equipos',
    titulo: 'Equipos y maquinaria',
    icon: 'tool',
    color: 'var(--orange)',
    desc: 'Activos pesados a nombre de esta empresa',
    tipo: 'interna',
    permiso: 'activos-pesados',
    verMas: 'activos-pesados',
  },
  {
    id: 'documentos',
    titulo: 'Documentos y SUNAT',
    icon: 'file',
    color: 'var(--blue)',
    desc: 'Comprobantes electrónicos y guías de remisión de esta empresa',
    // Única sección que NAVEGA: los comprobantes tienen su propia pantalla con
    // filtros, descargas y validación — replicarla acá sería mantener dos.
    tipo: 'pagina',
    pagina: 'comprobantes',
    permiso: 'comprobantes',
  },
];

/** Las secciones INTERNAS, que son las pestañas del detalle de empresa. */
export const SECCIONES_INTERNAS = SECCIONES_EMPRESA
  .filter(s => s.tipo === 'interna')
  .map(s => s.id);

/** Una sección por id. */
export function seccionEmpresa(id) {
  return SECCIONES_EMPRESA.find(s => s.id === id) || null;
}

/**
 * Las secciones que este usuario ve.
 * @param canSee (pageId) => boolean — el MISMO gate del sidebar.
 * @returns las secciones permitidas, en orden.
 */
export function seccionesDeEmpresa({ canSee } = {}) {
  const ver = typeof canSee === 'function' ? canSee : () => true;
  return SECCIONES_EMPRESA.filter(s => ver(s.permiso));
}

/**
 * Las tres clases de entidad del catálogo, que es como Gabriel quiere ver la
 * lista: en bloques, separadas por lo que cada una ES.
 *
 * ESPEJO del CHECK companies_tipo_entidad_check (mig 172).
 */
export const CATEGORIAS_EMPRESA = [
  {
    v: 'propia',
    label: 'Empresas del grupo',
    desc: 'Las nuestras: llevan libros propios y ejecutan trabajos.',
    badge: 'b-green',
  },
  {
    v: 'consorcio',
    label: 'Consorcios',
    desc: 'Nacen con la buena pro de una obra. Su contabilidad se lleva en el trabajo que ejecutan.',
    badge: 'b-amber',
  },
  {
    v: 'tercero',
    label: 'Terceros',
    desc: 'Proveedores y clientes. No se les lleva contabilidad.',
    badge: 'b-gray',
  },
];

export const CATEGORIA_EMPRESA_LABEL = Object.fromEntries(CATEGORIAS_EMPRESA.map(c => [c.v, c.label]));

/** Categoría efectiva de una company (default 'propia', como el DEFAULT de la mig 172). */
export function categoriaDeEmpresa(company) {
  const t = company?.tipo_entidad || 'propia';
  return CATEGORIA_EMPRESA_LABEL[t] ? t : 'propia';
}

/**
 * Agrupa el catálogo en las tres categorías, ya filtrado y ordenado.
 * @param companies filas de companies
 * @param texto     búsqueda por nombre / razón social / RUC
 * @returns [{ ...categoria, empresas: [] }] — incluye las categorías vacías
 *          para que la pantalla pueda decir "no hay consorcios todavía".
 */
export function empresasPorCategoria(companies, { texto = '' } = {}) {
  const q = String(texto || '').trim().toLowerCase();
  const vivas = (Array.isArray(companies) ? companies : [])
    .filter(c => c && !c.deleted_at)
    .filter(c => !q || [c.name, c.legal_name, c.ruc, c.nombre_corto]
      .some(v => String(v || '').toLowerCase().includes(q)));

  return CATEGORIAS_EMPRESA.map(cat => ({
    ...cat,
    empresas: vivas
      .filter(c => categoriaDeEmpresa(c) === cat.v)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
  }));
}
