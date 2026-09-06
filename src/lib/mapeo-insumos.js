// ═══════════════════════════════════════════════════════════════════
// JARVEX — MAPEO DE LÍNEAS DE FACTURA AL CATÁLOGO CANÓNICO (tanda 7, entrega 5).
//
// PARA QUÉ EXISTE
// El presupuesto de la obra dice qué necesita en `insumos_partida.insumo_codigo`
// (434 códigos, 382 materiales). Las facturas dicen qué se compró, en texto
// libre. Nadie puede sumar oferta contra demanda porque no hablan el mismo
// idioma. Esta lib traduce: línea de factura → código canónico + factor de
// conversión de unidad. Sin esto no hay pantalla de Abastecimiento (entrega 6).
//
// ── LO QUE SE MIDIÓ CONTRA PRODUCCIÓN ANTES DE ESCRIBIR ────────────
// 2.440 líneas de compra → 1.852 descripciones distintas ya normalizadas.
// NO hay Pareto: las 100 más caras son solo el 70% del valor, las 200 el 84%.
// O sea: no alcanza con mapear a mano las de arriba, y tampoco se pueden
// mapear 1.852 a mano. Tiene que haber motor.
//
// ── LAS TRES TRAMPAS QUE OBLIGAN EL DISEÑO ────────────────────────
// 1. `unidad` NO SIRVE. Dice 'UNIDAD' para bolsas de cemento, metros de tubo y
//    kilos de acero por igual. La unidad real hay que leerla de la descripción.
// 2. `tipo_insumo` MIENTE. «LIMPIEZA Y ACONDICIONAMIENTO DE LOCAL» viene
//    tipada como `material`. Sirve como señal, nunca como verdad.
// 3. EL SCORER QUE YA EXISTE NO ALCANZA. scoreNombres() de insumo-correlacion
//    compara nombres de factura entre sí y anula si los números difieren. Acá
//    el par correcto más caro de toda la base es:
//       factura  «TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO»   (2.470 und)
//       catálogo «TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435» (14.088,7 m)
//    Comparten 200 y s25, difieren en 8, 6 y 4435 → scoreNombres da 0. Y
//    «tubo» no es prefijo de «tuberia», así que ni el token principal pega.
//    Por eso acá: normalización que parte letra/dígito, sinónimos, números
//    leídos como MAGNITUDES CON UNIDAD (no como tokens), y equivalencia de
//    diámetro nominal por familia (8" ≡ 200 mm en tubería, pero 8 mm ≠ 8" en
//    acero corrugado — por eso la tabla es por familia y no global).
//
// ── LA FAMILIA ES LO QUE EVITA EL RIDÍCULO ────────────────────────
// Sin compuerta de familia, «GUANTE DE ACERO ANTICORTE» y «PERFIL DE ACERO
// ASTM A992» compiten por el código del acero corrugado, y «POR EL SERVICIO DE
// TRANSPORTE DE ... CEMENTO DISOLVENTE» compite por el del cemento. Las tres
// existen en la base. La familia se decide primero y solo se puntúa dentro de
// ella; un servicio nunca mapea a un material.
//
// ── EL FACTOR DE CONVERSIÓN SE PROPONE, NO SE IMPONE ──────────────
// Gabriel, 6-sep-2026, sobre la tabla del acero: «esto se va a encargar de
// completarlo la contadora, ella lo adecuará». Entonces cada factor sale con
// su procedencia —`tabla` (norma), `descripcion` (lo dice la propia factura),
// `supuesto` (default de la familia) o `manual`— y el que vale al final es el
// que ella grabe. Un factor `supuesto` se pinta distinto y nunca se consolida
// solo. Misma disciplina que el recomendador de activos.
//
// NADA se escribe en `insumos_partida`. Esta lib solo propone pares
// (descripción normalizada → código) que viven en `insumo_mapeo` (mig 183),
// con la misma memoria catálogo-first de clasificar-items.js: lo manual pisa a
// la IA, la IA pisa a la regla, y una vez decidido no se vuelve a preguntar.
//
// Puro: sin React, sin Dexie, sin fetch (solo importa otra lib pura).
// ═══════════════════════════════════════════════════════════════════

import { normInsumo } from './insumo-correlacion.js';

// ── 1. NORMALIZACIÓN ───────────────────────────────────────────────
// Más agresiva que normInsumo() de insumo-correlacion, y a propósito: acá hay
// que despegar «200mm» en «200 mm» y «s25» en «s 25» para poder leer las
// magnitudes. NO reemplaza a normInsumo: aquella es la clave de otro
// subsistema y cambiarla migraría datos guardados.
const SINONIMOS = new Map(Object.entries({
  tuberia: 'tubo', tuberias: 'tubo', tubos: 'tubo', tub: 'tubo',
  fierro: 'acero', fierros: 'acero', varilla: 'barra', varillas: 'barra',
  barras: 'barra', corrugada: 'corrugado', corrugadas: 'corrugado',
  bolsas: 'bolsa', bol: 'bolsa', bls: 'bolsa',
  unidades: 'und', unidad: 'und', unid: 'und', pza: 'und', pzas: 'und',
  // OJO: «u» suelta NO es sinónimo de unidad — «PVC-U» es una designación de
  // material y traducirla rompía el match del insumo más caro de la obra.
  metros: 'm', metro: 'm', mts: 'm', mt: 'm', mtrs: 'm', ml: 'm',
  kilos: 'kg', kilo: 'kg', kgs: 'kg', kilogramos: 'kg',
  galones: 'gal', galon: 'gal', gln: 'gal',
  pulgada: 'plg', pulgadas: 'plg', pulg: 'plg', pg: 'plg',
  gvz: 'galvanizado', galv: 'galvanizado', galvanizada: 'galvanizado',
  inoxidable: 'inox', portland: 'portland',
}));

/** Normaliza para el mapeo: sin tildes, minúsculas, letras y dígitos separados,
 *  comillas de pulgada explicitadas, sinónimos aplicados. */
export function normMapeo(s) {
  let t = String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  // Comillas de pulgada ANTES de matar la puntuación: 1/2" y 1/2' son plg.
  t = t.replace(/(\d)\s*(?:"|''|'|”|’|´)/g, '$1 plg ');
  // Fracciones: se preservan como token único (1/2 → 1_2) para no perderlas
  // cuando se limpia la puntuación; se leen después en extraerMagnitudes.
  t = t.replace(/(\d)\s*\/\s*(\d)/g, '$1_$2');
  t = t.replace(/[^a-z0-9_.]+/g, ' ');
  // Punto decimal solo entre dígitos; el resto es basura de puntuación.
  t = t.replace(/(\d)\.(?!\d)/g, '$1 ').replace(/(?<!\d)\.(\d)/g, ' $1');
  // Despega dígito↔letra: 200mm→200 mm, s25→s 25, x9m→x 9 m.
  t = t.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');
  const toks = t.split(/\s+/).filter(Boolean).map(w => SINONIMOS.get(w) || w);
  return toks.join(' ').trim();
}

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'en',
  'y', 'a', 'un', 'una', 'x', 'al', 'su', 'o', 'e', 'inc', 'incl', 'c', 's', 'p', 'tipo',
  // Las unidades ya se leen como magnitudes (extraerMagnitudes); como tokens
  // solo hacen ruido: «ESCRITORIO 1.80 M» pegaba con «MADERA ROLLIZA x5m».
  'm', 'mm', 'cm', 'kg', 'gr', 'g', 'gal', 'l', 'lt', 'ml', 'plg', 'und', 'bol', 'm2', 'm3']);

/** Tokens con peso (sin stopwords, sin puros números: esos son magnitudes). */
export function tokensDe(norm) {
  return String(norm || '').split(' ').filter(t => t && !STOP.has(t) && !/^[\d_.]+$/.test(t));
}

// ── 2. MAGNITUDES ──────────────────────────────────────────────────
// Un número suelto no dice nada; un número CON SU UNIDAD es un atributo duro.
// «6 m» es un largo, «200 mm» un diámetro, «42.5 kg» una presentación.
const frac = (tok) => {
  const m = /^(\d+)_(\d+)$/.exec(tok);
  if (!m) return null;
  const d = Number(m[2]);
  return d ? Number(m[1]) / d : null;
};
const numDe = (tok) => (frac(tok) ?? (/^\d+(?:\.\d+)?$/.test(tok) ? Number(tok) : null));

/**
 * Lee las magnitudes de una descripción normalizada.
 * → { plg:[], mm:[], m:[], kg:[], sueltos:[] }
 * Maneja el entero+fracción del habla de obra: «1 1/2 plg» = 1,5.
 */
export function extraerMagnitudes(norm) {
  const t = String(norm || '').split(' ').filter(Boolean);
  const out = { plg: [], mm: [], m: [], kg: [], sueltos: [] };
  for (let i = 0; i < t.length; i++) {
    let v = numDe(t[i]);
    if (v == null) continue;
    // «1 1/2» → 1,5 (entero seguido de fracción).
    const f = i + 1 < t.length ? frac(t[i + 1]) : null;
    if (f != null && Number.isInteger(v) && v >= 1 && v <= 12) { v += f; i++; }
    const u = t[i + 1];
    if (u === 'plg') { out.plg.push(v); i++; }
    else if (u === 'mm') { out.mm.push(v); i++; }
    else if (u === 'm') { out.m.push(v); i++; }
    else if (u === 'kg') { out.kg.push(v); i++; }
    else if (frac(t[i]) != null) out.plg.push(v);   // fracción sola = pulgadas
    else out.sueltos.push(v);
  }
  return out;
}

// ── 3. FAMILIAS ────────────────────────────────────────────────────
// Orden importa: lo más específico primero. `servicio` va arriba de todo
// porque «TRANSPORTE DE ... CEMENTO» es un servicio, no cemento.
export const FAMILIAS = [
  ['servicio', /\b(servicio|transporte|flete|alquiler|arrendamiento|honorario|consultoria|anticipo|seguro|mantenimiento|reparacion|instalacion|mano de obra|jornal|peon|operario|capataz|topografic|analisis|ensayo|certificado|internamiento|estadia|viatico|hospedaje|alojamiento|movilidad|peaje|comision|limpieza|acondicionamiento)\b/],
  ['cemento', /\bcemento\b/],
  ['agregado', /\b(arena|piedra|hormigon|afirmado|over|confitillo|grava|ripio|agregado)\b/],
  ['acero_corrugado', /\b(acero corrugado|barra .*corrugad|corrugado)\b|\bacero\b.*\bfy\b|\bgrado 60\b/],
  ['acero_estructural', /\b(perfil|angulo|plancha|viga|canal|platina|tubo cuadrado|tubo rectangular|tubo redondo|astm|lac|laf|estructural)\b/],
  ['combustible', /\b(petroleo|diesel|gasolina|gasohol|combustible|lubricante|aceite|grasa)\b/],
  ['pintura', /\b(pintura|esmalte|latex|imprimante|thinner|barniz|anticorrosiv)\b/],
  ['tuberia_metalica', /\btubo\b.*\b(galvanizado|negro|inox|acero|hierro)\b|\b(galvanizado|negro|inox)\b.*\btubo\b/],
  ['tuberia_hdpe', /\b(hdpe|hope|pead|sdr|termofusion|pe 100|pe 4710)\b/],
  ['tuberia_pvc', /\b(pvc|sap|sal|uf|alcantarillado)\b.*\btubo\b|\btubo\b.*\b(pvc|sap|sal|uf|alcantarillado)\b/],
  ['accesorio_pvc', /\b(codo|tee|yee|tapon|reduccion|union|niple|adaptador|abrazadera|racor|cachimba|anillo|sombrero|trampa|registro)\b/],
  ['valvula', /\b(valvula|compuerta|check|grifo|llave de paso)\b/],
  ['electrico', /\b(cable|alambre thw|interruptor|tomacorriente|termomagnetic|octogonal|luminaria|foco|soquete|tablero|conductor|nh 80|thw)\b/],
  ['epp', /\b(casco|guante|lente|botin|bota|chaleco|arnes|mameluco|respirador|mascarilla|tapon auditivo|barbiquejo|zapato de seguridad)\b/],
  ['sanitario', /\b(inodoro|lavatorio|ducha|urinario|medidor|caja termoplastica|sumidero|tanque)\b/],
  ['madera', /\b(madera|triplay|listones?|tornillo de madera|tabla|tablon|encofrado)\b/],
  ['ferreteria', /\b(clavo|alambre|tornillo|perno|tuerca|arandela|disco de|broca|remache|silicona|cinta|soldadura|electrodo)\b/],
];

/** Familia de una descripción ya normalizada ('otro' si ninguna pega). */
export function familiaDe(norm) {
  const s = ` ${String(norm || '')} `;
  for (const [nombre, re] of FAMILIAS) if (re.test(s)) return nombre;
  return 'otro';
}

// Diámetro nominal ↔ mm. POR FAMILIA a propósito: en tubería 8" son 200 mm,
// en acero corrugado 3/8" son 9,5 mm. Una tabla global se equivocaría siempre
// en una de las dos.
const NOMINAL = {
  tuberia_pvc:  { 1.5: 48, 2: 60, 2.5: 73, 3: 88, 4: 110, 6: 160, 8: 200, 10: 250, 12: 315, 14: 355, 16: 400 },
  tuberia_hdpe: { 1: 33, 1.5: 48, 2: 63, 2.5: 75, 3: 90, 4: 110, 6: 160, 8: 200, 10: 250, 12: 315 },
  acero_corrugado: { 0.375: 9.5, 0.5: 12.7, 0.625: 15.9, 0.75: 19.1, 1: 25.4 },
  _default:     { 0.5: 15, 0.75: 20, 1: 25, 1.25: 32, 1.5: 40, 2: 50, 2.5: 65, 3: 80, 4: 100, 6: 150, 8: 200 },
};
const MM_POR_PULGADA = 25.4;
// Si la familia no tiene equivalencia nominal para esa medida, se usa la
// conversión real. Hace falta: en las planchas el atributo que distingue es el
// ESPESOR en fracciones de pulgada (1/4", 1/16", 5/64") y ninguna tabla nominal
// las lista; sin esto, cuatro planchas de espesores distintos caían todas en
// «PLANCHA METALICA DE E=1/4"» con 75-80% de confianza.
const mmDePulgada = (plg, familia) =>
  (NOMINAL[familia] || NOMINAL._default)[plg] ?? Number((plg * MM_POR_PULGADA).toFixed(2));

/** Diámetros de una descripción, en mm, unificando pulgadas y milímetros. */
export function diametrosMm(mag, familia) {
  const out = new Set();
  for (const v of mag.mm) out.add(v);
  for (const p of mag.plg) { const mm = mmDePulgada(p, familia); if (mm != null) out.add(mm); }
  return out;
}

// ── 4. PUNTAJE ─────────────────────────────────────────────────────
/** IDF de cada token sobre el catálogo: «corrugado» pesa más que «acero». */
export function pesosIdf(catalogo) {
  const doc = new Map();
  const N = Math.max(1, (catalogo || []).length);
  for (const c of (catalogo || [])) {
    for (const t of new Set(tokensDe(c.norm))) doc.set(t, (doc.get(t) || 0) + 1);
  }
  const pesos = new Map();
  for (const [t, n] of doc) pesos.set(t, Math.log(1 + N / n));
  // Peso de las palabras que el catálogo NO conoce. Tratarlas como el mínimo
  // (que era el default `|| 1`) las volvía gratis, y entonces una línea llena
  // de palabras ajenas al presupuesto no pagaba nada por serlo: «PNATON EN
  // BOLSA X 900 GR» ganaba con «YESO BOLSA 10 kg» al 63% porque «pnaton» no
  // costaba, y «ALAMBRE DE AMARRE #16» con «ALAMBRE DE PUAS» al 72% porque
  // «amarre» tampoco. Se les da el peso PROMEDIO del catálogo: una palabra
  // desconocida informa como cualquier otra, ni más ni menos.
  const vals = [...pesos.values()];
  pesos.set(SIN_PESO, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 1);
  return pesos;
}

// Clave interna del peso por defecto (no puede chocar con un token real:
// tokensDe() nunca devuelve algo con espacios).
export const SIN_PESO = ' desconocido ';

/** Prepara el catálogo canónico (una vez) con lo que el scorer necesita. */
export function prepararCatalogo(filas) {
  const items = (filas || [])
    .filter(f => f && f.insumo_codigo)
    .map(f => {
      const norm = normMapeo(f.nombre);
      const familia = familiaDe(norm);
      const mag = extraerMagnitudes(norm);
      return {
        codigo: String(f.insumo_codigo), nombre: f.nombre, unidad: f.unidad || '',
        tipo: f.tipo || '', cantidad: Number(f.cantidad) || 0,
        norm, familia, mag, diam: diametrosMm(mag, familia), toks: new Set(tokensDe(norm)),
      };
    });
  return { items, idf: pesosIdf(items) };
}

const TOL_MM = 0.06;   // 6%: cubre 3/8"=9,5 escrito como 9,53 y 12"=315 vs 300.

/** Puntaje de una línea contra un ítem del catálogo. 0 = incompatible.
 *  Devuelve { score, motivos } — los motivos se muestran en pantalla para que
 *  quien revisa entienda POR QUÉ se propone, que es lo que hace confiable la
 *  sugerencia. */
export function puntuar(linea, cat, idf) {
  const motivos = [];
  let castigo = 1;
  // Compuerta de familia: sin esto un guante de acero compite por el corrugado.
  if (linea.familia !== 'otro' && cat.familia !== 'otro') {
    if (linea.familia !== cat.familia) return { score: 0, motivos: [] };
    motivos.push(`familia ${cat.familia}`);
  } else if (linea.familia !== cat.familia) {
    // Uno de los dos no se pudo clasificar. No se bloquea —el catálogo tiene
    // nombres raros— pero se castiga: es la vía por la que «GUANTE DE ACERO»
    // llegaba a competir con «TUBO DE FIERRO GALVANIZADO».
    castigo = 0.7;
  }
  // Un servicio nunca es un material (ni al revés).
  if ((linea.familia === 'servicio') !== (cat.familia === 'servicio')) return { score: 0, motivos: [] };

  // Contradicción de diámetro: si los DOS declaran diámetro y ninguno coincide,
  // son insumos distintos (3/8" no es 1/2"). Descarta, no descuenta.
  const dl = [...linea.diam], dc = [...cat.diam];
  if (dl.length && dc.length) {
    const pega = dl.some(a => dc.some(b => Math.abs(a - b) <= TOL_MM * Math.max(a, b)));
    if (!pega) return { score: 0, motivos: [] };
    motivos.push(`Ø ${dl[0]} mm`);
  }

  // ── EL PUNTAJE: DICE PONDERADO POR IDF ──────────────────────────
  //
  // score = 2 × (información compartida) / (información de los dos nombres)
  //
  // Es simétrico, y esa simetría es la que salva el mapeo de dos formas
  // opuestas que el diseño anterior no cubría a la vez:
  //
  //  · Un nombre de catálogo puede tener palabras que NINGUNA factura escribe.
  //    «ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60» (29.856 kg, el insumo más
  //    pesado de la obra) contra «VARILLA DE ACERO CORRUGADO DE 1/2»: la
  //    factura jamás dirá «fy» ni «grado 60». Mirando solo cuánto del catálogo
  //    aparece en la factura, el insumo más importante no salía nunca.
  //
  //  · Y un nombre de catálogo puede ser UNA SOLA PALABRA. El código 930020030
  //    se llama «AGUA» a secas. Mirando el máximo de las dos coberturas, «AGUA»
  //    daba 100% contra CUALQUIER línea que dijera agua, y se llevaba con 77%
  //    de confianza los S/ 20.648 de «CAJA Y MARCO Y TAPA PARA AGUA PVC» y una
  //    lija. Lo mismo hacían «MADERA ROLLIZA» con un escritorio y «PLASTICO
  //    DOBLE ANCHO» con unas tinas.
  //
  // Dice arregla las dos: un token compartido pesa según lo raro que sea Y
  // según cuánto nombre hay a cada lado. El token cabeza (el sustantivo, que en
  // castellano va primero) vale doble: «escritorio DE MADERA» no es madera.
  const cabezaCat = cat.toks.values().next().value;
  const cabezaLin = linea.toks.values().next().value;
  // El bonus de cabeza vale solo si es la cabeza de LOS DOS. Contándolo de un
  // solo lado, «TINAS DE PLASTICO» ganaba con «PLASTICO DOBLE ANCHO» y
  // «DESTORNILLADOR PARA INTERRUPTOR TERMOMAGNÉTICO» con «INTERRUPTOR BIPOLAR»:
  // el sustantivo del catálogo era un adjetivo en la factura.
  const dobleCabeza = !!cabezaCat && cabezaCat === cabezaLin;
  const porDefecto = idf.get(SIN_PESO) ?? 1;
  const peso = (t, esCabeza) => (idf.get(t) ?? porDefecto) * (esCabeza && dobleCabeza ? 2 : 1);
  const masa = (toks, cabeza) => {
    let t = 0;
    for (const k of toks) t += peso(k, k === cabeza);
    return t;
  };
  const parecido = (t, u) => {
    const [c, l] = t.length <= u.length ? [t, u] : [u, t];
    return c.length >= 5 && l.startsWith(c);   // «galvanizado» ≈ «galvaniz»
  };
  let comun = 0;
  for (const t of cat.toks) {
    const w = peso(t, t === cabezaCat);
    if (linea.toks.has(t)) { comun += w; continue; }
    for (const u of linea.toks) if (parecido(t, u)) { comun += w * 0.8; break; }
  }
  const masaCat = masa(cat.toks, cabezaCat), masaLin = masa(linea.toks, cabezaLin);
  let score = (masaCat + masaLin) ? (2 * comun) / (masaCat + masaLin) : 0;
  if (score > 0) motivos.push(`${Math.round(score * 100)}% de nombre en común`);

  // Números sueltos contradictorios: «malla n 12 coco» contra «MALLA OLIMPICA
  // N° 10» comparte la cabeza y gana, pero 12 no es 10. Castigo y no descarte,
  // porque un número suelto también puede ser una norma o un código de catálogo.
  if (linea.mag.sueltos.length && cat.mag.sueltos.length
      && !linea.mag.sueltos.some(a => cat.mag.sueltos.includes(a))) {
    score *= 0.75;
    motivos.push('números que no coinciden');
  }

  // Bonus por magnitudes compartidas que NO son el diámetro (largo, kg).
  const compart = (a, b) => a.some(x => b.some(y => Math.abs(x - y) <= 0.02 * Math.max(x, y)));
  if (compart(linea.mag.m, cat.mag.m)) { score += 0.10; motivos.push('mismo largo'); }
  if (compart(linea.mag.kg, cat.mag.kg)) { score += 0.10; motivos.push('misma presentación'); }
  if (dl.length && dc.length) score += 0.15;

  return { score: Math.min(1, score * castigo), motivos };
}

// ── 5. CONVERSIÓN DE UNIDAD ────────────────────────────────────────
// Acero corrugado NTP 341.031 / ASTM A615, kg por METRO LINEAL. La varilla
// comercial es de 9 m; si la factura dice otro largo, manda la factura.
export const KG_POR_METRO = {
  6: 0.222, 8: 0.395, 9.5: 0.560, 12: 0.888, 12.7: 0.994, 15.9: 1.552, 19.1: 2.235, 25.4: 3.973,
};
export const LARGO_VARILLA_M = 9;
export const LARGO_TUBO_M = 6;
export const KG_POR_BOLSA_CEMENTO = 42.5;

// DOS tolerancias distintas, a propósito:
//  · TOL_MM (6%) para decidir si dos insumos son EL MISMO — ahí conviene ser
//    generoso porque después hay un humano confirmando.
//  · TOL_CALIBRE (1,5%) para elegir la fila de la tabla de kilos — ahí NO se
//    puede ser generoso: 1/2" son 12,7 mm y existe también la barra de 12 mm.
//    Con el 6% el 1/2" caía en la fila de 12 mm y los 29.856 kg de acero de la
//    obra salían 12% cortos. Se elige además la fila MÁS CERCANA, no la primera.
const TOL_CALIBRE = 0.015;
const calibreMasCercano = (d) => {
  let mejor = null, dist = Infinity;
  for (const k of Object.keys(KG_POR_METRO)) {
    const e = Math.abs(d - Number(k));
    if (e < dist && e <= TOL_CALIBRE * Math.max(d, Number(k))) { dist = e; mejor = k; }
  }
  return mejor;
};
const unidadCanon = (u) => {
  const n = normMapeo(u);
  if (/\bbolsa\b/.test(n)) return 'bol';
  if (/\bund\b/.test(n)) return 'und';
  if (/^m$|\bm\b/.test(n)) return 'm';
  return n;
};

/**
 * Propone el factor que lleva la cantidad de la factura a la unidad del
 * catálogo. Siempre devuelve la PROCEDENCIA; nunca inventa en silencio.
 * → { factor, unidad_destino, fuente, nota } | { factor:null, ... } si no sabe.
 */
export function proponerFactor(linea, cat) {
  const uo = unidadCanon(linea.unidad), ud = unidadCanon(cat.unidad);
  const ok = (factor, fuente, nota) => ({ factor, unidad_destino: cat.unidad, fuente, nota });

  if (uo && ud && uo === ud) return ok(1, 'tabla', `ya está en ${cat.unidad}`);

  // Acero corrugado: varillas → kg, por calibre y largo.
  if (cat.familia === 'acero_corrugado' && ud === 'kg') {
    const d = [...linea.diam].find(x => calibreMasCercano(x) != null);
    if (d != null) {
      const clave = calibreMasCercano(d);
      const kgm = KG_POR_METRO[clave];
      const largoFactura = linea.mag.m.find(x => x >= 3 && x <= 12);
      const largo = largoFactura ?? LARGO_VARILLA_M;
      return ok(
        Number((kgm * largo).toFixed(3)),
        largoFactura ? 'descripcion' : 'supuesto',
        `Ø${clave} mm × ${kgm} kg/m × ${largo} m${largoFactura ? ' (largo de la factura)' : ` (largo comercial supuesto de ${LARGO_VARILLA_M} m)`}`,
      );
    }
  }

  // Tubería vendida por unidad y presupuestada por metro: manda el largo escrito.
  if ((cat.familia === 'tuberia_pvc' || cat.familia === 'tuberia_hdpe') && ud === 'm' && uo !== 'm') {
    const largoFactura = linea.mag.m.find(x => x >= 1 && x <= 15);
    const largoCat = cat.mag.m.find(x => x >= 1 && x <= 15);
    if (largoFactura != null) return ok(largoFactura, 'descripcion', `cada tubo trae ${largoFactura} m según la factura`);
    if (largoCat != null) return ok(largoCat, 'supuesto', `el presupuesto pide tubos de ${largoCat} m; la factura no dice el largo`);
    return ok(LARGO_TUBO_M, 'supuesto', `largo comercial supuesto de ${LARGO_TUBO_M} m — confirmar`);
  }

  // Cemento: la «und» de una factura de cemento es una bolsa.
  if (cat.familia === 'cemento') {
    if (ud === 'bol' && (uo === 'und' || !uo)) return ok(1, 'supuesto', 'una «und» de cemento se toma como una bolsa de 42,5 kg');
    if (ud === 'bol' && uo === 'kg') return ok(Number((1 / KG_POR_BOLSA_CEMENTO).toFixed(5)), 'tabla', `${KG_POR_BOLSA_CEMENTO} kg por bolsa`);
  }

  return { factor: null, unidad_destino: cat.unidad, fuente: null, nota: `de «${linea.unidad || '—'}» a «${cat.unidad || '—'}»: hay que definirlo` };
}

// ── 6. SUGERENCIA ──────────────────────────────────────────────────
export const UMBRAL_ALTO = 0.62;   // se propone con confianza; igual se confirma
export const UMBRAL_BAJO = 0.42;   // entre medio: «revisar»; abajo: no se propone
export const MARGEN_AMBIGUO = 0.08;   // dos candidatos así de cerca = no hay propuesta

/** Prepara una línea de factura para puntuar. */
export function prepararLinea(l) {
  const norm = normMapeo(l.descripcion ?? l.ej ?? l.norm ?? '');
  const familia = familiaDe(norm);
  const mag = extraerMagnitudes(norm);
  return {
    ...l, norm, familia, mag, diam: diametrosMm(mag, familia), toks: new Set(tokensDe(norm)),
  };
}

/**
 * Candidatos ordenados para una línea. `limite` top-N.
 * Cada candidato trae score, motivos y factor propuesto — todo lo que la
 * pantalla necesita para que la decisión sea informada y no un salto de fe.
 */
export function sugerirMapeo(lineaCruda, prep, opts = {}) {
  const limite = opts.limite || 3;
  const linea = lineaCruda.toks ? lineaCruda : prepararLinea(lineaCruda);
  if (linea.familia === 'servicio') {
    return { linea, familia: linea.familia, candidatos: [], estado: 'servicio' };
  }
  const cands = [];
  for (const cat of prep.items) {
    // Solo materiales. Los 47 códigos `equipo` del presupuesto están en hm
    // (horas-máquina) y los 5 de `mano_obra` en hh: comprar un vibrador NO
    // abastece horas de vibrador. Proponerlo hacía que «VIBRADOR DE CONCRETO
    // MANUAL MAKITA» (S/ 14.110) se ofreciera como si cubriera el alquiler.
    if (cat.tipo !== 'material') continue;
    const { score, motivos } = puntuar(linea, cat, prep.idf);
    if (score >= UMBRAL_BAJO) cands.push({ cat, score, motivos, factor: proponerFactor(linea, cat) });
  }
  cands.sort((a, b) => b.score - a.score || a.cat.codigo.localeCompare(b.cat.codigo));
  const top = cands.slice(0, limite);
  // AMBIGÜEDAD: si el segundo pisa los talones del primero, no hay propuesta
  // que valga. «TUBO» a secas empata contra 37 códigos de tubería y elegir el
  // primero por orden alfabético sería inventar. Baja a «revisar» y que decida
  // quien sabe — la misma disciplina del recomendador de activos.
  const ambiguo = top.length > 1 && (top[0].score - top[1].score) < MARGEN_AMBIGUO;
  const estado = !top.length ? 'sin_candidato'
    : (top[0].score >= UMBRAL_ALTO && !ambiguo) ? 'propuesto'
    : 'revisar';
  return { linea, familia: linea.familia, candidatos: top, estado, ambiguo };
}

// ── 7. MEMORIA (catálogo-first, igual que clasificar-items.js) ─────
/** Clave de una línea en `insumo_mapeo`: su descripción normalizada. */
export const claveMapeo = (descripcion) => normMapeo(descripcion);

const RANGO = { manual: 3, ia: 2, regla: 1 };

/** Resuelve las filas crudas de `insumo_mapeo` a UNA decisión por clave.
 *  manual > ia > regla; a igual fuente gana el `updated_at` más reciente. */
export function resolverMapeos(filas, opts = {}) {
  const demo = !!opts.demo;
  const out = new Map();
  for (const f of (filas || [])) {
    if (!f || f.deleted_at) continue;
    if (!!f.demo !== demo) continue;
    const k = String(f.norm || '');
    if (!k) continue;
    const prev = out.get(k);
    if (!prev) { out.set(k, f); continue; }
    const ra = RANGO[f.fuente] || 0, rp = RANGO[prev.fuente] || 0;
    if (ra > rp || (ra === rp && String(f.updated_at || '') > String(prev.updated_at || ''))) out.set(k, f);
  }
  return out;
}

// ── APROVECHAR LAS CORRELACIONES QUE GABRIEL YA CONFIRMÓ ──────────
// `insumo_correlaciones` (mig 154) ya guarda decisiones humanas del tipo
// «estos dos nombres son el mismo insumo». Si «VARILLA DE ACERO CORRUGADO DE
// 1/2» y «FIERRO CORRUGADO 1/2' NTP 341.031 SIDERPERU» ya están unidas ahí,
// mapear una tiene que mapear la otra: son 4 escrituras distintas del mismo
// fierro y preguntar 4 veces es exactamente lo que hace que la pantalla se
// abandone. OJO: los grupos viven en el espacio de normInsumo() y los mapeos
// en el de normMapeo() — por eso el puente se hace desde el texto CRUDO.

/** Índice grupo → mapeo, para propagar una decisión a los nombres hermanos.
 *  `miembros`: [{ descripcion }] — los textos crudos vistos en las facturas. */
export function indicePorGrupo(mapeosResueltos, miembros, grupoDe) {
  const idx = new Map();
  if (!grupoDe) return idx;
  for (const m of (miembros || [])) {
    const crudo = m?.descripcion ?? m?.ej ?? m;
    const gid = grupoDe.get(normInsumo(crudo));
    if (!gid || idx.has(gid)) continue;
    const fila = mapeosResueltos.get(normMapeo(crudo));
    if (fila) idx.set(gid, fila);
  }
  return idx;
}

/** Mapeo vigente para una descripción: primero el suyo, después el de su grupo. */
export function buscarMapeo(descripcion, mapeosResueltos, grupoDe, porGrupo) {
  const propio = mapeosResueltos.get(normMapeo(descripcion));
  if (propio) return { fila: propio, heredado: false };
  const gid = grupoDe && grupoDe.get(normInsumo(descripcion));
  const delGrupo = gid && porGrupo && porGrupo.get(gid);
  return delGrupo ? { fila: delGrupo, heredado: true } : null;
}

/** Cantidad de una línea llevada a la unidad canónica. null si falta factor. */
export function cantidadCanonica(cantidad, factor) {
  // OJO con Number(null) === 0: sin este guardia, una línea SIN factor devolvía
  // 0 en vez de null, y la pantalla de abastecimiento leería «de este insumo no
  // hay nada» cuando la verdad es «no sabemos cuánto hay». Un cero silencioso
  // acá haría comprar de más.
  if (cantidad == null || cantidad === '' || factor == null || factor === '') return null;
  const c = Number(cantidad), f = Number(factor);
  if (!Number.isFinite(c) || !Number.isFinite(f)) return null;
  return c * f;
}

/** Resumen para la pantalla: cuánto del gasto quedó mapeado y cuánto no. */
export function cobertura(lineas, mapeos, grupoDe, porGrupo) {
  const r = { lineas: 0, importe: 0, mapeadas: 0, importeMapeado: 0, servicios: 0, importeServicios: 0 };
  for (const l of (lineas || [])) {
    const imp = Number(l.importe) || 0;
    r.lineas += 1; r.importe += imp;
    const hit = buscarMapeo(l.descripcion ?? l.ej ?? '', mapeos, grupoDe, porGrupo);
    if (hit && hit.fila.decision === 'mapeado' && hit.fila.insumo_codigo) {
      r.mapeadas += 1; r.importeMapeado += imp; continue;
    }
    if (familiaDe(normMapeo(l.descripcion ?? l.ej ?? '')) === 'servicio') { r.servicios += 1; r.importeServicios += imp; }
  }
  r.pct = r.importe ? r.importeMapeado / r.importe : 0;
  return r;
}
