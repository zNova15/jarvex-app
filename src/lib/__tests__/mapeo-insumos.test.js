import { describe, it, expect } from 'vitest';
import {
  normMapeo, tokensDe, extraerMagnitudes, familiaDe, diametrosMm,
  prepararCatalogo, prepararLinea, puntuar, proponerFactor, sugerirMapeo,
  resolverMapeos, buscarMapeo, indicePorGrupo, cantidadCanonica, cobertura,
  claveMapeo, KG_POR_METRO, LARGO_VARILLA_M, UMBRAL_ALTO, UMBRAL_BAJO,
} from '../mapeo-insumos.js';

// ── Catálogo TEXTUAL del presupuesto de Miraflores (producción, 6-sep-2026).
const CAT = [
  { insumo_codigo: '210020001', nombre: 'CEMENTO PORTLAND TIPO I (42.5 kg)', unidad: 'bol', tipo: 'material', cantidad: 11269.2 },
  { insumo_codigo: '30020002',  nombre: 'ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60', unidad: 'kg', tipo: 'material', cantidad: 29856 },
  { insumo_codigo: '660020050', nombre: 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', unidad: 'm', tipo: 'material', cantidad: 14088.72 },
  { insumo_codigo: '660020049', nombre: 'TUBERIA PVC UF S25 DE 6"(160mm) x 6m ISO 4435', unidad: 'm', tipo: 'material', cantidad: 2887.13 },
  { insumo_codigo: '930020030', nombre: 'AGUA', unidad: 'm³', tipo: 'material', cantidad: 100 },
  { insumo_codigo: '430020006', nombre: 'MADERA TORNILLO 1"x 8"x8\'', unidad: 'p²', tipo: 'material', cantidad: 500 },
  { insumo_codigo: '40020006',  nombre: 'YESO BOLSA 10 kg', unidad: 'bol', tipo: 'material', cantidad: 80 },
  { insumo_codigo: '880020002', nombre: 'PLASTICO DOBLE ANCHO', unidad: 'm', tipo: 'material', cantidad: 200 },
  { insumo_codigo: '460020002', nombre: 'MALLA OLIMPICA GALVANIZADA N° 10', unidad: 'm²', tipo: 'material', cantidad: 300 },
  { insumo_codigo: '830020038', nombre: 'GUANTES ANTICORTE', unidad: 'par', tipo: 'material', cantidad: 40 },
  { insumo_codigo: '480020016', nombre: 'VIBRADOR DE CONCRETO 4 HP 1.35"', unidad: 'hm', tipo: 'equipo', cantidad: 157.4 },
  { insumo_codigo: '10020001',  nombre: 'PEON', unidad: 'hh', tipo: 'mano_obra', cantidad: 9000 },
];
const prep = prepararCatalogo(CAT);
const linea = (descripcion, unidad = 'und') => ({ descripcion, unidad });
const top = (d, u) => sugerirMapeo(linea(d, u), prep).candidatos[0];
const estado = (d, u) => sugerirMapeo(linea(d, u), prep).estado;

describe('normalización', () => {
  it('despega dígitos de letras para poder leer las magnitudes', () => {
    expect(normMapeo('TUBO 200mm x 6MT')).toBe('tubo 200 mm x 6 m');
  });
  it('«PVC-U» NO se convierte en «PVC unidad»', () => {
    // Fue un bug real: la «u» suelta estaba como sinónimo de unidad y rompía
    // el match del insumo más caro de la obra.
    expect(normMapeo('TUBO PVC-U 200 mm')).toContain('pvc u 200');
    expect(normMapeo('TUBO PVC-U 200 mm')).not.toContain('und');
  });
  it('las comillas de pulgada se leen como pulgadas', () => {
    expect(normMapeo('ANGULO DE 1/2"')).toContain('plg');
    expect(normMapeo("FIERRO 1/2'")).toContain('plg');
  });
  it('aplica sinónimos de obra (tubería≈tubo, fierro≈acero, varilla≈barra)', () => {
    expect(normMapeo('TUBERIA')).toBe('tubo');
    expect(normMapeo('VARILLA DE FIERRO')).toBe('barra de acero');
  });
  it('las unidades sueltas no son tokens: son magnitudes', () => {
    expect(tokensDe(normMapeo('ESCRITORIO 1.80 M'))).toEqual(['escritorio']);
  });
});

describe('magnitudes', () => {
  it('lee el entero más fracción del habla de obra', () => {
    expect(extraerMagnitudes(normMapeo('TUBO 1 1/2"')).plg).toEqual([1.5]);
  });
  it('una fracción sola son pulgadas', () => {
    expect(extraerMagnitudes(normMapeo('FIERRO DE 3/8')).plg).toEqual([0.375]);
  });
  it('separa diámetro, largo y presentación', () => {
    const m = extraerMagnitudes(normMapeo('TUBO 200mm x 6m BOLSA 42.5 kg'));
    expect(m.mm).toEqual([200]); expect(m.m).toEqual([6]); expect(m.kg).toEqual([42.5]);
  });
});

describe('familias', () => {
  it('un servicio que NOMBRA un material sigue siendo servicio', () => {
    // Existe en producción y sin esto competía por el código del cemento.
    expect(familiaDe(normMapeo('POR EL SERVICIO DE TRANSPORTE DE TUBO PVC Y CEMENTO'))).toBe('servicio');
  });
  it('un EPP de acero no es acero', () => {
    expect(familiaDe(normMapeo('GUANTE DE ACERO ANTICORTE DE MALLA METÁLICA'))).toBe('epp');
  });
  it('el lubricante de tubería no es tubería', () => {
    expect(familiaDe(normMapeo('LUBRICANTE P/TUBERIA PVC-UF'))).toBe('combustible');
  });
});

describe('diámetro nominal por familia', () => {
  it('en tubería 8" son 200 mm', () => {
    expect(diametrosMm(extraerMagnitudes(normMapeo('TUBERIA DE 8"')), 'tuberia_pvc').has(200)).toBe(true);
  });
  it('en acero corrugado 1/2" son 12,7 mm y NO 12', () => {
    // 12 mm y 1/2" son dos barras comerciales distintas: 0,888 vs 0,994 kg/m.
    const d = diametrosMm(extraerMagnitudes(normMapeo('FIERRO 1/2"')), 'acero_corrugado');
    expect(d.has(12.7)).toBe(true); expect(d.has(12)).toBe(false);
  });
  it('una pulgada sin tabla nominal se convierte de verdad (espesores de plancha)', () => {
    expect(diametrosMm(extraerMagnitudes(normMapeo('PLANCHA E=1/4"')), 'acero_estructural').has(6.35)).toBe(true);
  });
});

describe('los casos que mandan — medidos contra producción', () => {
  it('el insumo más caro: TUBO PVC-U 200 mm → la tubería de 8"', () => {
    const c = top('TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO');
    expect(c.cat.codigo).toBe('660020050');
    expect(estado('TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO')).toBe('propuesto');
  });
  it('el de 160 mm NO se va al de 200 mm', () => {
    expect(top('TUBO PVC-U 160 mm S-25 UF ALCANTARILLADO').cat.codigo).toBe('660020049');
  });
  it('el cemento pega con cualquier marca', () => {
    for (const d of ['CEMENTO PORTLAND TIPO I 425 KG - PACASMAYO-BOLSA',
                     'CEMENTO SOL / PACASMAYO TIPO I (42.5KG) PACASMAYO',
                     'CEMENTO HOLCIM TIPO I', 'CEMENTO INKA X 42.5 KG']) {
      expect(top(d).cat.codigo, d).toBe('210020001');
    }
  });
  it('el acero corrugado llega al código a granel aunque la factura no diga «fy»', () => {
    for (const d of ['VARILLA DE ACERO CORRUGADO DE 1/2', 'VARILLA DE ACERO CORRUGADO DE 3/8',
                     'FIERRO CORRUGADO DE 5/8 SIDER PERU X 9M']) {
      expect(top(d).cat.codigo, d).toBe('30020002');
    }
  });
  it('un servicio nunca propone un material', () => {
    const r = sugerirMapeo(linea('POR EL SERVICIO DE TRANSPORTE DE TUBO HOPE 100'), prep);
    expect(r.estado).toBe('servicio');
    expect(r.candidatos).toHaveLength(0);
  });
});

describe('falsos positivos que costaron plata y ya no pasan', () => {
  const noPropone = (d) => expect(estado(d), d).not.toBe('propuesto');
  it('«AGUA» (código de una sola palabra) no se lleva las cajas de PVC ni una lija', () => {
    // Con el puntaje anterior se llevaba S/ 20.648 con 77% de confianza.
    noPropone('CAJA Y MARCO Y TAPA PARA AGUA PVC');
    noPropone('LIJA AGUA ASA GRANO 150 DE 100 UND');
  });
  it('un escritorio no es madera rolliza', () => { noPropone('ESCRITORIO DE MADERA 1.80 M X 0.80 M'); });
  it('unas tinas no son «PLASTICO DOBLE ANCHO»', () => { noPropone('TINAS DE PLASTICO MEDIANAS'); });
  it('«PNATON EN BOLSA» no es yeso por decir «bolsa»', () => { noPropone('PNATON EN BOLSA X 900 GR'); });
  it('la malla de coco N°12 no es la malla olímpica N°10', () => { noPropone('malla n 12 coco 3 x 3'); });
  it('un guante de acero no compite con el acero corrugado', () => {
    const c = top('GUANTE DE ACERO ANTICORTE DE MALLA METÁLICA TALLA M');
    expect(c?.cat.codigo).not.toBe('30020002');
  });
  it('comprar un vibrador NO abastece horas-máquina de vibrador', () => {
    // Los 47 códigos `equipo` del presupuesto están en hm y los 5 de mano_obra
    // en hh: proponerlos haría contar dos veces el mismo costo.
    const cods = sugerirMapeo(linea('VIBRADOR DE CONCRETO MANUAL MAKITA'), prep)
      .candidatos.map(c => c.cat.codigo);
    expect(cods).not.toContain('480020016');
    expect(cods).not.toContain('10020001');
  });
  it('si dos candidatos empatan no hay propuesta, hay revisión', () => {
    // Pasa de verdad: el presupuesto trae códigos con el mismo nombre, y «TUBO»
    // a secas empata contra 37 tuberías. Elegir el primero sería inventar.
    const prepDos = prepararCatalogo([
      { insumo_codigo: 'A', nombre: 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', unidad: 'm', tipo: 'material', cantidad: 1 },
      { insumo_codigo: 'B', nombre: 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', unidad: 'm', tipo: 'material', cantidad: 1 },
    ]);
    const r = sugerirMapeo(linea('TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO'), prepDos);
    expect(r.ambiguo).toBe(true);
    expect(r.estado).toBe('revisar');
  });
});

describe('factor de conversión', () => {
  it('varillas → kilos por calibre, con la norma', () => {
    const cat = prep.items.find(c => c.codigo === '30020002');
    const f = proponerFactor(prepararLinea(linea('VARILLA DE ACERO CORRUGADO DE 1/2')), cat);
    expect(f.factor).toBeCloseTo(KG_POR_METRO[12.7] * LARGO_VARILLA_M, 3);   // 8,946 kg
    expect(f.fuente).toBe('supuesto');   // el largo de 9 m no lo dice la factura
  });
  it('1/2" y 12 mm dan factores DISTINTOS', () => {
    const cat = prep.items.find(c => c.codigo === '30020002');
    const a = proponerFactor(prepararLinea(linea('FIERRO CORRUGADO 1/2"')), cat).factor;
    const b = proponerFactor(prepararLinea(linea('FIERRO CORRUGADO 12MM')), cat).factor;
    expect(a).not.toBeCloseTo(b, 2);
  });
  it('si la factura dice el largo, manda la factura y no el supuesto', () => {
    const cat = prep.items.find(c => c.codigo === '30020002');
    const f = proponerFactor(prepararLinea(linea('FIERRO CORRUGADO DE 5/8 SIDER PERU X 9M')), cat);
    expect(f.fuente).toBe('descripcion');
  });
  it('tubos por unidad → metros, con el largo del presupuesto si falta el de la factura', () => {
    const cat = prep.items.find(c => c.codigo === '660020050');
    const f = proponerFactor(prepararLinea(linea('TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO')), cat);
    expect(f.factor).toBe(6);
    expect(f.fuente).toBe('supuesto');
  });
  it('cuando no sabe, lo dice — no inventa un 1', () => {
    const cat = prep.items.find(c => c.codigo === '930020030');   // AGUA, en m³
    const f = proponerFactor(prepararLinea(linea('BIDON DE AGUA', 'und')), cat);
    expect(f.factor).toBeNull();
  });
  it('la cantidad canónica es null si falta el factor (no un 0 silencioso)', () => {
    expect(cantidadCanonica(10, null)).toBeNull();
    expect(cantidadCanonica(10, 8.946)).toBeCloseTo(89.46, 2);
  });
});

describe('memoria: lo manual manda y no se vuelve a preguntar', () => {
  const fila = (o) => ({ norm: 'tubo pvc u 200 mm', decision: 'mapeado', demo: false, ...o });
  it('manual > ia > regla', () => {
    const m = resolverMapeos([
      fila({ id: '1', fuente: 'regla', insumo_codigo: 'X', updated_at: '2026-09-06T10:00:00Z' }),
      fila({ id: '2', fuente: 'ia', insumo_codigo: 'Y', updated_at: '2026-09-06T09:00:00Z' }),
      fila({ id: '3', fuente: 'manual', insumo_codigo: 'Z', updated_at: '2026-09-06T08:00:00Z' }),
    ]);
    expect(m.get('tubo pvc u 200 mm').insumo_codigo).toBe('Z');
  });
  it('a igual fuente gana la más reciente', () => {
    const m = resolverMapeos([
      fila({ id: '1', fuente: 'manual', insumo_codigo: 'VIEJO', updated_at: '2026-09-01T00:00:00Z' }),
      fila({ id: '2', fuente: 'manual', insumo_codigo: 'NUEVO', updated_at: '2026-09-06T00:00:00Z' }),
    ]);
    expect(m.get('tubo pvc u 200 mm').insumo_codigo).toBe('NUEVO');
  });
  it('las filas borradas y las del modo prueba no se mezclan', () => {
    expect(resolverMapeos([fila({ id: '1', fuente: 'manual', insumo_codigo: 'X', deleted_at: '2026-09-06' })]).size).toBe(0);
    expect(resolverMapeos([fila({ id: '1', fuente: 'manual', insumo_codigo: 'X', demo: true })]).size).toBe(0);
    expect(resolverMapeos([fila({ id: '1', fuente: 'manual', insumo_codigo: 'X', demo: true })], { demo: true }).size).toBe(1);
  });
  it('«no aplica» también se recuerda: es media base y no puede volver a preguntarse', () => {
    const m = resolverMapeos([fila({ id: '1', fuente: 'manual', decision: 'no_aplica', insumo_codigo: null })]);
    expect(m.get('tubo pvc u 200 mm').decision).toBe('no_aplica');
  });
});

describe('la decisión se hereda entre nombres ya correlacionados', () => {
  const CRUDO_A = 'VARILLA DE ACERO CORRUGADO DE 1/2';
  const CRUDO_B = "FIERRO CORRUGADO 1/2' (NTP 341.031) SIDERPERU";
  // Grupos en el espacio de normInsumo (así los arma insumo-correlacion.js).
  const grupoDe = new Map([
    ['varilla de acero corrugado de 1 2', 'g1'],
    ['fierro corrugado 1 2 ntp 341 031 siderperu', 'g1'],
  ]);
  const mapeos = resolverMapeos([{
    id: '1', norm: claveMapeo(CRUDO_A), decision: 'mapeado', insumo_codigo: '30020002',
    fuente: 'manual', factor: 8.946, demo: false,
  }]);
  const porGrupo = indicePorGrupo(mapeos, [{ descripcion: CRUDO_A }, { descripcion: CRUDO_B }], grupoDe);

  it('el nombre decidido se encuentra directo', () => {
    const h = buscarMapeo(CRUDO_A, mapeos, grupoDe, porGrupo);
    expect(h.fila.insumo_codigo).toBe('30020002');
    expect(h.heredado).toBe(false);
  });
  it('su hermano lo hereda y NO se vuelve a preguntar', () => {
    const h = buscarMapeo(CRUDO_B, mapeos, grupoDe, porGrupo);
    expect(h.fila.insumo_codigo).toBe('30020002');
    expect(h.heredado).toBe(true);
  });
  it('un nombre de otro grupo no hereda nada', () => {
    expect(buscarMapeo('CEMENTO HOLCIM TIPO I', mapeos, grupoDe, porGrupo)).toBeNull();
  });
  it('sin grupos no explota', () => {
    expect(buscarMapeo(CRUDO_B, mapeos, null, null)).toBeNull();
    expect(indicePorGrupo(mapeos, [{ descripcion: CRUDO_A }], null).size).toBe(0);
  });
});

describe('cobertura', () => {
  it('cuenta el importe mapeado, y los servicios aparte', () => {
    const mapeos = resolverMapeos([{
      id: '1', norm: claveMapeo('CEMENTO HOLCIM TIPO I'), decision: 'mapeado',
      insumo_codigo: '210020001', fuente: 'manual', demo: false,
    }]);
    const r = cobertura([
      { descripcion: 'CEMENTO HOLCIM TIPO I', importe: 100 },
      { descripcion: 'SERVICIO DE TRANSPORTE', importe: 300 },
      { descripcion: 'LENOVO LOQ GEN 10', importe: 600 },
    ], mapeos);
    expect(r.mapeadas).toBe(1);
    expect(r.importeMapeado).toBe(100);
    expect(r.servicios).toBe(1);
    expect(r.importeServicios).toBe(300);
    expect(r.pct).toBeCloseTo(0.1, 5);
  });
});

describe('umbrales', () => {
  it('el alto está por encima del bajo y los dos entre 0 y 1', () => {
    expect(UMBRAL_BAJO).toBeGreaterThan(0);
    expect(UMBRAL_ALTO).toBeGreaterThan(UMBRAL_BAJO);
    expect(UMBRAL_ALTO).toBeLessThan(1);
  });
  it('un puntaje de 0 nunca entra como candidato', () => {
    const l = prepararLinea(linea('LENOVO LOQ GEN 10 GEFORCE RTX'));
    const cat = prep.items.find(c => c.codigo === '210020001');
    expect(puntuar(l, cat, prep.idf).score).toBe(0);
  });
});
