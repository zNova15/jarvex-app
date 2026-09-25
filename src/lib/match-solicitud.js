// ═══════════════════════════════════════════════════════════════════
// JARVEX — Comparar lo que pide la obra contra el almacén REAL.
//
// El asistente de Solicitud de Insumos (api/asistente-solicitud.js) lee el
// mensaje de WhatsApp; esta lib contesta la otra mitad: «de lo que piden,
// ¿qué es lo que YA tenemos en el almacén?». PURA: sin React, sin Dexie, sin
// red — la usan el endpoint (server) y la pantalla (cliente) y se testea sola.
//
// ── POR QUÉ NO SE LE DEJA EL MATCH A LA IA (24-set-2026) ───────────
// La primera versión le pasaba a la IA el catálogo ENTERO (400 filas) y le
// pedía que eligiera. Con los dos mensajes reales de Eddy Gil (9 y 10 ítems)
// la respuesta moría con «El requerimiento es demasiado largo para procesarlo
// de una vez»: los modelos gratuitos razonan en voz alta y ese pensamiento
// gasta el mismo techo de tokens que el JSON. Comparar 10 ítems contra 400
// nombres, en voz alta, se comía los 4.000 tokens antes de escribir una llave.
// Y aunque hubiera terminado: 524 insumos en la obra de agua, 400 de techo —
// los EPP y los de emergencia ni llegaban al prompt.
//
// Ahora el match lo hace ESTO, que es gratis, instantáneo, mira el catálogo
// completo y —lo más importante— sabe lo que un maestro de obra ve a simple
// vista y un modelo de texto no siempre:
//
//   · 1/2" ≠ 1 1/2" ≠ 3/4"       (la medida manda: si no coincide, no es)
//   · 90° ≠ 45°                   (un codo de 45 no reemplaza a uno de 90)
//   · PVC ≠ bronce ≠ F°G°         (el material no es un detalle)
//   · SEL ≠ SAP                   (tubo eléctrico vs tubo de agua: mismo
//                                  diámetro, otra cosa)
//
// La IA sigue opinando (ver el endpoint), pero sobre una lista CORTA que armó
// esta lib, y su elección pasa por este mismo filtro antes de llegar a la
// pantalla.
//
// ── LA REGLA QUE GOBIERNA TODO ────────────────────────────────────
// Esto RECOMIENDA; la almacenera DECIDE. Una recomendación se muestra como
// tal («sugerido · 82 %») con las alternativas al lado, y cambiarla es un
// clic. Cuando la lib no está segura NO elige: una fila que dice «no sé» se
// resuelve en 5 segundos; una que apunta al insumo equivocado se descubre
// cuando llegó el camión (misma regla que la clasificación, CLAUDE.md §8).
// ═══════════════════════════════════════════════════════════════════

// Puntaje mínimo para PRESELECCIONAR un insumo del almacén.
export const UMBRAL_SUGERIR = 0.6;
// Puntaje mínimo para aparecer como ALTERNATIVA (se muestra, no se elige).
export const UMBRAL_ALTERNATIVA = 0.3;
// Dos candidatos a menos de esto son un empate: no se elige ninguno.
const MARGEN_EMPATE = 0.04;

// Palabras que no distinguen un insumo de otro.
const STOP = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'en', 'y', 'a', 'al',
  'un', 'una', 'x', 'o', 'e', 'sin', 'tipo', 'marca', 'mod', 'modelo',
  // Unidades: dicen CUÁNTO, no QUÉ. La medida en sí ya es un número.
  'und', 'unid', 'unidad', 'unidades', 'u', 'pza', 'pzas', 'pieza', 'piezas',
  'pulg', 'pulgada', 'pulgadas', 'mm', 'cm', 'mt', 'mts', 'mtr', 'metro', 'metros',
  'ml', 'kg', 'kilo', 'kilos', 'gr', 'lt', 'lts', 'litro', 'litros', 'gal', 'gl',
  'amp', 'amperios', 'w', 'watts', 'v', 'volt', 'voltios',
]);

// Sinónimos de obra → una sola forma. Solo los que se confunden DE VERDAD en
// los mensajes reales; no es un diccionario.
const SINONIMO = new Map([
  ['tuberia', 'tubo'], ['tuberias', 'tubo'], ['tubos', 'tubo'],
  ['hilo', 'rosca'], ['roscado', 'rosca'], ['roscada', 'rosca'], ['roscados', 'rosca'],
  ['galvanizado', 'fg'], ['galvanizada', 'fg'], ['galvanizados', 'fg'],
  ['inyectado', 'iny'], ['inyectada', 'iny'],
  ['electrico', 'sel'], ['electrica', 'sel'],
  ['uniones', 'union'], ['codos', 'codo'], ['tees', 'tee'], ['niples', 'niple'],
  ['valvulas', 'valvula'], ['llaves', 'llave'], ['cajas', 'caja'], ['curvas', 'curva'],
]);

// Atributos EXCLUYENTES: si el pedido dice uno y el candidato dice otro del
// mismo grupo (y no el del pedido), son dos cosas distintas.
const GRUPOS_EXCLUYENTES = [
  // Material del accesorio.
  [new Set(['pvc', 'iny', 'sap', 'sel', 'cpvc']), new Set(['bronce']), new Set(['fg', 'fierro']),
    new Set(['hdpe', 'pe100', 'polietileno']), new Set(['cobre'])],
  // Uso del PVC: eléctrico contra agua/desagüe.
  [new Set(['sel', 'conduit']), new Set(['sap', 'presion', 'agua', 'desague', 'alcantarillado'])],
];

const plegar = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Tokens de un nombre de insumo: { palabras: [...], medidas: [...] }.
 * Exportada para los tests: lo que decide el puntaje tiene que poder mirarse.
 */
export function tokensInsumo(nombre) {
  let s = plegar(nombre)
    .replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4');
  // F°G°, F.G., FG → «fg» (fierro galvanizado). Antes de tirar los «°».
  s = s.replace(/\bf\s*[°º.]\s*g\s*[°º.]?/g, ' fg ');
  // Marcas de pulgada y grado: " ¨ ` ´ ' ’ ” ″ °. En los catálogos reales
  // aparecen TODAS («1/2`», «1¨1/2¨», «3/4"»): son ruido para comparar.
  s = s.replace(/["¨`´'’”″°º]+/g, ' ');
  // Decimales con coma → punto (2,5 mm2 = 2.5 mm2).
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  // Códigos de clase pegados a su número: C-10, S-25, SDR 11, PN 16, SCH80,
  // N° 16. Son UNA especificación, no una medida suelta: sin juntarlos, el
  // «10» de «C-10» choca con cualquier medida del pedido.
  s = s.replace(/\b(c|s|sdr|pn|sch|cl|clase|n|no|nro)\s*[-.]?\s*(\d+(?:\.\d+)?)(?![\d/.])/g, '$1$2');
  // La «x» multiplicadora pegada al número: «x90», «2x16», «100x50».
  s = s.replace(/(^|[^a-z])x(?=\d)/g, '$1x ');
  s = s.replace(/(\d)x(?=[\s\d])/g, '$1 x');
  // Número pegado a su unidad: «200mm», «15w», «16amp» → «200 mm».
  s = s.replace(/(\d)([a-z])/g, '$1 $2');
  // Números mixtos: «1 1/2», «1-1/2» → «1y1/2». Sin esto «codo 1 1/2» parece
  // un «codo 1/2» con un «1» de más, y son dos medidas distintas.
  s = s.replace(/(\d+)\s*[-\s]\s*(\d+\/\d+)/g, '$1y$2');

  const crudos = s.match(/\d+y\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[a-zñ]+\d*(?:\.\d+)?/g) || [];
  const palabras = [];
  const medidas = [];
  for (const t0 of crudos) {
    if (/^\d/.test(t0)) { if (!medidas.includes(t0)) medidas.push(t0); continue; }
    const t = SINONIMO.get(t0) || t0;
    if (t.length < 2 || STOP.has(t)) continue;
    if (!palabras.includes(t)) palabras.push(t);
  }
  return { palabras, medidas };
}

// Una palabra «coincide» si es igual, o si una es prefijo de la otra con 4+
// letras (codo ≈ codos, niple ≈ niples, termomag ≈ termomagnetica). Mismo
// criterio que `tokenMatch` de insumo-correlacion.js. Exportada para
// `simulador-stock.js` (tanda 3.5), que compara la palabra principal.
export const coincide = (a, b) => {
  if (a === b) return true;
  const [c, l] = a.length <= b.length ? [a, b] : [b, a];
  return c.length >= 4 && l.startsWith(c);
};
// Lo que el pedido dice en GENÉRICO lo cumple un candidato más específico:
// un tee «INY» (inyectado) o un tubo «SAP» SON de PVC aunque el nombre del
// proveedor no lo escriba. Es en una sola dirección: pedir «SAP» y recibir
// un «PVC» a secas no garantiza que sea SAP.
const CUMPLE = new Map([
  ['pvc', ['iny', 'sap', 'sel', 'cpvc']],
]);
const tiene = (lista, t) => lista.some(u => coincide(t, u) || (CUMPLE.get(t) || []).includes(u));

function grupoConflicto(qPal, cPal) {
  for (const grupo of GRUPOS_EXCLUYENTES) {
    const iq = grupo.findIndex(set => qPal.some(t => set.has(t)));
    if (iq < 0) continue;
    const cDelPedido = cPal.some(t => grupo[iq].has(t));
    if (cDelPedido) continue;
    const otro = grupo.findIndex((set, i) => i !== iq && cPal.some(t => set.has(t)));
    if (otro >= 0) return true;
  }
  return false;
}

const PESO_MEDIDA = 1.5;

/**
 * Prepara el catálogo UNA vez (tokens + rareza de cada palabra).
 * @param catalogo [{id, tipo, nombre, unidad, stock_actual}]
 */
export function prepararCatalogo(catalogo = []) {
  const filas = [];
  const df = new Map();
  for (const m of (catalogo || [])) {
    if (!m || !m.id || !String(m.nombre || '').trim()) continue;
    const tk = tokensInsumo(m.nombre);
    if (!tk.palabras.length && !tk.medidas.length) continue;
    filas.push({ m, ...tk });
    for (const t of tk.palabras) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = filas.length || 1;
  // Una palabra que está en medio catálogo («pvc», «tubo») distingue menos
  // que una que está en tres filas («termomagnetica»). Suave a propósito:
  // la medida y la palabra principal pesan más que la rareza.
  const peso = (t) => {
    const d = df.get(t) || 0;
    return Math.min(2.5, 1 + 0.5 * Math.log((N + 1) / (d + 1)));
  };
  return { filas, peso };
}

/**
 * Puntaje 0..1 entre lo pedido y un insumo del catálogo (ya tokenizados).
 * 0 = seguro que NO es (medida o material en conflicto).
 */
export function puntaje(q, c, peso = () => 1) {
  if (!q.palabras.length && !q.medidas.length) return 0;

  // MEDIDAS. Si al pedido le falta una medida del candidato Y al candidato le
  // falta una del pedido, son dos medidas distintas → no es (codo 1/2 x 90 vs
  // codo 1/2 x 45; tubo 3/4 vs tubo 1/2). Si solo uno de los dos trae la
  // medida («Codo» a secas vs «codo 1/2»), puede ser — pero vale menos.
  const faltan = q.medidas.filter(n => !c.medidas.includes(n));
  const sobran = c.medidas.filter(n => !q.medidas.includes(n));
  if (faltan.length && sobran.length) return 0;

  const wq = q.palabras.reduce((a, t) => a + peso(t), 0) + PESO_MEDIDA * q.medidas.length;
  const wc = c.palabras.reduce((a, t) => a + peso(t), 0) + PESO_MEDIDA * c.medidas.length;
  const medidasOk = q.medidas.length - faltan.length;
  let okQ = PESO_MEDIDA * medidasOk;
  for (const t of q.palabras) if (tiene(c.palabras, t)) okQ += peso(t);
  let okC = PESO_MEDIDA * medidasOk;
  for (const t of c.palabras) if (tiene(q.palabras, t)) okC += peso(t);

  // Cuánto de lo PEDIDO está en el candidato pesa más que cuánto le sobra al
  // candidato: el catálogo suele tener el nombre largo del proveedor
  // («CODO PVC SAP 1/2" X 90° -GERFO») y la obra el corto («codo 1/2»).
  let s = 0.7 * (wq ? okQ / wq : 0) + 0.3 * (wc ? okC / wc : 0);

  // La primera palabra es el QUÉ (codo, tee, válvula, alambre). Si el
  // candidato no la tiene, puede compartir medida y material pero es otra
  // pieza: «caja para llave termomagnética» no es una «llave termomagnética».
  const cabeza = q.palabras[0];
  if (cabeza && !tiene(c.palabras, cabeza)) s *= 0.45;
  if (grupoConflicto(q.palabras, c.palabras)) s *= 0.35;
  if (faltan.length) s *= 0.8;
  return Math.max(0, Math.min(1, s));
}

/**
 * Los insumos del almacén más parecidos a lo pedido, de mejor a peor.
 * @param nombre   lo que pidió la obra («Codo pvc 1/2"x90°»)
 * @param prep     resultado de `prepararCatalogo`
 * @param opts.tipo el tipo que se infirió (material/epp/…): un candidato de
 *                 otro tipo baja en el ranking, no desaparece.
 */
export function recomendarInsumos(nombre, prep, { tipo = null, max = 5, min = UMBRAL_ALTERNATIVA } = {}) {
  if (!prep || !prep.filas?.length) return [];
  const q = tokensInsumo(nombre);
  const out = [];
  for (const f of prep.filas) {
    let s = puntaje(q, f, prep.peso);
    if (tipo && f.m.tipo && f.m.tipo !== tipo) s *= 0.75;
    if (s >= min) out.push({ ...f.m, score: Math.round(s * 100) / 100 });
  }
  // Empate de puntaje → el que tiene stock primero (es el que resuelve el
  // pedido sin comprar), después el nombre más corto.
  out.sort((a, b) => (b.score - a.score)
    || ((Number(b.stock_actual) > 0) - (Number(a.stock_actual) > 0))
    || String(a.nombre).length - String(b.nombre).length);
  return out.slice(0, max);
}

/**
 * ¿Se preselecciona alguno? Solo si el mejor pasa el umbral, es del MISMO
 * tipo que la fila (un EPP no se vincula a un material que se llama igual) y
 * no empata con otro candidato distinto — «unión universal» sin medida empata
 * con las de 1/2", 3/4" y 1", y elegir una al azar es inventar.
 * @returns { elegido: fila|null, motivo: 'ok'|'empate'|'bajo'|'otro_tipo'|'vacio' }
 */
export function decidirSugerencia(candidatos, { tipo = null } = {}) {
  const lista = candidatos || [];
  if (!lista.length) return { elegido: null, motivo: 'vacio' };
  const top = lista[0];
  if (top.score < UMBRAL_SUGERIR) return { elegido: null, motivo: 'bajo' };
  if (tipo && top.tipo && top.tipo !== tipo) return { elegido: null, motivo: 'otro_tipo' };
  const segundo = lista[1];
  if (segundo && top.score - segundo.score < MARGEN_EMPATE) return { elegido: null, motivo: 'empate' };
  return { elegido: top, motivo: 'ok' };
}

/**
 * Los candidatos de TODO un mensaje, para achicar el catálogo que ve la IA.
 * Cada renglón con letras se compara contra el almacén y se juntan los
 * mejores de cada uno. Así el prompt lleva ~50 filas relevantes en vez de 500.
 */
export function candidatosDelTexto(texto, prep, { porLinea = 6, tope = 90 } = {}) {
  if (!prep || !prep.filas?.length) return [];
  const vistos = new Map();
  for (const linea0 of String(texto || '').split(/\r?\n/)) {
    const linea = linea0.replace(/^[\s*_\-•·]*\d+(?:[.,]\d+)?\s*/, '').trim();
    if (!/[a-zA-Z]{3}/.test(linea)) continue;
    for (const c of recomendarInsumos(linea, prep, { max: porLinea, min: 0.25 })) {
      const prev = vistos.get(c.id);
      if (!prev || prev.score < c.score) vistos.set(c.id, c);
    }
  }
  return [...vistos.values()].sort((a, b) => b.score - a.score).slice(0, tope);
}

// ═══════════════════════════════════════════════════════════════════
// LECTOR LOCAL — cuando la IA no está, no contesta o se corta.
//
// Los mensajes de obra tienen una forma MUY repetida (ver el encabezado del
// endpoint): un título por sección entre asteriscos y una línea por ítem que
// empieza con la cantidad. Eso se lee sin IA. No entiende una frase libre
// («9 unidades de Triplay de 30 cm x 55 cm, Cinta de embalaje (1 Und)») como
// la IA, pero con el formato de WhatsApp de siempre saca todo — y un
// asistente que a veces arma la solicitud sin IA es mejor que uno que a
// veces dice «probá de nuevo».
// ═══════════════════════════════════════════════════════════════════

const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * «Lunes 14 de septiembre», «14/09», «14-09-2026», «2026-09-14» → 'YYYY-MM-DD'.
 * Sin año, toma el de `hoy`. Devuelve null si no entiende.
 */
export function fechaDeTexto(texto, hoy) {
  const t = plegar(texto);
  const anioHoy = Number(String(hoy || '').slice(0, 4)) || new Date().getFullYear();
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = t.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?/);
  if (m) {
    let a = m[3] ? Number(m[3]) : anioHoy;
    if (a < 100) a += 2000;
    const d = Number(m[1]); const mes = Number(m[2]);
    if (mes >= 1 && mes <= 12 && d >= 1 && d <= 31) return `${a}-${pad2(mes)}-${pad2(d)}`;
  }
  m = t.match(/(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de|del)?\s*(\d{4}))?/);
  if (m && MESES[m[2]]) return `${m[3] || anioHoy}-${pad2(MESES[m[2]])}-${pad2(m[1])}`;
  return null;
}

// Títulos de sección. El orden importa: «fecha de requerimiento» tiene que
// ganarle a «requerimiento».
const SECCIONES = [
  ['fecha_urgente', /^(minimo|min\.?)\b/],
  ['fecha', /^fecha\b/],
  ['responsable', /^(responsable|solicitante|solicita|pedido por|encargado)\b/],
  ['razon', /^(razon|motivo|justificacion|para que)\b/],
  ['frente', /^(frente|lugar|ubicacion|zona)\b/],
  ['items', /^(requerimiento|requerimientos|pedido|materiales|insumos|lista|se requiere|se necesita)\b/],
];

function seccionDe(linea) {
  const limpia = plegar(linea).replace(/[*_~]/g, '').trim();
  for (const [clave, re] of SECCIONES) {
    if (re.test(limpia)) {
      // Lo que viene después de «:» en la MISMA línea es el valor
      // («Responsable: Eddy Gil»).
      const i = linea.indexOf(':');
      const valor = i >= 0 ? linea.slice(i + 1).replace(/[*_~]/g, '').trim() : '';
      return { clave, valor };
    }
  }
  return null;
}

// Dos clases de unidad. Las CORTAS (und, kg, m, bls…) son siempre unidad:
// «20 kg clavos». Las que TAMBIÉN son el nombre de una pieza (caja, rollo,
// plancha…) solo cuentan como unidad seguidas de «de»: «3 cajas de clavos» es
// una unidad, pero «41 CAJA OCTOGONAL SEL» es lo que se pide — sin esta
// distinción el ítem salía como «OCTOGONAL SEL» en unidad «caja».
const RE_ITEM = /^\s*[-•·*]?\s*(\d+(?:[.,]\d+)?)\s*(?:(und|unid|unidades|unidad|u|pzas?|piezas?|bls|bolsas?|kg|kilos?|ml|mts?|metros?|m|rll|gal|galones|pares?|jgo|juegos?)\.?\s+(?:de\s+)?|(rollos?|cajas?|varillas?|planchas?|latas?|baldes?)\s+de\s+)?(.+)$/i;
const UNIDAD_CORTA = { und: 'und', unid: 'und', unidad: 'und', unidades: 'und', u: 'und', pza: 'pza', pzas: 'pza',
  pieza: 'pza', piezas: 'pza', bls: 'bls', bolsa: 'bls', bolsas: 'bls', kg: 'kg', kilo: 'kg', kilos: 'kg',
  ml: 'm', m: 'm', mt: 'm', mts: 'm', metro: 'm', metros: 'm', rollo: 'rll', rollos: 'rll', rll: 'rll',
  gal: 'gal', galones: 'gal', par: 'par', pares: 'par', jgo: 'jgo', juego: 'jgo', juegos: 'jgo',
  caja: 'caja', cajas: 'caja', varilla: 'var', varillas: 'var', plancha: 'pln', planchas: 'pln',
  lata: 'lata', latas: 'lata', balde: 'balde', baldes: 'balde' };

// Tipo por palabra, igual que las reglas del prompt. Ante la duda, material.
function tipoDe(nombre) {
  const t = plegar(nombre);
  if (/\b(casco|guante|arnes|botas?|lentes|chaleco|tapones? auditiv|respirador|barbiquejo|mascarilla|linea de vida)/.test(t)) return 'epp';
  if (/\b(botiquin|extintor|camilla|ferula)/.test(t)) return 'emergencia';
  if (/\b(retroexcavadora|mezcladora|compactadora|grupo electrogeno|volquete|excavadora|vibradora|cargador frontal)/.test(t)) return 'maquinaria';
  if (/\b(taladro|carretilla|escalera|andamio|amoladora|comba|pico|lampa|barreta|serrucho|martillo|wincha|nivel de mano|alicate|destornillador)/.test(t)) return 'herramienta';
  return 'material';
}

// Reconocer al responsable en el personal: todas las palabras (3+ letras) de
// lo escrito tienen que estar en el nombre completo. «Eddy Gil» encuentra a
// «Eddy Gil Ramos»; «Eddy» solo no alcanza si hay dos Eddy.
export function responsableDe(nombre, personal = []) {
  const pal = plegar(nombre).replace(/\b(ing|arq|sr|sra|mtro|maestro|capataz|tec)\b\.?/g, ' ')
    .split(/[^a-zñ]+/).filter(w => w.length >= 3);
  if (!pal.length) return null;
  const hits = (personal || []).filter(p => {
    const full = plegar(p.nombre || `${p.nombres || ''} ${p.apellidos || ''}`).split(/[^a-zñ]+/);
    return pal.every(w => full.some(f => f === w || (w.length >= 4 && f.startsWith(w))));
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Lee un mensaje de obra SIN IA. Devuelve la misma forma que la IA (la que
 * normaliza `sanearResultado`), con `confianza` baja a propósito para que la
 * pantalla pida revisar.
 */
export function parsearTextoLocal(texto, { hoy = null, personal = [] } = {}) {
  const lineas = String(texto || '').split(/\r?\n/).map(l => l.trim());
  const items = [];
  const acc = { responsable: [], razon: [], frente: [], fecha: [], fecha_urgente: [] };
  let seccion = null;

  for (const linea of lineas) {
    if (!linea) continue;
    const sec = seccionDe(linea);
    if (sec) {
      seccion = sec.clave;
      if (sec.valor && seccion !== 'items') acc[seccion].push(sec.valor);
      else if (sec.valor && seccion === 'items') procesarItem(sec.valor);
      continue;
    }
    if (seccion && seccion !== 'items') { acc[seccion].push(linea.replace(/[*_~]/g, '').trim()); continue; }
    procesarItem(linea);
  }

  function procesarItem(linea) {
    const m = linea.replace(/[*_~]/g, '').match(RE_ITEM);
    if (m) {
      const nombre = m[4].trim().replace(/\s+/g, ' ');
      const uni = m[2] || m[3];
      items.push({
        tipo: tipoDe(nombre),
        insumo_id: null,
        nombre,
        cantidad: Number(m[1].replace(',', '.')),
        unidad: uni ? (UNIDAD_CORTA[uni.toLowerCase()] || uni.toLowerCase()) : 'und',
        cantidad_minima: null,
        notas: '',
      });
      return;
    }
    // Un renglón SIN cantidad pegado a un ítem es la continuación de su
    // nombre: «41 SOQUETE DE BAQUELITA + FOCO AHORRADOR» / «LUZ CALIDA x 15w».
    // Antes del primer ítem es el saludo («Buenos días») y se ignora.
    if (seccion === 'items' && items.length && /[a-z]/i.test(linea)) {
      const ult = items[items.length - 1];
      ult.nombre = `${ult.nombre} ${linea.replace(/[*_~]/g, '').trim()}`.replace(/\s+/g, ' ');
    }
  }

  const resp = acc.responsable.join(' ').trim();
  const per = resp ? responsableDe(resp, personal) : null;
  const razon = acc.razon.join(' ').trim();
  const todo = plegar(texto);
  return {
    items,
    responsable_id: per ? per.id : null,
    responsable_nombre: resp,
    razon,
    frente: acc.frente.join(' ').trim(),
    descripcion: razon.slice(0, 120),
    fecha_necesidad: fechaDeTexto(acc.fecha.join(' '), hoy),
    fecha_urgente: fechaDeTexto(acc.fecha_urgente.join(' '), hoy),
    prioridad: /\burgente\b|obra parada|paralizad/.test(todo) ? 'urgente' : 'normal',
    confianza: items.length ? 0.6 : 0.2,
    advertencias: [],
  };
}

// ═══════════════════════════════════════════════════════════════════
// UNIDADES — ¿«und» del pedido es la «UNIDAD» del almacén?
// ═══════════════════════════════════════════════════════════════════
const FAMILIA_UNIDAD = [
  ['und', /^(und|unid|unidad|unidades|u|pza|pzas|pieza|piezas|ud|uds)$/],
  ['m', /^(m|ml|mt|mts|mtr|mtrs|metro|metros)$/],
  ['kg', /^(kg|kgs|kilo|kilos|kilogramo|kilogramos)$/],
  ['gal', /^(gal|gl|galon|galones)$/],
  // «bol» es como la escribe el presupuesto (CEMENTO PORTLAND … [bol]).
  ['bls', /^(bls|bl|bol|bols|bolsa|bolsas)$/],
  ['rll', /^(rll|rollo|rollos)$/],
  ['par', /^(par|pares)$/],
  ['m2', /^(m2|m²|mt2|metro cuadrado)$/],
  ['m3', /^(m3|m³|mt3|metro cubico)$/],
];
export function familiaUnidad(u) {
  const t = plegar(u).replace(/[.\s]+$/, '').trim();
  if (!t) return '';
  for (const [f, re] of FAMILIA_UNIDAD) if (re.test(t)) return f;
  return t;
}
export const mismaUnidad = (a, b) => !!familiaUnidad(a) && familiaUnidad(a) === familiaUnidad(b);

// ═══════════════════════════════════════════════════════════════════
// COMPLETAR — a cada ítem leído, su recomendación del almacén.
// ═══════════════════════════════════════════════════════════════════

// Por debajo de esto, un insumo que eligió la IA no se sostiene contra lo
// pedido (otra medida, otro material, otra pieza) y se descarta.
const PISO_IA = 0.35;

const recorte = (c) => ({
  id: c.id, tipo: c.tipo, nombre: c.nombre, unidad: c.unidad || '',
  stock_actual: c.stock_actual != null ? Number(c.stock_actual) : null,
  score: c.score,
});

/**
 * Agrega a cada ítem `insumo_id` (la recomendación, o null), `sugerencia`
 * ({fuente:'ia'|'similitud', score}) y `alternativas` (lo más parecido del
 * almacén, para cambiarla con un clic). PURA.
 *
 * Orden de autoridad:
 *   1. Lo que eligió la IA, SI pasa el filtro de medidas/material.
 *   2. El mejor por similitud, si es claro (ver `decidirSugerencia`).
 *   3. Nada — y las alternativas a la vista.
 *
 * @param result  la salida de `sanearResultado` (items ya con ids válidos)
 * @param prep    `prepararCatalogo(catalogo)`
 */
export function completarConAlmacen(result, prep) {
  const advertencias = [...(result?.advertencias || [])];
  const porId = new Map((prep?.filas || []).map(f => [String(f.m.id), f]));

  const items = (result?.items || []).map(it => {
    const q = tokensInsumo(it.nombre);
    let tipo = it.tipo;
    let alternativas = recomendarInsumos(it.nombre, prep, { tipo, max: 6 });
    let elegido = null;
    let fuente = null;

    if (it.insumo_id && porId.has(String(it.insumo_id))) {
      const f = porId.get(String(it.insumo_id));
      const s = puntaje(q, f, prep.peso);
      if (s >= PISO_IA) {
        elegido = { ...f.m, score: Math.round(s * 100) / 100 };
        fuente = 'ia';
        // El id define la tabla: si la IA dijo «material» pero eligió una
        // herramienta, la fila pasa a herramienta (si no, el stock se busca
        // en la tabla equivocada y dice «no tenemos»).
        if (f.m.tipo && f.m.tipo !== tipo) tipo = f.m.tipo;
      } else {
        advertencias.push(`«${it.nombre}»: la IA propuso «${f.m.nombre}», pero no coincide en medida o material — se dejó sin vincular.`);
      }
    }

    if (!elegido) {
      const d = decidirSugerencia(alternativas, { tipo });
      const [a1, a2] = alternativas;
      // Varios candidatos buenos y parejos = al pedido le falta un dato (casi
      // siempre la medida: «unión universal» a secas). Se dice, no se adivina.
      const parejos = a1 && a2 && a1.score >= 0.45 && a1.score - a2.score < MARGEN_EMPATE;
      if (d.elegido) { elegido = d.elegido; fuente = 'similitud'; }
      else if (d.motivo === 'empate' || parejos) {
        advertencias.push(`«${it.nombre}»: en el almacén hay varios parecidos (${alternativas.slice(0, 3).map(a => a.nombre).join(' / ')}) — elegí el que corresponde.`);
      }
    }

    alternativas = alternativas.filter(a => !elegido || String(a.id) !== String(elegido.id));
    return {
      ...it,
      tipo,
      insumo_id: elegido ? elegido.id : null,
      sugerencia: elegido ? { fuente, score: elegido.score, ...recorte(elegido) } : null,
      alternativas: alternativas.slice(0, 5).map(recorte),
    };
  });

  return { ...result, items, advertencias: advertencias.slice(0, 15) };
}
