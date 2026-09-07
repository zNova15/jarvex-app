import { describe, it, expect } from 'vitest';
import {
  DOCS_EMPRESA, TIPOS_DOC_EMPRESA, esDocEmpresa, docEmpresaPorTipo,
  serializarMetaDoc, parsearMetaDoc, estadoVigencia,
  documentosDeEmpresa, resumenDocsEmpresa,
} from '../documentos-empresa.js';

const EV = (tipo, companyId, created_at, extra = {}) => ({
  id: `${tipo}-${created_at}`, tipo_evidencia: tipo, modulo_relacionado: 'companies',
  registro_relacionado_id: companyId, created_at, nombre_archivo: 'x.pdf', ...extra,
});

describe('documentos-empresa — catálogo', () => {
  it('trae los cuatro que pidió la contadora, más "otro"', () => {
    const ids = DOCS_EMPRESA.map(d => d.id);
    expect(ids).toEqual(['ficha_ruc', 'vigencia_poder', 'testimonio', 'rnp', 'otro']);
  });
  it('solo vigencia de poder y RNP caducan', () => {
    expect(DOCS_EMPRESA.filter(d => d.venceUsualmente).map(d => d.id))
      .toEqual(['vigencia_poder', 'rnp']);
  });
  it('reconoce sus tipo_evidencia y no otros', () => {
    expect(esDocEmpresa('doc_empresa_rnp')).toBe(true);
    expect(esDocEmpresa('factura')).toBe(false);
    expect(TIPOS_DOC_EMPRESA).toHaveLength(5);
    expect(docEmpresaPorTipo('doc_empresa_testimonio').titulo).toBe('Testimonio');
    expect(docEmpresaPorTipo('inexistente')).toBe(null);
  });
});

describe('documentos-empresa — meta en observaciones', () => {
  it('ida y vuelta', () => {
    const s = serializarMetaDoc({ numero: '123', vencimiento: '2027-01-31' });
    expect(parsearMetaDoc(s)).toEqual({ numero: '123', vencimiento: '2027-01-31' });
  });
  it('sin datos no escribe nada', () => {
    expect(serializarMetaDoc({})).toBe('');
    expect(parsearMetaDoc('')).toEqual({});
  });
  it('texto libre viejo se respeta como nota (no se pierde)', () => {
    expect(parsearMetaDoc('subido por la contadora')).toEqual({ nota: 'subido por la contadora' });
  });
  it('JSON roto no rompe la pantalla', () => {
    expect(parsearMetaDoc('{roto')).toEqual({ nota: '{roto' });
  });
});

describe('documentos-empresa — vigencia', () => {
  it('clasifica vencido / por vencer / vigente', () => {
    expect(estadoVigencia('2026-09-01', '2026-09-07')).toBe('vencido');
    expect(estadoVigencia('2026-09-20', '2026-09-07')).toBe('por_vencer');  // 13 días
    expect(estadoVigencia('2027-01-01', '2026-09-07')).toBe('vigente');
    expect(estadoVigencia(null, '2026-09-07')).toBe('sin_fecha');
    expect(estadoVigencia('no es fecha', '2026-09-07')).toBe('sin_fecha');
  });
  it('el día exacto del vencimiento todavía es "por vencer", no vencido', () => {
    expect(estadoVigencia('2026-09-07', '2026-09-07')).toBe('por_vencer');
  });
});

describe('documentos-empresa — documentosDeEmpresa', () => {
  const evs = [
    EV('doc_empresa_ficha_ruc', 'c1', '2026-01-10T10:00:00Z'),
    EV('doc_empresa_vigencia_poder', 'c1', '2026-02-01T10:00:00Z',
       { observaciones: '{"vencimiento":"2026-09-20"}' }),
    EV('doc_empresa_vigencia_poder', 'c1', '2026-08-01T10:00:00Z',
       { observaciones: '{"vencimiento":"2027-06-30"}' }),   // la renovación
    EV('doc_empresa_rnp', 'c2', '2026-03-01T10:00:00Z'),      // de OTRA empresa
    EV('doc_empresa_testimonio', 'c1', '2026-01-01T10:00:00Z', { deleted_at: '2026-05-01' }),
  ];
  it('la renovación manda y la anterior queda en el historial', () => {
    const d = documentosDeEmpresa(evs, 'c1', { hoy: '2026-09-07' });
    const vp = d.get('vigencia_poder');
    expect(vp.meta.vencimiento).toBe('2027-06-30');
    expect(vp.historial).toHaveLength(1);
    expect(vp.estado).toBe('vigente');
  });
  it('no mezcla los papeles de otra empresa', () => {
    expect(documentosDeEmpresa(evs, 'c1', {}).get('rnp').vigente).toBe(null);
    expect(documentosDeEmpresa(evs, 'c2', {}).get('rnp').vigente).not.toBe(null);
  });
  it('un documento borrado deja de contar', () => {
    expect(documentosDeEmpresa(evs, 'c1', {}).get('testimonio').vigente).toBe(null);
  });
  it('los que no caducan nunca salen en rojo', () => {
    const d = documentosDeEmpresa(evs, 'c1', { hoy: '2026-09-07' });
    expect(d.get('ficha_ruc').estado).toBe('sin_fecha');
  });
});

describe('documentos-empresa — resumen para la tarjeta', () => {
  it('cuenta los 4 claves, sin contar "otro"', () => {
    const r = resumenDocsEmpresa([
      EV('doc_empresa_ficha_ruc', 'c1', '2026-01-10T10:00:00Z'),
      EV('doc_empresa_otro', 'c1', '2026-01-10T10:00:00Z'),
    ], 'c1', { hoy: '2026-09-07' });
    expect(r).toEqual({ total: 4, cargados: 1, vencidos: 0, porVencer: 0, faltan: 3 });
  });
  it('marca los vencidos', () => {
    const r = resumenDocsEmpresa([
      EV('doc_empresa_rnp', 'c1', '2026-01-10T10:00:00Z', { observaciones: '{"vencimiento":"2026-08-01"}' }),
    ], 'c1', { hoy: '2026-09-07' });
    expect(r.vencidos).toBe(1);
    expect(r.cargados).toBe(1);
  });
  it('empresa sin papeles', () => {
    expect(resumenDocsEmpresa([], 'c1', {})).toEqual({ total: 4, cargados: 0, vencidos: 0, porVencer: 0, faltan: 4 });
  });
});
