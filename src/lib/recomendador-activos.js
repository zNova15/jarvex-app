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
// ── TANDA 18, ENTREGA C: LAS TRES COSAS QUE CAMBIARON ──────────────
//  1. El piso baja de S/ 300 a S/ 80 (decisión de Gabriel, 9-set-2026). Las
//     dos listas de palabras de acá abajo salieron de mirar lo que pasaba los
//     S/ 300; abajo de ese piso vive casi todo lo que el grupo compra y el
//     recomendador ni lo miraba.
//  2. Las SUBFAMILIAS son ahora una señal de primera. `FAMILIAS_DURABLES` es
//     una lista de 60 palabras escrita a mano; `catalogo-subfamilias.js` tiene
//     42 grupos con su vocabulario ya medido contra el catálogo real. Una
//     retroexcavadora, un teodolito o un escritorio no estaban en la lista de
//     palabras y ahora entran por su subfamilia — y, al revés, el cemento y el
//     acero salen por la suya en vez de caer en «sin propuesta».
//  3. Lo que se descarta SE RECUERDA. Bajar el piso multiplica los candidatos;
//     sin un «no es activo» que quede grabado, la lista se vuelve impasable.
//     La decisión vive en `cotejo_decisiones` con ámbito 'activos' (mig 203) y
//     la lib solo la recibe hecha: acá no se toca Dexie.
//
// Puro: sin React, sin Dexie. El único import es otra lib pura.
// ═══════════════════════════════════════════════════════════════════
import { sugerirSubfamilia, etiquetaSubfamilia } from './catalogo-subfamilias.js';

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
 *
 * 🔴 BAJÓ DE 300 A 80 el 9-set-2026, por pedido de Gabriel. Lo que el piso de
 * 300 dejaba afuera, medido sobre producción: de las 2.491 líneas de compra,
 * 173 caen entre S/ 80 y S/ 300 en las familias que sí duran (materiales
 * durables y herramientas). Ahí adentro estaban los martillos demoledores y
 * las pistolas de calor que él terminó cargando A MANO al 7.1 — el
 * recomendador no se los ofrecía nunca porque costaban menos de 300.
 *
 * El piso barato solo es sostenible junto con el descarte que se recuerda: sin
 * él, la misma línea que ya se dijo que no vuelve a aparecer en cada visita.
 */
export const PISO_ACTIVO = 80;

/**
 * 1/4 de UIT — el monto del art. 23 del Reglamento de la LIR por debajo del
 * cual un bien PUEDE mandarse a gasto (es facultad, no obligación).
 *
 * UIT 2026 = S/ 5.500, CONFIRMADA: Decreto Supremo 301-2025-EF (subió S/ 150
 * desde los 5.350 de 2025). El valor que estaba puesto como supuesto era el
 * correcto, así que ninguna propuesta cambia. Sigue configurable a propósito:
 * un número legal que se actualiza cada diciembre no puede vivir hardcodeado.
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
  // La subfamilia `admin_computo` mete la tinta y el tóner en la misma bolsa
  // que las laptops. Son lo contrario de un activo: se acaban.
  'tinta', 'toner', 'cartucho',
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

// ── LAS SUBFAMILIAS COMO SEÑAL (tanda 18, entrega C) ───────────────
//
// `catalogo-subfamilias.js` parte las 10 familias comerciales en 42 grupos con
// vocabulario propio, y ese vocabulario salió de mirar el catálogo real de
// Gabriel — no de imaginar qué compra una constructora. Acá se le pregunta a
// ese motor «¿qué ES esto?» y se traduce su respuesta a nuestra pregunta, que
// es otra: «¿dura más de un ejercicio?».
//
// Son TRES cajones, no dos, porque hay un grupo genuinamente ambiguo: en
// «herramienta manual» conviven una escalera de tijera y una brocha. Ese sale
// con confianza media y el precio decide; los otros dos son categóricos.
const SUB_DURABLE = new Set([
  'equipo_pesado',        // retroexcavadora, volquete, rodillo, montacargas
  'equipo_electrico',     // taladro, soldadora, generador, motobomba
  'herramienta_medicion', // teodolito, estación total, nivel, multímetro
  'admin_computo',        // laptop, impresora, monitor, router
  'admin_mobiliario',     // escritorio, estante, armario, pizarra
]);
const SUB_DURABLE_DEBIL = new Set([
  'herramienta_manual',   // la escalera SÍ, la brocha NO: decide el precio
]);
// Lo que se consume, se transforma o directamente no es un bien. No hace falta
// enumerarlo: es TODO lo demás que el motor sabe nombrar. Enumerar el «sí» y
// tratar el resto como «no» es lo que hace que agregar una subfamilia nueva a
// `catalogo-subfamilias.js` no active nada por accidente.
function senalDeSubfamilia(descripcion) {
  let s = null;
  try { s = sugerirSubfamilia(descripcion, null); } catch { s = null; }
  const slug = s?.subfamilia || null;
  if (!slug) return { slug: null, label: null, veredicto: null };
  return {
    slug,
    label: etiquetaSubfamilia(slug),
    veredicto: SUB_DURABLE.has(slug) ? 'durable'
      : SUB_DURABLE_DEBIL.has(slug) ? 'durable_debil'
      : 'no_durable',
  };
}

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

  if (!d) return { cajon: CAJON.SIN_PROPUESTA, confianza: 'media', subfamilia: null, motivo: 'La línea no tiene descripción.' };

  // La segunda opinión: qué dice el motor de subfamilias que ES esto.
  const sub = senalDeSubfamilia(linea?.descripcion);

  // 1. Un servicio no es un bien: no se activa ni se revende. Nunca.
  if (tipo === 'servicio') {
    return { cajon: CAJON.GASTO, confianza: 'alta', subfamilia: null, motivo: 'Es un servicio: no es un bien que se pueda activar.' };
  }
  // 2. Lo que el texto delata como no-bien, aunque venga tipado como material.
  //    Acá caen los dos anticipos de cliente por S/ 127 mil.
  if (tiene(d, RX_NO_ES_BIEN)) {
    return { cajon: CAJON.GASTO, confianza: 'alta', subfamilia: null, motivo: 'Por la descripción no es un bien, es un servicio o un movimiento de dinero.' };
  }
  // 2.5. Lo que el motor de subfamilias agrupa bajo SERVICIOS no es un bien,
  //    aunque la factura lo haya tipado como material. Es la misma regla 1
  //    leída con mejor vocabulario, y hace falta porque las palabras de acá
  //    abajo tienen el límite solo al INICIO: «MONITOREO» pegaba con «monitor»
  //    y una «Autorización para la ejecución de un Plan de Monitoreo
  //    Arqueológico» de S/ 907 salía propuesta como activo.
  if (String(sub.slug || '').startsWith('servicio_')) {
    return { cajon: CAJON.GASTO, confianza: 'alta', subfamilia: sub.slug,
      motivo: `Es ${sub.label.toLowerCase()}: un servicio, no un bien que se pueda activar.` };
  }
  // 3. Consumibles en envase grande: pasan cualquier umbral y no son activos.
  if (tiene(d, RX_CONSUMIBLE)) {
    return { cajon: CAJON.GASTO, confianza: 'alta', subfamilia: null, motivo: 'Es un consumible: se gasta con el uso.' };
  }
  // 4. EPP: se entrega y se consume.
  if (tipo === 'epp') {
    return { cajon: CAJON.GASTO, confianza: 'alta', subfamilia: null, motivo: 'Es equipo de protección personal: se entrega y se consume.' };
  }

  const durable = tiene(d, RX_DURABLES) || sub.veredicto === 'durable';

  // 5. La señal más fuerte que hay: `tipo_insumo = maquinaria`. Las 4 líneas
  //    reales de producción son las 4 máquinas de JARVEX.
  if (tipo === 'maquinaria') {
    return { cajon: CAJON.ACTIVO, confianza: 'alta', subfamilia: sub.slug,
      motivo: 'Está cargado como maquinaria: una máquina se usa por años.' };
  }
  // 6. Herramienta cara: dura más de un ejercicio.
  if (tipo === 'herramienta' && Number.isFinite(pu) && pu >= PISO_ACTIVO) {
    return { cajon: CAJON.ACTIVO, confianza: durable ? 'alta' : 'media', subfamilia: sub.slug,
      motivo: `Es una herramienta de ${pu.toFixed(2)} por unidad: dura más de un ejercicio.` };
  }
  // 7. Material que pertenece a una familia durable (la moto, las laptops,
  //    la fotocopiadora, los muebles) o que el motor de subfamilias reconoce
  //    como equipo. La subfamilia es la que trae lo que la lista de palabras
  //    no tenía: la retroexcavadora, el teodolito, el escritorio.
  if (durable && Number.isFinite(pu) && pu >= PISO_ACTIVO) {
    return { cajon: CAJON.ACTIVO, confianza: 'alta', subfamilia: sub.slug,
      motivo: sub.veredicto === 'durable' && !tiene(d, RX_DURABLES)
        ? `Es ${sub.label.toLowerCase()}: se usa durante años y no se consume.`
        : 'Por lo que es, se usa durante años y no se consume.' };
  }
  // 8. El grupo ambiguo: «herramienta manual» es la escalera y también la
  //    brocha. Se propone, pero diciendo que la señal es débil — para eso
  //    existe el descarte que se recuerda.
  if (sub.veredicto === 'durable_debil' && Number.isFinite(pu) && pu >= PISO_ACTIVO) {
    return { cajon: CAJON.ACTIVO, confianza: 'media', subfamilia: sub.slug,
      motivo: `Parece ${sub.label.toLowerCase()} de ${pu.toFixed(2)} por unidad: puede durar años, o no.` };
  }

  // 9. A granel y en cantidad: material de obra. Se transforma o se revende, y
  //    cuál de las dos lo sabe la empresa, no el texto.
  const aGranel = UNIDAD_GRANEL.includes(und) || (Number.isFinite(cant) && cant >= 20);
  if (tipo === 'material' && aGranel) {
    return { cajon: CAJON.TRANSFORMA, confianza: 'media', subfamilia: sub.slug,
      motivo: 'Material de obra comprado en cantidad: se consume en la obra o se revende.' };
  }
  // 10. El motor sabe qué es, y lo que es no dura: cemento, acero, tubería,
  //     papelería. Antes esto caía en «sin propuesta» y no decía nada.
  if (sub.veredicto === 'no_durable') {
    return { cajon: CAJON.GASTO, confianza: 'media', subfamilia: sub.slug,
      motivo: `Es ${sub.label.toLowerCase()}: se consume o se incorpora a la obra.` };
  }

  // 11. Sin señal: NO se inventa. Es la regla que mantiene la lista creíble.
  return { cajon: CAJON.SIN_PROPUESTA, confianza: 'media', subfamilia: null,
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
 * @param opts.descartados Set de las mismas llaves que alguien ya contestó «no
 *        es activo» (ámbito 'activos' de `cotejo_decisiones`, mig 203). Sin
 *        esto, bajar el piso a S/ 80 haría que la lista repita en cada visita
 *        todo lo que ya se dijo que no.
 * @param opts.soloActivos  true (default) para devolver solo los del cajón activo_uso
 */
export function candidatosActivo(movs, { companyId = null, yaCargados = null, descartados = null, soloActivos = true } = {}) {
  const cargados = yaCargados instanceof Set ? yaCargados : new Set();
  const fuera = descartados instanceof Set ? descartados : new Set();
  const out = [];
  for (const m of movs || []) {
    if (!m || m.deleted_at) continue;
    if (!['cost', 'expense'].includes(m.type)) continue;
    if (companyId && m.company_id !== companyId) continue;
    const items = itemsDe(m);
    items.forEach((it, idx) => {
      if (cargados.has(`${m.id}::${idx}`)) return;
      if (fuera.has(`${m.id}::${idx}`)) return;
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
        subfamilia: r.subfamilia || null,
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

/**
 * El ámbito con el que se guardan los descartes en `cotejo_decisiones`
 * (mig 203). Se reusa esa tabla en vez de inventar otra por lo mismo que la
 * mig 196 la creó: «esto ya lo miré y no aplica» es la MISMA pregunta, con la
 * misma llave estable y la misma necesidad de viajar entre las dos PCs.
 */
export const AMBITO_ACTIVOS = 'activos';

/**
 * Las líneas descartadas, como Set de llaves, a partir de las filas de
 * `cotejo_decisiones`. Puede haber más de una fila por llave (las dos PCs
 * deciden por separado): gana que exista una viva, porque el descarte es
 * idempotente — deshacerlo borra TODAS las filas de esa llave.
 */
export function descartadosDe(decisiones) {
  const s = new Set();
  for (const r of decisiones || []) {
    if (!r || r.deleted_at) continue;
    if (r.ambito !== AMBITO_ACTIVOS) continue;
    if (r.decision !== 'no_aplica') continue;
    if (r.llave) s.add(String(r.llave));
  }
  return s;
}
