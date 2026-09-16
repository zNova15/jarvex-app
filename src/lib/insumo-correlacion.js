// ═══════════════════════════════════════════════════════════════════
// JARVEX — Correlación de insumos SUPERVISADA (mejora 1c, sep-2026).
//
// El sistema PROPONE pares de nombres que parecen el mismo insumo; el
// admin/gerente decide en el panel de Análisis de Insumos y la decisión se
// guarda en `insumo_correlaciones` (pares 'mismo'/'distinto') para no volver
// a preguntar. Esta lib es PURA: normalización, resolución de pares (manual >
// sugerido), grupos por union-find y el sugeridor fuzzy. Captura Mágica NO se
// toca (decisión explícita de Gabriel): esto corre como capa de análisis.
// ═══════════════════════════════════════════════════════════════════

// Normalización canónica de ESTE subsistema (las claves guardadas dependen de
// ella — no cambiarla sin migrar datos): minúsculas, sin tildes, ñ→n, todo lo
// no alfanumérico → espacio, colapsado. "Clavos de 8''" → "clavos de 8".
export const normInsumo = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Normalización PARA COMPARAR (nunca para guardar — ver `normInsumo` arriba,
// «no cambiarla sin migrar datos»). Igual que normInsumo, pero conserva las
// FRACCIONES «N/M» (1/2, 3/4, 5/8…) como un solo token en vez de partirlas en
// dos números sueltos.
//
// 🔴 EL CASO REAL (Gabriel, 14-sep-2026): "REDUCCION 1\" X 1/2" (de 1 a 1/2)
// se sugería como el mismo insumo que "REDUCCION 2 1/2\" A 1" (de 2-1/2 a 1)
// — son dos reducciones DISTINTAS, solo comparten los dígitos 1 y 2 sueltos.
// normInsumo() convierte "1/2" en dos tokens "1" y "2" (la "/" se pierde en el
// `[^a-z0-9]+` → espacio), así que el chequeo de MEDIDAS de scoreDeTokens —que
// compara por PERTENENCIA a un conjunto, no por posición— veía {1,1,2} contra
// {2,1,2,1}: mismos dígitos, conjuntos "compatibles", score alto. Conservando
// "1/2" como el token atómico "1∕2" (barra de fracción U+2215, sobrevive al
// filtro alfanumérico y no es un slash normal), la reducción de 1 a 1/2 no
// comparte NINGÚN número con la de 2-1/2 a 1 y el chequeo de medidas las
// anula — que es lo que un maestro de obra ve a simple vista.
const normParaScore = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/(\d)\s*\/\s*(\d)/g, '$1∕$2')
  .replace(/[^a-z0-9∕]+/g, ' ')
  // 🔴 EL «x90» DE LOS CODOS (16-set-2026). «CODO INY 3/4 x90 SP PRESION»
  // (compra) y «CODO INY 3/4 x 90 SP PRESION» (venta) son el mismo codo, pero
  // sin este despegue el primero lleva el token «x90» y el segundo «x» + «90»:
  // el 90 aparece como medida de un solo lado y el chequeo de scoreDeTokens
  // anula el par. Solo la «x» multiplicadora, que ya es stopword — despegar
  // TODA letra de todo dígito convertía «B5», «A4» y «S50» en medidas y hacía
  // perder 13 pares que Gabriel ya había marcado como el mismo insumo.
  .replace(/(^|\s)x(\d)/g, '$1x $2')
  .replace(/\s+/g, ' ')
  .trim();

// Par canónico: ordenado para que (a,b) y (b,a) sean la misma clave.
export function parClave(a, b) {
  const [x, y] = [normInsumo(a), normInsumo(b)].sort();
  return `${x}|${y}`;
}

// Resuelve las filas crudas de insumo_correlaciones a UNA decisión por par:
// manual > sugerido; a igual fuente gana updated_at más reciente. Ignora
// deleted_at y (salvo opts.demo) las filas demo.
export function resolverPares(filas, opts = {}) {
  const porPar = new Map();
  for (const f of (filas || [])) {
    if (!f || f.deleted_at) continue;
    if (!!f.demo !== !!opts.demo) continue;
    if (f.relacion !== 'mismo' && f.relacion !== 'distinto') continue;
    const k = parClave(f.nombre_a, f.nombre_b);
    if (k.startsWith('|') || k.endsWith('|')) continue;   // nombre vacío
    const prev = porPar.get(k);
    if (!prev) { porPar.set(k, f); continue; }
    const rango = (x) => (x.fuente === 'manual' ? 1 : 0);
    if (rango(f) > rango(prev)) { porPar.set(k, f); continue; }
    if (rango(f) === rango(prev) && String(f.updated_at || '') > String(prev.updated_at || '')) porPar.set(k, f);
  }
  return porPar;
}

// ── EL FACTOR ENTRE PRESENTACIONES (tanda 5, 15-set-2026) ───────────
//
// Gabriel, probando la tanda 2: «encontré un caso sobre un par de guantes en
// unidades y el otro en par, que resulta que sí son lo mismo». Exacto: SON lo
// mismo y unirlos es correcto. Lo que faltaba era poder SUMARLOS — el
// inventario los dejaba en dos filas que nadie puede restar («20 par» y
// «15 und») y el comparador se apagaba para ese insumo.
//
// Ver la cabecera de la mig 214: el factor NO es un `relacion` nuevo, son
// columnas opcionales sobre un par que ya es 'mismo'. Quien no las mira se
// comporta igual que antes.

/**
 * 🔴 EL ÚNICO CAMINO PARA ESCRIBIR LOS CAMPOS DE FACTOR.
 *
 * La mig 214 tiene un CHECK de «todo o nada» y Dexie NO valida CHECKs: una
 * fila con tres de los cinco campos se guarda local y REBOTA en el push con
 * 23514, dejando el sync en reintento eterno (regla 9 del CLAUDE.md). Esta
 * función arma los cinco juntos o los cinco en null, y es la que tiene que
 * usar toda la app — nunca escribir `factor_a` a mano.
 *
 * @param spec  { unidadBase, unidadA, factorA, unidadB, factorB } o null
 * @returns el objeto de campos listo para la fila (los cinco, siempre).
 */
export function camposDeFactor(spec) {
  const vacio = { unidad_base: null, unidad_a: null, factor_a: null, unidad_b: null, factor_b: null };
  if (!spec) return vacio;
  const { unidadBase, unidadA, unidadB } = spec;
  const fa = Number(spec.factorA);
  const fb = Number(spec.factorB);
  // Un factor de 0 o negativo no convierte nada: convertiría todo en cero, que
  // es peor que no convertir. Se trata como «sin factor», no como error —
  // dejar pasar un 0 al push sería exactamente el rebote 23514 que evitamos.
  if (!unidadBase || !unidadA || !unidadB) return vacio;
  if (!Number.isFinite(fa) || fa <= 0 || !Number.isFinite(fb) || fb <= 0) return vacio;
  return {
    unidad_base: String(unidadBase),
    unidad_a: String(unidadA), factor_a: fa,
    unidad_b: String(unidadB), factor_b: fb,
  };
}

/** ¿Esta fila de correlación trae un factor usable? */
export const tieneFactor = (f) =>
  !!(f && f.unidad_base && f.unidad_a && f.unidad_b
    && Number(f.factor_a) > 0 && Number(f.factor_b) > 0);

// Grupos de equivalencia (union-find sobre los pares 'mismo' resueltos).
// → { grupoDe: Map(nombreNorm → gid), grupos: Map(gid → {nombres:[], canonico}) }
// El canónico del grupo: el `canonico` más reciente entre sus pares; si nadie
// lo fijó, el nombre más largo (suele ser el más descriptivo).
export function construirGrupos(paresResueltos) {
  const padre = new Map();
  const find = (x) => {
    let r = x;
    while (padre.get(r) !== r) r = padre.get(r);
    let c = x;
    while (padre.get(c) !== c) { const n = padre.get(c); padre.set(c, r); c = n; }
    return r;
  };
  const union = (a, b) => {
    if (!padre.has(a)) padre.set(a, a);
    if (!padre.has(b)) padre.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) padre.set(rb, ra);
  };

  const canonicos = [];   // [{a, b, canonico, updated_at}]
  const conFactor = [];   // [{a, b, unidad_base, ..., updated_at}] — tanda 5
  for (const f of paresResueltos.values()) {
    if (f.relacion !== 'mismo') continue;
    const a = normInsumo(f.nombre_a), b = normInsumo(f.nombre_b);
    if (!a || !b) continue;
    union(a, b);
    if (f.canonico) canonicos.push({ a, canonico: f.canonico, updated_at: String(f.updated_at || '') });
    if (tieneFactor(f)) conFactor.push({ a, b, f, updated_at: String(f.updated_at || '') });
  }

  const grupoDe = new Map();
  const grupos = new Map();
  for (const nombre of padre.keys()) {
    const gid = find(nombre);
    grupoDe.set(nombre, gid);
    if (!grupos.has(gid)) grupos.set(gid, { nombres: [], canonico: null, _canonicoAt: '' });
    grupos.get(gid).nombres.push(nombre);
  }
  for (const c of canonicos) {
    const g = grupos.get(find(c.a));
    if (g && c.updated_at >= g._canonicoAt) { g.canonico = c.canonico; g._canonicoAt = c.updated_at; }
  }
  for (const g of grupos.values()) {
    g.nombres.sort();
    if (!g.canonico) g.canonico = g.nombres.reduce((m, n) => (n.length > m.length ? n : m), g.nombres[0] || '');
    delete g._canonicoAt;
  }

  // ── LOS FACTORES DEL GRUPO (tanda 5) ────────────────────────────
  // Un grupo tiene UNA unidad base: la del par CON FACTOR más reciente. Con
  // varios pares declarando bases distintas (alguien puso «und» y después
  // «kg»), gana el último — es la misma regla de desempate que ya usa el
  // canónico, y la última decisión de una persona es la que vale.
  //
  // Después, cada nombre toma su factor del par más reciente donde aparece
  // Y cuya base coincide con la del grupo. Los pares que declaran otra base
  // se ignoran: convertir la mitad del grupo a kilos y la otra mitad a
  // unidades daría un total que no significa nada.
  //
  // 🔴 EL FACTOR ES POR (NOMBRE, UNIDAD DE ORIGEN), no por nombre a secas.
  // Hay nombres que aparecen facturados en dos unidades según el proveedor,
  // y aplicarle a una línea en kilos el factor que se declaró para las
  // docenas es fabricar una cantidad. Ver la mig 214.
  const baseDeGrupo = new Map();   // gid → { unidad_base, at }
  for (const c of conFactor) {
    const gid = grupoDe.get(c.a);
    if (!gid) continue;
    const prev = baseDeGrupo.get(gid);
    if (!prev || c.updated_at >= prev.at) baseDeGrupo.set(gid, { unidad_base: c.f.unidad_base, at: c.updated_at });
  }

  // nombreNorm → { unidadBase, desde: Map(unidadOrigen → factor) }
  const factorDe = new Map();
  const anotar = (nombre, unidadOrigen, factor, unidadBase, at) => {
    const gid = grupoDe.get(nombre);
    if (!gid) return;
    if (baseDeGrupo.get(gid)?.unidad_base !== unidadBase) return;   // otra base: se ignora
    if (!factorDe.has(nombre)) factorDe.set(nombre, { unidadBase, desde: new Map(), _at: new Map() });
    const e = factorDe.get(nombre);
    const prevAt = e._at.get(unidadOrigen);
    if (prevAt != null && at < prevAt) return;                      // ya hay uno más nuevo
    e.desde.set(unidadOrigen, Number(factor));
    e._at.set(unidadOrigen, at);
  };
  for (const c of conFactor) {
    anotar(c.a, c.f.unidad_a, c.f.factor_a, c.f.unidad_base, c.updated_at);
    anotar(c.b, c.f.unidad_b, c.f.factor_b, c.f.unidad_base, c.updated_at);
  }
  for (const e of factorDe.values()) delete e._at;
  for (const [gid, b] of baseDeGrupo) {
    const g = grupos.get(gid);
    if (g) g.unidadBase = b.unidad_base;
  }

  return { grupoDe, grupos, factorDe };
}

/**
 * Cuánto suma una línea, en la unidad base de su grupo.
 *
 * → { cantidad, unidad } — o null si no hay factor que aplicar, y entonces el
 *   llamador suma como siempre, en la unidad de la línea.
 *
 * Devuelve null (y NO convierte) cuando la unidad de la línea no es aquella
 * para la que se declaró el factor: el mismo nombre puede venir en docenas de
 * un proveedor y en unidades de otro, y aplicar el factor de las docenas a
 * una línea en unidades multiplicaría por doce una cantidad que ya estaba bien.
 */
export function convertirALaBase(nombreNorm, unidadLinea, cantidad, factorDe) {
  const e = factorDe && factorDe.get(nombreNorm);
  if (!e || !e.unidadBase) return null;
  const f = e.desde.get(unidadLinea);
  if (!(Number(f) > 0)) return null;
  return { cantidad: Number(cantidad) * Number(f), unidad: e.unidadBase };
}

// Clave de agrupación para un nombre cualquiera (miembro de grupo → gid;
// suelto → su propia forma normalizada).
export function claveGrupoDe(nombre, grupoDe) {
  const n = normInsumo(nombre);
  return (grupoDe && grupoDe.get(n)) || n;
}

// ── Sugeridor fuzzy ──────────────────────────────────────────────────
// Score entre dos nombres normalizados: tokens compartidos / tokens del más
// largo. Un token "matchea" si es igual, o si uno es prefijo del otro con ≥4
// letras (clavo ≈ clavos, tubo ≈ tubos). Los NÚMEROS deben coincidir exacto
// (clavo de 8 ≠ clavo de 4 — medidas distintas son insumos distintos).
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'en', 'y', 'a', 'un', 'una', 'x']);
const tokensDe = (nombreNorm) => nombreNorm.split(' ').filter(t => t && !STOPWORDS.has(t));
export const tokenMatch = (t, u) => {
  if (t === u) return true;
  if (/^\d/.test(t) || /^\d/.test(u)) return false;   // numéricos: exacto o nada
  const [corto, largo] = t.length <= u.length ? [t, u] : [u, t];
  return corto.length >= 4 && largo.startsWith(corto);
};

// Los tokens con los que ESTE motor compara, para quien necesite razonar
// sobre las mismas palabras que deciden el score (lo usa
// `bandas-correlacion.js` para saber si dos nombres dicen lo mismo). Se
// exporta la función y no una copia del criterio: una sola definición de qué
// cuenta como palabra y qué como medida.
export const tokensParaScore = (nombre) => tokensDe(normParaScore(nombre));

// ── LA CONTENCIÓN (tanda 1, 15-set-2026) ────────────────────────────
// Cuando TODAS las palabras del nombre corto aparecen en el largo, es el mismo
// insumo escrito con más detalle — no dos cosas que se parecen. El cociente
// `m / max` castiga justo ese caso, porque el denominador crece con lo que el
// nombre largo agrega aunque del lado corto no sobre NADA:
//
//   «PRENSA DE 4 PULGADAS»  vs  «PRENSA DE 4 PULGADAS DE FIERRO NODULAR» → 0,60
//   «PALANA CUCHARA»        vs  «PALANA CUCHARA M/BELLOTA»               → 0,50
//   «CINTA MASKING»         vs  «CINTA MASKING TAPE 2 X 20YDS»           → 0,40
//
// Y ésa es EXACTAMENTE la forma del cruce compra↔venta, que es lo que Gabriel
// vino a buscar: el proveedor factura con modelo y código, la venta se factura
// con marca, y casi siempre uno de los dos es el otro con más detalle.
//
// Medido contra los 257 pares que Gabriel YA decidió (el único juez honesto
// que hay): recupera 4 «mismo» que hoy el motor no propone, NO pierde ninguno
// de los 133 que ya proponía, y NO suma ni un solo «distinto» a la cola. En
// JARVEX, las ventas que encuentran alguna compra para correlacionar pasan de
// 1 a 7 de 46.
//
// 🔴 EL PISO ES 0,60 Y NO 1,0, A PROPÓSITO. Contener no es ser igual: «LENTES
// DE SEGURIDAD» está contenido en «LENTES DE SEGURIDAD ANTIMPACTO» y Gabriel
// los marcó DISTINTOS. Lo que la regla afirma es «esto merece la pregunta»,
// no «esto es lo mismo»: apenas cruza el umbral (0,55) y queda entre las
// sugerencias de menor score, nunca arriba de todo.
//
// 🔴 VA DESPUÉS DEL CHEQUEO DE MEDIDAS Y NUNCA ANTES. «TAPON 1/2» está
// contenido en «TAPON 2 1/2 AGUA» y son dos medidas distintas; el `return 0`
// de las medidas ya los separó y esta regla no los resucita. Verificado
// también contra los cuatro controles adversariales de la lib (REDUCCION
// 1"x1/2 vs 2-1/2"a1, clavo 8 vs 4, aceite 10W30 vs 20W50): los cuatro siguen
// en cero.
//
// El mínimo de DOS palabras evita que un nombre de una sola («DISCOS»,
// «CEMENTO») quede contenido en media base de datos.
const PISO_CONTENCION = 0.60;

// El cálculo, UNA sola vez: `scoreNombres` y el sugeridor son la misma regla
// con distinta entrada (nombres crudos / tokens ya precomputados) y tenerla
// escrita dos veces era una invitación a que divergieran.
function scoreDeTokens(ta, tb) {
  if (!ta.length || !tb.length) return 0;
  // MEDIDAS: si AMBOS nombres traen números y difieren → 0 (clavo de 8 ≠ clavo
  // de 4). Si solo UNO trae números ("Cemento Sol" vs "Cemento Sol x 42.5kg")
  // no se anula: puede ser el mismo insumo con la presentación explícita —
  // justamente el tipo de duda que decide el admin en el panel.
  //
  // 🔴 LA MEDIDA ES EL NÚMERO, NO EL NÚMERO PEGADO A SU UNIDAD (16-set-2026).
  // «TUBO PVC-U 200mm S-25» y «TUBO PVC-U 200 mm S-25» son el MISMO tubo: uno
  // es la compra y el otro la venta. Comparando los tokens enteros, un lado
  // trae «200mm» y el otro «200» — distintos, y el par entero se anulaba. No
  // era que el score diera bajo: daba CERO, por eso bajar el umbral nunca
  // recuperó ninguno. Medido el 16-set en GASOMI: así se perdían los tubos de
  // alcantarillado, que son justo la mercadería que se compra y se revende.
  //
  // Se compara el PREFIJO NUMÉRICO y nada más: «200mm»→200, «2.40mt»→2 40,
  // «75gr»→75. La tokenización NO se toca — «200mm» sigue siendo un token, así
  // que el cociente de palabras lo sigue castigando (los tubos salen en 0,78,
  // no en 1) y un nombre no se alarga por despegarle la unidad. Despegar de
  // verdad costaba 13 pares que Gabriel ya había marcado «mismo».
  //
  // Sigue separando lo que tiene que separar: 160mm ≠ 200mm, y los cuatro
  // controles adversariales de la lib siguen en cero.
  const medidaDe = (t) => (t.match(/^[0-9∕]+/) || [t])[0];
  const numsA = ta.filter(t => /^\d/.test(t)).map(medidaDe);
  const numsB = tb.filter(t => /^\d/.test(t)).map(medidaDe);
  if (numsA.length && numsB.length) {
    for (const n of numsA) if (!numsB.includes(n)) return 0;
    for (const n of numsB) if (!numsA.includes(n)) return 0;
  }
  const usados = new Set();
  let m = 0;
  for (const t of ta) {
    const j = tb.findIndex((u, i) => !usados.has(i) && tokenMatch(t, u));
    if (j >= 0) { usados.add(j); m++; }
  }
  const largo = Math.max(ta.length, tb.length);
  const corto = Math.min(ta.length, tb.length);
  const base = m / largo;
  // `m` nunca puede pasar de `corto` (cada match consume un índice distinto),
  // así que `m === corto` es «del lado corto no quedó ni una palabra suelta».
  if (m === corto && corto >= 2) return Math.max(base, PISO_CONTENCION);
  return base;
}

export function scoreNombres(a, b) {
  return scoreDeTokens(tokensDe(normParaScore(a)), tokensDe(normParaScore(b)));
}

// Para PINTAR la diferencia entre dos nombres candidatos a "mismo insumo"
// (pedido de Gabriel, 14-sep-2026, tras ver "REDUCCION 1\" X 1/2" sugerido
// junto a "REDUCCION 2 1/2\" A 1"": «marcá de un color distinto las
// diferencias, para agilizar la decisión»).
//
// Usa el MISMO tokenMatch() que scoreNombres()/scoreDeTokens(): lo que queda
// resaltado es EXACTAMENTE lo que el motor no pudo emparejar, nunca una
// sorpresa distinta de por qué se sugirió el par. Devuelve las palabras en su
// forma ORIGINAL (con tildes y mayúsculas, tal como las escribió cada
// proveedor) — normParaScore es solo para DECIDIR, no para mostrar.
// → { a: [{texto, distinto}], b: [{texto, distinto}] }
export function resaltarDiferencias(a, b) {
  const crudoA = String(a || '').split(/\s+/).filter(Boolean);
  const crudoB = String(b || '').split(/\s+/).filter(Boolean);
  const tA = crudoA.map(w => normParaScore(w));
  const tB = crudoB.map(w => normParaScore(w));

  const marcar = (crudos, propios, otros) => {
    const usados = new Set();
    return crudos.map((texto, i) => {
      const n = propios[i];
      if (!n || STOPWORDS.has(n)) return { texto, distinto: false };
      const j = otros.findIndex((u, k) => !usados.has(k) && u && tokenMatch(n, u));
      if (j >= 0) { usados.add(j); return { texto, distinto: false }; }
      return { texto, distinto: true };
    });
  };

  return { a: marcar(crudoA, tA, tB), b: marcar(crudoB, tB, tA) };
}

// El sugeridor usa `scoreDeTokens` directamente sobre tokens YA precomputados
// (camino caliente: evita re-normalizar cada nombre miles de veces — hallazgo
// de rendimiento de la revisión adversarial: 2000 nombres tardaban ~13 s
// re-normalizando por par). Antes esto era una función `scoreTokens` con el
// cálculo COPIADO de `scoreNombres`; ahora es la misma, porque el sugeridor y
// la pantalla tienen que dar el mismo número o el panel mostraría un score
// distinto del que decidió proponer el par.

// Propone pares AÚN NO decididos entre los nombres dados.
// nombres: lista de nombres (crudos); paresResueltos: de resolverPares();
// grupoDe: de construirGrupos() (dos nombres ya en el mismo grupo no se
// vuelven a proponer).
// Rendimiento (para presupuestos reales con miles de nombres): tokens
// precomputados una sola vez; cada nombre se indexa SOLO por su raíz MÁS RARA
// (la que menos nombres comparten — evita que familias enteras tipo
// "cemento…" formen un bucket cuadrático); buckets gigantes y la enumeración
// total van con tope duro.
export function sugerirPares(nombres, paresResueltos, grupoDe, opts = {}) {
  const { umbral = 0.55, max = 60, maxBucket = 150, maxEnum = 40000 } = opts;
  const unicos = [...new Set((nombres || []).map(normInsumo).filter(Boolean))];
  // Un CRUDO representante por identidad normalizada, solo para tokenizar
  // preservando fracciones — `unicos` (la identidad que se guarda y se
  // devuelve en las sugerencias) ya perdió la "/" y no se puede recuperar de
  // ahí. Ver `normParaScore` arriba.
  const crudoPorNorm = new Map();
  for (const n of (nombres || [])) {
    const k = normInsumo(n);
    if (k && !crudoPorNorm.has(k)) crudoPorNorm.set(k, n);
  }
  const toks = unicos.map(u => tokensDe(normParaScore(crudoPorNorm.get(u) ?? u)));

  // Frecuencia de cada raíz de 4 letras (solo palabras, no medidas).
  const raicesDe = (ts) => [...new Set(ts.filter(t => !/^\d/.test(t)).map(t => t.slice(0, 4)))];
  const freq = new Map();
  const raicesPorNombre = unicos.map((_, i) => raicesDe(toks[i]));
  for (const rs of raicesPorNombre) for (const r of rs) freq.set(r, (freq.get(r) || 0) + 1);

  // Indexar cada nombre por sus DOS raíces más raras (con >1 aparición). Solo
  // una perdería cobertura: "clavo especial 8" iría al bucket 'espe' y
  // "clavos de 8" al bucket 'clav' y jamás se compararían. Con dos, basta que
  // COMPARTAN una de sus raíces raras para encontrarse.
  const porRaiz = new Map();
  raicesPorNombre.forEach((rs, i) => {
    const candidatas = rs
      .filter(r => (freq.get(r) || 0) >= 2)                  // raíz única: nadie con quien parear
      .sort((a, b) => freq.get(a) - freq.get(b))
      .slice(0, 2);
    for (const r of candidatas) {
      if (!porRaiz.has(r)) porRaiz.set(r, []);
      porRaiz.get(r).push(i);
    }
  });

  const vistos = new Set();
  const out = [];
  let enumeradas = 0;
  for (const idxs of porRaiz.values()) {
    if (idxs.length > maxBucket) continue;                   // familia gigante: no vale un cuadrático
    for (let x = 0; x < idxs.length && enumeradas < maxEnum; x++) {
      for (let y = x + 1; y < idxs.length && enumeradas < maxEnum; y++) {
        enumeradas++;
        const ia = idxs[x], ib = idxs[y];
        const a = unicos[ia], b = unicos[ib];
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;         // ya normalizados: clave directa
        if (vistos.has(k)) continue;
        vistos.add(k);
        if (paresResueltos && paresResueltos.has(k)) continue;               // ya decidido
        if (grupoDe && grupoDe.get(a) && grupoDe.get(a) === grupoDe.get(b)) continue;  // ya agrupados
        const s = scoreDeTokens(toks[ia], toks[ib]);
        if (s >= umbral) out.push({ nombre_a: a, nombre_b: b, score: Math.round(s * 100) / 100 });
      }
    }
  }
  out.sort((p, q) => q.score - p.score);
  return out.slice(0, max);
}

// ── Sugeridor de Clusters Multi-Insumo (N a N) ──────────────────────
// Conecta transitivamente N variantes (3 o más) que representan el mismo insumo
// (ej. "Clavos N3", "Clavos numero 3", "Clavos de 3", "Clavos 3 pulg").
export function sugerirClusters(nombres, paresResueltos, grupoDe, opts = {}) {
  const { umbral = 0.52, maxClusters = 30, maxPares = 250 } = opts;
  const pares = sugerirPares(nombres, paresResueltos, grupoDe, { ...opts, umbral, max: maxPares });
  if (!pares.length) return [];

  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = x;
    while (parent.get(c) !== c) { const n = parent.get(c); parent.set(c, r); c = n; }
    return r;
  };
  const union = (a, b) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (const p of pares) {
    const k = parClave(p.nombre_a, p.nombre_b);
    if (paresResueltos && paresResueltos.get(k)?.relacion === 'distinto') continue;
    // 🔴 Si CUALQUIERA de los dos ya quedó en un grupo resuelto (aceptado en
    // una vuelta anterior), no lo unás de nuevo acá — armaría un cluster
    // FANTASMA que vuelve a mezclar gente ya decidida con la nueva variante.
    // Caso real (14-sep-2026): grupo {A,B,C,D}, se saca D y se aceptan A,B,C
    // (crearParesDeCluster resuelve TODOS los pares entre A,B,C). Sin este
    // corte, sugerirPares sigue proponiendo A-D/B-D/C-D sueltos (correcto: D
    // no está decidido con nadie) y el union-find de ACÁ los volvía a fusionar
    // transitivamente en un cluster {A,B,C,D} idéntico al que se acababa de
    // aceptar — la tarjeta "no se iba nunca" con el mismo botón de Aceptar,
    // aunque el push ya había guardado la decisión. D tiene que reaparecer
    // como PAR SUELTO (sugerencias individuales, contra A/B/C uno por vez),
    // no reabrir el grupo entero.
    if (grupoDe && (grupoDe.get(p.nombre_a) || grupoDe.get(p.nombre_b))) continue;
    union(p.nombre_a, p.nombre_b);
  }

  const grupos = new Map();
  for (const nombre of parent.keys()) {
    const root = find(nombre);
    if (!grupos.has(root)) grupos.set(root, { miembros: [], pares: [] });
    grupos.get(root).miembros.push(nombre);
  }

  for (const p of pares) {
    if (parent.has(p.nombre_a)) {
      const root = find(p.nombre_a);
      const g = grupos.get(root);
      if (g) g.pares.push(p);
    }
  }

  const out = [];
  for (const [root, g] of grupos.entries()) {
    if (g.miembros.length < 2) continue;

    let tieneConflicto = false;
    for (let i = 0; i < g.miembros.length; i++) {
      for (let j = i + 1; j < g.miembros.length; j++) {
        const k = parClave(g.miembros[i], g.miembros[j]);
        if (paresResueltos && paresResueltos.get(k)?.relacion === 'distinto') {
          tieneConflicto = true;
          break;
        }
      }
      if (tieneConflicto) break;
    }
    if (tieneConflicto) continue;

    const totalScore = g.pares.reduce((acc, p) => acc + p.score, 0);
    const scorePromedio = g.pares.length ? Math.round((totalScore / g.pares.length) * 100) / 100 : 0.70;
    const canonico = g.miembros.reduce((m, n) => (n.length > m.length ? n : m), g.miembros[0]);

    out.push({
      id: `cluster:${root}`,
      canonico,
      variantes: g.miembros.sort(),
      pares: g.pares,
      score: scorePromedio,
      totalVariantes: g.miembros.length,
    });
  }

  // Primero los clusters de mayor cantidad de variantes (3 o más), luego por score
  out.sort((a, b) => b.totalVariantes - a.totalVariantes || b.score - a.score);
  return out.slice(0, maxClusters);
}

// ── UNA SOLA LISTA DE CANDIDATOS (tanda 4, 15-set-2026) ─────────────
/**
 * Los candidatos a unir, en UNA lista sin duplicados.
 *
 * ── EL PROBLEMA ───────────────────────────────────────────────────
 * Gabriel, 15-set: «actualmente no entiendo las sugerencias individual y las
 * múltiples».
 *
 * No era él: la pantalla mostraba DOS listas que salían de la misma función y
 * ninguna excluía a la otra. `sugerirClusters` llama a `sugerirPares` por
 * dentro, así que un par A–B que forma parte del grupo {A,B,C} aparecía
 * ARRIBA dentro del grupo y ABAJO otra vez como par suelto. Peor que el
 * desorden: el recorrido con IA recorre `clusters + sugerencias`, o sea que
 * le preguntaba DOS VECES por el mismo par y lo pagaba dos veces. Con la
 * tercera pestaña de la tanda 3, esa duplicación se multiplicaba por tres.
 *
 * ── LA SOLUCIÓN ───────────────────────────────────────────────────
 * Un candidato es un conjunto de 2 o más nombres que parecen el mismo
 * insumo. Un «par» es simplemente un candidato de dos. La lista se arma una
 * vez y un par que ya vive dentro de un grupo NO se vuelve a listar solo.
 *
 * 🔴 UN PAR SE EXCLUYE SOLO SI SUS DOS NOMBRES ESTÁN EN EL MISMO GRUPO. Si
 * A está en el grupo {A,B,C} y D quedó suelto, el par A–D SÍ tiene que
 * listarse: es una pregunta que nadie contestó todavía, y esconderla sería
 * perder la variante D para siempre.
 *
 * ── POR QUÉ SIGUE HABIENDO DOS UMBRALES ───────────────────────────
 * Un grupo se arma desde 0,52 y un par suelto necesita 0,55, y eso NO es una
 * inconsistencia: en un grupo la transitividad es evidencia extra. Si A~B da
 * 0,53 pero B~C da 0,80 y A~C da 0,60, el conjunto se sostiene mucho mejor
 * que el par A–B solo. Bajar el par a 0,52 llenaría la lista de ruido; subir
 * el grupo a 0,55 partiría familias que están bien. Lo que se unificó es la
 * LISTA y el conteo, que es lo que confundía — no el criterio, que tiene
 * motivos distintos para cada forma.
 *
 * → [{ id, variantes:[norm], canonico, score, esGrupo, pares }]
 *   ordenados: primero los que resuelven más nombres de un golpe, después por
 *   score. `maxCandidatos` corta la lista final, no cada mitad por separado.
 */
export function sugerirCandidatos(nombres, paresResueltos, grupoDe, opts = {}) {
  const {
    umbralPar = 0.55, umbralGrupo = 0.52,
    maxCandidatos = 60, maxClusters = 30, maxPares = 250,
  } = opts;

  const clusters = sugerirClusters(nombres, paresResueltos, grupoDe, {
    ...opts, umbral: umbralGrupo, maxClusters, maxPares,
  });
  // A qué grupo pertenece cada nombre YA propuesto (no el grupo confirmado:
  // ése lo filtra `sugerirPares` por su cuenta con `grupoDe`).
  const grupoPropuesto = new Map();
  for (const c of clusters) for (const v of c.variantes) grupoPropuesto.set(v, c.id);

  const pares = sugerirPares(nombres, paresResueltos, grupoDe, {
    ...opts, umbral: umbralPar, max: maxPares,
  });

  const sueltos = pares.filter(p => {
    const ga = grupoPropuesto.get(p.nombre_a);
    const gb = grupoPropuesto.get(p.nombre_b);
    return !(ga && gb && ga === gb);          // ya se pregunta dentro del grupo
  });

  // 🔴 `esGrupo` SALE DEL TAMAÑO, NO DE QUÉ FUNCIÓN LO ENCONTRÓ. Salió de un
  // test que falló al escribirlo: `sugerirClusters` arma «clusters» de dos
  // miembros, que son pares con otro nombre. Lo que cambia la forma de
  // decidirlo —y por lo tanto la tarjeta que se dibuja— es cuántos nombres
  // hay adelante, no por qué camino llegaron. Un candidato de dos se contesta
  // «son el mismo / son distintos»; uno de cinco se contesta sacando las que
  // no van y uniendo el resto.
  const armar = (variantes, canonico, score, pares) => ({
    id: variantes.length === 2 ? `par:${[...variantes].sort().join('|')}` : `grp:${[...variantes].sort().join('|')}`,
    variantes, canonico, score, pares,
    esGrupo: variantes.length >= 3,
  });

  const out = [
    ...clusters.map(c => armar(c.variantes, c.canonico, c.score, c.pares)),
    ...sueltos.map(p => armar(
      [p.nombre_a, p.nombre_b],
      p.nombre_a.length >= p.nombre_b.length ? p.nombre_a : p.nombre_b,
      p.score,
      [p],
    )),
  ];

  out.sort((a, b) => b.variantes.length - a.variantes.length || b.score - a.score);
  // Red de seguridad: el id es el CONTENIDO ordenado, así que dos candidatos
  // con los mismos nombres son el mismo candidato aunque hayan llegado por
  // caminos distintos. El filtro de arriba ya los saca; esto garantiza que la
  // lista no pueda repetir una pregunta ni aunque ese filtro cambie.
  const vistos = new Set();
  const unicos = out.filter(c => (vistos.has(c.id) ? false : (vistos.add(c.id), true)));
  return unicos.slice(0, maxCandidatos);
}

// Genera los pares de correlación correspondientes a un cluster completo de N variantes
/**
 * @param opts.yaResueltos  el Map de `resolverPares()`. Si viene, el cluster NO
 *   vuelve a escribir los pares que ya tienen respuesta:
 *
 *   🔴 DOS COSAS QUE PASARON DE VERDAD (16-set-2026, en producción).
 *   1. DUPLICADOS: aceptar un grupo que contenía un par ya unido escribía ese
 *      par OTRA VEZ. Quedaron tres filas idénticas de
 *      «martillo plastico superflex ↔ martillo de bola».
 *   2. PEOR — «Son distintos» sobre un grupo escribía TODOS sus pares como
 *      distintos, incluido uno que ya era «mismo». Como `resolverPares` se
 *      queda con el más reciente a igual `fuente`, una acción en lote borraba
 *      una decisión correcta tomada a mano. Un botón de grupo no puede
 *      deshacer lo que alguien decidió mirando un par.
 *
 *   Cambiar de opinión sobre un par sigue siendo posible: se hace desde su
 *   fila en «Decisiones tomadas», que es donde se ve qué se está cambiando.
 */
export function crearParesDeCluster(variantes, canonico, relacion = 'mismo', opts = {}) {
  const normVars = [...new Set((variantes || []).map(normInsumo).filter(Boolean))];
  if (normVars.length < 2) return [];
  const canonicoFinal = canonico ? normInsumo(canonico) : normVars[0];
  const pares = [];
  const ahora = new Date().toISOString();
  const yaResueltos = opts.yaResueltos || null;
  const saltar = (a, b) => {
    if (!yaResueltos) return false;
    const previa = yaResueltos.get(parClave(a, b))?.relacion;
    if (!previa) return false;
    return previa === relacion            // misma respuesta: no duplicar
      || (previa === 'mismo' && relacion === 'distinto');   // no pisar una unión
  };

  for (let i = 0; i < normVars.length; i++) {
    for (let j = i + 1; j < normVars.length; j++) {
      if (saltar(normVars[i], normVars[j])) continue;
      pares.push({
        nombre_a: normVars[i],
        nombre_b: normVars[j],
        relacion,
        canonico: canonicoFinal,
        fuente: opts.fuente || 'manual',
        demo: !!opts.demo,
        company_id: opts.companyId || null,
        updated_at: ahora,
      });
    }
  }
  return pares;
}

