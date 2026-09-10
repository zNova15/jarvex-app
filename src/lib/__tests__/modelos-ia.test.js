// ═══════════════════════════════════════════════════════════════════
// Tests de la LISTA BLANCA de modelos (lib/modelos-ia.js) y de cómo la
// pantalla lee la configuración (src/lib/modelos-ia-config.js).
//
// Lo que se protege acá no es una preferencia: es que el id del modelo viaja
// DESDE EL NAVEGADOR y sin lista blanca cualquiera podría pedir el modelo más
// caro del catálogo de OpenRouter con la factura de la empresa. Y que Captura
// Mágica —que hoy funciona bien— no cambie de comportamiento por existir esto.
// ═══════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MODELOS_OCR, MODELOS_TEXTO, DEFAULTS, resolverOcr, resolverTexto, catalogo, ambitoValido,
} from '../../../lib/modelos-ia.js';
import { modelosDe, cuerpoDeModelos, usdPorPaginaDe, CLAVES } from '../modelos-ia-config.js';

describe('lista blanca de modelos', () => {
  it('un id que no está en la lista cae al default del ámbito, no lo acepta', () => {
    expect(resolverTexto('openai/o-carisimo-99', 'licitaciones')).toMatchObject({ modelo: 'auto', porDefecto: true });
    expect(resolverOcr('mistral-ocr-inventado', 'licitaciones')).toMatchObject({ modelo: 'mistral-ocr-2512', porDefecto: true });
  });

  it('acepta lo que sí está', () => {
    expect(resolverTexto('z-ai/glm-5.3-flash', 'licitaciones')).toMatchObject({ modelo: 'z-ai/glm-5.3-flash', porDefecto: false, auto: false });
    expect(resolverOcr('mistral-ocr-4-1', 'licitaciones')).toMatchObject({ modelo: 'mistral-ocr-4-1', porDefecto: false });
  });

  it('«auto» significa la cadena de gratuitos, no un modelo suelto', () => {
    expect(resolverTexto('auto', 'captura').auto).toBe(true);
    expect(resolverTexto(null, 'captura').auto).toBe(true);
  });

  it('los dos ámbitos arrancan EXACTAMENTE como venía la app', () => {
    // Si esto cambia, cambió el comportamiento de un módulo en producción sin
    // que nadie lo pidiera. Captura Mágica funciona bien hoy: no se toca.
    expect(DEFAULTS.captura).toEqual({ ocr: 'mistral-ocr-2512', texto: 'auto' });
    expect(DEFAULTS.licitaciones).toEqual({ ocr: 'mistral-ocr-2512', texto: 'auto' });
  });

  it('un ámbito inventado no se adivina', () => {
    expect(ambitoValido('contabilidad')).toBe(null);
    expect(ambitoValido('licitaciones')).toBe('licitaciones');
  });

  it('ningún modelo de OCR es un alias móvil', () => {
    // La regla de lib/mistral-ocr.js: un alias es una decisión de compra
    // delegada al proveedor. El 16-jul-2026 duplicó el precio sola.
    for (const m of MODELOS_OCR) {
      expect(m.id).not.toMatch(/-latest$/);
      expect(m.id).not.toMatch(/^mistral-ocr-\d{1,2}$/);
    }
  });

  it('todo modelo pago declara su precio y el gratuito declara que es gratis', () => {
    for (const m of MODELOS_TEXTO) {
      if (m.gratis) { expect(m.precio).toEqual({ entrada: 0, salida: 0 }); continue; }
      expect(m.precio.entrada).toBeGreaterThan(0);
      expect(m.precio.salida).toBeGreaterThan(0);
    }
    for (const m of MODELOS_OCR) expect(m.usdPorPagina).toBeGreaterThan(0);
  });

  it('el catálogo acepta que le pisen los precios con los de ahora', () => {
    const c = catalogo({ precios: { 'z-ai/glm-5.3-flash': { entrada: 9, salida: 9 } } });
    expect(c.enVivo).toBe(true);
    expect(c.texto.find(m => m.id === 'z-ai/glm-5.3-flash').precio).toEqual({ entrada: 9, salida: 9 });
    // Los que no vinieron conservan el medido.
    expect(c.texto.find(m => m.id === 'openai/gpt-5.6-luna').precio.entrada).toBe(0.20);
  });
});

describe('cómo lee la pantalla la configuración', () => {
  const filas = [
    { clave: 'ia_licitaciones_ocr', valor: 'mistral-ocr-4-1', updated_at: '2026-09-09T10:00:00Z' },
    { clave: 'ia_licitaciones_texto', valor: '  ', updated_at: '2026-09-09T10:00:00Z' },
  ];
  beforeEach(() => {
    globalThis.window = globalThis.window || {};
    window.__hooks = {
      resolverConfig: (rows, clave, def) => {
        const v = (rows || []).filter(r => !r.deleted_at && r.clave === clave);
        return v.length ? v[0].valor : def;
      },
    };
  });
  afterEach(() => { delete window.__hooks; });

  it('lee lo elegido y trata el vacío como «nadie eligió»', () => {
    expect(modelosDe(filas, 'licitaciones')).toEqual({ ocr: 'mistral-ocr-4-1', texto: null });
  });

  it('sin nada configurado, el pedido sale IGUAL que antes de que esto existiera', () => {
    // Ésta es la garantía de «no cambia nada hasta que alguien lo cambie».
    expect(cuerpoDeModelos([], 'captura')).toEqual({});
  });

  it('solo manda los campos que de verdad se eligieron', () => {
    expect(cuerpoDeModelos(filas, 'licitaciones')).toEqual({ modelo_ocr: 'mistral-ocr-4-1' });
  });

  it('cada ámbito tiene sus PROPIAS claves: cambiar uno no toca al otro', () => {
    expect(CLAVES.licitaciones.ocr).not.toBe(CLAVES.captura.ocr);
    expect(CLAVES.licitaciones.texto).not.toBe(CLAVES.captura.texto);
    expect(cuerpoDeModelos(filas, 'captura')).toEqual({});
  });

  it('el precio por página sigue al OCR elegido', () => {
    const cat = catalogo();
    expect(usdPorPaginaDe(cat, 'mistral-ocr-4-1')).toBe(0.004);
    expect(usdPorPaginaDe(cat, 'mistral-ocr-2512')).toBe(0.002);
    expect(usdPorPaginaDe(null, 'mistral-ocr-4-1')).toBe(0.002);   // sin catálogo, el piso
  });
});
