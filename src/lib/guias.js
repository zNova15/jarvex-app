// ═══════════════════════════════════════════════════════════════════
// JARVEX — Lógica PURA de guías de remisión (matching guía ↔ factura)
//
// La guía impresa trae "Doc. Ref.: F001-025131"; la factura vive en
// accounting_movements.document_number con formatos dispares
// ("F001-025131", "F001 - 25131", "f001-0025131"). El match normaliza
// serie + correlativo (sin ceros a la izquierda). Sin React ni Dexie.
// ═══════════════════════════════════════════════════════════════════

/** 'F001-025131' → { serie:'F001', correlativo:25131 } (null si no parsea). */
export function normalizarDoc(txt) {
  const s = String(txt || '').toUpperCase().trim();
  // serie alfanumérica (letra + dígitos) separada del correlativo por -, /, espacio
  const m = /([A-Z]{1,3}\s?\d{1,4})\s*[-/\s]\s*0*(\d{1,10})/.exec(s);
  if (!m) return null;
  return { serie: m[1].replace(/\s+/g, ''), correlativo: Number(m[2]) };
}

/**
 * TODAS las referencias de un "Doc. Ref." — una guía que ampara varias
 * facturas las lista en el mismo campo ("F001-123, F001-124 y F001-125").
 * normalizarDoc() se queda con la primera; para el vínculo N:M hacen falta
 * todas. Deduplica por serie+correlativo preservando el orden de aparición.
 */
export function normalizarDocs(txt) {
  const s = String(txt || '').toUpperCase();
  const re = /([A-Z]{1,3}\s?\d{1,4})\s*[-/\s]\s*0*(\d{1,10})/g;
  const out = [], vistos = new Set();
  let m;
  while ((m = re.exec(s)) !== null) {
    const doc = { serie: m[1].replace(/\s+/g, ''), correlativo: Number(m[2]) };
    const k = `${doc.serie}|${doc.correlativo}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(doc);
  }
  return out;
}

const rucLimpio = (r) => String(r || '').replace(/\D/g, '');

/**
 * Índice de los vínculos N:M (tabla guia_factura, mig 165).
 * @param vinculos filas { guia_id, accounting_movement_id, deleted_at }
 * @returns { porGuia: Map<guiaId, Set<movId>>, porFactura: Map<movId, Set<guiaId>> }
 */
export function indexarVinculos(vinculos) {
  const porGuia = new Map(), porFactura = new Map();
  for (const v of (vinculos || [])) {
    if (!v || v.deleted_at || !v.guia_id || !v.accounting_movement_id) continue;
    if (!porGuia.has(v.guia_id)) porGuia.set(v.guia_id, new Set());
    porGuia.get(v.guia_id).add(v.accounting_movement_id);
    if (!porFactura.has(v.accounting_movement_id)) porFactura.set(v.accounting_movement_id, new Set());
    porFactura.get(v.accounting_movement_id).add(v.guia_id);
  }
  return { porGuia, porFactura };
}

/**
 * ¿Es una VENTA el comprobante? (mismo criterio en todo el repo)
 */
const esVentaMov = (m) => (m?.clase || (m?.type === 'income' ? 'venta' : 'compra')) === 'venta';

/**
 * RUC de QUIEN EMITIÓ la factura. Es la pieza que faltaba para que las guías
 * EMITIDAS matcheen: `third_party_ruc` es el TERCERO del comprobante, o sea el
 * PROVEEDOR en una compra pero el CLIENTE en una venta. Comparar el emisor de
 * la guía contra ese campo daba siempre "RUC contradicho" en las ventas, y las
 * guías que emitimos nosotros no matcheaban NUNCA su factura.
 *
 * El invariante correcto es: quien traslada la mercadería es quien la vendió,
 * así que el emisor de la guía == el emisor de la factura.
 * @param rucCompanyDe (mov) => RUC de la empresa del grupo dueña del comprobante
 */
function rucEmisorDeFactura(mov, rucCompanyDe) {
  return rucLimpio(esVentaMov(mov)
    ? (rucCompanyDe ? rucCompanyDe(mov) : '')   // venta: emite NUESTRA empresa
    : mov?.third_party_ruc);                    // compra: emite el proveedor
}

/**
 * Busca la factura que referencia la guía.
 * @param guia { doc_referencia, emisor_ruc }
 * @param movimientos filas de accounting_movements (con document_number, third_party_ruc, deleted_at)
 * @returns { mov, confianza: 'alta'|'media' } | null
 */
/**
 * ¿La guía la EMITIÓ una empresa del grupo (emitida) o un proveedor (recibida)?
 * 100% derivable por RUC del emisor contra los RUC de companies (pedido
 * contadoras 31-ago). NO usar guias_remision.company_id para esto: esa columna
 * significa "empresa destinataria" y casi nunca está poblada.
 * @param guia { emisor_ruc }
 * @param rucsGrupo Set<string> de RUCs (solo dígitos) de las empresas del grupo
 * @returns 'emitida' | 'recibida' | 'desconocida'
 */
export function clasificarOrigenGuia(guia, rucsGrupo) {
  const ruc = rucLimpio(guia?.emisor_ruc);
  if (!ruc) return 'desconocida';
  const set = rucsGrupo instanceof Set ? rucsGrupo : new Set(rucsGrupo || []);
  return set.has(ruc) ? 'emitida' : 'recibida';
}

/**
 * LOS DOS LADOS DE UNA GUÍA (pedido de Gabriel, 3-sep-2026).
 *
 * Entre empresas del grupo hay traslados reales: GASOMI le vende material a
 * JHEENSEG y emite su guía. Esa guía es UNA sola —el papel que viajó con el
 * camión— pero tiene dos dueños: la EMITIÓ una empresa del grupo y la RECIBIÓ
 * otra. Hasta ahora la app le asignaba un solo lado (el emisor), así que al
 * filtrar por la empresa compradora la guía desaparecía y parecía faltar.
 *
 * La corrección es de LECTURA, no de datos: se resuelven los dos lados y la
 * misma fila se muestra desde ambos. Deliberadamente NO se crea una segunda
 * guía "espejo": la operación interna ya está registrada dos veces en
 * contabilidad (el ingreso del vendedor y el costo del comprador, que el
 * consolidado elimina de a pares). Duplicar también la guía haría que la
 * factura del comprador reclamara su propia guía, que el panel "requieren
 * guía" contara doble y que un traslado apareciera dos veces en el cruce con
 * almacén. Un traslado, un papel, una fila.
 *
 * @param guia      fila de guias_remision
 * @param facturas  facturas vinculadas a esa guía (accounting_movements)
 * @param opts {
 *   companyIdPorRuc: Map<ruc, companyId>   solo empresas del GRUPO
 *   esDelGrupo: (companyId) => boolean     idem
 * }
 * @returns { emisor, destinatario, interna, origen }
 */
export function ladosDeGuia(guia, facturas = [], opts = {}) {
  const { companyIdPorRuc, esDelGrupo } = opts;
  const delGrupo = typeof esDelGrupo === 'function' ? esDelGrupo : () => false;
  const ruc = rucLimpio(guia?.emisor_ruc);
  const emisor = (companyIdPorRuc && ruc) ? (companyIdPorRuc.get(ruc) || null) : null;
  const emitida = emisor != null;

  let destinatario = null;
  for (const f of facturas || []) {
    if (!f || f.deleted_at) continue;
    if (emitida) {
      // La emitimos nosotros: el otro lado es el CLIENTE de la venta, y solo
      // hay segundo lado si ese cliente también es del grupo.
      if (!esVentaMov(f)) continue;
      const rel = f.related_company_id;
      if (rel && rel !== emisor && delGrupo(rel)) { destinatario = rel; break; }
    } else {
      // La recibimos de un proveedor: el lado del grupo es quien compró.
      if (esVentaMov(f)) continue;
      if (f.company_id && delGrupo(f.company_id)) { destinatario = f.company_id; break; }
    }
  }

  return {
    emisor,
    destinatario,
    // Interna = los dos lados son del grupo. Con emisor externo nunca lo es.
    interna: !!(emitida && destinatario),
    origen: emitida ? 'emitida' : (ruc ? 'recibida' : 'desconocida'),
  };
}

/**
 * Las empresas del grupo a las que pertenece una guía: una si es de/para un
 * tercero, dos si el traslado fue interno. Es lo que tiene que mirar el filtro
 * por empresa para que la guía no se pierda del lado del comprador.
 */
export function empresasDeGuia(guia, facturas = [], opts = {}) {
  const l = ladosDeGuia(guia, facturas, opts);
  return [l.emisor, l.destinatario].filter(Boolean);
}

/**
 * Facturas que DEBERÍAN tener guía de remisión y no la tienen (pedido
 * contadoras 31-ago). Heurística: factura (no NC/boleta/recibo) con al menos
 * un ítem que NO es servicio (los bienes se trasladan) y sin guía vinculada.
 * - COMPRAS: falta la guía del proveedor (reclamarla).
 * - VENTAS: falta la guía que NUESTRA empresa debió emitir (riesgo tributario
 *   propio — el caso que menos pueden dejar pasar).
 * - sinDatos: facturas sin ítems parseables — la heurística no puede opinar.
 * El override manual vive en accounting_movements.guia_estado (mig 161):
 * 'no_requiere' la saca de la lista para siempre; null = decide la heurística.
 * @param movs filas de accounting_movements
 * @param guias filas de guias_remision (para el set de vinculadas)
 * @param itemsDe (mov) => items — inyectado (itemsDeFactura de cruce-recepcion)
 * @param opts { esEspejoAuto?: (mov) => bool } — detectar la compra ESPEJO
 *   automática de una venta interco (notas.intercompany_auto): no es un
 *   comprobante con traslado propio, la guía vive en la venta original.
 */
export function facturasQueRequierenGuia(movs, guias, itemsDe, opts = {}) {
  const esEspejoAuto = opts.esEspejoAuto || (() => false);
  // Vínculos: la tabla guia_factura (mig 165) es la fuente de verdad. Si no se
  // pasa, se cae a la columna vieja guias_remision.accounting_movement_id —
  // hace falta mientras haya clientes PWA con bundle cacheado, y mantiene
  // válidas las llamadas de dos argumentos.
  const vinculadas = opts.vinculos
    ? new Set(indexarVinculos(opts.vinculos).porFactura.keys())
    : new Set(
        (guias || []).filter(g => g && !g.deleted_at && g.accounting_movement_id).map(g => g.accounting_movement_id)
      );
  const compras = [], ventas = [], sinDatos = [];
  for (const m of (movs || [])) {
    if (!m || m.deleted_at) continue;
    if (m.document_type !== 'factura') continue;         // NC/boletas/recibos no llevan guía acá
    if (m.payment_status === 'cancelled') continue;
    if (m.guia_estado === 'no_requiere') continue;       // decisión manual persistente
    if (vinculadas.has(m.id)) continue;                  // ya tiene su guía
    // Par interco: el espejo automático no lleva guía propia, y si la OTRA
    // pata del par ya tiene la guía vinculada, este lado queda cubierto.
    if (esEspejoAuto(m)) continue;
    if (m.related_movement_id && vinculadas.has(m.related_movement_id)) continue;
    const items = (itemsDe ? itemsDe(m) : []) || [];
    const esVenta = (m.clase || (m.type === 'income' ? 'venta' : 'compra')) === 'venta';
    const forzada = m.guia_estado === 'requiere';
    // Sin ítems la heurística no puede opinar — salvo que la contadora la haya
    // forzado con "Sí requiere" (entonces entra a la lista real, no a sinDatos).
    if (!items.length && !forzada) { sinDatos.push(m); continue; }
    const tieneBienes = forzada || items.some(it => it && it.tipo_insumo !== 'servicio');
    if (!tieneBienes) continue;                          // solo servicios → sin traslado
    (esVenta ? ventas : compras).push(m);
  }
  return { compras, ventas, sinDatos };
}

/**
 * Guías candidatas para vincularle a UNA factura (el camino inverso de
 * matchFacturaDeGuia, para el panel "requieren guía"). Ordena: referencia
 * exacta primero. Cercos anti-vínculo-cruzado (las series F001-… se repiten
 * ENTRE emisores):
 * - COMPRA: descarta guías cuyo emisor contradice al proveedor de la factura.
 * - VENTA: el emisor de la guía debe ser NUESTRA empresa → solo guías cuyo
 *   RUC emisor esté en rucsGrupo (las recibidas de proveedores quedan fuera,
 *   aunque su doc_referencia coincida por casualidad).
 * @param rucsGrupo Set<string> de RUCs del grupo (obligatorio para ventas)
 */
export function sugerirGuiasParaFactura(mov, guiasSinVincular, rucsGrupo, opts = {}) {
  const doc = normalizarDoc(mov?.document_number);
  const rucMov = rucLimpio(mov?.third_party_ruc);
  const grupo = rucsGrupo instanceof Set ? rucsGrupo : new Set(rucsGrupo || []);
  const esVenta = esVentaMov(mov);
  // Con el vínculo N:M una guía YA vinculada a otra factura sigue siendo
  // candidata para esta (justamente el caso "una guía ampara varias
  // facturas"); lo único que se descarta es que ya esté vinculada a ESTA.
  // Sin la tabla nueva se mantiene el criterio viejo (una guía, un vínculo).
  const yaAqui = opts.vinculos
    ? (indexarVinculos(opts.vinculos).porFactura.get(mov?.id) || new Set())
    : null;
  return (guiasSinVincular || [])
    .filter(g => g && !g.deleted_at && (yaAqui ? !yaAqui.has(g.id) : !g.accounting_movement_id))
    .map(g => {
      const ref = normalizarDoc(g.doc_referencia);
      const rucG = rucLimpio(g.emisor_ruc);
      if (esVenta) {
        if (!rucG || !grupo.has(rucG)) return null;   // solo guías EMITIDAS por el grupo
      } else if (rucG && rucMov && rucG !== rucMov) {
        return null;                                   // RUC contradicho en compras
      }
      let pri = 0;
      // Varias referencias por guía: basta que UNA apunte a esta factura.
      const refs = normalizarDocs(g.doc_referencia);
      const hit = doc ? refs.find(r => r.correlativo === doc.correlativo) : null;
      if (hit) pri = hit.serie === doc.serie ? 3 : 2;
      else if (doc && ref && ref.correlativo === doc.correlativo) pri = ref.serie === doc.serie ? 3 : 2;
      else if (!esVenta && rucG && rucMov && rucG === rucMov) pri = 1;
      return { guia: g, pri };
    })
    .filter(Boolean)
    .sort((a, b) => b.pri - a.pri || String(b.guia.fecha_emision || '').localeCompare(String(a.guia.fecha_emision || '')));
}

/**
 * TODAS las facturas candidatas de una guía, ordenadas de mejor a peor
 * (pedido de Gabriel 1-sep: al subir una guía en Captura Mágica hay que
 * MOSTRAR las facturas a las que debería vincularse, en vez de auto-vincular
 * en silencio una sola — o ninguna cuando hay empate).
 *
 * Una guía puede amparar VARIAS facturas, así que se evalúan todas las
 * referencias del "Doc. Ref." (normalizarDocs) y se devuelve una candidata
 * por factura, no una sola ganadora.
 *
 * Cercos anti-vínculo-cruzado (las series F001-… se repiten ENTRE emisores):
 *  - El emisor de la guía debe coincidir con el emisor de la factura
 *    (ver rucEmisorDeFactura). RUC contradicho → descartada.
 *  - Guía EMITIDA por el grupo → solo ventas. RECIBIDA → solo compras.
 *    Si no se puede clasificar el origen, no se restringe la dirección.
 *
 * @param guia { id, doc_referencia, emisor_ruc }
 * @param movimientos filas de accounting_movements
 * @param opts {
 *   rucsGrupo?: Set<string>            RUCs del grupo (para el origen y las ventas)
 *   rucCompanyDe?: (mov) => string     RUC de la empresa dueña del comprobante
 *   vinculos?: filas de guia_factura   para no re-sugerir lo ya vinculado
 * }
 * @returns [{ mov, confianza: 'alta'|'media'|'baja', score, motivo }]
 */
export function sugerirFacturasParaGuia(guia, movimientos, opts = {}) {
  const { rucsGrupo, rucCompanyDe, vinculos } = opts;
  const refs = normalizarDocs(guia?.doc_referencia);
  const rucGuia = rucLimpio(guia?.emisor_ruc);
  const origen = clasificarOrigenGuia(guia, rucsGrupo || new Set());
  const yaVinculadas = indexarVinculos(vinculos).porGuia.get(guia?.id) || new Set();

  const out = [];
  for (const mv of (movimientos || [])) {
    if (!mv || mv.deleted_at) continue;
    if (mv.payment_status === 'cancelled') continue;
    if (yaVinculadas.has(mv.id)) continue;

    // Dirección: lo que emitimos ampara lo que vendimos, y viceversa.
    const venta = esVentaMov(mv);
    if (origen === 'emitida' && !venta) continue;
    if (origen === 'recibida' && venta) continue;

    const rucMov = rucEmisorDeFactura(mv, rucCompanyDe);
    const ambosRuc = !!rucGuia && !!rucMov;
    const rucOk = ambosRuc && rucGuia === rucMov;
    if (ambosRuc && !rucOk) continue;           // RUC contradicho

    const doc = normalizarDoc(mv.document_number);
    const refIgual = doc && refs.some(r => r.correlativo === doc.correlativo && r.serie === doc.serie);
    const refCorrel = doc && refs.some(r => r.correlativo === doc.correlativo);

    let score = 0, motivo = '';
    if (refIgual && rucOk)      { score = 3; motivo = 'La guía la referencia y el emisor coincide'; }
    else if (refIgual)          { score = 2; motivo = 'La guía referencia esta factura'; }
    else if (refCorrel && rucOk){ score = 2; motivo = 'Mismo correlativo y emisor (la serie no coincide)'; }
    else if (rucOk)             { score = 1; motivo = 'Mismo emisor, pero la guía no la referencia'; }
    else continue;

    out.push({ mov: mv, score, confianza: score >= 3 ? 'alta' : score === 2 ? 'media' : 'baja', motivo });
  }
  return out.sort((a, b) => b.score - a.score
    || String(b.mov.date || '').localeCompare(String(a.mov.date || '')));
}

/**
 * La ÚNICA factura que se puede vincular sola, sin preguntar. Envuelve a
 * sugerirFacturasParaGuia y mantiene el criterio conservador de siempre: si
 * hay empate en el tope es ambiguo y NO se auto-vincula (se muestran las
 * candidatas y decide la persona).
 */
export function matchFacturaDeGuia(guia, movimientos, opts = {}) {
  const cands = sugerirFacturasParaGuia(guia, movimientos, opts)
    .filter(c => c.score >= 2);   // "mismo emisor" a secas nunca auto-vincula
  if (!cands.length) return null;
  if (cands.length > 1 && cands[0].score === cands[1].score) return null;
  return { mov: cands[0].mov, confianza: cands[0].confianza };
}

// ═══════════════════════════════════════════════════════════════════
// PENDIENTES EN LOS DOS SENTIDOS (pedido de Gabriel, 1-sep)
//
// El vínculo casi nunca se cierra de una sola vez:
//  · Una guía referencia 3 facturas y solo 2 están cargadas → la 3ª queda
//    PENDIENTE y se resuelve sola cuando esa factura entre al sistema.
//  · Una factura se va cubriendo con guías sucesivas → mientras quede
//    material facturado sin trasladar, FALTA una guía por subir.
//
// Nada de esto se persiste: se DERIVA de doc_referencia, de los vínculos y
// de las cantidades. Así se corrige solo cuando aparece el documento que
// faltaba, sin estados que se queden viejos (mismo criterio que
// facturasQueRequierenGuia y que el stock desde movimientos).
// ═══════════════════════════════════════════════════════════════════

/**
 * Estado de CADA factura que la guía dice amparar.
 * @returns [{ serie, correlativo, doc, estado, mov, confianza }]
 *   estado: 'vinculada'    ya está atada a esta guía
 *         | 'sin_vincular' la factura existe pero todavía no se vinculó
 *         | 'ausente'      la factura NO está en el sistema → pendiente
 * @param opts igual que sugerirFacturasParaGuia (rucsGrupo, rucCompanyDe, vinculos)
 */
export function referenciasDeGuia(guia, movimientos, opts = {}) {
  const refs = normalizarDocs(guia?.doc_referencia);
  if (!refs.length) return [];
  const vinculadas = indexarVinculos(opts.vinculos).porGuia.get(guia?.id) || new Set();
  const movById = new Map((movimientos || []).map(m => [m.id, m]));
  // Las candidatas ya traen aplicados los cercos de emisor y dirección, así
  // que una factura del proveedor equivocado con el mismo número NO cuenta
  // como "la referencia existe".
  const cands = sugerirFacturasParaGuia(guia, movimientos, opts);
  const mismoDoc = (mv, ref) => {
    const d = normalizarDoc(mv?.document_number);
    return !!d && d.serie === ref.serie && d.correlativo === ref.correlativo;
  };
  return refs.map(ref => {
    const doc = `${ref.serie}-${ref.correlativo}`;
    for (const id of vinculadas) {
      const mv = movById.get(id);
      if (mv && mismoDoc(mv, ref)) return { ...ref, doc, estado: 'vinculada', mov: mv, confianza: null };
    }
    const c = cands.find(x => mismoDoc(x.mov, ref));
    if (c) return { ...ref, doc, estado: 'sin_vincular', mov: c.mov, confianza: c.confianza };
    return { ...ref, doc, estado: 'ausente', mov: null, confianza: null };
  });
}

/** Solo las referencias cuya factura todavía NO está en el sistema. */
export function referenciasPendientes(guia, movimientos, opts = {}) {
  return referenciasDeGuia(guia, movimientos, opts).filter(r => r.estado === 'ausente');
}

/**
 * El camino inverso, para resolver el pendiente en cuanto aparece: ¿qué guías
 * estaban esperando ESTA factura? Se llama al confirmar una factura nueva.
 * Aplica los mismos cercos (emisor coincidente, dirección venta/compra) para
 * no auto-vincular la guía de otro emisor que reusa la serie.
 * @returns guías que la referencian y todavía no están vinculadas a ella
 */
export function guiasEsperandoFactura(mov, guias, opts = {}) {
  const doc = normalizarDoc(mov?.document_number);
  if (!doc) return [];
  const idx = indexarVinculos(opts.vinculos);
  return (guias || []).filter(g => {
    if (!g || g.deleted_at) return false;
    if ((idx.porGuia.get(g.id) || new Set()).has(mov.id)) return false;   // ya vinculada
    if (!normalizarDocs(g.doc_referencia).some(r => r.serie === doc.serie && r.correlativo === doc.correlativo)) return false;
    // El cerco lo aplica el propio matcher — y para un cierre AUTOMÁTICO se
    // exige score 3 (referencia exacta Y emisor coincidente). Con score 2 la
    // guía no tiene RUC de emisor (o la serie difiere): ahí el cerco no puede
    // descartar una factura ajena que reusa el número, así que el pendiente se
    // queda esperando resolución manual en vez de cerrarse mal en silencio.
    return sugerirFacturasParaGuia(g, [mov], opts).some(c => c.mov.id === mov.id && c.score >= 3);
  });
}

const numG = (v) => Number(v) || 0;

/**
 * ¿La(s) guía(s) vinculadas a una factura cubren todo lo facturado?
 * Compara CANTIDADES por descripción+unidad: lo que falta por trasladar es la
 * señal de que todavía falta subir una guía.
 *
 * Los normalizadores se INYECTAN (normDesc / normUnidad) para no acoplar esta
 * lib — que es pura y sin imports — con insumo-correlacion/inventario-empresa.
 *
 * @returns {
 *   aplica       false si la factura no tiene bienes que trasladar (solo servicios o sin ítems)
 *   sinGuias     no hay ninguna guía vinculada todavía
 *   sinCruce     hay guías pero NINGUNA línea cruzó por descripción → no se puede
 *                opinar sobre cantidades (NO afirmamos que falte material)
 *   completa     todo lo facturado está trasladado
 *   lineas       [{ descripcion, unidad, facturado, trasladado, falta }]
 *   faltantes    las líneas con falta > 0
 * }
 */
export function coberturaDeGuias(mov, guiasVinculadas, itemsDe, opts = {}) {
  const normDesc = opts.normDesc || ((s) => String(s || '').toLowerCase().trim());
  const normUni = opts.normUnidad || ((u) => String(u || '').toLowerCase().trim());
  const clave = (d, u) => `${normDesc(d)}|${normUni(u)}`;

  const items = ((itemsDe ? itemsDe(mov) : []) || [])
    .filter(it => it && it.tipo_insumo !== 'servicio' && numG(it.cantidad) > 0);
  if (!items.length) return { aplica: false, sinGuias: false, sinCruce: false, completa: true, lineas: [], faltantes: [] };

  const guias = (guiasVinculadas || []).filter(g => g && !g.deleted_at);
  const trasladado = new Map();
  for (const g of guias) {
    for (const it of (g.items || [])) {
      if (!it) continue;
      const k = clave(it.descripcion, it.unidad);
      trasladado.set(k, (trasladado.get(k) || 0) + numG(it.cantidad));
    }
  }

  const lineas = items.map(it => {
    const k = clave(it.descripcion, it.unidad);
    const facturado = numG(it.cantidad);
    const tras = trasladado.get(k) || 0;
    return {
      descripcion: it.descripcion, unidad: it.unidad,
      facturado, trasladado: tras,
      // Traslados de más (guía que ampara varias facturas) no son un faltante.
      falta: Math.max(0, facturado - tras),
    };
  });

  const hayItemsDeGuia = trasladado.size > 0;
  const cruzoAlguna = lineas.some(l => l.trasladado > 0);
  const faltantes = lineas.filter(l => l.falta > 0.0001);
  return {
    aplica: true,
    sinGuias: guias.length === 0,
    // Guías cargadas cuyos ítems no matchean NINGUNA línea de la factura: casi
    // siempre es que el OCR escribió las descripciones distinto, no que falte
    // material. Se reporta aparte para no dar una alarma falsa.
    sinCruce: guias.length > 0 && hayItemsDeGuia && !cruzoAlguna,
    completa: faltantes.length === 0,
    lineas, faltantes,
  };
}
