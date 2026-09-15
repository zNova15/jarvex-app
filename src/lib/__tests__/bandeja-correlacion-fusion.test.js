// UNA SOLA COLA: CORRELACIONAR → CLASIFICAR (tanda 4, 15-sep-2026).
//
// Lo que se protege acá es el invariante que hace que la fusión sea segura:
// la pantalla muestra UNA fila, pero la decisión se escribe para TODAS las
// descripciones del grupo. Si eso se rompe, la bandeja dice «listo» y deja
// dos de cada tres descripciones pendientes en la base — y la próxima factura
// vuelve a preguntar por ellas.
import { describe, it, expect } from 'vitest';
import {
  agruparDescripciones, fusionarPorCorrelacion, normsDeFila, muestrasDeFila,
  replicarEnVariantes, decisionDeFila,
} from '../bandeja-categorizacion.js';
import { resolverPares, construirGrupos } from '../insumo-correlacion.js';

const compra = (nombre, cantidad, precio, extra = {}) => ({
  nombre, cantidad, precio, clase: 'compra', moneda: 'PEN',
  proveedorNombre: 'PROV', companyId: 'e1', unidad: 'und', ...extra,
});

// Las tres formas en que los proveedores escriben el mismo clavo.
const COMPRAS = [
  compra('CLAVO N 3', 10, 5),          // S/ 50
  compra('CLAVOS NRO 3', 100, 5),      // S/ 500  ← el que más movió
  compra('CLAVO NUMERO 3', 2, 5),      // S/ 10
  compra('CEMENTO SOL', 1, 30),        // suelto
];

const gruposDe = (pares) => construirGrupos(resolverPares(pares)).grupoDe;

const PARES = [
  { nombre_a: 'clavo n 3', nombre_b: 'clavos nro 3', relacion: 'mismo', fuente: 'manual', updated_at: '2026-09-15' },
  { nombre_a: 'clavos nro 3', nombre_b: 'clavo numero 3', relacion: 'mismo', fuente: 'manual', updated_at: '2026-09-15' },
];

describe('agruparDescripciones con correlaciones', () => {
  it('sin grupoDe se comporta exactamente como antes', () => {
    const filas = agruparDescripciones(COMPRAS);
    expect(filas).toHaveLength(4);
    expect(filas.every(f => !f.variantes)).toBe(true);
  });

  it('las variantes correlacionadas son UNA sola fila', () => {
    const filas = agruparDescripciones(COMPRAS, { grupoDe: gruposDe(PARES) });
    expect(filas).toHaveLength(2);
    const grupo = filas.find(f => f.variantes);
    expect(grupo.variantes).toHaveLength(3);
  });

  it('el representante es el que más plata movió, no el nombre más largo', () => {
    const filas = agruparDescripciones(COMPRAS, { grupoDe: gruposDe(PARES) });
    const grupo = filas.find(f => f.variantes);
    expect(grupo.muestra).toBe('CLAVOS NRO 3');
  });

  it('los totales se suman: el grupo vale lo que valen sus variantes juntas', () => {
    const filas = agruparDescripciones(COMPRAS, { grupoDe: gruposDe(PARES) });
    const grupo = filas.find(f => f.variantes);
    expect(grupo.importe).toBe(560);
    expect(grupo.veces).toBe(3);
    expect(grupo.cantidad).toBe(112);
  });

  it('el grupo sube al lugar que le corresponde por plata', () => {
    const filas = agruparDescripciones(COMPRAS, { grupoDe: gruposDe(PARES) });
    expect(filas[0].muestra).toBe('CLAVOS NRO 3');
  });

  it('una correlación cuya hermana no está en esta base no arma un grupo de uno', () => {
    // El par existe, pero solo una de las dos descripciones se facturó acá.
    const grupoDe = gruposDe([
      { nombre_a: 'cemento sol', nombre_b: 'cemento sol bolsa', relacion: 'mismo', fuente: 'manual', updated_at: '2026-09-15' },
    ]);
    const filas = agruparDescripciones(COMPRAS, { grupoDe });
    expect(filas).toHaveLength(4);
    expect(filas.every(f => !f.variantes)).toBe(true);
  });

  it('los pares «distinto» no fusionan nada', () => {
    const grupoDe = gruposDe([
      { nombre_a: 'clavo n 3', nombre_b: 'clavos nro 3', relacion: 'distinto', fuente: 'manual', updated_at: '2026-09-15' },
    ]);
    expect(agruparDescripciones(COMPRAS, { grupoDe })).toHaveLength(4);
  });
});

describe('fusionarPorCorrelacion — los bordes', () => {
  it('sin mapa devuelve las filas tal cual', () => {
    const filas = agruparDescripciones(COMPRAS);
    expect(fusionarPorCorrelacion(filas, null)).toBe(filas);
    expect(fusionarPorCorrelacion(filas, new Map())).toBe(filas);
  });

  it('no pierde ninguna descripción', () => {
    const filas = agruparDescripciones(COMPRAS);
    const fus = fusionarPorCorrelacion(filas, gruposDe(PARES));
    const norms = fus.flatMap(f => normsDeFila(f)).sort();
    expect(norms).toEqual(filas.map(f => f.norm).sort());
  });
});

describe('replicarEnVariantes — el invariante que hace segura la fusión', () => {
  it('una fila suelta escribe una sola decisión', () => {
    const fila = { norm: 'cemento sol', muestra: 'CEMENTO SOL' };
    expect(replicarEnVariantes({ norm: 'cemento sol', familia: '21' }, fila)).toHaveLength(1);
  });

  it('un grupo de 3 escribe 3 decisiones, una por descripción', () => {
    const filas = agruparDescripciones(COMPRAS, { grupoDe: gruposDe(PARES) });
    const grupo = filas.find(f => f.variantes);
    const cuerpos = replicarEnVariantes({ norm: grupo.norm, familia: '39', decision: 'catalogo' }, grupo);
    expect(cuerpos).toHaveLength(3);
    // Todas la MISMA decisión, cada una con SU llave.
    expect(new Set(cuerpos.map(c => c.familia))).toEqual(new Set(['39']));
    expect(new Set(cuerpos.map(c => c.norm)).size).toBe(3);
    // Y cada una con su propia descripción: el diccionario aprende por texto.
    expect(cuerpos.map(c => c.muestra).sort())
      .toEqual(['CLAVOS NRO 3', 'CLAVO N 3', 'CLAVO NUMERO 3'].sort());
  });

  it('sin cuerpo no inventa filas', () => {
    expect(replicarEnVariantes(null, { variantes: [{ norm: 'a' }] })).toEqual([]);
  });
});

describe('normsDeFila / muestrasDeFila', () => {
  it('una fila suelta se describe a sí misma', () => {
    const f = { norm: 'x', muestra: 'X' };
    expect(normsDeFila(f)).toEqual(['x']);
    expect(muestrasDeFila(f)).toEqual(['X']);
  });

  it('un grupo entrega todas sus variantes — es lo que se desclasifica y se desenseña', () => {
    const filas = agruparDescripciones(COMPRAS, { grupoDe: gruposDe(PARES) });
    const grupo = filas.find(f => f.variantes);
    expect(normsDeFila(grupo)).toHaveLength(3);
    expect(muestrasDeFila(grupo)).toHaveLength(3);
  });
});

describe('decisionDeFila — una hermana ya decidida resuelve el grupo', () => {
  const filas = () => agruparDescripciones(COMPRAS, { grupoDe: gruposDe(PARES) });

  it('prefiere la decisión del representante', () => {
    const grupo = filas().find(f => f.variantes);
    const dec = new Map([
      [grupo.norm, { familia: '39', updated_at: '2026-01-01' }],
      [grupo.variantes[1].norm, { familia: '21', updated_at: '2026-09-01' }],
    ]);
    expect(decisionDeFila(grupo, dec).familia).toBe('39');
  });

  it('si el representante no tiene, toma la más reciente de sus hermanas', () => {
    const grupo = filas().find(f => f.variantes);
    const dec = new Map([
      [grupo.variantes[1].norm, { familia: '21', updated_at: '2026-09-01' }],
      [grupo.variantes[2].norm, { familia: '37', updated_at: '2026-09-10' }],
    ]);
    expect(decisionDeFila(grupo, dec).familia).toBe('37');
  });

  it('sin ninguna decidida, el grupo sigue pendiente', () => {
    const grupo = filas().find(f => f.variantes);
    expect(decisionDeFila(grupo, new Map())).toBeNull();
    expect(decisionDeFila(grupo, null)).toBeNull();
  });
});
