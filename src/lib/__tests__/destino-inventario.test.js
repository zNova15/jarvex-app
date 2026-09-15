// Tests de «qué va a pasar con este insumo» (tanda 6, 15-set-2026).
//
// Gabriel: «¿qué pasa con los insumos que en algún momento se los considera
// activos fijos? […] con eso también se sabe qué insumo se utilizarán dentro
// de la empresa y no se venderán, para que se muestre de esta manera en
// nuestro inventario».
//
// Lo que estos tests protegen es que el HECHO y la DECISIÓN no se mezclen:
// «esta línea ya está en el registro 7.1» se consulta, «este insumo es para
// uso de la empresa» se decide. Y que nada de esto cambie el comportamiento
// de un inventario sin marcar, que es el 100% de lo que hay hoy.
import { describe, it, expect } from 'vitest';
import {
  activosPorLinea, lineaEsActivo, destinoPorNombre, llaveDestino,
  esActivoDe, destinoParaInventario,
  saldoEsVendible, contarDestinos, labelDestino,
  DESTINOS, DESTINO_INFO, AMBITO_DESTINO,
} from '../destino-inventario.js';
import { CAJON, CAJON_LABEL, claveLinea } from '../recomendador-activos.js';
import { inventarioDeEmpresa, saldosNegativos, tieneSaldoNegativo } from '../inventario-empresa.js';
import { extraerLineasDeFacturas } from '../analisis-insumos.js';

const EMP = 'emp-a';

describe('activosPorLinea — el HECHO, no una opinión', () => {
  it('junta las líneas que ya tienen un activo fijo encima', () => {
    const s = activosPorLinea([
      { accounting_movement_id: 'm1', accounting_item_idx: 2 },
      { accounting_movement_id: 'm2', accounting_item_idx: 0 },
    ]);
    expect(s.has('m1::2')).toBe(true);
    expect(s.has('m2::0')).toBe(true);
    expect(s.size).toBe(2);
  });

  it('🔴 el índice 0 es válido: no se puede descartar con un !idx', () => {
    // La primera línea de cada factura tiene idx 0. Un `if (!idx) continue`
    // la dejaría afuera siempre — y es la línea más común.
    const s = activosPorLinea([{ accounting_movement_id: 'm1', accounting_item_idx: 0 }]);
    expect(s.has('m1::0')).toBe(true);
  });

  it('ignora las borradas y las que no apuntan a ninguna línea', () => {
    const s = activosPorLinea([
      { accounting_movement_id: 'm1', accounting_item_idx: 1, deleted_at: '2026-09-15' },
      { accounting_movement_id: 'm2', accounting_item_idx: null },
      { accounting_movement_id: null, accounting_item_idx: 3 },
      null,
    ]);
    expect(s.size).toBe(0);
    expect(activosPorLinea(null).size).toBe(0);
  });

  it('lineaEsActivo cruza una línea de factura con ese conjunto', () => {
    const s = activosPorLinea([{ accounting_movement_id: 'm1', accounting_item_idx: 1 }]);
    expect(lineaEsActivo({ movId: 'm1', itemIdx: 1 }, s)).toBe(true);
    expect(lineaEsActivo({ movId: 'm1', itemIdx: 2 }, s)).toBe(false);
    expect(lineaEsActivo({ movId: 'm1', itemIdx: 1 }, null)).toBe(false);
    expect(lineaEsActivo(null, s)).toBe(false);
  });
});

describe('destinoPorNombre — la DECISIÓN', () => {
  const fila = (llave, decision, extra = {}) => ({
    ambito: AMBITO_DESTINO, llave, decision, deleted_at: null,
    updated_at: '2026-09-15T10:00:00Z', ...extra,
  });

  it('lee los cuatro cajones', () => {
    const m = destinoPorNombre(DESTINOS.map((d, i) => fila(`x${i}`, d)));
    DESTINOS.forEach((d, i) => expect(m.get(`x${i}`)).toBe(d));
  });

  it('ignora otros ámbitos, decisiones que no son destinos, y las borradas', () => {
    const m = destinoPorNombre([
      fila('a', CAJON.ACTIVO, { ambito: 'activos' }),
      fila('b', 'no_aplica'),
      fila('c', CAJON.ACTIVO, { deleted_at: '2026-09-15' }),
      fila('', CAJON.ACTIVO),
      null,
    ]);
    expect(m.size).toBe(0);
  });

  it('con dos PCs contestando distinto gana la más reciente', () => {
    const m = destinoPorNombre([
      fila('taladro', CAJON.REVENTA, { updated_at: '2026-09-15T08:00:00Z' }),
      fila('taladro', CAJON.ACTIVO, { updated_at: '2026-09-15T12:00:00Z' }),
    ]);
    expect(m.get('taladro')).toBe(CAJON.ACTIVO);
  });

  it('la llave es el nombre normalizado, igual que las correlaciones', () => {
    expect(llaveDestino('  TALADRO  Bosch 1/2" ')).toBe('taladro bosch 1 2');
  });
});

describe('saldoEsVendible — qué significa la columna Saldo', () => {
  it('solo lo que se revende (y lo que nadie marcó, que es casi todo)', () => {
    expect(saldoEsVendible(CAJON.REVENTA)).toBe(true);
    expect(saldoEsVendible(null)).toBe(true);
    expect(saldoEsVendible(undefined)).toBe(true);
    expect(saldoEsVendible(CAJON.ACTIVO)).toBe(false);
    expect(saldoEsVendible(CAJON.TRANSFORMA)).toBe(false);
    expect(saldoEsVendible(CAJON.GASTO)).toBe(false);
  });

  it('los cuatro destinos tienen etiqueta y explicación', () => {
    for (const d of DESTINOS) {
      expect(DESTINO_INFO[d].label).toBeTruthy();
      expect(DESTINO_INFO[d].ayuda.length).toBeGreaterThan(20);
      expect(labelDestino(d)).toBe(DESTINO_INFO[d].label);
    }
  });
});

describe('inventarioDeEmpresa con activos y destino', () => {
  const MOVS = [{
    id: 'mv1', company_id: EMP, date: '2026-09-01', type: 'cost', clase: 'compra',
    currency: 'PEN', amount: 80000, third_party_name: 'MAQUINARIAS SAC', document_number: 'F-9',
    notas: { items_factura: [
      { descripcion: 'RETROEXCAVADORA CAT 420', unidad: 'und', cantidad: 1, precio_unitario: 70000, tipo_insumo: 'maquinaria' },
      { descripcion: 'CEMENTO SOL', unidad: 'bolsa', cantidad: 100, precio_unitario: 30, tipo_insumo: 'material' },
    ] },
  }];
  const lineas = () => extraerLineasDeFacturas(MOVS);

  it('marca cuántas compras de un insumo ya están en el registro 7.1', () => {
    const inv = inventarioDeEmpresa(lineas(), {
      companyId: EMP,
      esActivo: esActivoDe(activosPorLinea([{ accounting_movement_id: 'mv1', accounting_item_idx: 0 }])),
    });
    const retro = inv.insumos.find(i => i.display.includes('RETRO'));
    const cemento = inv.insumos.find(i => i.display.includes('CEMENTO'));
    expect(retro.activosCargados).toBe(1);
    expect(cemento.activosCargados).toBe(0);
  });

  it('el destino se lee de la decisión guardada', () => {
    const inv = inventarioDeEmpresa(lineas(), {
      companyId: EMP,
      destinoDe: destinoParaInventario([{ ambito: AMBITO_DESTINO, llave: 'retroexcavadora cat 420', decision: CAJON.ACTIVO }]),
    });
    const retro = inv.insumos.find(i => i.display.includes('RETRO'));
    expect(retro.destino).toBe(CAJON.ACTIVO);
    expect(retro.saldoVendible).toBe(false);
    const cemento = inv.insumos.find(i => i.display.includes('CEMENTO'));
    expect(cemento.destino).toBe(null);
    expect(cemento.saldoVendible).toBe(true);
  });

  it('sin activos ni destinos se comporta exactamente como antes', () => {
    const inv = inventarioDeEmpresa(lineas(), { companyId: EMP });
    for (const i of inv.insumos) {
      expect(i.activosCargados).toBe(0);
      expect(i.destino).toBe(null);
      expect(i.saldoVendible).toBe(true);
    }
  });
});

describe('el rojo es de lo que se revende', () => {
  const ins = (display, destino, cant) => ({
    display, destino, saldoVendible: saldoEsVendible(destino),
    saldo: [{ unidad: 'und', label: 'und', cantidad: cant }],
  });

  it('un activo de uso con saldo negativo NO es una alarma de mercadería', () => {
    const r = saldosNegativos([ins('RETRO', CAJON.ACTIVO, -1), ins('CLAVOS', CAJON.REVENTA, -5)]);
    expect(r.total).toBe(1);
    expect(r.insumos[0].display).toBe('CLAVOS');
  });

  it('sin destino marcado sigue avisando igual que siempre', () => {
    expect(saldosNegativos([ins('CLAVOS', null, -5)]).total).toBe(1);
    expect(tieneSaldoNegativo(ins('CLAVOS', null, -5))).toBe(true);
    expect(tieneSaldoNegativo(ins('RETRO', CAJON.ACTIVO, -5))).toBe(false);
  });
});

describe('contarDestinos', () => {
  it('cuenta por cajón, lo no decidido, y lo que está en el 7.1', () => {
    const c = contarDestinos([
      { destino: CAJON.ACTIVO, activosCargados: 1 },
      { destino: CAJON.ACTIVO, activosCargados: 0 },
      { destino: CAJON.REVENTA },
      { destino: null, activosCargados: 2 },
      {},
    ]);
    expect(c[CAJON.ACTIVO]).toBe(2);
    expect(c[CAJON.REVENTA]).toBe(1);
    expect(c.sin_decidir).toBe(2);
    expect(c.activos_cargados).toBe(2);
  });

  it('sin datos no explota', () => {
    expect(contarDestinos(null).sin_decidir).toBe(0);
    expect(contarDestinos([]).activos_cargados).toBe(0);
  });
});

// ── EL ESPEJO NO PUEDE DIVERGIR ──────────────────────────────────────
// `destino-inventario.js` declara los cajones y la llave de línea en vez de
// importarlos de `recomendador-activos.js`, para no arrastrar su cadena de
// dependencias hasta el inventario por empresa (se veía en el reparto de
// chunks de dist/assets — regla 1 del CLAUDE.md). El precio de esa decisión
// es este test: si alguien toca un valor de un lado y no del otro, falla acá
// y no seis meses después, cuando una pantalla clasifique en 'activo_uso' y
// la otra busque 'activo-uso'.
describe('espejo con recomendador-activos', () => {
  it('los cuatro cajones son exactamente los mismos strings', () => {
    expect(DESTINOS).toEqual([CAJON.GASTO, CAJON.ACTIVO, CAJON.REVENTA, CAJON.TRANSFORMA]);
    expect(DESTINOS).toEqual(['gasto', 'activo_uso', 'reventa', 'transforma']);
  });

  it('la llave de línea tiene el mismo formato que `claveLinea`', () => {
    const s = activosPorLinea([{ accounting_movement_id: 'mov-1', accounting_item_idx: 3 }]);
    expect(s.has(claveLinea('mov-1', 3))).toBe(true);
  });

  it('cada destino elegible tiene su etiqueta en el recomendador también', () => {
    for (const d of DESTINOS) expect(CAJON_LABEL[d]).toBeTruthy();
  });
});
