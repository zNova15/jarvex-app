// ═══════════════════════════════════════════════════════════════════
// Tanda 3.4 — la IA elige y cuenta la historia del cronograma (§15.2 C).
//
// Lo que se protege: la IA NUNCA pone una fecha ni una historia que no esté
// en el catálogo, y lo que devuelve pasa por el catálogo real antes de
// tocar un escenario — en el servidor y otra vez en el cliente.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  HISTORIA_IDS, sanearHistoriaIA, sinFechasPuntuales, contextoParaHistoria,
  relatoIAVigente, normalizarRelatoIA,
} from '../simulador-historias.js';
import * as desdeCronograma from '../simulador-cronograma.js';
import {
  systemPromptHistoria, userPromptHistoria, handleElegirHistoria,
} from '../../../api/asistente-solicitud.js';
import { nuevoEscenario, normalizarEscenario, conHistoriaIA } from '../simulador-escenarios.js';

describe('el catálogo vive en una lib hoja', () => {
  it('no importa nada: el endpoint la usa y no puede arrastrar el motor', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../simulador-historias.js'), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
  });

  it('simulador-cronograma la re-exporta: nadie que la usaba se rompe', () => {
    expect(desdeCronograma.HISTORIA_IDS).toBe(HISTORIA_IDS);
  });
});

describe('sanearHistoriaIA — lo único que la IA puede tocar', () => {
  it('una historia del catálogo, con sus perillas recortadas al rango', () => {
    const r = sanearHistoriaIA({
      historia: 'frenazo',
      ajustes: { inicio: 0.9, duracion: 0.22, ritmo: 0.1, cuotaCaras: 0.4, inventada: 3 },
      relato: 'La obra arranca bien. Después se frena.',
      porQue: 'La plata se amontona al final.',
    });
    expect(r.historia).toBe('frenazo');
    expect(r.ajustes).toEqual({ inicio: 0.4, duracion: 0.2, ritmo: 0.45, cuotaCaras: 0.4 });
    expect(r.relato).toBe('La obra arranca bien. Después se frena.');
  });

  it('una historia inventada se descarta ENTERA', () => {
    expect(sanearHistoriaIA({ historia: 'huelga_general', ajustes: { ritmo: 0.5 }, relato: 'x' })).toBe(null);
    expect(sanearHistoriaIA({ historia: 'azar' })).toBe(null);
    expect(sanearHistoriaIA(null)).toBe(null);
    expect(sanearHistoriaIA({})).toBe(null);
  });

  it('la oración que pone una fecha puntual se tira; nombrar un mes se permite', () => {
    const t = 'Se frena en octubre. El 15 de octubre pagan. Termina en 2027. Recupera al final. Pagan el 3/11.';
    expect(sinFechasPuntuales(t, 700)).toBe('Se frena en octubre. Recupera al final.');
    const r = sanearHistoriaIA({ historia: 'arranque_lento', relato: 'Arranca el 1 de mayo. Va lento.', porQue: 'Porque sí.' });
    expect(r.relato).toBe('Va lento.');
  });

  it('recorta los textos largos', () => {
    const r = sanearHistoriaIA({ historia: 'adelantada', relato: 'a'.repeat(2000), porQue: 'b'.repeat(900) });
    expect(r.relato.length).toBe(700);
    expect(r.porQue.length).toBe(300);
  });
});

describe('contextoParaHistoria — lo que la IA ve', () => {
  it('la plata por mes con el Gantt en miles, el plazo y lo que preocupa; ninguna partida', () => {
    const c = contextoParaHistoria({
      obraNombre: 'PLAN MIRAFLORES', plazo: { inicio: '2026-04-30', fin: '2026-12-30' },
      modo: 'simulacion', montoComprable: 4977696.4,
      curva: { filas: [{ mes: '2026-10', base: 1063210.55, escenario: 836000 }, { mes: '2026-11', base: 1413000, escenario: 1780000 }] },
      preocupacion: '  la entidad   paga tarde  ',
    });
    expect(c.meses).toEqual([{ mes: '2026-10', miles: 1063 }, { mes: '2026-11', miles: 1413 }]);
    expect(c.comprableMiles).toBe(4978);
    expect(c.preocupacion).toBe('la entidad paga tarde');
    expect(JSON.stringify(c)).not.toMatch(/escenario|partida|insumo/);
  });
});

describe('relatoIAVigente — el relato solo vale para lo que contó', () => {
  const relatoIA = { historia: 'frenazo', ajustes: { inicio: 0.35, duracion: 0.25, ritmo: 0.5, cuotaCaras: 0.4 }, relato: 'x' };
  it('misma historia y mismas perillas: vale', () => {
    expect(relatoIAVigente(relatoIA, { historia: 'frenazo', historiaAjustes: { ...relatoIA.ajustes } })).toBe(true);
  });
  it('otra historia, otra perilla o las perillas sueltas («🎲 Otro»): ya no', () => {
    expect(relatoIAVigente(relatoIA, { historia: 'tirones', historiaAjustes: relatoIA.ajustes })).toBe(false);
    expect(relatoIAVigente(relatoIA, { historia: 'frenazo', historiaAjustes: { ...relatoIA.ajustes, ritmo: 0.6 } })).toBe(false);
    expect(relatoIAVigente(relatoIA, { historia: 'frenazo', historiaAjustes: {} })).toBe(false);
    expect(relatoIAVigente(null, { historia: 'frenazo' })).toBe(false);
  });
});

describe('el escenario guarda lo que eligió la IA', () => {
  const VALORES = { inicio: 0.35, duracion: 0.25, ritmo: 0.5, cuotaCaras: 0.4 };
  it('conHistoriaIA pasa la historia y TODAS sus perillas a los params, y guarda el relato', () => {
    const e = conHistoriaIA(nuevoEscenario({ nombre: 'x' }), {
      historia: 'frenazo', valores: VALORES, relato: 'Se frena.', porQue: 'Porque sí.', model: 'm1',
    });
    expect(e.params).toMatchObject({ cronograma: 'escenario', historia: 'frenazo', historiaAjustes: VALORES });
    expect(e.relatoIA).toMatchObject({ historia: 'frenazo', relato: 'Se frena.', model: 'm1' });
    expect(relatoIAVigente(e.relatoIA, e.params)).toBe(true);
  });

  it('una historia inventada no toca el escenario', () => {
    const base = nuevoEscenario({ nombre: 'x' });
    expect(conHistoriaIA(base, { historia: 'inventada', valores: {} })).toBe(base);
  });

  it('sobrevive al localStorage, y uno roto se lee como sin relato', () => {
    const e = conHistoriaIA(nuevoEscenario({ nombre: 'x' }), { historia: 'frenazo', valores: VALORES, relato: 'Se frena.' });
    expect(normalizarEscenario(JSON.parse(JSON.stringify(e))).relatoIA).toEqual(e.relatoIA);
    expect(normalizarEscenario({ ...e, relatoIA: { historia: 'basura' } }).relatoIA).toBe(null);
    expect(normalizarRelatoIA(undefined)).toBe(null);
  });
});

describe('el prompt de la historia', () => {
  it('lista TODO el catálogo con sus rangos, y prohíbe fechas e ids inventados', () => {
    const s = systemPromptHistoria();
    for (const id of HISTORIA_IDS) expect(s).toContain(`id: ${id}`);
    expect(s).toContain('ritmo: de 0.45 a 0.7');
    expect(s).toMatch(/NUNCA pongas una fecha/);
    expect(s).toMatch(/EXACTAMENTE uno de los id/);
    expect(s).toContain('LA ÚNICA QUE ESTIRA EL FIN');
  });

  it('el user lleva la plata por mes y lo que preocupa, saneado', () => {
    const u = userPromptHistoria({
      obra: 'PLAN MIRAFLORES', plazoInicio: '2026-04-30', plazoFin: '2026-12-30', modo: 'real', desde: '2026-09-24',
      meses: [{ mes: '2026-10', miles: 1063 }, { mes: 'basura', miles: 5 }], comprableMiles: 4977,
      preocupacion: 'la entidad paga tarde a fin de año',
    });
    expect(u).toContain('PLAN MIRAFLORES');
    expect(u).toContain('- 2026-10: 1,063');
    expect(u).not.toContain('basura');
    expect(u).toContain('corre desde hoy (2026-09-24)');
    expect(u).toContain('LO QUE LE PREOCUPA A QUIEN PLANIFICA: la entidad paga tarde a fin de año');
  });
});

// ── EL CAMINO ENTERO, CON LA RED SIMULADA ─────────────────────────
describe('handleElegirHistoria', () => {
  const resFalso = () => {
    const r = { _status: 200, _body: null };
    r.status = (n) => { r._status = n; return r; };
    r.json = (b) => { r._body = b; return r; };
    return r;
  };
  const CONTEXTO = { obra: 'X', meses: [{ mes: '2026-10', miles: 100 }, { mes: '2026-11', miles: 900 }] };
  const conIA = (contenido) => {
    process.env.OPENROUTER_API_KEY = 'test';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ model: 'modelo-de-prueba', choices: [{ message: { content: contenido }, finish_reason: 'stop' }] }),
    })));
  };
  const antes = process.env.OPENROUTER_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (antes) process.env.OPENROUTER_API_KEY = antes; else delete process.env.OPENROUTER_API_KEY;
  });

  it('sin la plata por mes, 422: no llama a la IA con la mano vacía', async () => {
    const res = resFalso();
    await handleElegirHistoria({}, res, { contexto: { meses: [] } });
    expect(res._status).toBe(422);
  });

  it('sin la IA configurada, 200 con historia:null (nunca bloquea)', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const res = resFalso();
    await handleElegirHistoria({}, res, { contexto: CONTEXTO });
    expect(res._status).toBe(200);
    expect(res._body.result.historia).toBe(null);
    expect(res._body.motivo).toMatch(/no está configurada/);
  });

  it('lo que devuelve la IA llega saneado: perillas al rango, sin fechas', async () => {
    conIA(JSON.stringify({
      historia: 'frenazo', ajustes: { inicio: 0.35, duracion: 0.9, ritmo: 0.5, cuotaCaras: 0.4 },
      relato: 'Arranca bien. El 15 de octubre dejan de pagar. Después se recupera.', porQue: 'La plata está al final.',
    }));
    const res = resFalso();
    await handleElegirHistoria({}, res, { contexto: CONTEXTO });
    expect(res._status).toBe(200);
    expect(res._body.result).toEqual({
      historia: 'frenazo',
      ajustes: { inicio: 0.35, duracion: 0.3, ritmo: 0.5, cuotaCaras: 0.4 },
      relato: 'Arranca bien. Después se recupera.',
      porQue: 'La plata está al final.',
    });
    expect(res._body.model).toBe('modelo-de-prueba');
  });

  it('una historia inventada no pasa: historia:null con el motivo', async () => {
    conIA('{"historia":"terremoto","ajustes":{},"relato":"Se cae todo."}');
    const res = resFalso();
    await handleElegirHistoria({}, res, { contexto: CONTEXTO });
    expect(res._body.result.historia).toBe(null);
    expect(res._body.motivo).toMatch(/no está en el catálogo/);
  });

  it('una respuesta ilegible tampoco tumba nada', async () => {
    conIA('no sé, elegí vos');
    const res = resFalso();
    await handleElegirHistoria({}, res, { contexto: CONTEXTO });
    expect(res._status).toBe(200);
    expect(res._body.result.historia).toBe(null);
  });
});
