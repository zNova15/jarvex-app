import { describe, it, expect } from 'vitest';
import {
  ETAPAS, ETAPA_LBL, ETAPA_BADGE, esCerrada, TIPOS_PROCESO, destinoAlGanar,
  requisitoDeFila, requisitosDePersonal, veredictoPlantel, resumenVeredicto,
  diasPara, urgencia, prefillObraDesde, puedePasarATrabajos,
} from '../licitaciones.js';
import { buscarPlantel } from '../experiencia-profesional.js';

const HOY = '2026-09-08';

// ── Fixtures: el caso que motivó el módulo ────────────────────────
// Las bases piden un Residente (Ing. Civil, 60 meses en saneamiento) y un
// Especialista en Suelos (Ing. Civil, 24 meses, cualquier rubro).
const RUBRO_SAN = 'rubro-saneamiento';

const fila = (o = {}) => ({
  id: 'r1', licitacion_id: 'L1', clase: 'personal', orden: 10,
  cargo: 'Residente de Obra', profesion: 'Ingeniero Civil',
  meses_minimos: 60, rubro_id: RUBRO_SAN,
  exige_colegiatura: true, exige_sustento: true,
  candidato_personal_id: null, fuente: 'manual', ...o,
});

// Candidato con experiencia sustentada suficiente y colegiatura vigente.
const cand = (id, nombre, meses, o = {}) => ({
  persona: { id, nombres: nombre, apellidos: '' },
  ficha: {
    profesion: o.profesion ?? 'Ingeniero Civil',
    colegiatura_numero: 'CIP 12345',
    colegiatura_habil_hasta: o.habilHasta ?? '2027-12-31',
    cv_evidencia_id: 'ev1',
  },
  experiencias: [{
    id: `e-${id}`, personal_id: id, rubro_id: o.rubro ?? RUBRO_SAN,
    fecha_inicio: '2015-01-01',
    // meses × 30 días desde el inicio
    fecha_fin: new Date(Date.UTC(2015, 0, 1) + meses * 30 * 86400000)
      .toISOString().slice(0, 10),
    evidencia_id: o.sinConstancia ? null : 'const1',
  }],
});

describe('etapas', () => {
  it('los labels y badges cubren todas las etapas del CHECK (mig 197)', () => {
    const delCheck = ['identificado', 'requisitos', 'preparacion', 'presentado',
      'evaluacion', 'buena_pro', 'no_ganado', 'desistido'];
    expect(ETAPAS.map(e => e.v)).toEqual(delCheck);
    for (const v of delCheck) {
      expect(ETAPA_LBL[v]).toBeTruthy();
      expect(ETAPA_BADGE[v]).toBeTruthy();
    }
  });

  it('cerradas: ganado, no ganado y desistido', () => {
    expect(esCerrada('buena_pro')).toBe(true);
    expect(esCerrada('no_ganado')).toBe(true);
    expect(esCerrada('desistido')).toBe(true);
    expect(esCerrada('preparacion')).toBe(false);
  });
});

describe('tipos de proceso', () => {
  it('incluye la taxonomía de obras más bienes y servicios', () => {
    const vs = TIPOS_PROCESO.map(t => t.v);
    expect(vs).toContain('obra_ejecucion');
    expect(vs).toContain('supervision_expediente');
    expect(vs).toContain('bienes_servicios');
  });

  it('bienes y servicios se gana como trabajo, no como obra', () => {
    expect(destinoAlGanar('bienes_servicios')).toBe('trabajo');
    expect(destinoAlGanar('obra_ejecucion')).toBe('obra');
    expect(destinoAlGanar('supervision')).toBe('obra');
  });
});

describe('requisitoDeFila', () => {
  it('traduce snake_case de la base al objeto de evaluarRequisito', () => {
    const r = requisitoDeFila(fila());
    expect(r).toMatchObject({
      cargo: 'Residente de Obra', profesion: 'Ingeniero Civil',
      mesesMinimos: 60, rubroId: RUBRO_SAN,
      exigeColegiatura: true, exigeSustento: true,
    });
  });

  it('los booleanos por defecto son EXIGIR: una fila a medias no relaja el requisito', () => {
    const r = requisitoDeFila({ cargo: 'X' });
    expect(r.exigeColegiatura).toBe(true);
    expect(r.exigeSustento).toBe(true);
    expect(r.mesesMinimos).toBe(0);
  });

  it('respeta el false explícito', () => {
    const r = requisitoDeFila(fila({ exige_sustento: false, exige_colegiatura: false }));
    expect(r.exigeSustento).toBe(false);
    expect(r.exigeColegiatura).toBe(false);
  });

  it('arrastra id y candidato elegido, que evaluarRequisito ignora', () => {
    const r = requisitoDeFila(fila({ candidato_personal_id: 'p1' }));
    expect(r.id).toBe('r1');
    expect(r.candidatoPersonalId).toBe('p1');
  });
});

describe('requisitosDePersonal', () => {
  it('filtra por postulación, descarta borrados y los de empresa, y ordena', () => {
    const filas = [
      fila({ id: 'b', orden: 20, cargo: 'Especialista' }),
      fila({ id: 'a', orden: 10 }),
      fila({ id: 'x', orden: 5, deleted_at: '2026-01-01' }),
      fila({ id: 'y', orden: 1, clase: 'empresa' }),
      fila({ id: 'z', orden: 1, licitacion_id: 'OTRA' }),
    ];
    const rs = requisitosDePersonal(filas, 'L1');
    expect(rs.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('sin licitacionId devuelve todas las de personal', () => {
    expect(requisitosDePersonal([fila(), fila({ id: 'r2', licitacion_id: 'L2' })]).length).toBe(2);
  });
});

describe('veredictoPlantel — la pregunta "¿calificamos?"', () => {
  const requisitos = [requisitoDeFila(fila())];

  it('califica cuando hay al menos un candidato que cumple', () => {
    const v = veredictoPlantel(buscarPlantel([cand('p1', 'Ana', 70)], requisitos, { hoy: HOY }));
    expect(v.total).toBe(1);
    expect(v.cubiertos).toBe(1);
    expect(v.califica).toBe(true);
    expect(v.limpio).toBe(true);
  });

  it('NO califica si a todos les falta experiencia, y señala al que menos le falta', () => {
    const v = veredictoPlantel(buscarPlantel(
      [cand('p1', 'Ana', 30), cand('p2', 'Beto', 55)], requisitos, { hoy: HOY }));
    expect(v.califica).toBe(false);
    expect(v.sinNadie).toBe(1);
    // Beto está más cerca: buscarPlantel ya lo ordenó primero entre los que aplican.
    expect(v.puestos[0].masCerca.persona.id).toBe('p2');
  });

  it('el que tiene otra profesión NO cuenta como "más cerca" aunque le sobren meses', () => {
    const v = veredictoPlantel(buscarPlantel(
      [cand('p1', 'Ana', 200, { profesion: 'Arquitecto' })], requisitos, { hoy: HOY }));
    expect(v.califica).toBe(false);
    expect(v.puestos[0].masCerca).toBeNull();
  });

  it('SIN REQUISITOS NO CALIFICA: no saber no es estar bien', () => {
    const v = veredictoPlantel([]);
    expect(v.total).toBe(0);
    expect(v.califica).toBe(false);
    expect(v.limpio).toBe(false);
  });

  it('un elegido que NO cumple rompe "limpio" aunque el puesto esté cubierto por otro', () => {
    // Ana cumple (70 meses); Beto está elegido pero solo tiene 30.
    const req = [requisitoDeFila(fila({ candidato_personal_id: 'p2' }))];
    const v = veredictoPlantel(buscarPlantel(
      [cand('p1', 'Ana', 70), cand('p2', 'Beto', 30)], req, { hoy: HOY }));
    expect(v.califica).toBe(true);          // hay quién presentar
    expect(v.limpio).toBe(false);           // pero el nombre escrito está en falta
    expect(v.elegidosEnFalta).toBe(1);
    expect(v.puestos[0].elegido.persona.id).toBe('p2');
    expect(v.puestos[0].elegidoEnFalta).toBe(true);
  });

  it('un elegido que cumple deja el veredicto limpio', () => {
    const req = [requisitoDeFila(fila({ candidato_personal_id: 'p1' }))];
    const v = veredictoPlantel(buscarPlantel([cand('p1', 'Ana', 70)], req, { hoy: HOY }));
    expect(v.limpio).toBe(true);
    expect(v.elegidosEnFalta).toBe(0);
  });

  it('la colegiatura vencida deja el puesto descubierto', () => {
    const v = veredictoPlantel(buscarPlantel(
      [cand('p1', 'Ana', 70, { habilHasta: '2026-01-01' })], requisitos, { hoy: HOY }));
    expect(v.califica).toBe(false);
  });

  it('la experiencia sin constancia no cubre un requisito que exige sustento', () => {
    const v = veredictoPlantel(buscarPlantel(
      [cand('p1', 'Ana', 70, { sinConstancia: true })], requisitos, { hoy: HOY }));
    expect(v.califica).toBe(false);
    // Y con el requisito relajado, sí.
    const relajado = [requisitoDeFila(fila({ exige_sustento: false }))];
    const v2 = veredictoPlantel(buscarPlantel(
      [cand('p1', 'Ana', 70, { sinConstancia: true })], relajado, { hoy: HOY }));
    expect(v2.califica).toBe(true);
  });

  it('dos puestos: uno cubierto y otro no → no califica', () => {
    const reqs = [
      requisitoDeFila(fila({ id: 'r1', cargo: 'Residente', meses_minimos: 60 })),
      requisitoDeFila(fila({ id: 'r2', cargo: 'Especialista', meses_minimos: 200 })),
    ];
    const v = veredictoPlantel(buscarPlantel([cand('p1', 'Ana', 70)], reqs, { hoy: HOY }));
    expect(v.total).toBe(2);
    expect(v.cubiertos).toBe(1);
    expect(v.sinNadie).toBe(1);
    expect(v.califica).toBe(false);
  });

  it('tolera entrada vacía o basura', () => {
    expect(veredictoPlantel(null).total).toBe(0);
    expect(veredictoPlantel([{}]).puestos[0].cubierto).toBe(false);
  });
});

describe('resumenVeredicto', () => {
  it('dice qué falta en una línea', () => {
    expect(resumenVeredicto(null)).toBe('Sin requisitos cargados');
    expect(resumenVeredicto({ total: 0 })).toBe('Sin requisitos cargados');
    expect(resumenVeredicto({ total: 3, cubiertos: 1, sinNadie: 2, califica: false }))
      .toBe('Faltan 2 de 3 puestos');
    expect(resumenVeredicto({ total: 2, cubiertos: 2, sinNadie: 0, califica: true, limpio: false, elegidosEnFalta: 1 }))
      .toBe('Califica, pero 1 elegido(s) en falta');
    expect(resumenVeredicto({ total: 2, cubiertos: 2, sinNadie: 0, califica: true, limpio: true }))
      .toBe('Califica: 2 de 2 puestos');
  });
});

describe('diasPara / urgencia', () => {
  it('cuenta los días calendario', () => {
    expect(diasPara('2026-09-15', HOY)).toBe(7);
    expect(diasPara('2026-09-08', HOY)).toBe(0);
    expect(diasPara('2026-09-01', HOY)).toBe(-7);
    expect(diasPara('', HOY)).toBeNull();
    expect(diasPara('no-fecha', HOY)).toBeNull();
  });

  it('una postulación cerrada no tiene urgencia (marcar en rojo lo ya ganado es ruido)', () => {
    for (const etapa of ['buena_pro', 'no_ganado', 'desistido']) {
      expect(urgencia({ etapa, fecha_presentacion: '2026-01-01' }, HOY).nivel).toBe('ninguna');
    }
  });

  it('escala según los días que faltan', () => {
    const e = 'preparacion';
    expect(urgencia({ etapa: e, fecha_presentacion: '2026-09-01' }, HOY).nivel).toBe('vencida');
    expect(urgencia({ etapa: e, fecha_presentacion: '2026-09-08' }, HOY).nivel).toBe('hoy');
    expect(urgencia({ etapa: e, fecha_presentacion: '2026-09-12' }, HOY).nivel).toBe('alta');
    expect(urgencia({ etapa: e, fecha_presentacion: '2026-10-30' }, HOY).nivel).toBe('normal');
    expect(urgencia({ etapa: e }, HOY).nivel).toBe('sin_fecha');
  });
});

describe('prefillObraDesde', () => {
  const lic = {
    objeto: 'Mejoramiento del servicio de agua potable — Chilete',
    tipo_trabajo: 'obra_ejecucion', origen: 'publico', rubro_id: RUBRO_SAN,
    entidad_convocante: 'Municipalidad Distrital de Chilete',
    valor_referencial: 4250000.5, postulante_company_id: 'co-jarvex',
  };

  it('usa los nombres de columna reales de `obras`', () => {
    const d = prefillObraDesde(lic);
    expect(d.nombre_obra).toBe(lic.objeto);
    expect(d.cliente).toBe('Municipalidad Distrital de Chilete');
    expect(d.presupuesto_total).toBe(4250000.5);
    expect(d.ejecutora_company_id).toBe('co-jarvex');
    expect(d.estado).toBe('planificacion');
    expect(d).not.toHaveProperty('nombre');
    expect(d).not.toHaveProperty('company_id');
  });

  it('NO decide empresa vs consorcio: errarlo desarma la contabilidad de la obra', () => {
    expect(prefillObraDesde(lic)).not.toHaveProperty('ejecutora_tipo');
  });

  it('bienes y servicios no es un tipo_trabajo de obra: cae al default', () => {
    expect(prefillObraDesde({ ...lic, tipo_trabajo: 'bienes_servicios' }).tipo_trabajo)
      .toBe('obra_ejecucion');
  });

  it('no revienta con una postulación vacía', () => {
    expect(prefillObraDesde(null).estado).toBe('planificacion');
  });
});

describe('puedePasarATrabajos', () => {
  it('solo con buena pro y una sola vez', () => {
    expect(puedePasarATrabajos({ etapa: 'buena_pro' })).toBe(true);
    expect(puedePasarATrabajos({ etapa: 'presentado' })).toBe(false);
    expect(puedePasarATrabajos({ etapa: 'buena_pro', obra_id: 'o1' })).toBe(false);
    expect(puedePasarATrabajos({ etapa: 'buena_pro', trabajo_id: 't1' })).toBe(false);
    expect(puedePasarATrabajos({ etapa: 'buena_pro', deleted_at: '2026-01-01' })).toBe(false);
    expect(puedePasarATrabajos(null)).toBe(false);
  });
});
