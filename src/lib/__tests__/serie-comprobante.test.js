// La serie es de la empresa; el correlativo se DERIVA de lo ya emitido.
import { describe, it, expect } from 'vitest';
import {
  serieDeEmpresa, partirDocumento, formatearDocumento,
  siguienteComprobante, documentoYaUsado, SERIE_POR_DEFECTO,
} from '../serie-comprobante.js';

const GASOMI = 'c-gasomi';
const v = (o) => ({ deleted_at: null, type: 'income', clase: 'venta', company_id: GASOMI, ...o });

const MOVS = [
  v({ id: '1', document_number: 'F001-00000001' }),
  v({ id: '2', document_number: 'F001-00000007' }),
  v({ id: '3', document_number: 'F001-00000003' }),
  // Otra serie de la misma empresa: lleva su propia cuenta.
  v({ id: '4', document_number: 'B001-00000042' }),
  // Una COMPRA: el número es del proveedor, no nuestro.
  v({ id: '5', type: 'cost', clase: 'compra', document_number: 'F001-00009999' }),
  // De otra empresa.
  v({ id: '6', company_id: 'c-otra', document_number: 'F001-00005000' }),
  // Anulada.
  v({ id: '7', document_number: 'F001-00008888', payment_status: 'cancelled' }),
  // Sin forma de comprobante.
  v({ id: '8', document_number: 'recibo interno 3' }),
];

describe('serieDeEmpresa', () => {
  it('usa la de la empresa si está configurada', () => {
    expect(serieDeEmpresa({ serie_factura: 'f002' })).toBe('F002');
  });
  it('sin configurar, la de por defecto', () => {
    expect(serieDeEmpresa({})).toBe(SERIE_POR_DEFECTO.factura);
    expect(serieDeEmpresa({}, 'boleta')).toBe('B001');
  });
  it('una serie con forma inválida se ignora en vez de romper el documento', () => {
    expect(serieDeEmpresa({ serie_factura: 'FACTURA-1' })).toBe('F001');
  });
});

describe('partirDocumento / formatearDocumento', () => {
  it('parte lo que tiene forma de comprobante', () => {
    expect(partirDocumento('F001-00000123')).toEqual({ serie: 'F001', correlativo: 123 });
    expect(partirDocumento(' f001 - 7 ')).toEqual({ serie: 'F001', correlativo: 7 });
  });
  it('lo que no la tiene devuelve null, no un número inventado', () => {
    expect(partirDocumento('recibo 3')).toBeNull();
    expect(partirDocumento('')).toBeNull();
    expect(partirDocumento(null)).toBeNull();
  });
  it('formatea a 8 dígitos, como pide SUNAT', () => {
    expect(formatearDocumento('f001', 7)).toBe('F001-00000007');
  });
});

describe('siguienteComprobante', () => {
  it('🔴 toma el MAYOR ya emitido, no la cantidad de filas', () => {
    const s = siguienteComprobante(MOVS, { companyId: GASOMI, serie: 'F001' });
    expect(s.ultimo).toBe(7);
    expect(s.correlativo).toBe(8);
    expect(s.documento).toBe('F001-00000008');
    expect(s.usados).toBe(3);
  });

  it('cada serie lleva su propia cuenta', () => {
    expect(siguienteComprobante(MOVS, { companyId: GASOMI, serie: 'B001' }).correlativo).toBe(43);
  });

  it('una COMPRA no mueve nuestro correlativo: el número es del proveedor', () => {
    // El 9999 de la compra no aparece por ningún lado.
    expect(siguienteComprobante(MOVS, { companyId: GASOMI, serie: 'F001' }).ultimo).toBe(7);
  });

  it('lo de otra empresa tampoco', () => {
    expect(siguienteComprobante(MOVS, { companyId: 'c-nueva', serie: 'F001' })).toMatchObject({
      ultimo: 0, correlativo: 1, documento: 'F001-00000001',
    });
  });

  it('una anulada no reserva el número', () => {
    expect(siguienteComprobante(MOVS, { companyId: GASOMI, serie: 'F001' }).ultimo).not.toBe(8888);
  });

  it('sin serie explícita usa la de la empresa', () => {
    const s = siguienteComprobante(MOVS, { company: { id: GASOMI, serie_factura: 'B001' } });
    expect(s.serie).toBe('B001');
    expect(s.correlativo).toBe(43);
  });
});

describe('documentoYaUsado', () => {
  it('encuentra el choque antes de duplicar el número', () => {
    expect(documentoYaUsado(MOVS, { companyId: GASOMI, documento: 'F001-00000007' })?.id).toBe('2');
  });
  it('un número libre devuelve null', () => {
    expect(documentoYaUsado(MOVS, { companyId: GASOMI, documento: 'F001-00000008' })).toBeNull();
  });
  it('el mismo número en OTRA empresa no es un choque', () => {
    expect(documentoYaUsado(MOVS, { companyId: GASOMI, documento: 'F001-00005000' })).toBeNull();
  });
});
