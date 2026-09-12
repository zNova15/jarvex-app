// ═══════════════════════════════════════════════════════════════════
// JARVEX — Catálogo de Códigos de Detracción SPOT (Anexo 3 de SUNAT).
//
// Centraliza los códigos oficiales de detracción más utilizados en el sector
// de obras de construcción y contratistas en Perú.
// Puro: sin React, sin dependencias.
// ═══════════════════════════════════════════════════════════════════

export const CATALOGO_SPOT = [
  {
    codigo: '037',
    tasa: 4,
    nombre: 'Contratos de construcción',
    categoria: 'Construcción',
    descripcion: 'Ejecución de obras, valorizaciones, partidas constructivas, tarrajeo, encofrado, demolición, etc.',
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
    nombre: 'Transporte de bienes por vía terrestre',
    categoria: 'Transporte',
    descripcion: 'Fletes, traslados de materiales, tubos, agregados y equipos.',
  },
  {
    codigo: '022',
    tasa: 12,
    nombre: 'Otros servicios empresariales / profesionales',
    categoria: 'Servicios',
    descripcion: 'Supervisión técnica, monitoreo ambiental, ensayos de laboratorio, asesoría y consultorías.',
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
    codigo: '028',
    tasa: 12,
    nombre: 'Transporte de pasajeros',
    categoria: 'Transporte',
    descripcion: 'Transporte terrestre de personal u operarios hacia la obra.',
  },
  {
    codigo: '030',
    tasa: 10,
    nombre: 'Contratos de gerencia o gestión',
    categoria: 'Gestión',
    descripcion: 'Administración y gerencia delegada de proyectos u obras.',
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

/**
 * Etiqueta legible para selectores en la interfaz.
 * Ej: "037 — Contratos de construcción (4%)"
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
