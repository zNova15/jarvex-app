import { describe, it, expect } from 'vitest';
import { generateRegistroComprasPLE, generateRegistroVentasPLE } from '../sunat-ple.js';

// El TXT del PLE es pipe-separated; para leerlo en los tests partimos por '|'.
const cols = (content) => content.trim().split('\r\n').map(l => l.split('|'));
const periodo = { anio: 2026, mes: 8 };
const RUC = '20601234567';

describe('PLE Registro de Compras — moneda y doc. de referencia', () => {
  const factura = {
    id: 'f1', type: 'cost', document_type: 'factura', document_number: 'F001-000123',
    date: '2026-07-15', amount: 1180, currency: 'PEN', third_party_ruc: '20536265644',
    third_party_name: 'PROVEEDOR SAC',
  };

  it('una compra en USD se declara en USD, no en PEN', () => {
    // Bug real: la fila leía m.moneda (columna inexistente) y toda factura en
    // dólares salía como PEN con TC 0.000.
    const usd = { ...factura, id: 'f2', currency: 'USD', date: '2026-08-10', tipo_cambio: 3.75 };
    const out = generateRegistroComprasPLE([usd], periodo, RUC);
    const fila = cols(out.content)[0];
    expect(fila[23]).toBe('USD');   // col 24 = Moneda
  });

  it('una NOTA DE CRÉDITO lleva fecha/tipo/serie/número de la factura que modifica', () => {
    // SUNAT observa las notas sin documento de referencia. La factura original
    // es de JULIO y la nota de AGOSTO: por eso el índice es de TODOS los movs.
    const nc = {
      id: 'nc1', type: 'cost', document_type: 'nota_credito', document_number: 'FC01-000009',
      date: '2026-08-05', amount: -118, currency: 'PEN', third_party_ruc: '20536265644',
      related_movement_id: 'f1',
    };
    const out = generateRegistroComprasPLE([nc], periodo, RUC, { movsById: new Map([['f1', factura]]) });
    const fila = cols(out.content)[0];
    expect(fila.slice(25, 29)).toEqual(['15/07/2026', '01', 'F001', '000123']);   // cols 26-29
  });

  it('sin la factura original en el índice, las 4 columnas quedan vacías (no se inventan)', () => {
    const nc = {
      id: 'nc2', type: 'cost', document_type: 'nota_credito', document_number: 'FC01-000010',
      date: '2026-08-06', amount: -50, currency: 'PEN', related_movement_id: 'inexistente',
    };
    const out = generateRegistroComprasPLE([nc], periodo, RUC, { movsById: new Map() });
    expect(cols(out.content)[0].slice(25, 29)).toEqual(['', '', '', '']);
  });

  it('una FACTURA normal no lleva doc. de referencia', () => {
    const out = generateRegistroComprasPLE([{ ...factura, date: '2026-08-15' }], periodo, RUC);
    expect(cols(out.content)[0].slice(25, 29)).toEqual(['', '', '', '']);
  });
});

describe('PLE Registro de Ventas — doc. de referencia de la nota', () => {
  const venta = {
    id: 'v1', type: 'income', document_type: 'factura', document_number: 'F001-000500',
    date: '2026-07-20', amount: 2360, currency: 'PEN', third_party_ruc: '20777777777',
  };
  it('la NC de venta referencia su factura', () => {
    const nc = {
      id: 'ncv', type: 'income', document_type: 'nota_credito', document_number: 'FC02-000003',
      date: '2026-08-02', amount: -236, currency: 'PEN', related_movement_id: 'v1',
    };
    const out = generateRegistroVentasPLE([nc], periodo, RUC, { movsById: new Map([['v1', venta]]) });
    // En ventas las columnas de referencia son la 27-30 (índices 26-29).
    expect(cols(out.content)[0].slice(26, 30)).toEqual(['20/07/2026', '01', 'F001', '000500']);
  });
});
