import { describe, it, expect } from 'vitest';
import { razonSimilar, veredictoSunat, rucValido, normalizarRazon } from '../sunat-verificacion.js';

describe('razonSimilar', () => {
  it('ignora los tokens jurídicos y genéricos', () => {
    // Sin descartarlos, estas dos darían un parecido alto por "SAC" y "COMERCIAL".
    expect(razonSimilar('COMERCIAL KOPLAST SAC', 'COMERCIAL VARGAS SAC')).toBe(0);
  });
  it('reconoce la misma empresa escrita distinto', () => {
    expect(razonSimilar('KOPLAST S.A.C.', 'Koplast Sociedad Anónima Cerrada')).toBe(1);
  });
  it('ignora tildes y puntuación', () => {
    expect(normalizarRazon('AMÉRICA EXPRESS S.A.')).toBe('america express s a');
  });
  it('devuelve 0 si alguno queda sin tokens distintivos', () => {
    expect(razonSimilar('SAC', 'KOPLAST')).toBe(0);
    expect(razonSimilar('', 'KOPLAST')).toBe(0);
  });
});

describe('rucValido', () => {
  it('acepta RUCs reales de producción', () => {
    expect(rucValido('20100070970')).toBe(true);   // SUNAT, dígito verificador OK
  });
  it('rechaza el dígito verificador cambiado', () => {
    expect(rucValido('20100070971')).toBe(false);
  });
  it('rechaza longitud y prefijo inválidos', () => {
    expect(rucValido('2010007097')).toBe(false);
    expect(rucValido('30100070970')).toBe(false);
    expect(rucValido('')).toBe(false);
  });
});

describe('veredictoSunat', () => {
  const activo = { razonSocial: 'KOPLAST S.A.C.', estado: 'ACTIVO', condicion: 'HABIDO' };

  it('sin respuesta de SUNAT no opina', () => {
    expect(veredictoSunat({ razonOCR: 'X', sunat: null })).toBe(null);
    expect(veredictoSunat({ razonOCR: 'X', sunat: { razonSocial: '' } })).toBe(null);
  });

  it('coincide y está activo/habido → nivel ok, sin alertas', () => {
    const v = veredictoSunat({ razonOCR: 'KOPLAST SAC', sunat: activo });
    expect(v.nivel).toBe('ok');
    expect(v.mismatch).toBe(false);
    expect(v.alertas).toEqual([]);
    expect(v.similitud).toBe(100);
  });

  it('nombre distinto → mismatch con el porcentaje de parecido', () => {
    const v = veredictoSunat({ razonOCR: 'FERRETERIA LOS ANDES', sunat: activo });
    expect(v.mismatch).toBe(true);
    expect(v.nivel).toBe('revisar');
    expect(v.similitud).toBe(0);
  });

  it('el comprobante sin razón social NO es un mismatch, es un hueco', () => {
    const v = veredictoSunat({ razonOCR: '   ', sunat: activo });
    expect(v.mismatch).toBe(false);
    expect(v.faltaNombre).toBe(true);
    expect(v.nivel).toBe('revisar');   // igual hay que completarlo
  });

  it('NO HABIDO se avisa aunque el nombre coincida', () => {
    const v = veredictoSunat({ razonOCR: 'KOPLAST SAC', sunat: { ...activo, condicion: 'NO HABIDO' } });
    expect(v.noHabido).toBe(true);
    expect(v.mismatch).toBe(false);
    expect(v.nivel).toBe('revisar');
    expect(v.alertas.join(' ')).toMatch(/crédito fiscal/i);
  });

  it('RUC de baja → aviso de estado, sin inventar el de condición', () => {
    const v = veredictoSunat({ razonOCR: 'KOPLAST SAC', sunat: { razonSocial: 'KOPLAST S.A.C.', estado: 'BAJA DE OFICIO', condicion: 'HABIDO' } });
    expect(v.inactivo).toBe(true);
    expect(v.noHabido).toBe(false);
    expect(v.alertas).toHaveLength(1);
  });

  it('una entrada de caché vieja (sin estado ni condición) no inventa problemas', () => {
    const v = veredictoSunat({ razonOCR: 'KOPLAST SAC', sunat: { razonSocial: 'KOPLAST S.A.C.', estado: '', condicion: '' } });
    expect(v.inactivo).toBe(false);
    expect(v.noHabido).toBe(false);
    expect(v.nivel).toBe('ok');
  });

  it('devuelve el domicilio fiscal para poder completar el alta', () => {
    const v = veredictoSunat({ razonOCR: 'KOPLAST SAC', sunat: { ...activo, direccion: 'AV. ARGENTINA 123 - LIMA' } });
    expect(v.direccionSunat).toBe('AV. ARGENTINA 123 - LIMA');
  });
});
