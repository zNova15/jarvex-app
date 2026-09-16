// ═══════════════════════════════════════════════════════════════════
// LAS CORRELACIONES QUE APARECEN DESPUÉS DE CLASIFICAR (tanda 9).
//
// Gabriel: «acabé las recomendaciones y pensé que eso sería todo pero después
// de ir clasificando me parece que hace falta correlacionar más». Medido:
// 307 decisiones apuntan a 199 insumos → 170 pares que el motor de texto nunca
// preguntó. Los ejemplos de acá son textuales de producción.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { candidatosPorMismoInsumo, unirCandidatos } from '../correlacion-por-clasificacion.js';
import { resolverPares, construirGrupos, normInsumo } from '../insumo-correlacion.js';

const dec = (muestra, catalogoId) => ({
  muestra, norm: muestra.toLowerCase(), decision: 'catalogo',
  catalogo_insumo_id: catalogoId, deleted_at: null,
});

describe('los pares que el texto no ve', () => {
  it('🔴 «DIESEL B5 UV» y «DISEL B5 S50» salen porque quedaron en el mismo insumo', () => {
    const nombres = ['DIESEL B5 UV', 'DISEL B5 S50'];
    const c = candidatosPorMismoInsumo({
      decisiones: [dec('DIESEL B5 UV', 'i1'), dec('DISEL B5 S50', 'i1')],
      nombresVisibles: nombres,
    });
    expect(c).toHaveLength(1);
    expect(c[0].variantes.sort()).toEqual(['DIESEL B5 UV', 'DISEL B5 S50']);
    expect(c[0].motivo).toBe('mismo_insumo');
    expect(c[0].esGrupo).toBe(false);
  });

  it('tres o más son un grupo, no tres pares', () => {
    const nombres = ['PAPEL BIBE X 100 PLIEGOS', 'PAPELOTE X 100 PLIEGOS', 'PAPEL COPYTINTA AMARILLO'];
    const c = candidatosPorMismoInsumo({
      decisiones: nombres.map(n => dec(n, 'bond')),
      nombresVisibles: nombres,
    });
    expect(c).toHaveLength(1);
    expect(c[0].esGrupo).toBe(true);
    expect(c[0].variantes).toHaveLength(3);
  });

  it('dice a qué insumo del catálogo quedaron pegadas', () => {
    const nombres = ['ALAMBRE GALVANIZADO PRODAC', 'ALAMBRE NEGRO # 8'];
    const c = candidatosPorMismoInsumo({
      decisiones: nombres.map(n => dec(n, 'puas')),
      nombresVisibles: nombres,
      nombresCatalogo: new Map([['puas', 'ALAMBRE DE PUAS']]),
    });
    expect(c[0].insumo).toBe('ALAMBRE DE PUAS');
  });

  it('un insumo con una sola descripción no es candidato', () => {
    const c = candidatosPorMismoInsumo({
      decisiones: [dec('CEMENTO', 'i1')],
      nombresVisibles: ['CEMENTO'],
    });
    expect(c).toHaveLength(0);
  });
});

describe('🔴 no vuelve a preguntar lo contestado', () => {
  const nombres = ['DIESEL B5 UV', 'DISEL B5 S50'];
  const decisiones = [dec('DIESEL B5 UV', 'i1'), dec('DISEL B5 S50', 'i1')];

  it('un par ya decidido «mismo» no vuelve', () => {
    const pares = resolverPares([
      { nombre_a: 'DIESEL B5 UV', nombre_b: 'DISEL B5 S50', relacion: 'mismo', fuente: 'manual' },
    ]);
    const c = candidatosPorMismoInsumo({
      decisiones, nombresVisibles: nombres, paresResueltos: pares,
      grupoDe: construirGrupos(pares).grupoDe,
    });
    expect(c).toHaveLength(0);
  });

  it('🔴 un par ya decidido «DISTINTO» tampoco: es una respuesta', () => {
    // Y es el caso importante: compartir insumo del catálogo NO alcanza para
    // volver a preguntar algo que una persona ya contestó que no.
    const pares = resolverPares([
      { nombre_a: 'DIESEL B5 UV', nombre_b: 'DISEL B5 S50', relacion: 'distinto', fuente: 'manual' },
    ]);
    const c = candidatosPorMismoInsumo({
      decisiones, nombresVisibles: nombres, paresResueltos: pares,
      grupoDe: construirGrupos(pares).grupoDe,
    });
    expect(c).toHaveLength(0);
  });

  it('pero si en un grupo de tres queda UN par sin contestar, el candidato vive', () => {
    const tres = ['A UNO', 'B DOS', 'C TRES'];
    const pares = resolverPares([
      { nombre_a: 'A UNO', nombre_b: 'B DOS', relacion: 'mismo', fuente: 'manual' },
    ]);
    const c = candidatosPorMismoInsumo({
      decisiones: tres.map(n => dec(n, 'i1')),
      nombresVisibles: tres, paresResueltos: pares,
      grupoDe: construirGrupos(pares).grupoDe,
    });
    expect(c).toHaveLength(1);
  });
});

describe('el alcance de la pestaña manda', () => {
  it('una descripción que esta pestaña no muestra no entra', () => {
    const c = candidatosPorMismoInsumo({
      decisiones: [dec('DIESEL B5 UV', 'i1'), dec('ALQUILER DE VOLQUETE', 'i1')],
      nombresVisibles: ['DIESEL B5 UV'],   // el servicio está en otra pestaña
    });
    expect(c).toHaveLength(0);
  });

  it('usa el nombre CRUDO de la pestaña, no el guardado en la decisión', () => {
    // La decisión pudo guardarse desde otra entidad con otra grafía; el
    // candidato tiene que hablar de lo que esta pantalla muestra.
    const c = candidatosPorMismoInsumo({
      decisiones: [dec('diesel b5 uv', 'i1'), dec('DISEL B5 S50', 'i1')],
      nombresVisibles: ['DIESEL B5 UV', 'DISEL B5 S50'],
    });
    expect(c[0].variantes).toContain('DIESEL B5 UV');
  });

  it('sin nombres visibles no propone nada en vez de romperse', () => {
    expect(candidatosPorMismoInsumo({ decisiones: [dec('X', 'i1')], nombresVisibles: [] })).toEqual([]);
    expect(candidatosPorMismoInsumo({})).toEqual([]);
  });
});

describe('unir las dos fuentes', () => {
  it('el mismo candidato por los dos caminos es UNO solo', () => {
    const porTexto = [{ id: 'par:A|B', variantes: ['A', 'B'], score: 0.8 }];
    const porInsumo = [{ id: 'par:A|B', variantes: ['A', 'B'], score: 1, motivo: 'mismo_insumo' }];
    expect(unirCandidatos(porTexto, porInsumo)).toHaveLength(1);
  });

  it('los de texto van primero: su score significa algo', () => {
    const porTexto = [{ id: 'par:A|B', variantes: ['A', 'B'], score: 0.8 }];
    const porInsumo = [{ id: 'par:C|D', variantes: ['C', 'D'], score: 1, motivo: 'mismo_insumo' }];
    const u = unirCandidatos(porTexto, porInsumo);
    expect(u.map(c => c.id)).toEqual(['par:A|B', 'par:C|D']);
  });

  it('con listas vacías no explota', () => {
    expect(unirCandidatos()).toEqual([]);
  });
});

describe('el id es el contenido, como en sugerirCandidatos', () => {
  it('no depende del orden en que llegaron los nombres', () => {
    const a = candidatosPorMismoInsumo({
      decisiones: [dec('ZETA', 'i1'), dec('ALFA', 'i1')],
      nombresVisibles: ['ZETA', 'ALFA'],
    })[0];
    const b = candidatosPorMismoInsumo({
      decisiones: [dec('ALFA', 'i1'), dec('ZETA', 'i1')],
      nombresVisibles: ['ALFA', 'ZETA'],
    })[0];
    expect(a.id).toBe(b.id);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EL GRUPO QUE NO SE PODÍA CERRAR (16-set-2026).
//
// Caso REAL de producción, con los nombres textuales. Al insumo «MARTILLO» del
// catálogo le quedaron pegadas tres descripciones que no son el mismo martillo,
// y Gabriel ya había unido dos de ellas. La tarjeta volvía a proponer las TRES
// una y otra vez: sacar la que sobra es estado local que no se guarda, y la
// única salida —«Son distintos» sobre el grupo— pisaba la unión ya hecha.
// El rastro en la base fueron tres filas idénticas del mismo par.
// ═══════════════════════════════════════════════════════════════════
const PLASTICO  = 'MARTILLO PLASTICO SUPERFLEX 0.57KG BAHCO';
const BOLA      = 'MARTILLO DE BOLA 350G 28MM MADERA DEXTER';
const DEMOLEDOR = 'MARTILLO DEMOLEDOR TOTAL 1700KW';

const filaCorr = (a, b, relacion) => ({
  id: `${a}|${b}`, nombre_a: normInsumo(a), nombre_b: normInsumo(b),
  relacion, fuente: 'manual', canonico: normInsumo(a),
  updated_at: '2026-09-16T03:02:32Z', deleted_at: null, demo: false,
});

const candidatoMartillo = (corr) => {
  const paresResueltos = resolverPares(corr, { demo: false });
  const { grupoDe } = construirGrupos(paresResueltos);
  return candidatosPorMismoInsumo({
    decisiones: [dec(PLASTICO, 'MART'), dec(BOLA, 'MART'), dec(DEMOLEDOR, 'MART')],
    nombresVisibles: [PLASTICO, DEMOLEDOR, BOLA],
    paresResueltos, grupoDe,
    nombresCatalogo: new Map([['MART', 'MARTILLO']]),
  });
};

describe('🔴 un grupo con un par ya unido adentro', () => {
  it('sin nada decidido todavía, propone las tres juntas', () => {
    const c = candidatoMartillo([]);
    expect(c).toHaveLength(1);
    expect(c[0].esGrupo).toBe(true);
    expect(c[0].variantes).toHaveLength(3);
  });

  it('con dos ya unidas, vuelve como el PAR que falta — no como el grupo entero', () => {
    const c = candidatoMartillo([filaCorr(PLASTICO, BOLA, 'mismo')]);
    expect(c).toHaveLength(1);
    // Antes volvían las TRES, con la pregunta ya contestada adentro.
    expect(c[0].esGrupo).toBe(false);
    expect(c[0].variantes).toHaveLength(2);
    expect(c[0].variantes).toContain(DEMOLEDOR);
    // El grupo unido entra UNA vez, por su nombre más descriptivo.
    expect(c[0].variantes.filter(v => v !== DEMOLEDOR)).toHaveLength(1);
  });

  it('contestado ese par, el candidato DESAPARECE (no vuelve por el tercero)', () => {
    // «el de plástico no es el demoledor» implica que el de bola tampoco lo es:
    // bola y plástico son el mismo insumo. No se pregunta dos veces.
    const c = candidatoMartillo([
      filaCorr(PLASTICO, BOLA, 'mismo'),
      filaCorr(PLASTICO, DEMOLEDOR, 'distinto'),
    ]);
    expect(c).toHaveLength(0);
  });

  it('si las tres terminan unidas, tampoco vuelve', () => {
    const c = candidatoMartillo([
      filaCorr(PLASTICO, BOLA, 'mismo'),
      filaCorr(PLASTICO, DEMOLEDOR, 'mismo'),
      filaCorr(BOLA, DEMOLEDOR, 'mismo'),
    ]);
    expect(c).toHaveLength(0);
  });
});
