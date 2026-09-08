// ═══════════════════════════════════════════════════════════════════
// DEL CV A LA FICHA (tanda 15, entrega 4).
//
// Los casos salen del CV REAL que trajo Gabriel el 8-set-2026 (39 páginas: 8
// de currículum nativo, 31 de constancias escaneadas): siete periodos cortos
// con la misma entidad, fechas como «09/04/2026» y «abril de 2013», un tipeo
// («26/07!2011») y constancias que certifican lo declarado —o no—.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  normalizarFechaCv, separarNombre, aPersona, aFicha, colegioDeProfesion,
  proponerRubro, mismaEntidad, emparejarConstancias, completarFichaConDocumentos,
  aFilaExperiencia, aFilasExperiencia, filaLimpia, verificarCv, armarFicha,
} from '../cv-extraccion.js';

const RUBROS = [
  { id: 'r-san', nombre: 'Saneamiento (agua y alcantarillado)', idempotency_key: 'rubro_saneamiento' },
  { id: 'r-edi', nombre: 'Edificaciones', idempotency_key: 'rubro_edificaciones' },
  { id: 'r-pis', nombre: 'Pistas y veredas', idempotency_key: 'rubro_pistas_veredas' },
  { id: 'r-via', nombre: 'Carreteras y obras viales', idempotency_key: 'rubro_viales' },
];

describe('normalizarFechaCv — las fechas como las escribe un CV peruano', () => {
  it('día/mes/año: «09/04/2026» es el 9 de abril, no el 4 de setiembre', () => {
    expect(normalizarFechaCv('09/04/2026')).toEqual({ iso: '2026-04-09', aproximada: false });
  });
  it('acepta el ISO que devuelve el modelo', () => {
    expect(normalizarFechaCv('2026-07-09').iso).toBe('2026-07-09');
  });
  it('«abril de 2013» es el 1 de abril, y queda marcada como aproximada', () => {
    expect(normalizarFechaCv('abril de 2013')).toEqual({ iso: '2013-04-01', aproximada: true });
    expect(normalizarFechaCv('Setiembre 2019').iso).toBe('2019-09-01');
  });
  it('un tipeo real del CV: «26/07!2011»', () => {
    expect(normalizarFechaCv('26/07!2011').iso).toBe('2011-07-26');
  });
  it('«a la fecha» / «actualidad» es null (sigue en curso)', () => {
    expect(normalizarFechaCv('a la fecha')).toBeNull();
    expect(normalizarFechaCv('Actualidad')).toBeNull();
  });
  it('una fecha imposible NO se inventa', () => {
    expect(normalizarFechaCv('31/02/2020')).toBeNull();
    expect(normalizarFechaCv('hola')).toBeNull();
    expect(normalizarFechaCv('')).toBeNull();
  });
  it('solo el año: primero de enero, aproximada', () => {
    expect(normalizarFechaCv('2015')).toEqual({ iso: '2015-01-01', aproximada: true });
  });
});

describe('separarNombre — dos apellidos al final', () => {
  it('«Jaime Nelson Ayay Valdez» → nombres «Jaime Nelson», apellidos «Ayay Valdez»', () => {
    expect(separarNombre('Jaime Nelson Ayay Valdez')).toEqual({ nombres: 'Jaime Nelson', apellidos: 'Ayay Valdez' });
  });
  it('con dos palabras, una y una; con una, va a nombres', () => {
    expect(separarNombre('Ana Pérez')).toEqual({ nombres: 'Ana', apellidos: 'Pérez' });
    expect(separarNombre('Ana')).toEqual({ nombres: 'Ana', apellidos: '' });
  });
});

describe('aPersona — la fila de personal', () => {
  it('nace SIN obra (mig 199) y como profesional', () => {
    const p = aPersona({ persona: { nombres: 'JAIME NELSON', apellidos: 'AYAY VALDEZ', dni: '40584979', celular: '997 623 121', email: 'X@Gmail.com' },
      ficha: { profesion: 'Ingeniero de Sistemas' } });
    expect(p.obra_id).toBeNull();
    expect(p.categoria).toBe('profesionales');
    expect(p.cargo).toBe('Ingeniero de Sistemas');
    expect(p.nombres).toBe('Jaime Nelson');
    expect(p.apellidos).toBe('Ayay Valdez');
    expect(p.dni).toBe('40584979');
    expect(p.email).toBe('x@gmail.com');
  });
  it('si falta el DNI pero hay RUC de persona natural (10 + DNI + dígito), lo deduce', () => {
    expect(aPersona({ persona: { nombres: 'A B', ruc: '10405849793' } }).dni).toBe('40584979');
  });
  it('un DNI que no tiene 8 dígitos no se guarda como DNI', () => {
    expect(aPersona({ persona: { nombres: 'A B', dni: '1234' } }).dni).toBeNull();
  });
  it('separa el nombre si el modelo lo devolvió junto', () => {
    const p = aPersona({ persona: { nombres: 'Jaime Nelson Ayay Valdez' } });
    expect(p.apellidos).toBe('Ayay Valdez');
  });
});

describe('aFicha — la ficha profesional', () => {
  it('colegio: CIP para ingenieros, CAP para arquitectos, si el modelo no lo dijo', () => {
    expect(colegioDeProfesion('Ingeniero Civil')).toBe('CIP');
    expect(colegioDeProfesion('Arquitecta')).toBe('CAP');
    expect(aFicha({ ficha: { profesion: 'Ingeniero de Sistemas', colegiatura_numero: '215585' } }).colegio).toBe('CIP');
  });
  it('capacitaciones: normaliza fechas y horas, deduplica por nombre', () => {
    const f = aFicha({ ficha: { capacitaciones: [
      { nombre: 'Contrataciones con El Estado', institucion: 'CORLAD', horas: '384', desde: '20 de enero de 2024', hasta: '27/03/2024' },
      { nombre: 'Contrataciones con el Estado', horas: 384 },
    ] } });
    expect(f.capacitaciones).toHaveLength(1);
    expect(f.capacitaciones[0]).toMatchObject({ horas: 384, desde: '2024-01-20', hasta: '2024-03-27' });
    expect(f.fuente).toBe('cv_ia');
  });
  it('el RUC vale si tiene 11 dígitos; la fecha de colegiatura se normaliza', () => {
    const f = aFicha({ ficha: { ruc: '10405849793', colegiatura_fecha: '15/03/2010' } });
    expect(f.ruc).toBe('10405849793');
    expect(f.colegiatura_fecha).toBe('2010-03-15');
  });
});

describe('proponerRubro — por palabras clave, y una persona confirma', () => {
  it('«MEJORAMIENTO DEL SERVICIO DE AGUA POTABLE Y ALCANTARILLADO» → saneamiento', () => {
    expect(proponerRubro('Mejoramiento del servicio de agua potable y alcantarillado en Chilete', RUBROS)?.id).toBe('r-san');
  });
  it('un mercado es una edificación; «pistas y veredas» gana sobre «calles»', () => {
    expect(proponerRubro('Mercado de abastos de Chilete', RUBROS)?.id).toBe('r-edi');
    expect(proponerRubro('Construcción de pistas y veredas en las calles del barrio', RUBROS)?.id).toBe('r-pis');
  });
  it('sin palabra clave no propone nada — eso lo decide la persona', () => {
    expect(proponerRubro('Facilitador Social para la Unidad de Sostenibilidad', RUBROS)).toBeNull();
    expect(proponerRubro('', RUBROS)).toBeNull();
  });
  it('un rubro que el admin borró no se propone', () => {
    expect(proponerRubro('carretera Cajamarca', RUBROS.filter(r => r.id !== 'r-via'))).toBeNull();
  });
});

describe('mismaEntidad — el mismo contratante escrito distinto', () => {
  it('«PROREGIÓN» dentro del nombre largo', () => {
    expect(mismaEntidad('Unidad Ejecutora de Programas Regionales - PROREGIÓN', 'PROREGION CAJAMARCA')).toBe(true);
  });
  it('el RUC manda cuando los dos lo tienen', () => {
    expect(mismaEntidad('A', 'B', '20491553791', '20491553791')).toBe(true);
    expect(mismaEntidad('PROREGION', 'PROREGION', '20491553791', '20601010098')).toBe(false);
  });
  it('dos palabras significativas compartidas alcanzan; una no', () => {
    expect(mismaEntidad('Consorcio Distribuidor de Tecnología S.A.C.', 'CDT Consorcio Distribuidor')).toBe(true);
    expect(mismaEntidad('Municipalidad Distrital de Llapa', 'Municipalidad Provincial de Cajamarca')).toBe(false);
  });
});

describe('emparejarConstancias — la pieza central', () => {
  const DECLARADAS = [
    { entidad: 'Unidad Ejecutora de Programas Regionales - PROREGIÓN', entidad_ruc: '20491553791', cargo: 'Facilitador Social', fecha_inicio: '2026-04-09', fecha_fin: '2026-07-09' },
    { entidad: 'Unidad Ejecutora de Programas Regionales - PROREGIÓN', entidad_ruc: '20491553791', cargo: 'Facilitador Social', fecha_inicio: '2025-05-01', fecha_fin: '2025-07-29' },
    { entidad: 'NISSI CONYSER S.R.L.', entidad_ruc: '20601010098', cargo: 'Gestor Social', fecha_inicio: '2022-04-08', fecha_fin: '2023-10-24' },
  ];
  const CONSTANCIAS = [
    { tipo: 'constancia_trabajo', pagina_desde: 12, emisor: 'PROREGION', emisor_ruc: '20491553791', cargo: 'Facilitador Social', fecha_inicio: '2025-05-01', fecha_fin: '2025-07-29' },
    { tipo: 'constancia_trabajo', pagina_desde: 15, emisor: 'NISSI CONYSER SRL', emisor_ruc: '20601010098', cargo: 'Gestor Social', fecha_inicio: '2022-04-08', fecha_fin: '2023-10-24', obra_nombre: 'Proyecto minero X' },
    { tipo: 'dni', pagina_desde: 30, dni: '40584979' },
  ];

  it('cada constancia sustenta UNA experiencia y le pone la página', () => {
    const r = emparejarConstancias(DECLARADAS, CONSTANCIAS);
    expect(r.experiencias[1].sustento_pagina).toBe(12);
    expect(r.experiencias[2].sustento_pagina).toBe(15);
    // La constancia completa lo que el CV no decía.
    expect(r.experiencias[2].obra_nombre).toBe('Proyecto minero X');
  });
  it('la experiencia declarada sin constancia queda SIN sustento — se ve, no se presenta', () => {
    const r = emparejarConstancias(DECLARADAS, CONSTANCIAS);
    expect(r.experiencias[0].sustento_pagina).toBeNull();
    expect(r.sinSustento).toBe(1);
  });
  it('siete periodos cortos con la misma entidad son SIETE experiencias: cada constancia va a la de fechas más cercanas', () => {
    const siete = Array.from({ length: 7 }, (_, i) => ({
      entidad: 'PROREGION', cargo: 'Facilitador', fecha_inicio: `202${Math.floor(i / 3)}-0${(i % 3) * 3 + 1}-01`, fecha_fin: `202${Math.floor(i / 3)}-0${(i % 3) * 3 + 2}-28`,
    }));
    const docs = siete.map((e, i) => ({ tipo: 'constancia_trabajo', pagina_desde: 20 + i, emisor: 'PROREGION', cargo: 'Facilitador', fecha_inicio: e.fecha_inicio, fecha_fin: e.fecha_fin }));
    const r = emparejarConstancias(siete, docs);
    expect(r.experiencias).toHaveLength(7);
    expect(r.experiencias.map(e => e.sustento_pagina)).toEqual([20, 21, 22, 23, 24, 25, 26]);
  });
  it('una constancia de un periodo que el CV NO declaraba se agrega como experiencia nueva, con sustento', () => {
    const r = emparejarConstancias(DECLARADAS, [
      { tipo: 'constancia_trabajo', pagina_desde: 18, emisor: 'ECOMG S.R.L.', cargo: 'Asistente administrativo', fecha_inicio: '2010-04-01', fecha_fin: '2011-07-26' },
    ]);
    expect(r.experiencias).toHaveLength(4);
    expect(r.nuevasDesdeConstancias).toBe(1);
    expect(r.experiencias[3]).toMatchObject({ entidad: 'ECOMG S.R.L.', sustento_pagina: 18, desde_constancia: true });
  });
  it('un DNI, un título o un curso NO sustentan experiencia', () => {
    const r = emparejarConstancias(DECLARADAS, [{ tipo: 'titulo', pagina_desde: 9 }, { tipo: 'certificado_curso', pagina_desde: 10, fecha_inicio: '2022-01-12' }]);
    expect(r.experiencias.every(e => e.sustento_pagina == null)).toBe(true);
    expect(r.experiencias).toHaveLength(3);
  });
  it('tolera 45 días de diferencia en las fechas (las constancias redondean)', () => {
    const r = emparejarConstancias(
      [{ entidad: 'X SAC', cargo: 'Residente', fecha_inicio: '2020-01-15', fecha_fin: '2020-06-30' }],
      [{ tipo: 'constancia_trabajo', pagina_desde: 3, emisor: 'X SAC', cargo: 'Residente', fecha_inicio: '2020-02-01', fecha_fin: '2020-08-05' }],
    );
    expect(r.experiencias[0].sustento_pagina).toBe(3);
  });
  it('la misma entidad en OTRO periodo lejano NO sustenta', () => {
    const r = emparejarConstancias(
      [{ entidad: 'X SAC', cargo: 'Residente', fecha_inicio: '2015-01-01', fecha_fin: '2015-06-30' }],
      [{ tipo: 'constancia_trabajo', pagina_desde: 3, emisor: 'X SAC', cargo: 'Residente', fecha_inicio: '2020-02-01', fecha_fin: '2020-08-05' }],
    );
    expect(r.experiencias[0].sustento_pagina).toBeNull();
    expect(r.experiencias).toHaveLength(2);          // la de 2020 entra como nueva
  });
});

describe('completarFichaConDocumentos — lo que las constancias dicen de la FICHA', () => {
  it('el diploma da la fecha de colegiatura; el certificado, hasta cuándo está hábil', () => {
    const { ficha } = completarFichaConDocumentos({ colegiatura_numero: null }, {}, [
      { tipo: 'diploma_colegiatura', colegiatura_numero: '215585', colegiatura_fecha: '12/05/2018' },
      { tipo: 'habilidad_colegio', habil_hasta: '31/12/2026' },
    ]);
    expect(ficha.colegiatura_numero).toBe('215585');
    expect(ficha.colegiatura_fecha).toBe('2018-05-12');
    expect(ficha.colegiatura_habil_hasta).toBe('2026-12-31');
  });
  it('no pisa lo que la ficha ya tenía', () => {
    const { ficha } = completarFichaConDocumentos({ colegiatura_fecha: '2010-01-01' }, {}, [{ tipo: 'diploma_colegiatura', colegiatura_fecha: '2018-05-12' }]);
    expect(ficha.colegiatura_fecha).toBe('2010-01-01');
  });
  it('el DNI escaneado llena el DNI que faltaba; la ficha RUC de persona natural también', () => {
    expect(completarFichaConDocumentos({}, { dni: null }, [{ tipo: 'dni', dni: '40584979' }]).persona.dni).toBe('40584979');
    expect(completarFichaConDocumentos({}, { dni: null }, [{ tipo: 'ruc', ruc: '10405849793' }]).persona.dni).toBe('40584979');
  });
  it('un certificado de curso agrega la capacitación o le pone la página a la ya declarada', () => {
    const { ficha } = completarFichaConDocumentos({ capacitaciones: [{ nombre: 'SIAF', horas: 120 }] }, {}, [
      { tipo: 'certificado_curso', pagina_desde: 22, curso_nombre: 'SIAF', curso_horas: 120 },
      { tipo: 'certificado_curso', pagina_desde: 23, curso_nombre: 'Power BI', curso_horas: 130 },
    ]);
    expect(ficha.capacitaciones).toHaveLength(2);
    expect(ficha.capacitaciones[0].sustento_pagina).toBe(22);
    expect(ficha.capacitaciones[1]).toMatchObject({ nombre: 'Power BI', sustento_pagina: 23 });
  });
});

describe('aFilaExperiencia — la fila de personal_experiencia', () => {
  it('normaliza fechas, propone rubro y marca la fuente', () => {
    const f = aFilaExperiencia({
      entidad: 'Municipalidad Distrital de Chilete', entidad_ruc: '20201594481',
      obra_nombre: 'Mejoramiento del servicio de agua potable', cargo: 'Residente de Obra',
      fecha_inicio: '09/04/2024', fecha_fin: '2024-12-31', monto: '1250000.50',
      fuente_pagina: 2, fuente_cita: 'Periodo: 09/04/2024', sustento_pagina: 14,
    }, { rubros: RUBROS });
    expect(f).toMatchObject({
      fecha_inicio: '2024-04-09', fecha_fin: '2024-12-31', monto: 1250000.5, moneda: 'PEN',
      rubro_id: 'r-san', fuente: 'cv_ia', fuente_pagina: 2, sustento_pagina: 14, obra_id: null,
    });
    expect(f._rubroPropuesto).toBe('Saneamiento (agua y alcantarillado)');
    expect(f._alertas).toEqual([]);
  });
  it('sin fecha de inicio legible se avisa, no se inventa', () => {
    const f = aFilaExperiencia({ entidad: 'X', fecha_inicio: 'hace tiempo' });
    expect(f.fecha_inicio).toBeNull();
    expect(f._alertas.join(' ')).toMatch(/sin fecha de inicio/);
  });
  it('una fecha aproximada (solo mes) se avisa', () => {
    expect(aFilaExperiencia({ fecha_inicio: 'abril de 2013' })._alertas.join(' ')).toMatch(/aproximada/);
  });
  it('filaLimpia quita lo que era solo de la pantalla', () => {
    const f = filaLimpia(aFilaExperiencia({ fecha_inicio: '2020-01-01' }));
    expect(Object.keys(f).some(k => k.startsWith('_'))).toBe(false);
    expect(f.fuente).toBe('cv_ia');
  });
  it('ordena de la más reciente a la más vieja', () => {
    const fs = aFilasExperiencia([{ fecha_inicio: '2010-01-01' }, { fecha_inicio: '2024-01-01' }]);
    expect(fs[0].fecha_inicio).toBe('2024-01-01');
  });
});

describe('verificarCv — la cita se comprueba contra el CV', () => {
  const MD = `<!-- página 2 -->
INSTITUCIÓN: Unidad Ejecutora de Programas Regionales - PROREGIÓN.
CARGO: Facilitador Social para Unidad de Sostenibilidad de la Inversión (USI)
Periodo: 09/04/2026 hasta el 09/07/2026

<!-- página 12 -->
<!-- página escaneada: pdf:p12 -->
CONSTANCIA DE TRABAJO
Que el Ing. JAIME NELSON AYAY VALDEZ laboró como FACILITADOR SOCIAL desde el 01/05/2025 hasta el 29/07/2025`;

  it('la experiencia con cita real queda verificada; la inventada, marcada', () => {
    const r = verificarCv({ experiencias: [
      { cargo: 'Facilitador Social', entidad: 'PROREGIÓN', fuente_pagina: 2, fuente_cita: 'Periodo: 09/04/2026 hasta el 09/07/2026' },
      { cargo: 'Gerente', entidad: 'Otra', fuente_pagina: 2, fuente_cita: 'Gerente General desde 2001 hasta 2010' },
    ] }, MD);
    expect(r.experiencias[0].verificada).toBe(true);
    expect(r.experiencias[1].verificada).toBe(false);
    expect(r.alertas.join(' ')).toMatch(/Gerente/);
  });
  it('la constancia también pasa por la aduana, aunque venga con errores de OCR', () => {
    const r = verificarCv({ documentos: [
      { tipo: 'constancia_trabajo', pagina_desde: 12, fuente_cita: 'laboro como facilitador social desde el 01/05/2025' },
    ] }, MD);
    expect(r.documentos[0].verificada).toBe(true);
  });
});

describe('armarFicha — todo junto', () => {
  const MD = `<!-- página 1 -->
Jaime Nelson Ayay Valdez
INGENIERO DE SISTEMAS
CIP : 215585
DNI : 40584979
INSTITUCIÓN: Unidad Ejecutora de Programas Regionales - PROREGIÓN.
CARGO: Facilitador Social
Periodo: 01/05/2025 hasta el 29/07/2025

<!-- página 12 -->
CONSTANCIA: laboró como Facilitador Social del 01/05/2025 al 29/07/2025`;

  it('devuelve persona, ficha y experiencias con sustento y alertas útiles', () => {
    const r = armarFicha({
      ficha: {
        persona: { nombres: 'Jaime Nelson', apellidos: 'Ayay Valdez', dni: '40584979' },
        ficha: { profesion: 'Ingeniero de Sistemas', colegiatura_numero: '215585' },
        experiencias: [{ entidad: 'Unidad Ejecutora de Programas Regionales - PROREGIÓN', cargo: 'Facilitador Social',
          fecha_inicio: '2025-05-01', fecha_fin: '2025-07-29', fuente_pagina: 1, fuente_cita: 'Periodo: 01/05/2025 hasta el 29/07/2025' }],
      },
      documentos: [{ tipo: 'constancia_trabajo', pagina_desde: 12, emisor: 'PROREGION', cargo: 'Facilitador Social',
        fecha_inicio: '2025-05-01', fecha_fin: '2025-07-29', fuente_cita: 'laboró como Facilitador Social del 01/05/2025 al 29/07/2025' }],
      markdown: MD, rubros: RUBROS,
    });
    expect(r.persona.dni).toBe('40584979');
    expect(r.ficha.colegio).toBe('CIP');
    expect(r.experiencias).toHaveLength(1);
    expect(r.experiencias[0].sustento_pagina).toBe(12);
    expect(r.experiencias[0]._verificada).toBe(true);
    expect(r.alertas.some(a => /sin constancia/.test(a))).toBe(false);
  });
  it('sin DNI avisa: sin DNI no se puede crear en el padrón', () => {
    const r = armarFicha({ ficha: { persona: { nombres: 'A B' }, ficha: {}, experiencias: [] }, documentos: [], markdown: '' });
    expect(r.alertas.join(' ')).toMatch(/DNI/);
    expect(r.alertas.join(' ')).toMatch(/profesión/);
  });
  it('tolera que la pasada de la ficha haya fallado (null)', () => {
    const r = armarFicha({ ficha: null, documentos: [{ tipo: 'constancia_trabajo', pagina_desde: 3, emisor: 'X', cargo: 'Y', fecha_inicio: '2020-01-01', fecha_fin: '2020-03-01' }], markdown: '' });
    expect(r.experiencias).toHaveLength(1);
    expect(r.experiencias[0].observaciones).toMatch(/constancia/);
  });
});
