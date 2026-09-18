// Tests del asiento de destino (src/lib/destino-asiento.js, pcge-elemento9.js
// y periodo-contable.js).
//
// Estos tests son el contrato con las contadoras: cada uno dice, en una línea,
// qué pasa con un caso concreto de los que ellas plantearon. Si alguien cambia
// la regla, acá se ve qué se movió.
import { describe, it, expect } from 'vitest';
import {
  ESPEJO_61, CARGAS_IMPUTABLES, CARGAS_POR_PROVISIONES,
  existenciaDeCompra, validarDestino, contrapartidaDeDestino,
  destinoSugerido, opcionesDestino, resolverDestino, nombreDestino,
} from '../destino-asiento.js';
import { ELEMENTO_9, esCuentaElemento9, cuenta9 } from '../pcge-elemento9.js';
import {
  periodoCerrado, movEnPeriodoCerrado, avisoPeriodoCerrado, CERRADO_HASTA_DEFAULT,
} from '../periodo-contable.js';
import { generarAsiento, cumpleEstadoCuenta } from '../asientos.js';
import { esCuentaValida } from '../pcge.js';

// ═══════════════════════════════════════════════════════════════════
// EL CASO QUE MANDARON LAS CONTADORAS (18-set-2026)
// ═══════════════════════════════════════════════════════════════════
describe('el caso del flete: «se traslada a la 20 mediante el asiento de destino (20111 / 6111)»', () => {
  it('el flete que trae la compra va a la 609, y desde ahí su existencia es la 20', () => {
    // 60911 Transportes, dentro de 6091 Costos vinculados con las compras DE
    // MERCADERÍAS. La cuarta cifra es la que dice de qué existencia se trata.
    expect(existenciaDeCompra('60911')).toBe('20');
  });

  it('el destino 20 arrastra la 611 como contrapartida, sin que nadie la escriba', () => {
    const r = contrapartidaDeDestino('20', '60911');
    expect(r.cuenta).toBe('611');
  });

  it('y funciona igual con la cuenta a 5 dígitos que ellas escribieron (20111)', () => {
    // El nivel de trabajo acordado es 2 dígitos con subcuenta de 3: la
    // contrapartida sale a 3 aunque el destino venga a 5.
    expect(contrapartidaDeDestino('20111', '60911').cuenta).toBe('611');
  });

  it('las cuatro existencias con espejo en la 61 son las que nombra el PCGE', () => {
    expect(ESPEJO_61).toEqual({ '20': '611', '24': '612', '25': '613', '26': '614' });
  });
});

describe('el caso del combustible: misma cuenta, distinto destino', () => {
  // Dos facturas de «PETRÓLEO DIESEL B5», mismo proveedor, mismo importe. La
  // cuenta por naturaleza es la MISMA; lo único que las separa es el destino.
  const generadorDeObra = { type: 'cost', destino_contable: 'obra' };
  const camionetaDeReparto = { type: 'expense', destino_contable: 'gastos_generales' };

  it('el de la obra propone costo de producción', () => {
    expect(destinoSugerido(generadorDeObra, { cuentaOrigen: '6032' }).cuenta).toBe('92');
  });

  it('el de la empresa propone gastos de administración', () => {
    expect(destinoSugerido(camionetaDeReparto, { cuentaOrigen: '6032' }).cuenta).toBe('94');
  });

  it('los dos llevan la MISMA cuenta por naturaleza: sin destino serían la misma fila', () => {
    const a = resolverDestino(generadorDeObra, { cuentaOrigen: '6032' });
    const b = resolverDestino(camionetaDeReparto, { cuentaOrigen: '6032' });
    expect(a.cuenta).not.toBe(b.cuenta);
    expect(a.contrapartida).toBe(b.contrapartida);   // las dos por la 791
  });
});

// ═══════════════════════════════════════════════════════════════════
// LA REGLA: ELIGEN UNA CUENTA, LA OTRA SALE SOLA
// ═══════════════════════════════════════════════════════════════════
describe('contrapartidaDeDestino', () => {
  it('cada existencia se cancela contra su subcuenta de la 61', () => {
    expect(contrapartidaDeDestino('20', '601').cuenta).toBe('611');
    expect(contrapartidaDeDestino('24', '602').cuenta).toBe('612');
    expect(contrapartidaDeDestino('25', '603').cuenta).toBe('613');
    expect(contrapartidaDeDestino('26', '604').cuenta).toBe('614');
  });

  it('cualquier cuenta del elemento 9 se transfiere por la 791', () => {
    for (const c of ELEMENTO_9) {
      expect(contrapartidaDeDestino(c.codigo, '6032').cuenta).toBe(CARGAS_IMPUTABLES);
    }
  });

  it('LA EXCEPCIÓN: lo que sale de la 68 va por la 78, no por la 79', () => {
    // PCGE p. 195: «Los gastos cubiertos por provisiones se transfieren a
    // través de la cuenta 78». Es el caso de la depreciación de la maquinaria
    // de obra, que sí es costo de obra.
    expect(contrapartidaDeDestino('92', '681').cuenta).toBe(CARGAS_POR_PROVISIONES);
    expect(contrapartidaDeDestino('92', '68').cuenta).toBe('781');
  });

  it('sin destino no hay contrapartida y no se inventa ninguna', () => {
    expect(contrapartidaDeDestino('', '6032').cuenta).toBeNull();
    expect(contrapartidaDeDestino(null, '6032').cuenta).toBeNull();
  });

  it('una cuenta que no es destino no devuelve contrapartida', () => {
    expect(contrapartidaDeDestino('42', '6032').cuenta).toBeNull();
    expect(contrapartidaDeDestino('631', '6032').cuenta).toBeNull();
  });
});

describe('existenciaDeCompra', () => {
  it('cada subcuenta de compras tiene su existencia', () => {
    expect(existenciaDeCompra('601')).toBe('20');
    expect(existenciaDeCompra('602')).toBe('24');
    expect(existenciaDeCompra('603')).toBe('25');
    expect(existenciaDeCompra('604')).toBe('26');
  });

  it('la 609 la resuelve por su cuarta cifra, no por la tercera', () => {
    expect(existenciaDeCompra('6091')).toBe('20');
    expect(existenciaDeCompra('6092')).toBe('24');
    expect(existenciaDeCompra('6093')).toBe('25');
    expect(existenciaDeCompra('6094')).toBe('26');
    expect(existenciaDeCompra('60931')).toBe('25');
  });

  it('la 60 pelada no dice de qué existencia se trata: no se adivina', () => {
    expect(existenciaDeCompra('60')).toBeNull();
  });

  it('lo que no es una compra no tiene existencia', () => {
    expect(existenciaDeCompra('631')).toBeNull();
    expect(existenciaDeCompra('')).toBeNull();
    expect(existenciaDeCompra(null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// QUÉ SE ACEPTA COMO DESTINO
// ═══════════════════════════════════════════════════════════════════
describe('validarDestino', () => {
  it('acepta las siete del elemento 9', () => {
    for (const c of ELEMENTO_9) expect(validarDestino(c.codigo).ok).toBe(true);
  });

  it('rechaza una del elemento 9 que la empresa no definió', () => {
    expect(validarDestino('99').ok).toBe(false);
    expect(validarDestino('96').ok).toBe(false);
  });

  it('acepta las existencias con espejo y rechaza las que no lo tienen', () => {
    expect(validarDestino('20').ok).toBe(true);
    expect(validarDestino('25').ok).toBe(true);
    // 21 Productos terminados existe en el PCGE pero no tiene subcuenta en la
    // 61: no hay cómo cerrar el asiento, así que no sirve de destino.
    expect(esCuentaValida('21')).toBe(true);
    expect(validarDestino('21').ok).toBe(false);
  });

  it('rechaza una cuenta de otro elemento: eso es la otra pata, no el destino', () => {
    expect(validarDestino('42').ok).toBe(false);
    expect(validarDestino('631').ok).toBe(false);
    expect(validarDestino('101').ok).toBe(false);
  });

  it('vaciarlo es volver a la sugerencia, no un error', () => {
    expect(validarDestino('')).toEqual({ ok: true, codigo: null });
    expect(validarDestino(null)).toEqual({ ok: true, codigo: null });
  });

  it('un dedazo no entra como cuenta', () => {
    expect(validarDestino('9').ok).toBe(false);
    expect(validarDestino('9a').ok).toBe(false);
    expect(validarDestino('123456').ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LA SUGERENCIA — Y LO QUE NO SE SUGIERE
// ═══════════════════════════════════════════════════════════════════
describe('destinoSugerido', () => {
  it('una VENTA no lleva destino: no se traslada por la 79', () => {
    expect(destinoSugerido({ type: 'income', destino_contable: 'obra' })).toBeNull();
  });

  it('el gasto financiero manda sobre el destino del comprobante', () => {
    // Un interés bancario de una obra sigue siendo gasto financiero.
    const r = destinoSugerido({ type: 'cost', destino_contable: 'obra' }, { cuentaOrigen: '671' });
    expect(r.cuenta).toBe('97');
  });

  it('contabilidad neta propone la 91, con confianza BAJA', () => {
    // Pedido de Gabriel el 18-set: «puede que sí haga falta». Es costo de la
    // empresa sin obra: la 91 lo junta hasta repartirlo. Floja a propósito.
    const r = destinoSugerido({ type: 'cost', destino_contable: 'contabilidad_neta' });
    expect(r.cuenta).toBe('91');
    expect(r.confianza).toBe('baja');
  });

  it('el gasto financiero le gana también a contabilidad neta', () => {
    const r = destinoSugerido({ type: 'cost', destino_contable: 'contabilidad_neta' }, { cuentaOrigen: '6731' });
    expect(r.cuenta).toBe('97');
  });

  it('NO sugiere nada para lo que no tiene destino', () => {
    // Son 282 de 1.789 en producción. Sugerir «no sé» con un botón verde
    // al lado es lo mismo que no sugerir nada, pero encima se guarda.
    expect(destinoSugerido({ type: 'cost', destino_contable: null })).toBeNull();
    expect(destinoSugerido({ type: 'cost' })).toBeNull();
  });
});

describe('resolverDestino', () => {
  it('lo elegido a mano le gana a la sugerencia', () => {
    const r = resolverDestino(
      { type: 'cost', destino_contable: 'obra', cuenta_pcge_destino: '95' },
      { cuentaOrigen: '6032' },
    );
    expect(r.cuenta).toBe('95');
    expect(r.manual).toBe(true);
    expect(r.contrapartida).toBe('791');
  });

  it('un destino a mano que quedó roto NO genera medio asiento', () => {
    const r = resolverDestino({ type: 'cost', cuenta_pcge_destino: '42' }, {});
    expect(r).toBeNull();
  });

  it('sin sugerencia queda por definir, y eso se puede filtrar', () => {
    const r = resolverDestino({ type: 'cost', destino_contable: null }, {});
    expect(r.porDefinir).toBe(true);
    expect(r.cuenta).toBeNull();
  });

  it('contabilidad neta NO queda por definir: tiene propuesta floja', () => {
    const r = resolverDestino({ type: 'cost', destino_contable: 'contabilidad_neta' }, {});
    expect(r.porDefinir).toBe(false);
    expect(r.cuenta).toBe('91');
    expect(r.contrapartida).toBe('791');
    expect(r.confianza).toBe('baja');
  });

  it('una venta no tiene objeto de destino en absoluto', () => {
    expect(resolverDestino({ type: 'income' }, {})).toBeNull();
  });
});

describe('opcionesDestino', () => {
  it('una venta no ofrece destinos', () => {
    expect(opcionesDestino({ type: 'income' }, {})).toEqual([]);
  });

  it('ofrece las siete del elemento 9, con las que usan primero', () => {
    const o = opcionesDestino({ type: 'cost' }, { cuentaOrigen: '631' });
    expect(o).toHaveLength(7);
    expect(o.slice(0, 3).map(x => x.codigo).sort()).toEqual(['94', '95', '97']);
    expect(o.slice(0, 3).every(x => x.grupo === 'En uso')).toBe(true);
  });

  it('cuando el gasto salió de una compra, agrega la existencia CON su aviso', () => {
    const o = opcionesDestino({ type: 'cost' }, { cuentaOrigen: '602' });
    const inventario = o.find(x => x.codigo === '24');
    expect(inventario).toBeTruthy();
    expect(inventario.avisa).toBe(true);
    // El aviso tiene que nombrar la consecuencia, que es la razón de existir
    // de este campo: costo atrapado en inventario = más renta de la debida.
    expect(inventario.porque).toMatch(/renta/i);
  });

  it('un servicio no ofrece existencias: un flete no se almacena', () => {
    const o = opcionesDestino({ type: 'cost' }, { cuentaOrigen: '631' });
    expect(o.some(x => x.codigo === '24')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EL ELEMENTO 9
// ═══════════════════════════════════════════════════════════════════
describe('pcge-elemento9', () => {
  it('son las siete que definió la empresa, ni una más', () => {
    expect(ELEMENTO_9.map(c => c.codigo).sort()).toEqual(['90', '91', '92', '93', '94', '95', '97']);
  });

  it('las tres en uso son las que dijo Gabriel: 94, 95 y 97', () => {
    expect(ELEMENTO_9.filter(c => c.enUso).map(c => c.codigo).sort()).toEqual(['94', '95', '97']);
  });

  it('cada una dice para qué sirve: es lo que la contadora lee al elegir', () => {
    for (const c of ELEMENTO_9) {
      expect(c.nombre.length).toBeGreaterThan(3);
      expect(c.porque.length).toBeGreaterThan(20);
    }
  });

  it('reconoce la cuenta venga a 2 dígitos o con desglose', () => {
    expect(esCuentaElemento9('92')).toBe(true);
    expect(esCuentaElemento9('9201')).toBe(true);
    expect(esCuentaElemento9('96')).toBe(false);
    expect(cuenta9('94').nombre).toMatch(/administraci/i);
  });

  it('el nombre del destino sale del catálogo que corresponda', () => {
    expect(nombreDestino('94')).toMatch(/administraci/i);
    expect(nombreDestino('20')).toMatch(/mercader/i);
    expect(nombreDestino('')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════
// EL PERÍODO YA PRESENTADO
// ═══════════════════════════════════════════════════════════════════
describe('periodo-contable', () => {
  it('julio 2026 y todo lo anterior está cerrado; agosto ya no', () => {
    expect(periodoCerrado('2026-07-31')).toBe(true);
    expect(periodoCerrado('2026-07-01')).toBe(true);
    expect(periodoCerrado('2023-01-15')).toBe(true);
    expect(periodoCerrado('2026-08-01')).toBe(false);
    expect(periodoCerrado('2026-09-18')).toBe(false);
  });

  it('el default es el que confirmó Gabriel', () => {
    expect(CERRADO_HASTA_DEFAULT).toBe('2026-07-31');
  });

  it('la fecha de cierre se puede correr sin tocar el código', () => {
    expect(periodoCerrado('2026-08-15', '2026-08-31')).toBe(true);
    expect(periodoCerrado('2026-09-01', '2026-08-31')).toBe(false);
  });

  it('una fecha rota no cierra nada: ante la duda, se deja trabajar', () => {
    expect(periodoCerrado('', '2026-07-31')).toBe(false);
    expect(periodoCerrado(null)).toBe(false);
    expect(periodoCerrado('ayer')).toBe(false);
  });

  it('lee la fecha del movimiento aunque venga con hora', () => {
    expect(movEnPeriodoCerrado({ date: '2026-07-15T10:30:00Z' })).toBe(true);
    expect(movEnPeriodoCerrado({ created_at: '2026-09-01T10:30:00Z' })).toBe(false);
  });

  it('el aviso nombra el comprobante y la fecha de corte', () => {
    const a = avisoPeriodoCerrado({ date: '2026-06-10', document_number: 'F001-123' });
    expect(a).toMatch(/F001-123/);
    expect(a).toMatch(/2026-07-31/);
    expect(avisoPeriodoCerrado({ date: '2026-09-10' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// EL ASIENTO COMPLETO
// ═══════════════════════════════════════════════════════════════════
describe('el asiento de destino dentro del Libro Diario', () => {
  const compra = {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    type: 'cost',
    date: '2026-09-10',
    amount: 1180,
    description: 'Combustible para el generador',
    document_number: 'F001-500',
    destino_contable: 'obra',
    payment_status: 'pending',
    cuenta_pcge: '6032',
  };

  it('agrega las dos líneas y el asiento sigue cuadrando', () => {
    const a = generarAsiento({ ...compra, cuenta_pcge_destino: '92' });
    const debe = a.partidas.reduce((s, p) => s + p.debe, 0);
    const haber = a.partidas.reduce((s, p) => s + p.haber, 0);
    expect(Math.abs(debe - haber)).toBeLessThan(0.05);
    expect(a.partidas.some(p => p.cuenta === '92' && p.debe > 0)).toBe(true);
    expect(a.partidas.some(p => p.cuenta === '791' && p.haber > 0)).toBe(true);
  });

  it('el destino viaja por la base SIN el IGV: el crédito fiscal no es gasto', () => {
    const a = generarAsiento({ ...compra, cuenta_pcge_destino: '92' });
    const linea92 = a.partidas.find(p => p.cuenta === '92');
    const igv = a.partidas.find(p => p.cuenta === '4011');
    expect(igv.debe).toBeGreaterThan(0);
    expect(linea92.debe).toBe(a.desglose.subtotal);
  });

  it('sin destino elegido, la sugerencia igual arma el asiento', () => {
    // 396 movimientos de obra en producción entran por acá sin que nadie
    // escriba un dato.
    const a = generarAsiento(compra);
    expect(a.cuentas.destino.cuenta).toBe('92');
    expect(a.cuentas.destino.manual).toBe(false);
    expect(a.partidas.some(p => p.cuenta === '791')).toBe(true);
  });

  it('contabilidad neta arma el asiento con la 91, y el filtro la separa', () => {
    const a = generarAsiento({ ...compra, destino_contable: 'contabilidad_neta' });
    expect(a.cuentas.destino.cuenta).toBe('91');
    expect(cumpleEstadoCuenta(a, 'destino_flojo')).toBe(true);
    expect(cumpleEstadoCuenta(a, 'destino_por_definir')).toBe(false);
    // Las de obra (92, confianza media) no son «flojas».
    expect(cumpleEstadoCuenta(generarAsiento(compra), 'destino_flojo')).toBe(false);
    // Elegida a mano, deja de ser floja aunque sea la misma 91.
    const manual = generarAsiento({ ...compra, destino_contable: 'contabilidad_neta', cuenta_pcge_destino: '91' });
    expect(cumpleEstadoCuenta(manual, 'destino_flojo')).toBe(false);
  });

  it('un comprobante sin destino conocido NO inventa líneas', () => {
    const a = generarAsiento({ ...compra, destino_contable: null });
    expect(a.cuentas.destino.porDefinir).toBe(true);
    expect(a.partidas.some(p => p.cuenta === '791')).toBe(false);
    const debe = a.partidas.reduce((s, p) => s + p.debe, 0);
    const haber = a.partidas.reduce((s, p) => s + p.haber, 0);
    expect(Math.abs(debe - haber)).toBeLessThan(0.05);
  });

  it('una venta no recibe asiento de destino', () => {
    const a = generarAsiento({
      ...compra, type: 'income', cuenta_pcge: '704', destino_contable: 'obra',
    });
    expect(a.cuentas.destino).toBeNull();
    expect(a.partidas.some(p => p.cuenta === '791')).toBe(false);
  });
});
