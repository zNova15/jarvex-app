import { describe, it, expect } from 'vitest';
import { comprobantesImputacionCruzada, idsImputacionCruzada } from '../imputacion-cruzada.js';

// Caso de producción (4-sep-2026): Miraflores, ejecutada por CONSORCIO EL INCA,
// con comprobantes facturados a CONSORCIO CHUSAAC (titular de San Marcos, OTRA
// obra) y CONSORCIO ESPERANZA (tercero puro, sin obra).
const MIRAFLORES = 'obra-miraflores';
const SAN_MARCOS = 'obra-san-marcos';
const EL_INCA = 'company-el-inca';
const CHUSAAC = 'company-chusaac';
const ESPERANZA = 'company-esperanza';
const JARVEX = 'company-jarvex';
const JADE = 'company-jade';

const obras = [
  { id: MIRAFLORES, ejecutora_tipo: 'consorcio', ejecutora_company_id: EL_INCA },
  { id: SAN_MARCOS, ejecutora_tipo: 'consorcio', ejecutora_company_id: CHUSAAC },
];
const consorcios = [
  { id: 'c-inca', obra_id: MIRAFLORES, company_id: EL_INCA },
  { id: 'c-chusaac', obra_id: SAN_MARCOS, company_id: CHUSAAC },
];
const companies = [
  { id: EL_INCA, ruc: '20615346081', tipo_entidad: 'consorcio' },
  { id: CHUSAAC, ruc: '20613408011', tipo_entidad: 'consorcio' },
  { id: ESPERANZA, ruc: '20611547367', tipo_entidad: 'tercero' },
  { id: JARVEX, ruc: '20601234561', tipo_entidad: 'propia' },
  { id: JADE, ruc: '20601234562', tipo_entidad: 'propia' },
];

const mov = (o = {}) => ({
  id: `m-${Math.random()}`, obra_id: MIRAFLORES, company_id: JARVEX,
  type: 'income', clase: 'venta', ...o,
});

describe('comprobantesImputacionCruzada', () => {
  it('flaggea una venta a un consorcio que es titular de OTRA obra', () => {
    const m = mov({ third_party_ruc: '20613408011' }); // RUC de CHUSAAC
    const out = comprobantesImputacionCruzada({ movs: [m], companies, obras, consorcios, socios: [] });
    expect(out.size).toBe(1);
    expect(out.get(m.id).contraparte.id).toBe(CHUSAAC);
  });

  it('flaggea una venta a un tercero puro (sin obra propia)', () => {
    const m = mov({ third_party_ruc: '20611547367' }); // RUC de ESPERANZA
    const out = comprobantesImputacionCruzada({ movs: [m], companies, obras, consorcios, socios: [] });
    expect(out.size).toBe(1);
    expect(out.get(m.id).contraparte.id).toBe(ESPERANZA);
  });

  it('NO flaggea una venta al propio titular de la obra', () => {
    const m = mov({ third_party_ruc: '20615346081' }); // RUC de EL INCA (su titular)
    const out = comprobantesImputacionCruzada({ movs: [m], companies, obras, consorcios, socios: [] });
    expect(out.size).toBe(0);
  });

  it('NO flaggea una operación entre dos companies propias del grupo (cadena intercompany normal)', () => {
    // GASOMI→JHEENSEG en producción: ninguna es consorcio ni tercero.
    const m = mov({ company_id: JARVEX, third_party_ruc: '20601234562' }); // RUC de JADE (propia)
    const out = comprobantesImputacionCruzada({ movs: [m], companies, obras, consorcios, socios: [] });
    expect(out.size).toBe(0);
  });

  it('NO flaggea a un socio del consorcio de la obra', () => {
    const m = mov({ related_company_id: JADE });
    const socios = [{ consorcio_id: 'c-inca', company_id: JADE }];
    const out = comprobantesImputacionCruzada({ movs: [m], companies, obras, consorcios, socios });
    expect(out.size).toBe(0);
  });

  it('ignora comprobantes borrados, sin obra, o sin contraparte identificable', () => {
    const borrado = mov({ third_party_ruc: '20613408011', deleted_at: '2026-01-01' });
    const sinObra = mov({ third_party_ruc: '20613408011', obra_id: null });
    const proveedorExterno = mov({ third_party_ruc: '10999999999' }); // no está en companies
    const out = comprobantesImputacionCruzada({
      movs: [borrado, sinObra, proveedorExterno], companies, obras, consorcios, socios: [],
    });
    expect(out.size).toBe(0);
  });

  it('NO se restringe a ventas: una compra imputada a la obra equivocada también se detecta', () => {
    const m = mov({ clase: 'compra', type: 'expense', third_party_ruc: '20613408011' });
    const out = comprobantesImputacionCruzada({ movs: [m], companies, obras, consorcios, socios: [] });
    expect(out.size).toBe(1);
  });

  it('funciona para una obra ejecutada directamente por una empresa (sin fila en consorcios)', () => {
    const obraDirecta = { id: 'obra-directa', ejecutora_tipo: 'empresa', ejecutora_company_id: JARVEX };
    const m = mov({ obra_id: 'obra-directa', third_party_ruc: '20611547367' }); // ESPERANZA
    const out = comprobantesImputacionCruzada({
      movs: [m], companies, obras: [obraDirecta], consorcios: [], socios: [],
    });
    expect(out.size).toBe(1);
  });

  it('idsImputacionCruzada da el mismo resultado como Set de ids', () => {
    const m = mov({ third_party_ruc: '20613408011' });
    const ids = idsImputacionCruzada({ movs: [m], companies, obras, consorcios, socios: [] });
    expect(ids).toEqual(new Set([m.id]));
  });
});
