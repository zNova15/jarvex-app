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
