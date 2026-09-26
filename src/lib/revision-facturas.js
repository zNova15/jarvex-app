// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL ESCÁNER DE INCOHERENCIAS DE FACTURAS (tanda 7).
//
// Gabriel, 6-sep-2026:
//   «Me gustaría que sea una habilidad también: una pasada completa de revisión
//    de las facturas, así como estás haciendo ahorita y me estás diciendo qué
//    incoherencias has encontrado, pero ya dentro de la aplicación. Sería una
//    herramienta ideal para escanear y ver qué facturas tienen incoherencias
//    para que no tengamos problemas con la SUNAT.»
//
// ── LA LECCIÓN QUE ORDENA ESTE ARCHIVO ─────────────────────────────
// Mi primera pasada a mano produjo FALSOS POSITIVOS. Reporté como error que el
// código 019 apareciera con 10% y con 4%, y era correcto: la contadora explicó
// que el alquiler baja a 4% cuando el cliente es la ejecutora de una obra de
// construcción. Una regla que grita cuando no debe se vuelve ruido, y a la
// tercera vez nadie vuelve a abrir la pantalla.
//
// Por eso hay DOS niveles y solo uno puede decir "esto está mal":
//
//   · CONTRADICCION → la fila se desmiente a sí misma. Aritmética o una lista
//     cerrada. No hace falta criterio contable para saber que está mal.
//   · REVISAR → puede estar perfectamente bien. Decide la contadora.
//
// ── LO QUE SE MIDIÓ ANTES DE ESCRIBIR NINGUNA REGLA ────────────────
// Cada regla se corrió contra los 1.402 comprobantes vivos de producción, y
// DOS se cayeron en esa prueba:
//
//   ✗ «IGV ≠ 18% del subtotal» daba 147 casos, pero 143 son facturas y 76
//     tienen IGV 0 — pueden ser exoneradas legítimas. Bajó a REVISAR.
//   ✗ «subtotal + IGV ≠ total» daba 49 casos y TODOS eran notas de crédito:
//     el total se guarda negativo y el subtotal positivo. La regla estaba mal,
//     no los datos. Comparando contra |total| quedan 33 casos reales, ninguno
//     nota de crédito, todos con aritmética imposible (uno tiene subtotal 65
//     sobre un total de 55).
//
// Puro: sin React, sin Dexie. Las reglas de la detracción (umbral, tasa,
// moneda) vienen de `detraccion.js`, que es la única fuente desde el 25-set.
// ═══════════════════════════════════════════════════════════════════

import {
  UMBRAL_DETRACCION, montoDetraccion, totalEnSoles, propuestaDetraccion,
} from './detraccion.js';
import { tasaCorrespondeAlCodigo, buscarCodigoSpot } from './codigos-spot.js';
import { notasPorFactura } from './notas-credito.js';

export const NIVEL = { CONTRADICCION: 'contradiccion', REVISAR: 'revisar' };

/** Umbral SPOT — se re-exporta: vive en `detraccion.js`. */
export { UMBRAL_DETRACCION };

/**
 * El tipo de cambio del comprobante: el suyo, o el de su fecha (`tasaDe`).
 * La detracción se deposita en soles aunque la factura esté en dólares.
 */
const tcDe = (m, tasaDe) => {
  if (String(m?.currency || 'PEN').toUpperCase() === 'PEN') return 1;
  if (Number(m?.tipo_cambio) > 0) return Number(m.tipo_cambio);
  const t = typeof tasaDe === 'function' ? Number(tasaDe(m)) : 0;
  return t > 0 ? t : null;
};

/** Tolerancia en soles. Absorbe el redondeo de la captura, no un error real. */
const TOL = 1;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const abs = Math.abs;

function notas(mov) {
  const n = mov?.notas;
  if (n && typeof n === 'object') return n;
  try { const j = JSON.parse(n || '{}'); return (j && typeof j === 'object') ? j : {}; }
  catch { return {}; }
}

/** Un recibo por honorarios no lleva IGV: no es un error que sea 0. */
function esReciboHonorarios(mov) {
  return mov?.document_type === 'recibo_honorarios'
    || mov?.document_type === 'recibo'
    || /honorario/i.test(mov?.category || '');
}

const esNota = (mov) => /^nota_/.test(mov?.document_type || '');

// ── LAS REGLAS ─────────────────────────────────────────────────────
// Cada una recibe el movimiento y devuelve null (todo bien) o el detalle.
// `id` es estable: es la llave con la que se descarta un hallazgo para siempre.

export const REGLAS = [
  {
    id: 'detraccion-monto-no-cuadra',
    nivel: NIVEL.CONTRADICCION,
    titulo: 'El monto de la detracción no cuadra con su propio porcentaje',
    evaluar(m, { tasaDe } = {}) {
      if (!m.detraccion_aplica || esNota(m)) return null;
      const pct = num(m.detraccion_pct), monto = num(m.detraccion_monto), total = num(m.amount);
      if (pct == null || monto == null || total == null) return null;
      // El monto se deposita en SOLES: en un comprobante en dólares se compara
      // contra el total convertido al tipo de cambio de su fecha (25-set). Antes
      // la E001-11 de US$ 432 con S/ 173,75 bien cargados salía como error.
      const moneda = String(m.currency || 'PEN').toUpperCase();
      const esperado = montoDetraccion({ total, moneda, tipoCambio: tcDe(m, tasaDe), pct });
      if (esperado == null) return null;                 // sin tasa no se puede juzgar
      if (abs(monto - esperado) <= TOL) return null;
      const base = moneda === 'PEN' ? abs(total).toFixed(2) : `S/ ${totalEnSoles({ total, moneda, tipoCambio: tcDe(m, tasaDe) }).toFixed(2)} (${moneda} ${abs(total).toFixed(2)})`;
      return {
        detalle: `Dice ${pct}% de ${base}, que son S/ ${esperado.toFixed(2)}, pero tiene cargado S/ ${monto.toFixed(2)}.`,
        sugerencia: `Si el porcentaje es el correcto, el monto debería ser S/ ${esperado.toFixed(2)}.`,
      };
    },
  },
  {
    id: 'detraccion-codigo-invalido',
    nivel: NIVEL.CONTRADICCION,
    titulo: 'El código de detracción no existe',
    evaluar(m) {
      const cod = String(m.detraccion_codigo || '').trim();
      if (!cod) return null;
      if (/^[0-9]{3}$/.test(cod)) return null;
      return {
        detalle: `El código cargado es «${cod}». Los del Anexo 3 son de tres dígitos (por ejemplo 019, 027, 037).`,
        sugerencia: 'Corregilo con el código que corresponde al servicio.',
      };
    },
  },
  {
    id: 'detraccion-bajo-umbral',
    nivel: NIVEL.CONTRADICCION,
    titulo: 'Detracción cargada en una operación que no está sujeta',
    evaluar(m, { tasaDe } = {}) {
      if (!m.detraccion_aplica) return null;
      // El umbral es en soles: un comprobante en dólares se mide convertido.
      const total = totalEnSoles({ total: num(m.amount) ?? 0, moneda: m.currency, tipoCambio: tcDe(m, tasaDe) });
      if (total == null || total > UMBRAL_DETRACCION) return null;
      return {
        detalle: `La operación es de S/ ${total.toFixed(2)} y las de S/ ${UMBRAL_DETRACCION} o menos no están sujetas a detracción.`,
        sugerencia: 'Lo normal es quitar la detracción de este comprobante.',
      };
    },
  },
  {
    id: 'detraccion-sin-codigo',
    nivel: NIVEL.CONTRADICCION,
    titulo: 'Tiene detracción calculada pero le falta el código',
    evaluar(m) {
      if (!m.detraccion_aplica) return null;
      if (String(m.detraccion_codigo || '').trim()) return null;
      const pct = num(m.detraccion_pct), monto = num(m.detraccion_monto);
      if (pct == null && monto == null) return null;
      return {
        detalle: 'Tiene porcentaje y monto, pero no dice a qué código del Anexo 3 corresponde.',
        sugerencia: 'Sin el código no se puede sustentar la tasa aplicada.',
      };
    },
  },
  {
    id: 'totales-no-cuadran',
    nivel: NIVEL.CONTRADICCION,
    titulo: 'El subtotal más el IGV no da el total del comprobante',
    evaluar(m) {
      const j = notas(m);
      const sub = num(j.subtotal), igv = num(j.igv), total = num(m.amount);
      if (sub == null || igv == null || total == null) return null;
      // |total|: una nota de crédito guarda el total en negativo y el subtotal
      // en positivo. Comparar sin abs() marcaba las 49 notas como error.
      const dif = abs(total) - (sub + igv);
      if (abs(dif) <= TOL) return null;
      return {
        detalle: `Subtotal ${sub.toFixed(2)} + IGV ${igv.toFixed(2)} = ${(sub + igv).toFixed(2)}, pero el total dice ${abs(total).toFixed(2)}. Faltan ${abs(dif).toFixed(2)}.`,
        sugerencia: 'Casi siempre es un error de lectura del comprobante. Compará con el PDF.',
      };
    },
  },
  {
    id: 'fecha-futura',
    nivel: NIVEL.CONTRADICCION,
    titulo: 'La fecha del comprobante es posterior a hoy',
    evaluar(m, { hoy } = {}) {
      if (!m.date || !hoy) return null;
      if (String(m.date) <= String(hoy)) return null;
      return {
        detalle: `El comprobante está fechado el ${m.date} y hoy es ${hoy}.`,
        sugerencia: 'Revisá la fecha: un comprobante no puede emitirse en el futuro.',
      };
    },
  },
  // ── NIVEL 2: puede estar bien, decide la contadora ────────────────
  {
    // Gabriel, 25-set-2026: «recalcular con marca de revisión». Eran 21 con la
    // detracción marcada y sin monto (Captura Mágica no lo exige) y el escáner
    // callaba cuando el monto era NULL. Ahora la app PROPONE el importe con la
    // regla de la casa y esto queda a la vista hasta que alguien lo cargue o lo
    // marque revisado. Una factura anulada por su nota no deposita nada.
    id: 'detraccion-sin-monto',
    nivel: NIVEL.REVISAR,
    titulo: 'Tiene detracción pero le falta el monto',
    evaluar(m, { tasaDe, anuladas } = {}) {
      if (!m.detraccion_aplica || esNota(m)) return null;
      if (anuladas?.get?.(m.id)?.anulada) return null;
      const monto = num(m.detraccion_monto);
      if (monto != null && monto > 0) return null;
      const total = totalEnSoles({ total: num(m.amount) ?? 0, moneda: m.currency, tipoCambio: tcDe(m, tasaDe) });
      if (total != null && total <= UMBRAL_DETRACCION) return null;   // eso lo dice «bajo umbral»
      const p = propuestaDetraccion(m, { tipoCambio: tcDe(m, tasaDe) });
      if (!p) {
        return {
          detalle: 'Está marcada con detracción pero no tiene monto, ni porcentaje, ni un código o un texto del que deducirlo.',
          sugerencia: 'Cargá el porcentaje (4 % obra, 12 % consultoría) o el código, y el monto sale solo.',
        };
      }
      if (p.monto == null) {
        return {
          detalle: `Correspondería el ${p.pct}% (${p.porque}), pero el comprobante está en ${m.currency} y no hay tipo de cambio para su fecha.`,
          sugerencia: 'Cargá la tasa del día de emisión: la detracción se deposita en soles.',
        };
      }
      return {
        detalle: `Propuesta: S/ ${p.monto.toFixed(2)} — el ${p.pct}%${p.codigo ? ` (código ${p.codigo})` : ''}, porque ${p.porque}.`,
        sugerencia: 'Confirmalo contra la constancia o el PDF y cargalo en el comprobante.',
        propuesta: p,
      };
    },
  },
  {
    // 25-set-2026: el catálogo SPOT de la app tenía la construcción en el 037
    // (es el 030). Queda al menos un comprobante con 037 al 4 %. Esto avisa
    // cualquier código cuya tasa oficial no es la cargada.
    id: 'detraccion-codigo-tasa',
    nivel: NIVEL.REVISAR,
    titulo: 'El código de detracción no corresponde a la tasa cargada',
    evaluar(m) {
      if (!m.detraccion_aplica) return null;
      const cod = String(m.detraccion_codigo || '').trim();
      const pct = num(m.detraccion_pct);
      if (!cod || pct == null) return null;
      if (tasaCorrespondeAlCodigo(cod, pct) !== false) return null;
      const c = buscarCodigoSpot(cod);
      return {
        detalle: `El código ${c.codigo} es «${c.nombre}», al ${c.tasa}%, y el comprobante tiene ${pct}%.`,
        sugerencia: (c.codigo === '037' && pct === 4)
          ? 'Si es un contrato de construcción, el código es el 030 (4 %). El 037 son los demás servicios, al 12 %.'
          : 'Revisá cuál de los dos está mal: el código o el porcentaje.',
      };
    },
  },
  {
    id: 'igv-no-es-18',
    nivel: NIVEL.REVISAR,
    titulo: 'El IGV no es el 18% del subtotal',
    evaluar(m) {
      // Un recibo por honorarios NO lleva IGV, y una nota hereda el del
      // comprobante que corrige: marcarlos sería ruido garantizado.
      if (esReciboHonorarios(m) || esNota(m)) return null;
      const j = notas(m);
      const sub = num(j.subtotal), igv = num(j.igv);
      if (sub == null || igv == null || sub <= 0) return null;
      const esperado = Math.round(sub * 18) / 100;
      if (abs(igv - esperado) <= TOL) return null;
      const pct = (igv / sub) * 100;
      return {
        detalle: igv === 0
          ? `El subtotal es ${sub.toFixed(2)} y el IGV está en cero.`
          : `El IGV es ${igv.toFixed(2)}, el ${pct.toFixed(1)}% del subtotal, no el 18%.`,
        sugerencia: 'Puede ser correcto si la operación está exonerada o inafecta. Si no, hay que corregirlo.',
      };
    },
  },
  {
    id: 'items-no-suman-subtotal',
    nivel: NIVEL.REVISAR,
    titulo: 'Los ítems no suman el subtotal del comprobante',
    evaluar(m) {
      const j = notas(m);
      const items = Array.isArray(j.items_factura) ? j.items_factura : [];
      if (!items.length) return null;
      const sub = num(j.subtotal);
      if (sub == null) return null;
      let suma = 0;
      for (const it of items) {
        const c = num(it?.cantidad), p = num(it?.precio_unitario);
        if (c == null || p == null) return null;   // sin datos completos no opinamos
        suma += c * p;
      }
      suma = Math.round(suma * 100) / 100;
      if (abs(suma - sub) <= TOL) return null;
      return {
        detalle: `Los ${items.length} ítems suman ${suma.toFixed(2)} y el subtotal dice ${sub.toFixed(2)}.`,
        sugerencia: 'Puede ser correcto si el comprobante trae un descuento o un concepto sin detallar.',
      };
    },
  },
];

/**
 * Revisa UN comprobante. Devuelve los hallazgos, sin los descartados.
 *
 * @param mov        fila de accounting_movements
 * @param opts.hoy   fecha local 'YYYY-MM-DD' (window.__fecha.hoyLocal())
 * @param opts.descartados Set de `${mov.id}::${regla.id}` ya marcados como revisados
 */
export function revisarMovimiento(mov, { hoy = null, descartados = null, tasaDe = null, anuladas = null } = {}) {
  if (!mov || mov.deleted_at) return [];
  const fuera = descartados instanceof Set ? descartados : new Set();
  const out = [];
  for (const r of REGLAS) {
    if (fuera.has(claveDescarte(mov.id, r.id))) continue;
    let res = null;
    try { res = r.evaluar(mov, { hoy, tasaDe, anuladas }); } catch { res = null; }
    if (!res) continue;
    out.push({
      movimiento_id: mov.id,
      regla: r.id,
      nivel: r.nivel,
      titulo: r.titulo,
      detalle: res.detalle,
      sugerencia: res.sugerencia || null,
      propuesta: res.propuesta || null,
    });
  }
  return out;
}

/** La llave con la que se recuerda un descarte. Estable en el tiempo. */
export function claveDescarte(movimientoId, reglaId) {
  return `${movimientoId}::${reglaId}`;
}

/**
 * Revisa una lista completa y la ordena: primero las contradicciones, y dentro
 * de cada nivel lo más caro arriba — es donde el error cuesta más.
 */
export function revisarLote(movs, opts = {}) {
  const out = [];
  const porId = new Map();
  // Qué facturas anuló entera su nota de crédito: esas quedan vivas (Gabriel,
  // 25-set-2026) pero no se les reclama la detracción que nunca se deposita.
  const anuladas = opts.anuladas || notasPorFactura(movs || []);
  for (const m of movs || []) {
    if (!m || m.deleted_at) continue;
    porId.set(m.id, m);
    out.push(...revisarMovimiento(m, { ...opts, anuladas }));
  }
  const peso = (h) => (h.nivel === NIVEL.CONTRADICCION ? 0 : 1);
  out.sort((a, b) => {
    if (peso(a) !== peso(b)) return peso(a) - peso(b);
    const ma = abs(Number(porId.get(a.movimiento_id)?.amount) || 0);
    const mb = abs(Number(porId.get(b.movimiento_id)?.amount) || 0);
    return mb - ma;
  });
  return out;
}

/** Cuántos hay de cada nivel y de cada regla, para la cabecera de la pantalla. */
export function resumenRevision(hallazgos) {
  const r = { total: 0, contradicciones: 0, revisar: 0, porRegla: {} };
  for (const h of hallazgos || []) {
    r.total++;
    if (h.nivel === NIVEL.CONTRADICCION) r.contradicciones++; else r.revisar++;
    r.porRegla[h.regla] = (r.porRegla[h.regla] || 0) + 1;
  }
  return r;
}
