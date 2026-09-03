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
// La primera versión de este archivo (2-sep) daba por sentado que un consorcio
// del grupo SIEMPRE es ejecutora de una obra, y mandaba a 'tercero' todo lo que
// no ejecutara nada. Gabriel lo corrigió el 3-sep: CONSORCIO ESPERANZA
// (S/209.960 en 47 movimientos) y CONSORCIO SAMADAY (S/47.393 en 12) SÍ son
// consorcios del grupo — terminaron su obra y siguen abiertos porque les falta
// bancarizar. Sus obras nunca se cargaron en la app, así que 42 de 47 y 10 de
// 12 movimientos quedaron sin obra_id.
//
// LECCIÓN: "no ejecuta ninguna obra" NO significa "no es del grupo". Un
// consorcio disuelto es exactamente eso.
//
// Y una segunda, más incómoda: NO HAY NINGUNA SEÑAL EN LOS DATOS que separe
// con seguridad una empresa del grupo de un tercero. Las 17 companies activas
// tienen movimientos propios como `company_id`, tanto las del grupo como los
// proveedores que el OCR creó solo; y siete son personas naturales (RUC 10…)
// del entorno familiar, que bien pueden ser del grupo.
//
// De ahí la regla de diseño: **este módulo solo sugiere cuando tiene evidencia
// fuerte, y calla cuando no la tiene.** Sugerir con confianza algo que no se
// puede saber es peor que no sugerir: invita a aceptar en lote una
// clasificación equivocada. Los casos sin evidencia salen con `sugerido: null`
// para que la pantalla los pida explícitamente.
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
  const ruc = String(company?.ruc || '').replace(/\D/g, '');
  const evidencia = {
    movs: Number(movs) || 0,
    obras: obrasEjecutora.map(o => o?.nombre_obra).filter(Boolean),
    autocreada: esAutocreada(company),
    nombreDiceConsorcio: NOMBRE_CONSORCIO.test(company?.name || '') ||
                         NOMBRE_CONSORCIO.test(company?.legal_name || ''),
    rolGrupo: company?.rol_grupo || null,
    // RUC 10… = persona natural, 20… = jurídica. En este grupo hay siete
    // personas naturales del entorno familiar: el dato ayuda a decidir a mano.
    personaNatural: ruc.startsWith('10'),
  };

  // ── Evidencia FUERTE 1: se llama consorcio.
  // En Perú un consorcio se llama consorcio: es la señal más confiable que hay,
  // y a diferencia de "ejecuta una obra" sigue valiendo cuando ya se disolvió.
  // Un proveedor que se llame así es posible, y para eso está la pantalla.
  if (evidencia.nombreDiceConsorcio) {
    const cola = obrasEjecutora.length
      ? ` Ejecuta ${obrasEjecutora.length === 1 ? 'una obra' : `${obrasEjecutora.length} obras`}.`
      : ' No figura ejecutando ninguna obra: puede ser uno ya terminado.';
    return { sugerido: 'consorcio', confianza: 'alta', evidencia,
      motivo: `Su nombre dice consorcio.${cola}` };
  }

  // ── Evidencia FUERTE 2: ejecuta una obra del grupo y no se llama consorcio.
  if (obrasEjecutora.length) {
    return { sugerido: 'propia', confianza: 'alta', evidencia,
      motivo: 'Ejecuta una obra del grupo.' };
  }

  // ── Sin evidencia fuerte: NO se sugiere nada.
  // Que la creara el OCR es un indicio de tercero, no una prueba: también se
  // autocrearon empresas que sí son del grupo. Se muestra el indicio y decide
  // una persona.
  const pistas = [];
  if (evidencia.autocreada) pistas.push('la creó Captura Mágica al leer una factura');
  if (company?.rol_grupo === 'origen') pistas.push('está marcada como origen de cadena');
  if (evidencia.personaNatural) pistas.push('el RUC es de persona natural');
  if (evidencia.movs) pistas.push(`tiene ${evidencia.movs} movimientos a su nombre`);

  return {
    sugerido: null, confianza: 'ninguna', evidencia,
    motivo: pistas.length
      ? `Sin evidencia concluyente: ${pistas.join('; ')}.`
      : 'Sin evidencia concluyente: no ejecuta obras ni tiene movimientos.',
  };
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
      confianza: r.confianza,
      motivo: r.motivo,
      evidencia: r.evidencia,
      obrasEjecutora: suyas,
      // Sin sugerencia no hay cambio propuesto: se deja como está hasta que
      // una persona decida.
      cambia: r.sugerido != null && r.sugerido !== actual,
      requiereDecision: r.sugerido == null,
    };
  });

  // Primero lo que cambia, y dentro de eso lo que más contabilidad mueve:
  // es el orden en que una persona quiere revisarlo.
  filas.sort((a, b) => (b.requiereDecision ? 1 : 0) - (a.requiereDecision ? 1 : 0)
    || (b.cambia ? 1 : 0) - (a.cambia ? 1 : 0)
    || b.evidencia.movs - a.evidencia.movs
    || String(a.company.name || '').localeCompare(String(b.company.name || '')));

  const resumen = { propia: 0, consorcio: 0, tercero: 0, cambian: 0, sinDecidir: 0, total: filas.length };
  for (const f of filas) {
    if (f.sugerido) resumen[f.sugerido] = (resumen[f.sugerido] || 0) + 1;
    else resumen.sinDecidir++;
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
