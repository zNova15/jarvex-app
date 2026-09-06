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
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

export const NIVEL = { CONTRADICCION: 'contradiccion', REVISAR: 'revisar' };

/** Umbral SPOT: una operación de S/ 700 o menos no está sujeta a detracción. */
export const UMBRAL_DETRACCION = 700;

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
    evaluar(m) {
      if (!m.detraccion_aplica) return null;
      const pct = num(m.detraccion_pct), monto = num(m.detraccion_monto), total = num(m.amount);
      if (pct == null || monto == null || total == null) return null;
      const esperado = Math.round(abs(total) * pct) / 100;
      if (abs(monto - esperado) <= TOL) return null;
      return {
        detalle: `Dice ${pct}% de ${abs(total).toFixed(2)}, que son ${esperado.toFixed(2)}, pero tiene cargado ${monto.toFixed(2)}.`,
        sugerencia: `Si el porcentaje es el correcto, el monto debería ser ${esperado.toFixed(2)}.`,
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
    evaluar(m) {
      if (!m.detraccion_aplica) return null;
      if ((m.currency || 'PEN') !== 'PEN') return null;   // el umbral es en soles
      const total = abs(num(m.amount) ?? 0);
      if (total > UMBRAL_DETRACCION) return null;
      return {
        detalle: `La operación es de ${total.toFixed(2)} y las de S/ ${UMBRAL_DETRACCION} o menos no están sujetas a detracción.`,
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
export function revisarMovimiento(mov, { hoy = null, descartados = null } = {}) {
  if (!mov || mov.deleted_at) return [];
  const fuera = descartados instanceof Set ? descartados : new Set();
  const out = [];
  for (const r of REGLAS) {
    if (fuera.has(claveDescarte(mov.id, r.id))) continue;
    let res = null;
    try { res = r.evaluar(mov, { hoy }); } catch { res = null; }
    if (!res) continue;
    out.push({
      movimiento_id: mov.id,
      regla: r.id,
      nivel: r.nivel,
      titulo: r.titulo,
      detalle: res.detalle,
      sugerencia: res.sugerencia || null,
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
  for (const m of movs || []) {
    if (!m || m.deleted_at) continue;
    porId.set(m.id, m);
    out.push(...revisarMovimiento(m, opts));
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
