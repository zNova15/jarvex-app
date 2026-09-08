// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL ESCÁNER DE INCOHERENCIAS (tanda 14, entrega 6). Lib PURA.
// Testeada en __tests__/escaner-incoherencias.test.js.
//
// ── QUÉ ES ────────────────────────────────────────────────────────
// La entrega 5 compara contra SUNAT, que es una fuente de AFUERA y solo existe
// para los meses que Gabriel se toma el trabajo de bajar. Esto mira los
// movimientos CONTRA SÍ MISMOS: lo que se puede afirmar que está mal sin
// pedirle nada a nadie. Corre sobre lo que ya está cargado, todos los meses, y
// sin archivo de por medio.
//
// Cuatro familias, elegidas por Gabriel el 8-set-2026, todas medidas contra
// producción ANTES de escribirlas (los números están en cada regla):
//   1. INTERCOMPANY SIN ESPEJO — un comprobante marcado entre empresas del
//      grupo al que le falta el otro lado.
//   2. NOTA DE CRÉDITO HUÉRFANA O SIN EFECTO — una nota que no apunta a nada,
//      o una factura anulada que sigue contando como si estuviera viva.
//   3. IMPORTES QUE NO CUADRAN SOLOS — el total contra su propio desglose, las
//      notas de crédito en positivo, y el mismo comprobante cargado dos veces.
//   4. SERIE O NÚMERO IMPOSIBLE — lo que no tiene forma de comprobante, y los
//      correlativos repetidos en lo que EMITE el grupo.
//
// ── 🔴 LA REGLA DE ORO: SI NO ES SEGURO, NO SE REPORTA ────────────
// Un escáner que grita por cosas que están bien se apaga a la semana y no lo
// vuelve a abrir nadie — es exactamente lo que pasó con las recomendaciones de
// movida del catálogo (entrega 2.2), que eran 31 y la mitad basura hasta que se
// les pusieron dos reglas duras. Acá cada regla tiene su freno explícito:
//   · el IGV solo se juzga cuando el comprobante TRAJO su desglose; el
//     estimado al 18% de `desglosarIgv` nunca acusa a nadie (1.395 movimientos
//     y la enorme mayoría no tiene desglose guardado: acusarlos sería ruido
//     puro).
//   · la detracción del 4% de construcción NO es un error (se reportó una vez
//     y estaba mal; ver la memoria de detracciones).
//   · los correlativos repetidos solo se miran en lo que EMITE el grupo. En las
//     compras, dos proveedores distintos usan F001-1 el mismo mes y es normal.
//   · el nombre del tercero no se juzga nunca: comercial vs legal.
// ═══════════════════════════════════════════════════════════════════

import { partirDocumento, SERIE_RE } from './serie-comprobante.js';
import { esVentaMov } from './costo-obra.js';
import { esNotaCredito, esNota, notasPorFactura } from './notas-credito.js';
import { desglosarIgv } from './igv-desglose.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const abs = (n) => Math.abs(Number(n) || 0);
const rucLimpio = (x) => String(x ?? '').replace(/\D/g, '');
const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);

/** Cuánto puede desviarse un importe antes de ser un error de verdad. */
const TOLERANCIA = 0.05;
export const FAMILIAS = {
  intercompany: 'Intercompany sin espejo',
  nota_credito: 'Notas de crédito',
  importes: 'Importes que no cuadran',
  serie: 'Serie o número imposible',
};

export const GRAVEDAD = { alta: 3, media: 2, baja: 1 };

const hallazgo = (familia, regla, mov, { gravedad = 'media', titulo, detalle, monto = 0, ...extra }) => ({
  // El id es DERIVADO del movimiento y la regla, no aleatorio: así la misma
  // incoherencia tiene el mismo id en las dos PCs de Gabriel y una decisión
  // tomada en una vale en la otra.
  id: `${regla}:${mov?.id || 'sin-id'}`,
  familia, regla, gravedad,
  movimientoId: mov?.id || null,
  companyId: mov?.company_id || null,
  documento: mov?.document_number || '',
  fecha: mov?.date || '',
  terceroRuc: rucLimpio(mov?.third_party_ruc),
  terceroNombre: mov?.third_party_name || '',
  importe: r2(mov?.amount),
  titulo, detalle, monto: r2(monto), ...extra,
});

// ── 1. INTERCOMPANY SIN ESPEJO ────────────────────────────────────
/**
 * Un comprobante marcado `is_intercompany` tiene que existir de los dos lados:
 * la venta en quien factura y la compra en quien recibe. Si falta un lado, una
 * de las dos empresas está declarando algo que la otra no.
 *
 * MEDIDO el 8-set-2026 en producción: las ventas `E001-1` y `E001-2` de JARVEX
 * a CONSORCIO EL INCA están marcadas intercompany y EL INCA NO tiene el costo.
 * La `E001-2` son S/ 19.028,68 reales que le faltan a la obra; la `E001-1` está
 * anulada por una nota de crédito que tampoco está cargada (la agarra la
 * familia 2). Las `E001-3` y `E001-4` sí tienen su espejo.
 *
 * ⚠️ El espejo se busca por RUC + importe, NO por número de documento: el
 * espejo se carga a mano y la serie se tipea distinta (es el mismo criterio que
 * ya usa `tieneEspejo` en costo-obra.js). Exigir el número daría falsos
 * positivos en masa.
 */
export function intercompanySinEspejo(movs, { companies = [] } = {}) {
  const vivas = vivos(movs);
  const rucDeEmpresa = new Map(vivos(companies).map(c => [rucLimpio(c.ruc), c]));
  const nombreEmpresa = new Map(vivos(companies).map(c => [c.id, c.name]));

  // Índice de lo que existe del otro lado: empresa + RUC del tercero + importe.
  const existe = new Set();
  for (const m of vivas) {
    const ruc = rucLimpio(m.third_party_ruc);
    if (!ruc) continue;
    existe.add(`${m.company_id}|${ruc}|${abs(m.amount)}|${esVentaMov(m) ? 'v' : 'c'}`);
  }

  const out = [];
  for (const m of vivas) {
    if (!m.is_intercompany) continue;
    const ruc = rucLimpio(m.third_party_ruc);
    const otra = rucDeEmpresa.get(ruc);
    // Marcado intercompany contra alguien que no es del grupo: eso lo dice la
    // familia de importes, acá no (el catálogo manda sobre el flag).
    if (!otra || otra.id === m.company_id) continue;
    const rucPropio = rucLimpio((vivos(companies).find(c => c.id === m.company_id) || {}).ruc);
    if (!rucPropio) continue;
    // El otro lado es el sentido contrario: si esto es una venta, allá es compra.
    const clave = `${otra.id}|${rucPropio}|${abs(m.amount)}|${esVentaMov(m) ? 'c' : 'v'}`;
    if (existe.has(clave)) continue;
    out.push(hallazgo('intercompany', 'intercompany_sin_espejo', m, {
      gravedad: 'alta',
      monto: abs(m.amount),
      titulo: `Falta el otro lado en ${otra.name}`,
      detalle: `${esVentaMov(m) ? 'La venta' : 'La compra'} ${m.document_number || 's/n'} está marcada entre empresas del grupo, pero ${otra.name} no tiene ${esVentaMov(m) ? 'el costo' : 'el ingreso'} de S/ ${abs(m.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}.`,
      empresaEsperada: otra.name,
      empresaPropia: nombreEmpresa.get(m.company_id) || '',
    }));
  }
  return out;
}

// ── 2. NOTAS DE CRÉDITO ───────────────────────────────────────────
/**
 * Dos problemas distintos con el mismo origen:
 *
 * a) HUÉRFANA — una nota de crédito que no apunta a ninguna factura
 *    (`related_movement_id` vacío o apuntando a algo que no existe). No se sabe
 *    qué rebaja, así que ningún reporte la puede aplicar.
 *    MEDIDO: de 18 notas de crédito vivas, varias no tienen el vínculo.
 *
 * b) SIN EFECTO — la factura está anulada por una nota que SÍ cubre su importe,
 *    pero la factura sigue con `payment_status` de viva y sumando. La app la
 *    sigue contando como ingreso o costo.
 *
 * ⚠️ Que una nota tenga la MISMA serie que su factura NO es un error: en SUNAT
 * la numeración corre por tipo de comprobante y JARVEX emite E001 para las dos
 * (es lo que dice `avisoSerieRepetida` y se corrigió en la tanda 10).
 */
export function notasIncoherentes(movs) {
  const vivas = vivos(movs);
  const porId = new Map(vivas.map(m => [m.id, m]));
  const out = [];

  for (const n of vivas) {
    if (!esNotaCredito(n)) continue;
    const destino = n.related_movement_id ? porId.get(n.related_movement_id) : null;
    if (!destino || esNota(destino)) {
      out.push(hallazgo('nota_credito', 'nota_huerfana', n, {
        gravedad: 'media',
        monto: abs(n.amount),
        titulo: 'Nota de crédito sin factura',
        detalle: `La nota ${n.document_number || 's/n'} de ${n.third_party_name || 'un tercero'} no está enlazada a ninguna factura, así que no rebaja nada en los reportes.`,
      }));
    }
  }

  // Facturas anuladas por completo que siguen vivas.
  const notas = notasPorFactura(vivas);
  for (const [facturaId, info] of notas.entries()) {
    if (!info.anulada) continue;
    const f = porId.get(facturaId);
    if (!f) continue;
    if (f.payment_status === 'cancelled') continue;      // ya está dada de baja
    out.push(hallazgo('nota_credito', 'factura_anulada_viva', f, {
      gravedad: 'alta',
      monto: abs(f.amount),
      titulo: 'Factura anulada que sigue contando',
      detalle: `${info.etiqueta}, pero ${f.document_number || 'la factura'} sigue activa por S/ ${abs(f.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })} y suma en los reportes.`,
    }));
  }
  return out;
}

// ── 3. IMPORTES QUE NO CUADRAN SOLOS ──────────────────────────────
/**
 * a) El IGV declarado contra su propia base. SOLO cuando el comprobante trajo
 *    el desglose (`origen === 'comprobante'`): el 18% estimado de
 *    `desglosarIgv` es una suposición de la app y acusar por ella sería acusar
 *    a casi todos los 1.395 movimientos.
 *    Y solo se acusa cuando la tasa no es NINGUNA de las legales: 18% (general),
 *    10% (algunos regímenes) o 0% (exonerado / inafecto / no gravado, que es
 *    como viajan las comisiones del banco).
 *
 * b) Nota de crédito en POSITIVO. MEDIDO: de las 18 notas vivas, 16 están en
 *    negativo y 2 en positivo (las de Despegar, `FN06-41040` y `FN06-41041`).
 *    Una nota en positivo SUMA donde debería restar.
 *
 * c) El mismo comprobante cargado DOS VECES: misma empresa, mismo tipo, misma
 *    serie-correlativo y mismo RUC.
 */
export function importesIncoherentes(movs) {
  const vivas = vivos(movs);
  const out = [];

  for (const m of vivas) {
    // (b) nota de crédito que suma en vez de restar
    if (esNotaCredito(m) && Number(m.amount) > 0) {
      out.push(hallazgo('importes', 'nota_en_positivo', m, {
        gravedad: 'alta',
        monto: abs(m.amount),
        titulo: 'Nota de crédito en positivo',
        detalle: `La nota ${m.document_number || 's/n'} está cargada como +S/ ${abs(m.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}: en vez de rebajar, suma.`,
      }));
    }

    // (a) el IGV contra su propia base, solo si el comprobante lo trajo
    const d = desglosarIgv(m);
    if (d.origen === 'comprobante' && abs(m.amount) > 0) {
      const tasa = d.tasaPct;
      const legal = Math.abs(tasa - 18) <= 1 || Math.abs(tasa - 10) <= 1 || tasa < 0.5;
      if (!legal) {
        out.push(hallazgo('importes', 'igv_fuera_de_tasa', m, {
          gravedad: 'media',
          monto: abs(d.igv),
          titulo: `IGV al ${tasa}%`,
          detalle: `${m.document_number || 'El comprobante'} declara S/ ${abs(d.igv).toLocaleString('es-PE', { minimumFractionDigits: 2 })} de IGV sobre una base de S/ ${abs(d.subtotal).toLocaleString('es-PE', { minimumFractionDigits: 2 })}: ${tasa}%, que no es 18%, 10% ni exonerado.`,
          tasaPct: tasa,
        }));
      }
    }
  }

  // (c) duplicados
  const porLlave = new Map();
  for (const m of vivas) {
    const p = partirDocumento(m.document_number);
    const ruc = rucLimpio(m.third_party_ruc);
    if (!p || !ruc) continue;
    const k = `${m.company_id}|${m.document_type || 'factura'}|${p.serie}|${p.correlativo}|${ruc}`;
    if (!porLlave.has(k)) porLlave.set(k, []);
    porLlave.get(k).push(m);
  }
  for (const grupo of porLlave.values()) {
    if (grupo.length < 2) continue;
    // El primero se deja en paz; los que sobran son los que hay que mirar.
    const [primero, ...resto] = grupo.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    for (const m of resto) {
      out.push(hallazgo('importes', 'comprobante_duplicado', m, {
        gravedad: 'alta',
        monto: abs(m.amount),
        titulo: 'El mismo comprobante, dos veces',
        detalle: `${m.document_number} de ${m.third_party_name || 'este tercero'} está cargado ${grupo.length} veces en la misma empresa${Math.abs(abs(m.amount) - abs(primero.amount)) > TOLERANCIA ? ', y con importes distintos' : ''}.`,
        gemeloId: primero.id,
      }));
    }
  }
  return out;
}

// ── 4. SERIE O NÚMERO IMPOSIBLE ───────────────────────────────────
/**
 * a) `document_number` que no tiene forma de comprobante (sin serie-correlativo).
 *    No se puede cruzar contra SUNAT ni contra nada: es un comprobante ciego.
 *
 * b) Correlativo REPETIDO en lo que EMITE el grupo. Una empresa no puede emitir
 *    dos veces el mismo número en la misma serie — SUNAT lo rechaza.
 *
 * 🔴 Solo se mira en las VENTAS de las empresas propias. En las compras, que
 * dos proveedores distintos tengan F001-1 el mismo mes es lo normal, y una
 * regla que no distinga eso llena la pantalla de nada. Es la misma disciplina
 * de `siguienteComprobante`, que también cuenta solo ventas y por eso funciona.
 */
export function seriesImposibles(movs, { companies = [] } = {}) {
  const vivas = vivos(movs);
  const propias = new Set(vivos(companies).filter(c => c.tipo_entidad !== 'tercero').map(c => c.id));
  const out = [];

  for (const m of vivas) {
    const p = partirDocumento(m.document_number);
    if (!p) {
      out.push(hallazgo('serie', 'documento_sin_forma', m, {
        gravedad: 'baja',
        monto: abs(m.amount),
        titulo: 'Comprobante sin serie ni número',
        detalle: `«${m.document_number || '(vacío)'}» no tiene forma de comprobante (SERIE-NÚMERO), así que no se puede cruzar contra SUNAT.`,
      }));
    } else if (!SERIE_RE.test(p.serie)) {
      out.push(hallazgo('serie', 'serie_invalida', m, {
        gravedad: 'baja',
        monto: abs(m.amount),
        titulo: `La serie «${p.serie}» no existe`,
        detalle: 'Una serie de SUNAT es una letra y tres caracteres (F001, E001, FC01).',
      }));
    }
  }

  // Correlativos repetidos en lo que emite el grupo.
  const emitidos = new Map();
  for (const m of vivas) {
    if (!esVentaMov(m)) continue;
    if (!propias.has(m.company_id)) continue;
    if (m.payment_status === 'cancelled') continue;
    const p = partirDocumento(m.document_number);
    if (!p) continue;
    const k = `${m.company_id}|${m.document_type || 'factura'}|${p.serie}|${p.correlativo}`;
    if (!emitidos.has(k)) emitidos.set(k, []);
    emitidos.get(k).push(m);
  }
  for (const grupo of emitidos.values()) {
    if (grupo.length < 2) continue;
    const [, ...resto] = grupo.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    for (const m of resto) {
      out.push(hallazgo('serie', 'correlativo_repetido', m, {
        gravedad: 'alta',
        monto: abs(m.amount),
        titulo: 'Correlativo emitido dos veces',
        detalle: `Esta empresa tiene ${grupo.length} comprobantes con el número ${m.document_number}. SUNAT no admite el mismo correlativo dos veces en una serie.`,
      }));
    }
  }
  return out;
}

// ── El escáner completo ───────────────────────────────────────────
/**
 * Corre las cuatro familias sobre el universo que se le pase.
 *
 * @param movs       los movimientos a mirar (ya acotados por empresa/periodo si
 *                   la pantalla quiere acotar; la lib no filtra sola)
 * @param opts       { companies, familias }
 */
export function escanear(movs = [], { companies = [], familias = null } = {}) {
  const quiere = (f) => !familias || familias.includes(f);
  const out = [];
  if (quiere('intercompany')) out.push(...intercompanySinEspejo(movs, { companies }));
  if (quiere('nota_credito')) out.push(...notasIncoherentes(movs));
  if (quiere('importes')) out.push(...importesIncoherentes(movs));
  if (quiere('serie')) out.push(...seriesImposibles(movs, { companies }));
  // Lo más grave primero, y a igual gravedad, lo de más plata: es el orden en
  // que conviene atacar una lista que nadie va a terminar de una sentada.
  out.sort((a, b) => (GRAVEDAD[b.gravedad] - GRAVEDAD[a.gravedad]) || (b.monto - a.monto));
  return out;
}

/** Cuántos hay de cada familia y cuánta plata hay atrás. */
export function resumirHallazgos(hallazgos = []) {
  const porFamilia = {}, porGravedad = { alta: 0, media: 0, baja: 0 };
  let monto = 0;
  for (const f of Object.keys(FAMILIAS)) porFamilia[f] = 0;
  for (const h of hallazgos) {
    porFamilia[h.familia] = (porFamilia[h.familia] || 0) + 1;
    porGravedad[h.gravedad] = (porGravedad[h.gravedad] || 0) + 1;
    monto += h.monto || 0;
  }
  return { total: hallazgos.length, porFamilia, porGravedad, monto: r2(monto) };
}

/**
 * Aplica lo ya decidido: un hallazgo marcado «revisado / no aplica» no vuelve.
 * Se busca por el id DERIVADO (`regla:movimiento`), que es estable entre las
 * dos PCs y entre corridas — misma disciplina que la comparativa.
 */
export function aplicarDecisionesEscaner(hallazgos = [], decisiones = []) {
  const porLlave = new Map();
  for (const d of vivos(decisiones)) {
    if (!d.llave) continue;
    const previo = porLlave.get(d.llave);
    if (!previo || String(d.updated_at || '') > String(previo.updated_at || '')) porLlave.set(d.llave, d);
  }
  return hallazgos.map(h => {
    const d = porLlave.get(h.id);
    return d ? { ...h, decision: d.decision, decisionNota: d.nota || '' } : h;
  });
}

export const hallazgosPendientes = (hallazgos = []) => hallazgos.filter(h => !h.decision);
