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
    // El prompt del proceso devuelve el plantel Y los requisitos de empresa en
    // la MISMA pasada cuando ambos caen en el mismo texto (desde la entrega 5
    // eso es una sola llamada, no dos: ver el dedup más abajo).
    const { apiFetch, apiParse } = apiFalso({
      ocr: ocrQueDevuelve(`REQUISITOS DE CALIFICACION\nPersonal clave\n${CITA}.\nEXPERIENCIA DEL POSTOR: monto facturado acumulado equivalente a una vez el valor referencial`),
      localizar: { rangos: {
        personal: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
        empresa: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
      } },
      extraer: (body) => body.seccion === 'personal' ? {
        resultado: { requisitos: [{ cargo: 'Residente de Obra', meses_minimos: 36, fuente_pagina: 1, fuente_cita: CITA }] },
      } : {
        resultado: { requisitos_empresa: [{ tipo: 'experiencia_postor', descripcion: 'Experiencia del postor', multiplo_valor_referencial: 1,
          fuente_pagina: 1, fuente_cita: 'monto facturado acumulado equivalente a una vez el valor referencial' }] },
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

// ═══════════════════════════════════════════════════════════════════
// ENTREGA 5 — no pedir dos veces lo mismo, y no pagar dos veces el escaneo
// ═══════════════════════════════════════════════════════════════════
import { alertasUnicas } from '../bases-analisis.js';

describe('analizar — el mismo texto no se manda dos veces', () => {
  // El caso REAL del 8-set: una convocatoria de UNA página. Las familias
  // `proceso` y `empresa` caen en el mismo rango y comparten prompt, así que
  // se pedía dos veces lo mismo y las alertas salían duplicadas.
  it('proceso y empresa comparten rango y prompt: una sola llamada', async () => {
    const { apiFetch, apiParse, llamadas } = apiFalso({
      localizar: { rangos: {
        proceso: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
        empresa: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
      } },
      extraer: { resultado: { proceso: { cui: '2611946' }, requisitos_empresa: [], alertas: ['la fecha viene truncada'] } },
    });
    const r = await analizar([{ tipo: 'texto', pagina: 1, texto: PERUANO_NATIVO }], { apiFetch, apiParse });
    const extraidas = llamadas.filter(l => l.accion === 'extraer');
    expect(extraidas).toHaveLength(1);
    // Y la alerta sale UNA vez, no dos.
    expect(r.alertas.filter(a => /truncada/.test(a))).toHaveLength(1);
  });

  it('personal sí es una llamada aparte: usa otro prompt', async () => {
    const { apiFetch, apiParse, llamadas } = apiFalso({
      localizar: { rangos: {
        proceso: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
        personal: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] },
      } },
      extraer: { resultado: { requisitos: [] } },
    });
    await analizar([{ tipo: 'texto', pagina: 1, texto: `${PERUANO_NATIVO}\nPERSONAL CLAVE` }], { apiFetch, apiParse });
    expect(llamadas.filter(l => l.accion === 'extraer')).toHaveLength(2);
  });

  it('con el texto ya leído NO se vuelve a pagar el escaneo', async () => {
    const { apiFetch, apiParse, llamadas } = apiFalso({
      localizar: { rangos: { proceso: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] } } },
      extraer: { resultado: { proceso: { cui: '2611946' } } },
    });
    const cacheado = { markdown: `<!-- página 1 -->\n${PERUANO_NATIVO}`, paginasOcr: 15 };
    const r = await analizar(bloquesEscaneados(15), { apiFetch, apiParse, cacheado });
    expect(llamadas.some(l => l.accion === 'ocr')).toBe(false);
    expect(r.reusado).toBe(true);
    expect(r.costo.total).toBe(0);
    expect(r.cabecera.cui).toBe('2611946');
  });

  it('devuelve las cinco listas de la mig 200 ya mapeadas', async () => {
    const cita = 'La garantia de fiel cumplimiento equivale al diez por ciento del monto';
    const { apiFetch, apiParse } = apiFalso({
      localizar: { rangos: { proceso: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] } } },
      extraer: { resultado: {
        garantias: [{ tipo: 'fiel_cumplimiento', porcentaje: 10, fuente_pagina: 1, fuente_cita: cita }],
        condiciones: [{ tipo: 'adelanto', titulo: 'Adelanto del 10%' }],
        penalidades: [], factores_evaluacion: [], documentos_presentacion: [],
      } },
    });
    const r = await analizar([{ tipo: 'texto', pagina: 1, texto: `VALOR REFERENCIAL\n${cita}` }], { apiFetch, apiParse });
    expect(r.extras.garantias[0]).toMatchObject({ tipo: 'fiel_cumplimiento', porcentaje: 10, verificada: true });
    expect(r.extras.condiciones[0].tipo).toBe('adelanto');
  });
});

describe('alertasUnicas', () => {
  it('junta las repetidas sin perder las distintas', () => {
    expect(alertasUnicas(['La fecha viene truncada', 'la  FECHA viene truncada', 'Otra cosa', '', null]))
      .toEqual(['La fecha viene truncada', 'Otra cosa']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ENTREGA 6 — lo que rompió las pruebas reales del 8-set por la tarde
// ═══════════════════════════════════════════════════════════════════
import { MAX_PARTICIONES, MAX_VENTANAS, rangosDeFamilia } from '../bases-analisis.js';

describe('cuando la respuesta se corta, el rango se parte SOLO', () => {
  // El caso real: «No se pudo extraer personal (páginas 21–23): la respuesta se
  // cortó por tamaño. Analiza un rango más corto.» Ese mensaje le pedía al
  // usuario que hiciera a mano lo que el programa puede hacer.
  const md = Array.from({ length: 12 }, (_, i) =>
    `<!-- página ${i + 1} -->\nREQUISITOS DE CALIFICACION del PERSONAL CLAVE\n${CITA} en el tramo ${i + 1}.`).join('\n');

  it('parte en dos y vuelve a intentar hasta que entra', async () => {
    const rangos = [];
    const { apiFetch, apiParse } = apiFalso({
      localizar: { rangos: { personal: { encontrada: true, rangos: [{ desde: 1, hasta: 8 }] } } },
      extraer: (body) => {
        const n = (body.texto.match(/<!-- página/g) || []).length;
        rangos.push(n);
        // Se corta mientras el tramo tenga más de 2 páginas.
        if (n > 2) return { __error: 422, error: 'La respuesta se cortó por tamaño.', code: 'respuesta_cortada' };
        return { resultado: { requisitos: [{ cargo: `Residente ${n}`, meses_minimos: 36, fuente_pagina: 1, fuente_cita: CITA }] } };
      },
    });
    const r = await analizar([{ tipo: 'texto', pagina: 1, texto: 'x' }], { apiFetch, apiParse, cacheado: { markdown: md, paginasOcr: 0 } });
    // Empezó con 8 páginas y terminó pidiendo tandas de 2 o menos.
    expect(Math.max(...rangos)).toBeGreaterThan(2);
    expect(Math.min(...rangos)).toBeLessThanOrEqual(2);
    expect(r.filas.length).toBeGreaterThan(0);
  });

  it('si ni una sola página entra, avisa en vez de perderlo en silencio', async () => {
    const { apiFetch, apiParse } = apiFalso({
      localizar: { rangos: { personal: { encontrada: true, rangos: [{ desde: 1, hasta: 4 }] } } },
      extraer: { __error: 422, error: 'La respuesta se cortó por tamaño.', code: 'respuesta_cortada' },
    });
    const r = await analizar([{ tipo: 'texto', pagina: 1, texto: 'x' }], { apiFetch, apiParse, cacheado: { markdown: md, paginasOcr: 0 } });
    expect(r.alertas.join(' ')).toMatch(/demasiado contenido para leerlo de una/);
    expect(MAX_PARTICIONES).toBe(3);
  });
});

describe('rangosDeFamilia — el Pase 1 AFINA, no reemplaza al índice', () => {
  // El caso real del Anexo 13: el índice encontró el plantel en los tramos 2,
  // 21 a 24 y 55, pero el Pase 1 devolvía un rango y el resto no se leía. El
  // modelo avisó: «el contenido del ANEXO C NO está incluido en el texto».
  const resumen = { personal: { aciertos: 9, paginas: [2, 21, 22, 23, 24, 55] } };

  it('lee lo que eligió el Pase 1 Y lo que encontró el índice', () => {
    const r = rangosDeFamilia({ personal: { encontrada: true, rangos: [{ desde: 30, hasta: 32 }] } }, resumen, 'personal');
    const cubre = (n) => r.some(x => n >= x.desde && n <= x.hasta);
    expect(cubre(31)).toBe(true);      // lo del Pase 1
    expect(cubre(22)).toBe(true);      // lo del índice
    expect(cubre(55)).toBe(true);      // la zona lejana que antes se perdía
  });

  it('sin Pase 1 sigue leyendo todas las zonas del índice', () => {
    const r = rangosDeFamilia(null, resumen, 'personal');
    expect(r.some(x => 55 >= x.desde && 55 <= x.hasta)).toBe(true);
  });

  it('con demasiadas zonas se queda con las más grandes, que son las secciones de verdad', () => {
    const muchas = { personal: { aciertos: 30, paginas: [1, 5, 9, 13, 17, 21, 22, 23, 24, 25, 40, 50] } };
    const r = rangosDeFamilia(null, muchas, 'personal');
    expect(r.length).toBeLessThanOrEqual(MAX_VENTANAS);
    // La zona 21-25 es la más densa: no se puede perder.
    expect(r.some(x => 23 >= x.desde && 23 <= x.hasta)).toBe(true);
    // Y quedan ordenadas por posición en el documento.
    expect(r.map(x => x.desde)).toEqual([...r.map(x => x.desde)].sort((a, b) => a - b));
  });
});

describe('el dedup mira la CITA, no el tipo', () => {
  it('el mismo requisito con distinto «tipo» entra una sola vez', async () => {
    const cita = 'Conforme el articulo 117 del Reglamento de la Ley N 29230, la Entidad Privada Supervisora no puede tener vinculo';
    const { apiFetch, apiParse } = apiFalso({
      localizar: { rangos: { proceso: { encontrada: true, rangos: [{ desde: 1, hasta: 1 }] } } },
      extraer: { resultado: { requisitos_empresa: [
        { tipo: 'otro', descripcion: 'A', fuente_pagina: 1, fuente_cita: cita },
        { tipo: 'habilitacion', descripcion: 'B', fuente_pagina: 1, fuente_cita: cita },
      ] } },
    });
    const r = await analizar([{ tipo: 'texto', pagina: 1, texto: `VALOR REFERENCIAL\n${cita}` }], { apiFetch, apiParse });
    expect(r.filasEmpresa).toHaveLength(1);
  });
});
