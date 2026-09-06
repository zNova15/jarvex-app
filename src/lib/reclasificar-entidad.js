// ═══════════════════════════════════════════════════════════════════
// JARVEX — Qué pasa cuando una empresa cambia de tipo en el catálogo.
//
// EL PEDIDO (Gabriel, 5-sep-2026): «cuando se cambia una empresa del grupo
// hacia tercero, deberíamos también agregarle un aviso de que esto va a
// conllevar a que estos movimientos queden desmarcados, o ya no se van a
// considerar en el consolidado».
//
// DE DÓNDE SALE. CONSORCIO ESPERANZA y CONSORCIO SAMADAY eran obras del grupo
// que terminaron. Al reclasificarlos a 'tercero', 35 comprobantes por
// S/ 214.071 dejaron de eliminarse en el Consolidado y pasaron a contar como
// venta externa. Eso es CORRECTO —dejaron de ser del grupo— pero pasó en
// silencio: nadie vio el número moverse ni supo que se había movido.
//
// El catálogo manda sobre el flag `is_intercompany` de cada factura (regla de
// consolidado.js, decidida el 3-sep). Es decir: este selector de una sola
// línea reclasifica plata. Merece decir cuánta ANTES de guardar.
//
// ── LO QUE ESTA LIBRERÍA NO HACE ──────────────────────────────────
// No toca ningún movimiento. Cambiar `tipo_entidad` ya alcanza: el Consolidado
// lee el catálogo en cada cálculo. Desmarcar el `is_intercompany` de las
// facturas sería un cambio de datos innecesario —y peligroso, porque ese flag
// SÍ manda cuando la contraparte no está identificada en el catálogo—.
//
// Puro: sin React, sin Dexie.
// ═══════════════════════════════════════════════════════════════════

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const esPEN = (m) => (m.currency || 'PEN') === 'PEN';

/** ¿El movimiento tiene a esta empresa como contraparte? (id o RUC). */
function apuntaA(mov, companyId, ruc) {
  if (mov.related_company_id && mov.related_company_id === companyId) return true;
  const r = String(ruc || '').trim();
  return !!(r && String(mov.third_party_ruc || '').trim() === r);
}

/**
 * Impacto de reclasificar una entidad del catálogo.
 *
 * @returns {{
 *   cambia: boolean, desde: string, hacia: string,
 *   salenDelConsolidado: number, entranAlConsolidado: number,
 *   soles: number, dolares: number, docs: string[]
 * }}
 */
export function impactoDeReclasificar({ company, tipoNuevo, movs = [] } = {}) {
  const desde = company?.tipo_entidad || 'propia';
  const hacia = tipoNuevo || 'propia';
  const base = { cambia: desde !== hacia, desde, hacia, salenDelConsolidado: 0, entranAlConsolidado: 0, soles: 0, dolares: 0, docs: [] };
  if (!company || desde === hacia) return base;

  // Solo importan los movimientos MARCADOS como internos contra esta entidad:
  // son los únicos cuyo tratamiento depende de si está dentro o fuera.
  const afectados = vivos(movs).filter(m => m.is_intercompany === true && apuntaA(m, company.id, company.ruc));
  if (!afectados.length) return base;

  const saleDelGrupo = desde !== 'tercero' && hacia === 'tercero';
  const entraAlGrupo = desde === 'tercero' && hacia !== 'tercero';
  if (!saleDelGrupo && !entraAlGrupo) return base;   // propia ↔ consorcio: los dos están dentro

  for (const m of afectados) {
    if (esPEN(m)) base.soles += Number(m.amount || 0); else base.dolares += Number(m.amount || 0);
    if (m.document_number) base.docs.push(m.document_number);
  }
  if (saleDelGrupo) base.salenDelConsolidado = afectados.length;
  else base.entranAlConsolidado = afectados.length;
  return base;
}

/** El aviso a mostrar antes de guardar, o null si no hace falta avisar nada. */
export function avisoDeReclasificacion(impacto, nombre = 'esta entidad') {
  if (!impacto?.cambia) return null;
  const n = impacto.salenDelConsolidado || impacto.entranAlConsolidado;
  if (!n) return null;
  const plata = [
    impacto.soles ? `S/ ${impacto.soles.toLocaleString('es-PE', { minimumFractionDigits: 2 })}` : null,
    impacto.dolares ? `US$ ${impacto.dolares.toLocaleString('es-PE', { minimumFractionDigits: 2 })}` : null,
  ].filter(Boolean).join(' + ');

  if (impacto.salenDelConsolidado) {
    return `${nombre} pasa a ser un TERCERO: deja de ser parte del grupo.\n\n`
      + `${n} comprobante(s) por ${plata} que hoy se ELIMINAN como operación interna van a pasar a contar como operación con alguien de AFUERA.\n\n`
      + `El Consolidado del grupo va a cambiar. Es lo correcto si esa entidad ya no es del grupo — pero el número se mueve.`;
  }
  return `${nombre} entra al GRUPO.\n\n`
    + `${n} comprobante(s) por ${plata} que hoy cuentan como operación externa van a pasar a ELIMINARSE contra su espejo interno.\n\n`
    + `El Consolidado del grupo va a cambiar.`;
}

export default { impactoDeReclasificar, avisoDeReclasificacion };
