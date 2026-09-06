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
// ── Y POR QUÉ SÍ SE DESMARCAN LAS FACTURAS (Gabriel, 5-sep) ───────
// «Si una entidad que era parte de nuestro grupo pasa a ser tercero, ya no
// sería una operación intercompany, ya que intercompany sería DENTRO de las
// empresas del grupo.» Es la definición, y el dato tiene que respetarla.
//
// El Consolidado ya daba el número correcto sin esto (el catálogo manda sobre
// el flag), pero el flag quedaba MINTIENDO en la fila: una venta a alguien de
// afuera decía «operación entre empresas del grupo». Y eso se notaba en otras
// pantallas — el Dashboard Ejecutivo excluye los intercompany de sus ingresos,
// así que esas ventas reales no sumaban ahí aunque el Consolidado sí las
// contara. Dos pantallas en desacuerdo por un flag viejo.
//
// Por eso reclasificar a 'tercero' ahora DESMARCA las facturas afectadas.
// Solo se desmarcan las que apuntan a esa entidad: el flag sigue mandando
// cuando la contraparte no está identificada en el catálogo.
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

/**
 * Los movimientos que hay que DESMARCAR cuando la entidad sale del grupo.
 * Devuelve solo ids: quien los escribe decide cómo (Dexie, SQL, lo que sea).
 */
export function movimientosADesmarcar({ company, tipoNuevo, movs = [] } = {}) {
  const desde = company?.tipo_entidad || 'propia';
  if (!company || desde === 'tercero' || tipoNuevo !== 'tercero') return [];
  return vivos(movs)
    .filter(m => m.is_intercompany === true && apuntaA(m, company.id, company.ruc))
    .map(m => m.id);
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
      + `${n} comprobante(s) por ${plata} van a DEJAR DE ESTAR MARCADOS como "operación entre empresas del grupo", porque ya no lo son.\n\n`
      + `Pasan a contar como operación con alguien de afuera: salen de "Operaciones entre empresas" y empiezan a sumar en el Dashboard Ejecutivo. `
      + `No se borra ni se modifica ningún importe.`;
  }
  return `${nombre} entra al GRUPO.\n\n`
    + `${n} comprobante(s) por ${plata} que hoy cuentan como operación externa van a pasar a ELIMINARSE contra su espejo interno.\n\n`
    + `El Consolidado del grupo va a cambiar.`;
}

export default { impactoDeReclasificar, movimientosADesmarcar, avisoDeReclasificacion };
