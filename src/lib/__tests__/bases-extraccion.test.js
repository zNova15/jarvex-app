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
} from '../bases-extraccion.js';
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
