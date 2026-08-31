import { describe, it, expect } from 'vitest';
import { normalizarDoc, matchFacturaDeGuia } from '../guias.js';

describe('normalizarDoc', () => {
  it('parsea F001-025131 quitando ceros del correlativo', () => {
    expect(normalizarDoc('F001-025131')).toEqual({ serie: 'F001', correlativo: 25131 });
  });
  it('tolera espacios, slash y minúsculas', () => {
    expect(normalizarDoc('f001 / 25131')).toEqual({ serie: 'F001', correlativo: 25131 });
    expect(normalizarDoc('T001 - 000309')).toEqual({ serie: 'T001', correlativo: 309 });
  });
  it('devuelve null si no parsea', () => {
    expect(normalizarDoc('')).toBeNull();
    expect(normalizarDoc('sin numero')).toBeNull();
    expect(normalizarDoc(null)).toBeNull();
  });
});

describe('matchFacturaDeGuia', () => {
  const movs = [
    { id: 'a', document_number: 'F001-025131', third_party_ruc: '20536265644' },
    { id: 'b', document_number: 'F001-024496', third_party_ruc: '20536265644' },
    { id: 'c', document_number: 'B002-025131', third_party_ruc: '10999999999' },
  ];
  it('match exacto serie+correlativo+ruc → alta', () => {
    const r = matchFacturaDeGuia({ doc_referencia: 'F001-025131', emisor_ruc: '20536265644' }, movs);
    expect(r.mov.id).toBe('a');
    expect(r.confianza).toBe('alta');
  });
  it('sin RUC en la guía → media (serie+correlativo alcanzan)', () => {
    const r = matchFacturaDeGuia({ doc_referencia: 'F001-25131' }, movs);
    expect(r.mov.id).toBe('a');
    expect(r.confianza).toBe('media');
  });
  it('correlativo igual pero serie distinta NO matchea en alta (B002 vs F001 con ruc distinto)', () => {
    const r = matchFacturaDeGuia({ doc_referencia: 'F001-025131', emisor_ruc: '20536265644' }, movs);
    expect(r.mov.id).toBe('a');   // no elige el c
  });
  it('sin referencia → null; factura borrada se ignora', () => {
    expect(matchFacturaDeGuia({ doc_referencia: '' }, movs)).toBeNull();
    expect(matchFacturaDeGuia({ doc_referencia: 'F001-024496' }, [{ ...movs[1], deleted_at: 'x' }])).toBeNull();
  });
  it('RUC contradicho (misma serie, OTRO emisor) → NO auto-vincula', () => {
    const soloOtroEmisor = [{ id: 'z', document_number: 'F001-2513', third_party_ruc: '20111111111' }];
    expect(matchFacturaDeGuia({ doc_referencia: 'F001-2513', emisor_ruc: '20999999999' }, soloOtroEmisor)).toBeNull();
  });
  it('ambigüedad (dos candidatos mismo score) → null (no auto-vincular)', () => {
    const dup = [
      { id: 'x', document_number: 'F001-100', third_party_ruc: '' },
      { id: 'y', document_number: 'F001-100', third_party_ruc: '' },
    ];
    expect(matchFacturaDeGuia({ doc_referencia: 'F001-100' }, dup)).toBeNull();
  });
});

// ── Nuevas funciones (pedido contadoras 31-ago) ──────────────────────
import { clasificarOrigenGuia, facturasQueRequierenGuia, sugerirGuiasParaFactura } from '../guias.js';

const RUCS_GRUPO = new Set(['20600097726', '20613434195']); // GASOMI, JADE

describe('clasificarOrigenGuia', () => {
  it('emisor del grupo → emitida', () => {
    expect(clasificarOrigenGuia({ emisor_ruc: '20600097726' }, RUCS_GRUPO)).toBe('emitida');
  });
  it('emisor externo → recibida (y tolera guiones/espacios en el RUC)', () => {
    expect(clasificarOrigenGuia({ emisor_ruc: '10-750972450' }, RUCS_GRUPO)).toBe('recibida');
  });
  it('sin RUC → desconocida', () => {
    expect(clasificarOrigenGuia({ emisor_ruc: '' }, RUCS_GRUPO)).toBe('desconocida');
    expect(clasificarOrigenGuia({}, RUCS_GRUPO)).toBe('desconocida');
  });
});

describe('facturasQueRequierenGuia', () => {
  const itemsDe = (m) => m.__items || [];
  const facturaBienes = { id: 'f1', document_type: 'factura', type: 'cost', __items: [{ tipo_insumo: 'material' }] };
  const facturaServicios = { id: 'f2', document_type: 'factura', type: 'cost', __items: [{ tipo_insumo: 'servicio' }] };
  const ventaBienes = { id: 'f3', document_type: 'factura', type: 'income', __items: [{ tipo_insumo: 'material' }] };
  const sinItems = { id: 'f4', document_type: 'factura', type: 'cost' };

  it('separa compras y ventas con bienes; excluye solo-servicios; junta sin datos', () => {
    const r = facturasQueRequierenGuia([facturaBienes, facturaServicios, ventaBienes, sinItems], [], itemsDe);
    expect(r.compras.map(m => m.id)).toEqual(['f1']);
    expect(r.ventas.map(m => m.id)).toEqual(['f3']);
    expect(r.sinDatos.map(m => m.id)).toEqual(['f4']);
  });
  it('excluye vinculadas, anuladas, NC y las marcadas no_requiere', () => {
    const guias = [{ id: 'g1', accounting_movement_id: 'f1' }];
    const r = facturasQueRequierenGuia([
      facturaBienes,                                                        // vinculada
      { ...ventaBienes, id: 'f5', payment_status: 'cancelled' },            // anulada
      { ...facturaBienes, id: 'f6', document_type: 'nota_credito' },        // NC
      { ...facturaBienes, id: 'f7', guia_estado: 'no_requiere' },           // decisión manual
    ], guias, itemsDe);
    expect(r.compras.length + r.ventas.length + r.sinDatos.length).toBe(0);
  });
  it("guia_estado 'requiere' fuerza la inclusión: solo-servicios y también sin ítems (sale de sinDatos)", () => {
    const r = facturasQueRequierenGuia([
      { ...facturaServicios, guia_estado: 'requiere' },
      { ...sinItems, id: 'f8', guia_estado: 'requiere' },
    ], [], itemsDe);
    expect(r.compras.map(m => m.id).sort()).toEqual(['f2', 'f8']);
    expect(r.sinDatos.length).toBe(0);
  });
  it('excluye el espejo interco automático y la pata cuyo par YA tiene la guía', () => {
    const espejo = { ...sinItems, id: 'f9' };
    const parCubierta = { ...facturaBienes, id: 'f10', related_movement_id: 'venta1' };
    const r = facturasQueRequierenGuia([espejo, parCubierta],
      [{ id: 'g1', accounting_movement_id: 'venta1' }], itemsDe,
      { esEspejoAuto: (m) => m.id === 'f9' });
    expect(r.compras.length + r.ventas.length + r.sinDatos.length).toBe(0);
  });
});

describe('sugerirGuiasParaFactura', () => {
  const mov = { id: 'm1', document_number: 'F001-100', third_party_ruc: '20111111111', type: 'cost' };
  it('VENTA: solo ofrece guías EMITIDAS por el grupo (una recibida con la misma ref queda fuera)', () => {
    const venta = { id: 'v1', document_number: 'F001-100', third_party_ruc: '20111111111', type: 'income' };
    const guias = [
      { id: 'gN', doc_referencia: 'F001-100', emisor_ruc: '20600097726' },   // del grupo → entra (pri 3)
      { id: 'gX', doc_referencia: 'F001-100', emisor_ruc: '20999999999' },   // proveedor ajeno → FUERA
      { id: 'gS', doc_referencia: '', emisor_ruc: '' },                      // sin RUC → fuera en ventas
    ];
    const r = sugerirGuiasParaFactura(venta, guias, RUCS_GRUPO);
    expect(r.map(x => x.guia.id)).toEqual(['gN']);
  });
  it('prioriza referencia exacta y descarta RUC contradicho en compras', () => {
    const guias = [
      { id: 'g1', doc_referencia: 'F001-100', emisor_ruc: '20111111111' },   // exacta + ruc ok → pri 3
      { id: 'g2', doc_referencia: 'E001-9', emisor_ruc: '20111111111' },     // solo ruc → pri 1
      { id: 'g3', doc_referencia: 'F001-100', emisor_ruc: '20999999999' },   // RUC contradicho → fuera
      { id: 'g4', doc_referencia: '', emisor_ruc: '', accounting_movement_id: 'x' }, // ya vinculada → fuera
    ];
    const r = sugerirGuiasParaFactura(mov, guias);
    expect(r.map(x => x.guia.id)).toEqual(['g1', 'g2']);
    expect(r[0].pri).toBe(3);
  });
});
