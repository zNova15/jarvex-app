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
import { indexarMovs, origenDelDesglose } from './desglose-heredado.js';
import { itemsDeFactura } from './cruce-recepcion.js';

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
//
// ── LA COMPRA ESPEJO TRAE SU DETALLE (tanda 2, 15-set-2026) ────────
// 🔴 Cuando una empresa del grupo le vende a otra, la app crea sola la COMPRA
// espejo en el libro del comprador, y ese espejo nace A PROPÓSITO sin
// `notas.items_factura` (si los llevara, el almacén del comprador contaría dos
// veces la misma mercadería). En su lugar deja un puntero a la venta de
// origen. Medido el 15-set-2026 en producción: **98 compras espejo, S/ 2,32
// millones, con 290 líneas de insumos y servicios del otro lado**, y NINGUNA
// entraba al inventario de la empresa que las compró. CONSORCIO EL INCA le
// compró a JARVEX 46 herramientas y en su inventario esas herramientas no
// existían: la compra estaba, la mercadería no.
//
// La lib que resuelve el puntero ya existía con sus cuatro guardas y sus tests
// (`desglose-heredado.js`, tanda 15) — la usaban el 👁 y la orden retroactiva,
// y este extractor no. Acá se lee el MISMO puntero: mostrar el detalle de la
// compra espejo no es abrir el libro de otra empresa, es terminar de leer el
// propio comprobante.
//
// 🔴 SE MUESTRA HEREDADO, NO SE COPIA. Igual que en `desglose-heredado.js`,
// esto pasa SOLO EN MEMORIA: el espejo sigue sin ítems propios en la base, que
// es lo que evita el doble conteo en almacén. Y la línea sale marcada
// (`heredadaDe`) porque un detalle prestado no se muestra como si estuviera
// cargado en el comprobante.
//
// 🔴 LO QUE NO SE HEREDA, Y POR QUÉ. Del ítem del otro lado viaja lo que
// describe el BIEN (qué es, cuánto, a qué precio, en qué unidad). NO viaja
// nada que describa lo que hizo el VENDEDOR con él:
//   · `recibido`/`tieneRecepcion` — la recepción se escribe sobre el ítem de
//     la factura de COMPRA del que recibe (cruce-recepcion.js). Heredarla
//     sería decir que el almacén del comprador recibió algo que nunca vio.
//   · `venta_status` ('para_venta'/'vendido') — que el vendedor lo haya dado
//     por vendido es justamente lo que hace que exista esta compra; copiarlo
//     dejaría la mercadería del comprador marcada como ya vendida.
//   · `destino` — a qué obra iba del lado del vendedor no dice nada de la del
//     comprador (para eso está el `obra_id` del propio espejo).
// Hoy ninguno de los 290 ítems trae esos campos (medido), pero se neutralizan
// igual: el día que alguien recepcione o separe para venta del lado del
// vendedor, el dato aparecería solo y en silencio.
//
// 🔴 LA ANULACIÓN VIAJA CON EL DETALLE. Si la venta de origen se deshizo por
// nota de crédito, esa mercadería volvió y no puede quedar en el inventario
// del comprador — la misma regla de la tanda 1, ahora mirando los DOS libros.
// Caso real medido: la venta E001-263 de GASOMI a CONSORCIO SAMADAY
// (S/ 3.109, 3 líneas) está anulada al 100% por la NC E001-64 **y el espejo de
// SAMADAY no tiene NC propia**: sin esta regla, SAMADAY sumaría tres líneas de
// mercadería devuelta. La etiqueta lo dice («…en el libro del vendedor»).
//
// opts.origenes: dónde buscar el comprobante de origen. Por defecto, los
// mismos `movs` — alcanza para las pantallas que ya cargan todo el grupo
// (Análisis de Insumos). Las que filtran por empresa (Detalle de Empresa) TIENEN
// que pasarlo, porque el origen vive por definición en el libro de la otra.
export function extraerLineasDeFacturas(movs, opts = {}) {
  const out = [];
  const demo = !!opts.demo;
  const filas = movs || [];
  const porFactura = opts.notas || notasPorFactura(filas);
  const origenes = opts.origenes || filas;
  const indice = indexarMovs(origenes);
  // El estado de las notas de crédito del OTRO libro, calculado una sola vez y
  // solo si de verdad hay algo que heredar.
  let notasOrigenCache = null;
  const notasDeOrigenes = () => {
    if (origenes === filas) return porFactura;
    if (!notasOrigenCache) notasOrigenCache = notasPorFactura(origenes);
    return notasOrigenCache;
  };
  for (const mv of filas) {
    if (!mv || mv.deleted_at) continue;
    if (!!mv.demo !== demo) continue;
    let notas = mv.notas;
    if (typeof notas === 'string') { try { notas = JSON.parse(notas); } catch { notas = null; } }
    const propios = notas && Array.isArray(notas.items_factura) ? notas.items_factura : null;
    let items = propios;
    let heredadaDe = null, heredadaDeCompanyId = null, ncOrigen = null;
    // Guarda 1 de desglose-heredado.js: si el comprobante tiene ítems propios,
    // mandan los suyos. Siempre.
    if (!propios || !propios.length) {
      const origen = origenDelDesglose(mv, indice);
      if (!origen) continue;
      // El origen tiene que ser del mismo modo: una venta de prueba no puede
      // darle detalle a una compra real, ni al revés.
      if (!!origen.demo !== demo) continue;
      items = itemsDeFactura(origen);
      if (!items.length) continue;
      heredadaDe = origen.id;
      heredadaDeCompanyId = origen.company_id || null;
      ncOrigen = notasDeOrigenes().get(origen.id) || null;
    }
    if (!items) continue;
    const clase = claseDeMov(mv);
    const esNota = ['nota_credito', 'nota_debito'].includes(mv.document_type);
    const nc = porFactura.get(mv.id) || null;
    // La operación se deshizo: las notas cubren la factura entera. Se mira el
    // propio comprobante y —cuando el detalle es prestado— también el de origen.
    const anulada = !!(nc?.anulada || ncOrigen?.anulada);
    // Hay notas, pero NO alcanzan a cubrirla: la factura sigue valiendo,
    // rebajada. No se descarta (sería perder la compra entera por una
    // devolución parcial) — se marca para que la pantalla lo diga.
    const rebajada = !anulada && !!(nc?.parcial || ncOrigen?.parcial);
    const notaEtiqueta = nc ? nc.etiqueta
      : (ncOrigen ? `${ncOrigen.etiqueta} (en el libro del vendedor)` : null);
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
        anulada,
        rebajada,
        notaEtiqueta,
        notaMonto: nc ? nc.totalNotas : (ncOrigen ? ncOrigen.totalNotas : 0),
        // El detalle no es propio: viene de la venta de origen, en el libro de
        // la otra empresa del grupo. La pantalla LO DICE.
        heredadaDe,
        heredadaDeCompanyId,
        proveedorId: mv.proveedor_id || null,
        proveedorNombre: mv.third_party_name || null,
        fecha: mv.date || '',
        precio: Number(it?.precio_unitario) || 0,
        cantidad: Number(it?.cantidad) || 0,
        unidad: it?.unidad || 'und',
        tipoInsumo: it?.tipo_insumo || null,
        categoria: it?.categoria || null,
        // Lo del vendedor no cruza (ver la nota de arriba).
        destino: heredadaDe ? null : (it?.destino || null),   // 'obra' | 'empresa' | 'obra_general'
        ventaStatus: heredadaDe ? null : (it?.venta_status || null), // 'para_venta' | 'vendido'
        recibido: heredadaDe ? 0 : (Number(it?.recibido) || 0),
        tieneRecepcion: !heredadaDe && !!it && Object.prototype.hasOwnProperty.call(it, 'recibido'),
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
