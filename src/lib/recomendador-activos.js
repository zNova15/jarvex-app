// ═══════════════════════════════════════════════════════════════════
// JARVEX — RECOMENDADOR DE ACTIVOS FIJOS (tanda 7).
//
// Gabriel, 6-sep-2026:
//   «Que exista un botón que nos permita revisar qué es lo que hemos comprado
//    en las diferentes empresas y poder sacar sus activos fijos, o al menos una
//    recomendación […] Se debe analizar qué es, porque podría o bien revenderse
//    o ser parte de uso de la empresa para transformarla en otro insumo
//    (planchas metálicas por ejemplo a láminas más pequeñas). Las máquinas
//    suelen ser activos sí.»
//
// ── EL CRITERIO ES EL DESTINO DEL BIEN, NO EL MONTO ────────────────
// El umbral de 1/4 de UIT decide si se PUEDE mandar a gasto, no si la cosa es
// un activo. Y por sí solo no sirve, medido: de las 2.440 líneas de compra,
// 27 pasan el umbral y ONCE NO SON BIENES (dos anticipos de cliente por
// S/ 127 mil, una limpieza de local, copias y escaneos, alojamiento…). Peor:
// JARVEX no tiene NI UNA línea sobre el umbral, así que los generadores KAILI
// —el caso que Gabriel pidió con nombre propio— no aparecerían nunca.
//
// Por eso hay cuatro cajones y el monto es solo un dato más:
//   · activo_uso  — la empresa lo usa y dura más de un ejercicio
//   · reventa     — se compró para vender
//   · transforma  — entra de una forma y sale de otra (las planchas)
//   · gasto       — se consume
//
// ── LA REGLA SE VALIDÓ CONTRA PRODUCCIÓN ANTES DE ESCRIBIRSE ───────
// `tipo_insumo` está en las 2.440 líneas y es la señal más fuerte que hay:
//   maquinaria    4 líneas — las 4 son activos reales (3 KAILI + 1 martillo)
//   herramienta  64 líneas — 6 sobre S/ 300; 5 activos y 1 «REPARACION DE
//                            NIVEL», que es un servicio mal tipado
//   servicio    415 líneas — NUNCA es un activo
//   epp          61 líneas — consumible
//   material  1.896 líneas — el cajón difícil: acá conviven la moto SSENDA y
//                            un cilindro de thinner de 55 galones
//
// ── LA DISCIPLINA QUE ORDENA TODO: NO PROPONER SIN SEÑAL ───────────
// Una línea sin señal clara sale como «sin propuesta», no como gasto. El
// escáner de facturas enseñó la lección: una herramienta que se equivoca seguido
// deja de abrirse. Es preferible proponer poco y bien.
//
// NADA se consolida solo. Es condición explícita de Gabriel: «obviamente, como
// recomendación, y sin llegar a consolidarlo, sin que se acepte por parte de
// una contadora».
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

export const CAJON = {
  ACTIVO: 'activo_uso',
  REVENTA: 'reventa',
  TRANSFORMA: 'transforma',
  GASTO: 'gasto',
  SIN_PROPUESTA: 'sin_propuesta',
};

export const CAJON_LABEL = {
  activo_uso: 'Activo de uso',
  reventa: 'Para reventa',
  transforma: 'Insumo que se transforma',
  gasto: 'Gasto',
  sin_propuesta: 'Sin propuesta',
};

/**
 * Piso para proponer un activo. NO es el umbral legal: es el filtro que evita
 * proponer una llave de 12 soles. El umbral de 1/4 de UIT se muestra aparte,
 * como dato, porque Gabriel decidió activar incluso por debajo.
 */
export const PISO_ACTIVO = 300;

/**
 * 1/4 de UIT — el monto del art. 23 del Reglamento de la LIR por debajo del
 * cual un bien PUEDE mandarse a gasto (es facultad, no obligación).
 *
 * ⚠️ La UIT 2026 hay que CONFIRMARLA con la contadora. Se deja configurable a
 * propósito: un número legal que cambia cada año no puede vivir hardcodeado, y
 * equivocarlo movería la propuesta de cada fila.
 */
export const UIT_POR_ANIO = { 2024: 5150, 2025: 5350, 2026: 5500 };
export function umbralActivoFijo(anio, uitPorAnio = UIT_POR_ANIO) {
  const uit = uitPorAnio[anio] ?? uitPorAnio[Math.max(...Object.keys(uitPorAnio).map(Number))];
  return uit ? uit / 4 : null;
}

const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');   // sin tildes

/**
 * Busca palabras con LÍMITE AL INICIO, no como subcadena suelta.
 *
 * No es un detalle: con `includes()`, «foto-COPIA-dora» hacía match con
 * «copia» de la lista de no-bienes, y la fotocopiadora Konica de S/ 6.186
 * salía clasificada como gasto. Lo cazó el test antes de que llegara a la
 * pantalla.
 *
 * El límite va solo al INICIO a propósito: así «copia» agarra «copias» y
 * «escaneo» agarra «escaneos», que es lo que se necesita, sin comerse las
 * palabras que solo contienen el fragmento por dentro.
 */
const rx = (palabras) => new RegExp(
  '\\b(?:' + palabras.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');

const tiene = (txt, regex) => regex.test(txt);

// ── LO QUE NUNCA ES UN ACTIVO ──────────────────────────────────────
// Sacado de las 27 líneas reales que pasan el umbral: once no son bienes.
const NO_ES_BIEN = [
  'anticipo', 'adelanto', 'a cuenta',
  'copia', 'escaneo', 'ploteo', 'impresion de plano',
  'alojamiento', 'hospedaje', 'viatico',
  'limpieza', 'acondicionamiento',
  'apoyo en', 'servicio de', 'por el servicio', 'reparacion de', 'mantenimiento de',
  'flete', 'transporte', 'alquiler', 'arrendamiento',
];

// Consumibles que llegan en envases grandes y por eso pasan cualquier umbral.
const CONSUMIBLE = [
  'thinner', 'pintura', 'combustible', 'petroleo', 'diesel', 'gasolina',
  'cilindro', 'galon', 'balde', 'aceite', 'grasa', 'soldadura', 'oxigeno',
];

// ── LO QUE SÍ SUELE SERLO ──────────────────────────────────────────
// Familias durables, tomadas de lo que de verdad compró el grupo.
const FAMILIAS_DURABLES = [
  // cómputo y comunicaciones
  'laptop', 'notebook', 'computadora', 'cpu', 'monitor', 'lenovo', 'macbook',
  'impresora', 'fotocopiadora', 'multifuncional', 'scanner', 'proyector',
  'celular', 'smartphone', 'galaxy', 'iphone', 'tablet',
  // vehículos
  'moto', 'motocicleta', 'motocarga', 'trimoto', 'camioneta', 'vehiculo', 'furgon',
  // equipos de taller y obra
  'generador', 'compresora', 'vibrador', 'mezcladora', 'trompo', 'winche',
  'soldadora', 'amoladora', 'taladro', 'rotomartillo', 'sierra', 'nivel laser',
  'teodolito', 'estacion total', 'bomba', 'motobomba', 'aspiradora',
  'sublimadora', 'maquina de', 'pistola de calor', 'martillo demoledor',
  // muebles y electrodomésticos
  'escritorio', 'vitrina', 'estante', 'repisa', 'armario', 'anaquel',
  'refrigeradora', 'congeladora', 'aire acondicionado', 'mueble', 'silla',
];

// Unidades a granel: lo que se mide así se consume o se transforma.
const RX_NO_ES_BIEN = rx(NO_ES_BIEN);
const RX_CONSUMIBLE = rx(CONSUMIBLE);
const RX_DURABLES  = rx(FAMILIAS_DURABLES);

const UNIDAD_GRANEL = ['kg', 'kilo', 'm', 'ml', 'm2', 'm3', 'gal', 'lt', 'l', 'ton', 'bolsa', 'bol', 'saco'];

/**
 * Propone un cajón para UNA línea de factura.
 *
 * @param linea  { descripcion, tipo_insumo, cantidad, unidad, precio_unitario }
 * @returns { cajon, confianza: 'alta'|'media', motivo } — o cajon SIN_PROPUESTA.
 */
export function clasificarLinea(linea) {
  const d = norm(linea?.descripcion);
  const tipo = String(linea?.tipo_insumo || '').toLowerCase();
  const pu = Number(linea?.precio_unitario);
  const cant = Number(linea?.cantidad);
  const und = norm(linea?.unidad);

  if (!d) return { cajon: CAJON.SIN_PROPUESTA, confianza: 'media', motivo: 'La línea no tiene descripción.' };

  // 1. Un servicio no es un bien: no se activa ni se revende. Nunca.
  if (tipo === 'servicio') {
    return { cajon: CAJON.GASTO, confianza: 'alta', motivo: 'Es un servicio: no es un bien que se pueda activar.' };
  }
  // 2. Lo que el texto delata como no-bien, aunque venga tipado como material.
  //    Acá caen los dos anticipos de cliente por S/ 127 mil.
  if (tiene(d, RX_NO_ES_BIEN)) {
    return { cajon: CAJON.GASTO, confianza: 'alta', motivo: 'Por la descripción no es un bien, es un servicio o un movimiento de dinero.' };
  }
  // 3. Consumibles en envase grande: pasan cualquier umbral y no son activos.
  if (tiene(d, RX_CONSUMIBLE)) {
    return { cajon: CAJON.GASTO, confianza: 'alta', motivo: 'Es un consumible: se gasta con el uso.' };
  }
  // 4. EPP: se entrega y se consume.
  if (tipo === 'epp') {
    return { cajon: CAJON.GASTO, confianza: 'alta', motivo: 'Es equipo de protección personal: se entrega y se consume.' };
  }

  const durable = tiene(d, RX_DURABLES);

  // 5. La señal más fuerte que hay: `tipo_insumo = maquinaria`. Las 4 líneas
  //    reales de producción son las 4 máquinas de JARVEX.
  if (tipo === 'maquinaria') {
    return { cajon: CAJON.ACTIVO, confianza: 'alta', motivo: 'Está cargado como maquinaria: una máquina se usa por años.' };
  }
  // 6. Herramienta cara: dura más de un ejercicio.
  if (tipo === 'herramienta' && Number.isFinite(pu) && pu >= PISO_ACTIVO) {
    return { cajon: CAJON.ACTIVO, confianza: durable ? 'alta' : 'media',
      motivo: `Es una herramienta de ${pu.toFixed(2)} por unidad: dura más de un ejercicio.` };
  }
  // 7. Material que pertenece a una familia durable (la moto, las laptops,
  //    la fotocopiadora, los muebles).
  if (durable && Number.isFinite(pu) && pu >= PISO_ACTIVO) {
    return { cajon: CAJON.ACTIVO, confianza: 'alta',
      motivo: 'Por lo que es, se usa durante años y no se consume.' };
  }

  // 8. A granel y en cantidad: material de obra. Se transforma o se revende, y
  //    cuál de las dos lo sabe la empresa, no el texto.
  const aGranel = UNIDAD_GRANEL.includes(und) || (Number.isFinite(cant) && cant >= 20);
  if (tipo === 'material' && aGranel) {
    return { cajon: CAJON.TRANSFORMA, confianza: 'media',
      motivo: 'Material de obra comprado en cantidad: se consume en la obra o se revende.' };
  }

  // 9. Sin señal: NO se inventa. Es la regla que mantiene la lista creíble.
  return { cajon: CAJON.SIN_PROPUESTA, confianza: 'media',
    motivo: 'No hay señal suficiente para proponer un cajón. Decide la contadora.' };
}

// ── QUÉ CUENTA DEL PCGE LE CORRESPONDE ─────────────────────────────
// Espejo de CUENTAS_ACTIVO_FIJO en src/lib/activos-fijos.js. Se propone para
// que la contadora no tenga que elegirla en cada fila; puede cambiarla siempre.
// El orden IMPORTA: se evalúa de arriba abajo y gana la primera que pega.
const CUENTA_POR_FAMILIA = [
  { cuenta: '33411', tasa: 20, palabras: ['moto', 'motocicleta', 'motocarga', 'trimoto', 'camioneta', 'vehiculo', 'furgon', 'camion'] },
  { cuenta: '33611', tasa: 25, palabras: ['laptop', 'notebook', 'computadora', 'cpu', 'monitor', 'lenovo', 'macbook', 'impresora', 'fotocopiadora', 'multifuncional', 'scanner', 'proyector', 'tablet'] },
  { cuenta: '33621', tasa: 10, palabras: ['celular', 'smartphone', 'galaxy', 'iphone', 'radio', 'antena'] },
  { cuenta: '335',   tasa: 10, palabras: ['escritorio', 'vitrina', 'estante', 'repisa', 'armario', 'anaquel', 'mueble', 'silla', 'mesa', 'refrigeradora', 'congeladora', 'aire acondicionado'] },
  { cuenta: '333',   tasa: 20, palabras: ['generador', 'compresora', 'vibrador', 'mezcladora', 'trompo', 'winche', 'soldadora', 'motobomba', 'bomba', 'aspiradora', 'sublimadora', 'maquina de', 'martillo demoledor'] },
  { cuenta: '337',   tasa: 10, palabras: ['amoladora', 'taladro', 'rotomartillo', 'sierra', 'nivel laser', 'teodolito', 'estacion total', 'pistola de calor'] },
];
const CUENTA_RX = CUENTA_POR_FAMILIA.map(f => ({ ...f, rx: rx(f.palabras) }));

/**
 * La cuenta del PCGE que le corresponde a un bien, por lo que es.
 *
 * @returns { cuenta, tasa } — 33691 «Otros equipos diversos» al 10% si no pega
 *          ninguna familia, que es el cajón honesto del PCGE para eso.
 */
export function cuentaPropuestaPorTexto(descripcion, tipoInsumo) {
  const d = norm(descripcion);
  for (const f of CUENTA_RX) if (f.rx.test(d)) return { cuenta: f.cuenta, tasa: f.tasa };
  // Una herramienta sin familia reconocida sigue siendo una herramienta.
  if (String(tipoInsumo || '').toLowerCase() === 'herramienta') return { cuenta: '337', tasa: 10 };
  if (String(tipoInsumo || '').toLowerCase() === 'maquinaria') return { cuenta: '333', tasa: 20 };
  return { cuenta: '33691', tasa: 10 };
}

/**
 * Los CANDIDATOS A ACTIVO de un conjunto de comprobantes, listos para revisar.
 *
 * @param movs           accounting_movements (ya filtrados por empresa si se quiere)
 * @param opts.companyId si se pasa, solo los de esa empresa
 * @param opts.yaCargados Set de `${movimiento_id}::${idx}` que ya están en activos_fijos
 * @param opts.soloActivos  true (default) para devolver solo los del cajón activo_uso
 */
export function candidatosActivo(movs, { companyId = null, yaCargados = null, soloActivos = true } = {}) {
  const cargados = yaCargados instanceof Set ? yaCargados : new Set();
  const out = [];
  for (const m of movs || []) {
    if (!m || m.deleted_at) continue;
    if (!['cost', 'expense'].includes(m.type)) continue;
    if (companyId && m.company_id !== companyId) continue;
    const items = itemsDe(m);
    items.forEach((it, idx) => {
      if (cargados.has(`${m.id}::${idx}`)) return;
      const r = clasificarLinea(it);
      if (soloActivos && r.cajon !== CAJON.ACTIVO) return;
      const pu = Number(it?.precio_unitario);
      out.push({
        movimiento_id: m.id,
        item_idx: idx,
        company_id: m.company_id || null,
        obra_id: m.obra_id || null,
        documento: m.document_number || null,
        fecha: m.date || null,
        descripcion: it?.descripcion || '',
        cantidad: Number(it?.cantidad) || null,
        unidad: it?.unidad || null,
        precio_unitario: Number.isFinite(pu) ? pu : null,
        tipo_insumo: it?.tipo_insumo || null,
        cajon: r.cajon,
        confianza: r.confianza,
        motivo: r.motivo,
        ...cuentaPropuestaPorTexto(it?.descripcion, it?.tipo_insumo),
        // 🔴 El aviso que evita contar la misma plata dos veces: si el bien ya
        // está cargado como costo de una obra y además se activa, los mismos
        // soles entran al margen de la obra Y al balance como bien depreciable.
        yaEsCostoDeObra: !!m.obra_id,
      });
    });
  }
  return out.sort((a, b) => (b.precio_unitario || 0) - (a.precio_unitario || 0));
}

function itemsDe(mov) {
  const n = mov?.notas;
  let j = {};
  if (n && typeof n === 'object') j = n;
  else { try { j = JSON.parse(n || '{}') || {}; } catch { j = {}; } }
  return Array.isArray(j.items_factura) ? j.items_factura : [];
}

/** Cuántos candidatos hay por empresa — para el aviso de «hay N en otras». */
export function candidatosPorEmpresa(movs, opts = {}) {
  const todos = candidatosActivo(movs, { ...opts, companyId: null });
  const m = new Map();
  for (const c of todos) {
    const k = c.company_id || '__sin__';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/** La llave con la que se recuerda que una línea ya se resolvió. */
export function claveLinea(movimientoId, idx) { return `${movimientoId}::${idx}`; }
