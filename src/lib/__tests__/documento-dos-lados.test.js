// Tests de "un comprobante, dos libros" (pedido de Gabriel, 4-sep-2026).
//
// El caso real: las notas de crédito que anulan facturas mal emitidas nombran
// a dos entidades del grupo, se cargan de un solo lado y del otro no se ven.
// El escenario de referencia calca los datos de producción medidos ese día.
import { describe, it, expect } from 'vitest';
import {
  reflejosPorEmpresa, reflejosDe, ladosDeDocumento, indiceEmpresas,
  vinculoAfirmado, rucLimpio,
} from '../documento-dos-lados.js';

const GASOMI   = { id: 'gasomi', name: 'GASOMI INGENIEROS E.I.R.L.', ruc: '20600097726', tipo_entidad: 'propia' };
const JARVEX   = { id: 'jarvex', name: 'JARVEX', ruc: '20615646505', tipo_entidad: 'propia' };
const SAMADAY  = { id: 'samaday', name: 'CONSORCIO SAMADAY', ruc: '20612219479', tipo_entidad: 'tercero' };
const EL_INCA  = { id: 'inca', name: 'CONSORCIO EL INCA', ruc: '20615346081', tipo_entidad: 'consorcio' };
const MUNI     = { id: 'muni', name: 'MUNICIPALIDAD DE NAMORA', ruc: '20143625681', tipo_entidad: 'tercero' };
const COMPANIES = [GASOMI, JARVEX, SAMADAY, EL_INCA, MUNI];

const mov = (o) => ({ currency: 'PEN', payment_status: 'paid', deleted_at: null, ...o });

// La NC que originó el pedido: GASOMI se la emitió a SAMADAY y solo está en
// el libro de GASOMI.
const NC_SAMADAY = mov({
  id: 'nc64', company_id: 'gasomi', type: 'income', clase: 'venta', amount: -3109,
  document_type: 'nota_credito', document_number: 'E001-64', date: '2026-06-15',
  is_intercompany: true, related_company_id: 'samaday', third_party_ruc: '20612219479',
  third_party_name: 'CONSORCIO SAMADAY',
});

describe('rucLimpio', () => {
  it('acepta solo RUC de 11 dígitos', () => {
    expect(rucLimpio('20612219479')).toBe('20612219479');
    expect(rucLimpio('20-612219479')).toBe('20612219479');
    expect(rucLimpio('00000000')).toBe(null);
    expect(rucLimpio(null)).toBe(null);
  });
});

describe('ladosDeDocumento', () => {
  const idx = indiceEmpresas(COMPANIES);

  it('resuelve la contraparte por related_company_id', () => {
    const l = ladosDeDocumento(NC_SAMADAY, idx);
    expect(l.titular).toBe('gasomi');
    expect(l.contraparte).toBe('samaday');
    expect(l.via).toBe('related_company_id');
    expect(l.dosLados).toBe(true);
  });

  it('resuelve la contraparte por RUC cuando no hay vínculo cargado', () => {
    const m = mov({ id: 'x', company_id: 'gasomi', type: 'income', amount: 100,
      is_intercompany: true, third_party_ruc: '20615346081' });
    const l = ladosDeDocumento(m, idx);
    expect(l.contraparte).toBe('inca');
    expect(l.via).toBe('ruc');
  });

  it('sin vínculo afirmado no hay segundo lado, aunque el RUC esté en el catálogo', () => {
    const m = mov({ id: 'x', company_id: 'gasomi', type: 'cost', amount: 100,
      third_party_ruc: '20143625681' });   // la municipalidad existe en companies
    const l = ladosDeDocumento(m, idx);
    expect(l.contraparte).toBe('muni');
    expect(l.dosLados).toBe(false);
  });

  it('un proveedor que no está en el catálogo no tiene segundo lado', () => {
    const m = mov({ id: 'x', company_id: 'gasomi', type: 'cost', amount: 100,
      is_intercompany: true, third_party_ruc: '20999999999' });
    expect(ladosDeDocumento(m, idx).contraparte).toBe(null);
    expect(ladosDeDocumento(m, idx).dosLados).toBe(false);
  });

  it('vinculoAfirmado: la casilla interna o el vínculo cargado', () => {
    expect(vinculoAfirmado({ is_intercompany: true })).toBe(true);
    expect(vinculoAfirmado({ related_company_id: 'x' })).toBe(true);
    expect(vinculoAfirmado({ third_party_ruc: '20612219479' })).toBe(false);
  });
});

describe('reflejosPorEmpresa', () => {
  it('la NC de GASOMI a SAMADAY se ve desde el libro de SAMADAY', () => {
    const r = reflejosPorEmpresa({ movs: [NC_SAMADAY], companies: COMPANIES });
    const { ids, filas } = reflejosDe('samaday', r);
    expect(ids.has('nc64')).toBe(true);
    expect(filas[0].titularNombre).toBe('GASOMI INGENIEROS E.I.R.L.');
    expect(filas[0].mov.document_number).toBe('E001-64');
  });

  it('el titular NO recibe reflejo de su propio comprobante', () => {
    const r = reflejosPorEmpresa({ movs: [NC_SAMADAY], companies: COMPANIES });
    expect(reflejosDe('gasomi', r).ids.size).toBe(0);
  });

  it('que la contraparte sea "tercero" no la deja sin ver el documento', () => {
    // Es el punto del pedido: ESPERANZA y SAMADAY se consolidan como terceros
    // y aun así el papel que las nombra es suyo también.
    const r = reflejosPorEmpresa({ movs: [NC_SAMADAY], companies: COMPANIES });
    expect(reflejosDe('samaday', r).filas.length).toBe(1);
  });

  it('si la contraparte YA tiene el espejo cargado, no hay reflejo (no se duplica)', () => {
    const espejo = mov({ id: 'esp', company_id: 'samaday', type: 'cost', amount: -3109,
      document_number: 'E001-64', related_movement_id: 'nc64', is_intercompany: true,
      related_company_id: 'gasomi' });
    const r = reflejosPorEmpresa({ movs: [NC_SAMADAY, espejo], companies: COMPANIES });
    expect(reflejosDe('samaday', r).ids.size).toBe(0);
  });

  it('el espejo sin vínculo, emparejado por documento e importe, tampoco duplica', () => {
    const espejo = mov({ id: 'esp', company_id: 'samaday', type: 'cost', amount: -3109,
      document_number: 'E001-64' });
    const r = reflejosPorEmpresa({ movs: [NC_SAMADAY, espejo], companies: COMPANIES });
    expect(reflejosDe('samaday', r).ids.size).toBe(0);
  });

  it('el vínculo escrito del lado del comprador cuenta para los dos lados', () => {
    // jx-contabilidad escribe related_movement_id SOLO del lado que compra;
    // preguntado desde el vendedor, el par tiene que verse igual.
    const venta = mov({ id: 'v', company_id: 'jarvex', type: 'income', amount: 12920,
      document_number: 'E001-1', is_intercompany: true, related_company_id: 'inca' });
    const compra = mov({ id: 'c', company_id: 'inca', type: 'cost', amount: 12920,
      document_number: 'E001-1', related_movement_id: 'v', is_intercompany: true,
      related_company_id: 'jarvex' });
    const r = reflejosPorEmpresa({ movs: [venta, compra], companies: COMPANIES });
    expect(reflejosDe('inca', r).ids.size).toBe(0);
    expect(reflejosDe('jarvex', r).ids.size).toBe(0);
  });

  it('la factura huérfana de JARVEX se ve desde EL INCA hasta que exista su espejo', () => {
    const venta = mov({ id: 'e1', company_id: 'jarvex', type: 'income', amount: 12920,
      document_number: 'E001-1', date: '2026-07-06', is_intercompany: true,
      related_company_id: 'inca' });
    const r = reflejosPorEmpresa({ movs: [venta], companies: COMPANIES });
    expect(reflejosDe('inca', r).ids.has('e1')).toBe(true);
  });

  it('los borrados no generan reflejos', () => {
    const r = reflejosPorEmpresa({ movs: [{ ...NC_SAMADAY, deleted_at: '2026-07-01' }], companies: COMPANIES });
    expect(reflejosDe('samaday', r).ids.size).toBe(0);
  });

  it('una compra a un proveedor de la calle no aparece en ningún otro libro', () => {
    const compra = mov({ id: 'p', company_id: 'gasomi', type: 'cost', amount: 500,
      third_party_ruc: '20505543174', third_party_name: 'KOPLAST', document_number: 'FC03-1' });
    const r = reflejosPorEmpresa({ movs: [compra], companies: COMPANIES });
    expect([...r.keys()].length).toBe(0);
  });

  it('reflejosDe devuelve vacío para una empresa sin reflejos o sin mapa', () => {
    expect(reflejosDe('muni', new Map()).filas).toEqual([]);
    expect(reflejosDe(null, null).ids.size).toBe(0);
  });

  it('ordena los reflejos por fecha descendente', () => {
    const viejo = mov({ id: 'v1', company_id: 'gasomi', type: 'income', amount: -1,
      date: '2026-01-01', document_number: 'E001-1', is_intercompany: true, related_company_id: 'samaday' });
    const nuevo = mov({ id: 'v2', company_id: 'gasomi', type: 'income', amount: -2,
      date: '2026-08-01', document_number: 'E001-2', is_intercompany: true, related_company_id: 'samaday' });
    const r = reflejosPorEmpresa({ movs: [viejo, nuevo], companies: COMPANIES });
    expect(reflejosDe('samaday', r).filas.map(f => f.mov.id)).toEqual(['v2', 'v1']);
  });
});
