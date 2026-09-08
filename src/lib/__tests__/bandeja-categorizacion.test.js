// ═══════════════════════════════════════════════════════════════════
// LA BANDEJA QUE APRENDE (tanda 14, entrega 4) — lib pura.
//
// Los casos son los MEDIDOS contra producción el 7-set-2026, con sus nombres
// reales: si mañana alguien afloja el motor o toca la normalización, estos
// tests dicen exactamente qué se rompió y cuánta plata había atrás.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { normMapeo } from '../mapeo-insumos.js';
import {
  catalogoParaProponer, indiceDePropuestas, resolverCategorias,
  agruparDescripciones, filasDeBandeja, lotesPorPropuesta, resumenAvance,
  decisionDeCatalogo, decisionNoInsumo, filaNuevaDeCatalogo, familiaComercialDe,
  aprendizajeParaContadora,
} from '../bandeja-categorizacion.js';

const cat = (id, nombre, unidad, familia, tipo = 'insumo', extra = {}) => ({
  id, nombre, norm: normMapeo(nombre), unidad, familia, tipo,
  origen: 'xlsx', activo: true, company_id: null, ...extra,
});

// Un pedazo del catálogo real de Gabriel (los nombres son textuales).
const CATALOGO = [
  cat('c1', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bolsa', 'ferreteria'),
  cat('c2', 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', 'm', 'tuberia_accesorios'),
  cat('c3', 'TUBERIA PVC UF S25 DE 6"(160mm) x 6m ISO 4435', 'm', 'tuberia_accesorios'),
  cat('c4', 'GUANTES ANTICORTE', 'par', 'seguridad'),
  cat('c5', 'ZAPATOS PUNTA DE ACERO', 'par', 'seguridad'),
  cat('c6', 'ALQUILER DE CAMIONETA 4X4', 'mes', 'servicios', 'servicio'),
  cat('c7', 'EXAMENES MÉDICOS OCUPACIONALES', 'und', 'servicios', 'servicio'),
];

// El acero corrugado, que la entrega 2 dejó SOLO en la disgregación.
const DISGREGACION = ['1/4', '3/8', '1/2', '5/8'].map((p, i) => ({
  id: `d${i}`, activo: true, company_id: null,
  padre_nombre: 'ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60',
  padre_norm: normMapeo('ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60'),
  padre_unidad: 'kg',
  hijo_nombre: `ACERO CORRUGADO DE ${p}"x9m`,
  hijo_norm: normMapeo(`ACERO CORRUGADO DE ${p}"x9m`),
  hijo_unidad: 'var',
}));

const compra = (nombre, importe, opts = {}) => ({
  nombre, clase: 'compra', cantidad: 1, precio: importe,
  unidad: opts.unidad || 'und', moneda: opts.moneda || 'PEN',
  proveedorNombre: opts.prov || 'PROVEEDOR SA', companyId: opts.companyId || 'e1',
});

const armar = (compras, { catalogo = CATALOGO, disg = DISGREGACION, decisiones = new Map() } = {}) => {
  const filasCat = catalogoParaProponer(catalogo, disg, { companyId: null });
  const { prep, porId } = indiceDePropuestas(filasCat);
  const filas = filasDeBandeja(agruparDescripciones(compras), { prep, porId, decisiones });
  return { filas, porId, filasCat };
};

describe('el catálogo contra el que se propone', () => {
  it('🔴 suma el acero corrugado, que vive SOLO en la disgregación', () => {
    // Es el insumo más caro de la obra —S/ 88.000 en varillas— y hasta la mig
    // 195 no tenía NINGUNA fila en catalogo_insumos contra la cual proponerse.
    const filas = catalogoParaProponer(CATALOGO, DISGREGACION, { companyId: null });
    const nombres = filas.map(f => f.nombre);
    expect(nombres).toContain('ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60');
    expect(nombres).toContain('ACERO CORRUGADO DE 1/2"x9m');
    // El padre se repite en las 4 filas de disgregación: no puede entrar 4 veces.
    expect(nombres.filter(n => n === 'ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60')).toHaveLength(1);
    expect(filas).toHaveLength(CATALOGO.length + 5);
  });

  it('no duplica cuando la migración ya metió la fila en el catálogo', () => {
    const conAcero = [...CATALOGO, cat('c9', 'ACERO CORRUGADO DE 1/2"x9m', 'var', 'ferreteria')];
    const filas = catalogoParaProponer(conAcero, DISGREGACION, { companyId: null });
    expect(filas.filter(f => f.nombre === 'ACERO CORRUGADO DE 1/2"x9m')).toHaveLength(1);
    // Y gana la del catálogo de verdad, no la derivada.
    expect(filas.find(f => f.nombre === 'ACERO CORRUGADO DE 1/2"x9m').id).toBe('c9');
  });

  it('no mira la disgregación de otra entidad', () => {
    const ajena = DISGREGACION.map(d => ({ ...d, company_id: 'otra' }));
    expect(catalogoParaProponer(CATALOGO, ajena, { companyId: null })).toHaveLength(CATALOGO.length);
  });
});

describe('las propuestas contra el catálogo canónico', () => {
  it('la marca no mata el match — el caso que hacía inservible a buscarCatalogo', () => {
    const { filas } = armar([compra('CEMENTO PORTLAND TIPO I 42.5 KG - PACASMAYO-BOLSA', 62352)]);
    expect(filas[0].estado).toBe('propuesto');
    expect(filas[0].sug.candidatos[0].cat.nombre).toBe('CEMENTO PORTLAND TIPO I (42.5 kg)');
  });

  it('el tubo más caro de la obra encuentra su fila pese a no compartir ni el token principal', () => {
    const { filas } = armar([compra('TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO', 44850)]);
    expect(filas[0].estado).toBe('propuesto');
    expect(filas[0].sug.candidatos[0].cat.nombre).toContain('200mm');
  });

  it('🔴 el EPP del catálogo está en PLURAL y la factura en singular', () => {
    // Sin la `s?` en la regex de FAMILIAS, «GUANTES ANTICORTE» daba familia
    // `otro`, la línea daba `epp`, y el castigo de 0,7 lo hundía.
    const { filas } = armar([compra('GUANTE DE ACERO ANTICORTE DE MALLA METÁLICA TALLA M', 31109)]);
    expect(filas[0].sug.candidatos[0]?.cat.nombre).toBe('GUANTES ANTICORTE');
  });

  it('🔴 los servicios del catálogo SE PROPONEN (son el 21% del gasto medido)', () => {
    const { filas } = armar([compra('ALQUILER DE CAMIONETA 4X4 POR EL MES DE JUNIO', 8000)]);
    expect(filas[0].estado).toBe('propuesto');
    expect(filas[0].sug.candidatos[0].cat.nombre).toBe('ALQUILER DE CAMIONETA 4X4');
  });

  it('un servicio que la regex no sabe leer igual pega, porque el catálogo lo AFIRMA', () => {
    // «EXAMENES MEDICOS OCUPACIONALES» no tiene ninguna palabra de la lista de
    // servicios: su familia queda en `otro`, y esa duda no debe bloquear.
    const { filas } = armar([compra('EXAMENES MEDICOS OCUPACIONALES DEL PERSONAL', 3000)]);
    expect(filas[0].sug.candidatos[0]?.cat.nombre).toBe('EXAMENES MÉDICOS OCUPACIONALES');
  });

  it('lo que no está en el catálogo cae en «falta», no en una propuesta inventada', () => {
    const { filas } = armar([compra('LENOVO LOQ GEN 10 (15" INTEL) GEFORCE RTX SERIE 50', 21136)]);
    expect(filas[0].estado).toBe('falta');
    expect(filas[0].sug.candidatos).toHaveLength(0);
  });

  it('un diámetro que contradice descarta: 6" no es 8"', () => {
    const { filas } = armar([compra('TUBO PVC-U 160 mm S-25 UF ALCANTARILLADO', 6503)]);
    expect(filas[0].sug.candidatos[0].cat.nombre).toContain('160mm');
  });
});

describe('los lotes', () => {
  it('agrupa las formas distintas de escribir el mismo acero', () => {
    const { filas } = armar([
      compra('VARILLA DE ACERO CORRUGADO DE 5/8', 11143),
      compra('FIERRO CORRUGADO DE 5/8 SIDER PERU X 9M', 9661),
      compra('CEMENTO PORTLAND TIPO I 42.5 KG - PACASMAYO-BOLSA', 62352),
    ]);
    const lotes = lotesPorPropuesta(filas);
    const acero = lotes.find(g => g.nombre.includes('5/8'));
    expect(acero.filas).toHaveLength(2);
    expect(Math.round(acero.importe)).toBe(20804);
  });

  it('🔴 NO mete las dudosas en el lote: era como se envenenaba', () => {
    // Medido: «PNATON EN BOLSA X 900 GR» pegaba con «YESO BOLSA 10 kg» al 51%.
    // Aceptar el lote de un golpe habría guardado una respuesta inventada.
    const conYeso = [...CATALOGO, cat('cy', 'YESO BOLSA 10 kg', 'bolsa', 'ferreteria')];
    const { filas } = armar([
      compra('YESO X BLSA X 7 KG', 59),
      compra('PNATON EN BOLSA X 900 GR', 6864),
    ], { catalogo: conYeso });
    const enLote = lotesPorPropuesta(filas).flatMap(g => g.filas.map(f => f.muestra));
    expect(enLote).not.toContain('PNATON EN BOLSA X 900 GR');
  });

  it('un grupo de uno no es un lote', () => {
    const { filas } = armar([compra('CEMENTO PORTLAND TIPO I 42.5 KG - PACASMAYO-BOLSA', 62352)]);
    expect(lotesPorPropuesta(filas)).toHaveLength(0);
  });
});

describe('el agrupado por descripción', () => {
  it('la misma descripción en varias facturas es UNA fila, y suma', () => {
    const { filas } = armar([
      compra('CEMENTO PORTLAND TIPO I 42.5 KG - PACASMAYO-BOLSA', 20000, { prov: 'A' }),
      compra('cemento portland tipo i 42.5 kg - pacasmayo-bolsa', 42352, { prov: 'B' }),
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0].veces).toBe(2);
    expect(Math.round(filas[0].importe)).toBe(62352);
    expect(filas[0].provs.size).toBe(2);
  });

  it('🔴 los dólares SE VEN pero NO se suman al total (decisión de Gabriel)', () => {
    const { filas } = armar([
      compra('MEDIDOR CHORRO MULTIPLE DE 1/2"', 100, { moneda: 'PEN' }),
      compra('MEDIDOR CHORRO MULTIPLE DE 1/2"', 900, { moneda: 'USD' }),
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0].veces).toBe(2);                    // se VE que hay dos
    expect(filas[0].importe).toBe(100);                // pero solo suman los soles
    expect([...filas[0].monedas]).toContain('USD');    // y queda el marcador
  });

  it('las ventas no entran', () => {
    const { filas } = armar([{ ...compra('CEMENTO', 100), clase: 'venta' }]);
    expect(filas).toHaveLength(0);
  });
});

describe('las decisiones ya tomadas', () => {
  const fila = { norm: 'x', muestra: 'X', unidades: new Set(['und']) };

  it('«manual» pisa a «regla», y a igual fuente gana la más reciente', () => {
    const m = resolverCategorias([
      { norm: 'a', fuente: 'regla', decision: 'catalogo', catalogo_insumo_id: 'r', updated_at: '2026-09-09' },
      { norm: 'a', fuente: 'manual', decision: 'catalogo', catalogo_insumo_id: 'm', updated_at: '2026-09-01' },
      { norm: 'b', fuente: 'manual', decision: 'catalogo', catalogo_insumo_id: 'v', updated_at: '2026-09-01' },
      { norm: 'b', fuente: 'manual', decision: 'catalogo', catalogo_insumo_id: 'n', updated_at: '2026-09-08' },
    ]);
    expect(m.get('a').catalogo_insumo_id).toBe('m');
    expect(m.get('b').catalogo_insumo_id).toBe('n');
  });

  it('lo de la entidad pesa más que lo general', () => {
    const m = resolverCategorias([
      { norm: 'a', fuente: 'manual', company_id: null, catalogo_insumo_id: 'gen', updated_at: '2026-09-09' },
      { norm: 'a', fuente: 'regla', company_id: 'e1', catalogo_insumo_id: 'suyo', updated_at: '2026-09-01' },
    ], { companyId: 'e1' });
    expect(m.get('a').catalogo_insumo_id).toBe('suyo');
  });

  it('no mezcla el modo prueba con el real', () => {
    const filas = [{ norm: 'a', fuente: 'manual', demo: true, catalogo_insumo_id: 'd' }];
    expect(resolverCategorias(filas, { demo: false }).size).toBe(0);
    expect(resolverCategorias(filas, { demo: true }).size).toBe(1);
  });

  it('una descripción decidida sale de la lista de pendientes', () => {
    const decisiones = new Map([[normMapeo('CEMENTO PORTLAND TIPO I 42.5 KG - PACASMAYO-BOLSA'),
      { decision: 'catalogo', catalogo_insumo_id: 'c1', familia: 'ferreteria' }]]);
    const { filas } = armar([compra('CEMENTO PORTLAND TIPO I 42.5 KG - PACASMAYO-BOLSA', 62352)], { decisiones });
    expect(filas[0].estado).toBe('decididas');
    expect(filas[0].cat.nombre).toBe('CEMENTO PORTLAND TIPO I (42.5 kg)');
  });

  it('el cuerpo de «no es un insumo» no lleva insumo (lo exige el CHECK de la mig 195)', () => {
    const d = decisionNoInsumo(fila);
    expect(d.decision).toBe('no_insumo');
    expect(d.catalogo_insumo_id).toBeNull();
    expect(d.familia).toBeNull();
  });

  it('el factor solo se guarda cuando las unidades DIFIEREN de verdad', () => {
    const enKg = { ...fila, unidades: new Set(['kg']) };
    const catFila = { id: 'c1', nombre: 'ACERO', unidad: 'var', familia: 'ferreteria' };
    expect(decisionDeCatalogo(enKg, catFila, { factor: 8.946, factorFuente: 'tabla' }).factor).toBe(8.946);
    // Misma unidad escrita distinto ('UNIDAD' vs 'und') NO es una diferencia.
    const enUnd = { ...fila, unidades: new Set(['UNIDAD']) };
    expect(decisionDeCatalogo(enUnd, { ...catFila, unidad: 'und' }, { factor: 3, factorFuente: 'tabla' }).factor).toBeNull();
  });

  it('la familia se CONGELA al decidir', () => {
    const d = decisionDeCatalogo(fila, { id: 'c4', nombre: 'GUANTES ANTICORTE', unidad: 'par', familia: 'seguridad' });
    expect(d.familia).toBe('seguridad');
  });
});

describe('el alta al catálogo desde la bandeja', () => {
  it('propone nombre, unidad y familia — si hubiera que escribir todo, nadie lo usaría', () => {
    const f = { norm: 'x', muestra: 'plancha negra lisa 1/2 x 1.20 x 2.40mt.', unidades: new Set(['UNIDAD']), importe: 14119, veces: 1 };
    const nueva = filaNuevaDeCatalogo(f);
    expect(nueva.nombre).toBe('PLANCHA NEGRA LISA 1/2 X 1.20 X 2.40MT.');
    expect(nueva.familia).toBe('perfiles_metalicos');   // la regla del motor: es acero estructural
    expect(nueva.unidad).toBe('und');                   // normalizada
    expect(nueva.norm).toBe(normMapeo(nueva.nombre));
    // 'manual' y no 'xlsx': reimportar el archivo NO puede pisarla ni marcarla
    // como ausente.
    expect(nueva.origen).toBe('manual');
  });

  it('un servicio nuevo nace como servicio, no como insumo', () => {
    const f = { norm: 'x', muestra: 'servicio de transporte de tubo de chiclayo a cajamarca', unidades: new Set(['und']) };
    const nueva = filaNuevaDeCatalogo(f);
    expect(nueva.familia).toBe('servicios');
    expect(nueva.tipo).toBe('servicio');
  });

  it('la familia comercial se deduce de la regla del motor, y «otros» cuando no sabe', () => {
    expect(familiaComercialDe('VARILLA DE ACERO CORRUGADO DE 3/8')).toBe('ferreteria');
    expect(familiaComercialDe('VALVULA COMPUERTA DE BRONCE DE 2"')).toBe('valvulas');
    expect(familiaComercialDe('MADERA TORNILLO PARA ENCOFRADO')).toBe('madera');
    expect(familiaComercialDe('CASCO DE SEGURIDAD')).toBe('seguridad');
    expect(familiaComercialDe('BAC DOBHAM MCPOL 6N')).toBe('otros');
  });
});

describe('el avance', () => {
  it('se mide en PLATA, no en filas', () => {
    const decisiones = new Map([[normMapeo('CEMENTO PORTLAND TIPO I 42.5 KG - PACASMAYO-BOLSA'),
      { decision: 'catalogo', catalogo_insumo_id: 'c1' }]]);
    const { filas } = armar([
      compra('CEMENTO PORTLAND TIPO I 42.5 KG - PACASMAYO-BOLSA', 9000),
      compra('CHIRIMOYA', 500),
      compra('GASEOSA 1 LITRO', 500),
    ], { decisiones });
    const r = resumenAvance(filas);
    expect(r.total).toBe(3);
    expect(r.decididas).toBe(1);          // 1 de 3 filas…
    expect(r.pct).toBe(90);               // …pero el 90% de la plata
  });

  it('separa lo que está en el catálogo de lo que no es un insumo', () => {
    const decisiones = new Map([
      [normMapeo('CHIRIMOYA'), { decision: 'no_insumo' }],
      [normMapeo('CEMENTO PORTLAND TIPO I 42.5 KG - PACASMAYO-BOLSA'), { decision: 'catalogo', catalogo_insumo_id: 'c1' }],
    ]);
    const { filas } = armar([compra('CHIRIMOYA', 4), compra('CEMENTO PORTLAND TIPO I 42.5 KG - PACASMAYO-BOLSA', 62352)], { decisiones });
    const r = resumenAvance(filas);
    expect(r.noInsumo).toBe(1);
    expect(r.enCatalogo).toBe(1);
    expect(r.plataNoInsumo).toBe(4);
  });

  it('sin compras no divide por cero', () => {
    expect(resumenAvance([]).pct).toBe(0);
  });
});

describe('el puente a la contadora', () => {
  it('una decisión contesta también la categoría de gasto', () => {
    const f = { muestra: 'GUANTE DE ACERO ANTICORTE TALLA M' };
    const ap = aprendizajeParaContadora(f, { nombre: 'GUANTES ANTICORTE', familia: 'seguridad', unidad: 'par' });
    expect(ap.categoria).toBe('epp');
    expect(ap.tipoInsumo).toBe('epp');
    expect(ap.descripcion).toBe(f.muestra);
  });

  it('la unidad hm separa la maquinaria de la herramienta', () => {
    const ap = aprendizajeParaContadora({ muestra: 'x' },
      { nombre: 'RETROEXCAVADORA SOBRE LLANTAS', familia: 'equipos_herramientas', unidad: 'hm' });
    expect(ap.tipoInsumo).toBe('maquinaria');
    expect(ap.categoria).toBe('maquinaria');
  });

  it('sin insumo no hay nada que enseñar', () => {
    expect(aprendizajeParaContadora({ muestra: 'x' }, null)).toBeNull();
  });
});
