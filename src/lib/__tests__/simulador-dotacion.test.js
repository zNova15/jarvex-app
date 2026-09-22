import { describe, it, expect } from 'vitest';
import {
  simularDotacion, planDeContratacion, fechaDeAviso,
  cargoCanonico, cargoDeInsumo, clasificarPadron,
  capacidadDePeriodo, diasLaborables, rangoDePeriodo,
  JORNADA_DEFAULT, CARGO_KEYS,
} from '../simulador-dotacion.js';
import { simularOrdenes } from '../simulador-ordenes.js';

// ── LOS DATOS SON LOS REALES ──────────────────────────────────────
// Medidos contra producción el 22-set-2026 (Plan Miraflores,
// obra_id 984bacda-97ae-4744-bf5f-a8ab03f48d8d):
//
//   Presupuesto (tipo_insumo='mano_obra', unidad `hh`, 5 cargos):
//     PEON                        470020004 · 142.891,8 hh · S/ 2.867.839
//     OPERARIO                    470020003 ·  37.418,6 hh · S/ 1.058.571
//     OFICIAL                     470020001 ·  15.747,3 hh · S/   348.961
//     OPERADOR DE EQUIPO LIVIANO  470020002 ·   6.138,5 hh · S/   173.657
//     TOPOGRAFO                   450020005 ·     872,9 hh · S/    25.566
//
//   Padrón (86 personas activas en todo el sistema, 25 cargos distintos):
//     15 Peón · 2 Operario · 1 Oficial · 1 Maestro de Obra
//     16 «Subcontrato MOSHCO» + 13 «Subcontrato JR» → NO dicen el oficio
//     55 de 86 sin `fecha_ingreso` · `asistencia` con 0 filas
const CODS = {
  peon: '470020004', oficial: '470020001', operario: '470020003',
  operador: '470020002', topografo: '450020005',
};

const linea = (periodo, nombre, codigo, hh, monto, porPartida = null) => ({
  periodo, etiquetaPeriodo: periodo,
  insumo_codigo: codigo, nombre, unidad: 'hh',
  cantidad: hh, monto, partidas: (porPartida || []).map(p => p.partida_id),
  porPartida, esReferencia: true,
});

const persona = (id, cargo, extra = {}) => ({
  id, obra_id: 'o1', nombres: `N${id}`, apellidos: `A${id}`,
  cargo, estado: 'activo', ...extra,
});

const peones = (n, extra = {}) =>
  Array.from({ length: n }, (_, i) => persona(`peon-${i}`, 'Peón', extra));

describe('cargo canónico — el mismo vocabulario para presupuesto y padrón', () => {
  it('el nombre del expediente y el cargo del padrón caen en la misma clave', () => {
    expect(cargoCanonico('PEON')).toBe('peon');
    expect(cargoCanonico('Peón')).toBe('peon');
    expect(cargoCanonico('Peones')).toBe('peon');
    expect(cargoCanonico('OPERARIO')).toBe('operario');
    expect(cargoCanonico('Operario Civil')).toBe('operario');
    expect(cargoCanonico('Oficial Encofrador')).toBe('oficial');
    expect(cargoCanonico('Maestro de Obra')).toBe('maestro');
  });

  it('«OPERADOR DE EQUIPO LIVIANO» no es un operario', () => {
    // Si cayera en `operario` le sumaría 6.138 hh al cargo equivocado y la
    // brecha de operarios saldría inflada.
    expect(cargoCanonico('OPERADOR DE EQUIPO LIVIANO')).toBe('operador_equipo');
    expect(cargoCanonico('Operador de equipo pesado')).toBe('operador_equipo');
  });

  it('«Oficial de Seguridad» es la prevencionista, no una obrera', () => {
    expect(cargoCanonico('Oficial de Seguridad')).toBe(null);
    expect(cargoCanonico('Oficial administrativo')).toBe(null);
  });

  it('lo que no se reconoce da null, nunca el cargo más común', () => {
    for (const c of ['Ingeniero', 'Almacenero', 'JASS', 'Otros / Servicios',
      'Supervision', 'Asistente Contabilidad', 'Subcontrato MOSHCO', '', null]) {
      expect(cargoCanonico(c)).toBe(null);
    }
  });

  it('el código del expediente manda sobre el nombre', () => {
    expect(cargoDeInsumo({ insumo_codigo: CODS.peon, nombre: 'cualquier cosa' })).toBe('peon');
    expect(cargoDeInsumo({ insumo_codigo: CODS.operador, nombre: 'OPERARIO' })).toBe('operador_equipo');
    // Sin código reconocido cae al nombre.
    expect(cargoDeInsumo({ insumo_codigo: '999', nombre: 'TOPOGRAFO' })).toBe('topografo');
  });
});

describe('la jornada: días laborables reales, no un 208 fijo', () => {
  it('el mes se calcula contando lunes a sábado', () => {
    // Octubre 2026: 31 días, 4 domingos (4, 11, 18, 25) → 27 laborables.
    expect(diasLaborables('2026-10-01', '2026-10-31')).toBe(27);
    expect(capacidadDePeriodo('2026-10', { hoy: '2026-09-22' })).toMatchObject({
      diasLaborables: 27, horas: 216, parcial: false, pasado: false,
    });
  });

  it('los feriados bajan la capacidad de ese mes, no de todos', () => {
    const feriados = ['2026-10-08', '2026-10-09'];
    expect(capacidadDePeriodo('2026-10', { hoy: '2026-09-22', feriados }).diasLaborables).toBe(25);
    expect(capacidadDePeriodo('2026-11', { hoy: '2026-09-22', feriados }).diasLaborables).toBe(25);
  });

  it('el mes en curso se recorta desde hoy: el 3 de setiembre ya no se trabaja', () => {
    const cap = capacidadDePeriodo('2026-09', { hoy: '2026-09-22' });
    // 22..30 de setiembre: 22..26 (mar-sáb) + 28..30 = 8 días.
    expect(cap).toMatchObject({ diasLaborables: 8, horas: 64, parcial: true, pasado: false });
    // Sin recorte sería el mes entero — la capacidad que ya no existe.
    expect(capacidadDePeriodo('2026-09', { hoy: '2026-09-22', recortarActual: false }).diasLaborables).toBe(26);
  });

  it('un período ya vencido se marca pasado y no se recorta', () => {
    const cap = capacidadDePeriodo('2026-07', { hoy: '2026-09-22' });
    expect(cap.pasado).toBe(true);
    expect(cap.parcial).toBe(false);
  });

  it('la semana ISO también tiene rango y capacidad', () => {
    expect(rangoDePeriodo('2026-W41')).toEqual({ inicio: '2026-10-05', fin: '2026-10-11' });
    expect(capacidadDePeriodo('2026-W41', { hoy: '2026-09-22' })).toMatchObject({
      diasLaborables: 6, horas: 48,
    });
  });

  it('el factor de ausentismo baja las horas sin tocar los días', () => {
    const cap = capacidadDePeriodo('2026-10', {
      hoy: '2026-09-22', jornada: { ...JORNADA_DEFAULT, factorEfectivo: 0.9 },
    });
    expect(cap.diasLaborables).toBe(27);
    expect(cap.horas).toBe(194.4);
  });

  it('un período inexistente no revienta ni inventa horas', () => {
    expect(rangoDePeriodo('basura')).toBe(null);
    expect(capacidadDePeriodo('basura', { hoy: '2026-09-22' })).toMatchObject({ horas: 0, diasLaborables: 0 });
  });
});

describe('el padrón: quién cuenta como oferta y quién no', () => {
  const padron = [
    ...peones(15),
    persona('op1', 'Operario'), persona('op2', 'Operario'),
    persona('of1', 'Oficial'),
    persona('mo1', 'Maestro de Obra'),
    persona('ing1', 'Ingeniero'),
    persona('alm1', 'Almacenero'),
    persona('seg1', 'Oficial de Seguridad'),
    ...Array.from({ length: 16 }, (_, i) => persona(`m${i}`, 'Subcontrato MOSHCO', { subcontratista_id: 'sub-moshco' })),
    ...Array.from({ length: 13 }, (_, i) => persona(`j${i}`, 'Subcontrato JR', { subcontratista_id: 'sub-jr' })),
    persona('baja1', 'Peón', { estado: 'inactivo' }),
  ];

  it('separa los 29 de subcontrato en vez de contarlos como peones', () => {
    const r = clasificarPadron(padron);
    expect(r.porCargo.get('peon').length).toBe(15);
    expect(r.sinEncajar.filter(p => p.motivo === 'subcontrato').length).toBe(29);
    // El error que esto evita: 15 + 29 = 44 peones que no existen.
    expect(r.porCargo.get('peon').length).not.toBe(44);
  });

  it('el staff y los profesionales no ejecutan HH del presupuesto', () => {
    const r = clasificarPadron(padron);
    const noObra = r.sinEncajar.filter(p => p.motivo === 'cargo_no_obra').map(p => p.cargo);
    expect(noObra).toEqual(expect.arrayContaining(['Ingeniero', 'Almacenero', 'Oficial de Seguridad']));
  });

  it('el que no está activo sale por «inactivo», no por su cargo', () => {
    const r = clasificarPadron(padron);
    expect(r.sinEncajar.filter(p => p.motivo === 'inactivo').length).toBe(1);
    expect(r.porCargo.get('peon').length).toBe(15);
  });

  it('con contarSubcontratos el caller se hace cargo del mapeo', () => {
    // «Subcontrato MOSHCO» sigue sin decir el oficio: entra igual como
    // cargo_no_obra, no como peón. El flag solo deja de descartarlo por el
    // vínculo; no inventa un oficio que el texto no tiene.
    const r = clasificarPadron(padron, { contarSubcontratos: true });
    expect(r.sinEncajar.filter(p => p.motivo === 'subcontrato').length).toBe(0);
    expect(r.porCargo.get('peon').length).toBe(15);
  });

  it('el 64% sin fecha de ingreso se cuenta igual, pero se informa', () => {
    const r = clasificarPadron([
      persona('a', 'Peón'), persona('b', 'Peón', { fecha_ingreso: '2026-07-20' }),
    ]);
    expect(r.porCargo.get('peon').length).toBe(2);
    expect(r.sinFechaIngreso).toBe(1);
  });
});

describe('sentido 1 — cronograma → dotación necesaria', () => {
  const OCT = linea('2026-10', 'PEON', CODS.peon, 37081, 744115);

  it('divide las HH del período por las horas que rinde una persona', () => {
    const r = simularDotacion({ manoObra: [OCT], personal: peones(15), hoy: '2026-09-22' });
    const oct = r.periodos.find(p => p.periodo === '2026-10');
    // 27 días × 8 h = 216 h por persona · 37.081 / 216 = 171,67 peones.
    expect(oct.horasPorPersona).toBe(216);
    expect(oct.cargos[0].personasNecesarias).toBe(171.67);
  });

  it('la brecha es el número que se lleva a una decisión de contratación', () => {
    const r = simularDotacion({ manoObra: [OCT], personal: peones(15), hoy: '2026-09-22' });
    const peon = r.periodos[0].cargos[0];
    expect(peon.personasDisponibles).toBe(15);
    expect(peon.brechaPersonas).toBe(156.67);
    // 15 personas × 216 h = 3.240 hh de 37.081: menos del 9%.
    expect(peon.hhDisponibles).toBe(3240);
    expect(peon.cobertura).toBe(0.0874);
  });

  it('sobrar gente da brecha negativa, no cero', () => {
    const chico = linea('2026-10', 'PEON', CODS.peon, 1000, 20070);
    const r = simularDotacion({ manoObra: [chico], personal: peones(15), hoy: '2026-09-22' });
    const peon = r.periodos[0].cargos[0];
    expect(peon.personasNecesarias).toBe(4.63);
    expect(peon.brechaPersonas).toBe(-10.37);
    expect(peon.cobertura).toBe(1);
  });

  it('sin horas por persona la división no se inventa: personasNecesarias es null', () => {
    // Todo el mes feriado. Un Infinity disfrazado de número acá se
    // convertiría en «contratá infinitos peones».
    const feriados = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    const r = simularDotacion({ manoObra: [OCT], personal: peones(15), hoy: '2026-09-22', feriados });
    const peon = r.periodos[0].cargos[0];
    expect(peon.personasNecesarias).toBe(null);
    expect(peon.brechaPersonas).toBe(null);
    expect(peon.hhDisponibles).toBe(0);
  });

  it('cada cargo va por su cuenta: 178 peones y 38 operarios son dos problemas', () => {
    const r = simularDotacion({
      manoObra: [OCT, linea('2026-10', 'OPERARIO', CODS.operario, 7863, 222444)],
      personal: [...peones(15), persona('op1', 'Operario'), persona('op2', 'Operario')],
      hoy: '2026-09-22',
    });
    const [peon, operario] = r.periodos[0].cargos;
    expect(peon.cargo).toBe('peon');
    expect(operario.cargo).toBe('operario');
    expect(operario.personasNecesarias).toBe(36.4);
    expect(operario.personasDisponibles).toBe(2);
  });

  it('un cargo del presupuesto sin nadie en el padrón da brecha total', () => {
    // TOPOGRAFO: 872,9 hh presupuestadas, cero topógrafos en el padrón.
    const r = simularDotacion({
      manoObra: [linea('2026-10', 'TOPOGRAFO', CODS.topografo, 872.9, 25566)],
      personal: peones(15), hoy: '2026-09-22',
    });
    const topo = r.periodos[0].cargos[0];
    expect(topo.personasDisponibles).toBe(0);
    expect(topo.hhDisponibles).toBe(0);
    expect(topo.cobertura).toBe(0);
    expect(topo.brechaPersonas).toBe(4.04);
  });
});

describe('sentido 2 — dotación disponible → qué partidas alcanza', () => {
  const partidas = [
    { id: 'pa', nombre_partida: 'EXCAVACION MANUAL', fecha_inicio_planificada: '2026-10-01' },
    { id: 'pb', nombre_partida: 'RELLENO COMPACTADO', fecha_inicio_planificada: '2026-10-10' },
    { id: 'pc', nombre_partida: 'CONCRETO f=210', fecha_inicio_planificada: '2026-10-20' },
  ];
  // 3 partidas de 1.000 hh de peón cada una. 15 peones rinden 3.240 hh.
  const mo = [linea('2026-10', 'PEON', CODS.peon, 3000, 60210, [
    { partida_id: 'pa', cantidad: 1000, monto: 20070 },
    { partida_id: 'pb', cantidad: 1000, monto: 20070 },
    { partida_id: 'pc', cantidad: 1000, monto: 20070 },
  ])];

  it('con gente de sobra las tres partidas alcanzan', () => {
    const r = simularDotacion({ manoObra: mo, personal: peones(15), partidas, hoy: '2026-09-22' });
    const oct = r.periodos[0];
    expect(oct.alcanceDisponible).toBe(true);
    expect(oct.resumenAlcance).toEqual({ completas: 3, parciales: 0, sinGente: 0 });
  });

  it('con 7 peones (1.512 hh) alcanza una entera, la segunda a medias y la tercera nada', () => {
    const r = simularDotacion({ manoObra: mo, personal: peones(7), partidas, hoy: '2026-09-22' });
    const oct = r.periodos[0];
    expect(oct.resumenAlcance).toEqual({ completas: 1, parciales: 1, sinGente: 1 });
    // Prioridad: la que arranca antes.
    expect(oct.alcanceOrdenadoPor).toBe('fecha_inicio');
    expect(oct.alcance.map(p => [p.partida_id, p.estado])).toEqual([
      ['pa', 'completa'], ['pb', 'parcial'], ['pc', 'sin_gente'],
    ]);
    expect(oct.alcance[1].hhCubiertas).toBe(512);
  });

  it('una partida sin uno de sus cargos NO está completa aunque sobren peones', () => {
    // Una cuadrilla sin operario no levanta un muro.
    const conOperario = [
      linea('2026-10', 'PEON', CODS.peon, 1000, 20070, [{ partida_id: 'pa', cantidad: 1000, monto: 20070 }]),
      linea('2026-10', 'OPERARIO', CODS.operario, 500, 14145, [{ partida_id: 'pa', cantidad: 500, monto: 14145 }]),
    ];
    const r = simularDotacion({ manoObra: conOperario, personal: peones(15), partidas, hoy: '2026-09-22' });
    const pa = r.periodos[0].alcance[0];
    expect(pa.estado).toBe('sin_gente');
    expect(pa.porCargo).toEqual([
      { cargo: 'peon', label: 'Peón', hh: 1000, cubiertas: 1000 },
      { cargo: 'operario', label: 'Operario', hh: 500, cubiertas: 0 },
    ]);
  });

  it('sin el desglose por partida se dice que no se sabe, no se inventa un ranking', () => {
    const viejo = [{ ...linea('2026-10', 'PEON', CODS.peon, 3000, 60210), partidas: ['pa', 'pb', 'pc'] }];
    const r = simularDotacion({ manoObra: viejo, personal: peones(15), partidas, hoy: '2026-09-22' });
    expect(r.periodos[0].alcanceDisponible).toBe(false);
    expect(r.periodos[0].alcance).toEqual([]);
    // La brecha por cargo sí se puede contestar igual.
    expect(r.periodos[0].cargos[0].personasNecesarias).toBe(13.89);
  });

  it('sin las partidas cargadas ordena por HH y lo declara', () => {
    const r = simularDotacion({ manoObra: mo, personal: peones(7), hoy: '2026-09-22' });
    expect(r.periodos[0].alcanceOrdenadoPor).toBe('hh');
    expect(r.periodos[0].alcanceDisponible).toBe(true);
  });
});

describe('la dotación manual: simular una contratación sin registrarla', () => {
  const OCT = linea('2026-10', 'PEON', CODS.peon, 37081, 744115);

  it('pisa al padrón para ese cargo y período, y queda marcado', () => {
    const r = simularDotacion({
      manoObra: [OCT], personal: peones(15), hoy: '2026-09-22',
      dotacionManual: { peon: { '2026-10': 172 } },
    });
    const peon = r.periodos[0].cargos[0];
    expect(peon.personasDisponibles).toBe(172);
    expect(peon.dotacionManual).toBe(true);
    expect(peon.brechaPersonas).toBe(-0.33);
    expect(r.resumen.dotacionManual).toEqual(['peon']);
  });

  it('no toca los períodos que no se nombraron', () => {
    const r = simularDotacion({
      manoObra: [OCT, linea('2026-11', 'PEON', CODS.peon, 40216, 807135)],
      personal: peones(15), hoy: '2026-09-22',
      dotacionManual: { peon: { '2026-10': 172 } },
    });
    expect(r.periodos[0].cargos[0].personasDisponibles).toBe(172);
    expect(r.periodos[1].cargos[0].personasDisponibles).toBe(15);
    expect(r.periodos[1].cargos[0].dotacionManual).toBe(false);
  });
});

describe('las líneas de mano de obra que no se reconocen', () => {
  it('no se reparten entre los cargos conocidos: salen aparte con sus HH', () => {
    const r = simularDotacion({
      manoObra: [
        linea('2026-10', 'PEON', CODS.peon, 1000, 20070),
        linea('2026-10', 'BUZO CERTIFICADO', '999999', 400, 30000),
      ],
      personal: peones(15), hoy: '2026-09-22',
    });
    expect(r.periodos[0].cargos.length).toBe(1);
    expect(r.periodos[0].hhRequeridas).toBe(1000);
    expect(r.sinCargo).toEqual([{
      periodo: '2026-10', insumo_codigo: '999999', nombre: 'BUZO CERTIFICADO',
      unidad: 'hh', hh: 400, monto: 30000,
    }]);
    expect(r.resumen.lineasSinCargo).toBe(1);
    expect(r.resumen.hhSinCargo).toBe(400);
    // El total de mano de obra SÍ las incluye: la plata no desaparece.
    expect(r.resumen.hhTotalManoObra).toBe(1400);
    expect(r.resumen.hhRequeridas).toBe(1000);
  });
});

describe('el plan de contratación', () => {
  it('ordena por urgencia y redondea para arriba', () => {
    const r = simularDotacion({
      manoObra: [
        linea('2026-10', 'PEON', CODS.peon, 37081, 744115),
        linea('2026-11', 'PEON', CODS.peon, 40216, 807135),
        linea('2026-11', 'OPERARIO', CODS.operario, 10773, 304769),
      ],
      personal: [...peones(15), persona('op1', 'Operario')],
      hoy: '2026-09-22',
    });
    const plan = planDeContratacion(r);
    expect(plan.map(x => [x.periodo, x.cargo, x.faltan])).toEqual([
      ['2026-10', 'peon', 157],
      ['2026-11', 'peon', 187],   // noviembre tiene 25 días útiles, no 27
      ['2026-11', 'operario', 53],
    ]);
    expect(plan[0].avisarDesde).toBe('2026-10-01');
    expect(plan[0].hayHoy).toBe(15);
  });

  it('el mínimo deja afuera las brechas de menos de una persona', () => {
    const r = simularDotacion({
      manoObra: [linea('2026-10', 'PEON', CODS.peon, 3300, 66231)],
      personal: peones(15), hoy: '2026-09-22',
    });
    // 3.300 / 216 = 15,28 peones: falta 0,28.
    expect(r.periodos[0].cargos[0].brechaPersonas).toBe(0.28);
    expect(planDeContratacion(r)).toEqual([]);
    expect(planDeContratacion(r, { minimo: 0.1 }).length).toBe(1);
  });

  it('la fecha de aviso se adelanta al arranque del período', () => {
    expect(fechaDeAviso('2026-10', 15)).toBe('2026-09-16');
    expect(fechaDeAviso('2026-W41', 7)).toBe('2026-09-28');
    expect(fechaDeAviso('basura')).toBe('');
  });
});

describe('el resumen y el padrón que la pantalla tiene que poder decir', () => {
  const r = simularDotacion({
    manoObra: [
      linea('2026-10', 'PEON', CODS.peon, 37081, 744115),
      linea('2026-11', 'PEON', CODS.peon, 40216, 807135),
    ],
    personal: [
      ...peones(15),
      persona('op1', 'Operario'), persona('op2', 'Operario'),
      persona('of1', 'Oficial'), persona('mo1', 'Maestro de Obra'),
      persona('ing1', 'Ingeniero'),
      ...Array.from({ length: 29 }, (_, i) => persona(`s${i}`, 'Subcontrato MOSHCO', { subcontratista_id: 'sub' })),
    ],
    hoy: '2026-09-22',
  });

  it('declara que la oferta sale del padrón, no de horas trabajadas', () => {
    // `asistencia` tiene 0 filas: no hay con qué medir horas reales.
    expect(r.resumen.fuenteOferta).toBe('padron');
  });

  it('declara que esto no genera ningún registro (§5)', () => {
    expect(r.resumen.soloReferencia).toBe(true);
  });

  it('el padrón se explica entero: quién cuenta y por qué el resto no', () => {
    expect(r.padron.total).toBe(49);
    expect(r.padron.porCargo).toEqual([
      { cargo: 'peon', label: 'Peón', personas: 15 },
      { cargo: 'oficial', label: 'Oficial', personas: 1 },
      { cargo: 'operario', label: 'Operario', personas: 2 },
      { cargo: 'maestro', label: 'Maestro de obra', personas: 1 },
    ]);
    expect(r.padron.resumenSinEncajar).toEqual([
      { motivo: 'subcontrato', label: expect.any(String), personas: 29 },
      { motivo: 'cargo_no_obra', label: expect.any(String), personas: 1 },
    ]);
  });

  it('el acumulado por cargo dice dónde y cuánto es el peor mes', () => {
    const peon = r.cargos.find(c => c.cargo === 'peon');
    expect(peon.hhRequeridas).toBe(77297);
    expect(peon.periodos).toBe(2);
    expect(peon.periodosConBrecha).toBe(2);
    expect(peon.maxBrechaPeriodo).toBe('2026-11');
    expect(peon.enPadron).toBe(15);
  });

  it('la granularidad se deduce del período, no se pide dos veces', () => {
    expect(r.resumen.granularidad).toBe('mes');
    const sem = simularDotacion({
      manoObra: [linea('2026-W41', 'PEON', CODS.peon, 1000, 20070)],
      personal: peones(15), hoy: '2026-09-22',
    });
    expect(sem.resumen.granularidad).toBe('semana');
    expect(sem.resumen.periodoActual).toBe('2026-W39');
  });

  it('sin mano de obra no revienta ni devuelve NaN', () => {
    const vacio = simularDotacion({ manoObra: [], personal: [], hoy: '2026-09-22' });
    expect(vacio.periodos).toEqual([]);
    expect(vacio.cargos).toEqual([]);
    expect(vacio.resumen.cobertura).toBe(0);
    expect(vacio.resumen.hhRequeridas).toBe(0);
  });
});

describe('enganche con la tanda 1 — el reparto entra hecho, no se recalcula', () => {
  const partidas = [
    { id: 'p1', obra_id: 'o1', nombre_partida: 'EXCAVACION', fecha_inicio_planificada: '2026-10-01', fecha_fin_planificada: '2026-10-20' },
    { id: 'p2', obra_id: 'o1', nombre_partida: 'CONCRETO', fecha_inicio_planificada: '2026-10-05', fecha_fin_planificada: '2026-12-20' },
  ];
  const ip = (partida_id, nombre, codigo, hh, precio) => ({
    id: `ip-${partida_id}-${nombre}`, obra_id: 'o1', partida_id,
    tipo_insumo: 'mano_obra', nombre_insumo: nombre, unidad: 'hh',
    cantidad_presupuestada: hh, precio_presupuestado: precio,
    costo_presupuestado: hh * precio, insumo_codigo: codigo,
  });

  it('simularOrdenes reparte y simularDotacion convierte, sin tocar el cronograma', () => {
    const sim = simularOrdenes({
      insumosPartida: [
        ip('p1', 'PEON', CODS.peon, 2160, 20.07),
        ip('p2', 'PEON', CODS.peon, 6480, 20.07),   // tramo largo: 3 meses parejo
      ],
      partidas, anclaje: 'cero', hoy: '2026-09-22',
    });
    // Lo comprable queda vacío: la mano de obra nunca sale como propuesta.
    expect(sim.propuestas).toEqual([]);
    expect(sim.manoObra.map(m => [m.periodo, m.cantidad])).toEqual([
      ['2026-10', 4320], ['2026-11', 2160], ['2026-12', 2160],
    ]);

    const dot = simularDotacion({
      manoObra: sim.manoObra, partidas, personal: peones(15), hoy: '2026-09-22',
    });
    expect(dot.periodos.map(p => p.periodo)).toEqual(['2026-10', '2026-11', '2026-12']);
    // Octubre: 4.320 hh / 216 h = 20 peones exactos, hay 15.
    expect(dot.periodos[0].cargos[0].personasNecesarias).toBe(20);
    expect(dot.periodos[0].cargos[0].brechaPersonas).toBe(5);
    // Y el desglose por partida viaja entero desde la tanda 1.
    expect(dot.periodos[0].alcanceDisponible).toBe(true);
    expect(dot.periodos[0].alcance.map(a => a.partida_id)).toEqual(['p1', 'p2']);
  });

  it('el arrastre del anclaje «hoy» llega marcado hasta el cargo', () => {
    const sim = simularOrdenes({
      insumosPartida: [ip('pv', 'PEON', CODS.peon, 1000, 20.07)],
      partidas: [{ id: 'pv', obra_id: 'o1', fecha_inicio_planificada: '2026-07-01', fecha_fin_planificada: '2026-07-10' }],
      anclaje: 'hoy', hoy: '2026-09-22',
    });
    expect(sim.manoObra[0]).toMatchObject({ periodo: '2026-09', arrastrado: true });
    const dot = simularDotacion({ manoObra: sim.manoObra, personal: peones(15), hoy: '2026-09-22' });
    expect(dot.periodos[0].cargos[0].arrastrado).toBe(true);
    // Y el mes en curso rinde solo los días que quedan: 8 × 8 = 64 h.
    expect(dot.periodos[0].horasPorPersona).toBe(64);
    expect(dot.periodos[0].periodoParcial).toBe(true);
  });
});

describe('invariantes', () => {
  it('los cargos del padrón y los del presupuesto son la misma lista', () => {
    expect(CARGO_KEYS).toEqual(['peon', 'oficial', 'operario', 'operador_equipo', 'topografo', 'maestro', 'capataz']);
  });

  it('nada de lo que devuelve es un documento: no hay ids nuevos ni estados de alta', () => {
    const r = simularDotacion({
      manoObra: [linea('2026-10', 'PEON', CODS.peon, 1000, 20070)],
      personal: peones(15), hoy: '2026-09-22',
    });
    const json = JSON.stringify(r);
    for (const prohibido of ['"idempotency_key"', '"sync_status"', '"estado":"pendiente"', '"requisicion']) {
      expect(json).not.toContain(prohibido);
    }
  });
});
