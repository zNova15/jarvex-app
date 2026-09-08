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
 * Cruza un libro de SUNAT contra los movimientos de la app.
 *
 * @param filas  las filas ya parseadas por `parseCsvSunat`
 * @param movs   TODOS los movimientos vivos (no solo los del mes: hace falta
 *               ver los de otros periodos y otras empresas para poder decir
 *               «está, pero en otro lado» en vez de «falta»)
 * @param opts   { companyId, libro, periodo, companies }
 * @returns { filas: Array<diferencia>, resumen }
 */
export function compararLibro(filas = [], movs = [], { companyId, libro, periodo, companies = [] } = {}) {
  const mes = mesDePeriodo(periodo);
  const nombreEmpresa = new Map(vivos(companies).map(c => [c.id, c.name]));

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

  // Para el rescate de la serie mal escrita: RUC + importe + fecha.
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
      const dif = r2(importeDe(f.total) - importeDe(m.amount));
      const signoDistinto = Math.sign(r2(f.total)) !== 0
        && Math.sign(r2(m.amount)) !== 0
        && Math.sign(r2(f.total)) !== Math.sign(r2(m.amount));
      let estado = 'cuadra';
      if (Math.abs(dif) > TOLERANCIA) estado = 'importe_distinto';
      else if (signoDistinto) estado = 'signo_distinto';
      else if (mes && mesDe(m.date) !== mes) estado = 'otro_periodo';
      else if (f.fecha && m.date !== f.fecha) estado = 'fecha_distinta';
      salida.push({
        ...base, estado,
        movimientoId: m.id,
        appDocumento: m.document_number,
        appFecha: m.date,
        appTotal: r2(m.amount),
        appNombre: m.third_party_name || '',
        diferencia: dif,
      });
      continue;
    }

    // No cruzó por llave. ¿Está cargado en OTRA empresa del grupo?
    const enOtra = llave ? ajenos.get(llave) : null;
    if (enOtra) {
      salida.push({
        ...base, estado: 'otra_empresa',
        movimientoId: enOtra.id,
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
    const gemelo = (porRucImporte.get(`${rucLimpio(f.contraparteRuc)}|${importeDe(f.total)}`) || [])
      .find(x => !usados.has(x.id) && x.date === f.fecha);
    if (gemelo) {
      usados.add(gemelo.id);
      salida.push({
        ...base, estado: 'serie_distinta',
        movimientoId: gemelo.id,
        appDocumento: gemelo.document_number,
        appFecha: gemelo.date,
        appTotal: r2(gemelo.amount),
        appNombre: gemelo.third_party_name || '',
        diferencia: 0,
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
    salida.push({
      llave: llaveDeMovimiento(m),
      libro,
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
  'serie_distinta', 'otra_empresa', 'otro_periodo', 'fecha_distinta',
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
  fecha_distinta: 'Fecha distinta',
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
    ['Moneda', f => f.moneda],
    ['Decisión', f => f.decision || ''],
    ['Nota', f => f.decisionNota || ''],
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = [cols.map(c => esc(c[0])).join(',')];
  for (const f of filas) lineas.push(cols.map(c => esc(c[1](f))).join(','));
  return lineas.join('\n');
}
