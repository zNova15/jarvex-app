// El Registro de Compras y el de Ventas con el formato del Excel modelo de
// las contadoras (tanda 4, 17-set-2026).
import { describe, it, expect } from 'vitest';
import {
  armarRegistro, filaCompra, filaVenta, referenciaOriginal,
  fechaRegistro, COLUMNAS_COMPRAS, COLUMNAS_VENTAS, celda, matriz,
  RETENCION_4TA_MINIMO,
} from '../registro-compras-ventas.js';

// Una factura de compra como las que hay en producción: el desglose real va
// en `notas`, que es donde lo deja Captura Mágica.
const factura = (extra = {}) => ({
  id: 'f1', clase: 'compra', type: 'cost', date: '2026-06-10',
  document_type: 'factura', document_number: 'F001-00012345',
  third_party_name: 'AREQUIPA EXPRESO MARVISUR E.I.R.L.', third_party_ruc: '20498327031',
  description: 'TRANSPORTE NACIONAL', amount: 1180, currency: 'PEN',
  payment_status: 'paid', notas: JSON.stringify({ subtotal: 1000, igv: 180 }),
  ...extra,
});

const venta = (extra = {}) => ({
  id: 'v1', clase: 'venta', type: 'income', date: '2026-06-15',
  document_type: 'factura', document_number: 'E001-20',
  third_party_name: 'JADE CONSULTORIA Y PROYECTOS E.I.R.L', third_party_ruc: '20613434195',
  description: 'Valorización 03', amount: 30662, currency: 'PEN',
  payment_status: 'pending', notas: JSON.stringify({ subtotal: 25984.75, igv: 4677.25 }),
  ...extra,
});

describe('la fecha del registro', () => {
  it('va en dd/mm/aaaa y por string, nunca con new Date()', () => {
    // Con new Date('2026-07-01') en Perú una factura del 01/07 caía en junio.
    expect(fechaRegistro('2026-07-01')).toBe('01/07/2026');
    expect(fechaRegistro('2026-06-10')).toBe('10/06/2026');
    expect(fechaRegistro(null)).toBe('');
  });
});

describe('una fila del Registro de Compras', () => {
  it('trae la identificación completa del comprobante y del proveedor', () => {
    const f = filaCompra(factura(), { correlativo: 1 });
    expect(f.correlativo).toBe(1);
    expect(f.fechaEmision).toBe('10/06/2026');
    expect(f.tipo).toBe('01');
    expect(f.tipoNombre).toBe('Factura');
    expect(f.serie).toBe('F001');
    expect(f.numero).toBe('00012345');
    expect(f.tipoDocIdent).toBe('6');
    expect(f.numeroDocIdent).toBe('20498327031');
    expect(f.moneda).toBe('PEN');
    expect(f.avisos).toEqual([]);
  });

  it('el importe se parte como en el comprobante, no al 18 % inventado', () => {
    const f = filaCompra(factura({ notas: JSON.stringify({ subtotal: 1000, igv: 100 }) }), { correlativo: 1 });
    expect(f.baseImponible).toBe(1000);
    expect(f.igv).toBe(100);
    expect(f.importeTotal).toBe(1180);
  });

  it('lo exonerado o inafecto va a NO GRAVADAS, no a la base gravada', () => {
    // Si se sumara a la base, se declararía crédito fiscal de algo que no lo da.
    // El comprobante trae S/ 1.065: S/ 500 gravados + S/ 90 de IGV + S/ 475
    // exonerados. La base gravada es el subtotal del comprobante; el resto es
    // lo que no paga IGV.
    const f = filaCompra(factura({
      amount: 1065,
      notas: JSON.stringify({ subtotal: 500, igv: 90 }),
    }), { correlativo: 1 });
    expect(f.baseImponible).toBe(500);
    expect(f.igv).toBe(90);
    expect(f.noGravadas).toBe(475);
    expect(f.importeTotal).toBe(1065);
  });

  it('la columna CTA sale de la misma cuenta que el Libro Diario', () => {
    const f = filaCompra(factura(), { correlativo: 1, cuentaDe: () => '631' });
    expect(f.cta).toBe('631');
  });

  it('sin resolvedor de cuenta, la CTA queda vacía y no se inventa', () => {
    expect(filaCompra(factura(), { correlativo: 1 }).cta).toBe('');
  });

  it('avisa cuando no pudo determinar el tipo de comprobante', () => {
    const f = filaCompra(factura({ document_type: 'vale', document_number: 'X-1' }), { correlativo: 1 });
    expect(f.tipo).toBe('00');
    expect(f.avisos.join(' ')).toMatch(/Tabla 10/);
  });

  it('avisa cuando el comprobante no tiene número', () => {
    const f = filaCompra(factura({ document_number: '' }), { correlativo: 1 });
    expect(f.avisos.join(' ')).toMatch(/no tiene número/);
  });
});

describe('el marcador propio de los recibos por honorarios', () => {
  const rh = (extra = {}) => factura({
    id: 'rh1', document_type: 'recibo', category: 'Recibo Honorarios',
    document_number: 'E001-1', third_party_ruc: '15615529351',
    third_party_name: 'URDANETA MUÑOZ LEONARD WILFRED',
    amount: 2800, notas: null,
    ...extra,
  });

  it('va como tipo 02 y con su marcador', () => {
    const f = filaCompra(rh(), { correlativo: 1 });
    expect(f.tipo).toBe('02');
    expect(f.honorarios).toBe(true);
    expect(f.marcadores.map(m => m.clave)).toContain('recibo_honorarios');
  });

  it('no lleva IGV: su importe entero es adquisición no gravada', () => {
    const f = filaCompra(rh(), { correlativo: 1 });
    expect(f.igv).toBe(0);
    expect(f.baseImponible).toBe(0);
    expect(f.noGravadas).toBe(2800);
    expect(f.importeTotal).toBe(2800);
  });

  it('si viene con un IGV desglosado, no se declara y se avisa', () => {
    const f = filaCompra(rh({ notas: JSON.stringify({ subtotal: 2372.88, igv: 427.12 }) }), { correlativo: 1 });
    expect(f.igv).toBe(0);
    expect(f.avisos.join(' ')).toMatch(/no lleva IGV/);
  });

  it('calcula la retención de 4ta del 8 % pasando S/ 1.500', () => {
    expect(filaCompra(rh(), { correlativo: 1 }).retencion4ta).toBe(224);       // 2.800
    expect(filaCompra(rh({ amount: 3200 }), { correlativo: 1 }).retencion4ta).toBe(256);
  });

  it('por debajo del mínimo no hay retención, y el marcador lo dice', () => {
    const f = filaCompra(rh({ amount: RETENCION_4TA_MINIMO }), { correlativo: 1 });
    expect(f.retencion4ta).toBe(0);
    expect(f.marcadores[0].detalle).toMatch(/no corresponde retención/);
  });

  it('un recibo por honorarios como VENTA nuestra está mal, y se avisa', () => {
    // El caso real: E001-4 de MENDOZA ROMERO, cargado con clase='venta'. Una
    // empresa no puede emitir un recibo por honorarios.
    const f = filaCompra(rh({ clase: 'venta', type: 'income' }), { correlativo: 1 });
    expect(f.avisos.join(' ')).toMatch(/persona natural/);
  });
});

describe('la detracción en el registro', () => {
  it('trae el número y la fecha de la constancia (mig 221)', () => {
    const f = filaCompra(factura({
      detraccion_aplica: true, detraccion_pct: 12, detraccion_estado: 'depositada',
      detraccion_constancia_numero: '000123456', detraccion_constancia_fecha: '2026-06-20',
    }), { correlativo: 1 });
    expect(f.detraccionNumero).toBe('000123456');
    expect(f.detraccionFecha).toBe('20/06/2026');
    expect(f.avisos).toEqual([]);
  });

  it('avisa si falta el número, que es una columna del registro', () => {
    const f = filaCompra(factura({ detraccion_aplica: true, detraccion_estado: 'depositada' }), { correlativo: 1 });
    expect(f.detraccionNumero).toBe('');
    expect(f.avisos.join(' ')).toMatch(/número de la constancia/);
  });
});

describe('las notas de crédito y su comprobante original', () => {
  const nc = () => factura({
    id: 'nc1', document_type: 'nota_credito', document_number: 'FC01-9',
    amount: -1180, related_movement_id: 'f1',
  });

  it('resuelve los cuatro campos de la referencia, aunque la factura sea de otro mes', () => {
    const movsById = new Map([['f1', factura({ date: '2026-05-02' })]]);
    const r = referenciaOriginal(nc(), movsById);
    expect(r).toEqual({ fecha: '02/05/2026', tipo: '01', serie: 'F001', numero: '00012345', falta: false });
  });

  it('si no encuentra la original, deja los campos vacíos y lo avisa', () => {
    const f = filaCompra(nc(), { correlativo: 1, movsById: new Map() });
    expect(f.referencia.serie).toBe('');
    expect(f.avisos.join(' ')).toMatch(/comprobante original/);
  });

  it('la nota entra con importes NEGATIVOS: resta en el registro', () => {
    const f = filaCompra(nc(), { correlativo: 1, movsById: new Map([['f1', factura()]]) });
    expect(f.importeTotal).toBeLessThan(0);
    expect(f.tipo).toBe('07');
  });

  it('una factura normal no tiene referencia', () => {
    expect(referenciaOriginal(factura(), new Map()).tipo).toBe('');
  });
});

describe('el tipo de cambio', () => {
  it('en soles va vacío', () => {
    expect(filaCompra(factura(), { correlativo: 1 }).tipoCambio).toBe('');
  });

  it('en dólares sale de la tasa del día de la operación', () => {
    const f = filaCompra(factura({ currency: 'USD', amount: 500 }), {
      correlativo: 1, tasaDe: (ymd) => (ymd === '2026-06-10' ? 3.78 : 0),
    });
    expect(f.tipoCambio).toBe(3.78);
    expect(f.avisos).toEqual([]);
  });

  it('si no hay tasa para esa fecha, queda vacío y avisa — no se pone un 3,75 de referencia', () => {
    const f = filaCompra(factura({ currency: 'USD' }), { correlativo: 1, tasaDe: () => 0 });
    expect(f.tipoCambio).toBe('');
    expect(f.avisos.join(' ')).toMatch(/tipo de cambio/);
  });
});

describe('una fila del Registro de Ventas', () => {
  it('trae base, IGV e importe del comprobante', () => {
    const f = filaVenta(venta(), { correlativo: 1 });
    expect(f.tipo).toBe('01');
    expect(f.serie).toBe('E001');
    expect(f.numero).toBe('20');
    expect(f.baseImponible).toBe(25984.75);
    expect(f.igv).toBe(4677.25);
    expect(f.importeTotal).toBe(30662);
    expect(f.exportacion).toBe(0);
  });

  it('una exportación va a su columna y sin IGV', () => {
    const f = filaVenta(venta({ destino_contable: 'exportacion' }), { correlativo: 1 });
    expect(f.exportacion).toBe(30662);
    expect(f.baseImponible).toBe(0);
    expect(f.igv).toBe(0);
  });
});

describe('el registro completo del período', () => {
  const movs = [
    factura({ id: 'a', date: '2026-06-20', document_number: 'F001-2' }),
    factura({ id: 'b', date: '2026-06-05', document_number: 'F001-1' }),
    venta({ id: 'c', date: '2026-06-15' }),
    factura({ id: 'z', date: '2026-06-01', deleted_at: '2026-06-02' }),
    factura({ id: 'y', date: '2026-06-01', payment_status: 'cancelled' }),
  ];

  it('separa compras de ventas por la clase, no por el tipo', () => {
    const r = armarRegistro({ movimientos: movs });
    expect(r.compras.filas.length).toBe(2);
    expect(r.ventas.filas.length).toBe(1);
  });

  it('deja afuera lo borrado y lo anulado', () => {
    const r = armarRegistro({ movimientos: movs });
    expect(r.compras.filas.map(f => f.movimiento_id)).not.toContain('z');
    expect(r.compras.filas.map(f => f.movimiento_id)).not.toContain('y');
  });

  it('ordena por fecha y numera DESPUÉS de ordenar', () => {
    const r = armarRegistro({ movimientos: movs });
    expect(r.compras.filas.map(f => f.movimiento_id)).toEqual(['b', 'a']);
    expect(r.compras.filas.map(f => f.correlativo)).toEqual([1, 2]);
  });

  it('los totales van SEPARADOS POR MONEDA, nunca en una sola bolsa', () => {
    const r = armarRegistro({
      movimientos: [...movs, factura({ id: 'd', currency: 'USD', amount: 1180, date: '2026-06-25' })],
    });
    const monedas = r.compras.totales.monedas.map(m => m.moneda);
    expect(monedas).toEqual(['PEN', 'USD']);
    expect(r.compras.totales.monedas[0].importeTotal).toBe(2360);
    expect(r.compras.totales.monedas[1].importeTotal).toBe(1180);
  });

  it('cuenta cuántas filas tienen algo que mirar antes de declarar', () => {
    const r = armarRegistro({ movimientos: [factura({ document_number: '' })] });
    expect(r.compras.totales.conAvisos).toBe(1);
  });
});

describe('las columnas del papel', () => {
  it('son las del Excel modelo, sin claves repetidas', () => {
    for (const cols of [COLUMNAS_COMPRAS, COLUMNAS_VENTAS]) {
      const ks = cols.map(c => c.k);
      expect(new Set(ks).size).toBe(ks.length);
      for (const c of cols) expect(c.t.length).toBeGreaterThan(0);
    }
  });

  it('las compras llevan las columnas propias del formato', () => {
    const ks = COLUMNAS_COMPRAS.map(c => c.k);
    expect(ks).toContain('cta');               // la de la contadora, ahora automática
    expect(ks).toContain('noGravadas');
    expect(ks).toContain('detraccionNumero');
    expect(ks).toContain('detraccionFecha');
    expect(ks).toContain('noDomiciliado');
    expect(ks).toContain('refSerie');
  });

  it('la celda aplana la referencia, que en la fila viene anidada', () => {
    const f = filaCompra(
      factura({ document_type: 'nota_credito', document_number: 'FC01-9', amount: -100, related_movement_id: 'f1' }),
      { correlativo: 1, movsById: new Map([['f1', factura()]]) },
    );
    expect(celda(f, 'refSerie')).toBe('F001');
    expect(celda(f, 'refTipo')).toBe('01');
    expect(celda(f, 'noDomiciliado')).toBe('');
  });

  it('la matriz tiene una columna por columna declarada', () => {
    const m = matriz([filaCompra(factura(), { correlativo: 1 })], COLUMNAS_COMPRAS);
    expect(m.length).toBe(1);
    expect(m[0].length).toBe(COLUMNAS_COMPRAS.length);
  });
});

// ── EL TIPO DE CAMBIO QUE SÍ CONVIERTE LAS COLUMNAS (23-set-2026) ──
// Gabriel: «está perfecto poder agregar el tipo de cambio, sin embargo eso no
// cambia las columnas de base imponible, IGV, no gravadas, importe total».
// El registro se declara en soles al TC de la fecha de emisión, así que la
// tasa tiene que llegar hasta los importes, no quedarse en su columna.
describe('los importes en soles', () => {
  const enDolares = () => factura({
    currency: 'USD', amount: 80000, date: '2026-06-10',
    notas: JSON.stringify({ subtotal: 67796.61, igv: 12203.39 }),
  });

  it('una fila en soles se declara tal cual y no dice que se convirtió', () => {
    const f = filaCompra(factura(), { correlativo: 1 });
    expect(f.soles.convertido).toBe(false);
    expect(f.soles.baseImponible).toBe(f.baseImponible);
    expect(f.soles.importeTotal).toBe(f.importeTotal);
  });

  it('una fila en dólares trae los MISMOS importes al tipo de cambio de su fecha', () => {
    // KOPLAST INDUSTRIAL, el caso real: US$ 80.000 al 3,495 son S/ 279.600.
    const f = filaCompra(enDolares(), { correlativo: 1, tasaDe: () => 3.495 });
    expect(f.tipoCambio).toBe(3.495);
    expect(f.importeTotal).toBe(80000);            // el papel no se toca
    expect(f.soles.convertido).toBe(true);
    expect(f.soles.tasa).toBe(3.495);
    expect(f.soles.importeTotal).toBe(279600);
    expect(f.soles.baseImponible).toBe(236949.15);
    expect(f.soles.igv).toBe(42650.85);
  });

  it('sin tasa NO se inventa la conversión: `soles` queda en null', () => {
    const f = filaCompra(enDolares(), { correlativo: 1, tasaDe: () => 0 });
    expect(f.tipoCambio).toBe('');
    expect(f.soles).toBe(null);
    expect(f.avisos.join(' ')).toMatch(/tipo de cambio/i);
  });

  it('las ventas en dólares también se convierten', () => {
    const f = filaVenta(venta({ currency: 'USD', amount: 1180, notas: JSON.stringify({ subtotal: 1000, igv: 180 }) }),
      { correlativo: 1, tasaDe: () => 3.5 });
    expect(f.soles.importeTotal).toBe(4130);
    expect(f.soles.igv).toBe(630);
  });
});

describe('el resumen del mes en soles', () => {
  it('suma los de soles y los de dólares convertidos, en UN solo total declarable', () => {
    const { compras } = armarRegistro({
      movimientos: [
        factura({ id: 'a' }),                                                   // S/ 1.180
        factura({ id: 'b', currency: 'USD', amount: 1000, date: '2026-06-11',
          notas: JSON.stringify({ subtotal: 847.46, igv: 152.54 }) }),          // US$ 1.000 × 3,5
      ],
      tasaDe: () => 3.5,
    });
    expect(compras.totales.soles.filas).toBe(2);
    expect(compras.totales.soles.convertidos).toBe(1);
    expect(compras.totales.soles.sinTasa).toBe(0);
    expect(compras.totales.soles.importeTotal).toBe(4680);   // 1.180 + 3.500
    // Y la tarjeta por moneda sigue diciendo lo que dice el papel.
    const usd = compras.totales.monedas.find(m => m.moneda === 'USD');
    expect(usd.importeTotal).toBe(1000);
  });

  it('cuenta aparte las que quedaron sin tasa: un total incompleto tiene que decirlo', () => {
    const { compras } = armarRegistro({
      movimientos: [
        factura({ id: 'a' }),
        factura({ id: 'b', currency: 'USD', amount: 1000, date: '2026-06-11' }),
      ],
      tasaDe: () => 0,
    });
    expect(compras.totales.soles.sinTasa).toBe(1);
    expect(compras.totales.soles.filas).toBe(1);
    expect(compras.totales.soles.importeTotal).toBe(1180);   // la de dólares NO entra
  });
});

// ── LA NOTA NO PUEDE SER ANTERIOR A LO QUE MODIFICA (23-set-2026) ──
// Gabriel: «un comprobante fue emitido y declarado en una fecha anterior a la
// de la emisión, lo cual es súper ilógico y hay que tener cuidado con eso».
describe('la nota con fecha anterior a su comprobante original', () => {
  const nc = (extra = {}) => factura({
    id: 'nc1', document_type: 'nota_credito', document_number: 'FC01-9',
    amount: -1180, related_movement_id: 'f1', date: '2026-01-10', ...extra,
  });

  it('avisa cuando la nota es de una fecha ANTERIOR a la factura que modifica', () => {
    const movsById = new Map([['f1', factura({ date: '2026-05-02' })]]);
    const f = filaCompra(nc(), { correlativo: 1, movsById });
    expect(f.avisos.join(' ')).toMatch(/ANTERIOR/);
    expect(f.avisos.join(' ')).toMatch(/10\/01\/2026/);
    expect(f.avisos.join(' ')).toMatch(/02\/05\/2026/);
  });

  it('no avisa cuando la nota es POSTERIOR a la factura, el caso normal', () => {
    const movsById = new Map([['f1', factura({ date: '2026-01-05' })]]);
    const f = filaCompra(nc(), { correlativo: 1, movsById });
    expect(f.avisos.join(' ')).not.toMatch(/ANTERIOR/);
  });

  it('el mismo día no cuenta como anterior', () => {
    const movsById = new Map([['f1', factura({ date: '2026-01-10' })]]);
    const f = filaCompra(nc(), { correlativo: 1, movsById });
    expect(f.avisos.join(' ')).not.toMatch(/ANTERIOR/);
  });

  it('sin original (ya avisado por "no encontrado") no duplica el aviso de fecha', () => {
    const f = filaCompra(nc(), { correlativo: 1, movsById: new Map() });
    expect(f.avisos.join(' ')).toMatch(/no se encontró el comprobante original/);
    expect(f.avisos.join(' ')).not.toMatch(/ANTERIOR/);
  });

  it('referenciaOriginal() no cambia de forma: sigue devolviendo exactamente sus 5 campos', () => {
    // Guarda de que el chequeo de fecha se resuelve APARTE, sin tocar el
    // contrato ya testeado de la función pública.
    const movsById = new Map([['f1', factura({ date: '2026-05-02' })]]);
    expect(Object.keys(referenciaOriginal(nc(), movsById)).sort())
      .toEqual(['falta', 'fecha', 'numero', 'serie', 'tipo']);
  });
});
