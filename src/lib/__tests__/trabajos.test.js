import { describe, it, expect } from 'vitest';
import {
  TIPOS, ESTADOS, ESTADOS_COTIZACION, ESTADO_LBL, ESTADO_BADGE,
  esAbierto, cotizacionesDe, cotizacionAceptada,
  resumenEconomico, totales, validarTrabajo, filtrarTrabajos,
} from '../trabajos.js';

const W = 'trab-1';
const mov = (o) => ({ id: Math.random().toString(36), trabajo_id: W, currency: 'PEN', ...o });

describe('espejo de los CHECK de la mig 174', () => {
  it('tipos y estados coinciden con el servidor', () => {
    expect(TIPOS.map(t => t.v)).toEqual(['bien', 'servicio']);
    expect(ESTADOS.map(e => e.v)).toEqual([
      'cotizacion', 'adjudicado', 'ejecucion', 'entregado', 'cerrado', 'cancelado',
    ]);
    expect(ESTADOS_COTIZACION.map(e => e.v)).toEqual([
      'borrador', 'enviada', 'aceptada', 'rechazada', 'vencida',
    ]);
  });

  it('cada estado tiene etiqueta y badge', () => {
    for (const e of ESTADOS) {
      expect(ESTADO_LBL[e.v]).toBeTruthy();
      expect(ESTADO_BADGE[e.v]).toMatch(/^b-/);
    }
  });

  it('cerrado y cancelado no son estados abiertos', () => {
    expect(esAbierto('ejecucion')).toBe(true);
    expect(esAbierto('cerrado')).toBe(false);
    expect(esAbierto('cancelado')).toBe(false);
    expect(esAbierto('inventado')).toBe(false);
  });
});

describe('resumenEconomico — el margen se calcula, nunca se guarda', () => {
  it('compra 800 y vende 1000 → margen 200, 20%', () => {
    const movs = [
      mov({ type: 'cost', amount: 800 }),
      mov({ type: 'income', amount: 1000 }),
    ];
    const r = resumenEconomico(W, movs);
    expect(r).toMatchObject({ compras: 800, ventas: 1000, margen: 200, pct: 20, nMovs: 2 });
  });

  it('los gastos cuentan como costo del trabajo', () => {
    const r = resumenEconomico(W, [mov({ type: 'expense', amount: 50 }), mov({ type: 'income', amount: 150 })]);
    expect(r.compras).toBe(50);
    expect(r.margen).toBe(100);
  });

  it('sin ventas el porcentaje es null, no Infinity', () => {
    // Dividir por cero pintaría un margen espectacular en un trabajo que no
    // vendió nada todavía.
    const r = resumenEconomico(W, [mov({ type: 'cost', amount: 500 })]);
    expect(r.pct).toBeNull();
    expect(r.margen).toBe(-500);
  });

  it('una factura ANULADA no infla el margen', () => {
    const movs = [
      mov({ type: 'income', amount: 1000 }),
      mov({ type: 'income', amount: 9999, estado_factura: 'anulada' }),
    ];
    expect(resumenEconomico(W, movs).ventas).toBe(1000);
  });

  it('no mezcla monedas: cuenta las otras aparte', () => {
    const movs = [
      mov({ type: 'income', amount: 1000 }),
      mov({ type: 'income', amount: 500, currency: 'USD' }),
    ];
    const r = resumenEconomico(W, movs);
    expect(r.ventas).toBe(1000);
    expect(r.otraMoneda).toBe(1);
    // Y pedido en dólares, al revés.
    expect(resumenEconomico(W, movs, 'USD').ventas).toBe(500);
  });

  it('un movimiento sin currency se asume en soles', () => {
    const r = resumenEconomico(W, [{ trabajo_id: W, type: 'income', amount: 100 }]);
    expect(r.ventas).toBe(100);
    expect(r.otraMoneda).toBe(0);
  });

  it('ignora movimientos de otro trabajo, borrados y montos basura', () => {
    const movs = [
      mov({ type: 'income', amount: 100, trabajo_id: 'otro' }),
      mov({ type: 'income', amount: 100, deleted_at: 'x' }),
      mov({ type: 'income', amount: 'no-es-numero' }),
    ];
    const r = resumenEconomico(W, movs);
    expect(r.ventas).toBe(0);
  });

  it('no explota sin datos', () => {
    expect(resumenEconomico(null, null).margen).toBe(0);
    expect(resumenEconomico(W, undefined).nMovs).toBe(0);
  });
});

describe('totales', () => {
  it('suma la cartera y cuenta los abiertos', () => {
    const trabajos = [
      { id: 'a', estado: 'ejecucion' },
      { id: 'b', estado: 'cerrado' },
      { id: 'c', estado: 'cancelado', deleted_at: null },
    ];
    const movs = [
      { trabajo_id: 'a', type: 'cost', amount: 100, currency: 'PEN' },
      { trabajo_id: 'a', type: 'income', amount: 250, currency: 'PEN' },
      { trabajo_id: 'b', type: 'income', amount: 50, currency: 'PEN' },
    ];
    const t = totales(trabajos, movs);
    expect(t).toMatchObject({ n: 3, abiertos: 1, compras: 100, ventas: 300, margen: 200 });
  });
});

describe('cotizaciones', () => {
  const cots = [
    { id: 'c1', trabajo_id: W, fecha: '2026-01-10', estado: 'rechazada' },
    { id: 'c2', trabajo_id: W, fecha: '2026-03-05', estado: 'aceptada' },
    { id: 'c3', trabajo_id: 'otro', fecha: '2026-04-01', estado: 'aceptada' },
    { id: 'c4', trabajo_id: W, fecha: '2026-02-01', estado: 'enviada', deleted_at: 'x' },
  ];

  it('lista solo las suyas y vivas, la más reciente primero', () => {
    expect(cotizacionesDe(W, cots).map(c => c.id)).toEqual(['c2', 'c1']);
  });

  it('encuentra la aceptada, que es el monto pactado', () => {
    expect(cotizacionAceptada(W, cots)?.id).toBe('c2');
    expect(cotizacionAceptada('sin-cots', cots)).toBeNull();
  });
});

describe('validarTrabajo', () => {
  const ok = { nombre: 'Venta de cemento', tipo: 'bien', estado: 'cotizacion', ejecutor_company_id: 'c1' };

  it('acepta el caso correcto', () => {
    expect(validarTrabajo(ok).ok).toBe(true);
  });

  it('exige nombre, tipo y quién lo vende', () => {
    expect(validarTrabajo({ ...ok, nombre: '  ' }).errores.join(' ')).toContain('nombre');
    expect(validarTrabajo({ ...ok, tipo: 'otro' }).errores.join(' ')).toContain('bien o un servicio');
    expect(validarTrabajo({ ...ok, ejecutor_company_id: null }).errores.join(' ')).toContain('quién lo vende');
  });

  it('un consorcio también puede prestarlo', () => {
    expect(validarTrabajo({ ...ok, ejecutor_company_id: null, consorcio_id: 'k1' }).ok).toBe(true);
  });

  it('rechaza monto negativo y fechas invertidas', () => {
    expect(validarTrabajo({ ...ok, monto_estimado: -5 }).ok).toBe(false);
    expect(validarTrabajo({ ...ok, fecha_inicio: '2026-05-01', fecha_fin: '2026-04-01' }).ok).toBe(false);
  });

  it('el monto vacío es válido: es opcional', () => {
    expect(validarTrabajo({ ...ok, monto_estimado: '' }).ok).toBe(true);
    expect(validarTrabajo({ ...ok, monto_estimado: null }).ok).toBe(true);
  });
});

describe('filtrarTrabajos', () => {
  const ws = [
    { id: 'a', nombre: 'Venta de cemento', codigo: 'BS-001', cliente: 'Municipalidad', tipo: 'bien', estado: 'ejecucion' },
    { id: 'b', nombre: 'Topografía', cliente: 'Minera X', cliente_ruc: '20123456789', tipo: 'servicio', estado: 'cerrado' },
    { id: 'c', nombre: 'Borrado', tipo: 'bien', estado: 'ejecucion', deleted_at: 'x' },
  ];

  it('busca por nombre, código, cliente y RUC, sin distinguir mayúsculas', () => {
    expect(filtrarTrabajos(ws, { texto: 'CEMENTO' }).map(w => w.id)).toEqual(['a']);
    expect(filtrarTrabajos(ws, { texto: 'bs-001' }).map(w => w.id)).toEqual(['a']);
    expect(filtrarTrabajos(ws, { texto: 'minera' }).map(w => w.id)).toEqual(['b']);
    expect(filtrarTrabajos(ws, { texto: '2012345' }).map(w => w.id)).toEqual(['b']);
  });

  it('filtra por estado y tipo, y nunca devuelve borrados', () => {
    expect(filtrarTrabajos(ws, { estado: 'ejecucion' }).map(w => w.id)).toEqual(['a']);
    expect(filtrarTrabajos(ws, { tipo: 'servicio' }).map(w => w.id)).toEqual(['b']);
    expect(filtrarTrabajos(ws, {}).map(w => w.id)).toEqual(['a', 'b']);
  });
});
