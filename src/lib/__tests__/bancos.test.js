import { describe, it, expect } from 'vitest';
import {
  normalizarBanco, etiquetaBanco, nombreCuenta, saldoCorrido, cuadreDeCuenta,
  totales, agruparPorEntidad, normalizarRef, pendientesDeJarvex, puntajeCruce,
  sugerirCruces, huellaLinea, detectarColumnas, parsearExtracto, tipoDesde,
} from '../bancos.js';

describe('la entidad bancaria', () => {
  it('agrupa el mismo banco escrito de tres formas', () => {
    expect(normalizarBanco('BCP')).toBe('bcp');
    expect(normalizarBanco('bcp')).toBe('bcp');
    expect(normalizarBanco('Banco de Crédito del Perú')).toBe('bcp');
    expect(normalizarBanco('BBVA Continental')).toBe('bbva');
    expect(normalizarBanco('Banco de la Nacion')).toBe('nacion');
  });
  it('a la caja sin alias le sirve su propio nombre como código', () => {
    expect(normalizarBanco('Caja Huancayo')).toBe('caja_huancayo');
    expect(normalizarBanco('  Caja   Huancayo ')).toBe('caja_huancayo');
  });
  it('sin texto no inventa banco', () => {
    expect(normalizarBanco('')).toBeNull();
    expect(normalizarBanco(null)).toBeNull();
  });
  it('muestra el nombre lindo, o lo que escribió el usuario', () => {
    expect(etiquetaBanco('bcp')).toBe('BCP');
    expect(etiquetaBanco('caja_huancayo', 'Caja Huancayo')).toBe('Caja Huancayo');
  });
  it('nombra la cuenta por su alias, o por banco + últimos 4', () => {
    expect(nombreCuenta({ alias: 'La del consorcio', banco: 'BCP' })).toBe('La del consorcio');
    expect(nombreCuenta({ banco_codigo: 'bcp', numero_cuenta: '19112345670088' })).toBe('BCP ···0088');
    expect(nombreCuenta({ banco_codigo: 'nacion', tipo: 'detracciones', numero_cuenta: '00012345' }))
      .toBe('Banco de la Nación detracciones ···2345');
  });
});

describe('el saldo sale de los movimientos', () => {
  const movs = [
    { id: 'b', fecha: '2026-08-02', monto: -300 },
    { id: 'a', fecha: '2026-08-01', monto: 1000 },
    { id: 'c', fecha: '2026-08-03', monto: -200 },
  ];
  it('corre en orden de fecha y acumula', () => {
    const f = saldoCorrido(movs, 500);
    expect(f.map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(f.map(x => x.saldo)).toEqual([1500, 1200, 1000]);
  });
  it('desempata el mismo día sin bailar entre renders', () => {
    const mismos = [
      { id: 'z', fecha: '2026-08-01', monto: 10, created_at: '2026-08-01T10:00:00Z' },
      { id: 'a', fecha: '2026-08-01', monto: 20, created_at: '2026-08-01T09:00:00Z' },
    ];
    expect(saldoCorrido(mismos, 0).map(x => x.id)).toEqual(['a', 'z']);
    expect(saldoCorrido(mismos.slice().reverse(), 0).map(x => x.id)).toEqual(['a', 'z']);
  });
  it('sin movimientos, el saldo es el inicial', () => {
    expect(saldoCorrido([], 250)).toEqual([]);
    expect(cuadreDeCuenta([], 250).calculado).toBe(250);
  });
});

describe('el cuadre contra lo que dice el banco', () => {
  it('cuadra cuando el calculado llega al saldo del extracto', () => {
    const movs = [
      { id: 'a', fecha: '2026-08-01', monto: 1000, origen: 'extracto', saldo_extracto: 1000 },
      { id: 'b', fecha: '2026-08-02', monto: -300, origen: 'extracto', saldo_extracto: 700 },
    ];
    const c = cuadreDeCuenta(movs, 0);
    expect(c.cuadra).toBe(true);
    expect(c.diferencia).toBe(0);
    expect(c.banco).toBe(700);
  });
  it('delata el movimiento que falta', () => {
    // El banco dice 700 pero solo registramos el ingreso: faltan -300.
    const movs = [{ id: 'a', fecha: '2026-08-02', monto: 1000, origen: 'extracto', saldo_extracto: 700 }];
    const c = cuadreDeCuenta(movs, 0);
    expect(c.cuadra).toBe(false);
    expect(c.diferencia).toBe(300);
  });
  it('un movimiento manual posterior no se usa como referencia del banco', () => {
    const movs = [
      { id: 'a', fecha: '2026-08-01', monto: 1000, origen: 'extracto', saldo_extracto: 1000 },
      { id: 'b', fecha: '2026-08-05', monto: -50, origen: 'manual' },
    ];
    const c = cuadreDeCuenta(movs, 0);
    expect(c.cuadra).toBe(true);       // cuadra HASTA la línea del banco
    expect(c.calculado).toBe(950);     // pero el saldo de hoy ya bajó
    expect(c.hasta).toBe('2026-08-01');
  });
  it('sin ninguna línea del banco, no hay contra qué cuadrar', () => {
    const c = cuadreDeCuenta([{ id: 'a', fecha: '2026-08-01', monto: 10, origen: 'manual' }], 0);
    expect(c.cuadra).toBeNull();
    expect(c.banco).toBeNull();
  });
});

describe('totales', () => {
  it('separa lo que entró de lo que salió y cuenta lo pendiente', () => {
    const t = totales([
      { monto: 1000, conciliado: true },
      { monto: -300, conciliado: false },
      { monto: -200, conciliado: false },
    ]);
    expect(t).toEqual({ entradas: 1000, salidas: 500, neto: 500, sinConciliar: 2, total: 3 });
  });
});

describe('el árbol titular › entidad › cuentas', () => {
  const companies = [
    { id: 'inca', name: 'CONSORCIO EL INCA', tipo_entidad: 'consorcio', ruc: '20615346081' },
    { id: 'jx', name: 'JARVEX', tipo_entidad: 'propia', ruc: '20615646505' },
  ];
  const cuentas = [
    { id: 'c1', company_id: 'inca', banco: 'BCP', banco_codigo: 'bcp', saldo_inicial: 1000 },
    { id: 'c2', company_id: 'inca', banco: 'Banco de la Nación', banco_codigo: 'nacion', saldo_inicial: 0 },
    { id: 'c3', company_id: 'jx', banco: 'BCP', banco_codigo: 'bcp', saldo_inicial: 500 },
  ];
  const movs = [
    { id: 'm1', cuenta_id: 'c1', fecha: '2026-08-01', monto: -400, conciliado: true },
    { id: 'm2', cuenta_id: 'c2', fecha: '2026-08-01', monto: 250, conciliado: false },
  ];

  it('pone el consorcio primero: es el que ejecuta obra', () => {
    const t = agruparPorEntidad(cuentas, movs, companies);
    expect(t.map(x => x.nombre)).toEqual(['CONSORCIO EL INCA', 'JARVEX']);
    expect(t[0].tipo_entidad).toBe('consorcio');
  });
  it('suma el saldo por banco y por titular', () => {
    const [inca, jx] = agruparPorEntidad(cuentas, movs, companies);
    expect(inca.saldo).toBe(850);            // 1000-400 + 0+250
    expect(inca.cuentas).toBe(2);
    expect(inca.bancos.map(b => b.codigo).sort()).toEqual(['bcp', 'nacion']);
    expect(inca.bancos.find(b => b.codigo === 'bcp').saldo).toBe(600);
    expect(inca.sinConciliar).toBe(1);
    expect(jx.saldo).toBe(500);
  });
  it('la cuenta de una empresa borrada no rompe el árbol', () => {
    const t = agruparPorEntidad([{ id: 'c9', company_id: 'fantasma', banco: 'BCP' }], [], companies);
    expect(t[0].nombre).toBe('(empresa eliminada)');
  });
});

describe('el lado de JARVEX', () => {
  const partes = [
    { id: 'p1', fecha: '2026-08-01', monto: 5000, metodo: 'transferencia', referencia: '00123456' },
    { id: 'p2', fecha: '2026-08-02', monto: 300, metodo: 'efectivo', referencia: null },
    { id: 'p3', fecha: '2026-08-03', monto: 700, metodo: 'deposito', referencia: '998877', deleted_at: '2026-08-04' },
  ];
  const depositos = [
    { id: 'd1', fecha: '2026-08-05', monto_total: 20000, clase: 'compra', referencia: '555000', tercero_nombre: 'ACME' },
    { id: 'd2', fecha: '2026-08-06', monto_total: 9000, clase: 'venta', referencia: '777000', tercero_nombre: 'MUNI' },
  ];

  it('deja afuera el efectivo: nunca pasó por el banco', () => {
    const p = pendientesDeJarvex({ partes, depositos });
    expect(p.find(x => x.id === 'p2')).toBeUndefined();
  });
  it('deja afuera lo borrado', () => {
    expect(pendientesDeJarvex({ partes, depositos }).find(x => x.id === 'p3')).toBeUndefined();
  });
  it('el pago sale con signo negativo y la venta con positivo', () => {
    const p = pendientesDeJarvex({ partes, depositos });
    expect(p.find(x => x.id === 'p1').monto).toBe(-5000);
    expect(p.find(x => x.id === 'd1').monto).toBe(-20000);
    expect(p.find(x => x.id === 'd2').monto).toBe(9000);
  });
  it('lo ya cruzado deja de estar pendiente', () => {
    const movs = [{ id: 'm', pago_parte_id: 'p1' }, { id: 'm2', deposito_id: 'd1' }];
    const p = pendientesDeJarvex({ partes, depositos, movimientos: movs });
    expect(p.map(x => x.id)).toEqual(['d2']);
  });
  it('filtrando por cuenta, no muestra lo de otra cuenta', () => {
    const conCuenta = [{ ...partes[0], cuenta_id: 'otra' }];
    expect(pendientesDeJarvex({ partes: conCuenta, cuentaId: 'c1' })).toEqual([]);
    // lo que todavía no tiene cuenta asignada SÍ se ofrece: es justo lo que hay que resolver
    expect(pendientesDeJarvex({ partes: [partes[0]], cuentaId: 'c1' })).toHaveLength(1);
  });
});

describe('la referencia comparable', () => {
  it('ignora ceros a la izquierda y letras', () => {
    expect(normalizarRef('00123456')).toBe('123456');
    expect(normalizarRef('OP-123456')).toBe('123456');
    expect(normalizarRef('123456')).toBe('123456');
  });
  it('menos de 4 dígitos no identifica nada', () => {
    expect(normalizarRef('12')).toBeNull();
    expect(normalizarRef('')).toBeNull();
  });
});

describe('el puntaje del cruce', () => {
  const linea = { id: 'l1', fecha: '2026-08-01', monto: -5000, referencia: '00123456' };
  it('n° de operación + monto exacto + mismo día = casi seguro', () => {
    const p = puntajeCruce(linea, { fecha: '2026-08-01', monto: -5000, referencia: '123456' });
    expect(p).toBeGreaterThanOrEqual(85);
  });
  it('el monto distinto lo mata, aunque coincida el número', () => {
    expect(puntajeCruce(linea, { fecha: '2026-08-01', monto: -4000, referencia: '123456' })).toBe(0);
  });
  it('signo distinto no es la misma operación', () => {
    expect(puntajeCruce(linea, { fecha: '2026-08-01', monto: 5000, referencia: '123456' })).toBe(0);
  });
  it('fuera de la ventana de días, no cruza', () => {
    expect(puntajeCruce(linea, { fecha: '2026-09-01', monto: -5000, referencia: '123456' })).toBe(0);
  });
  it('dos números de operación que NO coinciden bajan el puntaje', () => {
    const conRef = puntajeCruce(linea, { fecha: '2026-08-01', monto: -5000, referencia: '999999' });
    const sinRef = puntajeCruce(linea, { fecha: '2026-08-01', monto: -5000, referencia: null });
    expect(conRef).toBeLessThan(sinRef);
  });
});

describe('el emparejado', () => {
  const lineas = [
    { id: 'l1', fecha: '2026-08-01', monto: -5000, referencia: '123456' },
    { id: 'l2', fecha: '2026-08-02', monto: -80, referencia: null, descripcion: 'COMISION MANT' },
    { id: 'l3', fecha: '2026-08-03', monto: -1200, referencia: null },
  ];
  const pend = [
    { clase: 'pago_parte', id: 'p1', fecha: '2026-08-01', monto: -5000, referencia: '00123456' },
    { clase: 'pago_parte', id: 'p2', fecha: '2026-08-03', monto: -1200, referencia: null },
    { clase: 'deposito', id: 'd9', fecha: '2026-07-01', monto: -9999, referencia: null },
  ];

  it('cruza lo que cruza y deja lo demás de cada lado', () => {
    const r = sugerirCruces(lineas, pend);
    expect(r.seguros.map(x => x.linea.id)).toEqual(['l1']);
    expect(r.probables.map(x => x.linea.id)).toEqual(['l3']);
    expect(r.soloBanco.map(x => x.id)).toEqual(['l2']);      // la comisión que nadie registró
    expect(r.soloJarvex.map(x => x.id)).toEqual(['d9']);     // lo registrado que el banco no muestra
  });
  it('nunca usa la misma constancia dos veces', () => {
    const dosIguales = [
      { id: 'la', fecha: '2026-08-01', monto: -5000, referencia: '123456' },
      { id: 'lb', fecha: '2026-08-01', monto: -5000, referencia: '123456' },
    ];
    const r = sugerirCruces(dosIguales, [pend[0]]);
    expect(r.seguros.length + r.probables.length).toBe(1);
    expect(r.soloBanco).toHaveLength(1);
  });
  it('no propone nada sobre una línea ya conciliada', () => {
    const r = sugerirCruces([{ ...lineas[0], conciliado: true }], [pend[0]]);
    expect(r.seguros).toHaveLength(0);
    expect(r.soloBanco).toHaveLength(0);
  });
});

describe('importar el extracto', () => {
  it('reconoce las columnas se llamen como se llamen', () => {
    const c = detectarColumnas(['Fecha Operación', 'Descripción', 'Nro. Operación', 'Cargo', 'Abono', 'Saldo']);
    expect(c.fecha).toBe('Fecha Operación');
    expect(c.descripcion).toBe('Descripción');
    expect(c.referencia).toBe('Nro. Operación');
    expect(c.cargo).toBe('Cargo');
    expect(c.abono).toBe('Abono');
    expect(c.saldo).toBe('Saldo');
  });

  it('cargo/abono se vuelven un monto con signo', () => {
    const { lineas } = parsearExtracto([
      { Fecha: '01/08/2026', Descripción: 'TRANSF A TERCEROS', 'N° Operación': '123456', Cargo: '5,000.00', Abono: '', Saldo: '10,000.00' },
      { Fecha: '02/08/2026', Descripción: 'ABONO', 'N° Operación': '', Cargo: '', Abono: '2,500.50', Saldo: '12,500.50' },
    ]);
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toMatchObject({ fecha: '2026-08-01', monto: -5000, tipo: 'transferencia_out', saldo_extracto: 10000 });
    expect(lineas[1]).toMatchObject({ fecha: '2026-08-02', monto: 2500.5, tipo: 'deposito' });
  });

  it('lee dd/mm/aaaa (Perú) y no lo confunde con mm/dd', () => {
    const { lineas } = parsearExtracto([{ Fecha: '03/09/2026', Monto: '-100', Descripción: 'x' }]);
    expect(lineas[0].fecha).toBe('2026-09-03');
  });

  it('lee 1.234,56 igual que 1,234.56', () => {
    const a = parsearExtracto([{ Fecha: '01/08/2026', Monto: '1.234,56', Descripción: 'x' }]).lineas[0];
    const b = parsearExtracto([{ Fecha: '01/08/2026', Monto: '1,234.56', Descripción: 'x' }]).lineas[0];
    expect(a.monto).toBe(1234.56);
    expect(b.monto).toBe(1234.56);
  });

  it('los paréntesis de contabilidad son negativo', () => {
    const { lineas } = parsearExtracto([{ Fecha: '01/08/2026', Monto: '(1,200.00)', Descripción: 'x' }]);
    expect(lineas[0].monto).toBe(-1200);
  });

  it('no se traga la fila mala: la devuelve con el motivo', () => {
    const { lineas, descartadas } = parsearExtracto([
      { Fecha: 'TOTAL DEL MES', Monto: '9999', Descripción: '' },
      { Fecha: '01/08/2026', Monto: '', Descripción: 'sin monto' },
      { Fecha: '01/08/2026', Monto: '100', Descripción: 'buena' },
    ]);
    expect(lineas).toHaveLength(1);
    expect(descartadas.map(d => d.motivo)).toEqual(['sin fecha reconocible', 'sin monto']);
  });

  it('la misma línea repetida en el archivo entra una sola vez', () => {
    const fila = { Fecha: '01/08/2026', Monto: '-100', Descripción: 'PAGO', 'N° Operación': '123456' };
    const { lineas, descartadas } = parsearExtracto([fila, { ...fila }]);
    expect(lineas).toHaveLength(1);
    expect(descartadas[0].motivo).toBe('repetida en el archivo');
  });

  it('la huella distingue dos operaciones del mismo monto y día', () => {
    const a = huellaLinea({ fecha: '2026-08-01', monto: -100, referencia: '111111' });
    const b = huellaLinea({ fecha: '2026-08-01', monto: -100, referencia: '222222' });
    expect(a).not.toBe(b);
  });
  it('la huella ignora el formato del número de operación', () => {
    expect(huellaLinea({ fecha: '2026-08-01', monto: -100, referencia: '00123456' }))
      .toBe(huellaLinea({ fecha: '2026-08-01', monto: -100, referencia: 'OP-123456' }));
  });
});

describe('el tipo que se le pone al movimiento', () => {
  it('reconoce la comisión y el ITF, que nadie registra a mano', () => {
    expect(tipoDesde(-15, 'COMISION MANTENIMIENTO')).toBe('comision');
    expect(tipoDesde(-0.25, 'ITF')).toBe('comision');
  });
  it('sin pistas, se guía por el signo', () => {
    expect(tipoDesde(500, '')).toBe('deposito');
    expect(tipoDesde(-500, '')).toBe('retiro');
  });
});

// ── Lo que enseñaron los datos REALES de producción (7-sep-2026) ──────
// Las 13 constancias bancarias cargadas no tienen n° de operación, y hay
// montos repetidos. Es el caso que la app se va a encontrar de verdad.
describe('cuando dos constancias son gemelas', () => {
  const lineas = [{ id: 'l1', fecha: '2026-04-06', monto: -1500, referencia: null }];
  const gemelas = [
    { clase: 'pago_parte', id: 'pa', fecha: '2026-04-06', monto: -1500, referencia: null },
    { clase: 'pago_parte', id: 'pb', fecha: '2026-04-06', monto: -1500, referencia: null },
  ];

  it('no se declara segura: hay dos candidatas idénticas', () => {
    const r = sugerirCruces(lineas, gemelas);
    expect(r.seguros).toHaveLength(0);
    expect(r.probables).toHaveLength(1);
    expect(r.probables[0].ambiguo).toBe(true);
    expect(r.probables[0].candidatos).toBe(2);
  });

  it('con una sola candidata deja de ser ambigua', () => {
    const r = sugerirCruces(lineas, [gemelas[0]]);
    expect(r.probables[0].ambiguo).toBe(false);
  });

  it('sin n° de operación NADA llega a "seguro", aunque el monto y el día calcen', () => {
    // Es el caso de las 13 constancias reales: el cruce se propone, pero
    // siempre lo confirma una persona.
    const r = sugerirCruces(
      [{ id: 'l9', fecha: '2026-08-07', monto: -7005, referencia: null }],
      [{ clase: 'pago_parte', id: 'p9', fecha: '2026-08-07', monto: -7005, referencia: null }]);
    expect(r.seguros).toHaveLength(0);
    expect(r.probables).toHaveLength(1);
  });

  it('el n° de operación desempata a las gemelas', () => {
    const r = sugerirCruces(
      [{ id: 'l1', fecha: '2026-04-06', monto: -1500, referencia: '445566' }],
      [{ ...gemelas[0], referencia: '445566' }, gemelas[1]]);
    expect(r.seguros).toHaveLength(1);
    expect(r.seguros[0].pendiente.id).toBe('pa');
  });
});
