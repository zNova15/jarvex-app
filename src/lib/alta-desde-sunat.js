// ═══════════════════════════════════════════════════════════════════
// JARVEX — DAR DE ALTA UN COMPROBANTE A PARTIR DEL CORTE DE SUNAT.
//
// Lib PURA (sin Dexie, sin React). La pantalla de «SUNAT vs JARVEX» la usa
// para armar el movimiento; los tests la usan para probar el armado sin tocar
// la base.
//
// ── POR QUÉ EXISTE, SI LA COMPARATIVA ERA DE SOLO LECTURA ─────────
// Lo era por decisión de Gabriel (8-set-2026): «reporta y exporta, no da de
// alta; lo que falta se sigue cargando por Captura Mágica con el PDF, que es
// lo único que trae el detalle». Esa regla sigue valiendo para el caso normal.
//
// Lo que cambió es que apareció el caso donde NO HAY PDF que subir. Enero-2026
// de GASOMI: faltan dos facturas del BANCO DE CRÉDITO DEL PERÚ (FI01-17943297
// de S/ 40,50 y FN01-41488655 de S/ 10,00) y el portal de SUNAT no las deja
// descargar — pasa seguido con los comprobantes emitidos por bancos. Sin esas
// dos, el total de NO GRAVADAS del Registro de Compras no cuadra, y eso es lo
// que encontró la asistente de contabilidad cuadrando el mes. Esperar el papel
// que no va a llegar deja el registro mal para siempre.
//
// Así que el alta desde acá NO es un atajo para cargar facturas sin mirarlas:
// es el camino para las que no se pueden conseguir. Por eso el movimiento
// nace con `falta_comprobante = true` y su motivo: queda dicho, en el dato y
// no en la memoria de alguien, que ese registro se hizo con lo que dijo SUNAT
// y que el papel sigue faltando.
//
// ── EL DESGLOSE VIENE COMPLETO, Y ES LA MITAD DEL VALOR ───────────
// El CSV del RCE trae base, IGV, no gravado, total, moneda y tipo de cambio.
// Se guardan en `notas` —que es donde vive el desglose real en esta app, ver
// `igv-desglose.js`— incluido `no_gravado`, que ES el dato que faltaba: sin
// él, una factura 100 % exonerada se estimaba al 18 % e inventaba crédito
// fiscal.
//
// ── LOS IMPORTES DE SUNAT VIENEN EN SOLES (regla 11 del CLAUDE.md) ─
// El archivo trae el importe ya convertido y el tipo de cambio en su propia
// columna; la app guarda el importe EN LA MONEDA DEL COMPROBANTE. Así que al
// dar de alta hay que dividir, no copiar: si no, una factura de US$ 1.000
// entraría como US$ 3.495 y volvería a salir como «importe distinto» en el
// mismo cotejo que la acaba de crear.
// ═══════════════════════════════════════════════════════════════════

import { TIPO_CP_A_DOCUMENTO } from './sunat-csv.js';
import { derivarTypeContable, destinoDesdeSelector } from './clasificacion-contable.js';

const r2 = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
};
const rucLimpio = (x) => String(x ?? '').replace(/\D/g, '');

/** Los estados del cotejo que SÍ se pueden dar de alta: solo los que faltan. */
export const ESTADOS_ALTABLES = ['solo_sunat'];

/** ¿Esta fila del cotejo se puede dar de alta en JARVEX? */
export function sePuedeDarDeAlta(fila) {
  if (!fila || fila.movimientoId) return false;         // ya existe de algún lado
  if (!ESTADOS_ALTABLES.includes(fila.estado)) return false;
  // Sin número de comprobante no hay nada que registrar (y SUNAT lo observa).
  return !!(fila.serie && fila.numero);
}

/**
 * El importe en LA MONEDA DEL COMPROBANTE a partir de lo que trae el archivo.
 *
 * @returns {{ amount:number, currency:string, tipoCambio:number|null }}
 */
export function importeEnSuMoneda({ total, moneda, tipoCambio } = {}) {
  const mon = String(moneda || 'PEN').trim().toUpperCase();
  const tc = Number(tipoCambio) || 0;
  if (mon === 'PEN' || !(tc > 1)) {
    return { amount: r2(total), currency: mon || 'PEN', tipoCambio: mon === 'PEN' ? null : (tc > 1 ? tc : null) };
  }
  return { amount: r2(Number(total || 0) / tc), currency: mon, tipoCambio: tc };
}

/**
 * Lo que la ventana de revisión muestra ANTES de dar de alta: el mismo
 * contenido que va a guardarse, ya desarmado en campos editables.
 *
 * Se separa del armado final a propósito. La pantalla edita ESTE objeto y
 * después se lo pasa a `movimientoDesdeCorte`, así lo que se ve confirmado es
 * exactamente lo que se guarda: no hay un segundo lugar donde se recalculen
 * los números.
 */
export function borradorDesdeFila(fila, { periodo = '' } = {}) {
  const f = fila || {};
  // `tipoCambioSunat` es el del ARCHIVO (el que convirtió el importe a soles).
  // `tipoCambio` a secas, en una fila del cotejo, es el que se usó para
  // conciliar contra un movimiento que ya existe — y una fila que se puede dar
  // de alta, por definición, no tiene ese movimiento. Se prueban los dos por
  // si el corte viene de una versión anterior a este campo.
  const { amount, currency, tipoCambio } = importeEnSuMoneda({
    total: f.sunatTotal, moneda: f.moneda, tipoCambio: f.tipoCambioSunat ?? f.tipoCambio,
  });
  const tc = tipoCambio || 0;
  // El desglose también vuelve a la moneda del comprobante, por el mismo
  // motivo que el total: guardar una base en soles junto a un total en
  // dólares haría que el Libro Diario no cierre.
  const aMoneda = (v) => (currency !== 'PEN' && tc > 1 ? r2(Number(v || 0) / tc) : r2(v));

  return {
    documentType: TIPO_CP_A_DOCUMENTO[String(f.tipoCp || '01').padStart(2, '0')] || 'factura',
    documentNumber: `${String(f.serie || '').trim().toUpperCase()}-${Number(f.numero) || 0}`,
    date: f.fecha || '',
    ruc: rucLimpio(f.contraparteRuc),
    nombre: String(f.contraparteNombre || '').trim(),
    base: aMoneda(f.sunatBase),
    igv: aMoneda(f.sunatIgv),
    noGravado: aMoneda(f.sunatNoGravado),
    amount,
    currency,
    tipoCambio: tc > 1 ? tc : null,
    // El período del corte que se está mirando. Si el comprobante es de otro
    // mes, es justamente ahí donde SUNAT lo está declarando.
    periodoDeclarado: String(periodo || '').replace(/\D/g, '').slice(0, 6) || '',
    // El motivo por defecto es el caso real que originó todo esto; se edita.
    faltaComprobanteMotivo: '',
    // Sin decidir: cae a la bandeja de la Contadora Jefe, que es donde tiene
    // que caer algo que se registró sin saber qué es.
    destinoSel: '__nose__',
  };
}

/**
 * Los campos de `accounting_movements` para el alta. Sin id, sin created_at,
 * sin sync_status: eso lo pone la pantalla, que es la que sabe del modo prueba
 * y del usuario.
 *
 * @param borrador  el de `borradorDesdeFila`, ya revisado/corregido a mano
 * @param opts      { companyId, libro, periodo, obraExiste, companies }
 *                  `companies`: las empresas del grupo, para reconocer una
 *                  operación entre empresas por el RUC de la contraparte
 */
export function movimientoDesdeCorte(borrador, { companyId, libro = 'compras', periodo = '', obraExiste, companies = [] } = {}) {
  const b = borrador || {};
  // ¿La contraparte es OTRA empresa del grupo? (tanda F, 26-set-2026) Antes el
  // alta nacía siempre como operación con terceros, y una factura de EL INCA a
  // JARVEX dada de alta desde el corte quedaba fuera del cruce intercompany y
  // el escáner la reclamaba. Se reconoce por RUC, que es lo único seguro.
  const rucContraparte = rucLimpio(b.ruc);
  const empresaGrupo = rucContraparte
    ? (companies || []).find(c => c && !c.deleted_at && c.id !== companyId && rucLimpio(c.ruc) === rucContraparte)
    : null;
  const esVenta = libro === 'ventas';
  const { destino_contable, obra_id } = destinoDesdeSelector(b.destinoSel, obraExiste || (() => true));
  const etiqueta = b.documentType === 'nota_credito' ? 'Nota de Crédito'
    : b.documentType === 'nota_debito' ? 'Nota de Débito'
      : b.documentType === 'boleta' ? 'Boleta' : 'Factura';

  // Una nota de crédito resta, igual que en Captura Mágica.
  const signo = b.documentType === 'nota_credito' ? -1 : 1;
  const amount = r2(signo * Math.abs(Number(b.amount) || 0));

  // El período declarado solo se guarda cuando es DISTINTO del de la emisión:
  // repetirlo sería guardar el caso normal como si fuera una excepción, y
  // después nadie sabe cuáles se movieron de verdad.
  const periodoEmision = String(b.date || '').slice(0, 7).replace('-', '');
  const periodoPedido = String(b.periodoDeclarado || periodo || '').replace(/\D/g, '').slice(0, 6);
  const periodoDeclarado = (periodoPedido && periodoPedido !== periodoEmision) ? periodoPedido : null;

  const base = {
    company_id: companyId || null,
    obra_id: obra_id || null,
    destino_contable,
    clase: esVenta ? 'venta' : 'compra',
    is_intercompany: !!empresaGrupo,
    related_company_id: empresaGrupo ? empresaGrupo.id : null,
    date: b.date || null,
    category: etiqueta,
    description: `${etiqueta} ${b.documentNumber} · ${b.nombre || ''}`.replace(/\s+/g, ' ').trim(),
    amount,
    currency: b.currency || 'PEN',
    tipo_cambio: b.tipoCambio || null,
    third_party_name: b.nombre || null,
    third_party_ruc: rucLimpio(b.ruc) || null,
    document_type: b.documentType || 'factura',
    document_number: b.documentNumber || null,
    // Se registra el comprobante, no su pago: quién le pagó al banco y cuándo
    // es otra pregunta y tiene su propia pantalla.
    payment_status: 'pending',
    // No hay nada que recibir en almacén: es un comprobante que se dio de alta
    // para cuadrar el registro, no una compra de materiales.
    recepcion_status: 'no_aplica',
    detraccion_aplica: false,
    periodo_declarado: periodoDeclarado,
    falta_comprobante: true,
    falta_comprobante_motivo: String(b.faltaComprobanteMotivo || '').trim() || null,
    notas: JSON.stringify({
      alta_desde_sunat: true,
      corte: String(periodo || ''),
      libro,
      // El desglose REAL, en la moneda del comprobante. `no_gravado` es el que
      // hacía falta: con él, una factura exonerada deja de estimarse al 18 %.
      subtotal: r2(b.base),
      igv: r2(b.igv),
      no_gravado: r2(b.noGravado),
      nota: 'Registrado desde el corte de SUNAT porque el comprobante no se pudo descargar del portal. '
        + 'Se puede reemplazar subiendo el comprobante real por Captura Mágica.',
    }),
  };
  base.type = derivarTypeContable(base);
  return base;
}

/**
 * Lo que hay que decirle al usuario ANTES de confirmar, en una línea por cosa.
 * Se calcula acá y no en la pantalla para que el texto no se separe de la
 * regla que lo produce.
 */
export function avisosDelBorrador(borrador) {
  const b = borrador || {};
  const avisos = [];
  const total = Math.abs(Number(b.amount) || 0);
  const suma = r2(Math.abs(Number(b.base) || 0) + Math.abs(Number(b.igv) || 0) + Math.abs(Number(b.noGravado) || 0));
  if (total > 0 && Math.abs(suma - total) > 0.05) {
    avisos.push(`El desglose no suma el total: ${suma.toFixed(2)} contra ${total.toFixed(2)}. `
      + 'Revisá base, IGV y no gravadas antes de dar de alta — así entra al Libro Diario.');
  }
  if (!b.date) avisos.push('Falta la fecha de emisión.');
  if (rucLimpio(b.ruc).length !== 11) avisos.push('El RUC no tiene 11 dígitos: SUNAT observa el registro.');
  if (b.currency !== 'PEN' && !b.tipoCambio) {
    avisos.push('Está en otra moneda y el archivo no trajo tipo de cambio: el registro no va a poder declararse en soles.');
  }
  return avisos;
}

export default {
  ESTADOS_ALTABLES, sePuedeDarDeAlta, importeEnSuMoneda,
  borradorDesdeFila, movimientoDesdeCorte, avisosDelBorrador,
};
