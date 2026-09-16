// ═══════════════════════════════════════════════════════════════════
// JARVEX — Detalle POR EMPRESA: resumen financiero + inventario comprado
// (punto 5 del pedido de las contadoras, sep-2026). Lib PURA (sin Dexie/DOM).
//
// Responde, para UNA empresa del grupo: cuánto movió (con el criterio EXACTO
// del Consolidado) y QUÉ compró — insumo por insumo, con cantidades, gasto,
// proveedores y las facturas detrás — y, cuando la empresa además revende,
// cuánto de ese insumo volvió a salir por venta.
//
// Reglas que NO se rompen (son la diferencia entre un número útil y una mentira):
//  · Las CANTIDADES nunca se suman entre unidades distintas (bolsas ≠ kg). Sí se
//    unifican los SINÓNIMOS de la misma unidad ("und"/"unidad"/"each"), porque el
//    OCR de cada factura los escribe distinto. El galón inglés (4.55 L) queda
//    SEPARADO del americano (3.79 L): son volúmenes distintos.
//  · La PLATA nunca se suma entre monedas (PEN y USD van por separado).
//  · Notas de crédito/débito NO entran en los totales (restan, no suman): se
//    cuentan aparte para avisarlo.
//  · Movimientos anulados (payment_status 'cancelled') fuera, igual que el
//    Consolidado.
//  · Y las facturas que una nota de crédito ANULÓ POR COMPLETO también fuera
//    (tanda 1, 15-set-2026), aunque nadie las haya marcado 'cancelled': la
//    operación se deshizo y esa mercadería nunca entró. Medido: eran 21
//    facturas y 86 líneas contando como stock. Ver `extraerLineasDeFacturas`.
//    Una nota PARCIAL no saca la línea —la compra sigue siendo real— pero se
//    cuenta en `lineasRebajadas` para poder decirlo.
//  · Esto es inventario COMPRADO según facturas, NO stock: los consumos de obra
//    viven en almacén por obra. La UI tiene que decirlo.
//  · Y desde la tanda 7, lo que ENTRÓ DE UNA FORMA Y SALIÓ DE OTRA también
//    mueve el saldo: `comprado + producido − vendido − consumido`. El efecto
//    llega resuelto por `opts.transformadoDe` (ver `transformacion.js`), y sin
//    transformaciones cargadas todo se comporta exactamente como antes.
// ═══════════════════════════════════════════════════════════════════
// 🔴 ESTA LIB NO IMPORTA `destino-inventario.js`, Y ES A PROPÓSITO (tanda 6).
// La primera versión sí lo hacía, y el build lo delató: `inventario-empresa`
// lo importan muchas pantallas —hasta `bandas-correlacion`, por `normUnidad`—
// así que tirar de acá la cadena del recomendador de activos
// (destino-inventario → recomendador-activos → catalogo-subfamilias →
// mapeo-insumos) le colgaba ese peso a todas ellas, y movió el reparto de
// chunks de dist/assets. Es la lib BASE: recibe datos, no importa capas de
// arriba. Lo que necesita del destino llega por `opts`, ya resuelto.
import { claveGrupoDe, normInsumo, convertirALaBase } from './insumo-correlacion.js';
import { convertirMoneda } from './tipo-cambio.js';

// ── Clasificador de línea por texto (Tanda 3) ─────────────────────────
// Capa determinista de override: si la descripción del ítem coincide con
// patrones contractuales o financieros conocidos, devuelve el tipo correcto
// ANTES de que el tipo de la IA entre en juego. Esto evita que "ANTICIPO DE
// CLIENTE" o "OBRA: REHABILITACION DEL LOCAL..." aparezcan como 'material'.
// Función PURA: sin efectos secundarios, sin DB, sin IA. Siempre estable.

const normTxt = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

const RX_ANTICIPO        = /\b(ANTICIPO|ADELANTO|A CUENTA)\b/;
const RX_SERVICIO_OBRA   = /OBRA:|VALORIZACI[OO]N|POR EL SALDO DE|EJECUCION DE OBRA|CONTRATO DE OBRA|SUBCONTRATO DE OBRA|AVANCE DE OBRA|PARTIDAS? DE OBRA|EJECUCION DE PARTIDAS/;
const RX_LIQUIDACION     = /\bLIQUIDACI[OO]N\b/;
const RX_ALQUILER_TXT    = /\b(ALQUILER|ARRENDAMIENTO)\b/;
const RX_TRANSPORTE_SVC  = /\bTRANSPORTE\b|\bFLETE\b|\bTRASLADO\b/;
const RX_MANTENIM_SVC    = /\bMANTENIMIENTO\b|\bREPARACI[OO]N\b/;
const RX_HONORARIOS_TXT  = /\b(GASTOS NOTARIALES|HONORARIOS|CONSULTORIA|ASESORIA TECNICA|ASESORIA)\b/;

// ── LO QUE NO ES NI UN BIEN NI UN SERVICIO CONTRATADO (tanda 3) ────
// Gabriel, 15-set-2026, mirando la pestaña 🧱 Insumos: «encontré varias
// descripciones que no son insumos, por ejemplo "gastos administrativos del
// centro del proceso arbitral seguido entre el consorcio santa y la
// municipalidad distrital de nuevo chimbote exp nro 044 2023 coar pago en via
// de subrogacion"».
//
// Ese ítem existe de verdad —dos veces, en E001-209 y E001-210, a S/ 7.000
// cada uno— y llegaba a la lista de insumos por dos caminos que se sumaban:
// el estándar IUPC no lo reconoce (devuelve `sin_clasificar`, y lo no
// reconocido caía del lado de los insumos) y `tipo_insumo` de la factura dice
// «material», porque la IA de Captura Mágica lo tipeó así.
//
// Estos patrones son plata que se mueve, no mercadería que entra: arbitrajes,
// subrogaciones, seguros y SCTR, intereses y comisiones, detracciones,
// penalidades y multas. Ninguno tiene stock, ninguno se compara por precio
// unitario y ninguno debería competir por atención contra un codo de PVC.
//
// 🔴 Se declaran ACÁ, con los otros overrides, y no en una lista nueva: es el
// mismo tipo de regla (texto de la factura → qué es esto en realidad) y dos
// lugares con reglas de texto serían dos verdades sobre la misma línea.
const RX_LEGAL_ARB       = /\bARBITRAL\b|\bARBITRAJE\b|\bSUBROGACI[OO]N\b|\bLAUDO\b|\bCONCILIACI[OO]N\b/;
const RX_SEGURO_TXT      = /\bSCTR\b|\bP[OO]LIZA\b|\bSEGURO(S)?\b|\bESSALUD\b|\bSENCICO\b|\bCONAFOVICER\b/;
const RX_FINANCIERO_TXT  = /\bINTER[EE]S(ES)?\b|\bCOMISI[OO]N\b|\bPORTES\b|\bMANTENIMIENTO DE CUENTA\b|\bITF\b/;
const RX_TRIBUTO_TXT     = /\bDETRACCI[OO]N\b|\bRETENCI[OO]N\b|\bPERCEPCI[OO]N\b/;
const RX_PENALIDAD_TXT   = /\bPENALIDAD(ES)?\b|\bMULTA(S)?\b|\bMORA\b/;
const RX_ADMIN_TXT       = /\bGASTOS ADMINISTRATIVOS\b|\bGASTOS DE GESTI[OO]N\b/;

/**
 * Override de tipo de insumo basado en el texto de la descripción.
 * Devuelve el tipo correcto o `null` si no hay regla aplicable (en cuyo caso
 * se usa el tipo de la IA).
 *
 *   'anticipo'      — plata adelantada, todavía no hay nada entregado.
 *   'servicio_obra' — lo que se factura ES la obra (valorizaciones, saldos).
 *   'servicio'      — un servicio contratado: alquiler, flete, honorarios…
 *   'financiero'    — ni bien ni servicio: arbitrajes, seguros, intereses,
 *                     detracciones, penalidades, gastos administrativos
 *                     (tanda 3). Nunca es inventario.
 *
 * @param {string} nombre  texto del ítem tal como viene de la factura
 * @returns {string|null}
 */
export function clasificarLineaPorTexto(nombre) {
  const n = normTxt(nombre);
  if (!n) return null;
  if (RX_ANTICIPO.test(n))       return 'anticipo';
  if (RX_SERVICIO_OBRA.test(n))  return 'servicio_obra';
  // 🔴 LO LEGAL/FINANCIERO VA ANTES QUE LOS SERVICIOS y después de obra: el
  // arbitraje del Consorcio Santa dice «GASTOS ADMINISTRATIVOS» y también
  // podría pescar alguna regla de servicios por otra palabra. Lo que NO puede
  // pasar es que gane sobre `servicio_obra`: una valorización de obra que
  // mencione una penalidad sigue siendo la obra.
  if (RX_LEGAL_ARB.test(n))      return 'financiero';
  if (RX_ADMIN_TXT.test(n))      return 'financiero';
  if (RX_TRIBUTO_TXT.test(n))    return 'financiero';
  if (RX_PENALIDAD_TXT.test(n))  return 'financiero';
  if (RX_SEGURO_TXT.test(n))     return 'financiero';
  if (RX_FINANCIERO_TXT.test(n)) return 'financiero';
  if (RX_LIQUIDACION.test(n))    return 'servicio';
  if (RX_ALQUILER_TXT.test(n))   return 'servicio';
  if (RX_TRANSPORTE_SVC.test(n)) return 'servicio';
  if (RX_MANTENIM_SVC.test(n))   return 'servicio';
  if (RX_HONORARIOS_TXT.test(n)) return 'servicio';
  return null;
}

/**
 * Años presentes en una lista de líneas de factura (derivados de `l.fecha`).
 * Se usan para construir el selector "Por año" del inventario — así los años
 * los pone la data de la empresa, no un hardcode.
 * @param {Array} lineas  salida de extraerLineasDeFacturas (ya filtrada por empresa)
 * @returns {number[]}    años en orden DESCENDENTE (el más reciente primero)
 */
export function aniosDeLineas(lineas = []) {
  const anios = new Set();
  for (const l of lineas) {
    const y = String(l?.fecha || '').slice(0, 4);
    if (/^\d{4}$/.test(y)) anios.add(Number(y));
  }
  return [...anios].sort((a, b) => b - a);
}


// ── Unidades ─────────────────────────────────────────────────────────
// El OCR copia la unidad tal cual sale del comprobante: en producción conviven
// "unidad" (1249 líneas) y "und" (841) para lo MISMO, más los códigos SUNAT en
// inglés ("each", "theoretical pound", "dozen piece"). Sin esta tabla el mismo
// insumo se parte en dos filas que nadie puede sumar mentalmente.
const normTxtUnidad = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const SINONIMOS_UNIDAD = {
  und: ['und', 'unid', 'unidad', 'unidades', 'u', 'each', 'pieza', 'piezas', 'pza', 'pzas', 'pieces', 'piece'],
  kg: ['kg', 'kgs', 'kilogramo', 'kilogramos', 'kilo', 'kilos'],
  g: ['g', 'gr', 'gramo', 'gramos'],
  lb: ['lb', 'lbs', 'libra', 'libras', 'pound', 'pounds', 'theoretical pound'],
  t: ['t', 'tn', 'ton', 'tonelada', 'toneladas'],
  m: ['m', 'ml', 'metro', 'metros', 'metro lineal'],
  m2: ['m2', 'metro cuadrado', 'metros cuadrados'],
  m3: ['m3', 'metro cubico', 'metros cubicos'],
  l: ['l', 'lt', 'lts', 'litro', 'litros'],
  gal: ['gal', 'gln', 'galon', 'galones', 'gallon', 'us galon', 'us gallon'],
  'gal-uk': ['galon ingles', 'gal uk', 'imperial gallon', 'gross gallon'],
  par: ['par', 'pares'],
  caja: ['caja', 'cajas', 'cja', 'box'],
  paquete: ['paquete', 'paquetes', 'pqt', 'pack'],
  bolsa: ['bolsa', 'bolsas', 'bls', 'bag'],
  balde: ['balde', 'baldes'],
  cilindro: ['cilindro', 'cilindros'],
  botella: ['botella', 'botellas'],
  rollo: ['rollo', 'rollos', 'rll', 'roll', 'rolls'],
  docena: ['docena', 'docenas', 'doc', 'dozen', 'dozen piece'],
  ciento: ['ciento', 'cientos', 'cto', 'ciento de unidades'],
  millar: ['millar', 'millares', 'mll', 'mill'],
  juego: ['juego', 'juegos', 'jgo', 'set', 'sets', 'kit', 'kits'],
};

const MAPA_UNIDAD = new Map();
for (const [codigo, alias] of Object.entries(SINONIMOS_UNIDAD)) {
  for (const a of alias) MAPA_UNIDAD.set(a, codigo);
}

// Reglas por si el comprobante trae la unidad con paréntesis o texto extra
// ("US GALON (3,7843 L)"). El orden importa: el galón inglés se reconoce ANTES
// que el genérico para no fusionar dos volúmenes distintos.
const REGLAS_UNIDAD = [
  [/gal/, /(uk|ingl|imperial|gross)/, 'gal-uk'],
  [/gal/, null, 'gal'],
  [/kilogram|kilo\b/, null, 'kg'],
  [/litro|liter/, null, 'l'],
  [/docena|dozen/, null, 'docena'],
  [/millar/, null, 'millar'],
  [/ciento/, null, 'ciento'],
];

/** Unidad canónica de una unidad escrita por el OCR. '' si viene vacía. */
export function normUnidad(u) {
  const n = normTxtUnidad(u);
  if (!n) return '';
  const directo = MAPA_UNIDAD.get(n);
  if (directo) return directo;
  for (const [re, extra, codigo] of REGLAS_UNIDAD) {
    if (re.test(n) && (!extra || extra.test(n))) return codigo;
  }
  return n;
}

const LABEL_UNIDAD = {
  und: 'und', kg: 'kg', g: 'g', lb: 'lb', t: 't', m: 'm', m2: 'm²', m3: 'm³',
  l: 'L', gal: 'gal', 'gal-uk': 'gal (UK)', par: 'par', caja: 'caja',
  paquete: 'paquete', bolsa: 'bolsa', balde: 'balde', cilindro: 'cilindro',
  botella: 'botella', rollo: 'rollo', docena: 'docena', ciento: 'ciento',
  millar: 'millar', juego: 'juego',
};

/** Etiqueta legible de una unidad canónica (la propia clave si no se conoce). */
export const labelUnidad = (codigo) => LABEL_UNIDAD[codigo] || codigo || 'und';

// ── FACTORES QUE NO HAY QUE PREGUNTAR (tanda 5) ────────────────────
// Cuántas unidades base entran en 1 de la otra, cuando la respuesta es
// aritmética y no depende del insumo: una docena SIEMPRE son doce, un ciento
// son cien, un kilo son mil gramos.
//
// 🔴 LO QUE NO ESTÁ ACÁ ES A PROPÓSITO. «1 und de alambre = ¿cuántos kg?»
// depende del rollo; «1 par de guantes = ¿cuántas und?» depende de si la
// factura cuenta pares o guantes sueltos. Esas las contesta una persona
// mirando el comprobante, y proponerle un número inventado sería peor que no
// proponer nada: se aceptaría sin mirar.
const FACTORES_CONOCIDOS = {
  'docena>und': 12, 'und>docena': 1 / 12,
  'ciento>und': 100, 'und>ciento': 0.01,
  'millar>und': 1000, 'und>millar': 0.001,
  'kg>g': 1000, 'g>kg': 0.001,
  't>kg': 1000, 'kg>t': 0.001,
  'l>ml': 1000, 'ml>l': 0.001,
};

/**
 * El factor aritmético entre dos unidades canónicas, o null si depende del
 * insumo y tiene que contestarlo una persona.
 * → cuántas `hacia` hay en 1 `desde`.
 */
export function factorConocido(desde, hacia) {
  const a = normUnidad(desde), b = normUnidad(hacia);
  if (!a || !b) return null;
  if (a === b) return 1;
  return FACTORES_CONOCIDOS[`${a}>${b}`] ?? null;
}

// ── Resumen financiero de UNA empresa ────────────────────────────────
// Criterio EXACTO de ConsolidadoPage: una moneda a la vez y sin movimientos
// anulados. Se separa lo INTERCO (facturación entre empresas del grupo) porque
// para el grupo no es plata nueva — el mismo corte que hace el Consolidado.
export function resumenFinancieroEmpresa(movs, opts = {}) {
  const {
    companyId = null, moneda = 'PEN', demo = false,
    // Tanda 2: los comprobantes que NO tienen ítems propios pero SÍ muestran
    // detalle, leído de la venta de origen en el libro de la otra empresa
    // (`extraerLineasDeFacturas` → `heredadaDe`). Llega RESUELTO desde el
    // llamador —un Set de movId— por el mismo motivo que `esActivo` y
    // `destinoDe`: esta es la lib BASE y no importa capas de arriba.
    // Sin esto el resumen diría «factura sin detalle» de una factura cuyo
    // detalle está en la tabla de abajo.
    heredanDetalle = null,
  } = opts;
  const cero = () => ({ ingresos: 0, costos: 0, gastos: 0 });
  const total = cero(), externo = cero(), interco = { ingresos: 0, costos: 0 };
  let nMovs = 0, sinItems = 0, cancelados = 0, notas = 0, detalleHeredado = 0;
  const otrasMonedas = new Map();

  for (const m of (movs || [])) {
    if (!m || m.deleted_at) continue;
    if (!!m.demo !== !!demo) continue;
    if (companyId && m.company_id !== companyId) continue;
    if (m.payment_status === 'cancelled') { cancelados++; continue; }
    const cur = m.currency || 'PEN';
    if (cur !== moneda) { otrasMonedas.set(cur, (otrasMonedas.get(cur) || 0) + 1); continue; }

    nMovs++;
    // `notas` viaja como string JSON o ya parseado a objeto (según de dónde
    // venga la fila): sin el stringify, un objeto daría "[object Object]" y
    // TODA factura de Captura Mágica se contaría como "sin detalle".
    const notasTxt = typeof m.notas === 'string' ? m.notas : (m.notas ? JSON.stringify(m.notas) : '');
    if (!notasTxt.includes('items_factura')) {
      if (heredanDetalle && heredanDetalle.has(m.id)) detalleHeredado++;
      else sinItems++;
    }
    if (['nota_credito', 'nota_debito'].includes(m.document_type)) notas++;

    const a = Number(m.amount || 0);
    const bucket = m.type === 'income' ? 'ingresos' : m.type === 'expense' ? 'gastos' : 'costos';
    total[bucket] += a;
    if (m.is_intercompany) {
      // Un movimiento interno nunca debería ser 'expense' (clasificacion-contable
      // lo fuerza a 'cost'); si una fila vieja quedó así se elimina igual, como
      // en el Consolidado, para no dejarla contada de un solo lado.
      if (m.type === 'income') interco.ingresos += a; else interco.costos += a;
    } else {
      externo[bucket] += a;
    }
  }

  const conUtilidad = (x) => {
    const utilidad = x.ingresos - x.costos - x.gastos;
    return { ...x, utilidad, margen: x.ingresos > 0 ? (utilidad / x.ingresos) * 100 : 0 };
  };

  return {
    moneda,
    total: conUtilidad(total),
    externo: conUtilidad(externo),
    interco,
    nMovs, sinItems, cancelados, notas, detalleHeredado,
    otrasMonedas: [...otrasMonedas.entries()]
      .map(([m2, n]) => ({ moneda: m2, movs: n }))
      .sort((x, y) => y.movs - x.movs),
  };
}

// ── Inventario comprado (y revendido) por insumo ─────────────────────
const nuevoLado = () => ({
  veces: 0, interco: 0,
  anticiposCount: 0,
  porUnidad: new Map(),      // unidad canónica → cantidad
  porMoneda: new Map(),      // moneda → monto
  anticiposPorMoneda: new Map(),
  proveedores: new Map(),    // clave → {id, nombre, veces}
  ultimaFecha: '', ultimoPrecio: null, ultimaMoneda: null, ultimoProveedor: null,
});

const acumular = (lado, l, factorDe = null) => {
  lado.veces++;
  if (l.interco) lado.interco++;
  const esAnticipo = l.tipoInsumo === 'anticipo' || clasificarLineaPorTexto(l.nombre) === 'anticipo';
  if (esAnticipo) lado.anticiposCount++;
  const uLinea = normUnidad(l.unidad) || 'und';
  // ── EL FACTOR ENTRE PRESENTACIONES (tanda 5) ──────────────────────
  // Si alguien declaró cómo se convierte esta presentación a la unidad base
  // del grupo, la cantidad se suma AHÍ: «20 par» y «15 und» dejan de ser dos
  // filas que nadie puede restar. Sin factor declarado, todo sigue como
  // antes — cada unidad en su fila, que es lo correcto mientras nadie diga
  // cuántos kilos es una unidad de alambre.
  const conv = factorDe ? convertirALaBase(l.nombreNorm || normInsumo(l.nombre), uLinea, l.cantidad, factorDe) : null;
  const u = conv ? conv.unidad : uLinea;
  const cant = conv ? conv.cantidad : l.cantidad;
  if (conv) lado.convertidas = (lado.convertidas || 0) + 1;
  lado.porUnidad.set(u, (lado.porUnidad.get(u) || 0) + cant);
  const monto = l.precio * l.cantidad;
  if (monto) {
    lado.porMoneda.set(l.moneda, (lado.porMoneda.get(l.moneda) || 0) + monto);
    if (esAnticipo) {
      lado.anticiposPorMoneda.set(l.moneda, (lado.anticiposPorMoneda.get(l.moneda) || 0) + monto);
    }
  }
  const pk = l.proveedorId || `s/n:${l.proveedorNombre || '¿?'}`;
  if (!lado.proveedores.has(pk)) {
    lado.proveedores.set(pk, { id: l.proveedorId, nombre: l.proveedorNombre || '(sin nombre)', veces: 0 });
  }
  lado.proveedores.get(pk).veces++;
  if (l.fecha >= lado.ultimaFecha) {
    lado.ultimaFecha = l.fecha;
    lado.ultimoPrecio = l.precio || lado.ultimoPrecio;
    lado.ultimaMoneda = l.moneda;
    lado.ultimoProveedor = l.proveedorNombre || null;
  }
};

const cerrarLado = (lado) => ({
  veces: lado.veces,
  interco: lado.interco,
  // Cuántas líneas se sumaron convertidas a la unidad base del grupo (tanda 5).
  convertidas: lado.convertidas || 0,
  anticiposCount: lado.anticiposCount || 0,
  anticiposMontos: [...(lado.anticiposPorMoneda?.entries() || [])]
    .map(([moneda, monto]) => ({ moneda, monto }))
    .sort((a, b) => b.monto - a.monto),
  cantidades: [...lado.porUnidad.entries()]
    .map(([unidad, cantidad]) => ({ unidad, label: labelUnidad(unidad), cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad),
  montos: [...lado.porMoneda.entries()]
    .map(([moneda, monto]) => ({ moneda, monto }))
    .sort((a, b) => b.monto - a.monto),
  proveedores: [...lado.proveedores.values()].sort((a, b) => b.veces - a.veces),
  ultimaFecha: lado.ultimaFecha,
  ultimoPrecio: lado.ultimoPrecio,
  ultimaMoneda: lado.ultimaMoneda,
  ultimoProveedor: lado.ultimoProveedor,
});

// ── TANDA 7: el efecto de las transformaciones, POR GRUPO ─────────
// 🔴 Se reagrupa por la MISMA clave que usa el inventario (`claveGrupoDe`) y no
// por nombre normalizado, y no es un detalle de estilo:
//
//  · un grupo puede tener varias variantes transformadas por separado
//    («PLANCHA LAF 1/16» y «PLANCHA LAF(1/16)»), y leer solo una perdería la
//    otra — a diferencia del destino, que es una política única y por eso sí se
//    queda con la primera;
//  · y si lo que SALIÓ está correlacionado con un insumo que ya se compra pero
//    con otro nombre, buscar por variante no lo encontraría y terminaría
//    creando una fila nueva con la MISMA clave que la existente: dos filas del
//    mismo insumo en la pantalla, cada una con medio saldo.
function efectosPorClave(transformadoDe, grupoDe) {
  const out = new Map();
  if (!transformadoDe || !transformadoDe.size) return out;
  for (const [norm, e] of transformadoDe) {
    if (!norm || !e) continue;
    const clave = claveGrupoDe(norm, grupoDe);
    if (!out.has(clave)) {
      out.set(clave, {
        _consumido: new Map(), _producido: new Map(),
        valorConsumido: 0, valorProducido: 0, vecesConsumido: 0, vecesProducido: 0,
        nombres: [],
      });
    }
    const acc = out.get(clave);
    for (const c of (e.consumido || [])) acc._consumido.set(c.unidad, (acc._consumido.get(c.unidad) || 0) + c.cantidad);
    for (const p of (e.producido || [])) acc._producido.set(p.unidad, (acc._producido.get(p.unidad) || 0) + p.cantidad);
    acc.valorConsumido += e.valorConsumido || 0;
    acc.valorProducido += e.valorProducido || 0;
    acc.vecesConsumido += e.vecesConsumido || 0;
    acc.vecesProducido += e.vecesProducido || 0;
    for (const n of (e.nombres || [])) if (!acc.nombres.includes(n)) acc.nombres.push(n);
  }
  const cerrar = (m) => [...m.entries()]
    .map(([unidad, cantidad]) => ({ unidad, label: labelUnidad(unidad), cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
  for (const [clave, acc] of out) {
    out.set(clave, {
      consumido: cerrar(acc._consumido), producido: cerrar(acc._producido),
      valorConsumido: acc.valorConsumido, valorProducido: acc.valorProducido,
      vecesConsumido: acc.vecesConsumido, vecesProducido: acc.vecesProducido,
      nombres: acc.nombres,
    });
  }
  return out;
}

/** El orden de la lista: el mayor gasto en UNA moneda, y a igual gasto, quién se movió más. */
const porGasto = (a, b) => (b.orden - a.orden) || (b.comprado.veces - a.comprado.veces);

/**
 * Inventario de una empresa a partir de las líneas de factura ya extraídas
 * (extraerLineasDeFacturas de analisis-insumos.js).
 *
 * @param lineas  líneas crudas (de todas las empresas o ya filtradas)
 * @param opts.companyId  filtra a esa empresa (si se omite, toma todo lo dado)
 * @param opts.grupoDe    Map(nombreNorm → gid) de las correlaciones confirmadas
 * @param opts.grupos     Map(gid → {canonico}) para el nombre a mostrar
 * @param opts.noInventariables  Set(nombreNorm) de las descripciones que una
 *        persona marcó como «esto no es un insumo» (tanda 3) — ver
 *        `noInventariables()` en insumo-o-servicio.js.
 * @param opts.factorDe  de construirGrupos() (tanda 5): cómo convertir cada
 *        presentación a la unidad base de su grupo. Sin esto, cada unidad
 *        sigue en su propia fila — que es el comportamiento correcto mientras
 *        nadie haya declarado el factor.
 * @returns { insumos:[...], totales:{...} }
 */
export function inventarioDeEmpresa(lineas, opts = {}) {
  const {
    companyId = null, grupoDe = null, grupos = null, desde = null, hasta = null,
    noInventariables = null, factorDe = null,
    // Tanda 6: el HECHO (qué líneas ya son un activo fijo) y la DECISIÓN (qué
    // va a pasar con este insumo). Los dos llegan RESUELTOS desde
    // `destino-inventario.js` — ver la nota de los imports arriba.
    //   esActivo(linea) → bool
    //   destinoDe: Map(nombreNorm → { destino, saldoVendible })
    esActivo = null, destinoDe = null,
    // Tanda 7: lo que entró de una forma y salió de otra. Llega RESUELTO desde
    // `transformacion.js` (`efectoEnInventario`), por el mismo motivo que los
    // dos de arriba: esta lib es la BASE y no importa capas que estén encima.
    //   transformadoDe: Map(nombreNorm → { consumido, producido, valor… })
    transformadoDe = null,
  } = opts;
  const porInsumo = new Map();
  const facturasAnuladas = new Set();
  const facturasHeredadas = new Set();
  const noInv = new Set();
  const totales = {
    insumos: 0, lineasCompra: 0, lineasVenta: 0, lineasSinPrecio: 0,
    lineasNota: 0, lineasAnticipo: 0, gastos: new Map(), ingresos: new Map(),
    anticipos: new Map(),
    // Tanda 1: lo que la nota de crédito se llevó, y lo que solo rebajó.
    lineasAnuladas: 0, facturasAnuladas: 0, lineasRebajadas: 0,
    // Tanda 2: lo que entró por una compra espejo, leyendo el detalle de la
    // venta de la otra empresa del grupo. Se cuenta aparte porque es mercadería
    // que ESTÁ en el inventario y cuyo detalle NO está en el comprobante.
    lineasHeredadas: 0, facturasHeredadas: 0,
    // Tanda 3: lo que una persona marcó como «esto no va al inventario».
    lineasNoInventariables: 0, nombresNoInventariables: 0,
  };

  for (const l of (lineas || [])) {
    if (!l) continue;
    if (companyId && l.companyId !== companyId) continue;
    if (l.cancelado) continue;
    // ── Filtro temporal (Tanda 3) ─────────────────────────────────────
    // Se aplica ANTES de contar lineasNota: si el período no incluye la
    // nota de crédito tampoco debe restar. Coherencia del período.
    if (desde && l.fecha && l.fecha < desde) continue;
    if (hasta && l.fecha && l.fecha > hasta) continue;
    if (l.esNota) { totales.lineasNota++; continue; }
    // ── LA FACTURA ANULADA POR NOTA DE CRÉDITO (tanda 1) ─────────────
    // La operación se deshizo: esa mercadería nunca entró. Se descarta igual
    // que una cancelada, pero se CUENTA — 86 líneas desaparecen de un saldo
    // que la contadora venía leyendo como stock, y desaparecer en silencio
    // sería cambiarle el número sin decirle por qué. La UI muestra el aviso.
    if (l.anulada) {
      totales.lineasAnuladas++;
      if (l.movId) facturasAnuladas.add(l.movId);
      continue;
    }
    // Rebajada por una nota PARCIAL: la compra sigue siendo real (no se
    // descarta), pero la cantidad de acá está sin rebajar. Ver `lineasRebajadas`.
    if (l.rebajada) totales.lineasRebajadas++;
    // ── EL DETALLE QUE SE LEE DEL OTRO LADO (tanda 2) ────────────────
    // La compra espejo no trae sus ítems: los presta la venta de origen. La
    // mercadería es de esta empresa y cuenta como cualquier otra, pero se
    // cuenta aparte para poder DECIRLO — quien mire el comprobante no va a
    // encontrar ahí las líneas que ve en esta tabla.
    if (l.heredadaDe) {
      totales.lineasHeredadas++;
      if (l.movId) facturasHeredadas.add(l.movId);
    }
    // ── «ESTO NO VA AL INVENTARIO» (tanda 3) ─────────────────────────
    // Una persona dijo que esta descripción no es mercadería: un arbitraje,
    // un seguro, una detracción. No es un bien que entre ni salga, así que no
    // tiene cantidades que sumar ni saldo que cuadrar. Se descarta y se
    // cuenta, igual que las anuladas: la pantalla lo dice.
    if (noInventariables && noInventariables.has(l.nombreNorm || normInsumo(l.nombre))) {
      totales.lineasNoInventariables++;
      noInv.add(l.nombreNorm || normInsumo(l.nombre));
      continue;
    }

    const clave = claveGrupoDe(l.nombre, grupoDe);
    if (!porInsumo.has(clave)) {
      const g = grupos && grupos.get(clave);
      porInsumo.set(clave, {
        clave,
        display: (g && g.canonico) || l.nombre,
        variantes: new Set(),
        tipos: new Set(),
        _compra: nuevoLado(),
        _venta: nuevoLado(),
        recepcion: { conDato: 0, recibido: 0 },
        rebajadas: 0,
        heredadas: 0,
        activosCargados: 0,
        lineas: [],
      });
    }
    const ins = porInsumo.get(clave);
    ins.variantes.add(l.nombre);
    if (l.rebajada) ins.rebajadas++;
    if (l.heredadaDe) ins.heredadas++;
    // ── EL HECHO: esta línea ya es un activo fijo (tanda 6) ──────────
    // No es una opinión ni una propuesta: hay una fila en `activos_fijos`
    // apuntando a esta línea de esta factura. El dato existía desde siempre;
    // lo que faltaba era que el inventario lo leyera.
    if (esActivo && esActivo(l)) ins.activosCargados++;
    // ── Override de tipo por texto (Tanda 3) ──────────────────────────
    // 'clasificarLineaPorTexto' detecta anticipos, valorizaciones de obra,
    // liquidaciones, alquileres, etc. y les asigna el tipo correcto antes
    // de que el tipo de la IA entre en juego. Si no hay override, cae al
    // tipo original del ítem (asignado en Captura Mágica).
    const tipoEfectivo = clasificarLineaPorTexto(l.nombre) || l.tipoInsumo;
    if (tipoEfectivo) ins.tipos.add(tipoEfectivo);
    if (tipoEfectivo === 'anticipo') {
      totales.lineasAnticipo++;
      const mAnt = l.precio * l.cantidad;
      if (mAnt) totales.anticipos.set(l.moneda, (totales.anticipos.get(l.moneda) || 0) + mAnt);
    }
    ins.lineas.push(l);
    if (l.precio <= 0) totales.lineasSinPrecio++;

    if (l.clase === 'venta') {
      totales.lineasVenta++;
      acumular(ins._venta, l, factorDe);
      const monto = l.precio * l.cantidad;
      if (monto) totales.ingresos.set(l.moneda, (totales.ingresos.get(l.moneda) || 0) + monto);
    } else {
      totales.lineasCompra++;
      acumular(ins._compra, l, factorDe);
      const monto = l.precio * l.cantidad;
      if (monto) totales.gastos.set(l.moneda, (totales.gastos.get(l.moneda) || 0) + monto);
      // La recepción de almacén se escribe sobre el ítem de la factura de
      // COMPRA (cruce-recepcion.js). En producción casi nadie la usa todavía:
      // por eso se informa "cuántas líneas tienen el dato", no un 0 que
      // parecería "no llegó nada".
      if (l.tieneRecepcion) {
        ins.recepcion.conDato++;
        ins.recepcion.recibido += l.recibido;
      }
    }
  }

  // Tanda 7: el efecto de las transformaciones, agrupado por la misma clave con
  // la que se agruparon las líneas de factura. Ver `efectosPorClave`.
  const efectoDe = efectosPorClave(transformadoDe, grupoDe);

  const insumos = [...porInsumo.values()].map(ins => {
    const compra = cerrarLado(ins._compra);
    const venta = cerrarLado(ins._venta);
    // El destino se busca por CUALQUIERA de sus variantes: el grupo puede
    // haberse marcado desde el nombre que escribe un proveedor y mostrarse
    // con el que escribe otro. Gana la primera que tenga decisión — son el
    // mismo insumo, así que no pueden tener dos destinos distintos.
    let destino = null;
    let saldoVendible = true;
    let destinoAutomatico = false;
    if (destinoDe) {
      for (const v of ins.variantes) {
        const d = destinoDe.get(normInsumo(v));
        if (d && d.destino) {
          destino = d.destino;
          saldoVendible = d.saldoVendible !== false;
          break;
        }
      }
    }
    // ── EL ACTIVO FIJO YA CONTESTÓ LA PREGUNTA (16-set-2026) ──────
    // Gabriel: «me parece que los activos fijos deberia salir directamente
    // como "uso de empresa" en lugar de tener que elegir, estos usualmente los
    // usaremos o alquilaremos, por ejemplo, la motocarga kratoz se alquilará».
    //
    // Tiene razón y además es lo COHERENTE: que una compra esté cargada en el
    // registro 7.1 significa que la empresa la va a usar por años y la va a
    // depreciar. Eso YA dice que no es mercadería esperando comprador —
    // preguntarlo de nuevo con un desplegable es pedir dos veces la misma
    // respuesta, y dejarlo vacío hace que su saldo cuente como «lo que queda
    // por colocar» y que la motocarga aparezca en el botón rojo de negativos.
    //
    // ALQUILARLA NO LO CAMBIA: alquilar es explotar un bien propio, no
    // venderlo. El bien sigue siendo de la empresa y sigue depreciándose; el
    // cajón «Para revender» es para lo que se compró para volver a venderlo.
    //
    // 🔴 LA DECISIÓN EXPLÍCITA SIEMPRE GANA. Esto solo rellena el vacío: si
    // una persona marcó «Para revender» sobre algo que además está en el 7.1
    // —una máquina que se activó y después se decidió vender—, manda ella.
    // Por eso va DESPUÉS del bucle y solo cuando `destino` sigue en null.
    if (!destino && (ins.activosCargados || 0) > 0) {
      destino = 'activo_uso';
      saldoVendible = false;
      destinoAutomatico = true;
    }
    // ── TANDA 7: lo que se transformó ────────────────────────────
    const transf = efectoDe.get(ins.clave) || null;
    const hayTransformacion = !!transf && (transf.consumido.length > 0 || transf.producido.length > 0);

    // Saldo = comprado + producido − vendido − consumido.
    // Solo si la empresa vendió ese insumo O lo transformó: sin ninguna de las
    // dos cosas el "saldo" sería la columna comprado repetida, y encima daría a
    // entender que eso es stock disponible — no lo es: falta el consumo de obra.
    const saldo = (venta.veces === 0 && !hayTransformacion) ? [] : [...new Set([
      ...compra.cantidades.map(c => c.unidad),
      ...venta.cantidades.map(v => v.unidad),   // vendió en una unidad que no compró
      ...(transf ? transf.consumido.map(c => c.unidad) : []),
      ...(transf ? transf.producido.map(p => p.unidad) : []),
    ])].map(unidad => {
      const c = compra.cantidades.find(x => x.unidad === unidad);
      const v = venta.cantidades.find(x => x.unidad === unidad);
      const co = transf && transf.consumido.find(x => x.unidad === unidad);
      const pr = transf && transf.producido.find(x => x.unidad === unidad);
      return {
        unidad,
        label: labelUnidad(unidad),
        cantidad: (c ? c.cantidad : 0) + (pr ? pr.cantidad : 0)
                - (v ? v.cantidad : 0) - (co ? co.cantidad : 0),
      };
    });

    // Total comprado en PEN (equivalente)
    const totalCompraPen = compra.montos.reduce((tot, m) => {
      return tot + (m.moneda === 'PEN' ? m.monto : convertirMoneda({ monto: m.monto, monedaOrigen: m.moneda, monedaDestino: 'PEN' }));
    }, 0);
    // Total vendido en PEN (equivalente)
    const totalVentaPen = venta.montos.reduce((tot, m) => {
      return tot + (m.moneda === 'PEN' ? m.monto : convertirMoneda({ monto: m.monto, monedaOrigen: m.moneda, monedaDestino: 'PEN' }));
    }, 0);

    const tieneVentas = venta.veces > 0;
    const tieneCompras = compra.veces > 0;
    // ── EL COSTO DE ESTA FILA, CON LA TRANSFORMACIÓN ADENTRO (tanda 7) ──
    // Lo que salió transformado se llevó su valor a OTRA fila, y lo que llegó
    // transformado trajo el suyo. Sin esta cuenta el mismo sol se contaría dos
    // veces: una en la plancha que se cortó y otra en las láminas que salieron.
    // Sin transformaciones, `costoNetoPen` es exactamente `totalCompraPen` y
    // nada de lo de abajo cambia.
    const costoNetoPen = totalCompraPen + (transf ? transf.valorProducido - transf.valorConsumido : 0);
    // Una lámina que nadie compró pero que salió de una plancha SÍ tiene costo:
    // por eso el margen ya no exige compras, exige costo.
    const tieneCosto = tieneCompras || !!(transf && transf.valorProducido > 0);
    const margenEconomicoPen = tieneVentas && tieneCosto ? totalVentaPen - costoNetoPen : null;
    const margenPct = tieneVentas && totalVentaPen > 0 && tieneCosto
      ? ((totalVentaPen - costoNetoPen) / totalVentaPen) * 100
      : null;

    return {
      clave: ins.clave,
      display: ins.display,
      variantes: [...ins.variantes].sort(),
      tipos: [...ins.tipos].sort(),
      esAnticipo: ins.tipos.has('anticipo'),
      comprado: compra,
      vendido: venta,
      saldo,
      totalCompraPen,
      totalVentaPen,
      costoNetoPen,
      margenEconomicoPen,
      margenPct,
      // Cuántas de sus líneas vienen de una factura que una nota de crédito
      // rebajó en parte: la cantidad de este insumo está SIN rebajar.
      rebajadas: ins.rebajadas || 0,
      // Cuántas de sus líneas vienen prestadas de la venta de la otra empresa
      // (tanda 2): la fila lo dice con la chapita «↩ del otro libro».
      heredadas: ins.heredadas || 0,
      // ── TANDA 6 ──────────────────────────────────────────────────
      // `activosCargados`: cuántas de sus compras ya están en el registro
      // 7.1 (un hecho). `destino`: qué dijo una persona que va a pasar con
      // este insumo (una decisión). `saldoVendible`: si la columna Saldo
      // significa «lo que queda por colocar» o es otra cosa.
      activosCargados: ins.activosCargados || 0,
      destino,
      // `destinoAutomatico`: nadie lo eligió — se derivó de estar en el 7.1.
      // La pantalla lo dice, para que se distinga de una decisión tomada.
      destinoAutomatico,
      saldoVendible,
      // Tanda 7: qué se consumió y qué salió de este insumo, o null si nunca
      // entró en una transformación (que es el caso de casi todo).
      transformado: transf,
      origen: 'factura',
      recepcion: ins.recepcion,
      lineas: ins.lineas.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)),
      // Solo para ORDENAR: el mayor gasto en UNA moneda (no se suman monedas).
      orden: Math.max(0, ...compra.montos.map(m => m.monto)),
    };
  }).sort(porGasto);

  // ── LO QUE SOLO EXISTE PORQUE SALIÓ DE UNA TRANSFORMACIÓN (tanda 7) ──
  // Las láminas no las compró nadie: no tienen línea de factura, así que no
  // aparecerían en ninguna fila y el valor de la plancha cortada se
  // evaporaría de la pantalla. Se agregan con `origen: 'transformacion'`, que
  // es lo que la UI usa para decir de dónde salieron.
  if (efectoDe.size) {
    const vacio = cerrarLado(nuevoLado());
    for (const [clave, efecto] of efectoDe) {
      // Si el insumo ya tiene filas de factura, su efecto ya se aplicó arriba:
      // acá solo entran los que no tienen NINGUNA compra ni venta detrás.
      if (porInsumo.has(clave)) continue;
      if (!efecto || (!efecto.producido?.length && !efecto.consumido?.length)) continue;
      const display = (efecto.nombres && efecto.nombres[0]) || clave;
      const dest = destinoDe ? destinoDe.get(normInsumo(display)) : null;
      const unidades = new Set([
        ...(efecto.producido || []).map(p => p.unidad),
        ...(efecto.consumido || []).map(c => c.unidad),
      ]);
      insumos.push({
        clave,
        display,
        variantes: (efecto.nombres || [display]).slice().sort(),
        tipos: [],
        esAnticipo: false,
        comprado: vacio,
        vendido: vacio,
        saldo: [...unidades].map(unidad => {
          const pr = (efecto.producido || []).find(x => x.unidad === unidad);
          const co = (efecto.consumido || []).find(x => x.unidad === unidad);
          return {
            unidad, label: labelUnidad(unidad),
            cantidad: (pr ? pr.cantidad : 0) - (co ? co.cantidad : 0),
          };
        }),
        totalCompraPen: 0,
        totalVentaPen: 0,
        costoNetoPen: (efecto.valorProducido || 0) - (efecto.valorConsumido || 0),
        margenEconomicoPen: null,
        margenPct: null,
        rebajadas: 0,
        heredadas: 0,
        activosCargados: 0,
        destino: dest?.destino || null,
        saldoVendible: dest ? dest.saldoVendible !== false : true,
        transformado: {
          consumido: efecto.consumido || [], producido: efecto.producido || [],
          valorConsumido: efecto.valorConsumido || 0, valorProducido: efecto.valorProducido || 0,
          vecesConsumido: efecto.vecesConsumido || 0, vecesProducido: efecto.vecesProducido || 0,
        },
        origen: 'transformacion',
        recepcion: { conDato: 0, recibido: 0 },
        lineas: [],
        orden: 0,
      });
    }
    insumos.sort(porGasto);
  }

  totales.insumos = insumos.length;
  totales.facturasAnuladas = facturasAnuladas.size;
  totales.facturasHeredadas = facturasHeredadas.size;
  totales.nombresNoInventariables = noInv.size;
  // Tanda 7: cuántos insumos tocó una transformación, y cuántos existen SOLO
  // porque salieron de una (los que no tienen ni una factura detrás).
  totales.insumosTransformados = insumos.filter(i => i.transformado).length;
  totales.insumosProducidos = insumos.filter(i => i.origen === 'transformacion').length;
  return {
    insumos,
    totales: {
      ...totales,
      gastos: [...totales.gastos.entries()].map(([moneda, monto]) => ({ moneda, monto })).sort((a, b) => b.monto - a.monto),
      ingresos: [...totales.ingresos.entries()].map(([moneda, monto]) => ({ moneda, monto })).sort((a, b) => b.monto - a.monto),
      anticipos: [...totales.anticipos.entries()].map(([moneda, monto]) => ({ moneda, monto })).sort((a, b) => b.monto - a.monto),
    },
  };
}

/**
 * Filtra insumos según su flujo de movimiento:
 *  - 'todos': todos
 *  - 'solo_compras': tienen compras registradas pero ninguna venta
 *  - 'solo_ventas': tienen ventas registradas pero ninguna compra
 *  - 'ambos': tienen tanto compras como ventas registradas
 */
export function filtrarPorFlujo(insumos = [], flujo = 'todos') {
  if (!flujo || flujo === 'todos') return insumos || [];
  if (flujo === 'solo_compras') {
    return (insumos || []).filter(i => (i.comprado?.veces > 0) && (!i.vendido || i.vendido.veces === 0));
  }
  if (flujo === 'solo_ventas') {
    return (insumos || []).filter(i => (i.vendido?.veces > 0) && (!i.comprado || i.comprado.veces === 0));
  }
  if (flujo === 'ambos') {
    return (insumos || []).filter(i => (i.comprado?.veces > 0) && (i.vendido?.veces > 0));
  }
  return insumos || [];
}

/**
 * Filtro de texto sobre el inventario: busca en el nombre a mostrar y en TODAS
 * las variantes del grupo (con la misma normalización que las correlaciones,
 * así "clavo 8" encuentra "Clavos de 8''"). Todos los tokens deben aparecer.
 */
export function filtrarInventario(insumos, texto) {
  const toks = normInsumo(texto).split(' ').filter(Boolean);
  if (!toks.length) return insumos || [];
  return (insumos || []).filter(ins => {
    const heno = normInsumo([ins.display, ...ins.variantes].join(' '));
    return toks.every(t => heno.includes(t));
  });
}

/**
 * LOS INSUMOS EN ROJO: la empresa vendió más de lo que compró (tanda 9).
 *
 * Gabriel, 7-set-2026, sobre facturar una orden por más de lo que hay:
 *   «se puede hacer la factura si realmente no tenemos dicha cantidad? Sí, se
 *    puede, pero también advirtiendo de esto a la persona que realiza la
 *    factura. En caso se realice a pesar de las advertencias, en el inventario
 *    de la empresa que emitió la factura se mostrará […] que tienen un stock
 *    negativo.»
 *
 * ── UN SALDO NEGATIVO NO ES UN ERROR DE LA APP ────────────────────
 * Es un hecho contable que hay que ver. Las tres causas, todas reales:
 *   1. Se facturó lo que todavía no se compró (se compra después para entregar).
 *   2. La compra existe pero está cargada en otra empresa del grupo.
 *   3. La compra está escrita con otro nombre y todavía no se mapeó.
 *
 * Por eso esto no bloquea nada ni «corrige» el saldo: lo cuenta y lo muestra.
 * Redondear a cero sería tapar las tres.
 *
 * ⚠️ Solo mira los insumos que la empresa VENDIÓ: sin ventas, `saldo` viene
 * vacío a propósito (sería la columna Comprado repetida) y un «negativo» ahí no
 * significaría nada.
 *
 * @returns { insumos:[...], total, unidades:Map(unidad→cantidad) }
 */
export function saldosNegativos(insumos = []) {
  const out = [];
  const unidades = new Map();
  for (const ins of insumos) {
    // ── TANDA 6: el rojo es de lo que se revende ─────────────────────
    // «Vendió más de lo que compró» es una alarma sobre MERCADERÍA. Para un
    // activo de uso el saldo es lo que la empresa tiene y usa, y para lo que
    // se transforma no cierra hasta que exista el movimiento que lo
    // convierte: pintarlos del mismo rojo es cómo se consigue que nadie mire
    // ninguno. Sin destino marcado —que es el caso de casi todo— se comporta
    // igual que siempre.
    if (ins && ins.saldoVendible === false) continue;
    const rojos = (ins?.saldo || []).filter(s => Number(s.cantidad) < -0.0001);
    if (!rojos.length) continue;
    out.push({ ...ins, negativos: rojos });
    for (const r of rojos) unidades.set(r.unidad, (unidades.get(r.unidad) || 0) + Number(r.cantidad));
  }
  return { insumos: out, total: out.length, unidades };
}

/** ¿Este insumo está en rojo? Para pintar la fila sin recorrer la lista aparte. */
export const tieneSaldoNegativo = (ins) =>
  ins?.saldoVendible !== false
  && (ins?.saldo || []).some(s => Number(s.cantidad) < -0.0001);
