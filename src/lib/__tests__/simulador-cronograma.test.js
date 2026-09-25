import { describe, it, expect } from 'vitest';
import {
  desplazarCronograma, inicioDelCronograma,
  HISTORIAS, HISTORIA_IDS, HISTORIA_POR_ID, HISTORIA_AZAR,
  elegirHistoria, valoresDeHistoria, normalizarAjustesHistoria, frentesDeHistoria,
  evaluarFrente, invertirFrente, cronogramaPorEscenario, repartoSegunEscenario,
  armarCronograma, curvaDeCarga, clasificarCaras, semillaValida,
} from '../simulador-cronograma.js';
import { simularOrdenes, periodosEntre, sumarDias } from '../simulador-ordenes.js';

const PARTIDAS = [
  { id: 'p1', fecha_inicio_planificada: '2026-04-01', fecha_fin_planificada: '2026-04-30' },
  { id: 'p2', fecha_inicio_planificada: '2026-06-10', fecha_fin_planificada: '2026-07-05' },
  { id: 'p3', fecha_inicio_planificada: null },
  { id: 'p4', fecha_inicio_planificada: '2026-03-15', deleted_at: '2026-01-01' },
];
const PLAZO = { inicio: '2026-04-01', fin: '2026-12-31' };

describe('inicioDelCronograma', () => {
  it('manda el plazo del trabajo si lo tiene', () => {
    expect(inicioDelCronograma({ partidas: PARTIDAS, plazo: PLAZO })).toBe('2026-04-01');
  });
  it('sin plazo, la partida viva que arranca primero (la borrada no cuenta)', () => {
    expect(inicioDelCronograma({ partidas: PARTIDAS })).toBe('2026-04-01');
  });
  it('sin nada devuelve null, no una fecha inventada', () => {
    expect(inicioDelCronograma({ partidas: [{ id: 'x' }] })).toBe(null);
  });
});

describe('desplazarCronograma — el arranque del modo Simulación (§15.3)', () => {
  it('con «fechas del Gantt» no corre nada', () => {
    const r = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'gantt', hoy: '2026-09-24' });
    expect(r.activo).toBe(false);
    expect(r.reprogramacion).toEqual({});
    expect(r.plazo).toBe(PLAZO);
  });

  it('«como si empezara hoy» corre TODO el cronograma los mismos días, plazo incluido', () => {
    const r = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'hoy', hoy: '2026-10-01' });
    expect(r.activo).toBe(true);
    expect(r.deltaDias).toBe(183);
    expect(r.inicioNuevo).toBe('2026-10-01');
    expect(r.reprogramacion.p1).toEqual({ inicio: '2026-10-01', fin: '2026-10-30' });
    expect(r.reprogramacion.p2).toEqual({ inicio: '2026-12-10', fin: '2027-01-04' });
    // El plazo total no cambia: la decisión de Gabriel es respetar el fin.
    expect(r.plazo).toEqual({ inicio: '2026-10-01', fin: '2027-07-02' });
  });

  it('la partida sin fecha y la borrada no se inventan fechas', () => {
    const r = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'hoy', hoy: '2026-10-01' });
    expect(r.reprogramacion.p3).toBeUndefined();
    expect(r.reprogramacion.p4).toBeUndefined();
  });

  it('una fecha elegida también puede ir hacia atrás', () => {
    const r = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'fecha', arranqueFecha: '2026-03-01', hoy: '2026-09-24' });
    expect(r.deltaDias).toBe(-31);
    expect(r.reprogramacion.p1.inicio).toBe('2026-03-01');
  });

  it('«una fecha» sin fecha escrita todavía no corre nada y dice por qué', () => {
    const r = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'fecha', arranqueFecha: null, hoy: '2026-09-24' });
    expect(r.activo).toBe(false);
    expect(r.motivo).toBe('sin_fecha');
  });

  it('sin cronograma que correr lo dice', () => {
    const r = desplazarCronograma({ partidas: [{ id: 'x' }], arranque: 'hoy', hoy: '2026-09-24' });
    expect(r.activo).toBe(false);
    expect(r.motivo).toBe('sin_cronograma');
  });

  it('el motor lo come como una reprogramación: el insumo cae en el mes corrido', () => {
    const insumosPartida = [{
      id: 'i1', partida_id: 'p1', insumo_codigo: 'MAT-1', nombre_insumo: 'CEMENTO PORTLAND TIPO I',
      unidad: 'bls', tipo_insumo: 'material', cantidad_presupuestada: 100, precio_presupuestado: 30,
      costo_presupuestado: 3000,
    }];
    const d = desplazarCronograma({ partidas: PARTIDAS, plazo: PLAZO, arranque: 'hoy', hoy: '2026-10-01' });
    const c = simularOrdenes({
      insumosPartida, partidas: PARTIDAS, hoy: '2026-10-01', anclaje: 'cero',
      cronograma: 'reprogramado', reprogramacion: d.reprogramacion, plazo: d.plazo,
    });
    expect(c.propuestas.map(p => p.periodo)).toEqual(['2026-10']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tanda 3.3 — el cronograma «aleatorio por escenario» (§15.2 C y D)
// ═══════════════════════════════════════════════════════════════════

const AÑO = { inicio: '2026-01-01', fin: '2026-12-31' };
const ULTIMO_DIA = ['31', '28', '31', '30', '31', '30', '31', '31', '30', '31', '30', '31'];
const MENSUALES = ULTIMO_DIA.map((d, i) => {
  const m = String(i + 1).padStart(2, '0');
  return { id: `m${m}`, fecha_inicio_planificada: `2026-${m}-01`, fecha_fin_planificada: `2026-${m}-${d}` };
});
// Dos partidas que el Gantt arranca el MISMO día, adentro del frenazo que
// fijan los ajustes de abajo: una barata y una cara (98 % de la plata).
const ESCENA = [
  ...MENSUALES,
  { id: 'barata', fecha_inicio_planificada: '2026-06-10', fecha_fin_planificada: '2026-06-12' },
  { id: 'cara', fecha_inicio_planificada: '2026-06-10', fecha_fin_planificada: '2026-06-12' },
  { id: 'larga', fecha_inicio_planificada: '2026-02-01', fecha_fin_planificada: '2026-11-30' },
  { id: 'sin', fecha_inicio_planificada: null },
  { id: 'borrada', fecha_inicio_planificada: '2026-03-01', fecha_fin_planificada: '2026-03-05', deleted_at: '2026-01-01' },
];
const ins = (id, partida, nombre, unidad, cantidad, precio, codigo) => ({
  id, partida_id: partida, insumo_codigo: codigo, nombre_insumo: nombre, unidad,
  tipo_insumo: 'material', cantidad_presupuestada: cantidad, precio_presupuestado: precio,
  costo_presupuestado: cantidad * precio,
});
const PRESUPUESTO = [
  ...MENSUALES.map((p, i) => ins(`i-${p.id}`, p.id, 'CEMENTO PORTLAND TIPO I', 'bol', 100, 10, `C-${i}`)),
  ins('i-barata', 'barata', 'ARENA GRUESA', 'm3', 30, 100, 'AR-1'),
  ins('i-cara', 'cara', 'TUBERIA PVC SAP 4"', 'm', 10000, 100, 'TU-1'),
  ins('i-larga', 'larga', 'CLAVOS PARA MADERA', 'kg', 1000, 10, 'CL-1'),
];
// Frenazo del 40 % al 60 % del año, al 50 %: del 27-may al 7-ago.
const FRENAZO = { inicio: 0.4, duracion: 0.2, ritmo: 0.5, cuotaCaras: 0.3 };

const esquinas = (rangos) => {
  let combos = [{}];
  for (const [k, r] of Object.entries(rangos)) {
    combos = combos.flatMap(c => [{ ...c, [k]: r.min }, { ...c, [k]: r.max }]);
  }
  return combos;
};

describe('el catálogo de historias es cerrado y está bien armado', () => {
  it('seis historias, con todo lo que la pantalla y la IA necesitan', () => {
    expect(HISTORIA_IDS).toEqual(['frenazo', 'arranque_lento', 'tirones', 'adelantada', 'cierre_apurado', 'atraso_todo']);
    for (const h of HISTORIAS) {
      expect(h.etiqueta && h.icono && h.resumen).toBeTruthy();
      for (const r of Object.values(h.rangos)) {
        expect(r.max).toBeGreaterThan(r.min);
        expect(r.paso).toBeGreaterThan(0);
        expect(r.que).toBeTruthy();
      }
    }
  });

  it('una sola historia estira el fin, y es la de los pagos atrasados todo el plazo (§15.3)', () => {
    expect(HISTORIAS.filter(h => h.estira).map(h => h.id)).toEqual(['atraso_todo']);
  });

  it('en TODAS las esquinas de los rangos el cierre es posible y el fin se respeta', () => {
    const D = { desde: '2026-01-01', fin: '2026-12-31' };
    for (const h of HISTORIAS) {
      for (const v of esquinas(h.rangos)) {
        const fr = frentesDeHistoria(h, v, D);
        expect(fr.error, `${h.id} ${JSON.stringify(v)}`).toBeUndefined();
        if (!h.estira) {
          expect(fr.cierre).toBeGreaterThanOrEqual(0.5);
          expect(fr.cierre).toBeLessThanOrEqual(1.6);
          // El frente llega al fin del plazo el último día, ni antes ni después.
          const [tFin, tauFin] = fr.frente[fr.frente.length - 1];
          expect(tFin).toBe(fr.D1);
          expect(tauFin).toBe(fr.D1);
        }
        for (const t of fr.tramos) {
          expect(t.ritmo).toBeGreaterThanOrEqual(0.3);
          expect(t.ritmo).toBeLessThanOrEqual(1.6);
        }
      }
    }
  });
});

describe('la semilla', () => {
  it('el mismo escenario da SIEMPRE el mismo cronograma', () => {
    const a = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: 'azar', semilla: 42 });
    const b = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: 'azar', semilla: 42 });
    expect(a.reprogramacion).toEqual(b.reprogramacion);
    expect(a.historia.id).toBe(b.historia.id);
    expect(a.valores).toEqual(b.valores);
  });

  it('otra semilla varía la intensidad, siempre dentro de los rangos y en su paso', () => {
    for (const h of HISTORIAS) {
      const vistos = new Set();
      for (let s = 1; s <= 30; s += 1) {
        const { valores } = valoresDeHistoria(h, s);
        vistos.add(JSON.stringify(valores));
        for (const [k, r] of Object.entries(h.rangos)) {
          expect(valores[k]).toBeGreaterThanOrEqual(r.min);
          expect(valores[k]).toBeLessThanOrEqual(r.max);
          const pasos = (valores[k] - r.min) / r.paso;
          expect(Math.abs(pasos - Math.round(pasos))).toBeLessThan(1e-6);
        }
      }
      expect(vistos.size).toBeGreaterThan(1);
    }
  });

  it('«al azar» sortea una historia del catálogo, y da lo mismo que elegir esa historia a mano', () => {
    const vistas = new Set();
    for (let s = 1; s <= 60; s += 1) {
      const h = elegirHistoria(HISTORIA_AZAR, s);
      expect(HISTORIA_POR_ID.get(h.id)).toBe(h);
      vistas.add(h.id);
    }
    expect(vistas.size).toBeGreaterThan(3);
    const azar = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: 'azar', semilla: 7 });
    const aMano = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: azar.historia.id, semilla: 7 });
    expect(azar.azar).toBe(true);
    expect(aMano.azar).toBe(false);
    expect(aMano.reprogramacion).toEqual(azar.reprogramacion);
  });

  it('una historia que ya no existe se trata como «al azar», no revienta', () => {
    const r = cronogramaPorEscenario({ partidas: ESCENA, plazo: AÑO, historia: 'inventada', semilla: 3 });
    expect(r.activo).toBe(true);
    expect(r.azar).toBe(true);
    expect(HISTORIA_IDS).toContain(r.historia.id);
  });

  it('una semilla inválida es 1', () => {
    expect(semillaValida('x')).toBe(1);
    expect(semillaValida(0)).toBe(1);
    expect(semillaValida(-5)).toBe(1);
    expect(semillaValida(12.7)).toBe(12);
  });
});

describe('los ajustes (lo que la IA de la 3.4 va a poder elegir)', () => {
  it('pisan el sorteo, recortados al rango y pegados al paso', () => {
    const h = HISTORIA_POR_ID.get('frenazo');
    const { valores, ajustados } = valoresDeHistoria(h, 1, { ritmo: 0.1, inicio: 0.33, noExiste: 5 });
    expect(valores.ritmo).toBe(0.45);            // recortado al mínimo
    expect(valores.inicio).toBe(0.35);           // pegado al paso de 0,05
    expect(ajustados.sort()).toEqual(['inicio', 'ritmo']);
  });

  it('ajustar una perilla no cambia lo que la semilla le da a las demás', () => {
    const h = HISTORIA_POR_ID.get('frenazo');
    const libre = valoresDeHistoria(h, 9).valores;
    const conAjuste = valoresDeHistoria(h, 9, { inicio: 0.25 }).valores;
    expect(conAjuste.duracion).toBe(libre.duracion);
    expect(conAjuste.ritmo).toBe(libre.ritmo);
  });

  it('se guardan solo perillas que existen, y con «al azar» no hay ajustes', () => {
    expect(normalizarAjustesHistoria('frenazo', { ritmo: 3, basura: 1, inicio: 'x' })).toEqual({ ritmo: 0.7 });
    expect(normalizarAjustesHistoria('azar', { ritmo: 0.5 })).toEqual({});
    expect(normalizarAjustesHistoria('frenazo', null)).toEqual({});
  });

  it('con «al azar» los ajustes no se aplican (no se sabe a qué historia van)', () => {
    const r = cronogramaPorEscenario({ partidas: ESCENA, plazo: AÑO, historia: 'azar', semilla: 5, ajustes: { ritmo: 0.45 } });
    expect(r.ajustados).toEqual([]);
  });
});

describe('el frente', () => {
  it('evaluar e invertir son uno la vuelta del otro, y fuera de la historia van a ritmo 1', () => {
    const f = [[0, 0], [10, 10], [20, 15], [30, 30]];
    expect(evaluarFrente(f, 15)).toBe(12.5);
    expect(invertirFrente(f, 12.5)).toBe(15);
    expect(evaluarFrente(f, 40)).toBe(40);
    expect(evaluarFrente(f, -5)).toBe(-5);
    expect(invertirFrente(null, 7)).toBe(7);
  });

  it('en un tramo quieto, invertir da el PRIMER día en que se llega', () => {
    const f = [[0, 0], [10, 10], [20, 10], [30, 30]];
    expect(invertirFrente(f, 10)).toBe(10);
    expect(invertirFrente(f, 12)).toBe(21);
  });
});

describe('cronogramaPorEscenario — lo que el §15.3 exige', () => {
  const frenazo = () => cronogramaPorEscenario({
    partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: 'frenazo', ajustes: FRENAZO,
  });

  it('el fin se respeta: lo último sigue terminando el último día, y nada termina después', () => {
    for (const id of HISTORIA_IDS.filter(x => x !== 'atraso_todo')) {
      for (const semilla of [1, 2, 3, 11, 97]) {
        const r = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: id, semilla });
        expect(r.activo).toBe(true);
        expect(r.reprogramacion.m12.fin, `${id}/${semilla}`).toBe('2026-12-31');
        expect(r.reprogramacion.m01.inicio).toBe('2026-01-01');
        for (const f of Object.values(r.reprogramacion)) expect(f.fin <= '2026-12-31').toBe(true);
        expect(r.plazo).toBe(AÑO);
        expect(r.estira).toBe(false);
      }
    }
  });

  it('respeta el orden del Gantt: lo que empezaba antes sigue empezando antes (fuera de las caras)', () => {
    for (const id of HISTORIA_IDS) {
      const r = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: id, semilla: 4 });
      const generales = ESCENA.filter(p => r.reprogramacion[p.id] && !r.carasIds.has(p.id))
        .sort((a, b) => (a.fecha_inicio_planificada < b.fecha_inicio_planificada ? -1 : 1));
      for (let i = 1; i < generales.length; i += 1) {
        expect(r.reprogramacion[generales[i].id].inicio >= r.reprogramacion[generales[i - 1].id].inicio).toBe(true);
      }
    }
  });

  it('la partida sin fecha y la borrada no reciben fechas inventadas', () => {
    const r = frenazo();
    expect(r.reprogramacion.sin).toBeUndefined();
    expect(r.reprogramacion.borrada).toBeUndefined();
  });

  it('el frenazo baja el ritmo en su tramo y el cierre se calcula para llegar en fecha', () => {
    const r = frenazo();
    expect(r.tramos.map(t => t.ritmo)).toEqual([1, 0.5, 1.25]);
    expect(r.tramos[1]).toMatchObject({ caja: 'apretada', carasEsperan: true, calculado: false });
    expect(r.tramos[2].calculado).toBe(true);
    expect(r.cierre).toBe(1.25);
    // Contiguos: donde termina uno empieza el otro.
    expect(sumarDias(r.tramos[0].hasta, 1)).toBe(r.tramos[1].desde);
    expect(sumarDias(r.tramos[1].hasta, 1)).toBe(r.tramos[2].desde);
  });

  it('cuando la caja aprieta, la barata sigue y la CARA espera a que vuelva la plata', () => {
    const r = frenazo();
    expect([...r.carasIds]).toEqual(['cara']);
    const finFrenazo = r.tramos[1].hasta;
    // La barata arranca adentro del frenazo (el frente general avanza a la mitad).
    expect(r.reprogramacion.barata.inicio > r.tramos[1].desde).toBe(true);
    expect(r.reprogramacion.barata.inicio <= finFrenazo).toBe(true);
    // La cara, recién cuando termina.
    expect(r.reprogramacion.cara.inicio > finFrenazo).toBe(true);
    expect(r.caras).toMatchObject({ partidas: 1, postergadas: 1, montoPostergado: 1000000 });
    expect(r.relato.join(' ')).toContain('arranca recién cuando vuelve la plata');
  });

  it('una cara nunca arranca ANTES que en el frente general', () => {
    for (const s of [1, 2, 3, 4, 5]) {
      const r = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: 'tirones', semilla: s });
      const sinCaras = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: [], plazo: AÑO, historia: 'tirones', semilla: s });
      expect(r.reprogramacion.cara.inicio >= sinCaras.reprogramacion.cara.inicio).toBe(true);
    }
  });

  it('«cara» se mide contra la propia obra: las de más costo por día que suman la cuota', () => {
    const fechas = new Map([['a', { s: 0, e: 0 }], ['b', { s: 0, e: 9 }], ['c', { s: 0, e: 0 }]]);
    const insumos = [
      { partida_id: 'a', costo_presupuestado: 600 },     // 600 por día
      { partida_id: 'b', costo_presupuestado: 1000 },    // 100 por día
      { partida_id: 'c', costo_presupuestado: 400 },     // 400 por día
    ];
    const r = clasificarCaras({ fechas, insumosPartida: insumos, cuota: 0.3 });
    expect([...r.ids]).toEqual(['a']);
    expect(r.umbralDia).toBe(600);
    expect([...clasificarCaras({ fechas, insumosPartida: insumos, cuota: 0.5 }).ids].sort()).toEqual(['a', 'c']);
  });

  it('las historias sin caja apretada no tienen caras', () => {
    const r = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: 'adelantada' });
    expect(r.caras).toBe(null);
    expect(r.frenteCaras).toBe(null);
    // Arranque fuerte: lo del Gantt de junio se adelanta.
    expect(r.reprogramacion.m06.inicio < '2026-06-01').toBe(true);
  });

  it('«pagos atrasados todo el plazo» es la única que estira el fin, y lo dice', () => {
    const r = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: 'atraso_todo', ajustes: { ritmo: 0.8 } });
    // 365 días al 80 % son 456,25: el fin pasa del 31-dic al 1-abr.
    expect(r.estira).toBe(true);
    expect(r.finNuevo).toBe('2027-04-01');
    expect(r.diasEstirados).toBe(91);
    expect(r.plazo).toEqual({ inicio: '2026-01-01', fin: '2027-04-01' });
    expect(r.reprogramacion.m12.fin).toBe('2027-04-01');
    // Sin plata más adelante, las caras no tienen a qué esperar.
    expect(r.caras).toBe(null);
    expect(r.relato.join(' ')).toContain('El fin se estira 91 días');
  });

  it('en modo real la historia corre desde hoy: lo que ya pasó queda como en el Gantt', () => {
    const r = cronogramaPorEscenario({
      partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: 'frenazo', ajustes: FRENAZO, desde: '2026-07-01',
    });
    expect(r.desdeHoy).toBe(true);
    expect(r.tramos[0].desde).toBe('2026-07-01');
    for (const m of ['m01', 'm02', 'm03', 'm04', 'm05', 'm06']) {
      const p = ESCENA.find(x => x.id === m);
      expect(r.reprogramacion[m]).toEqual({ inicio: p.fecha_inicio_planificada, fin: p.fecha_fin_planificada });
    }
    expect(r.reprogramacion.m12.fin).toBe('2026-12-31');
    // El frenazo va del 40 % al 60 % de lo que QUEDA (1-jul a 31-dic): de
    // mediados de setiembre a mediados de octubre. Lo de octubre se atrasa.
    expect(r.tramos[1].desde >= '2026-09-01').toBe(true);
    expect(r.reprogramacion.m10.inicio > '2026-10-01').toBe(true);
    expect(r.relato.join(' ')).toContain('La historia corre desde hoy');
  });

  it('sin plazo por delante o sin cronograma, no inventa: dice por qué', () => {
    expect(cronogramaPorEscenario({ partidas: ESCENA, plazo: AÑO, desde: '2027-02-01' })).toMatchObject({ activo: false, motivo: 'plazo_vencido' });
    expect(cronogramaPorEscenario({ partidas: [{ id: 'x' }] })).toMatchObject({ activo: false, motivo: 'sin_cronograma' });
  });

  it('sin plazo, el horizonte sale de las partidas', () => {
    const r = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: PRESUPUESTO, historia: 'frenazo', ajustes: FRENAZO });
    expect(r.activo).toBe(true);
    expect(r.fin).toBe('2026-12-31');
    expect(r.reprogramacion.m12.fin).toBe('2026-12-31');
  });
});

describe('el reparto «según el escenario» (§15.2 D)', () => {
  it('con el Gantt reparte por días, en los MISMOS períodos que mira el motor', () => {
    const r = repartoSegunEscenario({ partidas: ESCENA });
    const larga = r.larga;
    expect(Object.keys(larga)).toEqual(periodosEntre('2026-02-01', '2026-11-30'));
    expect(larga['2026-02']).toBeCloseTo(28 / 303, 5);
    expect(larga['2026-03']).toBeCloseTo(31 / 303, 5);
    expect(Object.values(larga).reduce((s, f) => s + f, 0)).toBeCloseTo(1, 5);
    // Una partida de un solo mes no necesita reparto.
    expect(r.m03).toBeUndefined();
  });

  it('con anticipación, los períodos son los del tramo corrido, como en el motor', () => {
    const r = repartoSegunEscenario({ partidas: ESCENA, anticipacionDias: 10 });
    expect(Object.keys(r.larga)).toEqual(periodosEntre(sumarDias('2026-02-01', -10), sumarDias('2026-11-30', -10)));
    expect(r.larga['2026-01']).toBeCloseTo(10 / 303, 5);
    expect(r.larga['2026-11']).toBeCloseTo(20 / 303, 5);
  });

  it('con una historia, un mes de frenazo lleva la mitad por día que un mes normal', () => {
    const esc = cronogramaPorEscenario({ partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, historia: 'frenazo', ajustes: FRENAZO });
    const r = repartoSegunEscenario({ partidas: ESCENA, reprogramacion: esc.reprogramacion, escenario: esc });
    // Marzo va entero al 100 %; julio, entero adentro del frenazo, al 50 %.
    expect(r.larga['2026-07'] / 31).toBeCloseTo((r.larga['2026-03'] / 31) * 0.5, 5);
    expect(Object.values(r.larga).reduce((s, f) => s + f, 0)).toBeCloseTo(1, 5);
  });

  it('semana a semana, las fracciones van por semana ISO', () => {
    const r = repartoSegunEscenario({ partidas: ESCENA, granularidad: 'semana' });
    expect(Object.keys(r.m03)[0]).toMatch(/^2026-W\d{2}$/);
    expect(Object.values(r.m03).reduce((s, f) => s + f, 0)).toBeCloseTo(1, 5);
  });
});

describe('armarCronograma — de la pantalla al motor', () => {
  const base = {
    partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, hoy: '2026-03-15',
  };
  const motorDe = (x) => ({
    insumosPartida: PRESUPUESTO, partidas: ESCENA, hoy: '2026-03-15', anclaje: 'cero', ...x,
  });

  it('sin historia ni arranque, el motor corre el Gantt y no hay curva que comparar', () => {
    const c = armarCronograma({ ...base, modo: 'simulacion' });
    expect(c.motor.cronograma).toBe('gantt');
    expect(c.motor.reprogramacion).toEqual({});
    expect(c.motorSinHistoria).toBe(null);
    expect(c.escenario).toBe(null);
  });

  it('con historia: cronograma reprogramado, y la base de la curva es el mismo escenario sin la historia', () => {
    const c = armarCronograma({ ...base, modo: 'simulacion', cronograma: 'escenario', historia: 'frenazo', historiaAjustes: FRENAZO });
    expect(c.escenario.activo).toBe(true);
    expect(c.motor.cronograma).toBe('reprogramado');
    expect(c.motor.reprogramacion.cara.inicio > '2026-08-01').toBe(true);
    expect(c.motorSinHistoria.cronograma).toBe('gantt');
  });

  it('la historia se cuenta SOBRE el arranque elegido', () => {
    const c = armarCronograma({ ...base, modo: 'simulacion', arranque: 'hoy', cronograma: 'escenario', historia: 'frenazo', historiaAjustes: FRENAZO });
    expect(c.desplazado.activo).toBe(true);
    expect(c.motor.reprogramacion.m01.inicio).toBe('2026-03-15');
    expect(c.motorSinHistoria.reprogramacion.m01.inicio).toBe('2026-03-15');
    expect(c.motor.plazo.inicio).toBe('2026-03-15');
  });

  it('en modo real no hay arranque, y la historia arranca hoy', () => {
    const c = armarCronograma({ ...base, modo: 'real', arranque: 'hoy', cronograma: 'escenario', historia: 'frenazo', historiaAjustes: FRENAZO });
    expect(c.desplazado.activo).toBe(false);
    expect(c.escenario.inicio).toBe('2026-03-15');
    expect(c.motor.reprogramacion.m01.inicio).toBe('2026-01-01');
  });

  it('reparto «según el escenario» con la historia puesta: el motor recibe el dato y NO deja nada sin planificar', () => {
    const c = armarCronograma({ ...base, modo: 'simulacion', cronograma: 'escenario', historia: 'frenazo', historiaAjustes: FRENAZO, reparto: 'escenario' });
    expect(c.motor.reparto).toBe('escenario');
    expect(Object.keys(c.motor.repartoManual)).toContain('larga');
    const corrida = simularOrdenes(motorDe(c.motor));
    expect(corrida.pendientes).toEqual([]);
  });

  it('una historia MUEVE la plata, no la crea ni la pierde', () => {
    for (const historia of HISTORIA_IDS) {
      for (const reparto of ['parejo', 'escenario']) {
        const c = armarCronograma({ ...base, modo: 'simulacion', cronograma: 'escenario', historia, semilla: 3, reparto });
        const conHistoria = simularOrdenes(motorDe(c.motor)).resumen;
        const gantt = simularOrdenes(motorDe(c.motorSinHistoria)).resumen;
        const neto = (r) => r.montoPlanificado - r.montoColchon - r.montoRedondeo;
        expect(Math.abs(neto(conHistoria) - neto(gantt)), `${historia}/${reparto}`).toBeLessThan(0.5);
      }
    }
  });

  it('sin cronograma no hay avance por partida: el reparto del escenario cae a parejo y lo dice', () => {
    const c = armarCronograma({ ...base, modo: 'simulacion', cronograma: 'sin_cronograma', reparto: 'escenario' });
    expect(c.motor.cronograma).toBe('sin_cronograma');
    expect(c.motor.reparto).toBe('parejo');
    expect(c.notas).toContain('reparto_sin_cronograma');
  });

  it('con el Gantt y reparto «según el escenario», reparte por días', () => {
    const c = armarCronograma({ ...base, modo: 'simulacion', reparto: 'escenario' });
    expect(c.motor.cronograma).toBe('gantt');
    expect(c.motor.repartoManual.larga['2026-02']).toBeCloseTo(28 / 303, 5);
  });
});

describe('la curva de carga (§15.2 C)', () => {
  it('suma por mes lo que se ENTREGA, más los sobres, y marca el pico de cada lado', () => {
    const base = {
      propuestas: [{ periodo: '2026-10', lineas: [{ monto: 100, entregas: [{ periodo: '2026-10', monto: 60 }, { periodo: '2026-11', monto: 40 }] }] }],
      sobres: [{ porPeriodo: [{ periodo: '2026-10', monto: 5 }] }],
    };
    const esc = {
      propuestas: [{ periodo: '2026-W45', lineas: [{ monto: 100, entregas: [{ periodo: '2026-W45', monto: 30 }, { periodo: '2026-W49', monto: 70 }] }] }],
      sobres: [],
    };
    const c = curvaDeCarga(base, esc);
    expect(c.filas.map(f => [f.mes, f.base, f.escenario])).toEqual([
      ['2026-10', 65, 0], ['2026-11', 40, 30], ['2026-12', 0, 70],
    ]);
    expect(c.totalBase).toBe(105);
    expect(c.totalEscenario).toBe(100);
    expect(c.picoBase.mes).toBe('2026-10');
    expect(c.picoEscenario.mes).toBe('2026-12');
    expect(c.maximo).toBe(70);
  });

  it('con el frenazo, la plata de los meses frenados se corre a la recuperación', () => {
    const c = armarCronograma({
      partidas: ESCENA, insumosPartida: PRESUPUESTO, plazo: AÑO, hoy: '2026-01-01',
      modo: 'simulacion', cronograma: 'escenario', historia: 'frenazo', historiaAjustes: FRENAZO, reparto: 'escenario',
    });
    const correr = (x) => simularOrdenes({ insumosPartida: PRESUPUESTO, partidas: ESCENA, hoy: '2026-01-01', anclaje: 'cero', ...x });
    const curva = curvaDeCarga(correr(c.motorSinHistoria), correr(c.motor));
    const mes = (m) => curva.filas.find(f => f.mes === m);
    // La tubería cara del Gantt de junio espera al fin del frenazo (agosto).
    expect(mes('2026-06').escenario).toBeLessThan(mes('2026-06').base);
    expect(mes('2026-08').escenario).toBeGreaterThan(mes('2026-08').base);
    expect(Math.abs(curva.totalBase - curva.totalEscenario)).toBeLessThan(20);
  });
});
