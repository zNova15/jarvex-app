// ═══════════════════════════════════════════════════════════════════
// PLE — Libro Diario (5.1) y Libro Mayor (6.1), contra el Anexo 2 de SUNAT
// (tanda F, 26-set-2026). Los Registros de Compras (8.1) y Ventas (14.1) ya no
// se generan acá: desde 2025 van solo por el SIRE (ver sunat-sire.test.js).
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  buildFilename, generateLibroDiarioPLE, generateLibroMayorPLE, LIBRO_DIARIO, LIBRO_MAYOR,
} from '../sunat-ple.js';
import { carDeComprobante } from '../tablas-sunat.js';

const RUC = '20615646505';
const periodo = { anio: 2026, mes: 7 };
const lineas = (content) => content.trim().split('\r\n').map(l => l.split('|'));

const compra = {
  id: 'mov-compra-1', type: 'expense', clase: 'compra', document_type: 'factura',
  document_number: 'F001-00006742', date: '2026-07-24', amount: 195.90, currency: 'PEN',
  third_party_ruc: '20608291181',
};
const venta = {
  id: 'mov-venta-1', type: 'income', clase: 'venta', document_type: 'factura',
  document_number: 'E001-1', date: '2026-07-06', amount: 12920, currency: 'PEN',
  third_party_ruc: '20615346081',
};
const asientoDe = (m, partidas, extra = {}) => ({
  numero: m.id.slice(0, 8).toUpperCase(), fecha: m.date, glosa: `Asiento ${m.document_number}`,
  movimiento_id: m.id, partidas, ...extra,
});
const aCompra = asientoDe(compra, [
  { cuenta: '6011', debe: 166.02, haber: 0 },
  { cuenta: '40111', debe: 29.88, haber: 0 },
  { cuenta: '4212', debe: 0, haber: 195.90 },
]);
const aVenta = asientoDe(venta, [
  { cuenta: '1212', debe: 12920, haber: 0 },
  { cuenta: '40111', debe: 0, haber: 1970.85 },
  { cuenta: '7041', debe: 0, haber: 10949.15 },
]);
const movsById = new Map([[compra.id, compra], [venta.id, venta]]);

describe('Nombre del archivo PLE (33 caracteres)', () => {
  it('LE + RUC + AAAAMM + 00 + libro + 00 + operativa + contenido + soles + PLE', () => {
    const n = buildFilename(RUC, periodo, LIBRO_DIARIO, true);
    expect(n).toBe('LE2061564650520260700050100001111.txt');
    expect(n.replace('.txt', '')).toHaveLength(33);
  });
  it('sin información el indicador de contenido es 0', () => {
    expect(buildFilename(RUC, periodo, LIBRO_MAYOR, false)).toBe('LE2061564650520260700060100001011.txt');
  });
});

describe('Libro Diario 5.1', () => {
  const out = generateLibroDiarioPLE([aCompra, aVenta], periodo, RUC, { movsById });
  const ls = lineas(out.content);

  it('21 campos por línea y pipe final, una línea por partida', () => {
    expect(ls).toHaveLength(6);
    for (const l of ls) {
      expect(l).toHaveLength(22);
      expect(l[21]).toBe('');
    }
    expect(out.registros).toBe(2);
    expect(out.totDebe).toBe(out.totHaber);
  });

  it('período, CUO estable (el id del comprobante) y correlativo de hasta 10 caracteres', () => {
    const l = ls[0];
    expect(l[0]).toBe('20260700');
    expect(l[1]).toBe('mov-compra-1');
    expect(l[2]).toMatch(/^M\d{1,9}$/);
    expect(l[2].length).toBeLessThanOrEqual(10);
  });

  it('comprobante de la compra: emisor = proveedor, tipo, serie, número y CAR en el campo 20', () => {
    const l = ls[0];
    expect(l[6]).toBe('PEN');
    expect(l[7]).toBe('6');
    expect(l[8]).toBe('20608291181');
    expect(l[9]).toBe('01');
    expect(l[10]).toBe('F001');
    expect(l[11]).toBe('6742');
    expect(l[14]).toBe('24/07/2026');
    // El CAR que trae la propuesta real de SUNAT para esta factura.
    expect(l[19]).toBe('2060829118101F0010000006742');
    expect(l[20]).toBe('1');
  });

  it('en la venta el emisor es la propia empresa: el CAR coincide con el del RVIE real', () => {
    const l = ls.find(x => x[1] === 'mov-venta-1');
    expect(l[8]).toBe(RUC);
    expect(l[19]).toBe('2061564650501E0010000000001');
  });

  it('un descuadre se AVISA fuera del archivo: ninguna línea empieza con #', () => {
    const cojo = asientoDe(compra, [{ cuenta: '6011', debe: 100, haber: 0 }, { cuenta: '4212', debe: 0, haber: 90 }]);
    const r = generateLibroDiarioPLE([cojo], periodo, RUC, { movsById });
    expect(r.content).not.toMatch(/^#/m);
    expect(r.avisos.join(' ')).toMatch(/no cuadran/);
  });

  it('un asiento en dólares sin tipo de cambio no se declara y se cuenta', () => {
    const r = generateLibroDiarioPLE([{ ...aCompra, sinTipoCambio: true }], periodo, RUC, { movsById });
    expect(r.content).toBe('');
    expect(r.omitidos).toBe(1);
  });

  it('un comprobante diferido (emitido en febrero, declarado en julio) NO se cae', () => {
    const feb = { ...compra, id: 'mov-feb', date: '2026-02-10', periodo_declarado: '202607' };
    const a = asientoDe(feb, aCompra.partidas);
    const r = generateLibroDiarioPLE([a], periodo, RUC, { movsById: new Map([[feb.id, feb]]) });
    const l = lineas(r.content)[0];
    expect(r.registros).toBe(1);
    expect(l[12]).toBe('01/07/2026');   // fecha contable: dentro del período
    expect(l[14]).toBe('10/02/2026');   // fecha de emisión: la del papel
  });
});

describe('Libro Mayor 6.1', () => {
  it('los mismos 21 campos, movimiento por movimiento, ordenados por cuenta', () => {
    const out = generateLibroMayorPLE([aCompra, aVenta], periodo, RUC, { movsById });
    const ls = lineas(out.content);
    expect(ls).toHaveLength(6);
    for (const l of ls) expect(l).toHaveLength(22);
    const cuentas = ls.map(l => l[3]);
    expect(cuentas).toEqual([...cuentas].sort());
    expect(out.filename).toBe('LE2061564650520260700060100001111.txt');
    expect(out.cuentas).toBe(5);
  });
});

describe('CAR (Código de Anotación de Registro)', () => {
  it('se arma con RUC del emisor + tipo + serie + número a 10 dígitos', () => {
    expect(carDeComprobante({ rucEmisor: '20614539756', tipo: '01', serie: 'F001', numero: '163254' }))
      .toBe('2061453975601F0010000163254');
  });
  it('no se inventa: sin RUC de 11, serie de 4 o número numérico devuelve vacío', () => {
    expect(carDeComprobante({ rucEmisor: '123', tipo: '01', serie: 'F001', numero: '1' })).toBe('');
    expect(carDeComprobante({ rucEmisor: '20614539756', tipo: '01', serie: 'F1', numero: '1' })).toBe('');
    expect(carDeComprobante({ rucEmisor: '20614539756', tipo: '01', serie: 'F001', numero: 'A1' })).toBe('');
    expect(carDeComprobante({ rucEmisor: '20614539756', tipo: '00', serie: 'F001', numero: '1' })).toBe('');
  });
});
