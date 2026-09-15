// Tests de LO QUE ENTRA DE UNA FORMA Y SALE DE OTRA (tanda 7, 15-set-2026).
//
// Gabriel, definiendo el cajón: «podría o bien revenderse, o ser parte de uso
// de la empresa para transformarla en otro insumo (planchas metálicas por
// ejemplo a láminas más pequeñas)».
//
// Lo que estos tests protegen, en orden de importancia:
//  1. QUE LA PLATA NO SE CREE NI SE DESTRUYA. `valor_salidas` tiene que ser
//     exactamente `valor_entradas + valor_costos`, al centavo. La mig 216 tiene
//     un CHECK sobre eso y Dexie no valida CHECKs (regla 9): una fila que no
//     cierre rebota en el push con 23514 y deja el sync en reintento eterno.
//  2. Que no se sumen cantidades de unidades distintas ni montos de monedas
//     distintas, ni siquiera para «poder repartir».
//  3. Que un inventario SIN transformaciones —que es el 100% de lo que hay
//     hoy— se comporte exactamente igual que antes.
import { describe, it, expect } from 'vitest';
import {
  repartirValor, construirTransformacion, validarTransformacion,
  costoUnitarioSugerido, disponibleDe, efectoEnInventario, leerLineas,
  transformacionesDe, resumenTransformaciones, resumirTransformacion,
  unidadDeLinea, TOLERANCIA_CIERRE, REPARTOS, REPARTO_INFO,
} from '../transformacion.js';
import { inventarioDeEmpresa } from '../inventario-empresa.js';
import { extraerLineasDeFacturas } from '../analisis-insumos.js';
import { normInsumo } from '../insumo-correlacion.js';

const EMP = 'emp-gasomi';
const suma = (ns) => Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100;

describe('repartirValor — el reparto cierra al centavo', () => {
  it('reparte proporcional a la cantidad', () => {
    const { valores, error } = repartirValor(300, [
      { cantidad: 2, unidad: 'und' },
      { cantidad: 1, unidad: 'und' },
    ], 'cantidad');
    expect(error).toBe(null);
    expect(valores).toEqual([200, 100]);
  });

  it('🔴 100 entre 3 cierra EXACTO: el centavo que sobra no se pierde', () => {
    const { valores } = repartirValor(100, [
      { cantidad: 1, unidad: 'und' }, { cantidad: 1, unidad: 'und' }, { cantidad: 1, unidad: 'und' },
    ], 'cantidad');
    expect(suma(valores)).toBe(100);
    expect(valores.filter(v => v === 33.34).length + valores.filter(v => v === 33.33).length).toBe(3);
  });

  it('el residuo va a la salida MÁS GRANDE, no a la última', () => {
    // 10,00 entre 7 y 1 → 8,75 y 1,25 (exacto). Uno que no da exacto:
    // 10 entre 3 partes desiguales, con la mayor primero.
    const { valores } = repartirValor(10, [
      { cantidad: 100, unidad: 'kg' }, { cantidad: 1, unidad: 'kg' }, { cantidad: 1, unidad: 'kg' },
    ], 'cantidad');
    expect(suma(valores)).toBe(10);
    // La más grande absorbe el ajuste; las chicas quedan en su proporción.
    expect(valores[1]).toBeCloseTo(0.1, 2);
    expect(valores[2]).toBeCloseTo(0.1, 2);
  });

  it('🔴 NO reparte por cantidad entre unidades distintas', () => {
    const { valores, error } = repartirValor(100, [
      { cantidad: 10, unidad: 'kg' }, { cantidad: 2, unidad: 'und' },
    ], 'cantidad');
    expect(valores).toEqual([]);
    expect(error).toMatch(/unidades distintas/i);
  });

  it('por valor de venta usa el valor de mercado, y sin él no inventa nada', () => {
    const ok = repartirValor(100, [
      { cantidad: 1, unidad: 'und', valorMercado: 300 },
      { cantidad: 1, unidad: 'und', valorMercado: 100 },
    ], 'mercado');
    expect(ok.error).toBe(null);
    expect(ok.valores).toEqual([75, 25]);

    const sin = repartirValor(100, [
      { cantidad: 1, unidad: 'und', valorMercado: 300 },
      { cantidad: 1, unidad: 'und' },
    ], 'mercado');
    expect(sin.error).toMatch(/valor de mercado|valor de venta/i);
  });

  it('a mano devuelve lo escrito, redondeado', () => {
    const { valores } = repartirValor(100, [
      { cantidad: 1, unidad: 'und', valor: 60.005 },
      { cantidad: 1, unidad: 'und', valor: 39.99 },
    ], 'manual');
    expect(valores).toEqual([60.01, 39.99]);
  });

  it('una cantidad en cero no puede pesar en el reparto', () => {
    const { error } = repartirValor(100, [
      { cantidad: 0, unidad: 'und' }, { cantidad: 5, unidad: 'und' },
    ], 'cantidad');
    expect(error).toMatch(/mayor que cero/i);
  });

  it('sin salidas no hay nada que repartir', () => {
    expect(repartirValor(100, [], 'cantidad').error).toMatch(/sin salidas/i);
  });
});

describe('construirTransformacion — el único camino de escritura', () => {
  const base = {
    companyId: EMP, fecha: '2026-07-15', descripcion: 'Corte de planchas',
    entradas: [{ nombre: 'PLANCHA LAF(1/16)1.45X1200X2400MM', cantidad: 21, unidad: 'UNIDAD', valor: 2485.35 }],
    salidas: [
      { nombre: 'LAMINA 30X30', cantidad: 84, unidad: 'und' },
      { nombre: 'RECORTE DE PLANCHA', cantidad: 21, unidad: 'und' },
    ],
  };

  it('🔴 la invariante cierra exactamente: salidas = entradas + costos', () => {
    const { fila, error } = construirTransformacion({
      ...base,
      costos: [{ concepto: 'CORTE GUILLOTINA EN PLANCHA 1/16"', monto: 133.47 }],
      reparto: 'cantidad',
    });
    expect(error).toBe(null);
    expect(fila.valor_entradas).toBe(2485.35);
    expect(fila.valor_costos).toBe(133.47);
    expect(fila.valor_salidas).toBe(2618.82);
    expect(fila.valor_salidas).toBe(Math.round((fila.valor_entradas + fila.valor_costos) * 100) / 100);
    // Y sin pasarse de la tolerancia del CHECK de la mig 216.
    expect(Math.abs(fila.valor_salidas - (fila.valor_entradas + fila.valor_costos))).toBeLessThanOrEqual(TOLERANCIA_CIERRE);
  });

  it('el costo de conversión SE SUMA a lo que valen las salidas', () => {
    const sin = construirTransformacion({ ...base, reparto: 'cantidad' }).fila;
    const con = construirTransformacion({
      ...base, costos: [{ concepto: 'Corte', monto: 133.47 }], reparto: 'cantidad',
    }).fila;
    expect(con.valor_salidas - sin.valor_salidas).toBeCloseTo(133.47, 2);
  });

  it('normaliza nombre, unidad y norm de cada línea', () => {
    const { fila } = construirTransformacion({ ...base, reparto: 'cantidad' });
    expect(fila.entradas[0].unidad).toBe('und');        // 'UNIDAD' → canónica
    expect(fila.entradas[0].nombre_norm).toBe(normInsumo(base.entradas[0].nombre));
    expect(fila.salidas[0].nombre_norm).toBe(normInsumo('LAMINA 30X30'));
  });

  it('descarta los costos vacíos que deja la pantalla al agregar una fila', () => {
    const { fila } = construirTransformacion({
      ...base, reparto: 'cantidad',
      costos: [{ concepto: 'Corte', monto: 50 }, { concepto: '', monto: 0 }],
    });
    expect(fila.costos.length).toBe(1);
  });

  it('una sola salida se lleva todo el valor', () => {
    const { fila } = construirTransformacion({
      ...base, salidas: [{ nombre: 'LAMINA', cantidad: 84, unidad: 'und' }],
      costos: [{ concepto: 'Corte', monto: 0.01 }], reparto: 'cantidad',
    });
    expect(fila.salidas[0].valor).toBe(2485.36);
    expect(fila.valor_salidas).toBe(2485.36);
  });

  it('sale con estado registrada y en una sola moneda', () => {
    const { fila } = construirTransformacion({ ...base, reparto: 'cantidad' });
    expect(fila.estado).toBe('registrada');
    expect(fila.moneda).toBe('PEN');
  });

  it('un reparto imposible devuelve error y NINGUNA fila', () => {
    const { fila, error } = construirTransformacion({
      ...base,
      salidas: [{ nombre: 'LAMINA', cantidad: 10, unidad: 'kg' }, { nombre: 'RECORTE', cantidad: 2, unidad: 'und' }],
      reparto: 'cantidad',
    });
    expect(fila).toBe(null);
    expect(error).toMatch(/unidades distintas/i);
  });
});

describe('validarTransformacion — qué está mal y qué solo hay que mirar', () => {
  const ok = {
    companyId: EMP, fecha: '2026-07-15',
    entradas: [{ nombre: 'PLANCHA', cantidad: 2, unidad: 'und', valor: 200 }],
    salidas: [{ nombre: 'LAMINA', cantidad: 8, unidad: 'und' }],
    reparto: 'cantidad',
  };

  it('el caso bueno pasa sin errores', () => {
    const v = validarTransformacion(ok);
    expect(v.ok).toBe(true);
    expect(v.errores).toEqual([]);
  });

  it('exige empresa, fecha y los dos lados', () => {
    const v = validarTransformacion({ entradas: [], salidas: [], reparto: 'cantidad' });
    expect(v.ok).toBe(false);
    expect(v.errores.join(' ')).toMatch(/fecha/i);
    expect(v.errores.join(' ')).toMatch(/empresa/i);
    expect(v.errores.join(' ')).toMatch(/entra/i);
    expect(v.errores.join(' ')).toMatch(/sale/i);
  });

  it('rechaza cantidades en cero o negativas', () => {
    const v = validarTransformacion({ ...ok, salidas: [{ nombre: 'LAMINA', cantidad: 0, unidad: 'und' }] });
    expect(v.errores.join(' ')).toMatch(/mayor que cero/i);
  });

  it('🔴 el mismo insumo dos veces del mismo lado es un error, no una suma silenciosa', () => {
    const v = validarTransformacion({
      ...ok,
      entradas: [
        { nombre: 'PLANCHA', cantidad: 1, unidad: 'und', valor: 100 },
        { nombre: 'plancha', cantidad: 1, unidad: 'und', valor: 100 },
      ],
    });
    expect(v.errores.join(' ')).toMatch(/dos veces/i);
  });

  it('🔴 un insumo que entra y sale es un ciclo: se manda al factor de conversión', () => {
    const v = validarTransformacion({
      ...ok, salidas: [{ nombre: 'PLANCHA', cantidad: 8, unidad: 'und' }],
    });
    expect(v.ok).toBe(false);
    expect(v.errores.join(' ')).toMatch(/entra y sale/i);
    expect(v.errores.join(' ')).toMatch(/factor/i);
  });

  it('a mano: si no cierra, dice cuánto falta o cuánto sobra', () => {
    const v = validarTransformacion({
      ...ok, reparto: 'manual',
      salidas: [{ nombre: 'LAMINA', cantidad: 8, unidad: 'und', valor: 250 }],
    });
    expect(v.ok).toBe(false);
    expect(v.errores.join(' ')).toMatch(/sobran 50/i);
  });

  it('a mano: una diferencia dentro de la tolerancia del redondeo pasa', () => {
    const v = validarTransformacion({
      ...ok, reparto: 'manual',
      salidas: [{ nombre: 'LAMINA', cantidad: 8, unidad: 'und', valor: 200.03 }],
    });
    expect(v.ok).toBe(true);
  });

  it('los costos necesitan concepto y monto', () => {
    const v = validarTransformacion({ ...ok, costos: [{ concepto: '', monto: 10 }] });
    expect(v.errores.join(' ')).toMatch(/concepto/i);
  });

  it('avisa —sin bloquear— cuando se transforma más de lo que hay', () => {
    const insumoPorNorm = new Map([[normInsumo('PLANCHA'), {
      comprado: { veces: 1, cantidades: [{ unidad: 'und', cantidad: 1 }], montos: [{ moneda: 'PEN', monto: 100 }] },
      saldo: [],
    }]]);
    const v = validarTransformacion(ok, { insumoPorNorm });
    expect(v.ok).toBe(true);                       // ⚠ NO bloquea
    expect(v.avisos.join(' ')).toMatch(/hay 1 und y se están transformando 2/i);
    expect(v.avisos.join(' ')).toMatch(/otra empresa del grupo/i);
  });

  it('avisa cuando el insumo que entra no figura en el inventario', () => {
    const v = validarTransformacion(ok, { insumoPorNorm: new Map() });
    expect(v.ok).toBe(true);
    expect(v.avisos.join(' ')).toMatch(/no figura en el inventario/i);
  });

  it('avisa cuando lo que sale ya se compra (se suma a esa misma fila)', () => {
    const insumoPorNorm = new Map([
      [normInsumo('PLANCHA'), { comprado: { veces: 1, cantidades: [{ unidad: 'und', cantidad: 50 }], montos: [{ moneda: 'PEN', monto: 5000 }] }, saldo: [] }],
      [normInsumo('LAMINA'), { comprado: { veces: 3, cantidades: [], montos: [] }, saldo: [] }],
    ]);
    const v = validarTransformacion(ok, { insumoPorNorm });
    expect(v.avisos.join(' ')).toMatch(/ya se compra/i);
  });

  it('avisa cuando todo entra con valor cero', () => {
    const v = validarTransformacion({
      ...ok, entradas: [{ nombre: 'PLANCHA', cantidad: 2, unidad: 'und', valor: 0 }],
    });
    expect(v.avisos.join(' ')).toMatch(/costo cero/i);
  });
});

describe('costoUnitarioSugerido — propone, y cuando no sabe no inventa', () => {
  const ins = (montos, cantidades, veces = 3) => ({ comprado: { montos, cantidades, veces } });

  it('promedia lo comprado en esa unidad', () => {
    const s = costoUnitarioSugerido(ins(
      [{ moneda: 'PEN', monto: 2485.35 }], [{ unidad: 'und', cantidad: 21 }]
    ), 'UNIDAD');
    expect(s.costo).toBeCloseTo(118.35, 2);
    expect(s.moneda).toBe('PEN');
    expect(s.veces).toBe(3);
  });

  it('🔴 con dos monedas devuelve null: sumarlas sería inventar un tipo de cambio', () => {
    const s = costoUnitarioSugerido(ins(
      [{ moneda: 'PEN', monto: 100 }, { moneda: 'USD', monto: 50 }], [{ unidad: 'und', cantidad: 10 }]
    ), 'und');
    expect(s).toBe(null);
  });

  it('devuelve null si nunca se compró en esa unidad, o si no se compró', () => {
    expect(costoUnitarioSugerido(ins([{ moneda: 'PEN', monto: 100 }], [{ unidad: 'kg', cantidad: 10 }]), 'und')).toBe(null);
    expect(costoUnitarioSugerido(ins([], []), 'und')).toBe(null);
    expect(costoUnitarioSugerido(null, 'und')).toBe(null);
  });

  it('disponibleDe prefiere el saldo y cae a lo comprado', () => {
    const conSaldo = { saldo: [{ unidad: 'und', cantidad: 5 }], comprado: { cantidades: [{ unidad: 'und', cantidad: 21 }] } };
    expect(disponibleDe(conSaldo, 'und')).toBe(5);
    const sinSaldo = { saldo: [], comprado: { cantidades: [{ unidad: 'und', cantidad: 21 }] } };
    expect(disponibleDe(sinSaldo, 'UNIDAD')).toBe(21);
    expect(disponibleDe(sinSaldo, 'kg')).toBe(null);
  });
});

describe('efectoEnInventario — qué le hace cada transformación al saldo', () => {
  const t = (over = {}) => ({
    id: 't1', company_id: EMP, fecha: '2026-07-15', estado: 'registrada', deleted_at: null,
    entradas: [{ nombre: 'PLANCHA', nombre_norm: normInsumo('PLANCHA'), cantidad: 2, unidad: 'und', valor: 200 }],
    salidas: [{ nombre: 'LAMINA', nombre_norm: normInsumo('LAMINA'), cantidad: 8, unidad: 'und', valor: 200 }],
    ...over,
  });

  it('suma lo consumido y lo producido por insumo', () => {
    const m = efectoEnInventario([t(), t({ id: 't2' })], { companyId: EMP });
    expect(m.get(normInsumo('PLANCHA')).consumido).toEqual([{ unidad: 'und', label: 'und', cantidad: 4 }]);
    expect(m.get(normInsumo('LAMINA')).producido).toEqual([{ unidad: 'und', label: 'und', cantidad: 16 }]);
    expect(m.get(normInsumo('PLANCHA')).valorConsumido).toBe(400);
    expect(m.get(normInsumo('LAMINA')).valorProducido).toBe(400);
  });

  it('🔴 una anulada o borrada no mueve nada', () => {
    expect(efectoEnInventario([t({ estado: 'anulada' })], { companyId: EMP }).size).toBe(0);
    expect(efectoEnInventario([t({ deleted_at: '2026-09-15' })], { companyId: EMP }).size).toBe(0);
  });

  it('no mezcla empresas', () => {
    expect(efectoEnInventario([t({ company_id: 'otra' })], { companyId: EMP }).size).toBe(0);
    expect(efectoEnInventario([t({ company_id: 'otra' })]).size).toBe(2);
  });

  it('lee las líneas aunque el jsonb venga como string', () => {
    const m = efectoEnInventario([t({ entradas: JSON.stringify(t().entradas) })], { companyId: EMP });
    expect(m.get(normInsumo('PLANCHA')).consumido[0].cantidad).toBe(2);
    expect(leerLineas('no es json')).toEqual([]);
    expect(leerLineas(null)).toEqual([]);
  });

  it('cada unidad va por su lado', () => {
    const m = efectoEnInventario([t({
      salidas: [
        { nombre: 'LAMINA', nombre_norm: normInsumo('LAMINA'), cantidad: 8, unidad: 'und', valor: 150 },
        { nombre: 'LAMINA', nombre_norm: normInsumo('LAMINA'), cantidad: 3, unidad: 'kg', valor: 50 },
      ],
    })], { companyId: EMP });
    const lam = m.get(normInsumo('LAMINA'));
    expect(lam.producido.length).toBe(2);
    expect(lam.producido.find(p => p.unidad === 'kg').cantidad).toBe(3);
  });

  it('el resumen y el orden de la lista', () => {
    const filas = [t(), t({ id: 't2', fecha: '2026-08-01' }), t({ id: 't3', estado: 'anulada' })];
    expect(transformacionesDe(filas, EMP)[0].id).toBe('t2');
    const r = resumenTransformaciones(filas, EMP);
    expect(r.registradas).toBe(2);
    expect(r.anuladas).toBe(1);
    expect(r.valor).toBe(400);
    expect(r.insumos).toBe(2);
    expect(resumirTransformacion(t())).toBe('2 und PLANCHA → 8 und LAMINA');
  });
});

describe('inventarioDeEmpresa con transformaciones', () => {
  // Una compra real de GASOMI, medida el 15-set-2026 en producción:
  // F004-33864 (24-jun) trajo 21 planchas LAF 1/16 por S/ 2.485,35.
  const MOVS = [{
    id: 'mv1', company_id: EMP, date: '2026-06-24', type: 'cost', clase: 'compra',
    currency: 'PEN', amount: 2932.71, third_party_name: 'ACEROS SAC', document_number: 'F004-33864',
    notas: { items_factura: [
      { descripcion: 'PLANCHA LAF(1/16)1.45X1200X2400MM', unidad: 'UNIDAD', cantidad: 21, precio_unitario: 118.35, tipo_insumo: 'material' },
    ] },
  }];
  const lineas = () => extraerLineasDeFacturas(MOVS);
  const TRANSF = [{
    id: 't1', company_id: EMP, fecha: '2026-07-15', estado: 'registrada', deleted_at: null,
    entradas: [{ nombre: 'PLANCHA LAF(1/16)1.45X1200X2400MM', nombre_norm: normInsumo('PLANCHA LAF(1/16)1.45X1200X2400MM'), cantidad: 6, unidad: 'und', valor: 710.10 }],
    costos: [{ concepto: 'CORTE GUILLOTINA', monto: 133.47 }],
    salidas: [{ nombre: 'LAMINA 30X30', nombre_norm: normInsumo('LAMINA 30X30'), cantidad: 24, unidad: 'und', valor: 843.57 }],
    valor_entradas: 710.10, valor_costos: 133.47, valor_salidas: 843.57,
  }];
  const conTransf = () => inventarioDeEmpresa(lineas(), {
    companyId: EMP, transformadoDe: efectoEnInventario(TRANSF, { companyId: EMP }),
  });

  it('🔴 sin transformaciones nada cambia', () => {
    const inv = inventarioDeEmpresa(lineas(), { companyId: EMP });
    const plancha = inv.insumos[0];
    expect(plancha.transformado).toBe(null);
    expect(plancha.saldo).toEqual([]);            // sin ventas, el saldo no se muestra
    expect(plancha.costoNetoPen).toBeCloseTo(plancha.totalCompraPen, 2);
    expect(inv.totales.insumosTransformados).toBe(0);
    expect(inv.totales.insumosProducidos).toBe(0);
  });

  it('el saldo de lo que se consumió baja, aunque nunca se haya vendido', () => {
    const inv = conTransf();
    const plancha = inv.insumos.find(i => i.display.includes('PLANCHA'));
    expect(plancha.transformado.consumido[0].cantidad).toBe(6);
    // 21 compradas − 6 transformadas = 15
    expect(plancha.saldo.find(s => s.unidad === 'und').cantidad).toBe(15);
  });

  it('🔴 lo que salió aparece como insumo propio, aunque no tenga ni una factura', () => {
    const inv = conTransf();
    const lamina = inv.insumos.find(i => i.display.includes('LAMINA'));
    expect(lamina).toBeTruthy();
    expect(lamina.origen).toBe('transformacion');
    expect(lamina.comprado.veces).toBe(0);
    expect(lamina.saldo.find(s => s.unidad === 'und').cantidad).toBe(24);
    expect(lamina.costoNetoPen).toBeCloseTo(843.57, 2);
    expect(inv.totales.insumosProducidos).toBe(1);
  });

  it('🔴 el mismo sol no se cuenta dos veces: sale de una fila y entra en la otra', () => {
    const inv = conTransf();
    const plancha = inv.insumos.find(i => i.display.includes('PLANCHA'));
    const lamina = inv.insumos.find(i => i.display.includes('LAMINA'));
    // La plancha se queda con lo comprado menos lo que se llevó la transformación…
    expect(plancha.costoNetoPen).toBeCloseTo(2485.35 - 710.10, 2);
    // …y la lámina vale eso MÁS el corte, que es plata nueva y facturada aparte.
    expect(lamina.costoNetoPen - 710.10).toBeCloseTo(133.47, 2);
  });

  it('una lámina vendida tiene margen aunque nadie la haya comprado nunca', () => {
    const conVenta = [...MOVS, {
      id: 'mv2', company_id: EMP, date: '2026-08-31', type: 'income', clase: 'venta',
      currency: 'PEN', amount: 1200, third_party_name: 'CLIENTE SAC', document_number: 'E001-306',
      notas: { items_factura: [
        { descripcion: 'LAMINA 30X30', unidad: 'und', cantidad: 20, precio_unitario: 50, tipo_insumo: 'material' },
      ] },
    }];
    const inv = inventarioDeEmpresa(extraerLineasDeFacturas(conVenta), {
      companyId: EMP, transformadoDe: efectoEnInventario(TRANSF, { companyId: EMP }),
    });
    const lamina = inv.insumos.find(i => i.display.includes('LAMINA'));
    expect(lamina.origen).toBe('factura');               // ahora sí tiene línea propia
    expect(lamina.totalVentaPen).toBe(1000);
    expect(lamina.costoNetoPen).toBeCloseTo(843.57, 2);
    expect(lamina.margenEconomicoPen).toBeCloseTo(1000 - 843.57, 2);
    // Y el saldo: 24 producidas − 20 vendidas
    expect(lamina.saldo.find(s => s.unidad === 'und').cantidad).toBe(4);
  });

  it('🔴 un producido correlacionado con un insumo que ya se compra NO abre una fila aparte', () => {
    // El caso que rompía: «LAMINA 30X30» sale de la transformación y está
    // correlacionada con «LAMINA 30 X 30», que sí se compra. Buscando por
    // nombre normalizado no se encontraban y aparecían DOS filas del mismo
    // insumo, cada una con medio saldo.
    const grupoDe = new Map([
      [normInsumo('LAMINA 30X30'), 'gl'],
      [normInsumo('LAMINA 30 X 30'), 'gl'],
    ]);
    const grupos = new Map([['gl', { canonico: 'LAMINA 30 X 30' }]]);
    const movs2 = [...MOVS, {
      id: 'mv9', company_id: EMP, date: '2026-07-20', type: 'cost', clase: 'compra',
      currency: 'PEN', amount: 300, third_party_name: 'OTRO SAC', document_number: 'F-1',
      notas: { items_factura: [{ descripcion: 'LAMINA 30 X 30', unidad: 'und', cantidad: 5, precio_unitario: 40, tipo_insumo: 'material' }] },
    }];
    const inv = inventarioDeEmpresa(extraerLineasDeFacturas(movs2), {
      companyId: EMP, grupoDe, grupos,
      transformadoDe: efectoEnInventario(TRANSF, { companyId: EMP }),
    });
    const laminas = inv.insumos.filter(i => i.display.toUpperCase().includes('LAMINA'));
    expect(laminas.length).toBe(1);                       // UNA fila, no dos
    expect(laminas[0].comprado.veces).toBe(1);            // la compra sigue ahí
    expect(laminas[0].transformado.producido[0].cantidad).toBe(24);
    expect(laminas[0].saldo.find(s => s.unidad === 'und').cantidad).toBe(29);  // 5 + 24
    // Y las claves no se repiten en toda la lista (una clave duplicada sería
    // una key de React repetida y dos filas del mismo insumo).
    expect(new Set(inv.insumos.map(i => i.clave)).size).toBe(inv.insumos.length);
  });

  it('el efecto se suma sobre TODAS las variantes del grupo, no sobre la primera', () => {
    const grupoDe = new Map([
      [normInsumo('PLANCHA LAF(1/16)1.45X1200X2400MM'), 'g1'],
      [normInsumo('PLANCHA LAF 1/16'), 'g1'],
    ]);
    const grupos = new Map([['g1', { canonico: 'PLANCHA LAF 1/16' }]]);
    const transf = [
      TRANSF[0],
      { ...TRANSF[0], id: 't2',
        entradas: [{ nombre: 'PLANCHA LAF 1/16', nombre_norm: normInsumo('PLANCHA LAF 1/16'), cantidad: 4, unidad: 'und', valor: 473.40 }],
        salidas: [{ nombre: 'LAMINA 30X30', nombre_norm: normInsumo('LAMINA 30X30'), cantidad: 16, unidad: 'und', valor: 473.40 }],
        costos: [] },
    ];
    const movs2 = [...MOVS, {
      id: 'mv3', company_id: EMP, date: '2026-06-25', type: 'cost', clase: 'compra',
      currency: 'PEN', amount: 500, third_party_name: 'ACEROS SAC', document_number: 'F004-33999',
      notas: { items_factura: [{ descripcion: 'PLANCHA LAF 1/16', unidad: 'und', cantidad: 4, precio_unitario: 118.35, tipo_insumo: 'material' }] },
    }];
    const inv = inventarioDeEmpresa(extraerLineasDeFacturas(movs2), {
      companyId: EMP, grupoDe, grupos,
      transformadoDe: efectoEnInventario(transf, { companyId: EMP }),
    });
    const plancha = inv.insumos.find(i => i.display.includes('PLANCHA'));
    expect(plancha.transformado.consumido[0].cantidad).toBe(10);   // 6 + 4, no 6
    expect(plancha.saldo.find(s => s.unidad === 'und').cantidad).toBe(15);  // 25 − 10
  });
});

describe('detalles que no se rompen', () => {
  it('unidadDeLinea normaliza y cae en und', () => {
    expect(unidadDeLinea('UNIDAD')).toBe('und');
    expect(unidadDeLinea('')).toBe('und');
    expect(unidadDeLinea('KG')).toBe('kg');
  });

  it('los tres repartos están documentados', () => {
    for (const r of REPARTOS) {
      expect(REPARTO_INFO[r].label).toBeTruthy();
      expect(REPARTO_INFO[r].ayuda.length).toBeGreaterThan(30);
    }
  });
});
