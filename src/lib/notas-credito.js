// ═══════════════════════════════════════════════════════════════════
// JARVEX — Notas de crédito: qué factura tocan y si la dejan anulada.
//
// Pedido de Gabriel (7-sep-2026): «cuando se vincule la nota de crédito me
// gustaría que sobre la factura que anula salga un cuadrito que me permita
// diferenciar que dicha factura está anulada por la nota de crédito X», y
// «cuando esta nota de crédito sirve para anular una factura completa no hace
// falta ir a revisar estos datos o editarlos».
//
// El vínculo ya existía en el dato (`related_movement_id` de la nota apunta a
// la factura) pero solo se veía DENTRO de la nota. Desde la factura no había
// forma de saber que estaba anulada: seguía figurando como una factura normal.
//
// ── Cuidado con `related_movement_id` ──────────────────────────────────
// Ese campo se usa para DOS cosas: el vínculo nota→factura y el espejo
// intercompany (una NC de venta apunta a la NC de compra de la otra empresa
// del grupo). Por eso acá solo se toma el vínculo cuando el destino NO es a su
// vez una nota — si no, una NC espejo "anularía" a otra NC.
// ═══════════════════════════════════════════════════════════════════

const TIPOS_NOTA = new Set(['nota_credito', 'nota_debito']);

/** ¿Este movimiento es una nota de crédito o débito? */
export const esNota = (m) => TIPOS_NOTA.has(m?.document_type || 'factura');
export const esNotaCredito = (m) => (m?.document_type || '') === 'nota_credito';

/** Los motivos que SUNAT usa para anular por completo una operación. */
const RX_ANULACION = /anulaci[oó]n|anula(r|da|do)?\b|dejar sin efecto/i;

/** ¿El motivo declarado dice que anula la operación entera? */
export function motivoEsAnulacion(motivo) {
  return RX_ANULACION.test(String(motivo || ''));
}

/**
 * Motivo de una nota, mire donde mire: el campo propio o el JSON de `notas`
 * que deja Captura Mágica.
 */
export function motivoDeNota(nota) {
  if (!nota) return '';
  if (nota.nota_motivo) return String(nota.nota_motivo);
  const raw = nota.notas;
  if (!raw) return '';
  if (typeof raw === 'object') return String(raw.nota_motivo || raw.motivo || '');
  try {
    const j = JSON.parse(raw);
    return String(j?.nota_motivo || j?.motivo || '');
  } catch { return ''; }
}

const abs = (n) => Math.abs(Number(n) || 0);

/**
 * Mapa factura_id → estado de sus notas.
 *
 * @param movimientos  todos los accounting_movements visibles
 * @param tolerancia   holgura en soles para considerar "monto completo"
 * @returns Map(id → {
 *   notas: [{ id, document_number, date, amount, motivo, anulaMotivo }],
 *   totalNotas: number,        // suma de los importes de las notas (positivo)
 *   totalFactura: number,
 *   anulada: boolean,          // las notas cubren la factura entera
 *   parcial: boolean,          // hay notas pero no la cubren
 *   etiqueta: string,          // texto listo para el badge
 * })
 */
export function notasPorFactura(movimientos, { tolerancia = 0.05 } = {}) {
  const vivos = (movimientos || []).filter(m => m && !m.deleted_at);
  const porId = new Map(vivos.map(m => [m.id, m]));
  const out = new Map();

  for (const nota of vivos) {
    if (!esNotaCredito(nota)) continue;
    const destino = nota.related_movement_id ? porId.get(nota.related_movement_id) : null;
    // Sin destino, o el destino es otra nota (espejo intercompany) → no cuenta.
    if (!destino || esNota(destino)) continue;
    const motivo = motivoDeNota(nota);
    const entry = out.get(destino.id) || {
      notas: [], totalNotas: 0, totalFactura: abs(destino.amount),
      anulada: false, parcial: false, etiqueta: '',
    };
    entry.notas.push({
      id: nota.id,
      document_number: nota.document_number || '',
      date: nota.date || null,
      amount: abs(nota.amount),
      motivo,
      anulaMotivo: motivoEsAnulacion(motivo),
    });
    entry.totalNotas += abs(nota.amount);
    out.set(destino.id, entry);
  }

  for (const entry of out.values()) {
    // Anulada = las notas cubren el importe de la factura. El motivo por sí
    // solo no alcanza (una NC "por anulación" de S/ 100 sobre una factura de
    // S/ 9.000 es un ajuste, diga lo que diga el texto), pero si el monto
    // cuadra el motivo confirma.
    entry.anulada = entry.totalFactura > 0
      && entry.totalNotas + tolerancia >= entry.totalFactura;
    entry.parcial = !entry.anulada && entry.totalNotas > 0;
    const nums = entry.notas.map(n => n.document_number).filter(Boolean).join(', ');
    entry.etiqueta = entry.anulada
      ? `ANULADA por ${entry.notas.length > 1 ? 'las notas de crédito' : 'la nota de crédito'} ${nums || 's/n'}`
      : `Rebajada por ${entry.notas.length > 1 ? 'notas de crédito' : 'nota de crédito'} ${nums || 's/n'}`;
  }
  return out;
}

/**
 * ¿Esta nota anula por completo la factura que referencia?
 *
 * Es la pregunta que hace Captura Mágica al revisar: si la respuesta es sí, sus
 * ítems son una copia de los de la factura y no hay nada que corregir — se
 * muestran de solo lectura y la revisión se limita a confirmar.
 *
 * @param nota     { total, nota_motivo }  (la fila en revisión)
 * @param factura  el accounting_movement referenciado, o null si no se encontró
 */
export function anulaFacturaCompleta({ total, motivo, factura, tolerancia = 0.05 } = {}) {
  const t = abs(total);
  const f = factura ? abs(factura.amount) : 0;
  const montoCuadra = f > 0 && Math.abs(t - f) <= tolerancia;
  const porMotivo = motivoEsAnulacion(motivo);
  return {
    // Sin la factura en el sistema, el motivo es lo único que hay: alcanza para
    // avisar, no para dar por cerrada la revisión.
    esAnulacionTotal: montoCuadra && (porMotivo || f > 0),
    montoCuadra,
    porMotivo,
    totalFactura: f,
  };
}

/**
 * ¿La serie de la nota puede ser igual a la de la factura que modifica?
 *
 * SÍ. En SUNAT la numeración corre por TIPO de comprobante: la factura E001-1 y
 * la nota de crédito E001-1 son documentos distintos y ambos válidos. JARVEX
 * emite justamente así (serie E001 para los dos).
 *
 * Hasta hoy la app trataba esa coincidencia como un error de lectura y
 * BLOQUEABA el registro ("corregí la serie, suele empezar con FC/BC" — una
 * regla que no existe). Con esto pasa a ser un aviso: se advierte, no se frena.
 * El duplicado real lo sigue atrapando el guard de comprobantes, que compara
 * dentro del mismo tipo de documento.
 */
export function avisoSerieRepetida({ serieNota, serieFactura } = {}) {
  const a = String(serieNota || '').trim().toUpperCase();
  const b = String(serieFactura || '').trim().toUpperCase();
  if (!a || !b || a !== b) return null;
  return `La nota y la factura que modifica comparten el número ${a}. Es válido: SUNAT numera cada tipo de comprobante por separado, así que la nota de crédito ${a} y la factura ${a} conviven. Verificá contra el PDF que sea el número propio de la nota.`;
}
