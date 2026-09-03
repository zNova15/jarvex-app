// Tests del consolidado del grupo (tanda 3).
//
// El criterio de verificación lo fija docs/tanda-3-consolidado.md: correr el
// consolidado sobre una cadena empresa → empresa → consorcio y confirmar que
// NO duplica ingreso ni costo. Ese es el primer bloque de este archivo; el
// resto cubre los dos errores medidos en producción el 3-sep-2026 (el espejo
// sin flag y el ingreso sin espejo).
import { describe, it, expect } from 'vitest';
import {
  consolidar, perimetroGrupo, emparejarInternas, esInterna, contraparteInterna,
  cadenasInternas, aristasDePares, rucValido, MOTIVO,
} from '../consolidado.js';

// ── Escenario base: A y B empresas del grupo, C consorcio ejecutor ──
const A = { id: 'a', name: 'GASOMI', ruc: '20600097726', tipo_entidad: 'propia' };
const B = { id: 'b', name: 'JHEENSEG', ruc: '20610349359', tipo_entidad: 'propia' };
const C = { id: 'c', name: 'CONSORCIO CHUSAAC', ruc: '20613408011', tipo_entidad: 'consorcio' };
const MUNI = { id: 'muni', name: 'MUNICIPALIDAD', ruc: '20143625681', tipo_entidad: 'tercero' };

const mov = (o) => ({
  currency: 'PEN', payment_status: 'paid', deleted_at: null, demo: false, ...o,
});

/**
 * La cadena de referencia del documento:
 *   proveedor externo → A  (compra real, S/100)
 *   A → B                  (reventa interna, S/120)
 *   B → C consorcio        (reventa interna, S/150)
 *   C → municipalidad      (valorización externa, S/200)
 * El grupo compró por 100 y vendió por 200: la utilidad consolidada es 100.
 */
function cadenaDeReferencia() {
  return [
    // Compra externa de A a un proveedor de la calle.
    mov({ id: 'm1', company_id: 'a', type: 'cost', amount: 100, third_party_ruc: '20999999999',
      third_party_name: 'FERRETERIA EXTERNA', document_number: 'F001-1' }),
    // A le vende a B.
    mov({ id: 'm2', company_id: 'a', type: 'income', amount: 120, is_intercompany: true,
      related_company_id: 'b', document_number: 'E001-10' }),
    mov({ id: 'm3', company_id: 'b', type: 'cost', amount: 120, is_intercompany: true,
      related_company_id: 'a', related_movement_id: 'm2', document_number: 'E001-10' }),
    // B le vende al consorcio ejecutor.
    mov({ id: 'm4', company_id: 'b', type: 'income', amount: 150, is_intercompany: true,
      related_company_id: 'c', document_number: 'E001-11' }),
    mov({ id: 'm5', company_id: 'c', type: 'cost', amount: 150, is_intercompany: true,
      related_company_id: 'b', related_movement_id: 'm4', document_number: 'E001-11' }),
    // El consorcio le factura al cliente externo.
    mov({ id: 'm6', company_id: 'c', type: 'income', amount: 200, third_party_ruc: '20143625681',
      third_party_name: 'MUNICIPALIDAD', document_number: 'F002-1' }),
  ];
}

const base = { companies: [A, B, C, MUNI], consorcios: [], socios: [] };

describe('consolidado — la cadena A → B → consorcio no se cuenta tres veces', () => {
  const r = consolidar({ ...base, movs: cadenaDeReferencia() });

  it('la suma de libros sí infla: cuenta el material tres veces', () => {
    // 120 + 150 + 200 de ingresos y 100 + 120 + 150 de costos.
    expect(r.libros.ingresos).toBe(470);
    expect(r.libros.costos).toBe(370);
  });

  it('el consolidado deja UN ingreso externo y UN costo externo', () => {
    expect(r.consolidado.ingresos).toBe(200);
    expect(r.consolidado.costos).toBe(100);
    expect(r.consolidado.utilidad).toBe(100);
  });

  it('elimina los dos tramos internos, por el mismo importe de los dos lados', () => {
    expect(r.eliminaciones.nPares).toBe(2);
    expect(r.eliminaciones.ingresos).toBe(270);
    expect(r.eliminaciones.costos).toBe(270);
  });

  it('no queda ninguna interna sin espejo', () => {
    expect(r.sinEspejo.nMovs).toBe(0);
    expect(r.sinEspejo.neto).toBe(0);
  });

  it('la conciliación de libros a consolidado cierra', () => {
    const c = r.conciliacion;
    expect(c.desdeLibros - c.margenParesDescuadrados - c.internasSinEspejo)
      .toBeCloseTo(c.haciaConsolidado, 2);
  });

  it('la utilidad consolidada es la de los libros menos el margen interno', () => {
    // Libros: 470 - 370 = 100. Coincide porque los márgenes internos se
    // compensan: lo que gana A es lo que paga B. Si no coincidiera, alguna
    // eliminación estaría descuadrada.
    expect(r.consolidado.utilidad).toBe(r.libros.utilidad);
  });

  it('reconoce la cadena de reventa y sus tramos', () => {
    expect(r.cadenas).toHaveLength(1);
    expect(r.cadenas[0].nombres).toEqual(['GASOMI', 'JHEENSEG', 'CONSORCIO CHUSAAC']);
    expect(r.cadenas[0].facturadoInterno).toBe(270);
  });
});

describe('consolidado — el consorcio es contraparte eliminable', () => {
  it('elimina la venta a un consorcio aunque nadie haya marcado is_intercompany', () => {
    // El agujero exacto que la tanda 3 tenía que cerrar: el espejo existía
    // (las 12 facturas de RUTH a CHUSAAC/ESPERANZA/SAMADAY) pero sin el flag,
    // así que se eliminaba un solo lado.
    const movs = [
      mov({ id: 'x1', company_id: 'a', type: 'income', amount: 8000,
        third_party_ruc: C.ruc, third_party_name: C.name, document_number: 'E001-138' }),
      mov({ id: 'x2', company_id: 'c', type: 'cost', amount: 8000,
        third_party_ruc: A.ruc, third_party_name: A.name, document_number: 'E001-138' }),
    ];
    const r = consolidar({ ...base, movs });
    expect(r.eliminaciones.nPares).toBe(1);
    expect(r.eliminaciones.porDocumento).toBe(1);
    expect(r.consolidado.ingresos).toBe(0);
    expect(r.consolidado.costos).toBe(0);
    expect(r.sinEspejo.nMovs).toBe(0);
  });

  it('sin emparejar por documento, ese costo se contaba como externo del grupo', () => {
    // La regresión que hay que impedir: si el espejo no se empareja, el costo
    // del comprador queda como costo contra un proveedor de la calle y la
    // utilidad consolidada baja por una plata que se pagó adentro.
    const soloElEspejo = [
      mov({ id: 'x2', company_id: 'c', type: 'cost', amount: 8000,
        third_party_ruc: A.ruc, third_party_name: A.name, document_number: 'E001-138' }),
    ];
    const r = consolidar({ ...base, movs: soloElEspejo });
    // Se reconoce interna por RUC aunque no tenga par ni flag: no es costo externo.
    expect(r.consolidado.costos).toBe(0);
    expect(r.sinEspejo.nMovs).toBe(1);
  });

  it('un consorcio del grupo mal clasificado como tercero entra por evidencia', () => {
    // CONSORCIO ESPERANZA: Gabriel confirmó que es del grupo y sigue en
    // tipo_entidad='tercero'. Sus operaciones ya vienen marcadas.
    const ESP = { id: 'esp', name: 'CONSORCIO ESPERANZA', ruc: '20611547367', tipo_entidad: 'tercero' };
    const movs = [
      mov({ id: 'y1', company_id: 'a', type: 'income', amount: 96000, is_intercompany: true,
        related_company_id: 'esp', document_number: 'E001-60' }),
      mov({ id: 'y2', company_id: 'esp', type: 'cost', amount: 96000, is_intercompany: true,
        related_company_id: 'a', related_movement_id: 'y1', document_number: 'E001-60' }),
    ];
    const r = consolidar({ companies: [A, B, C, ESP], consorcios: [], socios: [], movs });
    expect(r.perimetro.ids.has('esp')).toBe(true);
    expect(r.perimetro.aClasificar.map(e => e.nombre)).toContain('CONSORCIO ESPERANZA');
    expect(r.eliminaciones.nPares).toBe(1);
    expect(r.consolidado.ingresos).toBe(0);
  });
});

describe('consolidado — lo que no cuadra se ve, no se esconde', () => {
  it('un ingreso interno sin espejo sale listado con su documento', () => {
    const movs = [
      mov({ id: 'z1', company_id: 'a', type: 'income', amount: 19028.68, is_intercompany: true,
        related_company_id: 'c', third_party_name: 'CONSORCIO CHUSAAC', document_number: 'E001-2' }),
    ];
    const r = consolidar({ ...base, movs });
    expect(r.eliminaciones.nPares).toBe(0);
    expect(r.sinEspejo.nMovs).toBe(1);
    expect(r.sinEspejo.movimientos[0].documento).toBe('E001-2');
    expect(r.sinEspejo.neto).toBe(19028.68);
    // Y no se cuela como ingreso externo del grupo.
    expect(r.consolidado.ingresos).toBe(0);
  });

  it('una interna sin espejo no mueve el total del grupo, solo avisa', () => {
    // Lo que no está cargado no hay que eliminarlo: el consolidado da lo
    // mismo con el espejo y sin él. Lo que cambia es el libro del comprador,
    // que quedó incompleto — de ahí el aviso.
    const conEspejo = [
      ...cadenaDeReferencia(),
      mov({ id: 'z2', company_id: 'a', type: 'income', amount: 50, is_intercompany: true,
        related_company_id: 'c', document_number: 'E001-99' }),
      mov({ id: 'z3', company_id: 'c', type: 'cost', amount: 50, is_intercompany: true,
        related_company_id: 'a', related_movement_id: 'z2', document_number: 'E001-99' }),
    ];
    const sinEspejo = conEspejo.filter(m => m.id !== 'z3');

    const rCon = consolidar({ ...base, movs: conEspejo });
    const rSin = consolidar({ ...base, movs: sinEspejo });

    expect(rCon.consolidado.utilidad).toBe(100);
    expect(rSin.consolidado.utilidad).toBe(100);
    expect(rCon.sinEspejo.nMovs).toBe(0);
    expect(rSin.sinEspejo.nMovs).toBe(1);
    expect(rSin.sinEspejo.movimientos[0].documento).toBe('E001-99');
  });

  it('un par con importes distintos se marca descuadrado y se concilia', () => {
    const movs = [
      mov({ id: 'p1', company_id: 'a', type: 'income', amount: 100, is_intercompany: true,
        related_company_id: 'b', document_number: 'E001-77' }),
      mov({ id: 'p2', company_id: 'b', type: 'cost', amount: 90, is_intercompany: true,
        related_company_id: 'a', related_movement_id: 'p1', document_number: 'E001-77' }),
    ];
    const r = consolidar({ ...base, movs });
    expect(r.eliminaciones.descuadrados).toHaveLength(1);
    expect(r.eliminaciones.descuadrados[0].diferencia).toBe(10);
    const c = r.conciliacion;
    expect(c.desdeLibros - c.margenParesDescuadrados - c.internasSinEspejo)
      .toBeCloseTo(c.haciaConsolidado, 2);
  });

  it('los libros de un tercero no entran al consolidado, pero se informan', () => {
    const movs = [
      ...cadenaDeReferencia(),
      mov({ id: 'w1', company_id: 'muni', type: 'cost', amount: 999, document_number: 'X-1' }),
    ];
    const r = consolidar({ ...base, movs });
    expect(r.consolidado.costos).toBe(100);
    expect(r.fueraDePerimetro.nMovs).toBe(1);
    expect(r.fueraDePerimetro.costos).toBe(999);
    expect(r.fueraDePerimetro.entidades[0].nombre).toBe('MUNICIPALIDAD');
  });
});

describe('perímetro del grupo', () => {
  it('entran propias y consorcios del catálogo, no los terceros', () => {
    const p = perimetroGrupo({ companies: [A, B, C, MUNI] });
    expect(p.ids.has('a')).toBe(true);
    expect(p.ids.has('c')).toBe(true);
    expect(p.ids.has('muni')).toBe(false);
  });

  it('una company sin tipo_entidad se lee como propia', () => {
    const p = perimetroGrupo({ companies: [{ id: 'n', name: 'NUEVA', ruc: '20111111111' }] });
    expect(p.ids.has('n')).toBe(true);
  });

  it('el titular contable de un consorcio entra aunque el catálogo diga tercero', () => {
    const T = { id: 't', name: 'CONSORCIO EL INCA', ruc: '20615346081', tipo_entidad: 'tercero' };
    const p = perimetroGrupo({ companies: [T], consorcios: [{ id: 'co1', company_id: 't' }] });
    expect(p.ids.has('t')).toBe(true);
    expect(p.entidades.find(e => e.id === 't').motivo).toBe(MOTIVO.TITULAR);
  });

  it('las socias de un consorcio entran al perímetro', () => {
    const S = { id: 's', name: 'PERSEIDAS', ruc: '20610241191', tipo_entidad: 'tercero' };
    const p = perimetroGrupo({
      companies: [C, S], consorcios: [{ id: 'co1', company_id: 'c' }],
      socios: [{ id: 'so1', consorcio_id: 'co1', company_id: 's' }],
    });
    expect(p.entidades.find(e => e.id === 's').motivo).toBe(MOTIVO.SOCIO);
  });

  it('el RUC placeholder de "General" no sirve para resolver contrapartes', () => {
    expect(rucValido('00000000')).toBe(false);
    expect(rucValido('20600097726')).toBe(true);
    const p = perimetroGrupo({ companies: [{ id: 'g', name: 'General', ruc: '00000000' }] });
    expect(p.porRuc.size).toBe(0);
    expect(contraparteInterna({ company_id: 'a', third_party_ruc: '00000000' }, p)).toBe(null);
  });
});

describe('esInterna', () => {
  const p = perimetroGrupo({ companies: [A, B, C, MUNI] });

  it('el flag de la contadora alcanza por sí solo', () => {
    expect(esInterna({ company_id: 'a', is_intercompany: true }, p)).toBe(true);
  });

  it('la contraparte por RUC alcanza sin flag', () => {
    expect(esInterna({ company_id: 'a', third_party_ruc: B.ruc }, p)).toBe(true);
  });

  it('una venta a un tercero no es interna', () => {
    expect(esInterna({ company_id: 'a', third_party_ruc: MUNI.ruc }, p)).toBe(false);
  });

  it('los libros de fuera del perímetro nunca son internos', () => {
    expect(esInterna({ company_id: 'muni', is_intercompany: true, related_company_id: 'a' }, p)).toBe(false);
  });
});

describe('emparejarInternas', () => {
  it('prefiere el vínculo explícito y no reusa un movimiento en dos pares', () => {
    const internas = [
      mov({ id: 'i1', company_id: 'a', type: 'income', amount: 100, document_number: 'D-1' }),
      mov({ id: 'e1', company_id: 'b', type: 'cost', amount: 100, related_movement_id: 'i1', document_number: 'D-1' }),
      mov({ id: 'e2', company_id: 'c', type: 'cost', amount: 100, document_number: 'D-1' }),
    ];
    const { pares, huerfanas } = emparejarInternas(internas);
    expect(pares).toHaveLength(1);
    expect(pares[0].via).toBe('related_movement_id');
    expect(huerfanas.map(m => m.id)).toEqual(['e2']);
  });

  it('no empareja dos movimientos del mismo libro', () => {
    const internas = [
      mov({ id: 'i1', company_id: 'a', type: 'income', amount: 50, document_number: 'D-9' }),
      mov({ id: 'e1', company_id: 'a', type: 'cost', amount: 50, document_number: 'D-9' }),
    ];
    expect(emparejarInternas(internas).pares).toHaveLength(0);
  });

  it('un interno mal clasificado como expense se empareja igual', () => {
    // Si quedara afuera se contaría de un solo lado — el error que la regla
    // dura de clasificacion-contable.js intenta evitar en el alta.
    const internas = [
      mov({ id: 'i1', company_id: 'a', type: 'income', amount: 30, document_number: 'D-3' }),
      mov({ id: 'e1', company_id: 'b', type: 'expense', amount: 30, document_number: 'D-3' }),
    ];
    expect(emparejarInternas(internas).pares).toHaveLength(1);
  });

  it('sin número de documento no inventa un par', () => {
    const internas = [
      mov({ id: 'i1', company_id: 'a', type: 'income', amount: 30 }),
      mov({ id: 'e1', company_id: 'b', type: 'cost', amount: 30 }),
    ];
    expect(emparejarInternas(internas).pares).toHaveLength(0);
    expect(emparejarInternas(internas).huerfanas).toHaveLength(2);
  });
});

describe('cadenas internas', () => {
  it('un A → B suelto no es una cadena', () => {
    expect(cadenasInternas([{ vendedor: 'a', comprador: 'b', monto: 10, nPares: 1 }])).toHaveLength(0);
  });

  it('corta los ciclos en lugar de colgarse', () => {
    const cadenas = cadenasInternas([
      { vendedor: 'a', comprador: 'b', monto: 10, nPares: 1 },
      { vendedor: 'b', comprador: 'a', monto: 12, nPares: 1 },
    ]);
    expect(Array.isArray(cadenas)).toBe(true);
  });

  it('las aristas agregan los pares por par de entidades', () => {
    const pares = [
      { ingreso: { company_id: 'a', amount: 10 }, egreso: { company_id: 'b', amount: 10 } },
      { ingreso: { company_id: 'a', amount: 5 },  egreso: { company_id: 'b', amount: 5 } },
    ];
    const aristas = aristasDePares(pares);
    expect(aristas).toHaveLength(1);
    expect(aristas[0]).toMatchObject({ vendedor: 'a', comprador: 'b', monto: 15, nPares: 2 });
  });
});

describe('criterio de moneda, anulados y modo prueba', () => {
  it('una moneda por vez; las otras se cuentan aparte', () => {
    const movs = [
      mov({ id: 'a1', company_id: 'a', type: 'income', amount: 100 }),
      mov({ id: 'a2', company_id: 'a', type: 'income', amount: 999, currency: 'USD' }),
    ];
    const r = consolidar({ ...base, movs });
    expect(r.consolidado.ingresos).toBe(100);
    expect(r.otrasMonedas).toEqual([{ moneda: 'USD', movs: 1 }]);
  });

  it('los anulados no entran y se informan', () => {
    const movs = [
      mov({ id: 'a1', company_id: 'a', type: 'income', amount: 100, payment_status: 'cancelled' }),
    ];
    const r = consolidar({ ...base, movs });
    expect(r.consolidado.ingresos).toBe(0);
    expect(r.anulados).toBe(1);
  });

  it('el modo prueba no se mezcla con el real', () => {
    const movs = [mov({ id: 'a1', company_id: 'a', type: 'income', amount: 100, demo: true })];
    expect(consolidar({ ...base, movs }).consolidado.ingresos).toBe(0);
    expect(consolidar({ ...base, movs, demo: true }).consolidado.ingresos).toBe(100);
  });

  it('sin movimientos devuelve ceros y no explota', () => {
    const r = consolidar({});
    expect(r.consolidado.utilidad).toBe(0);
    expect(r.eliminaciones.nPares).toBe(0);
    expect(r.cadenas).toEqual([]);
  });
});
