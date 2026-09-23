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
//
// ── 🔴 LA SEGUNDA LLAVE: EL MISMO PAPEL CON OTRO RUC (23-set-2026) ──
// Una asistente de contabilidad encontró facturas duplicadas de PACÍFICO
// SEGUROS en el Registro de Compras y Ventas de GASOMI. Medido contra la base
// de producción, la causa NO fue Captura Mágica dejando pasar una re-subida:
// fue que la llave de arriba lleva el RUC.
//
//   F087-1234177 · 26-feb-2026 · S/ 254,28 · RUC 20332970411  (cargada 13-set)
//   F087-1234177 · 26-feb-2026 · S/ 254,28 · RUC 20418896915  (cargada 13-ago)
//
// 20332970411 ES Pacífico. 20418896915 es MAPFRE — o sea, la copia de agosto
// tiene el RUC de otra aseguradora. Dos RUC distintos = dos claves distintas =
// el guard de Captura Mágica no rebota la segunda carga y este detector no la
// ve. Lo mismo en F087-1278273, F087-1296585 y F087-1328120: cuatro pares.
//
// Por eso hay una SEGUNDA llave que NO mira el RUC. Para poder ignorarlo sin
// inventar duplicados, exige mucho más a cambio: misma empresa, mismo lado,
// mismo comprobante, MISMA FECHA, MISMO IMPORTE, misma moneda y la misma
// familia de documento (una nota nunca duplica a una factura). Esa exigencia
// no es decorativa — barriendo la base entera, «mismo número de comprobante»
// a secas daba 34 grupos y 29 eran falsos: E001-1, E001-2… de proveedores
// distintos, que es la numeración más común del país. Con fecha e importe
// quedan los 5 duplicados reales y ninguno de los 29 falsos.
//
// Cuando el grupo se armó por esta segunda llave, `rucsDistintos` es true y la
// pantalla NO elige por sí sola cuál se conserva: no hay forma de saber desde
// acá cuál de los dos RUC es el bueno, y quedarse con el equivocado es peor
// que no fusionar. La elección es de quien mira el PDF.
import { normalizarRuc, normalizarComprobante } from './doc-id.js';

/** Dos importes son el mismo si difieren en menos de un centavo largo. */
const TOL = 0.05;

export function claseDe(m) {
  return m?.clase || (m?.type === 'income' ? 'venta' : 'compra');
}

/** `factura` y `boleta` se duplican entre sí; una nota solo duplica a una nota. */
export function familiaDocumento(m) {
  const t = String(m?.document_type || 'factura').toLowerCase();
  return (t === 'nota_credito' || t === 'nota_debito') ? t : 'comprobante';
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

/**
 * La segunda llave: el MISMO papel aunque el RUC esté mal cargado.
 *
 * No mira el RUC y por eso exige todo lo demás: empresa, lado, familia de
 * documento, comprobante, fecha, importe (redondeado al centavo, en valor
 * absoluto) y moneda. Sin fecha o sin importe devuelve null — sin esos dos no
 * queda nada que sostenga la identidad y volvería a agrupar todas las E001-1
 * del país.
 */
export function claveSinRuc(m) {
  if (!m || m.deleted_at) return null;
  const comp = normalizarComprobante(m.document_number);
  if (!comp) return null;
  const fecha = String(m.date || '').slice(0, 10);
  if (!fecha) return null;
  const monto = Number(m.amount);
  if (!Number.isFinite(monto) || Math.abs(monto) < TOL) return null;
  const empresa = m.company_id || '';
  if (!empresa) return null;
  const moneda = String(m.currency || 'PEN').trim().toUpperCase();
  const importe = Math.abs(Math.round(monto * 100) / 100).toFixed(2);
  return `sinruc|${claseDe(m)}|${empresa}|${familiaDocumento(m)}|${comp}|${fecha}|${importe}|${moneda}`;
}

// Orden del sobreviviente: primero lo ya SINCRONIZADO (existe en el server y
// en los demás dispositivos), luego el más antiguo.
function ordenSobreviviente(a, b) {
  const sa = a.sync_status === 'synced' ? 0 : 1;
  const sb = b.sync_status === 'synced' ? 0 : 1;
  if (sa !== sb) return sa - sb;
  return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

/** Union-find chiquito: une los movimientos que comparten CUALQUIERA de las dos llaves. */
function unir(movs) {
  const padre = new Map();
  const raiz = (x) => {
    while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x); }
    return x;
  };
  const juntar = (a, b) => { const ra = raiz(a), rb = raiz(b); if (ra !== rb) padre.set(ra, rb); };

  for (const m of movs) padre.set(m.id, m.id);
  for (const clave of [claveComprobante, claveSinRuc]) {
    const primero = new Map();
    for (const m of movs) {
      const k = clave(m);
      if (!k) continue;
      if (primero.has(k)) juntar(m.id, primero.get(k));
      else primero.set(k, m.id);
    }
  }
  const componentes = new Map();
  for (const m of movs) {
    const r = raiz(m.id);
    if (!componentes.has(r)) componentes.set(r, []);
    componentes.get(r).push(m);
  }
  return componentes;
}

/** Arma el objeto de grupo a partir de sus miembros, con `conservar` ya elegido. */
function armarGrupo(clave, miembros) {
  const orden = miembros.slice().sort(ordenSobreviviente);
  const montos = new Set(orden.map(m => Math.round((Number(m.amount) || 0) * 100)));
  const rucs = [...new Set(orden.map(m => normalizarRuc(m.third_party_ruc)).filter(Boolean))];
  return {
    clave,
    miembros: orden,
    conservar: orden[0],
    duplicados: orden.slice(1),
    montosDistintos: montos.size > 1,
    // El grupo se sostiene solo por la llave sin RUC: nadie puede decir desde
    // acá cuál de los dos RUC es el correcto.
    rucsDistintos: rucs.length > 1,
    rucs,
  };
}

/**
 * Devuelve los grupos de duplicados.
 * `conservar` es el movimiento que sobrevive por defecto; `duplicados` los que
 * se fusionan en él. Cuando `rucsDistintos` es true, ese defecto es solo un
 * orden de lista: la pantalla tiene que hacer elegir antes de fusionar.
 */
export function detectarDuplicados(movs) {
  const vivos = (movs || []).filter(m => m && !m.deleted_at && (claveComprobante(m) || claveSinRuc(m)));
  const grupos = [];
  for (const [raiz, miembros] of unir(vivos)) {
    if (miembros.length < 2) continue;
    grupos.push(armarGrupo(claveComprobante(miembros[0]) || claveSinRuc(miembros[0]) || raiz, miembros));
  }
  // Estable para la UI: por fecha del comprobante, luego clave.
  grupos.sort((a, b) =>
    String(a.conservar.date || '').localeCompare(String(b.conservar.date || ''))
    || String(a.clave).localeCompare(String(b.clave)));
  return grupos;
}

/**
 * Cambia cuál miembro del grupo se conserva. Devuelve un grupo NUEVO (no muta):
 * el panel lo usa para el radio de «¿cuál queda?» y después le pasa ese mismo
 * objeto al fusionador, así lo que se fusiona es exactamente lo que se eligió.
 */
export function elegirConservado(grupo, id) {
  if (!grupo || !Array.isArray(grupo.miembros)) return grupo;
  const elegido = grupo.miembros.find(m => m.id === id);
  if (!elegido) return grupo;
  return { ...grupo, conservar: elegido, duplicados: grupo.miembros.filter(m => m.id !== id) };
}
