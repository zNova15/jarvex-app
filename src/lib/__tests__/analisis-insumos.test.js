import { describe, it, expect } from 'vitest';
import { extraerComprasDeFacturas, extraerLineasDeFacturas, agruparComprasPorInsumo, proveedorMasBarato, seriePrecios } from '../analisis-insumos';
import { resolverPares, construirGrupos } from '../insumo-correlacion';

const MOVS = [
  {
    id: 'm1', date: '2026-07-10', currency: 'PEN', proveedor_id: 'p1', third_party_name: 'FERRETERIA A',
    document_number: 'F001-100',
    notas: JSON.stringify({ items_factura: [
      { descripcion: 'Clavo 8 pulg', unidad: 'kg', cantidad: 10, precio_unitario: 6.5 },
      { descripcion: 'Arena gruesa', unidad: 'm3', cantidad: 2, precio_unitario: 55 },
      { descripcion: 'Ítem sin precio', unidad: 'und', cantidad: 1, precio_unitario: 0 },
    ] }),
  },
  {
    id: 'm2', date: '2026-08-20', currency: 'PEN', proveedor_id: 'p2', third_party_name: 'FERRETERIA B',
    document_number: 'F002-200',
    notas: { items_factura: [{ descripcion: "Clavos de 8''", unidad: 'kg', cantidad: 5, precio_unitario: 5.9 }] },
  },
  { id: 'm3', date: '2026-08-21', currency: 'PEN', demo: true, notas: { items_factura: [{ descripcion: 'Clavo 8 pulg', cantidad: 1, precio_unitario: 9 }] } },
  { id: 'm4', date: '2026-08-22', currency: 'PEN', notas: 'json roto {{{' },
  // VENTA y NOTA DE CRÉDITO: llevan items_factura pero NO son compras.
  { id: 'm5', date: '2026-08-23', currency: 'PEN', type: 'income', third_party_name: 'CLIENTE X', notas: { items_factura: [{ descripcion: 'Clavo 8 pulg', cantidad: 1, precio_unitario: 99 }] } },
  { id: 'm6', date: '2026-08-24', currency: 'PEN', document_type: 'nota_credito', notas: { items_factura: [{ descripcion: 'Clavo 8 pulg', cantidad: 1, precio_unitario: 6.5 }] } },
];

describe('extraerComprasDeFacturas', () => {
  it('extrae líneas con precio, parsea notas string u objeto, salta demo/ventas/NC y JSON roto', () => {
    const compras = extraerComprasDeFacturas(MOVS);
    expect(compras.length).toBe(3);   // 2 de m1 (sin el precio 0) + 1 de m2
    expect(compras[0]).toMatchObject({ nombre: 'Clavo 8 pulg', proveedorId: 'p1', moneda: 'PEN', doc: 'F001-100' });
  });

  it('en modo prueba (opts.demo) entrega SOLO las filas demo — el panel funciona para entrenar', () => {
    const compras = extraerComprasDeFacturas(MOVS, { demo: true });
    expect(compras.length).toBe(1);
    expect(compras[0].movId).toBe('m3');
  });
});

describe('extraerLineasDeFacturas (base del inventario por empresa)', () => {
  it('devuelve TODAS las líneas —ventas, NC y sin precio incluidas— marcadas', () => {
    const lineas = extraerLineasDeFacturas(MOVS);
    expect(lineas.length).toBe(6);   // 3 de m1 (con la de precio 0) + m2 + venta + NC
    const venta = lineas.find(l => l.movId === 'm5');
    expect(venta).toMatchObject({ clase: 'venta', esNota: false });
    expect(lineas.find(l => l.movId === 'm6')).toMatchObject({ clase: 'compra', esNota: true });
    expect(lineas.filter(l => l.precio === 0)).toHaveLength(1);
  });

  it('la clase sale de `clase` y cae a `type` solo si falta (filas viejas)', () => {
    const movs = [
      { id: 'a', clase: 'venta', type: 'cost', notas: { items_factura: [{ descripcion: 'X', cantidad: 1, precio_unitario: 1 }] } },
      { id: 'b', type: 'cost', notas: { items_factura: [{ descripcion: 'Y', cantidad: 1, precio_unitario: 1 }] } },
    ];
    const lineas = extraerLineasDeFacturas(movs);
    expect(lineas.map(l => l.clase)).toEqual(['venta', 'compra']);
    // …y por eso esa venta mal tipada NO contamina el comparador de precios.
    expect(extraerComprasDeFacturas(movs).map(l => l.nombre)).toEqual(['Y']);
  });
});

describe('agruparComprasPorInsumo + proveedorMasBarato', () => {
  const compras = extraerComprasDeFacturas(MOVS);
  const resueltos = resolverPares([
    { relacion: 'mismo', nombre_a: 'Clavo 8 pulg', nombre_b: "Clavos de 8''", fuente: 'manual', updated_at: '1', canonico: 'Clavo de 8"' },
  ]);
  const { grupoDe, grupos } = construirGrupos(resueltos);

  it('las dos variantes confirmadas caen en el MISMO grupo, cada proveedor con sus números', () => {
    const porInsumo = agruparComprasPorInsumo(compras, grupoDe, grupos);
    const clavos = [...porInsumo.values()].find(i => i.display === 'Clavo de 8"');
    expect(clavos).toBeDefined();
    expect(clavos.variantes).toEqual(['Clavo 8 pulg', "Clavos de 8''"]);
    expect(clavos.porProveedor.size).toBe(2);
    const b = clavos.porProveedor.get('p2');
    expect(b.ultimoPrecio).toBe(5.9);
    const masBarato = proveedorMasBarato(clavos);
    expect(masBarato.proveedorNombre).toBe('FERRETERIA B');
  });

  it('sin correlación confirmada, cada nombre es su propio insumo', () => {
    const porInsumo = agruparComprasPorInsumo(compras, new Map(), new Map());
    expect([...porInsumo.keys()]).toContain('clavo 8 pulg');
    expect([...porInsumo.keys()]).toContain('clavos de 8');
  });

  it('no declara "más barato" si las monedas o unidades difieren', () => {
    const mezcla = agruparComprasPorInsumo(extraerComprasDeFacturas([
      MOVS[0],
      { ...MOVS[1], currency: 'USD' },
    ]), grupoDe, grupos);
    const clavos = [...mezcla.values()].find(i => i.display === 'Clavo de 8"');
    expect(proveedorMasBarato(clavos)).toBe(null);
  });

  it('seriePrecios sale cronológica', () => {
    const porInsumo = agruparComprasPorInsumo(compras, grupoDe, grupos);
    const clavos = [...porInsumo.values()].find(i => i.display === 'Clavo de 8"');
    const serie = seriePrecios(clavos);
    expect(serie.map(s => s.fecha)).toEqual(['2026-07-10', '2026-08-20']);
  });
});

// ── TANDA 1: una compra deshecha no es un precio de mercado ───────────
describe('extraerComprasDeFacturas — anuladas y canceladas fuera del comparador', () => {
  const FAC = {
    id: 'pa1', company_id: 'e1', date: '2026-09-01', type: 'cost', clase: 'compra',
    currency: 'PEN', amount: 100, third_party_name: 'PROVEEDOR REGALADO', third_party_ruc: '20100000009',
    document_number: 'F100-1',
    notas: { items_factura: [{ descripcion: 'Cemento Sol', unidad: 'und', cantidad: 10, precio_unitario: 1 }] },
  };
  const NC = {
    id: 'pnc1', company_id: 'e1', date: '2026-09-02', type: 'cost', clase: 'compra',
    document_type: 'nota_credito', currency: 'PEN', amount: -100, third_party_ruc: '20100000009',
    document_number: 'FC100-1', related_movement_id: 'pa1', nota_motivo: 'anulación',
  };

  it('la factura anulada por NC no entra al comparador de precios', () => {
    expect(extraerComprasDeFacturas([FAC]).map(l => l.nombre)).toEqual(['Cemento Sol']);
    expect(extraerComprasDeFacturas([FAC, NC])).toEqual([]);
  });

  it('la cancelada tampoco (antes entraba: solo el inventario la filtraba)', () => {
    expect(extraerComprasDeFacturas([{ ...FAC, payment_status: 'cancelled' }])).toEqual([]);
  });

  it('una NC parcial no saca la compra del comparador', () => {
    expect(extraerComprasDeFacturas([FAC, { ...NC, amount: -30 }])).toHaveLength(1);
  });
});

// ── TANDA 2: LA COMPRA ESPEJO TRAE SU DETALLE (15-set-2026) ───────────
// Cuando una empresa del grupo le vende a otra, la app crea sola la compra
// espejo en el libro del comprador, SIN ítems (si los llevara, el almacén del
// comprador contaría dos veces la misma mercadería) y con un puntero a la
// venta de origen. Medido en producción ese día: 98 compras espejo, S/ 2,32 M
// y 290 líneas que no entraban a ningún inventario. CONSORCIO EL INCA le
// compró 46 herramientas a JARVEX y en su inventario no existía ni una.
describe('extraerLineasDeFacturas — desglose heredado del espejo intercompany', () => {
  // La venta, en el libro del VENDEDOR, con su detalle real.
  const VENTA = {
    id: 'v1', company_id: 'jarvex', date: '2026-07-06', clase: 'venta', type: 'income',
    currency: 'PEN', amount: 1000, document_number: 'E001-2', third_party_name: 'CONSORCIO EL INCA',
    is_intercompany: true,
    notas: { items_factura: [
      { descripcion: 'MARTILLO M/STANLEY', unidad: 'und', cantidad: 2, precio_unitario: 45, tipo_insumo: 'herramienta' },
      { descripcion: 'PALANA CUCHARA', unidad: 'und', cantidad: 3, precio_unitario: 30 },
    ] },
  };
  // El espejo, en el libro del COMPRADOR: mismo papel, sin ítems, con puntero.
  const ESPEJO = {
    id: 'c1', company_id: 'elinca', date: '2026-07-06', clase: 'compra', type: 'cost',
    currency: 'PEN', amount: 1000, document_number: 'E001-2', third_party_name: 'JARVEX',
    proveedor_id: 'prov-jarvex', is_intercompany: true, recepcion_status: 'no_aplica',
    notas: { desglose_heredado_de: 'v1' },
  };

  it('el espejo hereda las líneas de la venta, con el contexto del COMPRADOR', () => {
    const lineas = extraerLineasDeFacturas([VENTA, ESPEJO]);
    const delEspejo = lineas.filter(l => l.movId === 'c1');
    expect(delEspejo).toHaveLength(2);
    expect(delEspejo[0]).toMatchObject({
      nombre: 'MARTILLO M/STANLEY',
      clase: 'compra',              // es una COMPRA del comprador, no la venta del otro
      companyId: 'elinca',          // …en SU libro
      proveedorNombre: 'JARVEX',    // …y el vendedor es su proveedor
      heredadaDe: 'v1',             // el detalle es prestado, y se dice
      heredadaDeCompanyId: 'jarvex',
      precio: 45, cantidad: 2, unidad: 'und', tipoInsumo: 'herramienta',
    });
    // La venta sigue estando del lado del vendedor: son los dos lados del
    // mismo papel, no una línea duplicada dentro de una misma empresa.
    expect(lineas.filter(l => l.companyId === 'jarvex' && l.clase === 'venta')).toHaveLength(2);
  });

  it('sin el detalle heredado, el comprador no tiene NI UNA línea (lo de antes)', () => {
    // El caso real: la compra existe, con su monto, y la mercadería no.
    expect(extraerLineasDeFacturas([ESPEJO])).toEqual([]);
  });

  it('las líneas heredadas entran al comparador de precios como compras reales', () => {
    const compras = extraerComprasDeFacturas([VENTA, ESPEJO]);
    expect(compras.filter(c => c.movId === 'c1')).toHaveLength(2);
    expect(compras.every(c => c.clase === 'compra')).toBe(true);
  });

  // ── Las cuatro guardas de desglose-heredado.js, acá también ────────
  it('guarda 1 — si el espejo tiene ítems PROPIOS, mandan los suyos', () => {
    const propio = { ...ESPEJO, notas: { desglose_heredado_de: 'v1', items_factura: [{ descripcion: 'LO QUE DICE SU PAPEL', cantidad: 1, precio_unitario: 9 }] } };
    const lineas = extraerLineasDeFacturas([VENTA, propio]).filter(l => l.movId === 'c1');
    expect(lineas.map(l => l.nombre)).toEqual(['LO QUE DICE SU PAPEL']);
    expect(lineas[0].heredadaDe).toBe(null);
  });

  it('guarda 2 — el origen tiene que vivir en OTRO libro', () => {
    const mismaEmpresa = { ...VENTA, company_id: 'elinca' };
    expect(extraerLineasDeFacturas([mismaEmpresa, ESPEJO]).filter(l => l.movId === 'c1')).toEqual([]);
  });

  it('guarda 3 — tiene que ser el MISMO comprobante, no otro', () => {
    const otroPapel = { ...VENTA, document_number: 'E001-999' };
    expect(extraerLineasDeFacturas([otroPapel, ESPEJO]).filter(l => l.movId === 'c1')).toEqual([]);
  });

  it('guarda 4 — si el origen no tiene ítems, no hay nada que heredar', () => {
    const vacia = { ...VENTA, notas: { items_factura: [] } };
    expect(extraerLineasDeFacturas([vacia, ESPEJO]).filter(l => l.movId === 'c1')).toEqual([]);
  });

  it('el origen se busca en `opts.origenes` cuando los movs vienen filtrados por empresa', () => {
    // Es el caso de Detalle de Empresa: `movs` trae SOLO el libro del
    // comprador, así que la venta de origen no está ahí.
    expect(extraerLineasDeFacturas([ESPEJO])).toEqual([]);
    const conOrigenes = extraerLineasDeFacturas([ESPEJO], { origenes: [VENTA, ESPEJO] });
    expect(conOrigenes.map(l => l.nombre)).toEqual(['MARTILLO M/STANLEY', 'PALANA CUCHARA']);
    expect(conOrigenes.every(l => l.companyId === 'elinca')).toBe(true);
  });

  // ── 🔴 Lo que NO cruza de un libro al otro ────────────────────────
  it('la RECEPCIÓN no se hereda: el almacén del comprador no recibió nada', () => {
    const conRecepcion = { ...VENTA, notas: { items_factura: [
      { descripcion: 'MARTILLO M/STANLEY', cantidad: 2, precio_unitario: 45, recibido: 2 },
    ] } };
    const lineas = extraerLineasDeFacturas([conRecepcion, ESPEJO]);
    expect(lineas.find(x => x.movId === 'c1')).toMatchObject({ tieneRecepcion: false, recibido: 0 });
    // …y del lado del vendedor el dato sigue intacto.
    expect(lineas.find(x => x.movId === 'v1')).toMatchObject({ tieneRecepcion: true, recibido: 2 });
  });

  it('`venta_status` y `destino` del vendedor tampoco cruzan', () => {
    // Si cruzaran, la mercadería recién comprada figuraría como YA VENDIDA.
    const marcada = { ...VENTA, notas: { items_factura: [
      { descripcion: 'MARTILLO M/STANLEY', cantidad: 2, precio_unitario: 45, venta_status: 'vendido', destino: 'obra' },
    ] } };
    const l = extraerLineasDeFacturas([marcada, ESPEJO]).find(x => x.movId === 'c1');
    expect(l).toMatchObject({ ventaStatus: null, destino: null });
  });

  // ── 🔴 La anulación SÍ cruza (caso real E001-263) ─────────────────
  // GASOMI le vendió a CONSORCIO SAMADAY por S/ 3.109 (3 líneas), anuló la
  // venta entera con la NC E001-64 y el espejo de SAMADAY NO tiene NC propia.
  // Sin esta regla, SAMADAY sumaría tres líneas de mercadería devuelta.
  it('si la venta de origen se anuló por nota de crédito, la línea heredada sale anulada', () => {
    const NC_VENDEDOR = {
      id: 'nc1', company_id: 'jarvex', date: '2026-07-20', clase: 'venta', type: 'income',
      document_type: 'nota_credito', currency: 'PEN', amount: -1000,
      document_number: 'E001-64', related_movement_id: 'v1', nota_motivo: 'anulación',
    };
    const l = extraerLineasDeFacturas([VENTA, NC_VENDEDOR, ESPEJO]).find(x => x.movId === 'c1');
    expect(l.anulada).toBe(true);
    expect(l.notaEtiqueta).toMatch(/en el libro del vendedor/);
  });

  it('una NC PARCIAL del vendedor rebaja, no anula', () => {
    const NC_PARCIAL = {
      id: 'nc2', company_id: 'jarvex', date: '2026-07-20', clase: 'venta', type: 'income',
      document_type: 'nota_credito', currency: 'PEN', amount: -100,
      document_number: 'E001-65', related_movement_id: 'v1',
    };
    const l = extraerLineasDeFacturas([VENTA, NC_PARCIAL, ESPEJO]).find(x => x.movId === 'c1');
    expect(l).toMatchObject({ anulada: false, rebajada: true });
  });

  it('el modo prueba no se mezcla: una venta demo no le da detalle a una compra real', () => {
    const ventaDemo = { ...VENTA, demo: true };
    expect(extraerLineasDeFacturas([ventaDemo, ESPEJO]).filter(l => l.movId === 'c1')).toEqual([]);
  });

  it('un comprobante sin puntero sigue sin líneas (no se inventa un origen)', () => {
    const suelto = { ...ESPEJO, id: 'c2', notas: {} };
    expect(extraerLineasDeFacturas([VENTA, suelto]).filter(l => l.movId === 'c2')).toEqual([]);
  });
});
