// Tanda 5 del destino — las existencias en el Balance.
//
// Lo que se prueba acá no es «la función devuelve 612». Son las tres promesas
// de la tanda, que si se rompen lo hacen en silencio y dentro de un libro que
// se le declara a SUNAT:
//
//   1. El asiento de salida CUADRA y deja la 61 en cero: entra por el haber y
//      sale por el debe, así que el costo termina apareciendo una sola vez.
//   2. La validación del cliente es el espejo EXACTO del CHECK de la mig 224.
//      Si acá pasa algo que allá rebota, el sync queda en reintento eterno
//      (regla 9 del CLAUDE.md).
//   3. Lo que queda parado se CUENTA. Una existencia sin descargar no es un
//      saldo: es una pregunta pendiente, y si no se ve, no se contesta.
import { describe, it, expect } from 'vitest';
import {
  ESPEJO_69, SALIDA_VACIA,
  esDestinoExistencia, existenciaMadre, opcionesSalida,
  validarSalidaCuenta, validarSalida, patasDeSalida,
  saldoDeExistencia, diasEntre, costoAtrapado, resumenExistencias,
  salidaQuedaHuerfana, nombreSalida,
} from '../existencias-balance.js';
import { ESPEJO_61, CARGAS_IMPUTABLES, CARGAS_POR_PROVISIONES } from '../destino-asiento.js';
import { ELEMENTO_9 } from '../pcge-elemento9.js';

const suma = (patas, lado) => Math.round(patas.reduce((s, p) => s + p[lado], 0) * 100) / 100;

describe('qué queda en el Balance', () => {
  it('las cuatro existencias con espejo en la 61 y nada más', () => {
    for (const c of Object.keys(ESPEJO_61)) expect(esDestinoExistencia(c)).toBe(true);
    expect(esDestinoExistencia('20111')).toBe(true);
    expect(esDestinoExistencia('241')).toBe(true);
    // El 21 (productos terminados) es del elemento 2 pero no tiene espejo: no
    // se compra, se fabrica, y por eso nunca es destino de una compra.
    expect(esDestinoExistencia('21')).toBe(false);
    expect(esDestinoExistencia('92')).toBe(false);
    expect(esDestinoExistencia('')).toBe(false);
    expect(esDestinoExistencia(null)).toBe(false);
  });

  it('la madre es el nivel al que la 61 y la 69 tienen espejo', () => {
    expect(existenciaMadre('20111')).toBe('20');
    expect(existenciaMadre('261')).toBe('26');
    expect(existenciaMadre('94')).toBe(null);
  });
});

describe('a dónde puede salir', () => {
  it('siempre las siete del elemento 9, las en uso primero', () => {
    const op = opcionesSalida('24');
    const nueve = op.filter(o => o.codigo[0] === '9');
    expect(nueve).toHaveLength(ELEMENTO_9.length);
    const enUso = new Set(ELEMENTO_9.filter(c => c.enUso).map(c => c.codigo));
    // Las en uso arriba: la contadora no tiene que buscar la 94 entre siete.
    expect(enUso.has(nueve[0].codigo)).toBe(true);
    expect(nueve.every(o => o.grupo === 'Se consumió')).toBe(true);
  });

  it('la venta solo se ofrece desde la 20 Mercaderías', () => {
    const conVenta = opcionesSalida('20111').filter(o => o.grupo === 'Se vendió');
    expect(conVenta).toHaveLength(1);
    expect(conVenta[0].codigo).toBe(ESPEJO_69['20']);
    // Una materia prima vendida sin transformar no era materia prima: lo que
    // hay que corregir es el destino de la compra, no inventarle una 692.
    for (const c of ['24', '25', '26']) {
      expect(opcionesSalida(c).some(o => o.grupo === 'Se vendió')).toBe(false);
    }
  });

  it('sin destino de existencia no hay nada que ofrecer', () => {
    expect(opcionesSalida('94')).toEqual([]);
    expect(opcionesSalida('')).toEqual([]);
  });
});

describe('el asiento de salida cuadra y cancela la 61', () => {
  it('lo consumido: cuatro patas, la 61 entra y sale', () => {
    const r = patasDeSalida({
      destino: '241', cuentaSalida: '92', importe: 1500, cuentaOrigen: '602',
    });
    expect(r.venta).toBe(false);
    expect(r.patas).toHaveLength(4);
    expect(suma(r.patas, 'debe')).toBe(suma(r.patas, 'haber'));
    // Son DOS pares en un solo asiento —la salida del Balance y el traslado a
    // función—, así que cada lado suma el doble del importe descargado. Es el
    // mismo formato con el que la tanda 1 escribe el asiento de destino
    // dentro del asiento de la compra.
    expect(suma(r.patas, 'debe')).toBe(3000);

    // 🔴 El corazón de la tanda: la subcuenta de la 61 por la que ENTRÓ al
    // Balance es la misma por la que SALE. Si no fuera la misma, el costo
    // quedaría contado dos veces o ninguna.
    const espejo = ESPEJO_61['24'];
    const enLa61 = r.patas.filter(p => p.cuenta === espejo);
    expect(enLa61).toHaveLength(1);
    expect(enLa61[0].debe).toBe(1500);

    // Y la existencia se descarga por el haber.
    expect(r.patas.find(p => p.cuenta === '241').haber).toBe(1500);
    // El traslado a función, con la 791 que sale sola.
    expect(r.patas.find(p => p.cuenta === '92').debe).toBe(1500);
    expect(r.patas.find(p => p.cuenta === CARGAS_IMPUTABLES).haber).toBe(1500);
  });

  it('lo vendido: dos patas, sin pasar por la 79', () => {
    const r = patasDeSalida({
      destino: '20111', cuentaSalida: '691', importe: 800, cuentaOrigen: '601',
    });
    expect(r.venta).toBe(true);
    expect(r.patas).toHaveLength(2);
    expect(suma(r.patas, 'debe')).toBe(suma(r.patas, 'haber'));
    expect(r.patas.find(p => p.cuenta === '691').debe).toBe(800);
    expect(r.patas.find(p => p.cuenta === '20111').haber).toBe(800);
    // La 69 ya es una cuenta por función: trasladarla otra vez por la 79
    // contaría el costo dos veces.
    expect(r.patas.some(p => p.cuenta === CARGAS_IMPUTABLES)).toBe(false);
    // Y la 611 no se toca: quedó cancelada contra la 601 de la compra.
    expect(r.patas.some(p => p.cuenta === ESPEJO_61['20'])).toBe(false);
  });

  it('hereda la regla 68 → 78 de la tanda 1', () => {
    const r = patasDeSalida({
      destino: '251', cuentaSalida: '92', importe: 100, cuentaOrigen: '681',
    });
    expect(r.patas.find(p => p.cuenta === CARGAS_POR_PROVISIONES).haber).toBe(100);
    expect(r.patas.some(p => p.cuenta === CARGAS_IMPUTABLES)).toBe(false);
  });

  it('sin destino de existencia, sin importe o con cuenta inválida no arma nada', () => {
    expect(patasDeSalida({ destino: '94', cuentaSalida: '92', importe: 10 })).toBe(null);
    expect(patasDeSalida({ destino: '24', cuentaSalida: '92', importe: 0 })).toBe(null);
    expect(patasDeSalida({ destino: '24', cuentaSalida: '', importe: 10 })).toBe(null);
    expect(patasDeSalida({ destino: '24', cuentaSalida: '631', importe: 10 })).toBe(null);
    // La 691 desde una materia prima no existe.
    expect(patasDeSalida({ destino: '241', cuentaSalida: '691', importe: 10 })).toBe(null);
  });
});

describe('validarSalidaCuenta', () => {
  it('acepta las del elemento 9 y rechaza las inventadas', () => {
    expect(validarSalidaCuenta('94', '24').ok).toBe(true);
    expect(validarSalidaCuenta('99', '24').ok).toBe(false);
    expect(validarSalidaCuenta('abc', '24').ok).toBe(false);
  });

  it('la 69 solo desde la 20, y solo la que corresponde', () => {
    expect(validarSalidaCuenta('691', '20').ok).toBe(true);
    expect(validarSalidaCuenta('691', '25').ok).toBe(false);
    expect(validarSalidaCuenta('692', '20').ok).toBe(false);
  });

  it('una cuenta de gasto no es una salida', () => {
    const r = validarSalidaCuenta('631', '24');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/elemento 9/);
  });

  it('vacío es válido: es «todavía está en el almacén»', () => {
    expect(validarSalidaCuenta('', '24')).toEqual({ ok: true, codigo: null });
  });
});

// ── EL ESPEJO DEL CHECK DE LA MIG 224 ─────────────────────────────
// 🔴 Este bloque es el que evita el reintento eterno. El CHECK dice: o las
// tres columnas en NULL, o cuenta con forma de cuenta + fecha + importe > 0 +
// un destino que empieza en 2. `validarSalida` tiene que rechazar TODO lo que
// el CHECK rechazaría, porque lo que pasa acá se guarda en Dexie y se pushea.
describe('validarSalida es el espejo del CHECK de la base', () => {
  const ok = { cuenta: '92', fecha: '2026-09-15', importe: 500 };

  it('la salida completa sobre una existencia pasa', () => {
    const r = validarSalida(ok, { destino: '241', entro: 1000 });
    expect(r.ok).toBe(true);
    expect(r.salida).toEqual({ cuenta: '92', fecha: '2026-09-15', importe: 500 });
  });

  it('la salida vacía pasa y borra las tres columnas', () => {
    const r = validarSalida({ cuenta: '', fecha: '', importe: '' }, { destino: '241' });
    expect(r.ok).toBe(true);
    expect(r.salida).toEqual({ cuenta: null, fecha: null, importe: null });
  });

  it('sin destino de existencia NO pasa (el CHECK exige left(destino,1)=2)', () => {
    expect(validarSalida(ok, { destino: '94' }).ok).toBe(false);
    expect(validarSalida(ok, { destino: '' }).ok).toBe(false);
  });

  it('a medio llenar NO pasa (el CHECK exige las tres juntas)', () => {
    expect(validarSalida({ ...ok, fecha: '' }, { destino: '24' }).ok).toBe(false);
    expect(validarSalida({ ...ok, importe: null }, { destino: '24' }).ok).toBe(false);
    expect(validarSalida({ ...ok, cuenta: '' }, { destino: '24' }).ok).toBe(false);
  });

  it('importe cero o negativo NO pasa (el CHECK exige > 0)', () => {
    expect(validarSalida({ ...ok, importe: 0 }, { destino: '24' }).ok).toBe(false);
    expect(validarSalida({ ...ok, importe: -5 }, { destino: '24' }).ok).toBe(false);
  });

  it('una fecha que no es fecha NO pasa', () => {
    expect(validarSalida({ ...ok, fecha: '15/09/2026' }, { destino: '24' }).ok).toBe(false);
  });

  // Esto NO lo valida el CHECK —la base no sabe cuánto entró— y por eso tiene
  // que valer acá: sacar más de lo que entró dejaría la existencia en negativo.
  it('no puede salir más de lo que entró', () => {
    expect(validarSalida({ ...ok, importe: 1500 }, { destino: '24', entro: 1000 }).ok).toBe(false);
    // El céntimo de tolerancia: el redondeo del reparto no puede bloquear una
    // descarga total legítima.
    expect(validarSalida({ ...ok, importe: 1000.01 }, { destino: '24', entro: 1000 }).ok).toBe(true);
  });
});

describe('el saldo de cada comprobante', () => {
  const mov = (extra = {}) => ({ cuenta_pcge_destino: '241', ...extra });

  it('sin descarga, todo lo que entró sigue adentro', () => {
    expect(saldoDeExistencia(mov(), { entro: 1000 })).toMatchObject({
      entro: 1000, salio: 0, queda: 1000, descargada: false, parcial: false,
    });
  });

  it('descarga parcial: queda el resto y se marca parcial', () => {
    const s = saldoDeExistencia(
      mov({ existencia_salida_cuenta: '92', existencia_salida_importe: 400 }),
      { entro: 1000 },
    );
    expect(s).toMatchObject({ salio: 400, queda: 600, descargada: false, parcial: true });
  });

  it('descarga total: no queda nada y no es parcial', () => {
    const s = saldoDeExistencia(
      mov({ existencia_salida_cuenta: '92', existencia_salida_importe: 1000 }),
      { entro: 1000 },
    );
    expect(s).toMatchObject({ salio: 1000, queda: 0, descargada: true, parcial: false });
  });

  it('un destino que no es existencia no tiene saldo que mirar', () => {
    expect(saldoDeExistencia({ cuenta_pcge_destino: '94' }, { entro: 1000 })).toBe(null);
    expect(saldoDeExistencia({}, { entro: 1000 })).toBe(null);
  });
});

describe('diasEntre', () => {
  it('cuenta días sin pasar por new Date(ymd)', () => {
    expect(diasEntre('2026-05-01', '2026-05-31')).toBe(30);
    // Cruzando fin de mes y año, que es donde el UTC−5 rompía las fechas.
    expect(diasEntre('2025-12-31', '2026-01-01')).toBe(1);
  });
  it('sin fechas válidas devuelve null en vez de un número inventado', () => {
    expect(diasEntre('', '2026-01-01')).toBe(null);
    expect(diasEntre('2026-01-01', 'ayer')).toBe(null);
  });
});

describe('el costo atrapado', () => {
  const base = { cuenta_pcge_destino: '241', date: '2026-09-01' };

  it('una existencia descargada no avisa nada', () => {
    const m = { ...base, existencia_salida_cuenta: '92', existencia_salida_importe: 1000 };
    expect(costoAtrapado(m, { entro: 1000, hoy: '2026-09-21' })).toBe(null);
  });

  it('lo que sigue adentro avisa con su importe y su antigüedad', () => {
    const r = costoAtrapado(base, { entro: 1000, hoy: '2026-09-21' });
    expect(r.importe).toBe(1000);
    expect(r.dias).toBe(20);
    expect(r.cruzoCierre).toBe(false);
    expect(r.aviso).toMatch(/241/);
  });

  it('si la compra es de un mes ya presentado, el aviso habla de renta', () => {
    // Julio 2026 está dentro del cierre por defecto.
    const r = costoAtrapado({ ...base, date: '2026-07-10' }, { entro: 500, hoy: '2026-09-21' });
    expect(r.cruzoCierre).toBe(true);
    expect(r.aviso).toMatch(/renta de más/);
  });

  it('con descarga parcial avisa por el resto, no por el total', () => {
    const m = { ...base, existencia_salida_cuenta: '92', existencia_salida_importe: 300 };
    const r = costoAtrapado(m, { entro: 1000, hoy: '2026-09-21' });
    expect(r.importe).toBe(700);
    expect(r.parcial).toBe(true);
  });
});

describe('el panel de existencias', () => {
  const filas = [
    { movimiento: { id: 'a', cuenta_pcge_destino: '241', date: '2026-05-02' }, entro: 1000 },
    { movimiento: { id: 'b', cuenta_pcge_destino: '251', date: '2026-08-10' }, entro: 400 },
    {
      movimiento: {
        id: 'c', cuenta_pcge_destino: '242', date: '2026-08-20',
        existencia_salida_cuenta: '92', existencia_salida_importe: 250,
      },
      entro: 250,
    },
    // Sin destino de existencia: no entra al panel.
    { movimiento: { id: 'd', cuenta_pcge_destino: '94', date: '2026-08-21' }, entro: 900 },
  ];

  it('agrupa por existencia madre y suma lo que queda', () => {
    const r = resumenExistencias(filas, { hoy: '2026-09-21' });
    const porCuenta = Object.fromEntries(r.porCuenta.map(g => [g.cuenta, g]));
    expect(Object.keys(porCuenta).sort()).toEqual(['24', '25']);
    // La 24 junta las dos: 1000 adentro y 250 que ya salió.
    expect(porCuenta['24']).toMatchObject({ entro: 1250, salio: 250, queda: 1000, comprobantes: 2, sinDescargar: 1 });
    expect(porCuenta['25']).toMatchObject({ queda: 400, sinDescargar: 1 });
    expect(r.totalQueda).toBe(1400);
  });

  it('las atrapadas salen de la más vieja a la más nueva', () => {
    const r = resumenExistencias(filas, { hoy: '2026-09-21' });
    expect(r.atrapadas.map(a => a.movimiento.id)).toEqual(['a', 'b']);
    // La de mayo cayó en período presentado; la de agosto no.
    expect(r.cruzaronCierre).toBe(1);
  });

  it('sin filas no inventa un panel', () => {
    const r = resumenExistencias([], { hoy: '2026-09-21' });
    expect(r.porCuenta).toEqual([]);
    expect(r.totalQueda).toBe(0);
    expect(r.atrapadas).toEqual([]);
  });
});

// ── EL GUARDIÁN DEL CHECK ─────────────────────────────────────────
// Si esto deja de valer, un cambio de destino deja una salida huérfana, la
// fila viola el CHECK y el push rebota con 23514 para siempre.
describe('salidaQuedaHuerfana', () => {
  const conSalida = { existencia_salida_cuenta: '92', existencia_salida_importe: 100 };

  it('cambiar de una existencia a otra NO la deja huérfana', () => {
    expect(salidaQuedaHuerfana('251', conSalida)).toBe(false);
  });

  it('cambiar a una cuenta del elemento 9 SÍ la deja huérfana', () => {
    expect(salidaQuedaHuerfana('94', conSalida)).toBe(true);
  });

  it('vaciar el destino SÍ la deja huérfana', () => {
    expect(salidaQuedaHuerfana(null, conSalida)).toBe(true);
    expect(salidaQuedaHuerfana('', conSalida)).toBe(true);
  });

  it('sin salida guardada no hay nada que borrar', () => {
    expect(salidaQuedaHuerfana('94', {})).toBe(false);
  });

  it('SALIDA_VACIA borra las cinco columnas y ninguna más', () => {
    expect(Object.keys(SALIDA_VACIA).sort()).toEqual([
      'existencia_salida_at', 'existencia_salida_cuenta', 'existencia_salida_fecha',
      'existencia_salida_importe', 'existencia_salida_por',
    ]);
    expect(Object.values(SALIDA_VACIA).every(v => v === null)).toBe(true);
  });
});

describe('nombreSalida', () => {
  it('conoce los dos catálogos', () => {
    // El elemento 9 no existe en el PCGE: sale del bundle propio.
    expect(nombreSalida('94')).toBeTruthy();
    // La 691 sí es del PCGE.
    expect(nombreSalida('691')).toBeTruthy();
    expect(nombreSalida('')).toBe('');
  });
});
