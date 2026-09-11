// ═══════════════════════════════════════════════════════════════════
// JARVEX — LEER LOS CSV QUE BAJA GABRIEL DEL PORTAL DE SUNAT (tanda 14,
// entrega 5). Lib PURA: sin React, sin Dexie, sin File. Recibe texto, devuelve
// filas normalizadas. Testeada en __tests__/sunat-csv.test.js con los archivos
// REALES de JARVEX de julio-2026.
//
// ── LOS DOS ARCHIVOS ──────────────────────────────────────────────
// VENTAS  — export del RVIE. Nombre `LE20615646505202607...EXP2.csv`, 40
//           columnas. Una fila por comprobante emitido.
// COMPRAS — propuesta del RCE (SIRE). Nombre `20615646505-<fecha>-propuesta.csv`,
//           80 columnas (las últimas 39 son CLU1..CLU39, casi siempre vacías).
//           Es lo que SUNAT YA SABE que le facturaron a la empresa.
//
// Los dos traen el RUC del titular en la primera columna y el periodo en la
// tercera, así que el archivo dice solo de quién es y de qué mes: la pantalla
// no tiene que preguntarlo, lo verifica.
//
// ── 🔴 POR QUÉ ESTO NO ES `split(',')` ────────────────────────────
// LOS CSV DE SUNAT NO SON CSV VÁLIDOS. La razón social del titular va SIN
// comillas y a veces lleva coma, así que la fila trae un campo de más y TODAS
// las columnas de la derecha se corren una posición: el importe se lee como
// moneda, la fecha como serie, y el cruce sale entero pero mal, sin un solo
// error en consola. Es la peor clase de bug: silencioso y con plata adentro.
//
// Y no se puede «reparar contando columnas», porque SUNAT copia esa razón
// social TAL COMO LA ESCRIBIÓ CADA EMISOR. En la MISMA descarga de julio
// conviven:
//     JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.   → 81 campos
//     jarvex ingenieria tecnologia y proyectos e.i.r.l.    → 80 (minúsculas)
//     JARVEX INGENIERIA TECNOLOGIA Y PROYECTOS E.I.R.L.-   → 80 (con guion)
//     JARVEX INGENIERIA  TECNOLOGIA Y PROYECTOS E.I.R.L.   → 80 (doble espacio)
// Cinco de las 35 filas tenían el largo «bueno» y 30 el «malo». Un parser que
// asuma un largo fijo se rompe con el archivo del mes que viene.
//
// ── CÓMO SE REPARA: POR FORMA, NO POR LARGO ───────────────────────
// Se ancla en dos campos que tienen forma inconfundible y encierran a los dos
// campos de texto libre:
//   1. El PERIODO es el primer campo de exactamente 6 dígitos después del RUC.
//      Todo lo que quedó en el medio es la razón social del titular, por más
//      comas que tenga → se vuelve a pegar con comas y la fila se realinea.
//   2. La RAZÓN SOCIAL DE LA CONTRAPARTE va desde el «Nro Doc Identidad» hasta
//      el primer campo numérico (el primer importe). Mismo truco, misma razón.
// Después de esos dos pasos la fila está alineada con el encabezado y se lee
// por NOMBRE de columna, nunca por número.
//
// Si algún ancla no aparece, la fila NO se descarta en silencio: sale en
// `avisos` con su número de línea, para que la pantalla pueda decir «la línea
// 12 del archivo no se pudo leer» en vez de mostrar un total que falta.
// ═══════════════════════════════════════════════════════════════════

/** Tipos de comprobante de la tabla 10 de SUNAT, los que aparecen en el grupo. */
export const TIPO_CP = {
  '01': 'factura',
  '03': 'boleta',
  '07': 'nota_credito',
  '08': 'nota_debito',
  '12': 'ticket',
  '14': 'recibo_servicios',
  '00': 'otros',
};

/** El `document_type` que usa `accounting_movements` para cada tipo de SUNAT. */
export const TIPO_CP_A_DOCUMENTO = {
  '01': 'factura',
  '03': 'boleta',
  '07': 'nota_credito',
  '08': 'nota_debito',
};

export const nombreTipoCp = (t) => TIPO_CP[String(t || '').padStart(2, '0')] || 'otros';

// ── Partir una línea ──────────────────────────────────────────────
// Se respetan las comillas por si SUNAT algún día las escribe bien; hoy no las
// usa, y de ahí todo el trabajo de reparación de más abajo.
export function dividirLineaCsv(linea, separador = ',') {
  const out = [];
  let campo = '', dentro = false;
  const s = String(linea ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (dentro) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; }  // "" escapado
        else dentro = false;
      } else campo += c;
    } else if (c === '"') {
      dentro = true;
    } else if (c === separador) {
      out.push(campo); campo = '';
    } else campo += c;
  }
  out.push(campo);
  return out;
}

/**
 * Detecta el delimitador más probable de una serie de líneas CSV.
 * Compara ',', ';', '|', '\t'.
 */
export function detectarDelimitador(lineas = []) {
  const muestra = lineas.slice(0, 10).join('\n');
  const counts = {
    ',': (muestra.match(/,/g) || []).length,
    ';': (muestra.match(/;/g) || []).length,
    '|': (muestra.match(/\|/g) || []).length,
    '\t': (muestra.match(/\t/g) || []).length,
  };
  let mejor = ',';
  let max = counts[','];
  for (const sep of [';', '|', '\t']) {
    if (counts[sep] > max) {
      max = counts[sep];
      mejor = sep;
    }
  }
  return mejor;
}

const ES_NUMERO = /^-?\d+(\.\d+)?$/;
const ES_PERIODO = /^\d{6}(\d{2})?$/;

const limpio = (x) => String(x ?? '').trim();

/** Un importe de SUNAT ('1,970.85' nunca aparece: usa punto y sin miles). */
export function aNumero(x) {
  const s = limpio(x).replace(/\s/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * '06/07/2026' o '06-07-2026' → '2026-07-06'.
 * Por STRING, nunca con `new Date()`: 'YYYY-MM-DD' se parsea como medianoche
 * UTC y en Perú una factura del 01/07 se declaraba en JUNIO (la misma lección
 * que dejó `src/lib/fecha.js`). Devuelve '' si no tiene esa forma.
 */
export function aFechaIso(x) {
  const s = limpio(x);
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (!m) return '';
  const [, d, mes, a] = m;
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** '202607' o '20230700' → { anio: 2026, mes: 7 }. */
export function partirPeriodo(p) {
  const s = limpio(p);
  if (!ES_PERIODO.test(s)) return null;
  return { anio: Number(s.slice(0, 4)), mes: Number(s.slice(4, 6)) };
}

// ── Los dos layouts ───────────────────────────────────────────────
// Se declaran por NOMBRE de columna. `col()` los busca en el encabezado real
// del archivo tolerando mayúsculas, tildes y espacios de más (el encabezado de
// compras trae «Apellidos Nombres/ Razón  Social», con dos espacios).
const clave = (s) => limpio(s)
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/** Índice de una columna por nombre o lista de sinónimos, o -1. */
function col(headers, nombre) {
  const nombres = Array.isArray(nombre) ? nombre : [nombre];
  for (const n of nombres) {
    const k = clave(n);
    if (!k) continue;
    const idx = headers.findIndex(h => clave(h) === k);
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * ¿Este archivo es el de ventas o el de compras?
 * Se decide por una columna que solo existe en uno: compras desglosa la base
 * en tres destinos («BI Gravado DG» = destinado a operaciones gravadas) y
 * ventas no; ventas trae «Valor Facturado Exportación» y compras no.
 * Soporta sinónimos de 2023 a 2026.
 */
export function detectarLibro(headers = []) {
  const esCompras = col(headers, [
    'BI Gravado DG', 'BI Gravada DG', 'BI Grav DG',
    'Base Imponible DG', 'Adquisiciones Gravadas DG',
    'Valor Adq. NG', 'Valor Adq NG', 'Destino Ventas Gravadas',
  ]) >= 0;
  if (esCompras) return 'compras';

  const esVentas = col(headers, [
    'BI Gravada', 'Valor Facturado Exportación', 'Valor Facturado Exportacion',
    'Valor Facturado de la Exportación', 'Valor Facturado de la Exportacion',
    'Exportación', 'Exportacion', 'Total Valor Facturado de la Exportacion',
  ]) >= 0;
  if (esVentas) return 'ventas';

  return null;
}

/**
 * Realinea una fila desalineada por las comas sin comillas.
 *
 * @param campos    la fila cruda ya partida por el separador
 * @param iNombre   índice (en el ENCABEZADO) de la razón social de la contraparte
 * @param separador el delimitador usado (por defecto ',')
 * @returns { campos, titular, contraparte } o null si no se pudo anclar.
 */
export function repararFila(campos, iNombre, separador = ',') {
  if (!Array.isArray(campos) || campos.length < 3) return null;

  // ── Ancla 1: el periodo, primer campo de 6 u 8 dígitos después del RUC.
  let kPeriodo = -1;
  for (let i = 1; i < campos.length; i++) {
    if (ES_PERIODO.test(limpio(campos[i]))) { kPeriodo = i; break; }
  }
  if (kPeriodo < 2) return null;               // sin razón social en el medio no hay archivo válido
  const titular = campos.slice(1, kPeriodo).join(separador === ',' ? ',' : ' ').trim();
  // El titular ocupa 1 sola columna en el encabezado, esté partido en las que esté.
  let fila = [campos[0], titular, ...campos.slice(kPeriodo)];

  // ── Ancla 2: la razón social de la contraparte, hasta el primer importe.
  if (iNombre >= 0 && iNombre < fila.length) {
    let j = iNombre;
    while (j < fila.length && !ES_NUMERO.test(limpio(fila[j]))) j++;
    // `j` quedó en el primer numérico. Si el nombre ocupó más de una columna,
    // se vuelve a pegar. Si el nombre venía vacío, j === iNombre y no se toca.
    const contraparte = fila.slice(iNombre, j).join(separador === ',' ? ',' : ' ').trim();
    if (j > iNombre) fila = [...fila.slice(0, iNombre), contraparte, ...fila.slice(j)];
    return { campos: fila, titular, contraparte };
  }
  return { campos: fila, titular, contraparte: '' };
}

/**
 * Lee el CSV entero.
 * Soporta archivos con delimitador ',', ';', '|', '\t', filas de encabezado con preámbulo,
 * formatos de fecha y sinónimos de columnas desde 2023.
 *
 * @returns {{
 *   libro: 'ventas'|'compras'|null, ruc, razonSocial, periodo, anio, mes,
 *   filas: Array, avisos: Array<{linea:number, motivo:string, texto:string}>
 * }}
 */
export function parseCsvSunat(texto) {
  const vacio = { libro: null, ruc: '', razonSocial: '', periodo: '', anio: null, mes: null, filas: [], avisos: [] };
  const bruto = String(texto ?? '').replace(/^﻿/, '');   // BOM de SUNAT
  const lineas = bruto.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lineas.length < 1) return vacio;

  const candidatos = [',', ';', '|', '\t'];
  let headerIndex = -1;
  let sepElegido = ',';
  let libro = null;
  let headers = [];

  // Buscar el encabezado en las primeras 10 líneas probando cada delimitador
  for (let i = 0; i < Math.min(10, lineas.length); i++) {
    for (const sep of candidatos) {
      const h = dividirLineaCsv(lineas[i], sep).map(limpio);
      if (h.length >= 5) {
        const lib = detectarLibro(h);
        if (lib) {
          headerIndex = i;
          sepElegido = sep;
          libro = lib;
          headers = h;
          break;
        }
      }
    }
    if (libro) break;
  }

  // Si no se encontró por columnas específicas, detectar por delimitador más común en lineas[0]
  if (!libro) {
    sepElegido = detectarDelimitador(lineas);
    headers = dividirLineaCsv(lineas[0], sepElegido).map(limpio);
    libro = detectarLibro(headers);
    if (!libro) {
      return { ...vacio, avisos: [{ linea: 1, motivo: 'encabezado_desconocido', texto: lineas[0].slice(0, 200) }] };
    }
    headerIndex = 0;
  }

  const L = libro === 'compras' ? LAYOUT_COMPRAS : LAYOUT_VENTAS;
  const idx = {};
  for (const [campo, nombre] of Object.entries(L.columnas)) idx[campo] = col(headers, nombre);
  const iNombre = idx.contraparteNombre;

  const filas = [], avisos = [];
  let ruc = '', razonSocial = '', periodo = '';

  for (let n = headerIndex + 1; n < lineas.length; n++) {
    const crudos = dividirLineaCsv(lineas[n], sepElegido);
    const rep = repararFila(crudos, iNombre, sepElegido);
    if (!rep) {
      avisos.push({ linea: n + 1, motivo: 'no_se_pudo_alinear', texto: lineas[n].slice(0, 200) });
      continue;
    }
    const c = rep.campos;
    const v = (campo) => (idx[campo] >= 0 && idx[campo] < c.length ? limpio(c[idx[campo]]) : '');

    const serie = v('serie').toUpperCase();
    const numero = v('numero');
    if (!serie && !numero) {
      avisos.push({ linea: n + 1, motivo: 'sin_serie_ni_numero', texto: lineas[n].slice(0, 200) });
      continue;
    }

    if (!ruc) ruc = v('ruc');
    if (!razonSocial) razonSocial = rep.titular;
    if (!periodo) periodo = v('periodo');

    const tipoCp = v('tipoCp').padStart(2, '0');
    const base = L.base(v);
    const igv = L.igv(v);
    const noGravado = L.noGravado(v);
    const perFila = v('periodo').slice(0, 6) || (periodo ? periodo.slice(0, 6) : '');

    filas.push({
      libro,
      linea: n + 1,                       // para poder señalar el archivo
      periodo: perFila,
      carSunat: v('carSunat'),
      fecha: aFechaIso(v('fecha')),
      fechaVcto: aFechaIso(v('fechaVcto')),
      tipoCp,
      tipoNombre: nombreTipoCp(tipoCp),
      serie,
      numero: Number(numero) || 0,
      numeroTexto: numero,
      // La forma en que la app escribe un comprobante: 'F001-170359'.
      documento: serie && numero ? `${serie}-${Number(numero) || numero}` : '',
      contraparteTipoDoc: v('contraparteTipoDoc'),
      contraparteRuc: v('contraparteRuc'),
      contraparteNombre: rep.contraparte,
      base, igv, noGravado,
      otros: aNumero(v('otrosTributos')) + aNumero(v('isc')) + aNumero(v('icbper')),
      total: aNumero(v('total')),
      moneda: v('moneda') || 'PEN',
      tipoCambio: aNumero(v('tipoCambio')) || 1,
      // De qué comprobante es nota esta fila (solo en notas de crédito/débito).
      modificaTipo: v('modificaTipo'),
      modificaSerie: v('modificaSerie').toUpperCase(),
      modificaNumero: v('modificaNumero'),
      modificaFecha: aFechaIso(v('modificaFecha')),
      tipoNota: v('tipoNota'),
      // Estado del comprobante en la propuesta de SUNAT. '1' = incluido.
      estado: v('estado'),
      detraccion: aNumero(v('detraccion')),
    });
  }

  const p = partirPeriodo(periodo);
  const periodoLimpio = periodo ? periodo.slice(0, 6) : '';
  return {
    libro, ruc, razonSocial, periodo: periodoLimpio,
    anio: p?.anio ?? null, mes: p?.mes ?? null,
    filas, avisos,
  };
}

// ── Los layouts, uno por archivo ──────────────────────────────────
// Los nombres son TEXTUALES de los encabezados de SUNAT de setiembre-2026.
// Si SUNAT los cambia, `detectarLibro` devuelve null o `col()` da -1 y la
// pantalla lo dice; nunca se lee una columna equivocada por número.

const LAYOUT_VENTAS = {
  columnas: {
    ruc: ['Ruc', 'RUC', 'Num RUC', 'Numero RUC', 'RUC Emisor'],
    periodo: ['Periodo', 'Período', 'Periodo Tributario'],
    carSunat: ['CAR SUNAT', 'CAR-SUNAT', 'CarSunat', 'CAR CP', 'CAR'],
    fecha: ['Fecha de emisión', 'Fecha de emision', 'Fecha Emision', 'Fecha Emisión', 'Fec Emision', 'Fec. Emisión', 'Fecha'],
    fechaVcto: ['Fecha Vcto/Pago', 'Fecha Vencimiento', 'Fecha Vcto', 'Fecha Vcto / Pago', 'Fec Vcto', 'Fecha de Vcto'],
    tipoCp: ['Tipo CP/Doc.', 'Tipo CP/Doc', 'Tipo de Comprobante', 'Tipo CP', 'Tipo Comprobante', 'Tipo Doc', 'Tipo CDP'],
    serie: ['Serie del CDP', 'Serie del CP', 'Serie', 'Serie CP', 'Serie CDP'],
    numero: ['Nro CP o Doc. Nro Inicial (Rango)', 'Nro CP o Doc', 'Numero', 'Número', 'Nro Comprobante', 'Nro CP', 'Numero CP', 'Nro Inicial', 'Nro CDP'],
    contraparteTipoDoc: ['Tipo Doc Identidad', 'Tipo Doc Identidad Cliente', 'Tipo Doc Id', 'Tipo Doc', 'Tipo Doc. Identidad'],
    contraparteRuc: ['Nro Doc Identidad', 'Nro Doc Identidad Cliente', 'Num Doc Identidad', 'RUC Cliente', 'Doc Identidad', 'Numero Documento'],
    contraparteNombre: ['Apellidos Nombres/ Razón Social', 'Apellidos Nombres/ Razón  Social', 'Apellidos y Nombres / Razon Social', 'Apellidos y Nombres/ Razón Social', 'Razón Social', 'Razon Social', 'Nombre Cliente', 'Cliente'],
    biGravada: ['BI Gravada', 'BI Gravado', 'Base Imponible', 'Operaciones Gravadas', 'Monto Gravado', 'Valor Facturado Exportación', 'Valor Facturado Exportacion'],
    dsctoBi: ['Dscto BI', 'Descuento BI', 'Descuento Base Imponible', 'Dscto Base Imponible'],
    igvIpm: ['IGV / IPM', 'IGV/IPM', 'IGV', 'Monto IGV', 'IGV e IPM'],
    dsctoIgv: ['Dscto IGV / IPM', 'Dscto IGV', 'Descuento IGV', 'Dscto IGV/IPM'],
    exonerado: ['Mto Exonerado', 'Exonerado', 'Monto Exonerado', 'Operaciones Exoneradas'],
    inafecto: ['Mto Inafecto', 'Inafecto', 'Monto Inafecto', 'Operaciones Inafectas'],
    isc: ['ISC', 'Impuesto Selectivo al Consumo', 'Monto ISC'],
    icbper: ['ICBPER', 'Impuesto Bolsas', 'ICBP'],
    otrosTributos: ['Otros Tributos', 'Otros Trib/ Cargos', 'Otros Cargos', 'Otros Trib', 'Otros Tributos y Cargos'],
    total: ['Total CP', 'Importe Total', 'Total', 'Mto Total', 'Total Comprobante', 'Importe Total del CP'],
    moneda: ['Moneda', 'Cod Moneda', 'Código Moneda', 'Cod. Moneda'],
    tipoCambio: ['Tipo Cambio', 'Tipo de Cambio', 'TC', 'Tipo de Cambio Oficial'],
    modificaFecha: ['Fecha Emisión Doc Modificado', 'Fecha Emision Doc Modificado', 'Fecha Doc Modificado', 'Fecha Modificada'],
    modificaTipo: ['Tipo CP Modificado', 'Tipo Comprobante Modificado', 'Tipo Doc Modificado'],
    modificaSerie: ['Serie CP Modificado', 'Serie Modificada', 'Serie Doc Modificado'],
    modificaNumero: ['Nro CP Modificado', 'Numero CP Modificado', 'Nro Doc Modificado'],
    tipoNota: ['Tipo de Nota', 'Tipo Nota'],
    estado: ['Est. Comp', 'Est. Comp.', 'Estado Comprobante', 'Estado'],
    detraccion: ['Detracción', 'Detraccion', 'Mto Detracción', 'Monto Detraccion'],
  },
  // En ventas el descuento va en su propia columna y RESTA de la base.
  base: (v) => aNumero(v('biGravada')) - aNumero(v('dsctoBi')),
  igv: (v) => aNumero(v('igvIpm')) - aNumero(v('dsctoIgv')),
  noGravado: (v) => aNumero(v('exonerado')) + aNumero(v('inafecto')),
};

const LAYOUT_COMPRAS = {
  columnas: {
    ruc: ['RUC', 'Ruc', 'Num RUC', 'Numero RUC', 'RUC Adquiriente'],
    periodo: ['Periodo', 'Período', 'Periodo Tributario'],
    carSunat: ['CAR SUNAT', 'CAR-SUNAT', 'CarSunat', 'CAR CP', 'CAR'],
    fecha: ['Fecha de emisión', 'Fecha de emision', 'Fecha Emision', 'Fecha Emisión', 'Fec Emision', 'Fec. Emisión', 'Fecha'],
    fechaVcto: ['Fecha Vcto/Pago', 'Fecha Vencimiento', 'Fecha Vcto', 'Fecha Vcto / Pago', 'Fec Vcto', 'Fecha de Vcto'],
    tipoCp: ['Tipo CP/Doc.', 'Tipo CP/Doc', 'Tipo de Comprobante', 'Tipo CP', 'Tipo Comprobante', 'Tipo Doc', 'Tipo CDP'],
    serie: ['Serie del CDP', 'Serie del CP', 'Serie', 'Serie CP', 'Serie CDP'],
    numero: ['Nro CP o Doc. Nro Inicial (Rango)', 'Nro CP o Doc', 'Numero', 'Número', 'Nro Comprobante', 'Nro CP', 'Numero CP', 'Nro Inicial', 'Nro CDP'],
    contraparteTipoDoc: ['Tipo Doc Identidad', 'Tipo Doc Identidad Emisor', 'Tipo Doc Id', 'Tipo Doc', 'Tipo Doc. Identidad'],
    contraparteRuc: ['Nro Doc Identidad', 'Nro Doc Identidad Emisor', 'Num Doc Identidad', 'RUC Proveedor', 'Doc Identidad', 'Numero Documento'],
    contraparteNombre: ['Apellidos Nombres/ Razón  Social', 'Apellidos Nombres/ Razón Social', 'Apellidos y Nombres / Razon Social', 'Apellidos y Nombres/ Razón Social', 'Razón Social', 'Razon Social', 'Nombre Proveedor', 'Proveedor'],
    biDg: ['BI Gravado DG', 'BI Gravada DG', 'BI Grav DG', 'Base Imponible DG', 'Adquisiciones Gravadas DG', 'BI Operaciones Gravadas'],
    igvDg: ['IGV / IPM DG', 'IGV/IPM DG', 'IGV DG', 'Monto IGV DG', 'IGV e IPM DG'],
    biDgng: ['BI Gravado DGNG', 'BI Gravada DGNG', 'Base Imponible DGNG', 'Adquisiciones Gravadas DGNG'],
    igvDgng: ['IGV / IPM DGNG', 'IGV/IPM DGNG', 'IGV DGNG'],
    biDng: ['BI Gravado DNG', 'BI Gravada DNG', 'Base Imponible DNG', 'Adquisiciones Gravadas DNG'],
    igvDng: ['IGV / IPM DNG', 'IGV/IPM DNG', 'IGV DNG'],
    valorNg: ['Valor Adq. NG', 'Valor Adq NG', 'Valor Adquisiciones No Gravadas', 'No Gravadas', 'Mto No Gravado', 'Valor No Gravado'],
    isc: ['ISC', 'Impuesto Selectivo al Consumo', 'Monto ISC'],
    icbper: ['ICBPER', 'Impuesto Bolsas', 'ICBP'],
    otrosTributos: ['Otros Trib/ Cargos', 'Otros Tributos', 'Otros Cargos', 'Otros Trib', 'Otros Tributos y Cargos'],
    total: ['Total CP', 'Importe Total', 'Total', 'Mto Total', 'Total Comprobante', 'Importe Total del CP'],
    moneda: ['Moneda', 'Cod Moneda', 'Código Moneda', 'Cod. Moneda'],
    tipoCambio: ['Tipo de Cambio', 'Tipo Cambio', 'TC', 'Tipo de Cambio Oficial'],
    modificaFecha: ['Fecha Emisión Doc Modificado', 'Fecha Emision Doc Modificado', 'Fecha Doc Modificado', 'Fecha Modificada'],
    modificaTipo: ['Tipo CP Modificado', 'Tipo Comprobante Modificado', 'Tipo Doc Modificado'],
    modificaSerie: ['Serie CP Modificado', 'Serie Modificada', 'Serie Doc Modificado'],
    modificaNumero: ['Nro CP Modificado', 'Numero CP Modificado', 'Nro Doc Modificado'],
    tipoNota: ['Tipo de Nota', 'Tipo Nota'],
    estado: ['Est. Comp.', 'Est. Comp', 'Estado Comprobante', 'Estado'],
    detraccion: ['Detracción', 'Detraccion', 'Mto Detracción', 'Monto Detraccion'],
  },
  // 🔴 La base de una compra viene partida en TRES según a qué se destina
  // (gravadas / gravadas y no gravadas / no gravadas). Leer solo «DG» perdería
  // las compras de destino mixto y el total no cerraría contra la propia fila.
  base: (v) => aNumero(v('biDg')) + aNumero(v('biDgng')) + aNumero(v('biDng')),
  igv: (v) => aNumero(v('igvDg')) + aNumero(v('igvDgng')) + aNumero(v('igvDng')),
  // Lo no gravado —las comisiones del banco de julio salen justo por acá—.
  noGravado: (v) => aNumero(v('valorNg')),
};

// ═══════════════════════════════════════════════════════════════════
// LO QUE SE GUARDA DEL ARCHIVO (mig 202, tanda 18 entrega B)
//
// Hasta la mig 202 el CSV se leía, se cruzaba y se tiraba: al cambiar de
// pestaña quedaba el resumen y ninguna lista. Ahora las filas viajan con el
// corte, pero PODADAS — un corte se guarda una vez y se lee muchas, y cada
// campo guardado es un campo que promete estar bien.
// ═══════════════════════════════════════════════════════════════════

/**
 * Los campos de una fila que sobreviven al guardado. Son EXACTAMENTE los que
 * `compararLibro()` y la tabla de la pantalla leen; ni uno más.
 *
 * Lo que se tira, y por qué:
 *   · `libro` y `periodo` — ya están en el corte, y repetidos por fila podrían
 *     contradecirlo.
 *   · `numeroTexto` — `numero` ya es el número; el texto solo servía para leer.
 *   · `carSunat`, `fechaVcto`, `contraparteTipoDoc`, `otros` — nadie los mira.
 *   · `modificaTipo`, `modificaFecha`, `tipoNota` — de la nota se muestra QUÉ
 *     comprobante modifica (serie y número); el resto no se usa.
 * Lo que se queda aunque hoy nadie lo lea: `detraccion`, `estado` y
 * `tipoCambio`. Son tres escalares que SOLO trae el archivo — si se tiran, la
 * única forma de recuperarlos es volver a bajar el CSV de SUNAT, que es
 * justamente el error que se corrige acá.
 */
export const CAMPOS_FILA_GUARDADA = [
  'linea', 'fecha', 'tipoCp', 'tipoNombre', 'serie', 'numero', 'documento',
  'contraparteRuc', 'contraparteNombre',
  'base', 'igv', 'noGravado', 'total', 'moneda', 'tipoCambio',
  'modificaSerie', 'modificaNumero',
  'estado', 'detraccion',
];

/** Una fila lista para guardar: solo los campos de `CAMPOS_FILA_GUARDADA`. */
export function filaGuardable(fila) {
  const out = {};
  for (const k of CAMPOS_FILA_GUARDADA) {
    const v = fila?.[k];
    if (v === undefined || v === null || v === '') continue;   // no guardar vacíos
    out[k] = v;
  }
  return out;
}

/** Las filas de un corte, listas para guardar. */
export const filasGuardables = (filas = []) =>
  (Array.isArray(filas) ? filas : []).map(filaGuardable);

/**
 * Los avisos que se guardan con el corte, con tope.
 *
 * Un archivo sano trae cero; uno que SUNAT cambió de formato puede traer una
 * por línea, y guardar 3.000 textos para decir «este archivo no se pudo leer»
 * no ayuda a nadie. Con 50 alcanza para ir a mirar el archivo, y la CUENTA
 * completa vive aparte, en la columna `avisos`.
 */
export function avisosGuardables(avisos = [], maximo = 50) {
  return (Array.isArray(avisos) ? avisos : []).slice(0, maximo).map(a => ({
    linea: a?.linea ?? null,
    motivo: a?.motivo || '',
    texto: String(a?.texto || '').slice(0, 200),
  }));
}

/**
 * Lee un `File` del navegador y devuelve el texto, resolviendo el encoding.
 *
 * SUNAT manda UTF-8 con BOM, pero según por dónde se baje puede venir en
 * Windows-1252 (y ahí «BANCO INTERNACIONAL DEL PERÚ» llega roto). Se decodifica
 * como UTF-8 y, si aparece el carácter de reemplazo, se reintenta en 1252.
 * No es pura (toca File), por eso va aparte de todo lo de arriba.
 */
export async function leerArchivoSunat(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  try { return new TextDecoder('windows-1252').decode(buf); }
  catch { return utf8; }
}
