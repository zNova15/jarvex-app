import { describe, it, expect } from 'vitest';
import {
  periodoDe, fusionarPeriodos, totalizarExperiencia, experienciaPorRubro,
  estadoColegiatura, profesionCoincide, evaluarRequisito, buscarPlantel,
  formatearMeses, diasAMeses,
} from '../experiencia-profesional.js';

const HOY = '2026-09-01';
const exp = (o) => ({ fecha_inicio: '2020-01-01', fecha_fin: '2020-12-31', ...o });

describe('fusionarPeriodos — la regla que evita inflar la experiencia', () => {
  it('dos obras SIMULTÁNEAS son un año, no dos', () => {
    // El error clásico al sumar constancias por separado.
    const exps = [
      exp({ fecha_inicio: '2020-01-01', fecha_fin: '2020-12-31', evidencia_id: 'e1' }),
      exp({ fecha_inicio: '2020-01-01', fecha_fin: '2020-12-31', evidencia_id: 'e2' }),
    ];
    const t = totalizarExperiencia(exps, { hoy: HOY });
    expect(t.dias).toBe(366);              // 2020 fue bisiesto
    expect(t.meses).toBe(diasAMeses(366)); // ~12.2 meses, NO 24
  });

  it('periodos solapados PARCIALMENTE cuentan la unión', () => {
    const exps = [
      exp({ fecha_inicio: '2020-01-01', fecha_fin: '2020-06-30' }),
      exp({ fecha_inicio: '2020-04-01', fecha_fin: '2020-09-30' }),
    ];
    // Ene→Sep = 274 días, no 182+183.
    expect(totalizarExperiencia(exps, { hoy: HOY }).dias).toBe(274);
  });

  it('periodos CONTIGUOS se unen (termina el 31 y arranca el 1)', () => {
    const ps = fusionarPeriodos([
      periodoDe({ fecha_inicio: '2020-01-01', fecha_fin: '2020-01-31' }, HOY),
      periodoDe({ fecha_inicio: '2020-02-01', fecha_fin: '2020-02-29' }, HOY),
    ]);
    expect(ps.length).toBe(1);
  });

  it('periodos SEPARADOS se suman por separado', () => {
    const exps = [
      exp({ fecha_inicio: '2020-01-01', fecha_fin: '2020-01-31' }),   // 31
      exp({ fecha_inicio: '2021-01-01', fecha_fin: '2021-01-31' }),   // 31
    ];
    expect(totalizarExperiencia(exps, { hoy: HOY }).dias).toBe(62);
  });

  it('sin fecha de fin = sigue en curso, se cierra HOY', () => {
    const t = totalizarExperiencia([exp({ fecha_inicio: '2026-08-01', fecha_fin: null })], { hoy: HOY });
    expect(t.dias).toBe(32);   // 1-ago a 1-sep inclusive
  });

  it('ignora experiencias borradas, sin fecha de inicio o con rango imposible', () => {
    const exps = [
      exp({ deleted_at: '2026-01-01' }),
      exp({ fecha_inicio: null }),
      exp({ fecha_inicio: '2020-12-31', fecha_fin: '2020-01-01' }),   // fin antes que inicio
    ];
    expect(totalizarExperiencia(exps, { hoy: HOY }).dias).toBe(0);
  });
});

describe('experiencia SUSTENTADA — solo lo que tiene constancia', () => {
  const exps = [
    exp({ fecha_inicio: '2020-01-01', fecha_fin: '2020-12-31', evidencia_id: 'c1' }),
    exp({ fecha_inicio: '2021-01-01', fecha_fin: '2021-12-31' }),   // sin constancia
  ];
  it('separa el total del sustentado', () => {
    const t = totalizarExperiencia(exps, { hoy: HOY });
    expect(t.dias).toBe(731);
    expect(t.diasSustentados).toBe(366);
    expect(t.conSustento).toBe(1);
    expect(t.sinSustento).toBe(1);
  });
});

describe('experienciaPorRubro', () => {
  it('fusiona DENTRO de cada rubro y los separa entre sí', () => {
    const exps = [
      exp({ rubro_id: 'san', fecha_inicio: '2020-01-01', fecha_fin: '2020-12-31' }),
      exp({ rubro_id: 'san', fecha_inicio: '2020-06-01', fecha_fin: '2021-05-31' }), // solapa
      exp({ rubro_id: 'vial', fecha_inicio: '2022-01-01', fecha_fin: '2022-12-31' }),
    ];
    const m = experienciaPorRubro(exps, { hoy: HOY });
    expect(m.get('san').dias).toBe(517);   // ene-2020 → may-2021 sin doble contar
    expect(m.get('vial').dias).toBe(365);
    expect(m.get('san').n).toBe(2);
  });
  it('las experiencias sin rubro caen en su propio grupo', () => {
    expect(experienciaPorRubro([exp({ rubro_id: null })], { hoy: HOY }).has('__sin_rubro')).toBe(true);
  });
});

describe('estadoColegiatura', () => {
  it('distingue vigente / por vencer / vencida / sin dato', () => {
    expect(estadoColegiatura({ colegiatura_habil_hasta: '2027-01-01' }, HOY).estado).toBe('vigente');
    expect(estadoColegiatura({ colegiatura_habil_hasta: '2026-09-15' }, HOY).estado).toBe('por_vencer');
    expect(estadoColegiatura({ colegiatura_habil_hasta: '2026-08-31' }, HOY).estado).toBe('vencida');
    expect(estadoColegiatura({}, HOY).estado).toBe('sin_dato');
  });
});

describe('profesionCoincide — tolerante a cómo se escriba', () => {
  it('acepta abreviaturas y mayúsculas', () => {
    expect(profesionCoincide('Ing. Civil', 'Ingeniero Civil')).toBe(true);
    expect(profesionCoincide('INGENIERO CIVIL', 'ingeniero civil')).toBe(true);
    expect(profesionCoincide('Ingeniero Civil y Ambiental', 'Ingeniero Civil')).toBe(true);
  });
  it('rechaza otra profesión', () => {
    expect(profesionCoincide('Arquitecto', 'Ingeniero Civil')).toBe(false);
    expect(profesionCoincide('', 'Ingeniero Civil')).toBe(false);
  });
  it('sin profesión requerida, cualquiera pasa', () => {
    expect(profesionCoincide('Arquitecto', '')).toBe(true);
  });
});

describe('evaluarRequisito', () => {
  const persona = { id: 'p1', nombres: 'Juan', apellidos: 'Pérez' };
  const fichaOk = {
    profesion: 'Ingeniero Civil', colegiatura_numero: '12345',
    colegiatura_habil_hasta: '2027-06-30', cv_evidencia_id: 'cv1',
  };
  // 6 años de saneamiento, todos con constancia.
  const expsOk = [exp({ rubro_id: 'san', fecha_inicio: '2019-01-01', fecha_fin: '2024-12-31', evidencia_id: 'c1' })];
  const req = { cargo: 'Residente', profesion: 'Ingeniero Civil', mesesMinimos: 60, rubroId: 'san' };

  it('cumple cuando tiene profesión, colegiatura y meses sustentados', () => {
    const r = evaluarRequisito({ persona, ficha: fichaOk, experiencias: expsOk }, req, { hoy: HOY });
    expect(r.cumple).toBe(true);
    expect(r.bloqueos).toEqual([]);
    expect(r.mesesSustentados).toBeGreaterThan(60);
  });

  it('la colegiatura VENCIDA bloquea aunque le sobre experiencia', () => {
    const r = evaluarRequisito(
      { persona, ficha: { ...fichaOk, colegiatura_habil_hasta: '2026-01-01' }, experiencias: expsOk },
      req, { hoy: HOY });
    expect(r.cumple).toBe(false);
    expect(r.bloqueos.join(' ')).toMatch(/vencida/i);
  });

  it('la experiencia SIN constancia no alcanza, y el mensaje lo explica', () => {
    const sinSustento = [exp({ rubro_id: 'san', fecha_inicio: '2019-01-01', fecha_fin: '2024-12-31' })];
    const r = evaluarRequisito({ persona, ficha: fichaOk, experiencias: sinSustento }, req, { hoy: HOY });
    expect(r.cumple).toBe(false);
    expect(r.bloqueos.join(' ')).toMatch(/con constancia/);
    expect(r.meses).toBeGreaterThan(60);        // la tiene…
    expect(r.mesesSustentados).toBe(0);         // …pero no la puede probar
  });

  it('con exigeSustento:false se mide por la experiencia declarada', () => {
    const sinSustento = [exp({ rubro_id: 'san', fecha_inicio: '2019-01-01', fecha_fin: '2024-12-31' })];
    const r = evaluarRequisito({ persona, ficha: fichaOk, experiencias: sinSustento },
      { ...req, exigeSustento: false }, { hoy: HOY });
    expect(r.cumple).toBe(true);
    expect(r.avisos.join(' ')).toMatch(/sin constancia/);
  });

  it('la experiencia de OTRO rubro no cuenta para el requisito', () => {
    const otroRubro = [exp({ rubro_id: 'vial', fecha_inicio: '2019-01-01', fecha_fin: '2024-12-31', evidencia_id: 'c1' })];
    const r = evaluarRequisito({ persona, ficha: fichaOk, experiencias: otroRubro }, req, { hoy: HOY });
    expect(r.cumple).toBe(false);
    expect(r.mesesFaltantes).toBe(60);
  });

  it('la profesión equivocada bloquea', () => {
    const r = evaluarRequisito({ persona, ficha: { ...fichaOk, profesion: 'Arquitecto' }, experiencias: expsOk }, req, { hoy: HOY });
    expect(r.bloqueos.join(' ')).toMatch(/Arquitecto/);
  });

  it('el CV faltante avisa pero NO bloquea', () => {
    const r = evaluarRequisito({ persona, ficha: { ...fichaOk, cv_evidencia_id: null }, experiencias: expsOk }, req, { hoy: HOY });
    expect(r.cumple).toBe(true);
    expect(r.avisos).toContain('Sin CV adjunto');
  });
});

describe('buscarPlantel', () => {
  const mk = (id, profesion, ini, fin, evid) => ({
    persona: { id, nombres: id, apellidos: '' },
    ficha: { profesion, colegiatura_numero: '1', colegiatura_habil_hasta: '2027-01-01', cv_evidencia_id: 'cv' },
    experiencias: [exp({ rubro_id: 'san', fecha_inicio: ini, fecha_fin: fin, evidencia_id: evid })],
  });
  const candidatos = [
    mk('poco',   'Ingeniero Civil', '2024-01-01', '2024-12-31', 'c'),   // ~12 meses
    mk('mucho',  'Ingeniero Civil', '2016-01-01', '2024-12-31', 'c'),   // ~108 meses
    mk('justo',  'Ingeniero Civil', '2019-01-01', '2024-12-31', 'c'),   // ~72 meses
    mk('arqui',  'Arquitecto',      '2010-01-01', '2024-12-31', 'c'),   // no aplica
  ];
  const req = { cargo: 'Residente', profesion: 'Ingeniero Civil', mesesMinimos: 60, rubroId: 'san' };

  it('ordena: los que cumplen primero (más experiencia arriba), luego los más cerca', () => {
    const [res] = buscarPlantel(candidatos, [req], { hoy: HOY });
    expect(res.nCumplen).toBe(2);
    expect(res.candidatos.slice(0, 2).map(c => c.persona.id)).toEqual(['mucho', 'justo']);
    // 'poco' es el que menos lejos está de los dos que no cumplen.
    expect(res.candidatos[2].persona.id).toBe('poco');
  });

  it('evalúa cada requisito por separado', () => {
    const out = buscarPlantel(candidatos, [req, { cargo: 'Asistente', mesesMinimos: 0 }], { hoy: HOY });
    expect(out.length).toBe(2);
    expect(out[1].nCumplen).toBe(4);   // sin exigencias, todos entran
  });
});

describe('formatearMeses', () => {
  it('habla como las bases', () => {
    expect(formatearMeses(0)).toBe('0 meses');
    expect(formatearMeses(1)).toBe('1 mes');
    expect(formatearMeses(12)).toBe('1 año');
    expect(formatearMeses(38)).toBe('3 años 2 meses');
  });
});
