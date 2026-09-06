import { describe, it, expect } from 'vitest';
import {
  CAJON, PISO_ACTIVO, UIT_POR_ANIO, umbralActivoFijo,
  clasificarLinea, candidatosActivo, candidatosPorEmpresa, claveLinea,
  cuentaPropuestaPorTexto,
} from '../recomendador-activos.js';

// Las líneas son TEXTUALES de producción (6-sep-2026).
const L = (descripcion, tipo_insumo, precio_unitario, extra = {}) =>
  ({ descripcion, tipo_insumo, precio_unitario, cantidad: 1, unidad: 'und', ...extra });

const cajonDe = (l) => clasificarLinea(l).cajon;

describe('umbral de 1/4 de UIT', () => {
  it('sale de la UIT del año', () => {
    expect(umbralActivoFijo(2025)).toBe(5350 / 4);
    expect(umbralActivoFijo(2026)).toBe(UIT_POR_ANIO[2026] / 4);
  });
  it('un año que no está usa el más nuevo, no explota', () => {
    expect(umbralActivoFijo(2099)).toBe(UIT_POR_ANIO[2026] / 4);
    expect(umbralActivoFijo(undefined)).toBeGreaterThan(0);
  });
  it('se puede pisar la tabla de UIT desde afuera', () => {
    expect(umbralActivoFijo(2026, { 2026: 4000 })).toBe(1000);
  });
});

// ── LOS CASOS QUE GABRIEL PIDIÓ CON NOMBRE PROPIO ──────────────────

describe('🔴 los equipos que Gabriel nombró', () => {
  it('los 3 generadores KAILI salen como ACTIVO, y están DEBAJO de 1/4 UIT', () => {
    for (const d of ['GENERADOR GASOLINERO KAILI 3800KW', 'GENERADOR KAILI 3800KW', 'GENERADOR DE 3800KW KAILI']) {
      expect(cajonDe(L(d, 'maquinaria', 1186.44)), d).toBe(CAJON.ACTIVO);
    }
    // El punto entero del diseño: si el filtro fuera el umbral, no aparecerían.
    expect(1186.44).toBeLessThan(umbralActivoFijo(2026));
  });

  it('el MARTILLO DEMOLEDOR, en sus dos versiones', () => {
    expect(cajonDe(L('MARTILLO DEMOLEDOR TOTAL 1700KW', 'maquinaria', 508.47))).toBe(CAJON.ACTIVO);
    expect(cajonDe(L('MARTILLO DEMOLEDOR SDS HEXAGONAL 1700W 45J 16KG INDUSTRIAL TOTAL', 'herramienta', 584.75)))
      .toBe(CAJON.ACTIVO);
  });

  it('la MOTO SSENDA de MOTOCORP, que estaba cargada como "material"', () => {
    expect(cajonDe(L('MOTO SSENDA JIMMY 150 1P57QMJ262600418 HZ2TCAKX9TZ260418', 'material', 4973.73)))
      .toBe(CAJON.ACTIVO);
  });
});

describe('🔴 lo que pasa el umbral y NO es un bien (11 de las 27 reales)', () => {
  const noSonBienes = [
    ['ANTICIPO DE CLIENTE', 67796.61],
    ['LIMPIEZA Y ACONDICIONAMIENTO DE LOCAL DE SAPARCON', 16949.15],
    ['COPIA Y ESCANEOS , PLOTEOS DE PLANOS', 6779.66],
    ['COPIAS Y ESCANEOS', 4237.29],
    ['ALOJAMIENTO DEL 13 LA 17 DE FEBRERO DE 2026', 3779.19],
    ['POR EL APOYO EN SERVICIOS METALICOS', 2800],
  ];
  it.each(noSonBienes)('«%s» (S/ %s) es GASTO, no activo', (d, pu) => {
    expect(cajonDe(L(d, 'material', pu))).toBe(CAJON.GASTO);
  });

  it('el THINNER en cilindro de 55 galones también', () => {
    expect(cajonDe(L('THINNER ACRÍLICO (CILINDRO 55 GAL) ANYPSA', 'material', 2012.71))).toBe(CAJON.GASTO);
    expect(cajonDe(L('THINNER ACRÍLICO (TAMBOR X 55 GLN)', 'material', 1537.80))).toBe(CAJON.GASTO);
  });

  it('«REPARACION DE NIVEL» viene tipado herramienta y NO es un activo', () => {
    // Caso real: un servicio mal tipado que la regla de herramienta+precio
    // habría propuesto como activo sin la lista de no-bienes.
    expect(cajonDe(L('REPARACION DE NIVEL', 'herramienta', 423.73))).toBe(CAJON.GASTO);
  });
});

describe('los bienes durables reales del grupo', () => {
  const activos = [
    ['ASPIRADORA INDUSTRIAL NILFISK VHS120 FM', 'material', 8560.25],
    ['Maquina Fotocopiadora 2do Uso Konica Minolta Bizhub C650I', 'material', 6186.44],
    ['LENOVO LOQ GEN 10 (15" INTEL) GEFORCE RTX SERIE 50', 'material', 5283.90],
    ['IMPRESORA MULTIFUNCIONAL EPSON WORKFORCE PRO WF-C5810', 'material', 4449.15],
    ['COMPRESORA DE AIRE 3HP 100L (MONOFÁSICA)', 'material', 3601.69],
    ['SAMSUNG GALAXY S25 ULTRA DE 512GB', 'material', 3367.80],
    ['ESCRITORIO DE MADERA 1.80 M X 0.80 M', 'material', 2542.37],
    ['VITRINA DE MADERA PARA DOCUMENTOS', 'material', 2500],
    ['REFRIGERADORA LG VT24BPY 24', 'material', 2385.51],
    ['VIBRADOR DE CONCRETO MANUAL MAKITA', 'material', 1567.80],
    ['MAQUINA DE SUBLIMACION MULTIFUNCIONAL 11 EN 1', 'material', 1398.31],
    ['NIVEL LASER DEWALT LINEAS CRUZADAS VERDE 20V', 'herramienta', 847.37],
    ['AMOLADORA ANGULAR ELECTRICA 4-1/2 1500W DWE4336 DEWALT', 'herramienta', 679],
    ['SIERRA CIRCULAR ELECTRICA 7-1/4" 1800W DWE575', 'herramienta', 550.76],
  ];
  it.each(activos)('«%s» es ACTIVO', (d, tipo, pu) => {
    expect(cajonDe(L(d, tipo, pu))).toBe(CAJON.ACTIVO);
  });
});

describe('🔴 colisiones de subcadena — el bug que cazó este test', () => {
  it('«fotoCOPIAdora» no puede caer por la palabra «copia»', () => {
    // Con includes() la fotocopiadora Konica de S/ 6.186 salía como GASTO.
    expect(cajonDe(L('Maquina Fotocopiadora 2do Uso Konica Minolta', 'material', 6186.44))).toBe(CAJON.ACTIVO);
    // Y «copias» de verdad sí tiene que caer.
    expect(cajonDe(L('COPIAS Y ESCANEOS', 'material', 4237.29))).toBe(CAJON.GASTO);
  });

  it('el plural sigue funcionando: escaneo→escaneos, ploteo→ploteos', () => {
    expect(cajonDe(L('PLOTEOS DE PLANOS A1', 'material', 3000))).toBe(CAJON.GASTO);
  });

  it('«motobomba» y «motocarga» entran por «moto», y eso está bien', () => {
    expect(cajonDe(L('MOTOBOMBA HONDA 3"', 'material', 2200))).toBe(CAJON.ACTIVO);
    expect(cajonDe(L('MOTOCARGA 3 RUEDAS', 'material', 5000))).toBe(CAJON.ACTIVO);
  });
});

describe('lo que nunca se propone como activo', () => {
  it('un SERVICIO, por caro que sea', () => {
    expect(cajonDe(L('POR EL SERVICIO DE TRANSPORTE DE CACHIMBA', 'servicio', 38135.59))).toBe(CAJON.GASTO);
  });
  it('EPP', () => {
    expect(cajonDe(L('CASCO DE SEGURIDAD 3M', 'epp', 457.63))).toBe(CAJON.GASTO);
  });
  it('un alquiler: usar no es tener', () => {
    expect(cajonDe(L('ALQUILER DE RETROEXCAVADORA A TODO COSTO', 'servicio', 5040))).toBe(CAJON.GASTO);
    expect(cajonDe(L('ALQUILER DE CAMIONETA INC/CHOFER Y COMBUSTIBLE', 'material', 9000))).toBe(CAJON.GASTO);
  });
  it('una herramienta barata: no se propone nada', () => {
    expect(cajonDe(L('LLAVE MIXTA 12MM', 'herramienta', 12))).toBe(CAJON.SIN_PROPUESTA);
  });
});

describe('material de obra a granel', () => {
  it('el cemento por bolsas se propone como INSUMO QUE SE TRANSFORMA', () => {
    expect(cajonDe(L('CEMENTO PORTLAND TIPO I 425 KG - PACASMAYO', 'material', 27.71, { cantidad: 750, unidad: 'BOLSA' })))
      .toBe(CAJON.TRANSFORMA);
  });
  it('el fierro por varillas también, por cantidad', () => {
    expect(cajonDe(L('VARILLA DE ACERO CORRUGADO DE 3/8', 'material', 16.40, { cantidad: 2124, unidad: 'und' })))
      .toBe(CAJON.TRANSFORMA);
  });
  it('las planchas metálicas del ejemplo de Gabriel', () => {
    expect(cajonDe(L('PLANCHA METALICA LAC 2.0MM', 'material', 180, { cantidad: 40, unidad: 'und' })))
      .toBe(CAJON.TRANSFORMA);
  });
});

describe('🔴 la disciplina: sin señal NO se inventa', () => {
  it('una línea rara y cara queda SIN PROPUESTA, no como gasto ni como activo', () => {
    // «ABRAZ. SIN FIN 8 M» a S/ 2.787 y cantidad 0,9 — caso real.
    expect(cajonDe(L('ABRAZ. SIN FIN 8 M', 'material', 2787.29, { cantidad: 0.9, unidad: 'und' })))
      .toBe(CAJON.SIN_PROPUESTA);
  });
  it('sin descripción no se opina', () => {
    expect(cajonDe(L('', 'material', 9999))).toBe(CAJON.SIN_PROPUESTA);
    expect(cajonDe({ precio_unitario: 9999 })).toBe(CAJON.SIN_PROPUESTA);
  });
  it('el piso evita proponer cosas chicas', () => {
    expect(cajonDe(L('TALADRO PERCUTOR', 'herramienta', PISO_ACTIVO - 1))).toBe(CAJON.SIN_PROPUESTA);
    expect(cajonDe(L('TALADRO PERCUTOR', 'herramienta', PISO_ACTIVO))).toBe(CAJON.ACTIVO);
  });
  it('null y basura no rompen', () => {
    expect(() => clasificarLinea(null)).not.toThrow();
    expect(() => clasificarLinea({ descripcion: 123 })).not.toThrow();
  });
});

describe('candidatosActivo — el barrido sobre los comprobantes', () => {
  const movConItems = (id, company_id, items, extra = {}) => ({
    id, company_id, type: 'cost', document_number: 'F001-1', date: '2026-05-01',
    notas: JSON.stringify({ items_factura: items }), ...extra,
  });

  const movs = [
    movConItems('m1', 'jarvex', [
      L('GENERADOR KAILI 3800KW', 'maquinaria', 1186.44),
      L('CEMENTO PORTLAND', 'material', 27, { cantidad: 100, unidad: 'bolsa' }),
    ], { obra_id: 'miraflores' }),
    movConItems('m2', 'gasomi', [L('NIVEL LASER DEWALT', 'herramienta', 847.37)]),
    movConItems('m3', 'jarvex', [L('ANTICIPO DE CLIENTE', 'material', 67796.61)]),
    { id: 'm4', company_id: 'jarvex', type: 'income', notas: '{}' },      // venta: fuera
    { id: 'm5', company_id: 'jarvex', type: 'cost', deleted_at: 'x', notas: '{}' },
  ];

  it('devuelve solo los candidatos a ACTIVO, con su índice de línea', () => {
    const c = candidatosActivo(movs);
    expect(c.map(x => x.descripcion)).toEqual(['GENERADOR KAILI 3800KW', 'NIVEL LASER DEWALT']);
    expect(c[0].item_idx).toBe(0);
  });

  it('ordena por precio unitario, lo más caro arriba', () => {
    const c = candidatosActivo(movs);
    expect(c[0].precio_unitario).toBeGreaterThan(c[1].precio_unitario);
  });

  it('acota por empresa', () => {
    expect(candidatosActivo(movs, { companyId: 'gasomi' }).map(x => x.movimiento_id)).toEqual(['m2']);
  });

  it('🔴 avisa cuando el bien YA es costo de una obra (doble conteo)', () => {
    const c = candidatosActivo(movs, { companyId: 'jarvex' });
    expect(c[0].yaEsCostoDeObra).toBe(true);
    expect(candidatosActivo(movs, { companyId: 'gasomi' })[0].yaEsCostoDeObra).toBe(false);
  });

  it('salta las líneas ya cargadas en activos fijos', () => {
    const ya = new Set([claveLinea('m1', 0)]);
    expect(candidatosActivo(movs, { yaCargados: ya }).map(x => x.movimiento_id)).toEqual(['m2']);
  });

  it('con soloActivos=false devuelve todas las líneas clasificadas', () => {
    const c = candidatosActivo(movs, { companyId: 'jarvex', soloActivos: false });
    expect(c.length).toBe(3);
    expect(c.map(x => x.cajon).sort()).toEqual(['activo_uso', 'gasto', 'transforma']);
  });

  it('ventas, borrados, notas ilegibles y listas vacías no rompen', () => {
    expect(candidatosActivo(null)).toEqual([]);
    expect(candidatosActivo([{ id: 'x', type: 'cost', notas: '{roto' }])).toEqual([]);
  });

  it('candidatosPorEmpresa cuenta el "hay N en otras empresas"', () => {
    const m = candidatosPorEmpresa(movs);
    expect(m.get('jarvex')).toBe(1);
    expect(m.get('gasomi')).toBe(1);
  });
});


describe('cuenta del PCGE propuesta — para que la fila llegue accionable', () => {
  const c = (d, t) => cuentaPropuestaPorTexto(d, t);
  it('la moto va a Unidades de transporte (33411) al 20%', () => {
    expect(c('MOTO SSENDA JIMMY 150')).toEqual({ cuenta: '33411', tasa: 20 });
  });
  it('las laptops y la fotocopiadora, a Equipos de procesamiento de datos (33611) al 25%', () => {
    expect(c('LENOVO LOQ GEN 10').cuenta).toBe('33611');
    expect(c('Maquina Fotocopiadora Konica Minolta').cuenta).toBe('33611');
    expect(c('IMPRESORA MULTIFUNCIONAL EPSON').cuenta).toBe('33611');
  });
  it('el celular, a Equipos de comunicación (33621)', () => {
    expect(c('SAMSUNG GALAXY S25 ULTRA').cuenta).toBe('33621');
  });
  it('los muebles, a Muebles y enseres (335) al 10%', () => {
    expect(c('ESCRITORIO DE MADERA')).toEqual({ cuenta: '335', tasa: 10 });
    expect(c('REFRIGERADORA LG').cuenta).toBe('335');
  });
  it('los generadores KAILI, a Maquinarias y equipos de explotación (333) al 20%', () => {
    expect(c('GENERADOR GASOLINERO KAILI 3800KW', 'maquinaria')).toEqual({ cuenta: '333', tasa: 20 });
  });
  it('las herramientas eléctricas, a Herramientas (337) al 10%', () => {
    expect(c('AMOLADORA ANGULAR DEWALT', 'herramienta')).toEqual({ cuenta: '337', tasa: 10 });
    expect(c('NIVEL LASER DEWALT', 'herramienta').cuenta).toBe('337');
  });
  it('lo que no pega en ninguna familia cae en Otros equipos (33691), no se inventa', () => {
    expect(c('APARATO RARO XYZ', 'material')).toEqual({ cuenta: '33691', tasa: 10 });
  });
  it('el tipo_insumo desempata cuando el texto no dice nada', () => {
    expect(c('EQUIPO SIN NOMBRE CLARO', 'herramienta').cuenta).toBe('337');
    expect(c('EQUIPO SIN NOMBRE CLARO', 'maquinaria').cuenta).toBe('333');
  });
  it('cada cuenta propuesta existe en el catálogo real del PCGE', async () => {
    const { CUENTAS_ACTIVO_FIJO } = await import('../activos-fijos.js');
    const validas = new Set(CUENTAS_ACTIVO_FIJO.map(x => x.codigo));
    for (const d of ['MOTO X', 'LENOVO', 'GALAXY', 'ESCRITORIO', 'GENERADOR', 'AMOLADORA', 'COSA RARA']) {
      expect(validas.has(c(d).cuenta), `${d} → ${c(d).cuenta}`).toBe(true);
    }
  });
});
