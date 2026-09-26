// ═══════════════════════════════════════════════════════════════════
// JARVEX — Catálogo de Códigos de Detracción SPOT (Anexos 2 y 3 de SUNAT).
//
// Centraliza los códigos oficiales de detracción más utilizados en el sector
// de obras de construcción y contratistas en Perú.
//
// 🔴 CORREGIDO EL 25-SET-2026 (tanda C de la revisión). El catálogo decía
// «037 — Contratos de construcción (4 %)» y «030 — Contratos de gerencia
// (10 %)». Las dos cosas estaban mal: en el Anexo 3 de SUNAT el **030 es
// Contratos de construcción al 4 %** y el **037 es «Demás servicios gravados
// con el IGV» al 12 %**. El 028 «transporte de pasajeros al 12 %» tampoco
// existe: el transporte de personas es el 026, al 10 %. Verificado contra la
// orientación de SUNAT (Apéndices del Sistema de Detracciones). Un código
// equivocado en la constancia es un depósito que SUNAT no cruza con la
// operación.
// Puro: sin React, sin dependencias.
// ═══════════════════════════════════════════════════════════════════

export const CATALOGO_SPOT = [
  {
    codigo: '030',
    tasa: 4,
    nombre: 'Contratos de construcción',
    categoria: 'Construcción',
    descripcion: 'Ejecución de obras, valorizaciones, partidas constructivas, tarrajeo, encofrado, demolición, subcontratos de obra.',
  },
  {
    codigo: '019',
    tasa: 10,
    tasasAlternativas: [4],
    nombre: 'Arrendamiento de bienes muebles',
    categoria: 'Alquiler',
    descripcion: 'Alquiler de maquinaria pesada, vehículos, retroexcavadoras, equipos (10% común, 4% como contrato de construcción).',
  },
  {
    codigo: '027',
    tasa: 4,
    nombre: 'Servicio de transporte de carga',
    categoria: 'Transporte',
    descripcion: 'Fletes, traslados de materiales, tubos, agregados y equipos.',
  },
  {
    codigo: '022',
    tasa: 12,
    nombre: 'Otros servicios empresariales',
    categoria: 'Servicios',
    descripcion: 'Consultoría, supervisión técnica, asesoría, arquitectura e ingeniería, monitoreo ambiental, ensayos de laboratorio.',
  },
  {
    codigo: '037',
    tasa: 12,
    nombre: 'Demás servicios gravados con el IGV',
    categoria: 'Servicios',
    descripcion: 'Cualquier otro servicio gravado que no tenga un código propio. NO es el de construcción (ese es el 030).',
  },
  {
    codigo: '020',
    tasa: 12,
    nombre: 'Mantenimiento y reparación de bienes muebles',
    categoria: 'Mantenimiento',
    descripcion: 'Reparación de maquinaria pesada, mantenimiento de vehículos, equipos y herramientas.',
  },
  {
    codigo: '021',
    tasa: 10,
    nombre: 'Movimiento de carga',
    categoria: 'Logística',
    descripcion: 'Estiba, desestiba, carga, descarga y manipuleo de mercadería o materiales.',
  },
  {
    codigo: '025',
    tasa: 10,
    nombre: 'Fabricación de bienes por encargo',
    categoria: 'Producción',
    descripcion: 'Maquila y confección o fabricación de estructuras metálicas o piezas a pedido.',
  },
  {
    codigo: '026',
    tasa: 10,
    nombre: 'Servicio de transporte de personas',
    categoria: 'Transporte',
    descripcion: 'Transporte terrestre de personal u operarios hacia la obra.',
  },
  {
    codigo: '012',
    tasa: 12,
    nombre: 'Intermediación laboral y tercerización',
    categoria: 'Servicios',
    descripcion: 'Destaque de personal, services, tercerización de actividades.',
  },
  {
    codigo: '009',
    tasa: 10,
    nombre: 'Arena y piedra',
    categoria: 'Bienes',
    descripcion: 'Venta de agregados: arena, piedra chancada, hormigón (Anexo 2).',
  },
];

const MAPA_SPOT = new Map(CATALOGO_SPOT.map(c => [c.codigo, c]));

/**
 * Busca un código SPOT en el catálogo oficial.
 * @param {string} codigo
 * @returns {object|null}
 */
export function buscarCodigoSpot(codigo) {
  if (!codigo) return null;
  const limpio = String(codigo).trim().padStart(3, '0');
  return MAPA_SPOT.get(limpio) || null;
}

/**
 * Devuelve la tasa oficial o estándar de un código SPOT.
 * @param {string} codigo
 * @returns {number|null}
 */
export function tasaOficialSpot(codigo) {
  const item = buscarCodigoSpot(codigo);
  return item ? item.tasa : null;
}

/** ¿Esa tasa es una de las que corresponden a ese código? null si el código no está en el catálogo. */
export function tasaCorrespondeAlCodigo(codigo, tasa) {
  const item = buscarCodigoSpot(codigo);
  if (!item) return null;
  const t = Number(tasa);
  if (!Number.isFinite(t)) return null;
  return [item.tasa, ...(item.tasasAlternativas || [])].includes(t);
}

/**
 * Etiqueta legible para selectores en la interfaz.
 * Ej: "030 — Contratos de construcción (4%)"
 * @param {object|string} itemOCodigo
 * @returns {string}
 */
export function etiquetaCodigoSpot(itemOCodigo) {
  const item = typeof itemOCodigo === 'object' && itemOCodigo !== null
    ? itemOCodigo
    : buscarCodigoSpot(itemOCodigo);
  if (!item) return String(itemOCodigo || '');
  const tasasStr = item.tasasAlternativas
    ? `${item.tasa}% o ${item.tasasAlternativas.join('%')}%`
    : `${item.tasa}%`;
  return `${item.codigo} — ${item.nombre} (${tasasStr})`;
}
