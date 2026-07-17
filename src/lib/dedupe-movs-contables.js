// Detección y fusión de MOVIMIENTOS CONTABLES duplicados (mismo comprobante
// registrado 2+ veces). Caso real (jul 2026): la misma Factura E001-134 de
// venta INTERCO confirmada dos veces por Captura Mágica — el guard anti-dup
// solo cubría compras. Este módulo detecta los grupos y arma el plan de
// fusión; la ejecución (reasignar hijos + soft-delete) vive en la página.
//
// Identidad de un comprobante:
//  · VENTA:  empresa emisora NUESTRA (company_id) + serie-correlativo.
//  · COMPRA: proveedor (third_party_ruc; fallback nombre) + serie-correlativo.
// El monto NO forma parte de la clave (un OCR pudo leer mal el total de una
// de las copias) — pero se reporta `montosDistintos` para que el usuario
// revise antes de fusionar.
import { normalizarRuc, normalizarComprobante } from './doc-id.js';

export function claseDe(m) {
  return m?.clase || (m?.type === 'income' ? 'venta' : 'compra');
}

// Clave de identidad del comprobante (null = no identificable → no participa).
export function claveComprobante(m) {
  if (!m || m.deleted_at) return null;
  const comp = normalizarComprobante(m.document_number);
  if (!comp) return null;
  const clase = claseDe(m);
  if (clase === 'venta') {
    if (!m.company_id) return null;
    return `venta|${m.company_id}|${comp}`;
  }
  const tercero = normalizarRuc(m.third_party_ruc)
    || String(m.third_party_name || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!tercero) return null;
  return `compra|${tercero}|${comp}`;
}

// Orden del sobreviviente: primero lo ya SINCRONIZADO (existe en el server y
// en los demás dispositivos), luego el más antiguo.
function ordenSobreviviente(a, b) {
  const sa = a.sync_status === 'synced' ? 0 : 1;
  const sb = b.sync_status === 'synced' ? 0 : 1;
  if (sa !== sb) return sa - sb;
  return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

// Devuelve los grupos de duplicados: [{ clave, conservar, duplicados, montosDistintos }].
// `conservar` es el movimiento que sobrevive; `duplicados` los que se fusionan en él.
export function detectarDuplicados(movs) {
  const porClave = new Map();
  for (const m of movs || []) {
    const k = claveComprobante(m);
    if (!k) continue;
    const arr = porClave.get(k) || [];
    arr.push(m);
    porClave.set(k, arr);
  }
  const grupos = [];
  for (const [clave, arr] of porClave) {
    if (arr.length < 2) continue;
    const orden = arr.slice().sort(ordenSobreviviente);
    const montos = new Set(orden.map(m => Number(m.amount) || 0));
    grupos.push({
      clave,
      conservar: orden[0],
      duplicados: orden.slice(1),
      montosDistintos: montos.size > 1,
    });
  }
  // Estable para la UI: por fecha del comprobante, luego clave.
  grupos.sort((a, b) => String(a.conservar.date || '').localeCompare(String(b.conservar.date || '')) || a.clave.localeCompare(b.clave));
  return grupos;
}
