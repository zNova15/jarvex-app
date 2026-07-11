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
