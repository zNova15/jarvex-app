import { describe, it, expect } from 'vitest';
import {
  esNota, esNotaCredito, motivoEsAnulacion, motivoDeNota,
  notasPorFactura, anulaFacturaCompleta, avisoSerieRepetida, candidatasDeNota,
} from '../notas-credito.js';

const FAC = (id, document_number, amount, extra = {}) =>
  ({ id, document_number, amount, document_type: 'factura', ...extra });
const NC = (id, document_number, amount, related_movement_id, extra = {}) =>
  ({ id, document_number, amount, document_type: 'nota_credito', related_movement_id, ...extra });

describe('notas-credito — clasificación', () => {
  it('reconoce notas de crédito y débito', () => {
    expect(esNota({ document_type: 'nota_credito' })).toBe(true);
    expect(esNota({ document_type: 'nota_debito' })).toBe(true);
    expect(esNota({ document_type: 'factura' })).toBe(false);
    expect(esNota({})).toBe(false);            // sin tipo = factura
    expect(esNotaCredito({ document_type: 'nota_debito' })).toBe(false);
  });
  it('detecta el motivo de anulación en las formas que usa SUNAT', () => {
    expect(motivoEsAnulacion('ANULACION DE LA OPERACION')).toBe(true);
    expect(motivoEsAnulacion('Anulación de la operación')).toBe(true);
    expect(motivoEsAnulacion('dejar sin efecto el comprobante')).toBe(true);
    expect(motivoEsAnulacion('descuento por pronto pago')).toBe(false);
    expect(motivoEsAnulacion('')).toBe(false);
  });
  it('saca el motivo del JSON de notas que deja Captura Mágica', () => {
    expect(motivoDeNota({ notas: '{"nota_motivo":"anulación de la operación"}' }))
      .toBe('anulación de la operación');
    expect(motivoDeNota({ notas: 'texto libre, no JSON' })).toBe('');
    expect(motivoDeNota({ nota_motivo: 'descuento' })).toBe('descuento');
    expect(motivoDeNota(null)).toBe('');
  });
});

describe('notas-credito — notasPorFactura', () => {
  it('marca ANULADA cuando la nota cubre el total de la factura', () => {
    const m = notasPorFactura([
      FAC('f1', 'E001-1', 12920),
      NC('n1', 'E001-1', -12920, 'f1', { notas: '{"nota_motivo":"ANULACION DE LA OPERACION"}' }),
    ]);
    const e = m.get('f1');
    expect(e.anulada).toBe(true);
    expect(e.parcial).toBe(false);
    expect(e.etiqueta).toBe('ANULADA por la nota de crédito E001-1');
    expect(e.notas[0].anulaMotivo).toBe(true);
  });
  it('una nota parcial REBAJA, no anula', () => {
    const m = notasPorFactura([FAC('f1', 'F001-9', 9000), NC('n1', 'E001-5', -900, 'f1')]);
    const e = m.get('f1');
    expect(e.anulada).toBe(false);
    expect(e.parcial).toBe(true);
    expect(e.etiqueta).toMatch(/^Rebajada por nota de crédito E001-5/);
  });
  it('varias notas parciales que suman el total SÍ anulan', () => {
    const m = notasPorFactura([
      FAC('f1', 'F001-9', 1000),
      NC('n1', 'E001-5', -600, 'f1'),
      NC('n2', 'E001-6', -400, 'f1'),
    ]);
    const e = m.get('f1');
    expect(e.anulada).toBe(true);
    expect(e.totalNotas).toBe(1000);
    expect(e.etiqueta).toBe('ANULADA por las notas de crédito E001-5, E001-6');
  });
  it('la NC espejo intercompany (apunta a otra NC) NO anula nada', () => {
    const m = notasPorFactura([
      FAC('f1', 'E001-1', 9000),
      NC('n1', 'E001-5', -9000, 'f1'),
      NC('n2', 'E001-5', -9000, 'n1'),   // espejo: su related es la OTRA nota
    ]);
    expect(m.get('f1').totalNotas).toBe(9000);   // la espejo no suma dos veces
    expect(m.has('n1')).toBe(false);
  });
  it('ignora notas borradas y notas sin vínculo', () => {
    const m = notasPorFactura([
      FAC('f1', 'F001-9', 1000),
      NC('n1', 'E001-5', -1000, 'f1', { deleted_at: '2026-09-01' }),
      NC('n2', 'E001-6', -1000, null),
    ]);
    expect(m.size).toBe(0);
  });
  it('una nota de DÉBITO no anula (suma, no resta)', () => {
    const m = notasPorFactura([
      FAC('f1', 'F001-9', 1000),
      { id: 'n1', document_number: 'ND-1', amount: 200, document_type: 'nota_debito', related_movement_id: 'f1' },
    ]);
    expect(m.size).toBe(0);
  });
});

describe('notas-credito — anulaFacturaCompleta', () => {
  const factura = { amount: -12920.00 };
  it('monto igual + motivo de anulación → revisión innecesaria', () => {
    const r = anulaFacturaCompleta({ total: 12920, motivo: 'ANULACION DE LA OPERACION', factura });
    expect(r.esAnulacionTotal).toBe(true);
    expect(r.montoCuadra).toBe(true);
    expect(r.porMotivo).toBe(true);
    expect(r.totalFactura).toBe(12920);
  });
  it('monto distinto → NO es anulación total aunque el motivo lo diga', () => {
    const r = anulaFacturaCompleta({ total: 900, motivo: 'anulación', factura });
    expect(r.esAnulacionTotal).toBe(false);
    expect(r.montoCuadra).toBe(false);
  });
  it('sin la factura en el sistema no se da por cerrada', () => {
    const r = anulaFacturaCompleta({ total: 12920, motivo: 'anulación', factura: null });
    expect(r.esAnulacionTotal).toBe(false);
    expect(r.totalFactura).toBe(0);
  });
  it('tolera el céntimo de redondeo', () => {
    expect(anulaFacturaCompleta({ total: 12920.03, motivo: 'anulación', factura }).esAnulacionTotal).toBe(true);
  });
});

describe('notas-credito — avisoSerieRepetida', () => {
  it('avisa (sin bloquear) cuando la nota y la factura comparten número', () => {
    const a = avisoSerieRepetida({ serieNota: 'E001-1', serieFactura: 'e001-1' });
    expect(a).toMatch(/Es válido/);
    expect(a).toMatch(/E001-1/);
  });
  it('sin coincidencia no hay aviso', () => {
    expect(avisoSerieRepetida({ serieNota: 'E001-2', serieFactura: 'E001-1' })).toBe(null);
    expect(avisoSerieRepetida({ serieNota: '', serieFactura: 'E001-1' })).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════
// A QUÉ FACTURA PUEDE APUNTAR UNA NOTA HUÉRFANA (tanda 18, entrega B)
//
// 11 de las 19 notas de crédito vivas al 9-set-2026 no tienen factura
// enlazada: no rebajan nada y la factura que anulan sigue contando entera.
// La app PROPONE candidatas; elegir la sigue eligiendo una persona contra el
// PDF, porque de esas 11 solo 6 tenían una sola candidata posible.
// ═══════════════════════════════════════════════════════════════════
describe('notas-credito — candidatasDeNota', () => {
  const EMP = 'emp-1';
  const RUC = '20112273922';
  const mov = (id, doc, amount, date, extra = {}) => ({
    id, document_number: doc, amount, date, company_id: EMP,
    third_party_ruc: RUC, document_type: 'factura', ...extra,
  });
  const nota = (amount, date, extra = {}) => ({
    id: 'nc', document_number: 'F748-7773', amount, date, company_id: EMP,
    third_party_ruc: RUC, document_type: 'nota_credito', ...extra,
  });

  it('propone las facturas del mismo proveedor que alcanzan a cubrirla', () => {
    const movs = [
      mov('f1', 'F748-100', 2000, '2026-05-01'),
      mov('f2', 'F748-200', 1019.90, '2026-05-10'),
    ];
    const r = candidatasDeNota(nota(-1019.90, '2026-05-12'), movs);
    expect(r).toHaveLength(2);
    // La del importe EXACTO manda: una anulación total cubre justo la factura.
    expect(r[0].documento).toBe('F748-200');
    expect(r[0].exacta).toBe(true);
  });

  it('no propone facturas posteriores a la nota', () => {
    const movs = [mov('f', 'F748-300', 5000, '2026-06-01')];
    expect(candidatasDeNota(nota(-100, '2026-05-12'), movs)).toHaveLength(0);
  });

  it('no propone una factura que no alcanza a cubrir la nota', () => {
    const movs = [mov('f', 'F748-300', 50, '2026-05-01')];
    expect(candidatasDeNota(nota(-1000, '2026-05-12'), movs)).toHaveLength(0);
  });

  it('no cruza proveedores ni empresas', () => {
    const movs = [
      mov('otro-ruc', 'F001-1', 9000, '2026-05-01', { third_party_ruc: '20999999999' }),
      mov('otra-emp', 'F001-2', 9000, '2026-05-01', { company_id: 'emp-2' }),
    ];
    expect(candidatasDeNota(nota(-100, '2026-05-12'), movs)).toHaveLength(0);
  });

  it('una nota no puede apuntar a otra nota', () => {
    const movs = [mov('n2', 'F748-400', 9000, '2026-05-01', { document_type: 'nota_credito' })];
    expect(candidatasDeNota(nota(-100, '2026-05-12'), movs)).toHaveLength(0);
  });

  it('sin RUC no se propone nada: adivinar sería peor que no proponer', () => {
    const movs = [mov('f', 'F748-500', 9000, '2026-05-01')];
    expect(candidatasDeNota(nota(-100, '2026-05-12', { third_party_ruc: '' }), movs)).toHaveLength(0);
  });

  it('a igual importe, primero la más cercana en fecha', () => {
    const movs = [
      mov('vieja', 'F748-1', 5000, '2026-01-01'),
      mov('nueva', 'F748-2', 5000, '2026-05-01'),
    ];
    const r = candidatasDeNota(nota(-100, '2026-05-12'), movs);
    expect(r[0].documento).toBe('F748-2');
  });
});
