// Tests del desglose real de base + IGV (src/lib/igv-desglose.js).
// Hallazgo de las contadoras (31-ago-2026): el Libro Diario y los PLE inventaban
// el 18 % porque la tabla no tiene columnas subtotal/igv_amount — el desglose
// real estaba (y sigue estando) dentro del JSON de `notas`.
import { describe, it, expect } from 'vitest';
import { desglosarIgv, describirIgv, igvDestacable, parseNotasSeguro } from '../igv-desglose.js';

const notas = (o) => JSON.stringify(o);

describe('desglosarIgv — desglose del comprobante', () => {
  it('E001-263: IGV real S/9 sobre un total de S/3,109', () => {
    const d = desglosarIgv({ amount: 3109, notas: notas({ subtotal: 3100, igv: 9 }) });
    expect(d.igv).toBeCloseTo(9, 2);
    expect(d.subtotal).toBeCloseTo(3100, 2);
    expect(d.origen).toBe('comprobante');
    expect(d.estimado).toBe(false);
  });

  it('factura de comida al 10 % (8 % IGV + 2 % IPM)', () => {
    const d = desglosarIgv({ amount: 110, notas: notas({ subtotal: 100, igv: 10 }) });
    expect(d.igv).toBeCloseTo(10, 2);
    expect(d.tasaPct).toBeCloseTo(10, 1);
    expect(describirIgv(d)).toBe('10% del comprobante');
    expect(igvDestacable(d)).toBe(true);
  });

  it('factura normal al 18 %: no vale la pena destacarla', () => {
    const d = desglosarIgv({ amount: 118, notas: notas({ subtotal: 100, igv: 18 }) });
    expect(d.tasaPct).toBeCloseTo(18, 1);
    expect(igvDestacable(d)).toBe(false);
  });

  it('exonerado: subtotal = total, IGV 0', () => {
    const d = desglosarIgv({ amount: 500, notas: notas({ subtotal: 500, igv: 0 }) });
    expect(d.igv).toBe(0);
    expect(d.subtotal).toBeCloseTo(500, 2);
    expect(d.origen).toBe('comprobante');
    expect(describirIgv(d)).toBe('sin IGV');
  });

  it('base + IGV que no suman el total: manda el IGV y la base absorbe el resto', () => {
    // Caso real F013-7500: total 17.94, base gravada 14.59, IGV 1.46 →
    // 1.89 de exonerado/ICBPER. El asiento tiene que cuadrar igual.
    const d = desglosarIgv({ amount: 17.94, notas: notas({ subtotal: 14.59, igv: 1.46 }) });
    expect(d.igv).toBeCloseTo(1.46, 2);
    expect(d.subtotal).toBeCloseTo(16.48, 2);
    expect(d.baseGravada).toBeCloseTo(14.59, 2);
    expect(d.noGravado).toBeCloseTo(1.89, 2);
    expect(d.subtotal + d.igv).toBeCloseTo(d.total, 2);
  });

  it('subtotal mayor que el total (OCR raro): no rompe ni deja el asiento torcido', () => {
    const d = desglosarIgv({ amount: 55, notas: notas({ subtotal: 65, igv: 0 }) });
    expect(d.igv).toBe(0);
    expect(d.subtotal).toBeCloseTo(55, 2);
    expect(d.noGravado).toBe(0);
  });

  it('IGV mayor que el total: se recorta al total (nunca una base negativa)', () => {
    const d = desglosarIgv({ amount: 100, notas: notas({ subtotal: 0, igv: 500 }) });
    expect(d.igv).toBeCloseTo(100, 2);
    expect(d.subtotal).toBeCloseTo(0, 2);
  });
});

describe('desglosarIgv — cuándo NO hay dato', () => {
  it('sin notas: estima al 18 % y lo deja marcado', () => {
    const d = desglosarIgv({ amount: 1180 });
    expect(d.origen).toBe('estimado');
    expect(d.estimado).toBe(true);
    expect(d.igv).toBeCloseTo(180, 2);
    expect(d.subtotal).toBeCloseTo(1000, 2);
    expect(describirIgv(d)).toBe('18% estimado');
    expect(igvDestacable(d)).toBe(true);
  });

  it('subtotal 0 e IGV 0 = el OCR no leyó nada, NO un exonerado → estima', () => {
    const d = desglosarIgv({ amount: 45, notas: notas({ subtotal: 0, igv: 0 }) });
    expect(d.origen).toBe('estimado');
  });

  it('notas de texto suelto (valorizaciones, subcontratos) no revientan', () => {
    const d = desglosarIgv({ amount: 1180, notas: 'Detracción 12%: S/141.60 · Neto: S/1,038.40' });
    expect(d.origen).toBe('estimado');
    expect(d.total).toBe(1180);
  });

  it('notas con JSON roto no revientan', () => {
    expect(() => desglosarIgv({ amount: 100, notas: '{roto' })).not.toThrow();
    expect(desglosarIgv({ amount: 100, notas: '{roto' }).origen).toBe('estimado');
  });

  it('operación marcada como no gravada por código de exoneración', () => {
    const d = desglosarIgv({ amount: 300, tax_exemption_code: '20' });
    expect(d.origen).toBe('no_gravado');
    expect(d.igv).toBe(0);
    expect(d.subtotal).toBeCloseTo(300, 2);
  });

  it('movimiento vacío o nulo', () => {
    expect(desglosarIgv(null).total).toBe(0);
    expect(desglosarIgv({}).igv).toBe(0);
  });
});

describe('desglosarIgv — prioridad de fuentes', () => {
  it('las columnas explícitas ganan sobre el JSON de notas', () => {
    const d = desglosarIgv({ amount: 118, subtotal: 100, igv_amount: 18, notas: notas({ subtotal: 50, igv: 68 }) });
    expect(d.igv).toBeCloseTo(18, 2);
  });

  it('notas.factura (facturas internas de una cadena)', () => {
    const d = desglosarIgv({ amount: 1180, notas: notas({ role: 'buyer', factura: { subtotal: 1000, igv: 180 } }) });
    expect(d.origen).toBe('comprobante');
    expect(d.igv).toBeCloseTo(180, 2);
  });

  it('factura_interna_meta (columna jsonb)', () => {
    const d = desglosarIgv({ amount: 1180, factura_interna_meta: { subtotal: 1000, igv: 180 } });
    expect(d.igv).toBeCloseTo(180, 2);
  });
});

describe('desglosarIgv — notas de crédito', () => {
  it('conserva el signo negativo aunque el desglose guardado sea positivo', () => {
    const d = desglosarIgv({ amount: -3109, notas: notas({ subtotal: 3100, igv: 9 }) });
    expect(d.total).toBe(-3109);
    expect(d.igv).toBeCloseTo(-9, 2);
    expect(d.subtotal).toBeCloseTo(-3100, 2);
    expect(d.tasaPct).toBeCloseTo(0.3, 1);
  });
});

describe('parseNotasSeguro', () => {
  it('devuelve objeto vacío ante cualquier basura', () => {
    [null, undefined, '', 'texto suelto', '{roto', '[1,2]', 42].forEach(v => {
      expect(parseNotasSeguro(v)).toEqual(v === 42 ? {} : expect.any(Object));
    });
    expect(parseNotasSeguro('texto suelto')).toEqual({});
    expect(parseNotasSeguro('{"a":1}')).toEqual({ a: 1 });
  });
});
