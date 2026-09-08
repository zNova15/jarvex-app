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

// ═══════════════════════════════════════════════════════════════════
// ENTREGA 4 — la familia `proceso` y la convocatoria que alcanza para crear
// ═══════════════════════════════════════════════════════════════════
import { fusionarRangos, ocrDeBloques, crearPedidor } from '../bases-analisis.js';

const PERUANO_NATIVO = `CONVOCATORIA DEL PROCESO DE SELECCIÓN N° 021-2026-CEPIP-GRDE-OXI-GORECAJ
Monto referencial del Convenio de Inversión S/ 15,804,472.36 con CUI N° 2611946
3. Calendario del proceso de selección:
6 Presentación de Propuestas 23/09/2026 24/09/2026
Empresa Privada o Consorcio`;

describe('analizar — una convocatoria de UNA página nativa crea la postulación sin gastar OCR', () => {
  it('manda la familia proceso con seccion="proceso" y devuelve cabecera, calendario y sugerencia', async () => {
    const { apiFetch, apiParse, llamadas } = apiFalso({
      localizar: { rangos: { proceso: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] }, cronograma: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] } } },
      extraer: (body) => body.seccion === 'proceso' ? {
        resultado: {
          proceso: { nomenclatura: 'PROCESO DE SELECCIÓN N° 021-2026-CEPIP-GRDE-OXI-GORECAJ', cui: '2611946', mecanismo: 'oxi',
            valor_referencial: 15804472.36, tipo_objeto_sugerido: 'obra_ejecucion', fuente_pagina: 1, fuente_cita: 'Monto referencial del Convenio de Inversión S/ 15,804,472.36' },
          cronograma: [{ etapa: 'Presentación de Propuestas', desde: '2026-09-23', hasta: '2026-09-24', fuente_pagina: 1, fuente_cita: 'Presentación de Propuestas 23/09/2026 24/09/2026' }],
          consorcio: { permitido: true, reglas: 'Empresa Privada o Consorcio', fuente_pagina: 1, fuente_cita: 'Empresa Privada o Consorcio' },
          requisitos_empresa: [], alertas: [],
        }, costo: 0,
      } : { resultado: { requisitos: [] } },
    });
    const r = await analizar([{ tipo: 'texto', pagina: 1, texto: PERUANO_NATIVO }], { apiFetch, apiParse });
    expect(llamadas.some(l => l.accion === 'ocr')).toBe(false);
    const proceso = llamadas.filter(l => l.accion === 'extraer' && l.seccion === 'proceso');
    expect(proceso).toHaveLength(1);       // proceso + cronograma en UNA pasada, no dos
    expect(r.cabecera).toMatchObject({ cui: '2611946', mecanismo: 'oxi', valor_referencial: 15804472.36, fecha_presentacion: '2026-09-24', consorcio_permitido: true });
    expect(r.cronograma).toHaveLength(1);
    expect(r.sugerencias.tipo_trabajo).toBe('obra_ejecucion');
    expect(r.costo.total).toBe(0);
  });

  it('los requisitos de empresa salen aparte y numerados después del plantel', async () => {
    const { apiFetch, apiParse } = apiFalso({
      ocr: ocrQueDevuelve(`REQUISITOS DE CALIFICACION\nPersonal clave\n${CITA}.\nEXPERIENCIA DEL POSTOR: monto facturado acumulado equivalente a una vez el valor referencial`),
      localizar: { rangos: {
        personal: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
        empresa: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
      } },
      extraer: (body) => body.seccion === 'empresa' ? {
        resultado: { requisitos_empresa: [{ tipo: 'experiencia_postor', descripcion: 'Experiencia del postor', multiplo_valor_referencial: 1,
          fuente_pagina: 1, fuente_cita: 'monto facturado acumulado equivalente a una vez el valor referencial' }] },
      } : {
        resultado: { requisitos: [{ cargo: 'Residente de Obra', meses_minimos: 36, fuente_pagina: 1, fuente_cita: CITA }] },
      },
    });
    const r = await analizar(bloquesEscaneados(1), { apiFetch, apiParse });
    expect(r.filas).toHaveLength(1);
    expect(r.filasEmpresa).toHaveLength(1);
    expect(r.filasEmpresa[0]).toMatchObject({ clase: 'empresa', verificada: true, orden: 20, multiplo_valor_referencial: 1 });
  });

  it('el proceso se arma campo a campo: la segunda pasada solo llena lo que la primera no trajo', async () => {
    const { apiFetch, apiParse } = apiFalso({
      ocr: ocrQueDevuelve('VALOR REFERENCIAL\nREQUISITOS DE CALIFICACION del personal clave'),
      localizar: { rangos: {
        proceso: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
        personal: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
      } },
      extraer: (body) => body.seccion === 'proceso'
        ? { resultado: { proceso: { cui: '2643390', valor_referencial: null } } }
        : { resultado: { requisitos: [], proceso: { cui: '9999999', valor_referencial: 8460000 } } },
    });
    const r = await analizar(bloquesEscaneados(1), { apiFetch, apiParse });
    expect(r.cabecera.cui).toBe('2643390');                 // el primero manda
    expect(r.cabecera.valor_referencial).toBe(8460000);     // lo vacío se completa
  });
});

describe('fusionarRangos', () => {
  it('une lo que se toca y ordena', () => {
    expect(fusionarRangos([{ desde: 5, hasta: 6 }, { desde: 1, hasta: 2 }, { desde: 3, hasta: 4 }])).toEqual([{ desde: 1, hasta: 6 }]);
    expect(fusionarRangos([{ desde: 1, hasta: 2 }, { desde: 9, hasta: 9 }])).toEqual([{ desde: 1, hasta: 2 }, { desde: 9, hasta: 9 }]);
  });
  it('tolera basura', () => {
    expect(fusionarRangos([{ desde: 'x' }, null, { desde: 3, hasta: 1 }])).toEqual([]);
  });
});

describe('ocrDeBloques — compartido con el lector de CV', () => {
  it('lee de a seis, devuelve lo leído y deja las alertas de lo que falló', async () => {
    const { apiFetch, apiParse, llamadas } = apiFalso({
      ocr: (body) => ({
        textos: Object.fromEntries(body.paginas.slice(0, -1).map(p => [p.clave, 'texto'])),
        fallidas: [{ clave: body.paginas[body.paginas.length - 1].clave, motivo: 'OCR 500' }],
      }),
    });
    const alertas = [];
    const r = await ocrDeBloques(bloquesEscaneados(7), { pedir: crearPedidor(apiFetch, apiParse), alertas });
    expect(llamadas).toHaveLength(2);
    expect(r.leidas).toBe(5);        // 5 de la primera tanda + 0 de la segunda (una sola página, y falló)
    expect(alertas).toHaveLength(2);
  });
});
