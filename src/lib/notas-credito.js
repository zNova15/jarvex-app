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

// ═══════════════════════════════════════════════════════════════════
// FACTURA Y NOTA QUEDAN LAS DOS VIVAS (Gabriel, 25-set-2026).
//
// La pregunta 3 de la revisión: «¿se prefiere que factura y NC queden las dos
// vivas (como pide el RCE) o que la baja cancele también la NC?». Respuesta:
// las DOS vivas, y la nota resta en negativo — factura 1.000, nota −1.000,
// neto 0. Es exactamente lo que SUNAT tiene en el Registro de Compras, así que
// el cotejo contra el RCE cierra fila por fila.
//
// La tanda 9 (17-set) hacía lo contrario: daba de baja la factura
// (`payment_status='cancelled'`) y dejaba viva la nota. Todos los reportes
// sacaban la factura cancelada pero seguían restando la nota → la baja se
// contaba DOS veces. Medido el 25-set: 8 facturas en ese estado, S/ 5.984,77 y
// US$ 54.874,04 de crédito fiscal negativo que nunca existió.
//
// Por eso, además de dejar de cancelar, los reportes que suman plata tienen
// esta defensa: una nota cuya factura SÍ está dada de baja (una comunicación
// de baja legítima, o una PC con la versión vieja de la app) no resta nada.
// El par neto es cero en los dos casos; lo que no puede pasar es −X.
// ═══════════════════════════════════════════════════════════════════

/**
 * ¿Esta nota modifica un comprobante que está dado de baja?
 *
 * @param m         el movimiento a mirar
 * @param movsById  Map id → movimiento con TODOS los movimientos (la factura
 *                  suele ser de otro mes que la nota, así que la lista del
 *                  período no alcanza para encontrarla)
 */
export function notaSinEfecto(m, movsById) {
  if (!m || !esNota(m) || !m.related_movement_id) return false;
  const destino = movsById instanceof Map ? movsById.get(m.related_movement_id) : null;
  if (!destino || destino.deleted_at || esNota(destino)) return false;
  return destino.payment_status === 'cancelled';
}

/**
 * Los movimientos que SUMAN en un reporte de plata: vivos, no dados de baja,
 * y sin las notas cuya factura está dada de baja.
 *
 * @param movs        los que se quieren sumar (pueden ser los del período)
 * @param referencia  todos los movimientos, o un Map id → movimiento, para
 *                    encontrar la factura de cada nota. Sin él se usan `movs`.
 */
export function movimientosQueCuentan(movs, { referencia = null } = {}) {
  const lista = Array.isArray(movs) ? movs : [];
  const porId = referencia instanceof Map
    ? referencia
    : new Map((Array.isArray(referencia) ? referencia : lista).filter(Boolean).map(m => [m.id, m]));
  return lista.filter(m => m && !m.deleted_at && m.payment_status !== 'cancelled' && !notaSinEfecto(m, porId));
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

/**
 * Las facturas a las que PODRÍA estar apuntando una nota de crédito huérfana.
 *
 * EL PEDIDO (Gabriel, 9-set-2026): «el escáner no propone soluciones». La
 * familia más grande del escáner son las notas sin factura — 11 de las 19 notas
 * vivas al 9-set-2026 no tienen `related_movement_id`, así que no rebajan nada
 * en ningún reporte y la factura que anulan sigue contando entera.
 *
 * Encontrar la factura a mano es entrar a Movimientos, filtrar por el proveedor
 * y buscar entre las suyas. Acá se propone: misma empresa, mismo RUC, fecha
 * anterior o igual a la nota, e importe que ALCANCE para cubrirla (una nota no
 * puede rebajar más de lo que dice la factura).
 *
 * 🔴 PROPONE, NO ENLAZA. De las 11 huérfanas medidas, 6 tienen una sola
 * candidata y 5 tienen entre 2 y 4 — con proveedores como HOMECENTERS o
 * KOPLAST, que facturan muchas veces al mes, elegir sola sería adivinar. La
 * pantalla muestra la lista y la persona confirma contra el PDF.
 *
 * Orden: primero la del importe EXACTO (una anulación total cubre justo la
 * factura entera) y después la más cercana en fecha, que es como se busca de
 * verdad. `exacta` viaja en cada candidata para que la pantalla lo pueda decir.
 *
 * @returns [{ id, documento, fecha, monto, exacta }]
 */
export function candidatasDeNota(nota, movimientos, { tolerancia = 0.05, maximo = 6 } = {}) {
  if (!nota || !esNotaCredito(nota)) return [];
  const rucNota = String(nota.third_party_ruc ?? '').replace(/\D/g, '');
  if (!rucNota || !nota.company_id) return [];
  const montoNota = abs(nota.amount);

  const candidatas = (movimientos || []).filter(m => {
    if (!m || m.deleted_at || m.id === nota.id) return false;
    if (m.company_id !== nota.company_id) return false;
    if (esNota(m)) return false;                       // una nota no anula a otra
    if (m.payment_status === 'cancelled') return false;
    if (String(m.third_party_ruc ?? '').replace(/\D/g, '') !== rucNota) return false;
    // La nota es POSTERIOR a lo que modifica (o del mismo día).
    if (nota.date && m.date && String(m.date) > String(nota.date)) return false;
    // Y la factura tiene que alcanzar para cubrirla.
    return abs(m.amount) + tolerancia >= montoNota;
  });

  return candidatas
    .map(m => ({
      id: m.id,
      documento: m.document_number || 's/n',
      fecha: m.date || '',
      monto: abs(m.amount),
      exacta: Math.abs(abs(m.amount) - montoNota) <= tolerancia,
    }))
    .sort((a, b) => (Number(b.exacta) - Number(a.exacta))
      || String(b.fecha).localeCompare(String(a.fecha)))
    .slice(0, maximo);
}

/** Las notas de crédito HUÉRFANAS (sin `related_movement_id`, o apuntando a
 *  algo que ya no existe / a otra nota). Mismo criterio que usa el Escáner. */
function notasHuerfanas(movimientos) {
  const vivos = (movimientos || []).filter(m => m && !m.deleted_at);
  const porId = new Map(vivos.map(m => [m.id, m]));
  return vivos.filter(n => {
    if (!esNotaCredito(n)) return false;
    const destino = n.related_movement_id ? porId.get(n.related_movement_id) : null;
    return !destino || esNota(destino);
  });
}

/**
 * Al confirmar una factura NUEVA, ¿había una nota de crédito huérfana
 * ESPERÁNDOLA?
 *
 * ── EL CASO REAL (MILIAN SANCHEZ BENJAMIN, GASOMI, 13-set-2026) ────
 * Gabriel: «puede que ocurra el caso donde una factura se inserte en el
 * programa después que la nota de crédito y entonces no se vinculan». Medido:
 * la nota E001-13 se cargó SIETE HORAS antes que la factura E001-61 que
 * anula — a esa hora la factura no existía todavía, así que el match de
 * Captura Mágica (que solo mira lo YA cargado) no tenía contra qué resolver,
 * y `related_movement_id` quedó vacío PARA SIEMPRE: nada volvía a intentarlo
 * cuando la factura por fin llegó. Mismo agujero que `resolverGuiasPendientes`
 * tapa para las guías de remisión, del lado de las notas.
 *
 * SOLO se auto-vincula sin ambigüedad: mismo RUC y empresa, importe EXACTO
 * (una rebaja PARCIAL la decide una persona, no esta función) y la factura
 * tiene que ser la ÚNICA candidata exacta de esa nota — reusa exactamente
 * `candidatasDeNota`, así que el criterio de "candidata" nunca diverge entre
 * el auto-vínculo y lo que el Escáner le propone a la persona. Con más de un
 * candidato exacto (dos facturas del mismo importe al mismo proveedor) NO se
 * adivina: la nota se deja para que el Escáner la proponga y se elija mirando
 * el PDF — ver la cabecera de `candidatasDeNota`.
 *
 * @returns el movimiento de la nota a vincular, o null si no hay ninguna
 *          esperando (sin ambigüedad) por esta factura.
 */
export function notaEsperandoEstaFactura(factura, movimientos) {
  if (!factura || esNota(factura)) return null;
  const rucFactura = String(factura.third_party_ruc ?? '').replace(/\D/g, '');
  if (!rucFactura || !factura.company_id) return null;

  const vivos = (movimientos || []).filter(m => m && !m.deleted_at);
  const huerfanas = notasHuerfanas(vivos).filter(n =>
    n.company_id === factura.company_id
    && String(n.third_party_ruc ?? '').replace(/\D/g, '') === rucFactura);

  for (const nota of huerfanas) {
    const exactas = candidatasDeNota(nota, vivos).filter(c => c.exacta);
    if (exactas.length === 1 && exactas[0].id === factura.id) return nota;
  }
  return null;
}
