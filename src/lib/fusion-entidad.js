// ═══════════════════════════════════════════════════════════════════
// JARVEX — Fusión de entidades duplicadas (empresas / proveedores).
//
// Cuando dos registros son en realidad el MISMO (mismo RUC, distinto formato/
// nombre) se fusionan: el que QUEDA absorbe todas las referencias del que SE VA
// (re-apunta los FKs), hereda sus campos vacíos, y el que se va queda soft-
// borrado. Análogo a fusionarPersonas pero genérico y sin la complejidad de
// firmas de movimientos (acá solo se re-apuntan punteros).
//
// Personal tiene su propia fusión (fusion-personas.js, con modos de movimientos).
// ═══════════════════════════════════════════════════════════════════

import { db } from '../db/jarvex.db';
import { soloDigitos } from './doc-id.js';

// Config por tipo: tabla, campo de nombre, FKs que la referencian, campos a
// rellenar en el superviviente si los tiene vacíos.
export const FUSION_CONFIG = {
  companies: {
    tabla: 'companies', label: 'empresa', nombreField: 'name', rucField: 'ruc', notaField: 'notas',
    refs: [
      { tabla: 'accounting_movements', campo: 'company_id' },
      { tabla: 'accounting_movements', campo: 'related_company_id' },
      { tabla: 'activos_pesados',      campo: 'company_id' },
      { tabla: 'cronograma_pagos',     campo: 'company_id' },
      { tabla: 'cuentas_bancarias',    campo: 'company_id' },
      { tabla: 'planillas',            campo: 'company_id' },
      { tabla: 'valorizaciones',       campo: 'company_id' },
    ],
    rellenables: ['legal_name', 'ruc', 'rubro', 'direccion', 'regimen_tributario', 'rol_grupo', 'company_type'],
  },
  proveedores: {
    tabla: 'proveedores', label: 'proveedor', nombreField: 'razon_social', rucField: 'ruc', notaField: 'observaciones',
    refs: [
      { tabla: 'accounting_movements',           campo: 'proveedor_id' },
      { tabla: 'cotizaciones',                   campo: 'proveedor_id' },
      { tabla: 'ordenes_compra',                 campo: 'proveedor_id' },
      { tabla: 'movimientos_materiales',         campo: 'proveedor_id' },
      { tabla: 'movimientos_herramientas',       campo: 'proveedor_id' },
      { tabla: 'movimientos_epp',                campo: 'proveedor_id' },
      { tabla: 'movimientos_insumos_emergencia', campo: 'proveedor_id' },
      { tabla: 'movimientos_maquinaria',         campo: 'proveedor_id' },
    ],
    // proveedores NO tiene 'notas' ni 'email' (usa observaciones / contacto).
    rellenables: ['ruc', 'direccion', 'telefono', 'contacto', 'tipo_proveedor'],
  },
};

const bump = (r, extra, userId) => ({
  ...extra,
  updated_at: new Date().toISOString(),
  updated_by: userId || 'offline',
  version: (r.version ?? 0) + 1,
  sync_status: r.sync_status === 'pending_create' ? 'pending_create' : (extra.deleted_at ? 'pending_delete' : 'pending_update'),
});

async function refsDe(tabla, campo, id) {
  try { return await db[tabla].filter(r => r[campo] === id && !r.deleted_at).toArray(); } catch { return []; }
}

/** Preview: cuántas referencias del que se va se re-apuntarían, por tabla/campo. */
export async function previewFusionEntidad(tipo, fromId) {
  const cfg = FUSION_CONFIG[tipo];
  if (!cfg) throw new Error('Tipo de fusión inválido: ' + tipo);
  const detalle = [];
  for (const ref of cfg.refs) {
    const rows = await refsDe(ref.tabla, ref.campo, fromId);
    if (rows.length) detalle.push({ tabla: ref.tabla, campo: ref.campo, n: rows.length });
  }
  return { detalle, total: detalle.reduce((s, d) => s + d.n, 0) };
}

/**
 * Fusiona `fromId` dentro de `toId`. Re-apunta todas las referencias, rellena
 * los campos vacíos del que queda, y soft-borra al que se va.
 * @returns {{reapuntados:number, porTabla:Object}}
 */
export async function fusionarEntidad({ tipo, fromId, toId, userId = null }) {
  const cfg = FUSION_CONFIG[tipo];
  if (!cfg) throw new Error('Tipo de fusión inválido: ' + tipo);
  if (!fromId || !toId || fromId === toId) throw new Error('Elegí dos registros distintos.');
  const from = await db[cfg.tabla].get(fromId);
  const to = await db[cfg.tabla].get(toId);
  if (!from || !to) throw new Error('Registro no encontrado.');

  let reapuntados = 0;
  const porTabla = {};
  for (const ref of cfg.refs) {
    const rows = await refsDe(ref.tabla, ref.campo, fromId);
    for (const r of rows) {
      await db[ref.tabla].update(r.id, bump(r, { [ref.campo]: toId }, userId));
      reapuntados++;
      porTabla[ref.tabla] = (porTabla[ref.tabla] || 0) + 1;
    }
    try { if (rows.length) window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: ref.tabla } })); } catch {}
  }

  // Rellenar campos vacíos del que queda con los del que se va.
  const patch = {};
  for (const k of cfg.rellenables) {
    const vTo = to[k], vFrom = from[k];
    if ((vTo === null || vTo === undefined || vTo === '') && vFrom !== null && vFrom !== undefined && vFrom !== '') patch[k] = vFrom;
  }
  const nombreFrom = from[cfg.nombreField] || fromId;
  const nombreTo = to[cfg.nombreField] || toId;
  const notaField = cfg.notaField;   // 'notas' (companies) | 'observaciones' (proveedores)
  const nota = `Fusión ${new Date().toISOString().slice(0, 10)}: absorbió a "${nombreFrom}" (${from[cfg.rucField] || 's/RUC'})`;
  if (notaField) patch[notaField] = [to[notaField], nota].filter(Boolean).join(' · ');
  await db[cfg.tabla].update(toId, bump(to, patch, userId));

  // El que se va: soft-delete (sus referencias ya apuntan al que queda).
  const patchFrom = { deleted_at: new Date().toISOString() };
  if (notaField) patchFrom[notaField] = [from[notaField], `Fusionado en "${nombreTo}"`].filter(Boolean).join(' · ');
  await db[cfg.tabla].update(fromId, bump(from, patchFrom, userId));

  try { await window.__logAudit?.({ action: 'update', table: cfg.tabla, recordId: toId, reason: `${nota} · ${reapuntados} referencias re-apuntadas` }); } catch {}
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: cfg.tabla } })); } catch {}
  return { reapuntados, porTabla };
}

/**
 * Agrupa registros que comparten el MISMO RUC normalizado (candidatos a fusión).
 * @returns [{ ruc, registros: [...] }] solo grupos con >1.
 */
export function gruposDuplicadosPorRuc(rows, rucField = 'ruc') {
  const m = new Map();
  for (const r of (rows || [])) {
    if (r.deleted_at) continue;
    const ruc = soloDigitos(r[rucField]);
    if (ruc.length < 8) continue;       // ignora vacíos / docs no-RUC
    const a = m.get(ruc) || [];
    a.push(r);
    m.set(ruc, a);
  }
  return [...m.entries()].filter(([, a]) => a.length > 1).map(([ruc, registros]) => ({ ruc, registros }));
}
