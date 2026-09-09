// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL ARCHIVO DE UN COMPROBANTE (tanda 18, entrega B).
//
// EL PEDIDO (Gabriel, 9-set-2026): «si se detecta que la serie está incorrecta,
// que permita hipervínculo para revisar la factura real en foto o PDF y decida
// si realmente la incoherencia existe o no aplica».
//
// Una diferencia contra SUNAT o un hallazgo del escáner no se puede juzgar de
// memoria: hay que mirar el papel. En producción, 1.271 de los 1.424
// movimientos vivos (89%) tienen su comprobante cargado — o sea que casi
// siempre está a un clic, y hasta hoy no había forma de llegar a él desde estas
// dos pantallas.
//
// ── SOLO METADATOS ────────────────────────────────────────────────
// Acá NO se firma ninguna URL. Se devuelve la evidencia cruda y el 👁 aparece
// al instante; el archivo se firma recién cuando alguien hace clic
// (`getEvidenciaSrc`). Firmar de entrada las 1.302 evidencias de la base es lo
// que dejaba a Movimientos sin ojos por minutos en una PC con el caché vacío
// (7-set-2026) — el mismo error no se repite en una pantalla nueva.
//
// `dexie` se puede inyectar para los tests; por defecto usa `window.__db`, que
// es como el resto de la app llega a Dexie desde los componentes.
// ═══════════════════════════════════════════════════════════════════

/** Tipos que NO son el comprobante: son papeles del pago, no la factura. */
const NO_ES_COMPROBANTE = new Set(['bancarizacion', 'constancia_detraccion']);

/**
 * Estado EFECTIVO de una evidencia. El SyncEngine estampa 'synced' al BAJAR lo
 * creado en otro dispositivo: con URL, el archivo ESTÁ subido aunque no diga
 * 'uploaded'. Sin esta normalización, la PC que no la creó muestra un
 * «⏳ subiendo» eterno (bug real, 20-jul-2026).
 */
const estadoEv = (ev) =>
  (ev?.url_archivo && (ev.sync_status === 'uploaded' || ev.sync_status === 'synced'))
    ? 'uploaded' : ev?.sync_status;

const rankSync = (s) => (s === 'uploaded' ? 0 : s === 'failed' ? 2 : 1);

/**
 * El archivo de cada comprobante pedido.
 *
 * @param ids    ids de accounting_movements
 * @param opts   { dexie }  — inyectable para tests
 * @returns Map(movimientoId → { ev, mime, nombre, sync })
 *          Los que no tienen nada cargado simplemente no están en el mapa: así
 *          la pantalla muestra el 👁 solo donde hay algo que abrir, en vez de
 *          ofrecer un botón que después dice «no hay archivo».
 */
export async function evidenciasDeComprobantes(ids = [], { dexie = null } = {}) {
  const out = new Map();
  const quiero = new Set((ids || []).filter(Boolean));
  if (!quiero.size) return out;
  const db = dexie || (typeof window !== 'undefined' ? window.__db : null);
  if (!db?.evidencias) return out;

  let evs = [];
  try {
    evs = await db.evidencias
      .filter(e => !e.deleted_at
        && e.modulo_relacionado === 'accounting_movements'
        && quiero.has(e.registro_relacionado_id)
        && !NO_ES_COMPROBANTE.has(e.tipo_evidencia || ''))
      .toArray();
  } catch { return out; }

  // Por comprobante gana la ya SUBIDA sobre cualquier pendiente o fallida, y
  // entre iguales la más nueva. (Antes ganaba la más nueva a secas y un
  // registro fantasma atascado tapaba al archivo que sí estaba.)
  evs.sort((a, b) => (rankSync(estadoEv(a)) - rankSync(estadoEv(b)))
    || String(b.created_at || '').localeCompare(String(a.created_at || '')));

  for (const ev of evs) {
    if (out.has(ev.registro_relacionado_id)) continue;
    out.set(ev.registro_relacionado_id, {
      ev,
      mime: ev.mime_type || 'application/pdf',
      nombre: ev.nombre_archivo || 'comprobante',
      sync: estadoEv(ev),
    });
  }
  return out;
}
