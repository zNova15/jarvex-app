// ═══════════════════════════════════════════════════════════════════
// JARVEX — Análisis de compras por insumo (mejora 1b/1c, sep-2026). Lib PURA.
//
// Extrae cada línea comprada desde los movimientos contables (las facturas de
// Captura Mágica persisten sus ítems en notas.items_factura) y las agrupa por
// insumo usando los grupos de correlación confirmados por el admin. Con eso el
// panel responde: qué proveedores vendieron este insumo (con sus variantes de
// nombre), a qué precio cada vez, y cómo evolucionó. Todo RETROACTIVO: no
// necesita migración ni toca Captura Mágica.
// ═══════════════════════════════════════════════════════════════════
import { normInsumo, claveGrupoDe } from './insumo-correlacion.js';
import { notasPorFactura } from './notas-credito.js';

// Clase efectiva de un movimiento. `clase` manda; `type` es el fallback de las
// filas viejas que nunca la tuvieron (22 en producción al 31-ago-2026). Es el
// criterio canónico del repo (insumos-venta.js, jx-compras-categoria.jsx) —
// mirar solo `type` se equivocaría con una venta registrada como 'cost'.
export const claseDeMov = (mv) => mv?.clase || (mv?.type === 'income' ? 'venta' : 'compra');

// TODAS las líneas de factura (compras Y ventas, con precio o sin él), con el
// contexto del movimiento padre. Es el extractor base: el comparador de precios
// (extraerComprasDeFacturas) y el inventario por empresa (inventario-empresa.js)
// filtran sobre esto — un solo lugar que parsea notas.items_factura[].
// movs: filas de accounting_movements (notas puede ser objeto o string JSON).
// opts.demo espeja el modo prueba (el hook ya entrega solo filas del modo
// activo; este flag mantiene la lib coherente cuando se le pasan filas crudas).
//
// ── LA FACTURA ANULADA POR NOTA DE CRÉDITO (tanda 1, 15-set-2026) ──
// 🔴 Cada línea sale sabiendo si su factura se DESHIZO. Medido el 15-set en
// producción: 21 facturas están cubiertas al 100% por su nota de crédito y las
// 21 siguen vivas —en toda la base hay CERO movimientos con
// `payment_status='cancelled'`, que hasta hoy era el único flag que sacaba una
// línea del inventario—. Esas 21 aportaban 86 líneas a un inventario de
// mercadería que nunca entró: 32 en GASOMI, 20 en JARVEX, 17 en NAMORA.
//
// Gabriel, 15-set-2026: «si una factura se llega a anular con una nota de
// crédito, quiere decir que los insumos de dicha factura dejan de existir
// también en nuestro inventario».
//
// Se calcula ACÁ y no en cada pantalla por la misma razón que todo lo demás de
// este archivo: un solo lugar que mira `items_factura` y un solo criterio de
// qué línea cuenta. `notasPorFactura` es la MISMA función que usa el escáner
// para su aviso `factura_anulada_viva` — el inventario y el escáner no pueden
// contar dos historias distintas de la misma factura.
//
// 🔴 ANULAR NO ES BORRAR. La línea sale igual, marcada: quien quiera contarla
// (el escáner, un histórico) la tiene, y quien suma inventario la descarta por
// `anulada`. Filtrarla acá dejaría al escáner sin nada que avisar.
//
// opts.notas permite inyectar el mapa ya calculado (evita recorrer los
// movimientos dos veces cuando el llamador ya lo tiene).
export function extraerLineasDeFacturas(movs, opts = {}) {
  const out = [];
  const demo = !!opts.demo;
  const porFactura = opts.notas || notasPorFactura(movs || []);
  for (const mv of (movs || [])) {
    if (!mv || mv.deleted_at) continue;
    if (!!mv.demo !== demo) continue;
    let notas = mv.notas;
    if (typeof notas === 'string') { try { notas = JSON.parse(notas); } catch { continue; } }
    const items = notas && Array.isArray(notas.items_factura) ? notas.items_factura : null;
    if (!items) continue;
    const clase = claseDeMov(mv);
    const esNota = ['nota_credito', 'nota_debito'].includes(mv.document_type);
    const nc = porFactura.get(mv.id) || null;
    items.forEach((it, idx) => {
      const nombre = String(it?.descripcion || '').trim();
      if (!nombre) return;
      out.push({
        nombre,
        nombreNorm: normInsumo(nombre),
        clase,                                   // 'compra' | 'venta'
        esNota,                                  // NC/ND: resta, no suma
        companyId: mv.company_id || null,
        obraId: mv.obra_id || null,
        interco: !!mv.is_intercompany,
        cancelado: mv.payment_status === 'cancelled',
        // La operación se deshizo: las notas cubren la factura entera.
        anulada: !!nc?.anulada,
        // Hay notas, pero NO alcanzan a cubrirla: la factura sigue valiendo,
        // rebajada. No se descarta (sería perder la compra entera por una
        // devolución parcial) — se marca para que la pantalla lo diga.
        rebajada: !!nc?.parcial,
        notaEtiqueta: nc ? nc.etiqueta : null,
        notaMonto: nc ? nc.totalNotas : 0,
        proveedorId: mv.proveedor_id || null,
        proveedorNombre: mv.third_party_name || null,
        fecha: mv.date || '',
        precio: Number(it?.precio_unitario) || 0,
        cantidad: Number(it?.cantidad) || 0,
        unidad: it?.unidad || 'und',
        tipoInsumo: it?.tipo_insumo || null,
        categoria: it?.categoria || null,
        destino: it?.destino || null,            // 'obra' | 'empresa' | 'obra_general'
        ventaStatus: it?.venta_status || null,   // 'para_venta' | 'vendido'
        recibido: Number(it?.recibido) || 0,
        tieneRecepcion: !!it && Object.prototype.hasOwnProperty.call(it, 'recibido'),
        moneda: mv.currency || 'PEN',
        doc: mv.document_number || '',
        movId: mv.id,
        itemIdx: idx,
      });
    });
  }
  return out;
}

// Solo las líneas COMPRADAS y con precio (lo que compara el panel de precios).
// Las VENTAS (third_party_name sería el CLIENTE) y las notas de crédito/débito
// (ítems con precio positivo pero que restan) distorsionarían el "más barato"
// — hallazgo de la revisión adversarial.
//
// 🔴 Y las ANULADAS tampoco (tanda 1): una compra que se deshizo por nota de
// crédito no es un precio de mercado. Dejarla adentro le pone al gerente un
// "más barato" que nadie le puede volver a vender —y, peor, arrastra al
// proveedor entero al comparador por una operación que no existió—.
// Las CANCELADAS ya estaban fuera del inventario por `l.cancelado`, pero acá
// nunca se habían filtrado: entraban al comparador igual.
export function extraerComprasDeFacturas(movs, opts = {}) {
  return extraerLineasDeFacturas(movs, opts)
    .filter(l => l.clase === 'compra' && !l.esNota && !l.anulada && !l.cancelado && l.precio > 0);
}

// Agrupa las compras por insumo (clave = grupo de correlación, o el nombre
// normalizado si está suelto) y dentro por proveedor.
// → Map(clave → { clave, display, variantes:[nombres crudos], compras:[...],
//     porProveedor: Map(provKey → {proveedorId, proveedorNombre, veces,
//       ultimoPrecio, ultimaFecha, minPrecio, maxPrecio, unidades:Set, monedas:Set}) })
export function agruparComprasPorInsumo(compras, grupoDe, grupos) {
  const porInsumo = new Map();
  for (const c of (compras || [])) {
    const clave = claveGrupoDe(c.nombre, grupoDe);
    if (!porInsumo.has(clave)) {
      const g = grupos && grupos.get(clave);
      porInsumo.set(clave, {
        clave,
        display: (g && g.canonico) || c.nombre,
        variantes: new Set(),
        compras: [],
        porProveedor: new Map(),
      });
    }
    const ins = porInsumo.get(clave);
    ins.variantes.add(c.nombre);
    ins.compras.push(c);
    const provKey = c.proveedorId || `s/n:${c.proveedorNombre || '¿?'}`;
    if (!ins.porProveedor.has(provKey)) {
      ins.porProveedor.set(provKey, {
        proveedorId: c.proveedorId, proveedorNombre: c.proveedorNombre || '(sin proveedor)',
        veces: 0, ultimoPrecio: null, ultimaFecha: '', minPrecio: null, maxPrecio: null,
        unidades: new Set(), monedas: new Set(),
      });
    }
    const pv = ins.porProveedor.get(provKey);
    pv.veces++;
    pv.unidades.add(c.unidad);
    pv.monedas.add(c.moneda);
    if (c.fecha >= pv.ultimaFecha) { pv.ultimaFecha = c.fecha; pv.ultimoPrecio = c.precio; }
    pv.minPrecio = pv.minPrecio == null ? c.precio : Math.min(pv.minPrecio, c.precio);
    pv.maxPrecio = pv.maxPrecio == null ? c.precio : Math.max(pv.maxPrecio, c.precio);
  }
  for (const ins of porInsumo.values()) {
    ins.variantes = [...ins.variantes].sort();
    ins.compras.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  }
  return porInsumo;
}

// El "más barato" comparable: entre proveedores con la MISMA moneda y (si se
// conoce) la misma unidad. Si hay mezcla de monedas/unidades se devuelve null
// (comparar S/ con US$ o bolsas con kg sería mentirle al gerente).
export function proveedorMasBarato(insumo) {
  const provs = [...(insumo?.porProveedor?.values() || [])].filter(p => p.ultimoPrecio != null);
  if (provs.length < 2) return null;
  const monedas = new Set(provs.flatMap(p => [...p.monedas]));
  const unidades = new Set(provs.flatMap(p => [...p.unidades]));
  if (monedas.size > 1 || unidades.size > 1) return null;
  return provs.reduce((m, p) => (p.ultimoPrecio < m.ultimoPrecio ? p : m));
}

// Serie para el gráfico: [{fecha, precio, proveedorNombre}] cronológica.
export function seriePrecios(insumo) {
  return (insumo?.compras || []).map(c => ({
    fecha: c.fecha, precio: c.precio, proveedorNombre: c.proveedorNombre || '(sin proveedor)', moneda: c.moneda,
  }));
}
