// Dar de alta un comprobante a partir del corte de SUNAT (23-set-2026).
// El caso que lo originó: en enero-2026 de GASOMI faltan dos facturas del
// BANCO DE CRÉDITO DEL PERÚ que el portal no deja descargar, y sin ellas el
// total de NO GRAVADAS del Registro de Compras no cuadra.
import { describe, it, expect } from 'vitest';
import {
  sePuedeDarDeAlta, importeEnSuMoneda, borradorDesdeFila,
  movimientoDesdeCorte, avisosDelBorrador,
} from '../alta-desde-sunat.js';
import { desglosarIgv } from '../igv-desglose.js';

// La fila tal como sale de `compararLibro` para la comisión del BCP: una
// factura 100 % NO GRAVADA (base 0, IGV 0, no gravado 40,50).
const BCP = {
  estado: 'solo_sunat', movimientoId: null, libro: 'compras',
  tipoCp: '01', serie: 'FI01', numero: 17943297, documento: 'FI01-17943297',
  fecha: '2026-01-05',
  contraparteRuc: '20100047218', contraparteNombre: 'BANCO DE CREDITO DEL PERU',
  sunatBase: 0, sunatIgv: 0, sunatNoGravado: 40.50, sunatTotal: 40.50,
  moneda: 'PEN', tipoCambioSunat: null,
};

// Una en dólares, para el otro lado de la regla 11: SUNAT manda el importe ya
// convertido a soles y el TC aparte.
const KOPLAST = {
  ...BCP, serie: 'F003', numero: 3384, documento: 'F003-3384',
  contraparteRuc: '20505543174', contraparteNombre: 'KOPLAST INDUSTRIAL S.A.C',
  sunatBase: 236949.15, sunatIgv: 42650.85, sunatNoGravado: 0, sunatTotal: 279600,
  moneda: 'USD', tipoCambioSunat: 3.495,
};

describe('qué fila se puede dar de alta', () => {
  it('solo las que SUNAT tiene y JARVEX no', () => {
    expect(sePuedeDarDeAlta(BCP)).toBe(true);
    expect(sePuedeDarDeAlta({ ...BCP, estado: 'cuadra' })).toBe(false);
    expect(sePuedeDarDeAlta({ ...BCP, estado: 'importe_distinto' })).toBe(false);
  });

  it('nunca una que ya tiene su movimiento del otro lado', () => {
    expect(sePuedeDarDeAlta({ ...BCP, movimientoId: 'm1' })).toBe(false);
  });

  it('ni una sin número de comprobante: no habría qué registrar', () => {
    expect(sePuedeDarDeAlta({ ...BCP, serie: '', numero: 0 })).toBe(false);
  });
});

describe('el importe vuelve a la moneda del comprobante', () => {
  it('en soles se copia tal cual', () => {
    expect(importeEnSuMoneda({ total: 40.5, moneda: 'PEN' }))
      .toEqual({ amount: 40.5, currency: 'PEN', tipoCambio: null });
  });

  it('en dólares se DIVIDE por el TC del archivo (regla 11)', () => {
    // Sin esto, US$ 80.000 entrarían como US$ 279.600 y el mismo cotejo que
    // acaba de crear la factura la marcaría como «importe distinto».
    const r = importeEnSuMoneda({ total: 279600, moneda: 'USD', tipoCambio: 3.495 });
    expect(r.amount).toBe(80000);
    expect(r.currency).toBe('USD');
    expect(r.tipoCambio).toBe(3.495);
  });

  it('en otra moneda sin TC no inventa una conversión', () => {
    const r = importeEnSuMoneda({ total: 279600, moneda: 'USD', tipoCambio: 0 });
    expect(r.amount).toBe(279600);
    expect(r.tipoCambio).toBe(null);
  });
});

describe('el borrador que se revisa antes de confirmar', () => {
  it('trae el comprobante, el tercero y el desglose del archivo', () => {
    const b = borradorDesdeFila(BCP, { periodo: '202601' });
    expect(b.documentType).toBe('factura');
    expect(b.documentNumber).toBe('FI01-17943297');
    expect(b.date).toBe('2026-01-05');
    expect(b.ruc).toBe('20100047218');
    expect(b.base).toBe(0);
    expect(b.igv).toBe(0);
    expect(b.noGravado).toBe(40.5);
    expect(b.amount).toBe(40.5);
    expect(b.periodoDeclarado).toBe('202601');
  });

  it('en dólares, el desglose también vuelve a la moneda del comprobante', () => {
    const b = borradorDesdeFila(KOPLAST, { periodo: '202606' });
    expect(b.currency).toBe('USD');
    expect(b.amount).toBe(80000);
    expect(b.base).toBe(67796.61);
    expect(b.igv).toBe(12203.39);
    // Y el desglose sigue sumando el total, que es lo que pide el Libro Diario.
    expect(Math.round((b.base + b.igv) * 100) / 100).toBe(b.amount);
  });

  it('la nota de crédito se reconoce por el tipo de la Tabla 10', () => {
    expect(borradorDesdeFila({ ...BCP, tipoCp: '07' }).documentType).toBe('nota_credito');
  });
});

describe('el movimiento que se guarda', () => {
  const alta = (extra = {}) => movimientoDesdeCorte(
    { ...borradorDesdeFila(BCP, { periodo: '202601' }), ...extra },
    { companyId: 'gasomi', libro: 'compras', periodo: '202601' },
  );

  it('nace marcado como «falta el comprobante», con su motivo', () => {
    const m = alta({ faltaComprobanteMotivo: 'El portal no deja descargar los del banco' });
    expect(m.falta_comprobante).toBe(true);
    expect(m.falta_comprobante_motivo).toBe('El portal no deja descargar los del banco');
  });

  it('es una compra de la empresa del corte, pendiente de pago y sin recepción', () => {
    const m = alta();
    expect(m.company_id).toBe('gasomi');
    expect(m.clase).toBe('compra');
    expect(m.payment_status).toBe('pending');
    expect(m.recepcion_status).toBe('no_aplica');
    expect(m.is_intercompany).toBe(false);
    expect(m.document_number).toBe('FI01-17943297');
  });

  it('cae en la bandeja de la Contadora Jefe: se registró sin saber qué es', () => {
    expect(alta().destino_contable).toBe('sin_clasificar');
    expect(alta({ destinoSel: '__empresa__' }).destino_contable).toBe('gastos_generales');
    expect(alta({ destinoSel: '__empresa__' }).type).toBe('expense');
  });

  it('guarda el desglose CON `no_gravado`, que es el dato que faltaba', () => {
    const m = alta();
    const n = JSON.parse(m.notas);
    expect(n.no_gravado).toBe(40.5);
    expect(n.subtotal).toBe(0);
    expect(n.alta_desde_sunat).toBe(true);
    // Y la prueba de fondo: leído de vuelta, el comprobante es 100 % no
    // gravado en vez de estimarse al 18 %.
    const dg = desglosarIgv(m);
    expect(dg.origen).toBe('comprobante');
    expect(dg.igv).toBe(0);
    expect(dg.baseGravada).toBe(0);
    expect(dg.noGravado).toBe(40.5);
  });

  it('el período declarado solo se guarda cuando NO es el de la emisión', () => {
    // Enero emitido, enero declarado → no es una excepción, no se guarda nada.
    expect(alta().periodo_declarado).toBe(null);
    // Febrero emitido, junio declarado → eso sí hay que recordarlo.
    expect(alta({ periodoDeclarado: '202606' }).periodo_declarado).toBe('202606');
  });

  it('una nota de crédito entra en negativo', () => {
    const b = borradorDesdeFila({ ...BCP, tipoCp: '07' }, { periodo: '202601' });
    expect(movimientoDesdeCorte(b, { companyId: 'gasomi', libro: 'compras' }).amount).toBe(-40.5);
  });

  it('una venta se registra como venta y da ingreso', () => {
    const b = borradorDesdeFila(BCP, { periodo: '202601' });
    const m = movimientoDesdeCorte(b, { companyId: 'gasomi', libro: 'ventas' });
    expect(m.clase).toBe('venta');
    expect(m.type).toBe('income');
  });
});

describe('los avisos previos a confirmar', () => {
  it('una fila sana no avisa nada', () => {
    expect(avisosDelBorrador(borradorDesdeFila(BCP))).toEqual([]);
  });

  it('avisa cuando el desglose no suma el total', () => {
    const b = { ...borradorDesdeFila(BCP), base: 10 };
    expect(avisosDelBorrador(b).join(' ')).toMatch(/no suma el total/);
  });

  it('avisa por el RUC incompleto y por la moneda sin tipo de cambio', () => {
    expect(avisosDelBorrador({ ...borradorDesdeFila(BCP), ruc: '123' }).join(' ')).toMatch(/11 dígitos/);
    expect(avisosDelBorrador({ ...borradorDesdeFila(BCP), currency: 'USD', tipoCambio: null }).join(' '))
      .toMatch(/tipo de cambio/);
  });
});

describe('tanda F — el alta reconoce una operación entre empresas del grupo', () => {
  const b = {
    documentType: 'factura', documentNumber: 'E001-1', date: '2026-07-06', amount: 12920,
    base: 10949.15, igv: 1970.85, noGravado: 0, currency: 'PEN', ruc: '20615646505', nombre: 'JARVEX',
  };
  const companies = [
    { id: 'jarvex', ruc: '20615646505' },
    { id: 'elinca', ruc: '20615346081' },
  ];
  it('si el RUC de la contraparte es de otra empresa del grupo, nace intercompany y enlazada', () => {
    const m = movimientoDesdeCorte(b, { companyId: 'elinca', libro: 'compras', companies });
    expect(m.is_intercompany).toBe(true);
    expect(m.related_company_id).toBe('jarvex');
  });
  it('con un tercero sigue como antes', () => {
    const m = movimientoDesdeCorte({ ...b, ruc: '20100047218' }, { companyId: 'elinca', libro: 'compras', companies });
    expect(m.is_intercompany).toBe(false);
    expect(m.related_company_id).toBe(null);
  });
});
