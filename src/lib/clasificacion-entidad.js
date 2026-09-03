// ═══════════════════════════════════════════════════════════════════
// JARVEX — Clasificar el catálogo de empresas: propia | consorcio | tercero.
//
// EL PROBLEMA REAL, medido en producción el 2-sep-2026: de 17 companies
// activas, solo DOS son empresas propias del grupo. Otras dos son consorcios
// (que no deberían estar en el catálogo de empresas) y TRECE son proveedores
// que Captura Mágica creó sola al leer una factura. La pantalla "Empresas"
// muestra las 17 como si fueran hermanas.
//
// POR QUÉ ESTO ES UNA SUGERENCIA Y NO UNA MIGRACIÓN AUTOMÁTICA:
//
//   CONSORCIO ESPERANZA y CONSORCIO SAMADAY se llaman consorcio y NO lo son —
//   son proveedores autocreados. Un UPDATE por `name ILIKE '%consorcio%'` los
//   reclasificaría mal y ensuciaría la contabilidad de dos obras.
//
// De ahí la regla de diseño del módulo: **el nombre nunca decide solo**. Lo
// que distingue a un consorcio del grupo es SER EJECUTORA DE UNA OBRA; el
// nombre solo desempata entre ejecutora-consorcio y ejecutora-empresa propia.
// Y cada sugerencia viaja con la evidencia que la sustenta, para que la
// pantalla la muestre y una persona pueda contradecirla.
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

export const TIPOS_ENTIDAD = [
  { v: 'propia',    label: 'Empresa del grupo', desc: 'Sale en el catálogo de Empresas.' },
  { v: 'consorcio', label: 'Consorcio',         desc: 'Se administra desde su obra, no desde Empresas.' },
  { v: 'tercero',   label: 'Tercero',           desc: 'Proveedor o cliente. Sigue disponible en los selectores contables.' },
];

export const TIPO_ENTIDAD_LBL = Object.fromEntries(TIPOS_ENTIDAD.map(t => [t.v, t.label]));

/** Sin acentos y en minúsculas: "Mágica" y "Magica" deben coincidir. */
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const NOMBRE_CONSORCIO = /\bconsorci/i;

/** Marcas de que la fila la creó un automatismo y no una persona. */
function esAutocreada(company) {
  const n = norm(company?.notas);
  return n.includes('captura magica') || n.includes('creada automaticamente');
}

/**
 * Clasifica UNA company con su evidencia.
 *
 * @param company
 * @param obrasEjecutora  obras donde esta company es ejecutora_company_id
 * @param movs            nº de movimientos contables (para que la pantalla
 *                        muestre qué se pone en juego al reclasificar)
 */
export function sugerirTipoEntidad(company, obrasEjecutora = [], movs = 0) {
  const evidencia = {
    movs: Number(movs) || 0,
    obras: obrasEjecutora.map(o => o?.nombre_obra).filter(Boolean),
    autocreada: esAutocreada(company),
    nombreDiceConsorcio: NOMBRE_CONSORCIO.test(company?.name || '') ||
                         NOMBRE_CONSORCIO.test(company?.legal_name || ''),
    rolGrupo: company?.rol_grupo || null,
  };

  // 1. Ejecuta una obra → es del grupo. El nombre solo desempata qué clase.
  if (obrasEjecutora.length) {
    if (evidencia.nombreDiceConsorcio) {
      return { sugerido: 'consorcio', evidencia,
        motivo: `Ejecuta ${obrasEjecutora.length === 1 ? 'una obra' : `${obrasEjecutora.length} obras`} y su nombre dice consorcio.` };
    }
    return { sugerido: 'propia', evidencia, motivo: 'Ejecuta una obra del grupo.' };
  }

  // 2. No ejecuta nada y la creó un automatismo → proveedor.
  //    Acá caen ESPERANZA y SAMADAY, correctamente: se llaman consorcio pero
  //    no ejecutan ninguna obra nuestra.
  if (evidencia.autocreada || company?.rol_grupo === 'origen') {
    const porNombre = evidencia.nombreDiceConsorcio
      ? ' Se llama consorcio, pero no ejecuta ninguna obra del grupo.' : '';
    return { sugerido: 'tercero', evidencia,
      motivo: `Apareció sola desde una factura y no ejecuta obras.${porNombre}` };
  }

  // 3. Cargada a mano y sin obra: probablemente del grupo, pero sin evidencia
  //    fuerte. Que decida la persona.
  return { sugerido: 'propia', evidencia, motivo: 'Cargada a mano y sin obra asignada — revisar.' };
}

/**
 * Clasifica el catálogo entero. Devuelve una fila por company, con la
 * sugerencia, su evidencia y si difiere de lo que ya está guardado.
 *
 * @param opts.companies
 * @param opts.obras
 * @param opts.movsPorCompany  { [company_id]: n } — conteo de accounting_movements
 */
export function revisarCatalogo({ companies = [], obras = [], movsPorCompany = {} } = {}) {
  const activas = companies.filter(c => c && !c.deleted_at);
  const obrasVivas = obras.filter(o => o && !o.deleted_at);

  const filas = activas.map(c => {
    const suyas = obrasVivas.filter(o => o.ejecutora_company_id === c.id);
    const r = sugerirTipoEntidad(c, suyas, movsPorCompany[c.id] || 0);
    const actual = c.tipo_entidad || 'propia';
    return {
      company: c,
      actual,
      sugerido: r.sugerido,
      motivo: r.motivo,
      evidencia: r.evidencia,
      obrasEjecutora: suyas,
      cambia: r.sugerido !== actual,
    };
  });

  // Primero lo que cambia, y dentro de eso lo que más contabilidad mueve:
  // es el orden en que una persona quiere revisarlo.
  filas.sort((a, b) => (b.cambia ? 1 : 0) - (a.cambia ? 1 : 0)
    || b.evidencia.movs - a.evidencia.movs
    || String(a.company.name || '').localeCompare(String(b.company.name || '')));

  const resumen = { propia: 0, consorcio: 0, tercero: 0, cambian: 0, total: filas.length };
  for (const f of filas) {
    resumen[f.sugerido] = (resumen[f.sugerido] || 0) + 1;
    if (f.cambia) resumen.cambian++;
  }

  return { filas, resumen };
}

/**
 * ¿Qué hay que hacer además de marcar el tipo?
 * Marcar una company como 'consorcio' sin crearle su fila en `consorcios` la
 * dejaría fuera del catálogo de Empresas y fuera de su obra — invisible. Esta
 * función lista esos huecos para que la pantalla exija la obra antes de aplicar.
 *
 * @param decisiones  { [company_id]: 'propia'|'consorcio'|'tercero' }
 */
export function pendientesDeVincular(decisiones = {}, { companies = [], obras = [], consorcios = [] } = {}) {
  const obrasVivas = obras.filter(o => o && !o.deleted_at);
  const consVivos = consorcios.filter(c => c && !c.deleted_at);

  return Object.entries(decisiones)
    .filter(([, tipo]) => tipo === 'consorcio')
    .filter(([id]) => !consVivos.some(c => c.company_id === id))
    .map(([id]) => {
      const company = companies.find(c => c.id === id);
      // Si ya es ejecutora de una obra, esa es la obra a vincular: no hay que
      // preguntar nada.
      const sugerida = obrasVivas.find(o => o.ejecutora_company_id === id) || null;
      return { company_id: id, company, obraSugerida: sugerida };
    });
}
