// ═══════════════════════════════════════════════════════════════════
// EXTRACCIÓN DE BASES — el índice sin IA, la verificación de citas y la
// traducción a la fila que la app ya sabe evaluar (tanda 15, entrega 3).
//
// El caso que recorre casi todo el archivo es el REAL: el Jefe de Supervisión
// del Anexo 13 de Chilete, el mismo requisito que en la entrega 2 destapó que
// el verificador daba un ✅ falso.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  normalizar, fragmentosPorPagina, indiceDeSecciones, resumenIndice,
  textoDeRango, verificarCita, verificarResultado,
  aFilaRequisito, aFilasRequisitos, aCabeceraLicitacion, costoDelAnalisis,
  USD_POR_PAGINA_OCR,
  clave, contarClave, clasificarRegimen, esRenglonDeIndice,
  citaEsPlantilla, camposSinLlenar, SECCIONES,
  agruparRequisitos, aExtrasProceso, extrasNoVerificados, elegirAciertos,
} from '../bases-extraccion.js';
import { anexoSePresenta, separarAnexos } from '../documentos-partes.js';
import { rangosDeFamilia } from '../bases-analisis.js';

// El texto literal del Anexo 13, tal como lo leyó el triage.
const CITA_JEFE = 'Experiencia no menor de 03 años, sustentada con copia de diploma de incorporación al Colegio respectivo';
const MD = `<!-- página 1 -->
BASES INTEGRADAS DEL PROCEDIMIENTO DE SELECCIÓN

<!-- página 12 -->
CRONOGRAMA DEL PROCEDIMIENTO DE SELECCIÓN
Presentación de ofertas: 15/10/2026

<!-- página 47 -->
REQUISITOS DE CALIFICACIÓN
Jefe de Supervisión del Proyecto
${CITA_JEFE}. Sustentar como mínimo 02 participaciones como Residente de obra
y/o Supervisor de obra, por un plazo no menor a 02 meses cada participación, en
los últimos 10 años.

<!-- página 51 -->
FACTORES DE EVALUACIÓN
Puntaje total: 100 puntos`;

describe('normalizar', () => {
  it('borra tildes y colapsa espacios (el OCR pierde las dos cosas)', () => {
    expect(normalizar('  Ingeniería   Civil  ')).toBe('INGENIERIA CIVIL');
  });
  it('la ñ también cae a N, y las dos puntas pasan por acá', () => {
    expect(normalizar('DISEÑO')).toBe(normalizar('DISENO'));
  });
});

describe('fragmentosPorPagina', () => {
  it('parte por el ancla y le pone su número a cada trozo', () => {
    const f = fragmentosPorPagina(MD);
    expect(f.map(x => x.pagina)).toEqual([1, 12, 47, 51]);
    expect(f[2].texto).toContain('Jefe de Supervisión');
  });
  it('un documento sin anclas (un .docx) es un solo trozo sin página', () => {
    const f = fragmentosPorPagina('texto suelto sin marcadores');
    expect(f).toHaveLength(1);
    expect(f[0].pagina).toBeNull();
  });
  it('tolera vacío', () => {
    expect(fragmentosPorPagina('')).toEqual([]);
    expect(fragmentosPorPagina(null)).toEqual([]);
  });
});

describe('indiceDeSecciones — el grep que abarata todo', () => {
  const indice = indiceDeSecciones(MD);

  it('encuentra el plantel donde está, con su página', () => {
    expect(indice.personal.length).toBeGreaterThan(0);
    expect(indice.personal.some(h => h.pagina === 47)).toBe(true);
  });
  it('encuentra el cronograma y los factores de evaluación', () => {
    expect(indice.cronograma.some(h => h.pagina === 12)).toBe(true);
    expect(indice.evaluacion.some(h => h.pagina === 51)).toBe(true);
  });
  it('no inventa lo que no está', () => {
    expect(resumenIndice(indice).empresa.aciertos).toBe(0);
  });
  it('el renglón se recorta: al Pase 1 le alcanza para reconocer la sección', () => {
    for (const hits of Object.values(indice)) {
      for (const h of hits) expect(h.linea.length).toBeLessThanOrEqual(220);
    }
  });
  it('encuentra aunque el OCR se haya comido las tildes', () => {
    const sinTildes = indiceDeSecciones('<!-- página 3 -->\nREQUISITOS DE CALIFICACION DEL PERSONAL CLAVE');
    expect(sinTildes.personal.some(h => h.pagina === 3)).toBe(true);
  });
});

describe('textoDeRango', () => {
  it('devuelve solo las páginas pedidas, con su ancla', () => {
    const t = textoDeRango(MD, 47, 47);
    expect(t).toContain('Jefe de Supervisión');
    expect(t).toContain('<!-- página 47 -->');
    expect(t).not.toContain('CRONOGRAMA');
  });
  it('sin páginas devuelve todo (el caso .docx)', () => {
    expect(textoDeRango('un docx entero', 1, 5)).toBe('un docx entero');
  });
});

// ── LO QUE HACE CONFIABLE A TODO ESTO ──────────────────────────────
describe('verificarCita — la cita, ¿existe de verdad?', () => {
  it('acepta la cita literal y devuelve su página', () => {
    const v = verificarCita(MD, CITA_JEFE, 47);
    expect(v.verificada).toBe(true);
    expect(v.paginaReal).toBe(47);
  });
  it('acepta aunque cambien tildes, mayúsculas y espacios (así devuelve el OCR)', () => {
    expect(verificarCita(MD, 'EXPERIENCIA  NO MENOR DE 03 ANOS', 47).verificada).toBe(true);
  });
  it('RECHAZA una cita inventada — el error caro de este módulo', () => {
    const v = verificarCita(MD, 'Experiencia no menor de 05 años en obras de saneamiento', 47);
    expect(v.verificada).toBe(false);
    expect(v.motivo).toMatch(/no aparece/);
  });
  it('rechaza la cita real puesta en la página que no es', () => {
    const v = verificarCita(MD, CITA_JEFE, 12);
    expect(v.verificada).toBe(false);
    expect(v.paginaReal).toBe(47);
    expect(v.motivo).toMatch(/página 47/);
  });
  it('una cita demasiado corta no se puede comprobar y no pasa', () => {
    expect(verificarCita(MD, '03 años', 47).verificada).toBe(false);
  });
});

describe('verificarResultado — lo no verificado se marca, NO se borra', () => {
  const resultado = {
    requisitos: [
      { cargo: 'Jefe de Supervisión del Proyecto', fuente_cita: CITA_JEFE, fuente_pagina: 47 },
      { cargo: 'Especialista en Suelos', fuente_cita: 'Experiencia no menor de 05 años en mecánica de suelos', fuente_pagina: 47 },
    ],
    alertas: [],
  };
  const v = verificarResultado(resultado, MD);

  it('el real queda verificado', () => {
    expect(v.requisitos[0].verificada).toBe(true);
  });
  it('el inventado sigue en la lista, marcado y con alerta', () => {
    expect(v.requisitos).toHaveLength(2);
    expect(v.requisitos[1].verificada).toBe(false);
    expect(v.alertas.join(' ')).toMatch(/Especialista en Suelos/);
  });
  it('corrige la página cuando la cita existe en otra', () => {
    const r = verificarResultado({ requisitos: [{ cargo: 'X', fuente_cita: CITA_JEFE, fuente_pagina: 3 }] }, MD);
    expect(r.requisitos[0].fuente_pagina).toBe(47);
  });
  it('tolera basura', () => {
    expect(verificarResultado(null, MD).requisitos).toEqual([]);
  });
});

// ── LA FILA QUE COME evaluarRequisito() ────────────────────────────
describe('aFilaRequisito — los cinco criterios del requisito real', () => {
  const fila = aFilaRequisito({
    cargo: 'Jefe de Supervisión del Proyecto', profesion: 'Ingeniero Civil',
    meses_minimos: 36, participaciones_minimas: 2, meses_por_participacion: 2,
    ventana_anios: 10, cargos_equivalentes: ['Residente de obra', 'Supervisor de obra'],
    fuente_pagina: 47, fuente_cita: CITA_JEFE,
  }, { orden: 10 });

  it('guarda los cinco criterios, que es lo que la mig 198 vino a arreglar', () => {
    expect(fila.meses_minimos).toBe(36);
    expect(fila.participaciones_minimas).toBe(2);
    expect(fila.meses_por_participacion).toBe(2);
    expect(fila.ventana_anios).toBe(10);
    expect(fila.cargos_equivalentes).toHaveLength(2);
  });
  it('la fuente queda en "extraccion" con su página y su cita', () => {
    expect(fila.fuente).toBe('extraccion');
    expect(fila.fuente_pagina).toBe(47);
    expect(fila.fuente_cita).toBe(CITA_JEFE);
  });
  it('rubro_id y candidato SIEMPRE null: eso no lo decide un modelo', () => {
    expect(fila.rubro_id).toBeNull();
    expect(fila.candidato_personal_id).toBeNull();
  });
  it('un número imposible cae al default en vez de guardarse', () => {
    const f = aFilaRequisito({ cargo: 'X', meses_minimos: -5, participaciones_minimas: 'dos' });
    expect(f.meses_minimos).toBe(0);
    expect(f.participaciones_minimas).toBe(0);
  });
  it('sin ventana declarada, ventana_anios queda null (no en 0)', () => {
    expect(aFilaRequisito({ cargo: 'X' }).ventana_anios).toBeNull();
  });
  it('numera en el orden en que aparecen en las bases', () => {
    const filas = aFilasRequisitos({ requisitos: [{ cargo: 'A' }, { cargo: 'B' }] });
    expect(filas.map(f => f.orden)).toEqual([10, 20]);
  });
});

describe('aCabeceraLicitacion — solo lo que se puede leer', () => {
  it('toma los datos del proceso', () => {
    const c = aCabeceraLicitacion({ proceso: {
      nomenclatura: 'LP-SM-1-2026-MDCH-1', objeto: 'Supervisión de la obra',
      entidad_ruc: '20601234567', valor_referencial: 1250000.5, fecha_presentacion: '2026-10-15',
    } });
    expect(c.nomenclatura).toBe('LP-SM-1-2026-MDCH-1');
    expect(c.entidad_ruc).toBe('20601234567');
    expect(c.valor_referencial).toBe(1250000.5);
    expect(c.fecha_presentacion).toBe('2026-10-15');
  });
  it('descarta un RUC que no es un RUC y una fecha que no es fecha', () => {
    const c = aCabeceraLicitacion({ proceso: { entidad_ruc: '123', fecha_presentacion: '15 de octubre' } });
    expect(c.entidad_ruc).toBeNull();
    expect(c.fecha_presentacion).toBeNull();
  });
  it('no propone tipo_trabajo ni con qué empresa postulamos: eso lo decide una persona', () => {
    const c = aCabeceraLicitacion({ proceso: { tipo_trabajo: 'obra_ejecucion', postulante_company_id: 'x' } });
    expect(c.tipo_trabajo).toBeUndefined();
    expect(c.postulante_company_id).toBeUndefined();
  });
});

describe('costoDelAnalisis', () => {
  it('las 94 páginas de las BASES INTEGRADAS 009 salen USD 0,188', () => {
    expect(costoDelAnalisis({ paginasOcr: 94 }).total).toBeCloseTo(94 * USD_POR_PAGINA_OCR, 4);
  });
  it('suma lo que informó OpenRouter por las pasadas', () => {
    const c = costoDelAnalisis({ paginasOcr: 10, usdPasadas: 0.004 });
    expect(c.ocr).toBeCloseTo(0.02, 4);
    expect(c.total).toBeCloseTo(0.024, 4);
  });
});

describe('rangosDeFamilia — el Pase 1 elige, y si falla el índice salva', () => {
  const resumen = { personal: { aciertos: 2, paginas: [47, 48] }, empresa: { aciertos: 0, paginas: [] } };

  it('usa lo que eligió el Pase 1', () => {
    const r = rangosDeFamilia({ personal: { encontrada: true, rangos: [{ desde: 45, hasta: 50 }] } }, resumen, 'personal');
    expect(r).toEqual([{ desde: 45, hasta: 50 }]);
  });
  it('recorta un rango larguísimo: eso es que el Pase 1 no encontró nada', () => {
    const r = rangosDeFamilia({ personal: { encontrada: true, rangos: [{ desde: 1, hasta: 96 }] } }, resumen, 'personal');
    expect(r[0].hasta - r[0].desde).toBeLessThanOrEqual(11);
  });
  it('sin Pase 1, cae al índice con una ventana alrededor y fusiona lo que se toca', () => {
    expect(rangosDeFamilia(null, resumen, 'personal')).toEqual([{ desde: 46, hasta: 49 }]);
  });
  it('si el índice tampoco encontró nada, no se gasta una llamada', () => {
    expect(rangosDeFamilia(null, resumen, 'empresa')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ENTREGA 4 — el proceso entero, la convocatoria de El Peruano y la empresa
// ═══════════════════════════════════════════════════════════════════
import {
  aFilaRequisitoEmpresa, aFilasEmpresa, aCronograma, fechaPresentacionDe, fechaISO, sugerenciasDe,
  TIPO_REQ_EMPRESA_LBL,
} from '../bases-extraccion.js';

// Renglones LITERALES de PUBLICADO_PERUANO_P-S N° 021-2026.pdf (8-set-2026),
// tal como los reconstruye el triage (las dos columnas del diario se mezclan
// en la misma línea: así llega el texto y así tiene que encontrarlo el índice).
const PERUANO = `<!-- página 1 -->
MODELO DE CONVOCATORIA AL PROCESO DE SELECCIÓN DE LA EMPRESA PRIVADA calendario, en el horario de 07:30 a 13:00 horas y de 14:30 a 17:00 horas.
CONVOCATORIA DEL PROCESO DE SELECCIÓN N° 021-2026-CEPIP-GRDE-OXI-GORECAJ-
PRIMERA CONVOCATORIA.
CONTRATACIÓN DE LA EMPRESA PRIVADA PARA EJECUCIÓN Y FINANCIAMIENTO
DEL PROYECTO DE INVERSIÓN: "MEJORAMIENTO Y AMPLIACION DEL SERVICIO DE
MERCADO DE ABASTOS DE LA LOCALIDAD DE CHILETE DISTRITO DE CHILETE DE LA
PROVINCIA DE CONTUMAZA DEL DEPARTAMENTO DE CAJAMARCA" con CUI N° 2611946.
1. Entidad pública que convoca el proceso de selección:
2. Objeto de la convocatoria y descripción la(s) inversión(es)
Código de Monto referencial del
N° Nombre de la Inversión ejecución
"MEJORAMIENTO Y AMPLIACION DEL SERVICIO DE S/ 15,804,472.36
*El monto referencial del Convenio de Inversión contempla el financiamiento de la ejecución del proyecto
3. Calendario del proceso de selección:
1 Convocatoria y publicación de Bases. 08/09/2026
2 Presentación de Expresiones de interés (1) 09/09/2026 17/09/2026
6 Presentación de Propuestas, a través de los Sobres N° 1, N° 2 y N° 3 (5) 23/09/2026 24/09/2026
9 Consentimiento de la Buena Pro (8) 30/09/2026 12/10/2026
Empresa Privada o Consorcio (9)`;

describe('indiceDeSecciones — la convocatoria de El Peruano (Obras por Impuestos)', () => {
  it('encuentra los datos del proceso: antes daba 0 aciertos en esta familia', () => {
    const idx = indiceDeSecciones(PERUANO);
    expect(idx.proceso.length).toBeGreaterThan(0);
    expect(idx.proceso.some(h => h.clave === 'MONTO REFERENCIAL')).toBe(true);
    expect(idx.proceso.some(h => h.clave === 'CUI N')).toBe(true);
  });
  it('encuentra el calendario aunque diga «proceso» y «propuestas» en vez de «procedimiento» y «ofertas»', () => {
    const idx = indiceDeSecciones(PERUANO);
    expect(idx.cronograma.some(h => h.clave === 'CALENDARIO DEL PROCESO')).toBe(true);
    expect(idx.cronograma.some(h => h.clave === 'PRESENTACION DE PROPUESTAS')).toBe(true);
  });
  it('«Empresa Privada o Consorcio» cae en la familia de la empresa', () => {
    expect(indiceDeSecciones(PERUANO).empresa.some(h => h.clave === 'EMPRESA PRIVADA O CONSORCIO')).toBe(true);
  });
});

describe('fechaISO / aCronograma / fechaPresentacionDe', () => {
  it('acepta ISO y da vuelta el DD/MM/YYYY de la entidad', () => {
    expect(fechaISO('2026-09-23')).toBe('2026-09-23');
    expect(fechaISO('23/09/2026')).toBe('2026-09-23');
    expect(fechaISO('23 de setiembre')).toBeNull();
  });
  it('arma el calendario ordenado, sin repetir y sin etapas sin fecha', () => {
    const c = aCronograma({ cronograma: [
      { etapa: 'Presentación de Propuestas', desde: '23/09/2026', hasta: '24/09/2026', fuente_pagina: 1 },
      { etapa: 'Convocatoria y publicación de Bases', desde: '2026-09-08' },
      { etapa: 'Presentación de Propuestas', desde: '2026-09-23', hasta: '2026-09-24' },   // repetida
      { etapa: 'Otorgamiento de la Buena Pro', desde: 'por definir' },
    ] });
    expect(c.map(e => e.etapa)).toEqual(['Convocatoria y publicación de Bases', 'Presentación de Propuestas']);
    expect(c[1]).toMatchObject({ desde: '2026-09-23', hasta: '2026-09-24', fuente_pagina: 1 });
  });
  it('la fecha que manda es el ÚLTIMO día de la presentación de propuestas (no la expresión de interés)', () => {
    const c = aCronograma({ cronograma: [
      { etapa: 'Presentación de Expresiones de interés', desde: '2026-09-09', hasta: '2026-09-17' },
      { etapa: 'Presentación de Propuestas, a través de los Sobres', desde: '2026-09-23', hasta: '2026-09-24' },
    ] });
    expect(fechaPresentacionDe(c)).toBe('2026-09-24');
    expect(fechaPresentacionDe([])).toBeNull();
  });
});

describe('aCabeceraLicitacion — el proceso entero (mig 199)', () => {
  const RES = { proceso: {
    nomenclatura: 'PROCESO DE SELECCIÓN N° 021-2026-CEPIP-GRDE-OXI-GORECAJ-PRIMERA CONVOCATORIA',
    objeto: 'Ejecución y financiamiento del proyecto', nombre_inversion: 'MEJORAMIENTO Y AMPLIACION DEL SERVICIO…',
    cui: '2611946', mecanismo: 'oxi', valor_referencial: 15804472.36, monto_ejecucion: 15051878.44,
    monto_supervision: 735343.92, plazo_ejecucion_dias: 240, tipo_objeto_sugerido: 'obra_ejecucion',
  }, cronograma: [{ etapa: 'Presentación de Propuestas', desde: '2026-09-23', hasta: '2026-09-24' }],
  consorcio: { permitido: true, reglas: 'Promesa formal de consorcio; representante común.' } };

  it('toma CUI, mecanismo, desglose, plazo y consorcio', () => {
    const c = aCabeceraLicitacion(RES);
    expect(c).toMatchObject({
      cui: '2611946', mecanismo: 'oxi', valor_referencial: 15804472.36, monto_ejecucion: 15051878.44,
      monto_supervision: 735343.92, plazo_ejecucion_dias: 240, consorcio_permitido: true,
    });
    expect(c.consorcio_reglas).toMatch(/Promesa formal/);
  });
  it('sin fecha_presentacion explícita la saca del calendario', () => {
    expect(aCabeceraLicitacion(RES).fecha_presentacion).toBe('2026-09-24');
  });
  it('un CUI que no parece CUI y un mecanismo desconocido caen a null', () => {
    const c = aCabeceraLicitacion({ proceso: { cui: 'CUI-XYZ', mecanismo: 'magia' } });
    expect(c.cui).toBeNull();
    expect(c.mecanismo).toBeNull();
    expect(c.consorcio_permitido).toBeNull();
  });
  it('el tipo va como SUGERENCIA aparte, nunca en la cabecera', () => {
    expect(aCabeceraLicitacion(RES).tipo_trabajo).toBeUndefined();
    expect(sugerenciasDe(RES).tipo_trabajo).toBe('obra_ejecucion');
    expect(sugerenciasDe({ proceso: { tipo_objeto_sugerido: 'cualquier cosa' } }).tipo_trabajo).toBeNull();
  });
});

describe('aFilaRequisitoEmpresa — lo que descalifica al postor', () => {
  it('guarda tipo, descripción, múltiplo y ventana con la forma de la fila', () => {
    const f = aFilaRequisitoEmpresa({
      tipo: 'experiencia_postor', descripcion: 'Monto facturado acumulado en obras similares',
      multiplo_valor_referencial: 1, ventana_anios: 8, fuente_pagina: 48, fuente_cita: 'equivalente a una (1) vez el valor referencial',
    }, { orden: 10 });
    expect(f).toMatchObject({
      clase: 'empresa', cargo: TIPO_REQ_EMPRESA_LBL.experiencia_postor, multiplo_valor_referencial: 1,
      ventana_anios: 8, monto_minimo: null, fuente: 'extraccion', fuente_pagina: 48, exige_colegiatura: false,
    });
  });
  it('un tipo desconocido cae a «otro» y un monto imposible a null', () => {
    const f = aFilaRequisitoEmpresa({ tipo: 'xx', monto_minimo: 'mucho' });
    expect(f.cargo).toBe(TIPO_REQ_EMPRESA_LBL.otro);
    expect(f.monto_minimo).toBeNull();
  });
  it('numera DESPUÉS de los puestos de personal', () => {
    const fs = aFilasEmpresa({ requisitos_empresa: [{ tipo: 'rnp' }, { tipo: 'facturacion' }] }, { desde: 3 });
    expect(fs.map(f => f.orden)).toEqual([40, 50]);
  });
});

describe('verificarResultado — la aduana también pasa por empresa, calendario y consorcio', () => {
  it('marca lo no verificado en los tres, sin borrarlo', () => {
    const md = '<!-- página 1 -->\nPresentación de Propuestas 23/09/2026 24/09/2026\nEmpresa Privada o Consorcio';
    const r = verificarResultado({
      requisitos: [],
      requisitos_empresa: [{ tipo: 'rnp', fuente_pagina: 1, fuente_cita: 'Registro Nacional de Proveedores vigente' }],
      cronograma: [{ etapa: 'Presentación de Propuestas', desde: '2026-09-23', fuente_pagina: 1, fuente_cita: 'Presentación de Propuestas 23/09/2026 24/09/2026' }],
      consorcio: { permitido: true, fuente_pagina: 1, fuente_cita: 'Empresa Privada o Consorcio' },
    }, md);
    expect(r.requisitos_empresa[0].verificada).toBe(false);
    expect(r.cronograma[0].verificada).toBe(true);
    expect(r.consorcio.verificada).toBe(true);
    expect(r.requisitos_empresa).toHaveLength(1);
    expect(r.alertas.join(' ')).toMatch(/rnp|requisito de empresa/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ENTREGA 5 — el tope que faltaba y el resto de lo que dicen las bases
// ═══════════════════════════════════════════════════════════════════
import {
  MAX_CHARS_RANGO, aFactoresEvaluacion, aGarantias, aPenalidades,
  aDocumentosPresentacion, aCondiciones, aExtrasProceso, TIPO_GARANTIA_LBL,
} from '../bases-extraccion.js';

describe('textoDeRango — el tope que evitó el 422 (8-set-2026)', () => {
  // El caso REAL: un .docx sin anclas devolvía el documento entero, 236.669
  // caracteres contra un tope de 120.000 del servidor, y las tres familias
  // fallaban con «El rango es demasiado grande». Cero extracción.
  it('un documento sin anclas ya no devuelve 236.669 caracteres de una', () => {
    const enorme = 'REQUISITOS DE CALIFICACION del personal clave.\n'.repeat(6000);
    expect(enorme.length).toBeGreaterThan(200_000);
    const t = textoDeRango(enorme, 1, 1);
    expect(t.length).toBeLessThanOrEqual(MAX_CHARS_RANGO);
    expect(t.length).toBeGreaterThan(1000);      // recorta, no vacía
  });
  it('queda por debajo del tope del endpoint, con margen para el prompt', () => {
    expect(MAX_CHARS_RANGO).toBeLessThan(120_000);
  });
  it('corta en un salto de línea para no partir una cita al medio', () => {
    const t = textoDeRango('linea de texto que se repite\n'.repeat(5000), 1, 1);
    expect(t.endsWith('linea de texto que se repite')).toBe(true);
  });
  it('lo que entra en el tope sale intacto', () => {
    const md = '<!-- página 3 -->\nchico';
    expect(textoDeRango(md, 3, 3)).toContain('chico');
  });
});

describe('aGarantias / aPenalidades / aFactores / aCondiciones (mig 200)', () => {
  it('la garantía de fiel cumplimiento guarda su porcentaje y su cita', () => {
    const g = aGarantias({ garantias: [{ tipo: 'fiel_cumplimiento', porcentaje: 10, detalle: 'Carta fianza solidaria', fuente_pagina: 60, fuente_cita: 'diez por ciento (10%) del monto' }] });
    expect(g[0]).toMatchObject({ tipo: 'fiel_cumplimiento', porcentaje: 10, fuente_pagina: 60, verificada: true });
    expect(TIPO_GARANTIA_LBL[g[0].tipo]).toBe('Fiel cumplimiento');
  });
  it('un tipo de garantía desconocido cae a «otra» y una vacía no entra', () => {
    const g = aGarantias({ garantias: [{ tipo: 'magica', detalle: 'algo' }, { tipo: 'fiel_cumplimiento' }] });
    expect(g).toHaveLength(1);
    expect(g[0].tipo).toBe('otra');
  });
  it('la penalidad de mora guarda su fórmula y su tope', () => {
    const p = aPenalidades({ penalidades: [{ tipo: 'mora', formula: '0.10 x monto / (0.40 x plazo)', tope: '10% del contrato' }] });
    expect(p[0]).toMatchObject({ tipo: 'mora', tope: '10% del contrato' });
  });
  it('un factor sin nombre no entra; el puntaje se guarda como número', () => {
    const f = aFactoresEvaluacion({ factores_evaluacion: [{ puntaje_maximo: 40 }, { factor: 'Experiencia del postor', puntaje_maximo: '40' }] });
    expect(f).toHaveLength(1);
    expect(f[0].puntaje_maximo).toBe(40);
  });
  it('las condiciones se tipifican y lo desconocido cae en «otra»', () => {
    const c = aCondiciones({ condiciones: [
      { tipo: 'adelanto', titulo: 'Adelanto directo del 10%' },
      { tipo: 'inventado', detalle: 'algo raro' },
    ] });
    expect(c.map(x => x.tipo)).toEqual(['adelanto', 'otra']);
  });
  it('los documentos de presentación no se repiten', () => {
    const d = aDocumentosPresentacion({ documentos_presentacion: [
      { sobre: 'Sobre N° 1', documento: 'Anexo N° 1 - Declaración jurada' },
      { sobre: 'Sobre N° 1', documento: 'ANEXO N° 1 - DECLARACION JURADA' },
      { sobre: 'Sobre N° 2', documento: 'Oferta económica' },
    ] });
    expect(d).toHaveLength(2);
    expect(d[0].obligatorio).toBe(true);
  });
  it('aExtrasProceso devuelve las cinco listas, aunque estén vacías', () => {
    const e = aExtrasProceso({});
    expect(Object.keys(e).sort()).toEqual(['condiciones', 'documentos_presentacion', 'factores_evaluacion', 'garantias', 'penalidades']);
    expect(Object.values(e).every(l => Array.isArray(l) && l.length === 0)).toBe(true);
  });
});

describe('verificarResultado — la aduana ahora cubre también lo de la mig 200', () => {
  it('una garantía inventada se marca y se avisa; la real pasa', () => {
    const md = '<!-- página 1 -->\nLa garantía de fiel cumplimiento equivale al diez por ciento (10%) del monto del convenio.';
    const r = verificarResultado({
      garantias: [
        { tipo: 'fiel_cumplimiento', porcentaje: 10, fuente_pagina: 1, fuente_cita: 'equivale al diez por ciento (10%) del monto del convenio' },
        { tipo: 'adelanto_directo', porcentaje: 30, fuente_pagina: 1, fuente_cita: 'adelanto directo del treinta por ciento' },
      ],
      penalidades: [], condiciones: [], factores_evaluacion: [], documentos_presentacion: [],
    }, md);
    expect(r.garantias[0].verificada).toBe(true);
    expect(r.garantias[1].verificada).toBe(false);
    expect(r.garantias).toHaveLength(2);           // no se borra: se marca
    expect(r.alertas.join(' ')).toMatch(/adelanto directo del treinta|garantía/i);
  });
});


// ═══════════════════════════════════════════════════════════════════
// LAS CINCO TRAMPAS DE PARSEO, medidas sobre el corpus real y no supuestas.
// Cada `it` de acá abajo es una variante que EXISTE en un documento oficial.
// ═══════════════════════════════════════════════════════════════════

describe('clave — el normalizador que ignora los espacios del kerning', () => {
  // Las cinco variantes con las que se validó el normalizador al 100%.
  it('acierta en las variantes reales del corpus', () => {
    const pares = [
      ['SOBRE N° 1: CREDENCIALES', 'SOBRE N°01: CREDENCIALES'],
      ['SOBRE N° 1: CREDENCIALES', 'SOBRE Nº 1: Credenciales'],
      ['ANEXO N° 4-B:', 'ANEXO N° 4- B:'],
      ['MODELO DE CARTA DE EXPRESIÓN DE INTERÉS', 'MODELO DE CA RTA DE EXPRESIÓN DE INTERES'],
      ['SOBRE N° 3: PROPUESTA TÉCNICA', 'SOBRE N°03: PROPUESTA TÉCNICA'],
      ['CONTENIDO DE LOS SOBRES', 'CONTENIDO DE LO S SOBRES'],
    ];
    for (const [rotulo, real] of pares) {
      expect(clave(real)).toContain(clave(rotulo));
    }
  });

  it('N° (grado) y Nº (ordinal) se ven igual y conviven en el mismo documento', () => {
    expect(clave('ANEXO N° 7')).toBe(clave('ANEXO Nº 7'));
  });

  it('los ceros a la izquierda no hacen un sobre distinto', () => {
    expect(clave('SOBRE N° 01')).toBe(clave('SOBRE N°1'));
    expect(clave('SOBRE N 03')).toBe(clave('SOBRE N° 3'));
  });

  it('las tildes que el original oficial no puso no rompen nada', () => {
    expect(clave('CAPITULO II')).toBe(clave('CAPÍTULO II'));
    expect(clave('OFERTA ECONOMICA')).toBe(clave('OFERTA ECONÓMICA'));
  });

  it('normalizar() NO alcanza para esto, y por eso clave() existe', () => {
    expect(normalizar('CONTENIDO DE LO S SOBRES')).not.toContain('CONTENIDO DE LOS SOBRES');
    expect(clave('CONTENIDO DE LO S SOBRES')).toContain(clave('CONTENIDO DE LOS SOBRES'));
  });
});

describe('el índice encuentra los rótulos partidos por el kerning', () => {
  const MD_KERNING = `<!-- página 30 -->
CONTENIDO DE LO S SOBRES A SER PRESENTADOS POR EL POSTOR

<!-- página 58 -->
CLÁUSULA OCTAVA: GARANTIAS
El Ejecutor entregará una carta fianza por el 4% del monto referencial.

<!-- página 62 -->
CLÁUSULA DÉCIMOTERCERA: PENALIDADES
Penalidad Diaria = 0.10 x monto / (0.15 x plazo)`;

  it('el rótulo con el espacio adentro cae igual', () => {
    const i = indiceDeSecciones(MD_KERNING);
    expect(i.presentacion.map(h => h.pagina)).toContain(30);
  });

  it('las garantías y las penalidades tienen su propia familia (viven al final)', () => {
    const i = indiceDeSecciones(MD_KERNING);
    expect(i.contrato.map(h => h.pagina)).toEqual(expect.arrayContaining([58, 62]));
  });

  it('la familia contrato existe con sus rótulos medidos', () => {
    expect(SECCIONES.contrato.claves).toContain('ADELANTO POR AVANCE');
    expect(SECCIONES.contrato.claves).toContain('CUADERNO DE INCIDENCIAS');
  });
});

describe('esRenglonDeIndice — el rótulo del índice no es la sección', () => {
  it('reconoce la línea de puntos con el número de página', () => {
    expect(esRenglonDeIndice('ANEXO C: REQUISITOS DE CALIFICACIÓN ............ 31')).toBe(true);
    expect(esRenglonDeIndice('CAPÍTULO IV     41')).toBe(true);
  });
  it('la sección de verdad no se marca', () => {
    expect(esRenglonDeIndice('REQUISITOS DE CALIFICACIÓN')).toBe(false);
  });
  it('el índice queda marcado en el hit, no borrado', () => {
    const i = indiceDeSecciones(`<!-- página 3 -->
REQUISITOS DE CALIFICACIÓN ................ 31

<!-- página 31 -->
REQUISITOS DE CALIFICACIÓN
Capacidad legal`);
    const hits = i.personal;
    expect(hits.find(h => h.pagina === 3)?.deIndice).toBe(true);
    expect(hits.find(h => h.pagina === 31)?.deIndice).toBeUndefined();
  });
});

describe('clasificarRegimen — los contadores medidos, no una impresión', () => {
  it('SOBRE N° 3 + CREDENCIALES es Obras por Impuestos, Empresa Privada', () => {
    const c = clasificarRegimen('SOBRE N° 1: CREDENCIALES ... SOBRE N°03: PROPUESTA TÉCNICA');
    expect(c.regimen).toBe('oxi_empresa');
    expect(c.confianza).toBe('alta');
    expect(c.senales.sobre3).toBe(1);
  });

  it('SOBRE N° 2 sin un tercero, con requisitos de calificación, es la supervisora', () => {
    const c = clasificarRegimen('SOBRE N° 2: PROPUESTA ECONÓMICA — REQUISITOS DE CALIFICACIÓN del postor');
    expect(c.regimen).toBe('oxi_supervisora');
  });

  it('cuantía + Pladicop es la Ley 32069, con confianza alta', () => {
    const c = clasificarRegimen('la CUANTÍA DE LA CONTRATACIÓN se publica en la Pladicop');
    expect(c.regimen).toBe('ley32069');
    expect(c.confianza).toBe('alta');
  });

  it('valor referencial + obras similares + póliza de caución es la Ley 30225', () => {
    const c = clasificarRegimen('el VALOR REFERENCIAL de OBRAS SIMILARES, con carta fianza o póliza de caución');
    expect(c.regimen).toBe('ley30225');
  });

  it('cuenta las apariciones, no solo si están', () => {
    const k = clave('MONTO REFERENCIAL uno, MONTO REFERENCIAL dos, MONTO REFERENCIAL tres');
    expect(contarClave(k, 'MONTO REFERENCIAL')).toBe(3);
  });

  it('valor referencial y cuantía son excluyentes: si están los dos, se avisa', () => {
    const c = clasificarRegimen('el VALOR REFERENCIAL … la CUANTÍA DE LA CONTRATACIÓN');
    expect(c.conflicto).toBeTruthy();
    expect(c.conflicto).toContain('excluyentes');
  });

  it('un documento que no es unas bases no se fuerza a ningún régimen', () => {
    expect(clasificarRegimen('lista de precios de abarrotes').regimen).toBeNull();
  });
});

describe('[CONSIGNAR …] — el campo que la ENTIDAD dejó sin llenar', () => {
  const MD_PLANTILLA = `<!-- página 4 -->
El valor referencial asciende a [CONSIGNAR EL MONTO] soles, IGV incluido.
La presentación de ofertas será el [INDICAR LA FECHA].`;

  it('una cita que es el marcador NO se da por buena, aunque esté literal', () => {
    const v = verificarCita(MD_PLANTILLA, 'El valor referencial asciende a [CONSIGNAR EL MONTO] soles');
    expect(v.verificada).toBe(false);
    expect(v.motivo).toContain('SIN LLENAR');
  });

  it('los marcadores se listan para avisarle a la persona', () => {
    const c = camposSinLlenar(MD_PLANTILLA);
    expect(c).toHaveLength(2);
    expect(c[0]).toContain('CONSIGNAR EL MONTO');
  });

  it('una cita normal sigue pasando', () => {
    expect(citaEsPlantilla('Experiencia no menor de 03 años')).toBe(false);
  });

  it('el dato sacado de un marcador va a revisión con su motivo', () => {
    const r = verificarResultado({
      proceso: {},
      requisitos_empresa: [{
        tipo: 'experiencia_postor', descripcion: 'monto facturado',
        fuente_pagina: 4, fuente_cita: 'El valor referencial asciende a [CONSIGNAR EL MONTO] soles',
      }],
    }, MD_PLANTILLA);
    expect(r.requisitos_empresa[0].verificada).toBe(false);
    expect(r.alertas.join(' ')).toContain('SIN LLENAR');
  });
});

describe('la cita que el modelo copió arreglando el kerning', () => {
  const MD = `<!-- página 30 -->
CONTENIDO DE LO S SOBRES A SER PRESENTADOS POR EL POSTOR, bajo sanción de nulidad`;

  it('se acepta, y se dice por qué (antes era un ⚠ falso sobre un dato bueno)', () => {
    const v = verificarCita(MD, 'CONTENIDO DE LOS SOBRES A SER PRESENTADOS POR EL POSTOR');
    expect(v.verificada).toBe(true);
    expect(v.motivo).toContain('kerning');
    expect(v.paginaReal).toBe(30);
  });

  it('una cita de verdad inventada sigue sin pasar', () => {
    const v = verificarCita(MD, 'el postor deberá acreditar un patrimonio neto de S/ 5,000,000');
    expect(v.verificada).toBe(false);
    expect(v.motivo).toContain('no aparece');
  });
});


// ═══════════════════════════════════════════════════════════════════
// LO QUE SE ROMPIÓ EN LA PRUEBA REAL DEL 9-set-2026: unas bases integradas de
// 94 páginas escaneadas devolvieron CERO requisitos y un solo «hallazgo», que
// era la propia pista del sistema devuelta como dato.
// ═══════════════════════════════════════════════════════════════════

describe('el índice de contenidos ya no se come el presupuesto', () => {
  // Reproduce la forma del documento que falló: la tabla de contenidos junta
  // TODOS los rótulos en las tres primeras páginas, y las secciones de verdad
  // están noventa páginas después.
  const tabla = ['REQUISITOS DE CALIFICACION', 'PERSONAL CLAVE', 'EXPERIENCIA DEL PERSONAL',
    'PLANTEL PROFESIONAL', 'RESIDENTE DE OBRA', 'SUPERVISOR DE OBRA', 'INGENIERO RESIDENTE',
    'ESPECIALISTA EN', 'CALIFICACIONES DEL PLANTEL', 'JEFE DE SUPERVISION',
    'CAPACIDAD TECNICA Y PROFESIONAL', 'PERSONAL PROPUESTO', 'CALIFICACIONES DEL PERSONAL CLAVE',
    'EXPERIENCIA DEL PERSONAL CLAVE', 'PLANTEL PROFESIONAL CLAVE'];
  const MD_GRANDE = [
    ...tabla.map((t, i) => `<!-- página ${1 + (i % 3)} -->\n${t} ........... ${40 + i}`),
    ...Array.from({ length: 88 }, (_, i) => `<!-- página ${5 + i} -->\nrelleno del escaneo ${i}`),
    '<!-- página 93 -->\nPERSONAL CLAVE\nResidente de Obra: Ingeniero Civil con 36 meses.',
  ].join('\n\n');

  it('llega a la sección de verdad de la página 93, no solo a la tabla', () => {
    const paginas = indiceDeSecciones(MD_GRANDE).personal.map(h => h.pagina);
    expect(paginas).toContain(93);
  });

  it('y por eso rangosDeFamilia propone esa zona', () => {
    const i = indiceDeSecciones(MD_GRANDE);
    const rangos = rangosDeFamilia(null, resumenIndice(i), 'personal');
    expect(rangos.some(r => r.desde <= 93 && r.hasta >= 93)).toBe(true);
  });

  // La garantía de verdad: cuando el cupo NO alcanza para todos, los renglones
  // de la tabla de contenidos son los que ceden. Antes era al revés, porque el
  // recorte se hacía en orden de documento y la tabla va al principio.
  it('cuando el cupo aprieta, la tabla de contenidos cede y las secciones quedan', () => {
    const delIndice = Array.from({ length: 30 }, (_, i) => (
      { pagina: 1 + (i % 3), clave: 'PERSONAL CLAVE', linea: `PERSONAL CLAVE ..... ${i}`, deIndice: true }));
    const reales = Array.from({ length: 6 }, (_, i) => (
      { pagina: 40 + i * 9, clave: 'PERSONAL CLAVE', linea: 'PERSONAL CLAVE' }));
    const elegidos = elegirAciertos([...delIndice, ...reales], 12);

    // Las seis secciones de verdad entran TODAS.
    expect(elegidos.filter(h => !h.deIndice)).toHaveLength(6);
    // Y de la tabla entra a lo sumo un cuarto del cupo, aunque sobre lugar: el
    // cupo NO se rellena con renglones del índice de contenidos, que es
    // exactamente lo que lo había arruinado.
    expect(elegidos.filter(h => h.deIndice).length).toBeLessThanOrEqual(3);
    expect(elegidos.length).toBeLessThanOrEqual(12);
    // Devueltos en orden de documento, que es como los lee el Pase 1.
    const paginas = elegidos.map(h => h.pagina);
    expect([...paginas].sort((a, b) => a - b)).toEqual(paginas);
  });
});

describe('el régimen no se decide por una señal AUSENTE', () => {
  // El documento real: «Contratación de la Empresa Privada para la IOARR
  // CONSTRUCCION DE FARMACIA». El OCR degradado se comió los «SOBRE N° 3» y la
  // regla vieja («sin sobre 3 es la supervisora») lo mandó a supervisora con
  // confianza ALTA — y con eso se le dijo al modelo 10% y dos sobres.
  const REAL = `Contratación de la EMPRESA PRIVADA para la IOARR CONSTRUCCION DE FARMACIA
    LEY N° 29230 — OBRAS POR IMPUESTOS. CONVENIO DE INVERSION.
    La EMPRESA PRIVADA presentará su propuesta ante el COMITE ESPECIAL.
    MONTO REFERENCIAL del convenio. La EMPRESA PRIVADA seleccionada suscribirá.`;

  it('unas bases de EMPRESA PRIVADA no salen como supervisora', () => {
    expect(clasificarRegimen(REAL).regimen).toBe('oxi_empresa');
  });

  it('cuando no se sabe cuál de las dos es, la confianza es BAJA (y la pista no viaja)', () => {
    const c = clasificarRegimen('LEY N° 29230 · CONVENIO DE INVERSION · COMITE ESPECIAL');
    expect(c.confianza).toBe('baja');
  });

  it('la supervisora sigue reconociéndose cuando el documento lo dice', () => {
    const c = clasificarRegimen(`LEY N° 29230 CONVENIO DE INVERSION.
      La ENTIDAD PRIVADA SUPERVISORA presentará. La ENTIDAD PRIVADA SUPERVISORA será evaluada.
      La ENTIDAD PRIVADA SUPERVISORA suscribe el contrato de supervisión.`);
    expect(c.regimen).toBe('oxi_supervisora');
    expect(c.confianza).toBe('alta');
  });
});

describe('agruparRequisitos — por categoría y prioridad', () => {
  const grupos = agruparRequisitos({
    filas: [
      { cargo: 'Especialista en Estructuras', clase: 'personal' },
      { cargo: 'Residente de Obra', clase: 'personal' },
      { cargo: 'Topógrafo', clase: 'personal' },
    ],
    filasEmpresa: [
      { cargo: 'Experiencia del postor', tipo: 'experiencia_postor' },
      { cargo: 'RNP vigente', tipo: 'rnp' },
    ],
  });

  it('lo que impide presentarse va primero de todo', () => {
    expect(grupos[0].clave).toBe('habilitantes');
    expect(grupos[0].items[0].f.cargo).toBe('RNP vigente');
  });

  it('la gente va después de los papeles, y quien conduce antes que el apoyo', () => {
    expect(grupos.map(g => g.clave)).toEqual(
      ['habilitantes', 'acreditables', 'jefatura', 'especialistas', 'apoyo']);
    expect(grupos[2].items[0].f.cargo).toBe('Residente de Obra');
    expect(grupos[4].items[0].f.cargo).toBe('Topógrafo');
  });

  it('cada item se lleva su índice original: marcar no puede guardar otro', () => {
    const residente = grupos[2].items[0];
    expect(residente.i).toBe(1);            // era el segundo de `filas`
  });

  it('un grupo vacío no se muestra', () => {
    const g = agruparRequisitos({ filas: [{ cargo: 'Residente de Obra' }], filasEmpresa: [] });
    expect(g.map(x => x.clave)).toEqual(['jefatura']);
  });
});

describe('anexoSePresenta — solo los que se llenan y se meten en un sobre', () => {
  it('los formularios sí', () => {
    expect(anexoSePresenta('ANEXO N° 1: DECLARACIÓN JURADA DE DATOS DEL POSTOR')).toBe(true);
    expect(anexoSePresenta('FORMATO N° 6: PROMESA FORMAL DE CONSORCIO')).toBe(true);
    expect(anexoSePresenta('ANEXO N° 4- B: MODELO DE CARTA DE EXPRESIÓN DE INTERES')).toBe(true);
  });

  it('lo que se LEE, no', () => {
    expect(anexoSePresenta('ANEXO C: TERMINOS DE REFERENCIA')).toBe(false);
    expect(anexoSePresenta('ANEXO D: PROYECTO DE CONVENIO DE INVERSIÓN')).toBe(false);
    expect(anexoSePresenta('ANEXO B: CRONOGRAMA DEL PROCESO')).toBe(false);
    expect(anexoSePresenta('CAPITULO III')).toBe(false);
  });

  it('si las bases lo nombran entre los documentos a presentar, manda eso', () => {
    expect(anexoSePresenta('ANEXO N° 9: CARTA DE ACREDITACION', null)).toBe(true);
    // Un título que por su forma no calificaría, pero que la lista nombra.
    expect(anexoSePresenta('ANEXO N° 12: ESTUDIO DE MERCADO',
      ['Anexo N° 12 - Estudio de mercado del postor'])).toBe(true);
  });

  it('separarAnexos parte la lista en dos sin perder ninguno', () => {
    const partes = [
      { n: 1, titulo: 'ANEXO N° 1: DECLARACIÓN JURADA' },
      { n: 2, titulo: 'ANEXO C: TERMINOS DE REFERENCIA' },
    ];
    const { sePresentan, soloLectura } = separarAnexos(partes);
    expect(sePresentan).toHaveLength(1);
    expect(soloLectura).toHaveLength(1);
  });
});
