// ═══════════════════════════════════════════════════════════════════
// JARVEX — LO QUE SUNAT TIENE CONTRA LO QUE TIENE JARVEX (tanda 14, entrega 5).
// Lib PURA. Testeada en __tests__/comparativa-sunat.test.js con el cruce REAL
// de julio-2026 de JARVEX, que es el que descubrió todo lo de abajo.
//
// ── LA PREGUNTA ───────────────────────────────────────────────────
// SUNAT ya sabe qué le facturaron a la empresa y qué facturó ella. La app sabe
// lo que alguien cargó. La comparativa dice en qué se diferencian, y es de
// SOLO LECTURA por decisión de Gabriel (8-set-2026): reporta y exporta, no da
// de alta ni corrige. Lo que falta se sigue cargando por Captura Mágica con el
// PDF, que es lo único que trae el detalle.
//
// ── 🔴 LA LLAVE LLEVA EL TIPO DE COMPROBANTE ──────────────────────
// En el archivo de ventas de julio conviven `01 E001-1` (la factura de
// S/ 12.920 a EL INCA) y `07 E001-1` (la nota de crédito que la anula). MISMA
// serie, MISMO número. Si la llave fuera solo serie+número+RUC, la nota
// cruzaría contra su propia factura y la pantalla diría «todo cuadra» mientras
// a la app le falta la anulación y sigue contando S/ 12.920 de ingreso que no
// existe. Por eso la llave es `tipo|serie|número|RUC`, siempre.
//
// ── EL NÚMERO SE NORMALIZA A NÚMERO, NO A TEXTO ───────────────────
// SUNAT escribe `292` y la app `FDX1-292`; el PDF del proveedor dice
// `FDX1-00000292`. Los tres son el mismo comprobante. El correlativo se compara
// como NÚMERO (`Number('00000292') === 292`), nunca como cadena.
//
// ── LO QUE NO ES UNA DIFERENCIA ───────────────────────────────────
// El NOMBRE del proveedor no se compara nunca. SUNAT guarda la razón social
// legal y la app el nombre comercial, que es como lo reconoce la contadora:
// «ZAVALETA GARCIA PERCY PAUL» es «FERRETERIA ZAVALETA», «CRUZADO RUIZ AYBAR
// TOMAS» es «TORNOS AYBAR». En julio 4 de 30 diferían y ninguna era un error.
// Marcarlas habría llenado la pantalla de ruido y enterrado las 5 que sí
// faltaban. El nombre se MUESTRA, no se juzga.
//
// ── LO MEDIDO EN JULIO-2026 CON JARVEX (no repetir estas consultas) ─
// COMPRAS: SUNAT 35 · JARVEX 30. 29 cruzan exacto con el importe idéntico.
//   1 con la serie mal: CHIFA MONTEORO es `FA01-5101` en SUNAT y está cargada
//   como `F001-5101` (mismo RUC, mismo S/ 134,00, misma fecha) → por eso existe
//   el rescate por RUC+importe+fecha, si no habría salido como dos errores
//   (una que falta y una que sobra) en vez de uno.
//   5 faltan de verdad, S/ 17.254,60: FRONTIER `F001-170359` S/ 16.949,60 ·
//   CGR `F004-2866` S/ 100 · PETRO LA MERCED `F203-1570` S/ 120 · dos
//   comisiones de INTERBANK `FCC1-7964323/24` (S/ 85, no gravadas).
// VENTAS: SUNAT 5 · JARVEX 4. Las 4 facturas cruzan; falta la nota de crédito
//   `07 E001-1` de −S/ 12.920.
//
// ── DOS DIAGNÓSTICOS MÁS, MEDIDOS EN GASOMI EL 13-SET-2026 ────────
// Gabriel: «el comprobante dice que no está en JARVEX pero también dice que
// hay uno en SUNAT, ¿cómo vinculo esto? Parece que ya está vinculada pero en
// otra fecha» — y el caso de AUTOMANIA PERU (FF01-11086): «me sale que SUNAT
// no la tiene, pero SUNAT sí la tiene, tal vez está declarada en otro mes».
// Se investigó cada caso contra la base real en vez de asumir; ninguno de los
// dos era «otro mes»:
//
//   1) DUPLICADO_JARVEX — AUTOMANIA PERU S.A.C. (RUC 20570848985), FF01-11086,
//      S/ 330, 27-abr-2026: estaba cargada DOS VECES en accounting_movements
//      (dos ids, mismo RUC-serie-número-fecha-importe — un doble registro,
//      probablemente de una doble confirmación). SUNAT trae la factura UNA
//      sola vez (verificado en el corte 202604): una carga cruza como
//      «cuadra» y la otra, sin nada contra qué cruzar, caía en «SUNAT no lo
//      tiene» — que suena a que a SUNAT le falta información, cuando el
//      problema es el opuesto: a JARVEX le sobra un registro.
//   2) RUC_DISTINTO — PACÍFICO COMPAÑÍA DE SEGUROS (GASOMI), serie F087: cada
//      mes hay DOS movimientos con el MISMO número de comprobante
//      (F087-1328120 en junio, F087-1278273 en marzo, …) pero con dos RUC
//      distintos (20332970411 y 20418896915) y montos casi idénticos
//      (S/ 254,26-254,28 — una prima recurrente). El rescate por RUC+importe
//      emparejaba por error uno de junio contra uno de marzo («cargado en
//      otro mes»), y el otro RUC del mismo mes quedaba huérfano («SUNAT no
//      lo tiene»). Sin poder abrir el PDF no se sabe si es un RUC mal
//      tipeado o dos entidades reales del grupo asegurador — así que el
//      diagnóstico MUESTRA el contraste (mismo N°, RUC distinto) en vez de
//      adivinar para cuál lado inventar una fecha.
// ═══════════════════════════════════════════════════════════════════

import { partirDocumento } from './serie-comprobante.js';
import { esVentaMov } from './costo-obra.js';
import { TIPO_CP_A_DOCUMENTO } from './sunat-csv.js';

/** Dos importes son el mismo si difieren en menos de un centavo largo. */
const TOLERANCIA = 0.05;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rucLimpio = (x) => String(x ?? '').replace(/\D/g, '');
const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);

/** El `document_type` de la app → el tipo de SUNAT ('factura' → '01'). */
const DOCUMENTO_A_TIPO_CP = Object.fromEntries(
  Object.entries(TIPO_CP_A_DOCUMENTO).map(([cp, doc]) => [doc, cp]),
);

/**
 * La llave con la que se cruza un comprobante: tipo, serie, correlativo y el
 * RUC de la contraparte. Devuelve '' si al movimiento le falta algo para ser
 * cruzable (sin serie-correlativo no hay cruce posible).
 */
export function llaveComprobante({ tipoCp, serie, numero, ruc } = {}) {
  const s = String(serie || '').trim().toUpperCase();
  const n = Number(numero) || 0;
  const t = String(tipoCp || '').padStart(2, '0');
  const r = rucLimpio(ruc);
  if (!s || !n || !r) return '';
  return `${t}|${s}|${n}|${r}`;
}

/** La llave de una fila del CSV de SUNAT. */
export const llaveDeFilaSunat = (f) => llaveComprobante({
  tipoCp: f?.tipoCp, serie: f?.serie, numero: f?.numero, ruc: f?.contraparteRuc,
});

/** La llave de un movimiento de `accounting_movements`. */
export function llaveDeMovimiento(m) {
  const p = partirDocumento(m?.document_number);
  if (!p) return '';
  return llaveComprobante({
    tipoCp: DOCUMENTO_A_TIPO_CP[m?.document_type] || '01',
    serie: p.serie, numero: p.correlativo, ruc: m?.third_party_ruc,
  });
}

/**
 * Los movimientos de la app que compiten contra este libro.
 *
 * Se filtra por SENTIDO, no solo por empresa: una venta nunca puede cruzar
 * contra el archivo de compras aunque compartan serie y número. En el grupo eso
 * pasa de verdad —JARVEX le vende a EL INCA y las dos tienen el comprobante
 * cargado—, así que sin este filtro el cruce encontraría el espejo del otro
 * lado y daría por registrado algo que en esta empresa falta.
 */
export function movimientosDelLibro(movs, { companyId, libro }) {
  const quiereVenta = libro === 'ventas';
  return vivos(movs).filter(m =>
    m.company_id === companyId &&
    m.payment_status !== 'cancelled' &&
    esVentaMov(m) === quiereVenta,
  );
}

/** El mes 'YYYY-MM' de una fecha 'YYYY-MM-DD'. Por string, nunca con Date. */
const mesDe = (fecha) => String(fecha || '').slice(0, 7);

/** '202607' → '2026-07'. */
export const mesDePeriodo = (periodo) => {
  const s = String(periodo || '');
  return /^\d{6}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}` : '';
};

const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function formatoPeriodoHumano(periodoOFecha) {
  if (!periodoOFecha) return '';
  const s = String(periodoOFecha).trim();
  const mYmd = s.match(/^(\d{4})[-/](\d{2})/);
  if (mYmd) {
    const y = mYmd[1];
    const m = parseInt(mYmd[2], 10);
    if (m >= 1 && m <= 12) return `${NOMBRES_MES[m - 1]} ${y}`;
  }
  const mYm = s.match(/^(\d{4})(\d{2})$/);
  if (mYm) {
    const y = mYm[1];
    const m = parseInt(mYm[2], 10);
    if (m >= 1 && m <= 12) return `${NOMBRES_MES[m - 1]} ${y}`;
  }
  return s;
}

/**
 * El importe con el que se compara: el TOTAL del comprobante.
 *
 * `accounting_movements` no guarda base ni IGV en columnas —el desglose vive en
 * `notas`, y no siempre—, así que el total es lo único que las dos partes
 * tienen sí o sí. En valor ABSOLUTO: una nota de crédito es negativa en SUNAT
 * y en la app casi siempre también, pero hay 2 de 18 cargadas en positivo
 * (las de Despegar). Comparar en absoluto evita que esas dos aparezcan como
 * «importe distinto» —no lo es, es el signo— y el signo se reporta aparte.
 */
const importeDe = (x) => Math.abs(r2(x));

/**
 * ¿El importe de SUNAT y el de JARVEX son el mismo, aunque estén en monedas
 * distintas?
 *
 * ── 🔴 EL BUG QUE ESTO ARREGLA (13-set-2026) ──────────────────────
 * Gabriel: «esta empresa realizó sus facturas en dólares pero en la
 * comparativa de SUNAT vs JARVEX el monto en dólares se los detecta como soles
 * y se detecta una incoherencia».
 *
 * Medido contra los cortes reales de GASOMI (KOPLAST INDUSTRIAL, RUC
 * 20505543174), que factura en dólares:
 *
 *   comprobante   SUNAT dice   TC del archivo   JARVEX tiene   ¿mismo?
 *   F003-3384     279.600,00   3,495            80.000,00 USD  sí (×3,495)
 *   F003-3409      66.070,87   3,385            19.518,72 USD  sí (×3,385)
 *   F003-3436      49.932,06   3,442            14.506,70 USD  sí (×3,442)
 *   F003-3458      31.312,16   3,478             9.002,92 USD  sí (×3,478)
 *
 * O sea: el archivo de SUNAT trae los importes YA CONVERTIDOS A SOLES y el
 * tipo de cambio aparte, en su propia columna —que `sunat-csv.js` ya leía y
 * guardaba, y que nadie usaba—. La app guarda el importe en la moneda del
 * comprobante. Comparar los dos números crudos daba «importe distinto» por
 * S/ 199.600 en la primera fila, y las 13 facturas de KOPLAST salían todas
 * como error. No había ninguna incoherencia: faltaba multiplicar.
 *
 * ── POR QUÉ SE PRUEBAN LAS DOS LECTURAS Y NO SE ASUME UNA ─────────
 * Se probó primero el número crudo y después el convertido. Si mañana SUNAT
 * cambia el layout y manda el importe en la moneda de origen, esto lo sigue
 * cruzando bien en vez de inventar una diferencia nueva: la regla es
 * «coinciden de alguna de las dos formas», no «coinciden después de
 * multiplicar».
 *
 * @returns {{diferencia:number, tipoCambio:number|null, appEnSoles:number|null}}
 */
export function conciliarImporte(filaSunat, mov) {
  const sunat = importeDe(filaSunat?.total);
  const app = importeDe(mov?.amount);
  const difDirecta = r2(sunat - app);
  if (Math.abs(difDirecta) <= TOLERANCIA) {
    return { diferencia: difDirecta, tipoCambio: null, appEnSoles: null };
  }

  const monedaSunat = String(filaSunat?.moneda || 'PEN').trim().toUpperCase();
  const monedaApp = String(mov?.currency || 'PEN').trim().toUpperCase();
  const tc = Number(filaSunat?.tipoCambio) || 0;
  // Solo cuando las dos partes dicen que el comprobante es en la MISMA moneda
  // extranjera y el archivo trajo su tipo de cambio. Sin esas tres cosas,
  // convertir sería adivinar.
  if (monedaSunat !== 'PEN' && monedaSunat === monedaApp && tc > 1) {
    const appEnSoles = r2(app * tc);
    return { diferencia: r2(sunat - appEnSoles), tipoCambio: tc, appEnSoles };
  }
  return { diferencia: difDirecta, tipoCambio: null, appEnSoles: null };
}

/**
 * Cruza un libro de SUNAT contra los movimientos de la app.
 *
 * @param filas  las filas ya parseadas por `parseCsvSunat`
 * @param movs   TODOS los movimientos vivos (no solo los del mes: hace falta
 *               ver los de otros periodos y otras empresas para poder decir
 *               «está, pero en otro lado» en vez de «falta»)
 * @param opts   { companyId, libro, periodo, companies, otrosCortes }
 * @returns { filas: Array<diferencia>, resumen }
 */
export function compararLibro(filas = [], movs = [], { companyId, libro, periodo, companies = [], otrosCortes = [] } = {}) {
  const mes = mesDePeriodo(periodo);
  const nombreEmpresa = new Map(vivos(companies).map(c => [c.id, c.name]));

  // Filas de SUNAT en OTROS períodos cargados para esta empresa y libro (para detectar si
  // lo que JARVEX tiene en este mes ya vino o fue presentado en otro corte).
  const sunatOtrosPeriodosPorLlave = new Map();
  for (const c of vivos(otrosCortes)) {
    if (c.company_id && c.company_id !== companyId) continue;
    if (c.libro && c.libro !== libro) continue;
    if (String(c.periodo) === String(periodo)) continue;
    const perStr = mesDePeriodo(c.periodo) || String(c.periodo || '');
    for (const sf of (c.filas || [])) {
      const k = llaveDeFilaSunat(sf);
      if (!k) continue;
      if (!sunatOtrosPeriodosPorLlave.has(k)) {
        sunatOtrosPeriodosPorLlave.set(k, { ...sf, periodoCorte: perStr, archivoCorte: c.archivo || '' });
      }
    }
  }

  // Los candidatos de ESTA empresa y este sentido, indexados por llave.
  const propios = movimientosDelLibro(movs, { companyId, libro });
  const porLlave = new Map();
  for (const m of propios) {
    const k = llaveDeMovimiento(m);
    if (!k) continue;
    if (!porLlave.has(k)) porLlave.set(k, []);
    porLlave.get(k).push(m);
  }

  // Los de OTRAS empresas, para poder decir «está cargado en GASOMI».
  const ajenos = new Map();
  for (const m of vivos(movs)) {
    if (m.company_id === companyId) continue;
    const k = llaveDeMovimiento(m);
    if (!k) continue;
    if (!ajenos.has(k)) ajenos.set(k, m);
  }

  // ── RUC DISTINTO, MISMO N° DE COMPROBANTE ──────────────────────────
  // Caso real (GASOMI, 13-set-2026): PACÍFICO SEGUROS factura F087-1328120 y
  // JARVEX tiene un movimiento CON ESE MISMO NÚMERO pero un RUC distinto del
  // que trae el archivo de SUNAT — dos entidades del mismo grupo asegurador,
  // o un RUC mal tipeado al cargar. Sin este índice, un lado sale «falta» y
  // el otro «sobra» y nada dice que son el mismo papel con un dato mal puesto.
  // La llave completa incluye el RUC (`tipo|serie|numero|ruc`); acá se indexa
  // SIN el RUC para poder encontrarlos.
  const sinRuc = (llave) => (llave ? llave.split('|').slice(0, 3).join('|') : '');
  const porDocSinRuc = new Map();
  for (const m of propios) {
    const k = sinRuc(llaveDeMovimiento(m));
    if (!k) continue;
    if (!porDocSinRuc.has(k)) porDocSinRuc.set(k, []);
    porDocSinRuc.get(k).push(m);
  }
  // Mismo índice del lado de SUNAT, pero SOLO de este período: es contra el
  // archivo que se está mirando ahora, no contra todo el historial.
  const sunatPorDocSinRuc = new Map();
  for (const f of filas) {
    const k = sinRuc(llaveDeFilaSunat(f));
    if (!k) continue;
    if (!sunatPorDocSinRuc.has(k)) sunatPorDocSinRuc.set(k, []);
    sunatPorDocSinRuc.get(k).push(f);
  }

  // Para el rescate de la serie mal escrita: RUC + importe.
  const porRucImporte = new Map();
  for (const m of propios) {
    const k = `${rucLimpio(m.third_party_ruc)}|${importeDe(m.amount)}`;
    if (!porRucImporte.has(k)) porRucImporte.set(k, []);
    porRucImporte.get(k).push(m);
  }

  const usados = new Set();
  const salida = [];

  for (const f of filas) {
    const llave = llaveDeFilaSunat(f);
    const base = {
      llave,
      libro,
      companyId,
      linea: f.linea,
      tipoCp: f.tipoCp,
      tipoNombre: f.tipoNombre,
      documento: f.documento,
      serie: f.serie,
      numero: f.numero,
      fecha: f.fecha,
      contraparteRuc: f.contraparteRuc,
      contraparteNombre: f.contraparteNombre,
      sunatBase: r2(f.base),
      sunatIgv: r2(f.igv),
      sunatNoGravado: r2(f.noGravado),
      sunatTotal: r2(f.total),
      moneda: f.moneda,
      modifica: f.modificaSerie && f.modificaNumero
        ? `${f.modificaSerie}-${Number(f.modificaNumero) || f.modificaNumero}` : '',
    };

    const candidatos = (llave && porLlave.get(llave)) || [];
    const m = candidatos.find(x => !usados.has(x.id)) || null;

    if (m) {
      usados.add(m.id);
      // El importe se concilia con la moneda y el tipo de cambio del propio
      // archivo — ver `conciliarImporte` y el caso KOPLAST.
      const conc = conciliarImporte(f, m);
      const dif = conc.diferencia;
      const signoDistinto = Math.sign(r2(f.total)) !== 0
        && Math.sign(r2(m.amount)) !== 0
        && Math.sign(r2(f.total)) !== Math.sign(r2(m.amount));
      let estado = 'cuadra';
      let motivoPeriodo = '';
      let periodoDetectado = '';
      if (Math.abs(dif) > TOLERANCIA) estado = 'importe_distinto';
      else if (signoDistinto) estado = 'signo_distinto';
      else if (mes && mesDe(m.date) !== mes) {
        estado = 'otro_periodo';
        periodoDetectado = mesDe(m.date);
        motivoPeriodo = `Registrado en JARVEX en ${formatoPeriodoHumano(periodoDetectado)} (${m.date}) - diferido`;
      }
      else if (f.fecha && m.date !== f.fecha) estado = 'fecha_distinta';
      salida.push({
        ...base, estado,
        movimientoId: m.id,
        companyId: m.company_id || companyId,
        appDocumento: m.document_number,
        appFecha: m.date,
        appTotal: r2(m.amount),
        appMoneda: String(m.currency || 'PEN').trim().toUpperCase(),
        appNombre: m.third_party_name || '',
        periodoDetectado,
        motivoPeriodo,
        diferencia: dif,
        // Con qué tipo de cambio se comparó, para poder decirlo en pantalla.
        // null = no hizo falta convertir (los dos estaban en la misma moneda).
        tipoCambio: conc.tipoCambio,
        appEnSoles: conc.appEnSoles,
      });
      continue;
    }

    // No cruzó por llave. ¿Está cargado en OTRA empresa del grupo?
    const enOtra = llave ? ajenos.get(llave) : null;
    if (enOtra) {
      salida.push({
        ...base, estado: 'otra_empresa',
        movimientoId: enOtra.id,
        empresaAjenaId: enOtra.company_id,
        appDocumento: enOtra.document_number,
        appFecha: enOtra.date,
        appTotal: r2(enOtra.amount),
        appNombre: enOtra.third_party_name || '',
        empresaAjena: nombreEmpresa.get(enOtra.company_id) || 'otra empresa',
        diferencia: 0,
      });
      continue;
    }

    // ¿Y con la serie escrita distinta? Mismo RUC, mismo importe, misma fecha.
    // Sin esto, CHIFA MONTEORO salía como DOS errores (una que falta y una que
    // sobra) cuando en realidad es uno solo: la serie mal tipeada.
    // El rescate también tiene que saber de monedas: con un comprobante en
    // dólares el importe de SUNAT viene en soles y NUNCA pegaría contra el
    // índice, que guarda lo que dice la app. Se prueba el crudo y, si el
    // archivo trajo tipo de cambio, el equivalente en la moneda de origen.
    const rucF = rucLimpio(f.contraparteRuc);
    const tcFila = Number(f.tipoCambio) || 0;
    const candidatosRucImporte = porRucImporte.get(`${rucF}|${importeDe(f.total)}`)
      || (String(f.moneda || 'PEN').trim().toUpperCase() !== 'PEN' && tcFila > 1
        ? porRucImporte.get(`${rucF}|${importeDe(r2(f.total / tcFila))}`)
        : null)
      || [];
    const gemelo = candidatosRucImporte.find(x => !usados.has(x.id) && x.date === f.fecha);
    if (gemelo) {
      usados.add(gemelo.id);
      salida.push({
        ...base, estado: 'serie_distinta',
        movimientoId: gemelo.id,
        companyId: gemelo.company_id || companyId,
        appDocumento: gemelo.document_number,
        appFecha: gemelo.date,
        appTotal: r2(gemelo.amount),
        appNombre: gemelo.third_party_name || '',
        diferencia: 0,
      });
      continue;
    }

    // ¿O con serie distinta Y registrado en otro período? Mismo RUC, mismo importe, en otro mes.
    const gemeloOtroPeriodo = candidatosRucImporte.find(x => !usados.has(x.id));
    if (gemeloOtroPeriodo) {
      usados.add(gemeloOtroPeriodo.id);
      const perGemelo = mesDe(gemeloOtroPeriodo.date);
      salida.push({
        ...base,
        estado: 'otro_periodo',
        movimientoId: gemeloOtroPeriodo.id,
        companyId: gemeloOtroPeriodo.company_id || companyId,
        appDocumento: gemeloOtroPeriodo.document_number,
        appFecha: gemeloOtroPeriodo.date,
        appTotal: r2(gemeloOtroPeriodo.amount),
        appNombre: gemeloOtroPeriodo.third_party_name || '',
        periodoDetectado: perGemelo,
        motivoPeriodo: `Registrado en JARVEX en ${formatoPeriodoHumano(perGemelo)} (${gemeloOtroPeriodo.document_number})`,
        diferencia: 0,
      });
      continue;
    }

    // ¿El MISMO número de comprobante existe en JARVEX, pero con OTRO RUC?
    // No se puede saber sin mirar el papel si es un RUC mal cargado o dos
    // comprobantes reales que coinciden en número por casualidad, así que NO
    // ENTRA EN LA BRECHA: se MUESTRA el contraste para que la contadora
    // decida mirando el PDF. Sí se marca `usados` — no como si hubiera
    // cruzado de verdad, sino para no reportar la MISMA pareja dos veces (una
    // vez desde acá y otra desde el lado JARVEX más abajo).
    const candidatosRucDistinto = (porDocSinRuc.get(sinRuc(llave)) || []).filter(x => !usados.has(x.id));
    if (llave && candidatosRucDistinto.length) {
      const otro = candidatosRucDistinto[0];
      usados.add(otro.id);
      salida.push({
        ...base, estado: 'ruc_distinto',
        movimientoId: otro.id,
        companyId: otro.company_id || companyId,
        appDocumento: otro.document_number,
        appFecha: otro.date,
        appTotal: r2(otro.amount),
        appMoneda: String(otro.currency || 'PEN').trim().toUpperCase(),
        appNombre: otro.third_party_name || '',
        appRuc: rucLimpio(otro.third_party_ruc),
        diferencia: r2(f.total),
      });
      continue;
    }

    salida.push({ ...base, estado: 'solo_sunat', movimientoId: null, diferencia: r2(f.total) });
  }

  // Lo que la app tiene en el periodo y SUNAT no trajo.
  for (const m of propios) {
    if (usados.has(m.id)) continue;
    if (mes && mesDe(m.date) !== mes) continue;      // de otro mes: no es de este corte
    const p = partirDocumento(m.document_number);
    const k = llaveDeMovimiento(m);

    // ── DUPLICADO EN JARVEX ────────────────────────────────────────
    // Caso real (AUTOMANIA PERU, RUC 20570848985, FF01-11086, 13-set-2026):
    // la MISMA factura quedó cargada DOS VECES (dos movimientos vivos, misma
    // llave). SUNAT solo puede haberla usado para casar UNO — el resto no
    // «falta en SUNAT», SOBRA en JARVEX. Se mira `porLlave` completo (no
    // period-filtrado): dos cargas de la MISMA factura en meses distintos
    // también son un duplicado, no una casualidad de numeración.
    const hermanos = k ? (porLlave.get(k) || []) : [];
    if (hermanos.length > 1) {
      salida.push({
        llave: k, libro, companyId: m.company_id || companyId,
        linea: null, tipoCp: DOCUMENTO_A_TIPO_CP[m.document_type] || '01',
        tipoNombre: m.document_type || 'factura',
        documento: m.document_number || '',
        serie: p?.serie || '', numero: p?.correlativo || 0,
        fecha: m.date,
        contraparteRuc: rucLimpio(m.third_party_ruc),
        contraparteNombre: m.third_party_name || '',
        sunatBase: 0, sunatIgv: 0, sunatNoGravado: 0, sunatTotal: 0,
        moneda: m.currency || 'PEN', modifica: '',
        estado: 'duplicado_jarvex',
        duplicados: hermanos.length,
        duplicadosIds: hermanos.map(h => h.id),
        movimientoId: m.id,
        appDocumento: m.document_number,
        appFecha: m.date,
        appTotal: r2(m.amount),
        appNombre: m.third_party_name || '',
        // No es plata que falte ni que sobre: el papel está registrado, solo
        // que más de una vez — sumarlo a la brecha inflaría el faltante.
        diferencia: 0,
      });
      continue;
    }

    const enOtroSunat = k ? sunatOtrosPeriodosPorLlave.get(k) : null;
    if (enOtroSunat) {
      salida.push({
        llave: k,
        libro,
        companyId: m.company_id || companyId,
        linea: enOtroSunat.linea || null,
        tipoCp: DOCUMENTO_A_TIPO_CP[m.document_type] || '01',
        tipoNombre: m.document_type || 'factura',
        documento: enOtroSunat.documento || m.document_number || '',
        serie: p?.serie || '',
        numero: p?.correlativo || 0,
        fecha: m.date,
        contraparteRuc: rucLimpio(m.third_party_ruc),
        contraparteNombre: enOtroSunat.contraparteNombre || m.third_party_name || '',
        sunatBase: r2(enOtroSunat.base),
        sunatIgv: r2(enOtroSunat.igv),
        sunatNoGravado: r2(enOtroSunat.noGravado),
        sunatTotal: r2(enOtroSunat.total),
        moneda: m.currency || 'PEN',
        modifica: '',
        estado: 'sunat_otro_periodo',
        periodoDetectado: enOtroSunat.periodoCorte,
        motivoPeriodo: `SUNAT lo incluye en el período ${formatoPeriodoHumano(enOtroSunat.periodoCorte)}${enOtroSunat.archivoCorte ? ' (' + enOtroSunat.archivoCorte + ')' : ''}`,
        movimientoId: m.id,
        appDocumento: m.document_number,
        appFecha: m.date,
        appTotal: r2(m.amount),
        appNombre: m.third_party_name || '',
        diferencia: 0,
      });
      continue;
    }

    // ¿Existe en el archivo de SUNAT DE ESTE MISMO PERÍODO el mismo número de
    // comprobante, pero declarado con OTRO RUC? Mismo caso de PACÍFICO SEGUROS
    // visto del lado de JARVEX — ver el índice `sunatPorDocSinRuc` de arriba.
    const filaOtroRuc = k ? (sunatPorDocSinRuc.get(sinRuc(k)) || [])[0] : null;
    if (filaOtroRuc) {
      salida.push({
        llave: k, libro, companyId: m.company_id || companyId,
        linea: filaOtroRuc.linea, tipoCp: filaOtroRuc.tipoCp, tipoNombre: filaOtroRuc.tipoNombre,
        documento: filaOtroRuc.documento, serie: filaOtroRuc.serie, numero: filaOtroRuc.numero,
        fecha: filaOtroRuc.fecha,
        contraparteRuc: rucLimpio(filaOtroRuc.contraparteRuc),
        contraparteNombre: filaOtroRuc.contraparteNombre || '',
        sunatBase: r2(filaOtroRuc.base), sunatIgv: r2(filaOtroRuc.igv), sunatNoGravado: r2(filaOtroRuc.noGravado),
        sunatTotal: r2(filaOtroRuc.total), moneda: filaOtroRuc.moneda, modifica: '',
        estado: 'ruc_distinto',
        movimientoId: m.id,
        appDocumento: m.document_number,
        appFecha: m.date,
        appTotal: r2(m.amount),
        appMoneda: String(m.currency || 'PEN').trim().toUpperCase(),
        appNombre: m.third_party_name || '',
        appRuc: rucLimpio(m.third_party_ruc),
        diferencia: -r2(m.amount),
      });
      continue;
    }

    salida.push({
      llave: llaveDeMovimiento(m),
      libro,
      companyId: m.company_id || companyId,
      linea: null,
      tipoCp: DOCUMENTO_A_TIPO_CP[m.document_type] || '01',
      tipoNombre: m.document_type || 'factura',
      documento: m.document_number || '',
      serie: p?.serie || '',
      numero: p?.correlativo || 0,
      fecha: m.date,
      contraparteRuc: rucLimpio(m.third_party_ruc),
      contraparteNombre: m.third_party_name || '',
      sunatBase: 0, sunatIgv: 0, sunatNoGravado: 0, sunatTotal: 0,
      moneda: m.currency || 'PEN',
      modifica: '',
      estado: 'solo_jarvex',
      movimientoId: m.id,
      appDocumento: m.document_number,
      appFecha: m.date,
      appTotal: r2(m.amount),
      appNombre: m.third_party_name || '',
      diferencia: -r2(m.amount),
    });
  }

  return { filas: salida, resumen: resumirComparativa(salida) };
}

/** Los estados que la contadora tiene que mirar (todo lo que no cuadra). */
export const ESTADOS_PENDIENTES = [
  'solo_sunat', 'solo_jarvex', 'importe_distinto', 'signo_distinto',
  'serie_distinta', 'otra_empresa', 'otro_periodo', 'sunat_otro_periodo', 'fecha_distinta',
  'ruc_distinto', 'duplicado_jarvex',
];

export const ETIQUETA_ESTADO = {
  cuadra: 'Cuadra',
  solo_sunat: 'Falta en JARVEX',
  solo_jarvex: 'SUNAT no lo tiene',
  importe_distinto: 'Importe distinto',
  signo_distinto: 'Signo distinto',
  serie_distinta: 'Serie distinta',
  otra_empresa: 'Cargado en otra empresa',
  otro_periodo: 'Cargado en otro mes',
  sunat_otro_periodo: 'En SUNAT en otro mes',
  fecha_distinta: 'Fecha distinta',
  ruc_distinto: 'Mismo N°, RUC distinto',
  duplicado_jarvex: 'Duplicado en JARVEX',
};

/**
 * El resumen de un corte: cuántas de cada cosa y cuánta plata hay atrás.
 *
 * ⚠️ La plata de la brecha suma SOLO lo que falta o sobra (`solo_sunat` /
 * `solo_jarvex`) y la diferencia de las que no cuadran en importe. Una fila
 * «cargada en otra empresa» o «con la serie distinta» NO suma: el comprobante
 * existe, el problema es dónde o cómo está escrito, y sumarla inflaría la
 * brecha con plata que sí está registrada.
 */
export function resumirComparativa(filas = []) {
  const porEstado = {};
  for (const e of ['cuadra', ...ESTADOS_PENDIENTES]) porEstado[e] = 0;
  let sunatTotal = 0, appTotal = 0, brecha = 0, sunatIgv = 0, sunatBase = 0;
  let faltanEnApp = 0, faltanEnSunat = 0;

  for (const f of filas) {
    porEstado[f.estado] = (porEstado[f.estado] || 0) + 1;
    sunatTotal += f.sunatTotal || 0;
    appTotal += f.appTotal || 0;
    sunatIgv += f.sunatIgv || 0;
    sunatBase += f.sunatBase || 0;
    if (f.estado === 'solo_sunat') { brecha += f.sunatTotal || 0; faltanEnApp += 1; }
    else if (f.estado === 'solo_jarvex') { brecha -= f.appTotal || 0; faltanEnSunat += 1; }
    else if (f.estado === 'importe_distinto') brecha += f.diferencia || 0;
  }

  const total = filas.length;
  const pendientes = ESTADOS_PENDIENTES.reduce((a, e) => a + (porEstado[e] || 0), 0);
  return {
    total,
    cuadran: porEstado.cuadra || 0,
    pendientes,
    faltanEnApp,
    faltanEnSunat,
    porEstado,
    sunatBase: r2(sunatBase),
    sunatIgv: r2(sunatIgv),
    sunatTotal: r2(sunatTotal),
    appTotal: r2(appTotal),
    brecha: r2(brecha),
    // El % de comprobantes que cuadran, para poder ver si mejora mes a mes.
    pctCuadra: total ? Math.round(((porEstado.cuadra || 0) / total) * 100) : 0,
  };
}

/**
 * Aplica lo ya decidido en cortes anteriores: una diferencia marcada
 * «revisada» o «no aplica» deja de contar como pendiente.
 *
 * Se busca por LLAVE, no por id de fila: el mes que viene el CSV se vuelve a
 * bajar y las filas son otras, pero la comisión del banco que Gabriel marcó
 * «no aplica» es la misma. Sin esto, la pantalla repetiría todos los meses lo
 * que él ya contestó — el error que ya se pagó caro en la bandeja (mig 195).
 */
export function aplicarDecisiones(filas = [], decisiones = []) {
  const porLlave = new Map();
  for (const d of vivos(decisiones)) {
    if (!d.llave) continue;
    const previo = porLlave.get(d.llave);
    // Gana la más reciente: las dos PCs pueden haber decidido la misma.
    if (!previo || String(d.updated_at || '') > String(previo.updated_at || '')) {
      porLlave.set(d.llave, d);
    }
  }
  return filas.map(f => {
    const d = f.llave ? porLlave.get(f.llave) : null;
    if (!d) return f;
    return { ...f, decision: d.decision, decisionNota: d.nota || '', decisionId: d.id };
  });
}

/** Las que todavía hay que mirar: no cuadran y nadie las dio por vistas. */
export const filasPendientes = (filas = []) =>
  filas.filter(f => f.estado !== 'cuadra' && !f.decision);

/**
 * El corte listo para exportar a CSV. Se escribe con comillas SIEMPRE — al
 * revés que SUNAT, justamente porque un nombre con coma no puede volver a
 * romper el archivo del que sale.
 */
export function exportarComparativaCsv(filas = [], { periodo = '', empresa = '' } = {}) {
  const cols = [
    ['Empresa', () => empresa],
    ['Periodo', () => periodo],
    ['Libro', f => f.libro],
    ['Estado', f => ETIQUETA_ESTADO[f.estado] || f.estado],
    ['Tipo', f => f.tipoNombre],
    ['Comprobante SUNAT', f => f.documento],
    ['Comprobante JARVEX', f => f.appDocumento || ''],
    ['Fecha SUNAT', f => f.fecha || ''],
    ['Fecha JARVEX', f => f.appFecha || ''],
    ['RUC', f => f.contraparteRuc],
    ['Nombre en SUNAT', f => f.contraparteNombre],
    ['Nombre en JARVEX', f => f.appNombre || ''],
    ['Base', f => f.sunatBase],
    ['IGV', f => f.sunatIgv],
    ['Total SUNAT', f => f.sunatTotal],
    ['Total JARVEX', f => (f.appTotal ?? '')],
    ['Diferencia', f => f.diferencia],
    ['Periodo Detectado', f => f.periodoDetectado || ''],
    ['Detalle Periodo', f => f.motivoPeriodo || ''],
    ['Moneda', f => f.moneda],
    ['Decisión', f => f.decision || ''],
    ['Nota', f => f.decisionNota || ''],
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = [cols.map(c => esc(c[0])).join(',')];
  for (const f of filas) lineas.push(cols.map(c => esc(c[1](f))).join(','));
  return lineas.join('\n');
}
