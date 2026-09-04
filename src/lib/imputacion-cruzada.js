// ═══════════════════════════════════════════════════════════════════
// JARVEX — Imputación cruzada (tanda 4, A3).
//
// Un comprobante con `obra_id` puesto, cuya CONTRAPARTE (`related_company_id`,
// o por RUC de `third_party_ruc`) es un consorcio o tercero del catálogo que
// NO tiene nada que ver con esa obra — ni es su titular contable ni uno de
// sus socios.
//
// Medido contra producción (4-sep-2026): 17 comprobantes imputados a
// Miraflores, facturados a CONSORCIO CHUSAAC (el titular de San Marcos, OTRA
// obra), CONSORCIO ESPERANZA y CONSORCIO SAMADAY (terceros puros, sin obra).
// Los 17 son ventas, pero la regla NO se restringe a eso a propósito: una
// compra imputada a la obra equivocada es el mismo error, del otro lado.
// (Verificado: sobre TODA la base, la regla da exactamente 17 — cero falsos
// positivos del lado de compras.)
//
// Se excluyen del cruce las companies tipo_entidad='propia': una empresa del
// grupo facturándole a otra empresa del grupo es la cadena intercompany
// normal (GASOMI→JHEENSEG, S/912.646, ninguna de las dos es 'consorcio' ni
// 'tercero'), no un cruce de obra.
//
// NO decide qué está bien: solo señala. Reimputar a la obra correcta, o
// sacarle el obra_id si es del grupo, lo hace un humano — la pantalla no
// corrige nada sola.
//
// Puro: sin React, sin Dexie.
// ═══════════════════════════════════════════════════════════════════

import { rucLimpio } from './documento-dos-lados.js';
import { titularContableDeObra, sociosDeObra } from './consorcio.js';

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);

/** Companies del catálogo relevantes para el cruce: solo consorcio y tercero. */
function catalogoRelevante(companies) {
  return vivos(companies).filter(c => c.tipo_entidad === 'consorcio' || c.tipo_entidad === 'tercero');
}

/** La company del catálogo que es "la otra parte" de este movimiento, si hay alguna. */
function contraparteDe(mov, porId, porRuc) {
  if (mov.related_company_id && porId.has(mov.related_company_id)) return porId.get(mov.related_company_id);
  const ruc = rucLimpio(mov.third_party_ruc);
  if (ruc && porRuc.has(ruc)) return porRuc.get(ruc);
  return null;
}

/**
 * Comprobantes cuya contraparte es un consorcio/tercero SIN relación con la
 * obra a la que están imputados.
 *
 * @returns Map<movId, { mov, contraparte, obra }>
 */
export function comprobantesImputacionCruzada({ movs, companies, obras, consorcios, socios } = {}) {
  const catalogo = catalogoRelevante(companies);
  const porId = new Map(catalogo.map(c => [c.id, c]));
  const porRuc = new Map();
  for (const c of catalogo) {
    const ruc = rucLimpio(c.ruc);
    // Dos companies con el mismo RUC (duplicados): gana la primera, no
    // inventamos desambiguación — mismo criterio que indiceEmpresas().
    if (ruc && !porRuc.has(ruc)) porRuc.set(ruc, c);
  }
  const obrasPorId = new Map(vivos(obras).map(o => [o.id, o]));

  const out = new Map();
  for (const m of vivos(movs)) {
    if (!m || !m.obra_id) continue;
    const contraparte = contraparteDe(m, porId, porRuc);
    if (!contraparte) continue;
    const obra = obrasPorId.get(m.obra_id);
    if (!obra) continue; // obra borrada o desconocida: no hay con qué comparar
    const titular = titularContableDeObra(obra, consorcios);
    if (contraparte.id === titular) continue; // es su propio titular: normal
    const esSocio = sociosDeObra(obra, consorcios, socios).some(s => s.company_id === contraparte.id);
    if (esSocio) continue;
    out.set(m.id, { mov: m, contraparte, obra });
  }
  return out;
}

/** Solo los ids, para un filtro rápido (`.has(id)`) en la grilla de movimientos. */
export function idsImputacionCruzada(params) {
  return new Set(comprobantesImputacionCruzada(params).keys());
}
