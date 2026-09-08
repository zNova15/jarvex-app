// ═══════════════════════════════════════════════════════════════════
// EL ANÁLISIS DE PUNTA A PUNTA (tanda 15, entrega 3).
//
// Corre la cadena entera contra un API de mentira: se puede verificar el
// troceado en tandas, qué pasa cuando el OCR falla a la mitad, que una cita
// inventada NO se cuele y que el costo que se muestra sea el que se gastó.
// Sin navegador: los bloques ya vienen con su imagen, que es lo que haría el
// rasterizado.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { analizar, presupuestar, PAGINAS_POR_TANDA } from '../bases-analisis.js';
import { USD_POR_PAGINA_OCR } from '../bases-extraccion.js';

const CITA = 'Experiencia no menor de 03 años como Residente de obra en obras similares';

/** N páginas escaneadas listas para mandar. */
const bloquesEscaneados = (n) => Array.from({ length: n }, (_, i) => ({
  tipo: 'imagen', clase: 'pagina', pagina: i + 1, media: `pdf:p${i + 1}`,
  necesitaOcr: true, rotacionCorreccion: 0, imagen: 'data:image/jpeg;base64,AAAA',
}));

/**
 * Un API falso. `guion` decide qué contesta cada acción; `llamadas` guarda todo
 * lo que se le pidió, que es lo que se verifica.
 */
function apiFalso(guion = {}) {
  const llamadas = [];
  const apiFetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    llamadas.push(body);
    const r = guion[body.accion];
    const data = typeof r === 'function' ? r(body, llamadas) : r;
    return { ok: !(data && data.__error), status: data?.__error || 200, __data: data || {} };
  };
  const apiParse = async (resp) => resp.__data;
  return { apiFetch, apiParse, llamadas };
}

const ocrQueDevuelve = (texto) => (body) => ({
  textos: Object.fromEntries(body.paginas.map(p => [p.clave, texto])),
  fallidas: [], model: 'mistral-ocr-2512',
});

describe('analizar — la cadena completa', () => {
  it('trocea el OCR en tandas del tamaño acordado con el endpoint', async () => {
    const { apiFetch, apiParse, llamadas } = apiFalso({
      ocr: ocrQueDevuelve('texto sin secciones reconocibles'),
    });
    await analizar(bloquesEscaneados(14), { apiFetch, apiParse });
    const tandas = llamadas.filter(l => l.accion === 'ocr');
    expect(tandas).toHaveLength(Math.ceil(14 / PAGINAS_POR_TANDA));
    expect(tandas[0].paginas).toHaveLength(PAGINAS_POR_TANDA);
    expect(tandas[2].paginas).toHaveLength(14 - 2 * PAGINAS_POR_TANDA);
  });

  it('si el documento no parece unas bases, NO gasta las pasadas de IA', async () => {
    const { apiFetch, apiParse, llamadas } = apiFalso({
      ocr: ocrQueDevuelve('lista de precios de abarrotes'),
    });
    const r = await analizar(bloquesEscaneados(2), { apiFetch, apiParse });
    expect(llamadas.some(l => l.accion === 'localizar')).toBe(false);
    expect(llamadas.some(l => l.accion === 'extraer')).toBe(false);
    expect(r.alertas.join(' ')).toMatch(/no se reconoció ninguna sección/i);
  });

  it('extrae, verifica la cita y devuelve la fila lista para guardar', async () => {
    const { apiFetch, apiParse } = apiFalso({
      ocr: ocrQueDevuelve(`REQUISITOS DE CALIFICACION\nPersonal clave\nResidente de Obra\n${CITA}.`),
      localizar: { rangos: { personal: { encontrada: true, rangos: [{ desde: 1, hasta: 2 }] } } },
      extraer: {
        resultado: {
          requisitos: [{
            cargo: 'Residente de Obra', profesion: 'Ingeniero Civil',
            meses_minimos: 36, participaciones_minimas: 2, meses_por_participacion: 2,
            ventana_anios: 10, fuente_pagina: 1, fuente_cita: CITA,
          }],
          alertas: [],
        },
        model: 'ling-3.0-flash-fin:free', costo: 0,
      },
    });
    const r = await analizar(bloquesEscaneados(2), { apiFetch, apiParse });
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].cargo).toBe('Residente de Obra');
    expect(r.filas[0].verificada).toBe(true);
    expect(r.filas[0].fuente).toBe('extraccion');
    expect(r.filas[0].participaciones_minimas).toBe(2);
  });

  it('UNA CITA INVENTADA no pasa: queda marcada y con alerta', async () => {
    const { apiFetch, apiParse } = apiFalso({
      ocr: ocrQueDevuelve(`REQUISITOS DE CALIFICACION\nPersonal clave\n${CITA}.`),
      localizar: { rangos: { personal: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] } } },
      extraer: { resultado: { requisitos: [{
        cargo: 'Especialista en Impacto Ambiental', meses_minimos: 60,
        fuente_pagina: 1, fuente_cita: 'Experiencia no menor de 05 años en impacto ambiental',
      }] } },
    });
    const r = await analizar(bloquesEscaneados(1), { apiFetch, apiParse });
    expect(r.filas[0].verificada).toBe(false);
    expect(r.alertas.join(' ')).toMatch(/Especialista en Impacto Ambiental/);
  });

  it('una página que el OCR no pudo leer se avisa, y el resto sigue', async () => {
    const { apiFetch, apiParse } = apiFalso({
      ocr: (body) => ({
        textos: { [body.paginas[0].clave]: 'REQUISITOS DE CALIFICACION del PERSONAL CLAVE' },
        fallidas: body.paginas.slice(1).map(p => ({ clave: p.clave, motivo: 'OCR 429' })),
      }),
      localizar: { rangos: { personal: { encontrada: false, rangos: [] } } },
      extraer: { resultado: { requisitos: [] } },
    });
    const r = await analizar(bloquesEscaneados(3), { apiFetch, apiParse });
    expect(r.alertas.join(' ')).toMatch(/OCR 429/);
    expect(r.paginasOcr).toBe(1);
  });

  it('si falla el Pase 1, cae al índice y sigue — peor extracción, no ninguna', async () => {
    const { apiFetch, apiParse, llamadas } = apiFalso({
      ocr: ocrQueDevuelve('REQUISITOS DE CALIFICACION del PERSONAL CLAVE propuesto'),
      localizar: { __error: 502, error: 'el modelo se cayó' },
      extraer: { resultado: { requisitos: [] } },
    });
    const r = await analizar(bloquesEscaneados(1), { apiFetch, apiParse });
    expect(r.alertas.join(' ')).toMatch(/ubica las secciones falló/);
    expect(llamadas.some(l => l.accion === 'extraer')).toBe(true);
  });

  // Lo encontró este mismo test: el párrafo del Residente dice «en obras
  // similares», así que cae en el índice de `personal` Y en el de `empresa`,
  // los dos rangos se leen y el mismo puesto volvía dos veces.
  it('NO propone dos veces el mismo requisito cuando dos familias se pisan', async () => {
    const { apiFetch, apiParse, llamadas } = apiFalso({
      ocr: ocrQueDevuelve(`REQUISITOS DE CALIFICACION\nPersonal clave\n${CITA}.`),
      localizar: { rangos: {
        personal: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
        empresa: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
      } },
      extraer: { resultado: { requisitos: [
        { cargo: 'Residente de Obra', meses_minimos: 36, fuente_pagina: 1, fuente_cita: CITA },
      ] } },
    });
    const r = await analizar(bloquesEscaneados(1), { apiFetch, apiParse });
    expect(llamadas.filter(l => l.accion === 'extraer')).toHaveLength(2);
    expect(r.filas).toHaveLength(1);
  });

  it('el costo que se muestra es el que se gastó: páginas leídas + lo de las pasadas', async () => {
    const { apiFetch, apiParse } = apiFalso({
      ocr: ocrQueDevuelve('REQUISITOS DE CALIFICACION del PERSONAL CLAVE'),
      localizar: { rangos: { personal: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] } }, costo: 0.0012 },
      extraer: { resultado: { requisitos: [] }, costo: 0.0031 },
    });
    const r = await analizar(bloquesEscaneados(5), { apiFetch, apiParse });
    expect(r.costo.ocr).toBeCloseTo(5 * USD_POR_PAGINA_OCR, 4);
    expect(r.costo.pasadas).toBeCloseTo(0.0043, 4);
    expect(r.costo.total).toBeCloseTo(0.0143, 4);
  });

  it('suelta las imágenes al terminar cada tanda (una laptop no aguanta 94 JPEG)', async () => {
    const bloques = bloquesEscaneados(8);
    const { apiFetch, apiParse } = apiFalso({ ocr: ocrQueDevuelve('nada') });
    await analizar(bloques, { apiFetch, apiParse });
    expect(bloques.every(b => b.imagen === null)).toBe(true);
  });
});

describe('presupuestar — el precio ANTES de gastar', () => {
  it('cuenta las páginas que van a OCR y las tandas que hacen falta', () => {
    const p = presupuestar(bloquesEscaneados(94));
    expect(p.paginasOcr).toBe(94);
    expect(p.tandas).toBe(Math.ceil(94 / PAGINAS_POR_TANDA));
    expect(p.costo.total).toBeCloseTo(0.188, 3);
  });
  it('lo que ya es texto no se presupuesta: es gratis', () => {
    const p = presupuestar([{ tipo: 'texto', texto: 'a'.repeat(5000) }]);
    expect(p.paginasOcr).toBe(0);
    expect(p.costo.total).toBe(0);
  });
});
