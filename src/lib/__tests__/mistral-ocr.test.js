import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { modeloOcr, esAliasMovil, OCR_FIJO, OCR_FIJO_CERT } from '../../../lib/mistral-ocr.js';

// El 16-jul-2026 Mistral repuntó el alias 'mistral-ocr-latest' de OCR 3 a OCR
// 4.1 y el precio se DUPLICÓ (USD 2 → 4 / 1000 págs) sin que nadie lo eligiera.
// Estos tests son la regla que impide que vuelva a pasar.

describe('esAliasMovil — cuáles alias puede mover Mistral bajo tus pies', () => {
  it('los alias móviles documentados se detectan', () => {
    expect(esAliasMovil('mistral-ocr-latest')).toBe(true);
    expect(esAliasMovil('MISTRAL-OCR-LATEST')).toBe(true);
    expect(esAliasMovil('mistral-ocr-4')).toBe(true);   // major sin versión
  });

  it('los snapshots NO son móviles: apuntan siempre a lo mismo', () => {
    expect(esAliasMovil('mistral-ocr-2512')).toBe(false);   // OCR 3
    expect(esAliasMovil('mistral-ocr-2505')).toBe(false);   // OCR 2
    expect(esAliasMovil('mistral-ocr-4-1')).toBe(false);    // OCR 4.1 con versión
  });

  it('vacío o basura no cuenta como alias', () => {
    expect(esAliasMovil('')).toBe(false);
    expect(esAliasMovil(null)).toBe(false);
  });
});

describe('modeloOcr — el default está FIJO, no colgado de un alias', () => {
  it('sin variables usa el snapshot fijo, y ese snapshot no es un alias', () => {
    expect(modeloOcr({})).toEqual({ modelo: OCR_FIJO, motivo: 'fijo' });
    expect(esAliasMovil(OCR_FIJO)).toBe(false);
    expect(esAliasMovil(OCR_FIJO_CERT)).toBe(false);
  });

  it('el fijo es OCR 3 (USD 2/1000 págs), la mitad que OCR 4.1', () => {
    expect(OCR_FIJO).toBe('mistral-ocr-2512');
  });

  it('un override a OTRO snapshot sí se respeta (subir a 4.1 es una decisión válida)', () => {
    expect(modeloOcr({ MISTRAL_OCR_MODEL: 'mistral-ocr-4-1' }))
      .toEqual({ modelo: 'mistral-ocr-4-1', motivo: 'override' });
  });

  it('🔴 LA REGLA: un alias móvil en Vercel NO gana — se ignora y se avisa', () => {
    const r = modeloOcr({ MISTRAL_OCR_MODEL: 'mistral-ocr-latest' });
    expect(r.modelo).toBe(OCR_FIJO);
    expect(r.motivo).toBe('alias-rechazado');
    expect(r.rechazado).toBe('mistral-ocr-latest');
  });

  it('el escape existe pero hay que pedirlo a propósito', () => {
    const r = modeloOcr({ MISTRAL_OCR_MODEL: 'mistral-ocr-latest', MISTRAL_OCR_PERMITIR_ALIAS: '1' });
    expect(r).toEqual({ modelo: 'mistral-ocr-latest', motivo: 'alias-permitido' });
  });

  it('certificados leen SU variable, no la de facturas', () => {
    const env = { MISTRAL_OCR_MODEL: 'mistral-ocr-2512', MISTRAL_OCR_MODEL_CERT: 'mistral-ocr-4-1' };
    expect(modeloOcr(env).modelo).toBe('mistral-ocr-2512');
    expect(modeloOcr(env, { cert: true }).modelo).toBe('mistral-ocr-4-1');
  });

  it('la regla también protege el camino de certificados', () => {
    expect(modeloOcr({ MISTRAL_OCR_MODEL_CERT: 'mistral-ocr-latest' }, { cert: true }).motivo)
      .toBe('alias-rechazado');
  });

  it('espacios de más no burlan la regla', () => {
    expect(modeloOcr({ MISTRAL_OCR_MODEL: '  mistral-ocr-latest  ' }).motivo).toBe('alias-rechazado');
  });
});

describe('el endpoint no puede volver a colgarse de un alias', () => {
  it('api/captura-magica.js no trae "mistral-ocr-latest" como valor por defecto', () => {
    // Guard de código: si alguien reintroduce el alias en el endpoint, este test
    // lo frena en el green gate en vez de descubrirlo en la factura del mes.
    const src = readFileSync(new URL('../../../api/captura-magica.js', import.meta.url), 'utf8');
    const sinComentarios = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(sinComentarios).not.toMatch(/['"`]mistral-ocr-latest['"`]/);
    expect(sinComentarios).toMatch(/modeloOcr\(/);
  });
});
