// ═══════════════════════════════════════════════════════════════════
// MAPEO EMPRESA ↔ TRABAJO (mig 206) — lib pura.
//
// Los insumos del presupuesto son los REALES de la obra «MEJORAMIENTO,
// AMPLIACION DEL SERVICIO DE AGUA POTABLE…» (434 insumos distintos en 6.722
// filas de `insumos_partida`), con sus códigos, unidades y cantidades
// textuales. Si alguien afloja la compuerta de clasificación o el motor, estos
// tests dicen exactamente qué insumo se dejó de reconocer.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { normMapeo } from '../mapeo-insumos.js';
import {
  presupuestoDelTrabajo, catalogoDeLaEmpresa, resumenClasificacion,
  resolverMapeosTrabajo, indiceDelPresupuesto, proponerParaInsumo,
  filasDeMapeoTrabajo, resumenAvanceMapeo, cobertura,
  decisionDeMapeo, decisionNoEsta, estaClasificado,
} from '../mapeo-trabajo.js';

const OBRA = 'obra-agua';

// Filas de `insumos_partida` tal como quedan tras importar el presupuesto.
const ip = (codigo, nombre, unidad, tipo, cantidad, costo, partidas = 1) =>
  Array.from({ length: partidas }, (_, i) => ({
    id: `${codigo}-${i}`, obra_id: OBRA, partida_id: `p${i}`,
    insumo_codigo: codigo, nombre_insumo: nombre, unidad, tipo_insumo: tipo,
    cantidad_presupuestada: cantidad / partidas,
    costo_presupuestado: costo / partidas,
  }));

const PRESUPUESTO = [
  ...ip('210020001', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bol', 'material', 11269.16, 353851.56, 191),
  ...ip('660020050', 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', 'm', 'material', 14088.72, 450839.10),
  ...ip('30020002', 'ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60', 'kg', 'material', 29856.03, 103600.42, 33),
  ...ip('430020009', 'MADERA TORNILLO PARA ENCOFRADO', 'p²', 'material', 39887.80, 478653.59, 82),
  ...ip('490020001', 'RETROEXCAVADORA SOBRE LLANTAS 80-100 HP, 0.96M3', 'hm', 'equipo', 1827.72, 255880.52, 4),
  ...ip('470020004', 'PEON', 'hh', 'mano_obra', 142891.84, 2867839.30, 1010),
];

// Filas de `catalogo_insumos` con su clasificación YA decidida.
const cat = (id, nombre, unidad, familia, tipo = 'insumo') => ({
  id, nombre, norm: normMapeo(nombre), unidad, familia, tipo,
  origen: 'xlsx', activo: true, company_id: null,
});

const CATALOGO = [
  cat('c1', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bolsa', '21'),
  cat('c2', 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', 'm', '66'),
  cat('c3', 'GUANTES ANTICORTE', 'par', '83'),
  cat('c4', 'INSUMO RARO SIN CLASIFICAR', 'und', 'sin_clasificar'),
  cat('c5', 'TUBERIA PVC UF S25 DE 6"(160mm) x 6m ISO 4435', 'm', '66'),
];

const armar = (opts = {}) => {
  const presupuesto = presupuestoDelTrabajo(opts.presupuesto || PRESUPUESTO);
  const catalogo = catalogoDeLaEmpresa(opts.catalogo || CATALOGO, { companyId: null });
  const { prep, porCodigo } = indiceDelPresupuesto(presupuesto);
  const decisiones = opts.decisiones || new Map();
  const filas = filasDeMapeoTrabajo(catalogo, { prep, porCodigo, decisiones });
  return { presupuesto, catalogo, prep, porCodigo, filas };
};

describe('el presupuesto del trabajo', () => {
  it('consolida el mismo insumo repartido en muchas partidas', () => {
    const p = presupuestoDelTrabajo(PRESUPUESTO);
    const cemento = p.find(r => r.codigo === '210020001');
    // El cemento está en 191 partidas y es UN insumo, no 191.
    expect(cemento.partidas).toBe(191);
    expect(cemento.cantidad).toBeCloseTo(11269.16, 1);
    expect(cemento.costo).toBeCloseTo(353851.56, 1);
    expect(p).toHaveLength(6);
  });

  it('viene ordenado por plata: decidir arriba rinde', () => {
    const p = presupuestoDelTrabajo(PRESUPUESTO);
    expect(p[0].codigo).toBe('470020004');   // PEON, S/ 2,86 M
    expect(p[1].codigo).toBe('430020009');   // madera de encofrado
  });

  it('clasifica con el MISMO estándar que el catálogo de la empresa', () => {
    const p = presupuestoDelTrabajo(PRESUPUESTO);
    const porCodigo = Object.fromEntries(p.map(r => [r.codigo, r.clasificacion]));
    expect(porCodigo['210020001']).toBe('21');   // Cemento Portland e hidráulico
    expect(porCodigo['30020002']).toBe('03');    // Acero de construcción corrugado
    expect(p.every(r => typeof r.clasificado === 'boolean')).toBe(true);
  });

  it('el porcentaje clasificado es el número que se pidió ver', () => {
    const p = presupuestoDelTrabajo(PRESUPUESTO);
    const r = resumenClasificacion(p);
    expect(r.total).toBe(6);
    expect(r.clasificados + r.faltan).toBe(6);
    expect(r.pct).toBeCloseTo((r.clasificados * 100) / 6, 5);
  });
});

describe('el catálogo de la empresa', () => {
  it('usa la clasificación GUARDADA, no la que el motor adivinaría hoy', () => {
    const c = catalogoDeLaEmpresa(CATALOGO, { companyId: null });
    expect(c.find(r => r.id === 'c1').clasificacion).toBe('21');
    // La que dice «sin clasificar» no está clasificada, y se dice.
    expect(c.find(r => r.id === 'c4').clasificado).toBe(false);
  });

  it('«sin_clasificar» y «otros» no cuentan como clasificados', () => {
    expect(estaClasificado('21')).toBe(true);
    expect(estaClasificado('S14')).toBe(true);
    expect(estaClasificado('sin_clasificar')).toBe(false);
    expect(estaClasificado('otros')).toBe(false);
    expect(estaClasificado('')).toBe(false);
  });
});

describe('la propuesta, con la clasificación como compuerta', () => {
  it('el cemento de la empresa encuentra el cemento del presupuesto', () => {
    const { filas } = armar();
    const f = filas.find(r => r.id === 'c1');
    expect(f.estado).toBe('propuesto');
    expect(f.sug.candidatos[0].cat.codigo).toBe('210020001');
  });

  it('🔴 un EPP no recibe una tubería porque «se parece»', () => {
    const { filas } = armar();
    const f = filas.find(r => r.id === 'c3');   // GUANTES ANTICORTE, [83]
    // El motor no encuentra un solo candidato en este presupuesto, y eso es la
    // respuesta correcta: decir «no hay nada» en vez de ofrecer lo más parecido
    // de una familia que no tiene nada que ver.
    expect(f.estado).toBe('sin_candidato');
    expect(f.sug.candidatos).toHaveLength(0);
  });

  it('🔴 cuando los dos lados clasifican distinto, se ofrece igual y se MARCA', () => {
    // La tubería de c2 está en [66] en el catálogo y el estándar deriva [72]
    // para la del presupuesto: es la misma. Con la compuerta como muro no se
    // encontraban nunca. Como preferencia, se ofrece marcada y NUNCA como
    // 'propuesto' — un cruce entre clasificaciones se mira, no se acepta en
    // lote.
    const { filas } = armar();
    const f = filas.find(r => r.id === 'c2');
    expect(f.sug.candidatos.length).toBeGreaterThan(0);
    expect(f.sug.otraClasificacion).toBe(true);
    expect(f.sug.candidatos[0].otraClasificacion).toBe(true);
    expect(f.estado).toBe('revisar');
  });

  it('un insumo sin clasificar no entra a la comparación: se avisa', () => {
    const { filas } = armar();
    const f = filas.find(r => r.id === 'c4');
    expect(f.estado).toBe('sin_clasificar');
    expect(f.sug).toBe(null);
  });

  it('una tubería de otro diámetro nunca se acepta sola', () => {
    // c5 es la de 6" y el presupuesto solo tiene la de 8": se propone porque
    // comparten casi todo el nombre, pero el diámetro no coincide. Lo que este
    // test fija es que NO se decide sola.
    const { filas } = armar();
    const f = filas.find(r => r.id === 'c5');
    expect(f.estado).not.toBe('propuesto');
  });
});

describe('las decisiones', () => {
  it('una decisión saca la fila de pendientes y trae su insumo del presupuesto', () => {
    const decisiones = new Map([[normMapeo('CEMENTO PORTLAND TIPO I (42.5 kg)'), {
      obra_id: OBRA, norm: normMapeo('CEMENTO PORTLAND TIPO I (42.5 kg)'),
      decision: 'mapeado', insumo_codigo: '210020001', insumo_nombre: 'CEMENTO PORTLAND TIPO I (42.5 kg)',
      fuente: 'manual', updated_at: '2026-09-13T10:00:00Z',
    }]]);
    const { filas } = armar({ decisiones });
    const f = filas.find(r => r.id === 'c1');
    expect(f.estado).toBe('decididas');
    expect(f.presupuesto.codigo).toBe('210020001');
  });

  it('«no está en el presupuesto» es una respuesta y también se recuerda', () => {
    const norm = normMapeo('GUANTES ANTICORTE');
    const decisiones = new Map([[norm, {
      obra_id: OBRA, norm, decision: 'no_esta', insumo_codigo: null,
      fuente: 'manual', updated_at: '2026-09-13T10:00:00Z',
    }]]);
    const { filas } = armar({ decisiones });
    const f = filas.find(r => r.id === 'c3');
    expect(f.estado).toBe('decididas');
    expect(f.presupuesto).toBe(null);
  });

  it('manual pisa a regla, y a igual fuente gana la más reciente', () => {
    const filas = [
      { norm: 'x', obra_id: OBRA, fuente: 'regla', decision: 'mapeado', insumo_codigo: 'A', updated_at: '2026-09-13T12:00:00Z' },
      { norm: 'x', obra_id: OBRA, fuente: 'manual', decision: 'mapeado', insumo_codigo: 'B', updated_at: '2026-09-13T09:00:00Z' },
    ];
    expect(resolverMapeosTrabajo(filas, { obraId: OBRA }).get('x').insumo_codigo).toBe('B');
    const empate = [
      { norm: 'y', obra_id: OBRA, fuente: 'manual', decision: 'mapeado', insumo_codigo: 'A', updated_at: '2026-09-13T09:00:00Z' },
      { norm: 'y', obra_id: OBRA, fuente: 'manual', decision: 'mapeado', insumo_codigo: 'C', updated_at: '2026-09-13T18:00:00Z' },
    ];
    expect(resolverMapeosTrabajo(empate, { obraId: OBRA }).get('y').insumo_codigo).toBe('C');
  });

  it('🔴 las decisiones de OTRO trabajo no se leen acá', () => {
    // Es el bug que `insumo_mapeo` tenía latente: sin obra_id, una decisión
    // tomada contra el presupuesto de la obra A aparecía como «ya decidida»
    // contra un código que en la obra B no existe.
    const filas = [
      { norm: 'z', obra_id: 'otra-obra', fuente: 'manual', decision: 'mapeado', insumo_codigo: 'A', updated_at: '2026-09-13T09:00:00Z' },
    ];
    expect(resolverMapeosTrabajo(filas, { obraId: OBRA }).has('z')).toBe(false);
    expect(resolverMapeosTrabajo(filas, { obraId: 'otra-obra' }).has('z')).toBe(true);
  });

  it('las filas demo no se mezclan con las reales', () => {
    const filas = [{ norm: 'd', obra_id: OBRA, demo: true, fuente: 'manual', decision: 'mapeado', insumo_codigo: 'A' }];
    expect(resolverMapeosTrabajo(filas, { obraId: OBRA, demo: false }).size).toBe(0);
    expect(resolverMapeosTrabajo(filas, { obraId: OBRA, demo: true }).size).toBe(1);
  });
});

describe('el avance', () => {
  it('el porcentaje se mide sobre lo DECIDIBLE, no sobre el total', () => {
    // Si contara los sin clasificar, el avance quedaría clavado por algo que
    // se arregla en otra pantalla y diría «no avanzaste» cuando sí.
    const { filas } = armar();
    const r = resumenAvanceMapeo(filas);
    expect(r.total).toBe(5);
    expect(r.sinClasificar).toBe(1);
    expect(r.pct).toBe(0);

    const norm = normMapeo('CEMENTO PORTLAND TIPO I (42.5 kg)');
    const decisiones = new Map([[norm, { obra_id: OBRA, norm, decision: 'mapeado', insumo_codigo: '210020001', fuente: 'manual' }]]);
    const r2 = resumenAvanceMapeo(armar({ decisiones }).filas);
    expect(r2.decididas).toBe(1);
    expect(r2.mapeadas).toBe(1);
    expect(r2.pct).toBeCloseTo(100 / 4, 5);   // 1 de 4 decidibles
  });
});

describe('la cobertura: la vista inversa', () => {
  it('dice qué insumos del trabajo todavía no los cubre nadie', () => {
    const p = presupuestoDelTrabajo(PRESUPUESTO);
    const c = cobertura(p, [
      { decision: 'mapeado', insumo_codigo: '210020001', norm: 'x', muestra: 'CEMENTO…' },
      { decision: 'no_esta', insumo_codigo: null, norm: 'y' },
    ]);
    expect(c.total).toBe(6);
    expect(c.conCobertura).toBe(1);
    expect(c.sinCobertura).toBe(5);
    expect(c.filas.find(f => f.codigo === '210020001').cubiertoPor).toHaveLength(1);
  });
});

describe('lo que se escribe', () => {
  const fila = { id: 'c1', norm: normMapeo('CEMENTO PORTLAND TIPO I (42.5 kg)'), nombre: 'CEMENTO PORTLAND TIPO I (42.5 kg)', unidad: 'bolsa' };
  const insumo = { codigo: '210020001', nombre: 'CEMENTO PORTLAND TIPO I (42.5 kg)', unidad: 'bol' };

  it('la fila de «mapeado» lleva el trabajo, el código y los dos nombres congelados', () => {
    const c = decisionDeMapeo(fila, insumo, { obraId: OBRA, companyId: 'gasomi' });
    expect(c.obra_id).toBe(OBRA);
    expect(c.decision).toBe('mapeado');
    expect(c.insumo_codigo).toBe('210020001');
    expect(c.insumo_nombre).toBe('CEMENTO PORTLAND TIPO I (42.5 kg)');
    expect(c.muestra).toBe('CEMENTO PORTLAND TIPO I (42.5 kg)');
    expect(c.catalogo_insumo_id).toBe('c1');
  });

  it('🔴 sin insumo del presupuesto NO fabrica una decisión sin destino', () => {
    // El CHECK de la mig 206 lo prohíbe: una fila así se guardaría local y
    // rebotaría en el push con 23514, dejando el sync en reintento eterno.
    expect(() => decisionDeMapeo(fila, null, { obraId: OBRA })).toThrow(/insumo del presupuesto/);
    expect(() => decisionDeMapeo(fila, insumo, {})).toThrow(/trabajo/);
  });

  it('«no está» va sin código, que es lo que el CHECK exige del otro lado', () => {
    const c = decisionNoEsta(fila, { obraId: OBRA, companyId: 'gasomi' });
    expect(c.decision).toBe('no_esta');
    expect(c.insumo_codigo).toBe(null);
    expect(c.insumo_nombre).toBe(null);
  });

  it('el id de un insumo que solo vive en la disgregación no se guarda como FK', () => {
    const suelto = { ...fila, id: 'disgregacion:acero corrugado' };
    expect(decisionDeMapeo(suelto, insumo, { obraId: OBRA }).catalogo_insumo_id).toBe(null);
    expect(decisionNoEsta(suelto, { obraId: OBRA }).catalogo_insumo_id).toBe(null);
  });

  it('el factor solo se guarda cuando las unidades DIFIEREN', () => {
    const mismas = decisionDeMapeo(fila, { ...insumo, unidad: 'bolsa' }, { obraId: OBRA, factor: 2, factorFuente: 'manual' });
    expect(mismas.factor).toBe(null);
    const distintas = decisionDeMapeo(fila, { ...insumo, unidad: 'kg' }, { obraId: OBRA, factor: 42.5, factorFuente: 'tabla' });
    expect(distintas.factor).toBe(42.5);
    expect(distintas.factor_fuente).toBe('tabla');
  });
});

describe('proponerParaInsumo aislado', () => {
  it('no propone nada para un insumo sin clasificar', () => {
    const presupuesto = presupuestoDelTrabajo(PRESUPUESTO);
    const { prep, porCodigo } = indiceDelPresupuesto(presupuesto);
    const r = proponerParaInsumo({ nombre: 'CEMENTO PORTLAND TIPO I (42.5 kg)', unidad: 'bolsa', clasificado: false }, { prep, porCodigo });
    expect(r.candidatos).toHaveLength(0);
    expect(r.estado).toBe('sin_candidato');
  });
});
