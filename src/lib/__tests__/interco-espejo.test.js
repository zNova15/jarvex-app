import { describe, it, expect } from 'vitest';
import {
  idsDelGrupo, esVentaInterna, espejoDeVenta, ventasSinEspejo, datosDelEspejo,
} from '../interco-espejo.js';
import { comprobantesSinOrden } from '../ordenes.js';

// El caso real de la obra Miraflores (8-set-2026): JARVEX le vendió 4 facturas
// a CONSORCIO EL INCA. La E001-1 está anulada por su nota de crédito; la E001-2
// no tiene espejo; la E001-3 y la E001-4 sí.
const JARVEX = { id: 'c-jarvex', name: 'JARVEX INGENIERIA', ruc: '20615646505', tipo_entidad: 'propia' };
const INCA = { id: 'c-inca', name: 'CONSORCIO EL INCA', ruc: '20615346081', tipo_entidad: 'consorcio' };
const SAMADAY = { id: 'c-samaday', name: 'CONSORCIO SAMADAY', ruc: '20612219479', tipo_entidad: 'tercero' };
const COMPANIES = [JARVEX, INCA, SAMADAY];
const OBRA = 'obra-miraflores';

const vta = (o = {}) => ({
  id: 'v', company_id: JARVEX.id, type: 'income', clase: 'venta',
  document_type: 'factura', document_number: 'E001-2', amount: 19028.68, currency: 'PEN',
  date: '2026-07-06', obra_id: OBRA, is_intercompany: true, related_company_id: INCA.id,
  third_party_name: INCA.name, third_party_ruc: INCA.ruc,
  notas: JSON.stringify({ subtotal: 16126, igv: 2902.68, items_factura: [{ descripcion: 'PICOS', cantidad: 40, precio_unitario: 45 }] }),
  ...o,
});

const esp = (o = {}) => ({
  id: 'e', company_id: INCA.id, type: 'cost', clase: 'compra',
  document_type: 'factura', document_number: 'E001-3', amount: 2551.16, currency: 'PEN',
  date: '2026-07-07', obra_id: OBRA, is_intercompany: true, related_company_id: JARVEX.id,
  related_movement_id: 'v3', third_party_ruc: JARVEX.ruc,
  notas: JSON.stringify({ intercompany_mirror_of: 'v3', desglose_heredado_de: 'v3' }),
  ...o,
});

describe('quién es del grupo', () => {
  it('propias y consorcios sí, terceros no', () => {
    const g = idsDelGrupo(COMPANIES);
    expect(g.has(JARVEX.id)).toBe(true);
    expect(g.has(INCA.id)).toBe(true);
    expect(g.has(SAMADAY.id)).toBe(false);
  });
});

describe('qué es una venta interna', () => {
  const g = idsDelGrupo(COMPANIES);

  it('la venta de JARVEX a EL INCA lo es', () => {
    expect(esVentaInterna(vta(), g)).toBe(true);
  });

  it('una nota de crédito no (no genera una compra nueva)', () => {
    expect(esVentaInterna(vta({ document_type: 'nota_credito', amount: 12920 }), g)).toBe(false);
  });

  it('contra un TERCERO no, aunque la factura diga interco (el catálogo manda)', () => {
    expect(esVentaInterna(vta({ related_company_id: SAMADAY.id }), g)).toBe(false);
  });

  it('una compra no es una venta', () => {
    expect(esVentaInterna(vta({ type: 'cost', clase: 'compra' }), g)).toBe(false);
  });

  it('sin marca de interco no', () => {
    expect(esVentaInterna(vta({ is_intercompany: false }), g)).toBe(false);
  });

  it('un movimiento borrado no', () => {
    expect(esVentaInterna(vta({ deleted_at: '2026-08-01' }), g)).toBe(false);
  });
});

describe('encontrar el espejo que ya existe', () => {
  it('por el vínculo directo', () => {
    const v = vta({ id: 'v3', document_number: 'E001-3' });
    expect(espejoDeVenta(v, [esp()])?.id).toBe('e');
  });

  it('por el puntero de las notas', () => {
    const v = vta({ id: 'v3', document_number: 'E001-3' });
    const e = esp({ related_movement_id: null });
    expect(espejoDeVenta(v, [e])?.id).toBe('e');
  });

  it('por el comprobante, anclado al RUC de la vendedora', () => {
    const v = vta({ id: 'v3', document_number: 'E001-3' });
    const cargadoAMano = esp({ related_movement_id: null, notas: '{}', is_intercompany: false, related_company_id: null });
    expect(espejoDeVenta(v, [cargadoAMano], { rucVendedora: JARVEX.ruc })?.id).toBe('e');
  });

  it('una compra EXTERNA del comprador con la misma serie NO tapa el hueco', () => {
    const v = vta({ id: 'v3', document_number: 'E001-3' });
    const ajena = esp({
      related_movement_id: null, notas: '{}', is_intercompany: false, related_company_id: null,
      third_party_ruc: '10771444020', amount: 443.68,
    });
    expect(espejoDeVenta(v, [ajena], { rucVendedora: JARVEX.ruc })).toBe(null);
  });

  it('un espejo en el libro de OTRA empresa no cuenta', () => {
    const v = vta({ id: 'v3', document_number: 'E001-3' });
    expect(espejoDeVenta(v, [esp({ company_id: SAMADAY.id })])).toBe(null);
  });
});

describe('las ventas internas a las que les falta el espejo', () => {
  const facturas = () => {
    const e1 = vta({ id: 'v1', document_number: 'E001-1', amount: 12920 });
    const nc1 = {
      id: 'nc1', company_id: JARVEX.id, type: 'income', clase: 'venta',
      document_type: 'nota_credito', document_number: 'E001-1', amount: -12920,
      date: '2026-07-06', obra_id: OBRA, is_intercompany: true, related_company_id: INCA.id,
      related_movement_id: 'v1', nota_motivo: 'Anulación de la operación', notas: '{}',
    };
    const e2 = vta({ id: 'v2', document_number: 'E001-2', amount: 19028.68 });
    const v3 = vta({ id: 'v3', document_number: 'E001-3', amount: 2551.16 });
    const m3 = esp({ id: 'e3', document_number: 'E001-3', amount: 2551.16 });
    const v4 = vta({ id: 'v4', document_number: 'E001-4', amount: 4184.28 });
    const m4 = esp({ id: 'e4', document_number: 'E001-4', amount: 4184.28, related_movement_id: 'v4',
      notas: JSON.stringify({ intercompany_mirror_of: 'v4' }) });
    return [e1, nc1, e2, v3, m3, v4, m4];
  };

  it('encuentra solo la E001-2: la anulada no lleva espejo y las otras dos ya lo tienen', () => {
    const r = ventasSinEspejo(facturas(), { companies: COMPANIES });
    expect(r).toHaveLength(1);
    expect(r[0].venta.id).toBe('v2');
    expect(r[0].monto).toBe(19028.68);
    expect(r[0].compradorId).toBe(INCA.id);
  });

  it('se acota al libro del comprador del ámbito', () => {
    expect(ventasSinEspejo(facturas(), { companies: COMPANIES, compradorIds: [INCA.id] })).toHaveLength(1);
    expect(ventasSinEspejo(facturas(), { companies: COMPANIES, compradorIds: [SAMADAY.id] })).toHaveLength(0);
  });

  it('se acota a la obra', () => {
    expect(ventasSinEspejo(facturas(), { companies: COMPANIES, obraId: OBRA })).toHaveLength(1);
    expect(ventasSinEspejo(facturas(), { companies: COMPANIES, obraId: 'otra-obra' })).toHaveLength(0);
  });

  it('las más caras primero', () => {
    const movs = [...facturas(), vta({ id: 'v5', document_number: 'E001-5', amount: 90000 })];
    expect(ventasSinEspejo(movs, { companies: COMPANIES }).map(x => x.monto)).toEqual([90000, 19028.68]);
  });
});

describe('los datos del espejo que se crea', () => {
  const d = () => datosDelEspejo(vta({ id: 'v2' }), { vendedora: JARVEX, compradora: INCA });

  it('es una COMPRA en el libro del comprador, marcada interna', () => {
    const e = d();
    expect(e.company_id).toBe(INCA.id);
    expect(e.clase).toBe('compra');
    expect(e.type).toBe('cost');          // la regla dura de las operaciones internas
    expect(e.is_intercompany).toBe(true);
    expect(e.related_company_id).toBe(JARVEX.id);
    expect(e.related_movement_id).toBe('v2');
  });

  it('copia el comprobante, el importe y la obra tal cual', () => {
    const e = d();
    expect(e.document_number).toBe('E001-2');
    expect(e.amount).toBe(19028.68);
    expect(e.currency).toBe('PEN');
    expect(e.obra_id).toBe(OBRA);
    expect(e.destino_contable).toBe('obra');
    expect(e.third_party_ruc).toBe(JARVEX.ruc);
  });

  it('hereda el desglose de base e IGV, pero NO copia los ítems', () => {
    const n = JSON.parse(d().notas);
    expect(n.subtotal).toBe(16126);
    expect(n.igv).toBe(2902.68);
    expect(n.desglose_heredado_de).toBe('v2');
    expect(n.intercompany_mirror_of).toBe('v2');
    expect(n.items_factura).toBeUndefined();
  });

  it('sigue la convención de los 95 espejos vivos: pagado y sin recepción', () => {
    expect(d().payment_status).toBe('paid');
    expect(d().recepcion_status).toBe('no_aplica');
  });

  it('y una vez creado, la factura aparece en «Sin respaldo»', () => {
    const espejoNuevo = { id: 'nuevo', ...d() };
    const pendientes = comprobantesSinOrden([espejoNuevo], [], { companyId: INCA.id, obraId: OBRA });
    expect(pendientes.map(m => m.document_number)).toEqual(['E001-2']);
  });
});
