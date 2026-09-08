// ═══════════════════════════════════════════════════════════════════
// EL CATÁLOGO CANÓNICO (tanda 14, entrega 2).
//
// Las fixtures NO son inventadas: son un recorte fiel de
// `Modelos/Categorizacion Simple.xlsx` tal como sale de `parseExcelFile()`,
// con sus rarezas incluidas —el encabezado que la primera hoja se come, los
// `\r\n` al final de varios servicios, «adminitrativos» mal escrito, `UND` en
// mayúsculas y `VAR.` con punto, y el `__EMPTY` que SheetJS inventa para la
// columna sin nombre de la hoja DISGREGADOS—. Ese archivo no está en el repo
// (`Modelos/` es gitignored: trae CCI y DNI), así que si el parser no se prueba
// contra sus rarezas acá, no se prueba en ningún lado.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  parseCatalogoXlsx, slugFamilia, normUnidad, tipoInsumoDe, categoriaItemDe,
  diffCatalogo, resumenDiff, resolverCatalogo, indexarCatalogo, buscarCatalogo,
  contarPorFamilia, factorDisgregacion, etiquetaFamilia, esFamiliaCanonica,
  familiaEfectiva, familiasPropias, equivalenciasDe, matrizCategorias,
  entidadesConCatalogo,
} from '../catalogo-canonico.js';

// ── Fixtures ───────────────────────────────────────────────────────
const hojaInsumos = (filas) => ({
  name: 'INSUMOS',
  headers: ['Insumo', 'Unidad'],
  rows: filas.map(([Insumo, Unidad]) => ({ Insumo, Unidad })),
});

const HOJA_INSUMOS = hojaInsumos([
  ['TUBERIA Y ACCESORIOS', null],
  ['TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', 'm'],
  ['CODO PVC SP 1/2" X 90° NTP 399.002', 'und'],
  ['IMPLEMENTOS DE SEGURIDAD', null],
  ['TRAJE DE PROTECCION TYBEK', 'und'],
  ['GUANTES DE CUERO', 'par'],
  ['EQUIPOS Y HERRAMIENTAS', null],
  ['RETROEXCAVADORA SOBRE LLANTAS 80-100 HP, 0.96M3', 'hm'],
  ['MARTILLO', 'und'],
  ['Insumos adminitrativos', null],          // así está escrito en el archivo
  ['PAPEL BOND', 'MILL'],
  ['OTROS', null],
  ['COMBUSTIBLE PARA CAMIONETAS', 'GLN'],
]);

const HOJA_SERVICIOS = {
  name: 'SERVICIOS',
  headers: ['Servicio', 'Unidad'],
  rows: [
    { Servicio: 'EXAMENES MÉDICOS PREOCUPACIONALES\r\n', Unidad: 'und' },
    { Servicio: 'ALQUILER DE CAMIONETA 4X4', Unidad: 'MES' },
  ],
};

const HOJA_DISGREGADOS = {
  name: 'DISGREGADOS',
  headers: ['El acero en kg', '__EMPTY'],
  rows: [
    { 'El acero en kg': 'ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60', __EMPTY: 'kg' },
    { 'El acero en kg': 'Se disgrega en', __EMPTY: null },
    { 'El acero en kg': 'ACERO CORRUGADO DE 1/4"x9m', __EMPTY: 'VAR.' },
    { 'El acero en kg': 'ACERO CORRUGADO DE 1/2"x9m', __EMPTY: 'VAR.' },
  ],
};

const ARCHIVO = [HOJA_INSUMOS, HOJA_SERVICIOS, HOJA_DISGREGADOS];
const leer = (hojas = ARCHIVO) => parseCatalogoXlsx(hojas);
const porNombre = (r, nombre) => r.insumos.find(i => i.nombre === nombre);

// ── 1. Lectura del archivo ─────────────────────────────────────────
describe('leer el xlsx', () => {
  it('no confunde el encabezado de la hoja con un insumo', () => {
    const r = leer();
    expect(porNombre(r, 'Insumo')).toBeUndefined();
    expect(porNombre(r, 'Servicio')).toBeUndefined();
    // 8 insumos + 2 servicios de la fixture, ni uno más.
    expect(r.insumos).toHaveLength(10);
  });

  it('la familia es la fila SIN unidad que encabeza el bloque, no una columna', () => {
    const r = leer();
    expect(porNombre(r, 'CODO PVC SP 1/2" X 90° NTP 399.002').familia).toBe('tuberia_accesorios');
    expect(porNombre(r, 'GUANTES DE CUERO').familia).toBe('seguridad');
    expect(porNombre(r, 'MARTILLO').familia).toBe('equipos_herramientas');
    // Y la fila de la familia NO queda como si fuera un insumo.
    expect(porNombre(r, 'TUBERIA Y ACCESORIOS')).toBeUndefined();
  });

  it('acepta «Insumos adminitrativos» tal como está escrito en el archivo', () => {
    expect(porNombre(leer(), 'PAPEL BOND').familia).toBe('administrativos');
  });

  it('los servicios entran con su propia familia y sin el salto de línea', () => {
    const r = leer();
    const e = porNombre(r, 'EXAMENES MÉDICOS PREOCUPACIONALES');
    expect(e).toBeTruthy();
    expect(e.tipo).toBe('servicio');
    expect(e.familia).toBe('servicios');
  });

  it('normaliza las unidades: el mismo `und` no puede contarse como dos', () => {
    const r = leer();
    expect(porNombre(r, 'PAPEL BOND').unidad).toBe('mill');
    expect(porNombre(r, 'COMBUSTIBLE PARA CAMIONETAS').unidad).toBe('gal');
    expect(porNombre(r, 'ALQUILER DE CAMIONETA 4X4').unidad).toBe('mes');
    expect(normUnidad('UND')).toBe(normUnidad('und'));
    expect(normUnidad('VAR.')).toBe('var');
    expect(normUnidad('')).toBe('');
  });

  it('una familia que no es del grupo se GUARDA con su nombre, no se tira a Otros', () => {
    // Antes caía en «otros» y se perdía lo único que había: cómo la llama esa
    // empresa. Ahora queda como familia propia, esperando su equivalencia.
    const r = leer([hojaInsumos([
      ['MATERIALES ELECTROMECANICOS', null],
      ['MOTOR TRIFASICO 5 HP', 'und'],
    ])]);
    expect(porNombre(r, 'MOTOR TRIFASICO 5 HP').familia).toBe('MATERIALES ELECTROMECANICOS');
    expect(esFamiliaCanonica('MATERIALES ELECTROMECANICOS')).toBe(false);
    expect(r.avisos.join(' ')).toContain('MATERIALES ELECTROMECANICOS');
  });

  it('un nombre repetido se guarda una sola vez y lo dice', () => {
    const r = leer([hojaInsumos([
      ['MADERA', null],
      ['MADERA TORNILLO 2"x3"', 'p2'],
      ['madera  tornillo 2"x3"', 'p2'],
    ])]);
    expect(r.insumos).toHaveLength(1);
    expect(r.avisos.join(' ')).toContain('repetido');
  });

  it('un archivo que no es éste no rompe: lo dice y no devuelve nada', () => {
    const r = leer([{ name: 'Hoja1', headers: ['a', 'b'], rows: [{ a: 'x', b: 'y' }] }]);
    expect(r.insumos).toHaveLength(0);
    expect(r.hojasIgnoradas).toEqual(['Hoja1']);
    expect(r.avisos.join(' ')).toContain('ninguna hoja');
  });

  it('slugFamilia devuelve null para lo que no conoce, sin adivinar', () => {
    expect(slugFamilia('VALVULAS')).toBe('valvulas');
    expect(slugFamilia('  válvulas ')).toBe('valvulas');
    expect(slugFamilia('cosas raras')).toBeNull();
    expect(slugFamilia('')).toBeNull();
    expect(etiquetaFamilia('seguridad')).toBe('Implementos de seguridad');
  });
});

// ── 2. La disgregación ─────────────────────────────────────────────
describe('la disgregación del acero', () => {
  const disg = () => leer().disgregacion;

  it('lee el bloque padre → hijos, con el título de la hoja como título', () => {
    const d = disg();
    expect(d).toHaveLength(2);
    expect(d[0].padre_nombre).toBe('ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60');
    expect(d[0].padre_unidad).toBe('kg');
    expect(d.map(x => x.hijo_nombre)).toEqual(['ACERO CORRUGADO DE 1/4"x9m', 'ACERO CORRUGADO DE 1/2"x9m']);
  });

  it('calcula los kilos de cada varilla con la tabla de la norma', () => {
    const d = disg();
    // 1/4" = 6 mm × 0,222 kg/m × 9 m ; 1/2" = 12,7 mm × 0,994 kg/m × 9 m.
    expect(d[0].factor).toBeCloseTo(1.998, 3);
    expect(d[1].factor).toBeCloseTo(8.946, 3);
  });

  it('el factor sale con su procedencia: el largo lo dice el propio nombre', () => {
    expect(disg().every(d => d.factor_fuente === 'descripcion')).toBe(true);
  });

  it('lo que no sabe convertir queda en null, no en un número inventado', () => {
    const r = factorDisgregacion(
      { nombre: 'PEGAMENTO PARA PVC', unidad: 'gal' },
      { nombre: 'CINTA TEFLON', unidad: 'rollo' },
    );
    expect(r.factor).toBeNull();
    expect(r.fuente).toBeNull();
    expect(r.nota).toContain('definirlo');
  });

  it('un «se disgrega en» sin padre arriba no rompe la lectura', () => {
    const r = leer([{
      name: 'DISGREGADOS', headers: ['Bloque suelto', '__EMPTY'],
      rows: [
        { 'Bloque suelto': 'Se disgrega en', __EMPTY: null },
        { 'Bloque suelto': 'ALGO', __EMPTY: 'und' },
      ],
    }]);
    expect(r.disgregacion).toHaveLength(0);
    expect(r.avisos.length).toBeGreaterThan(0);
  });
});

// ── 3. El puente con los otros dos vocabularios ────────────────────
describe('la familia traduce, no reemplaza', () => {
  const de = (nombre) => porNombre(leer(), nombre);

  it('la familia MANDA donde la regla no llega: el tybek es EPP', () => {
    // `clasificarInsumo` no conoce «TYBEK»; el archivo sí sabe que es EPP.
    expect(tipoInsumoDe(de('TRAJE DE PROTECCION TYBEK'))).toBe('epp');
    expect(categoriaItemDe(de('TRAJE DE PROTECCION TYBEK'))).toBe('epp');
  });

  it('adentro de «equipos y herramientas» decide la regla, y `hm` es maquinaria', () => {
    expect(tipoInsumoDe(de('RETROEXCAVADORA SOBRE LLANTAS 80-100 HP, 0.96M3'))).toBe('maquinaria');
    expect(tipoInsumoDe(de('MARTILLO'))).toBe('herramienta');
    // Y la categoría de gasto acompaña al tipo, no lo contradice.
    expect(categoriaItemDe(de('RETROEXCAVADORA SOBRE LLANTAS 80-100 HP, 0.96M3'))).toBe('maquinaria');
    expect(categoriaItemDe(de('MARTILLO'))).toBe('herramientas');
  });

  it('lo administrativo va a materiales pero se gasta como gasto general', () => {
    expect(tipoInsumoDe(de('PAPEL BOND'))).toBe('material');
    expect(categoriaItemDe(de('PAPEL BOND'))).toBe('gastos_generales');
  });

  it('un servicio nunca cae en una tabla de inventario', () => {
    expect(tipoInsumoDe(de('ALQUILER DE CAMIONETA 4X4'))).toBe('servicio');
    expect(categoriaItemDe(de('ALQUILER DE CAMIONETA 4X4'))).toBe('gastos_generales');
  });

  it('sin familia conocida cae en la regla de siempre, no en un default mudo', () => {
    expect(tipoInsumoDe({ nombre: 'GUANTES DE JEBE', familia: 'inventada' })).toBe('epp');
  });

  it('cuenta por familia solo lo activo', () => {
    const filas = leer().insumos.map((r, i) => ({ ...r, id: `c${i}`, activo: true }));
    filas[0].activo = false;
    const c = contarPorFamilia(filas);
    expect(c.find(f => f.slug === 'tuberia_accesorios').n).toBe(1);
    expect(c.find(f => f.slug === 'servicios').n).toBe(2);
  });
});

// ── 4. La importación repetible ────────────────────────────────────
describe('volver a importar actualiza, no duplica', () => {
  const enBase = (filas) => filas.map((f, i) => ({ ...f, id: `db${i}`, activo: true, updated_at: '2026-09-01' }));

  it('el mismo archivo dos veces no cambia nada', () => {
    const imp = leer().insumos;
    const d = diffCatalogo(enBase(imp), imp);
    expect(resumenDiff(d)).toMatchObject({ altas: 0, cambios: 0, ausentes: 0, hayCambios: false });
    expect(d.iguales).toBe(imp.length);
  });

  it('lo que no estaba entra como alta', () => {
    const imp = leer().insumos;
    const d = diffCatalogo(enBase(imp.slice(1)), imp);
    expect(d.altas).toHaveLength(1);
    expect(d.altas[0].nombre).toBe(imp[0].nombre);
  });

  it('una unidad o familia corregida en el archivo sale como cambio, con el antes y el después', () => {
    const imp = leer().insumos;
    const base = enBase(imp);
    base[0] = { ...base[0], unidad: 'und' };
    const d = diffCatalogo(base, imp);
    expect(d.cambios).toHaveLength(1);
    expect(d.cambios[0].id).toBe('db0');
    expect(d.cambios[0].difs).toEqual([{ campo: 'unidad', antes: 'und', ahora: 'm' }]);
  });

  it('lo que el archivo ya no trae se propone DESACTIVAR, nunca borrar', () => {
    const imp = leer().insumos;
    const base = enBase([...imp, { tipo: 'insumo', nombre: 'CLAVO 3"', norm: 'clavo 3 plg', unidad: 'kg', familia: 'ferreteria', origen: 'xlsx' }]);
    const d = diffCatalogo(base, imp);
    expect(d.ausentes.map(a => a.nombre)).toEqual(['CLAVO 3"']);
    expect(d.altas).toHaveLength(0);
  });

  it('lo cargado a mano NO lo toca la importación ni cuenta como ausente', () => {
    const imp = leer().insumos;
    const base = enBase([...imp, { tipo: 'insumo', nombre: 'ALGO MIO', norm: 'algo mio', unidad: 'und', familia: 'otros', origen: 'manual' }]);
    expect(diffCatalogo(base, imp).ausentes).toHaveLength(0);
  });

  it('lo desactivado que el archivo vuelve a traer se reactiva, no se duplica', () => {
    const imp = leer().insumos;
    const base = enBase(imp).map((f, i) => (i === 0 ? { ...f, activo: false } : f));
    const d = diffCatalogo(base, imp);
    expect(d.reactivar).toHaveLength(1);
    expect(d.reactivar[0].id).toBe('db0');
    expect(d.altas).toHaveLength(0);
  });
});

// ── 5. Dos PCs, la misma fila ──────────────────────────────────────
describe('resolver duplicados al leer (offline-first, sin UNIQUE)', () => {
  const fila = (extra) => ({ norm: 'cemento portland', nombre: 'CEMENTO', unidad: 'bolsa', familia: 'ferreteria', ...extra });

  it('lo corregido a mano pisa a lo importado, aunque sea más viejo', () => {
    const r = resolverCatalogo([
      fila({ id: 'a', origen: 'xlsx', updated_at: '2026-09-07' }),
      fila({ id: 'b', origen: 'manual', updated_at: '2026-09-01' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('b');
  });

  it('a igual origen gana el más reciente', () => {
    const r = resolverCatalogo([
      fila({ id: 'a', origen: 'xlsx', updated_at: '2026-09-01' }),
      fila({ id: 'b', origen: 'xlsx', updated_at: '2026-09-07' }),
    ]);
    expect(r[0].id).toBe('b');
  });

  it('lo borrado y lo que no tiene clave no entran', () => {
    expect(resolverCatalogo([
      fila({ id: 'a', deleted_at: '2026-09-01' }),
      { id: 'b', nombre: 'SIN NORM' },
      null,
    ])).toEqual([]);
  });
});

// ── 6. Proponer al escribir ────────────────────────────────────────
describe('buscar en el catálogo', () => {
  const idx = () => indexarCatalogo(leer().insumos.map((r, i) => ({ ...r, id: `c${i}`, activo: true })));

  it('propone por prefijo: «tub» encuentra «TUBERIA»', () => {
    expect(buscarCatalogo(idx(), 'tub pvc').map(r => r.nombre))
      .toContain('TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435');
  });

  it('pide TODAS las palabras escritas: no propone de más', () => {
    expect(buscarCatalogo(idx(), 'tuberia acero')).toEqual([]);
  });

  it('se puede pedir solo servicios', () => {
    const r = buscarCatalogo(idx(), 'alquiler', { tipo: 'servicio' });
    expect(r).toHaveLength(1);
    expect(r[0].nombre).toBe('ALQUILER DE CAMIONETA 4X4');
    expect(buscarCatalogo(idx(), 'alquiler', { tipo: 'insumo' })).toEqual([]);
  });

  it('sin texto no propone nada (no vuelca el catálogo entero)', () => {
    expect(buscarCatalogo(idx(), '')).toEqual([]);
    expect(buscarCatalogo(idx(), '   ')).toEqual([]);
  });

  it('lo desactivado no se propone', () => {
    const filas = leer().insumos.map((r, i) => ({ ...r, id: `c${i}`, activo: r.nombre !== 'MARTILLO' }));
    expect(buscarCatalogo(indexarCatalogo(filas), 'martillo')).toEqual([]);
  });

  it('respeta el límite pedido', () => {
    expect(buscarCatalogo(idx(), 'acero corrugado de', { limite: 1 }).length).toBeLessThanOrEqual(1);
  });
});

// ── 7. El catálogo tiene dueño (mig 193) ───────────────────────────
describe('cada entidad maneja su base, con el general como referencia', () => {
  const gen = (norm, extra = {}) => ({ id: `g-${norm}`, norm, nombre: norm.toUpperCase(), unidad: 'und', familia: 'ferreteria', tipo: 'insumo', origen: 'xlsx', activo: true, company_id: null, updated_at: '2026-09-01', ...extra });
  const dePropia = (norm, companyId, extra = {}) => gen(norm, { id: `p-${companyId}-${norm}`, company_id: companyId, ...extra });

  const FILAS = [
    gen('cemento'), gen('clavo'),
    dePropia('cemento', 'gasomi', { unidad: 'bolsa', familia: 'agregados' }),
    dePropia('fierro', 'gasomi'),
    dePropia('pintura', 'elinca'),
  ];

  it('el catálogo general es SOLO el general: no se le cuelan las entidades', () => {
    expect(resolverCatalogo(FILAS).map(r => r.norm).sort()).toEqual(['cemento', 'clavo']);
    expect(resolverCatalogo(FILAS)[0].company_id).toBeNull();
  });

  it('una entidad ve lo suyo MÁS el general como base', () => {
    const r = resolverCatalogo(FILAS, { companyId: 'gasomi' });
    expect(r.map(x => x.norm).sort()).toEqual(['cemento', 'clavo', 'fierro']);
    // Y NO ve el catálogo de la otra entidad.
    expect(r.find(x => x.norm === 'pintura')).toBeUndefined();
  });

  it('donde el mismo insumo está en los dos, MANDA el de la entidad', () => {
    const r = resolverCatalogo(FILAS, { companyId: 'gasomi' });
    const cemento = r.find(x => x.norm === 'cemento');
    expect(cemento.company_id).toBe('gasomi');
    expect(cemento.unidad).toBe('bolsa');
  });

  it('y le gana incluso a una fila general corregida a mano', () => {
    const filas = [gen('cemento', { origen: 'manual', updated_at: '2026-09-30' }), dePropia('cemento', 'gasomi')];
    expect(resolverCatalogo(filas, { companyId: 'gasomi' })[0].company_id).toBe('gasomi');
  });

  it('importar en una entidad no marca como ausente lo del general', () => {
    // Se importa solo «fierro» en GASOMI: el general no se toca.
    const d = diffCatalogo(FILAS, [{ tipo: 'insumo', nombre: 'FIERRO', norm: 'fierro', unidad: 'und', familia: 'ferreteria', origen: 'xlsx' }], { companyId: 'gasomi' });
    expect(d.ausentes.map(a => a.norm)).toEqual(['cemento']);   // solo lo de GASOMI
    expect(d.altas).toHaveLength(0);
  });

  it('dice qué entidades ya tienen catálogo propio', () => {
    expect(entidadesConCatalogo(FILAS).sort((a, b) => a.company_id.localeCompare(b.company_id)))
      .toEqual([{ company_id: 'elinca', n: 1 }, { company_id: 'gasomi', n: 2 }]);
  });
});

// ── 8. El mapeo de categorías entre entidades ──────────────────────
describe('el mapeo de categorías entre entidades', () => {
  const ins = (companyId, familia, norm) => ({ id: `${companyId}-${norm}`, norm, nombre: norm.toUpperCase(), unidad: 'und', familia, tipo: 'insumo', origen: 'xlsx', activo: true, company_id: companyId });
  const CATALOGO = [
    ins('gasomi', 'FIERROS Y ACEROS', 'fierro 1_2'),
    ins('gasomi', 'FIERROS Y ACEROS', 'fierro 3_8'),
    ins('gasomi', 'ferreteria', 'clavo'),
    ins('elinca', 'MATERIAL DE FIERRO', 'varilla'),
    ins('elinca', 'ferreteria', 'alambre'),
    ins(null, 'ferreteria', 'tornillo'),
  ];

  it('solo pregunta por las familias PROPIAS: las del grupo ya coinciden solas', () => {
    const p = familiasPropias(CATALOGO, [], 'gasomi');
    expect(p.map(x => x.familia_local)).toEqual(['FIERROS Y ACEROS']);
    expect(p[0].n).toBe(2);
    expect(p[0].decision).toBeNull();
  });

  it('decidida la equivalencia, deja de preguntar y la familia empieza a mandar', () => {
    const mapeo = [{ id: 'm1', company_id: 'gasomi', familia_local: 'FIERROS Y ACEROS', familia_canonica: 'perfiles_metalicos', decision: 'mapeada', updated_at: '2026-09-07' }];
    const p = familiasPropias(CATALOGO, mapeo, 'gasomi');
    expect(p[0].familia_canonica).toBe('perfiles_metalicos');
    // Y a partir de ahí, un insumo de esa familia se comporta como del grupo.
    const eq = equivalenciasDe(mapeo, 'gasomi');
    expect(familiaEfectiva('FIERROS Y ACEROS', eq)).toBe('perfiles_metalicos');
    expect(tipoInsumoDe({ nombre: 'FIERRO 1/2', familia: 'FIERROS Y ACEROS' }, eq)).toBe('material');
    expect(categoriaItemDe({ nombre: 'FIERRO 1/2', familia: 'FIERROS Y ACEROS' }, eq)).toBe('materiales');
  });

  it('«es propia y no equivale a ninguna» es una respuesta que se recuerda', () => {
    const mapeo = [{ id: 'm1', company_id: 'gasomi', familia_local: 'FIERROS Y ACEROS', familia_canonica: null, decision: 'propia', updated_at: '2026-09-07' }];
    expect(familiasPropias(CATALOGO, mapeo, 'gasomi')[0].decision).toBe('propia');
    expect(equivalenciasDe(mapeo, 'gasomi').size).toBe(0);
  });

  it('la equivalencia de una entidad NO se le aplica a otra', () => {
    const mapeo = [{ id: 'm1', company_id: 'gasomi', familia_local: 'FIERROS Y ACEROS', familia_canonica: 'perfiles_metalicos', decision: 'mapeada', updated_at: '2026-09-07' }];
    expect(equivalenciasDe(mapeo, 'elinca').size).toBe(0);
    expect(familiasPropias(CATALOGO, mapeo, 'elinca')[0]).toMatchObject({ familia_local: 'MATERIAL DE FIERRO', decision: null });
  });

  it('la matriz muestra cómo llama cada entidad a la misma categoría del grupo', () => {
    const mapeo = [
      { id: 'm1', company_id: 'gasomi', familia_local: 'FIERROS Y ACEROS', familia_canonica: 'perfiles_metalicos', decision: 'mapeada', updated_at: '2026-09-07' },
      { id: 'm2', company_id: 'elinca', familia_local: 'MATERIAL DE FIERRO', familia_canonica: 'perfiles_metalicos', decision: 'mapeada', updated_at: '2026-09-07' },
    ];
    const { filas, sinMapear } = matrizCategorias(CATALOGO, mapeo);
    const perfiles = filas.find(f => f.slug === 'perfiles_metalicos');
    expect(perfiles.entidades.get('gasomi')).toEqual(['FIERROS Y ACEROS']);
    expect(perfiles.entidades.get('elinca')).toEqual(['MATERIAL DE FIERRO']);
    expect(perfiles.n).toBe(3);
    // Ferretería la comparten las tres sin haber mapeado nada.
    const ferr = filas.find(f => f.slug === 'ferreteria');
    expect([...ferr.entidades.keys()].sort()).toEqual(['elinca', 'gasomi', null].sort());
    expect(sinMapear).toEqual([]);
  });

  it('lo que nadie mapeó todavía queda listado, no se cuenta en ninguna categoría', () => {
    const { filas, sinMapear } = matrizCategorias(CATALOGO, []);
    expect(filas.find(f => f.slug === 'perfiles_metalicos')).toBeUndefined();
    expect(sinMapear).toHaveLength(2);
    expect(sinMapear.map(x => x.familia_local).sort()).toEqual(['FIERROS Y ACEROS', 'MATERIAL DE FIERRO']);
  });
});
