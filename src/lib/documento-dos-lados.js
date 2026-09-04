// ═══════════════════════════════════════════════════════════════════
// JARVEX — UN COMPROBANTE, DOS LIBROS.
//
// EL PEDIDO (Gabriel, 4-sep-2026): «si esa nota de crédito está conectada
// con alguna empresa que manejamos, podríamos tomar esas notas de crédito
// como evidencia para dichas empresas de nuestro grupo […] como son notas que
// incluyen a 2 empresas de nuestro grupo, esta nota será visible desde la
// contabilidad de cada una de ellas (siendo la misma, claro)».
//
// El caso que lo originó: JARVEX emitió facturas equivocadas y hubo que
// anularlas con notas de crédito para volver a emitirlas bien. Esas notas
// nombran a DOS entidades del grupo, pero se cargan una sola vez —del lado
// del que las emitió— y del otro lado no se ven: al filtrar Movimientos
// Contables por esa empresa, el documento desaparece.
//
// Es la MISMA regla que la tanda 3 ya aplicó a las guías de remisión
// (`ladosDeGuia` en guias.js): un traslado, un papel, dos dueños. Acá: un
// comprobante, una fila, dos libros.
//
// ── POR QUÉ UN REFLEJO Y NO UN MOVIMIENTO ESPEJO ──────────────────
// Crear la contraparte sumaría plata que nadie movió. El espejo de verdad
// (el ingreso del vendedor contra el costo del comprador) existe cuando la
// operación se cargó de los dos lados, y el Consolidado los elimina de a
// pares (consolidado.js). Lo que esta librería resuelve es el otro caso: el
// documento que SOLO está en un libro. Ahí no hay nada que eliminar —hay algo
// que MIRAR—, así que se muestra la misma fila desde el otro lado, marcada, y
// **fuera de los totales de esa empresa**. Un reflejo no es un asiento.
//
// ── CUÁNDO HAY SEGUNDO LADO (y cuándo no) ─────────────────────────
// 1. La contraparte tiene que estar IDENTIFICADA en el catálogo: por
//    `related_company_id`, o por RUC de 11 dígitos contra `companies`. Un
//    proveedor suelto que no está en el catálogo no tiene libro que mirar.
// 2. El vínculo tiene que estar AFIRMADO en el dato: `is_intercompany` marcado
//    o `related_company_id` cargado. Un reflejo dice algo sobre la
//    contabilidad de OTRO: que se apoye en una afirmación y no en un RUC que
//    coincide. Sin esto, cada venta a una municipalidad-cliente aparecería en
//    "su" libro.
// 3. La contraparte NO puede tener ya el documento en su libro. Si lo tiene
//    (por `related_movement_id` de cualquiera de los dos lados, o por mismo
//    número e importe), el reflejo lo mostraría DOS veces.
//
// Y una consecuencia buscada: el tipo de entidad NO manda acá. CONSORCIO
// ESPERANZA y CONSORCIO SAMADAY están marcados 'tercero' —decisión de Gabriel
// del 3-sep para que el Consolidado no arrastre la migración de sus socias—,
// y esa decisión sigue intacta: **este archivo no toca ni un número del
// consolidado**. Pero son consorcios del grupo que quedaron abiertos, y sus
// notas de crédito son evidencia de las dos empresas que nombran. Consolidar
// y ver no son la misma pregunta.
//
// Medido en producción el 4-sep-2026: 4 documentos entran acá — las 2 facturas
// de JARVEX a CONSORCIO EL INCA (S/ 31.948,68; dejan de entrar en cuanto se
// corra la mig 176, que carga el espejo real), la NC E001-64 de GASOMI a
// CONSORCIO SAMADAY (−3.109,00) y la NC E001-48 de TEATINO MARTINEZ KARLA
// EROYLA a CONSORCIO ESPERANZA (−690,00).
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** RUC peruano utilizable como identificador (mismo criterio que consolidado.js). */
export function rucLimpio(ruc) {
  const s = String(ruc || '').replace(/\D/g, '');
  return s.length === 11 ? s : null;
}

/** Índice del catálogo para resolver contrapartes: por id y por RUC. */
export function indiceEmpresas(companies = []) {
  const porId = new Map();
  const porRuc = new Map();
  for (const c of vivos(companies)) {
    porId.set(c.id, c);
    const ruc = rucLimpio(c.ruc);
    // Si dos companies comparten RUC (duplicados que la pantalla de fusión
    // resuelve), gana la primera: no inventamos una desambiguación.
    if (ruc && !porRuc.has(ruc)) porRuc.set(ruc, c);
  }
  return { porId, porRuc };
}

/** ¿Alguien AFIRMÓ que este comprobante involucra a otra entidad del catálogo? */
export function vinculoAfirmado(mov) {
  return !!(mov && (mov.is_intercompany === true || mov.related_company_id));
}

/**
 * Los dos lados de un comprobante.
 * @returns {{ titular, contraparte, contraparteCompany, via, dosLados }}
 *   titular = la empresa en cuyo libro está cargado (company_id).
 *   contraparte = la otra entidad del catálogo, si está identificada.
 *   via = 'related_company_id' | 'ruc' | null.
 */
export function ladosDeDocumento(mov, indice) {
  const idx = indice || { porId: new Map(), porRuc: new Map() };
  const titular = mov?.company_id || null;
  let contraparteCompany = null;
  let via = null;

  const rel = mov?.related_company_id;
  if (rel && rel !== titular && idx.porId.has(rel)) {
    contraparteCompany = idx.porId.get(rel);
    via = 'related_company_id';
  } else {
    const ruc = rucLimpio(mov?.third_party_ruc);
    const c = ruc ? idx.porRuc.get(ruc) : null;
    if (c && c.id !== titular) { contraparteCompany = c; via = 'ruc'; }
  }

  return {
    titular,
    contraparte: contraparteCompany?.id || null,
    contraparteCompany,
    via,
    dosLados: !!(titular && contraparteCompany && vinculoAfirmado(mov)),
  };
}

/** Clave de "es el mismo papel": número de documento + importe. */
function claveDocumento(mov) {
  const doc = String(mov?.document_number || '').trim().toUpperCase();
  if (!doc) return null;
  return `${doc}|${r2(mov?.amount)}`;
}

/**
 * Los comprobantes que cada empresa tiene que VER aunque no estén en su libro.
 *
 * @param movs       accounting_movements
 * @param companies  catálogo
 * @returns Map<companyId, Map<movId, {
 *            mov, titularId, titularNombre, contraparteId, via, motivo
 *          }>>
 *          Un Map de Maps para que la pantalla pregunte por id en O(1) y
 *          pueda mostrar de dónde salió la fila.
 */
export function reflejosPorEmpresa({ movs = [], companies = [] } = {}) {
  const idx = indiceEmpresas(companies);
  const filas = vivos(movs);

  // Lo que cada empresa YA tiene cargado, para no mostrar el mismo papel dos
  // veces: por id de movimiento (vínculos explícitos) y por documento+importe.
  const porEmpresaDoc = new Map();   // companyId → Set<'DOC|monto'>
  const vinculados = new Set();      // 'companyId|movId' — ya emparejado de ese lado
  for (const m of filas) {
    if (!m.company_id) continue;
    const k = claveDocumento(m);
    if (k) {
      if (!porEmpresaDoc.has(m.company_id)) porEmpresaDoc.set(m.company_id, new Set());
      porEmpresaDoc.get(m.company_id).add(k);
    }
    if (m.related_movement_id) {
      vinculados.add(`${m.company_id}|${m.related_movement_id}`);
      vinculados.add(`${m.related_movement_id}|${m.company_id}`);
    }
  }
  // El vínculo se escribe de UN lado (el comprador). Para preguntarlo desde el
  // otro hace falta saber en qué libro vive cada movimiento.
  const libroDe = new Map(filas.map(m => [m.id, m.company_id]));

  const out = new Map();
  for (const m of filas) {
    const lados = ladosDeDocumento(m, idx);
    if (!lados.dosLados) continue;
    const otro = lados.contraparte;

    // ¿La contraparte ya lo tiene? Tres formas de saberlo:
    // (a) este movimiento apunta a uno de SU libro;
    if (m.related_movement_id && libroDe.get(m.related_movement_id) === otro) continue;
    // (b) alguno de su libro apunta a este;
    if (vinculados.has(`${otro}|${m.id}`)) continue;
    // (c) mismo número de documento y mismo importe en su libro.
    const k = claveDocumento(m);
    if (k && porEmpresaDoc.get(otro)?.has(k)) continue;

    if (!out.has(otro)) out.set(otro, new Map());
    out.get(otro).set(m.id, {
      mov: m,
      titularId: lados.titular,
      titularNombre: idx.porId.get(lados.titular)?.name || null,
      contraparteId: otro,
      via: lados.via,
      motivo: lados.via === 'related_company_id'
        ? 'El comprobante nombra a esta empresa como contraparte.'
        : 'El RUC de la contraparte es el de esta empresa.',
    });
  }
  return out;
}

/**
 * Los reflejos de UNA empresa, ya listos para la pantalla.
 * Devuelve `{ ids, filas }` — el Set para filtrar en O(1), las filas para el
 * cartel que explica qué está viendo la contadora.
 */
export function reflejosDe(empresaId, reflejos) {
  const m = (empresaId && reflejos instanceof Map) ? reflejos.get(empresaId) : null;
  if (!m || m.size === 0) return { ids: new Set(), filas: [] };
  const filas = [...m.values()].sort((a, b) =>
    String(b.mov.date || '').localeCompare(String(a.mov.date || ''))
    || String(a.mov.document_number || '').localeCompare(String(b.mov.document_number || '')));
  return { ids: new Set(m.keys()), filas };
}
