// Tests del Plan Contable General Empresarial (src/lib/pcge.js).
//
// Nacen con la tanda 1 del pedido de las contadoras (17-set-2026): hasta hoy
// el «plan de cuentas» de JARVEX eran 52 cuentas escritas a mano, editables y
// guardadas en localStorage. Ahora es el PDF del MEF entero, generado por
// `scripts/generar-pcge.mjs` y fijo en el bundle.
//
// Estos tests son el contrato con el PDF: si alguien regenera el catálogo y la
// extracción se rompe —un parser que se come una columna, un nombre que queda
// cortado a la mitad— acá se ve, en vez de descubrirse en un asiento.
import { describe, it, expect } from 'vitest';
import {
  PCGE_CUENTAS, PCGE_NIVEL_CUENTA, PCGE_ELEMENTOS_ORDENADOS,
  NIVEL_CUENTA, NIVEL_SUBCUENTA, NIVEL_MAXIMO,
  cuenta, esCuentaValida, hijosDe, tieneHijos, nombreDeCuenta, rutaDe,
  cuentaMadreDe, padreDe, elementoDe, buscarCuentas, TIPO_POR_ELEMENTO,
} from '../pcge.js';
import { PCGE_DESCRIPCIONES } from '../pcge-descripciones.js';

describe('el catálogo está completo', () => {
  it('trae las cuentas de los cinco niveles del PDF', () => {
    const porNivel = {};
    for (const c of PCGE_CUENTAS) porNivel[c.nivel] = (porNivel[c.nivel] || 0) + 1;
    // Medido sobre el PDF oficial. Si estos números cambian, el generador se
    // rompió o el MEF publicó otra versión — las dos cosas hay que mirarlas.
    expect(porNivel[2]).toBe(83);
    expect(porNivel[3]).toBe(340);
    expect(porNivel[4]).toBe(717);
    expect(porNivel[5]).toBe(652);
    expect(PCGE_CUENTAS.length).toBe(1792);
  });

  it('no repite códigos', () => {
    const vistos = new Set();
    const repes = PCGE_CUENTAS.filter(c => vistos.has(c.codigo) || (vistos.add(c.codigo), false));
    expect(repes).toEqual([]);
  });

  it('toda cuenta de más de dos dígitos tiene a su padre en el plan', () => {
    const huerfanas = PCGE_CUENTAS
      .filter(c => c.padre && !esCuentaValida(c.padre))
      .map(c => `${c.codigo} ${c.nombre}`);
    expect(huerfanas).toEqual([]);
  });

  it('ningún nombre quedó vacío ni cortado en una palabra suelta', () => {
    const malos = PCGE_CUENTAS
      .filter(c => !c.nombre || c.nombre.length < 3)
      .map(c => c.codigo);
    expect(malos).toEqual([]);
  });

  it('los nueve elementos del plan están, con las cuentas de orden al final', () => {
    expect(PCGE_ELEMENTOS_ORDENADOS.map(e => e.codigo))
      .toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '0']);
  });
});

describe('las cuentas que usa la app todos los días', () => {
  // Son las que aparecen en cada asiento del Libro Diario. Si alguna se
  // extrajo mal, se rompe la contabilidad entera y no un detalle.
  it.each([
    ['10',   'Efectivo y equivalentes de efectivo'],
    ['101',  'Caja'],
    ['104',  'Cuentas corrientes en instituciones financieras'],
    ['121',  'Facturas, boletas y otros comprobantes por cobrar'],
    ['41',   'Remuneraciones y participaciones por pagar'],
    ['42',   'Cuentas por pagar comerciales – terceros'],
    ['60',   'Compras'],
    ['62',   'Gastos de personal, directores y gerentes'],
    ['63',   'Gastos de servicios prestados por terceros'],
    ['70',   'Ventas'],
  ])('%s es «%s»', (codigo, nombre) => {
    expect(cuenta(codigo)?.nombre).toBe(nombre);
  });

  it('4011 es el IGV — la línea de impuesto de todos los asientos', () => {
    // Ojo: el plan oficial NO la llama «IGV», la llama por su nombre largo
    // («Impuesto general a las ventas»). El «IGV» aparece recién un nivel más
    // abajo, en las divisionarias. El plan de cuentas viejo, escrito a mano,
    // decía «IGV» — y ésa es justo la clase de diferencia por la que ahora el
    // catálogo sale del PDF y no de la memoria de nadie.
    expect(nombreDeCuenta('4011')).toBe('Impuesto general a las ventas');
    expect(cuenta('40111').nombre).toMatch(/IGV/);
  });

  it('los nombres largos no quedaron cortados por el salto de página', () => {
    // El PDF parte estos dos en dos líneas. Antes del fix, la 40 terminaba en
    // «…y de» y la 14 en «…directores».
    expect(cuenta('40').nombre).toMatch(/salud por pagar$/i);
    expect(cuenta('14').nombre).toMatch(/gerentes$/i);
  });

  it('las erratas de tilde del catálogo se corrigen con la Parte III', () => {
    expect(cuenta('65').nombre).toBe('Otros gastos de gestión');
    expect(cuenta('66').nombre).toMatch(/^Pérdida/);
  });

  it('la columna desalineada del PDF quedó bien emparejada', () => {
    // El PDF deja 4692 y 4699 sin su nombre al lado; se emparejan por orden.
    expect(cuenta('4692').nombre).toBe('Donaciones condicionadas');
    expect(cuenta('4699').nombre).toBe('Otras cuentas por pagar');
  });
});

describe('el caso que reportaron las contadoras: el transporte va a la 63', () => {
  // Factura F055-6246 de AREQUIPA EXPRESO MARVISUR («TRANSPORTE NACIONAL»),
  // asentada en la 60. El plan dice dónde va de verdad.
  it('el árbol del transporte existe entero, de 63 a 63111', () => {
    expect(cuenta('63').nombre).toBe('Gastos de servicios prestados por terceros');
    expect(cuenta('631').nombre).toBe('Transporte, correos y gastos de viaje');
    expect(cuenta('6311').nombre).toBe('Transporte');
    expect(cuenta('63111').nombre).toBe('De carga');
    expect(cuenta('63112').nombre).toBe('De pasajeros');
  });

  it('la ruta de 63111 muestra de dónde sale', () => {
    expect(rutaDe('63111').map(c => c.codigo)).toEqual(['63', '631', '6311', '63111']);
  });

  it('la 60 NO tiene nada de transporte colgando', () => {
    const nombres = hijosDe('60').map(c => c.nombre.toLowerCase());
    expect(nombres.some(n => n.includes('transporte'))).toBe(false);
  });
});

describe('navegación del árbol', () => {
  it('hijosDe devuelve el desglose directo, no los nietos', () => {
    expect(hijosDe('10').map(c => c.codigo)).toEqual(['101', '102', '103', '104', '105', '106', '107']);
  });

  it('una hoja no tiene hijos', () => {
    expect(tieneHijos('63111')).toBe(false);
    expect(hijosDe('63111')).toEqual([]);
  });

  it('padreDe corta el último dígito y se detiene en la cuenta', () => {
    expect(padreDe('63111')).toBe('6311');
    expect(padreDe('631')).toBe('63');
    expect(padreDe('63')).toBe(null);
  });

  it('cuentaMadreDe sube hasta los dos dígitos', () => {
    expect(cuentaMadreDe('63111').codigo).toBe('63');
    expect(cuentaMadreDe('101').codigo).toBe('10');
  });

  it('elementoDe lee el primer dígito, también en las cuentas de orden', () => {
    expect(elementoDe('63111')).toBe('6');
    expect(elementoDe('01')).toBe('0');
  });
});

describe('nombreDeCuenta tolera lo que no está en el plan', () => {
  it('sube al ancestro más cercano antes que dejar la columna vacía', () => {
    // 6311999 no existe; lo más preciso que se puede decir es «Transporte».
    expect(nombreDeCuenta('6311999')).toBe('Transporte');
  });

  it('devuelve vacío cuando ni la cuenta de dos dígitos existe', () => {
    expect(nombreDeCuenta('99')).toBe('');
    expect(nombreDeCuenta('')).toBe('');
    expect(nombreDeCuenta(null)).toBe('');
  });
});

describe('búsqueda', () => {
  it('un número busca por prefijo de código', () => {
    const r = buscarCuentas('631').map(c => c.codigo);
    expect(r).toContain('631');
    expect(r).toContain('63111');
    expect(r).not.toContain('632');
  });

  it('el texto ignora tildes y mayúsculas', () => {
    const r = buscarCuentas('TRANSPORTE').map(c => c.codigo);
    expect(r).toContain('631');
    expect(buscarCuentas('energia electrica').map(c => c.codigo)).toContain('6361');
  });

  it('varias palabras se exigen todas', () => {
    const r = buscarCuentas('gastos viaje').map(c => c.codigo);
    expect(r).toContain('631');
    expect(r.every(c => /viaje/i.test(cuenta(c).nombre.normalize('NFD')))).toBe(true);
  });

  it('nivelMax recorta el detalle que nadie pidió', () => {
    const r = buscarCuentas('transporte', { nivelMax: NIVEL_SUBCUENTA });
    expect(r.every(c => c.nivel <= NIVEL_SUBCUENTA)).toBe(true);
  });

  it('sin texto devuelve todo el plan', () => {
    expect(buscarCuentas('').length).toBe(PCGE_CUENTAS.length);
  });
});

describe('tipo por elemento', () => {
  it('el elemento manda: 6 es gasto, 7 ingreso, 4 pasivo', () => {
    expect(cuenta('63').tipo).toBe('gasto');
    expect(cuenta('70').tipo).toBe('ingreso');
    expect(cuenta('42').tipo).toBe('pasivo');
    expect(cuenta('50').tipo).toBe('patrimonio');
    expect(cuenta('10').tipo).toBe('activo');
  });

  it('el 8 y las cuentas de orden no se disfrazan de activo', () => {
    expect(TIPO_POR_ELEMENTO['8']).toBe('resultado');
    expect(cuenta('01').tipo).toBe('orden');
  });
});

describe('descripciones de la Parte III', () => {
  it('cada cuenta descrita tiene contenido y dinámica de los dos lados', () => {
    const rotas = Object.entries(PCGE_DESCRIPCIONES)
      .filter(([, d]) => !d.contenido.length || !d.dinamica.debe.length || !d.dinamica.haber.length)
      .map(([c]) => c);
    expect(rotas).toEqual([]);
  });

  it('el debe y el haber no se mezclan', () => {
    // Las dos columnas de la tabla del PDF se separan por la X. Si se
    // mezclaran, la 63 diría que se debita por su propio cierre contra la 82.
    const d = PCGE_DESCRIPCIONES['63'].dinamica;
    expect(d.debe.join(' ')).toMatch(/importe de los servicios/i);
    expect(d.haber.join(' ')).toMatch(/cierre del periodo/i);
    expect(d.debe.join(' ')).not.toMatch(/cierre del periodo/i);
  });

  it('la descripción de la subcuenta trae los ejemplos del PDF', () => {
    expect(PCGE_DESCRIPCIONES['63'].subcuentas['631']).toMatch(/fletes/i);
    expect(PCGE_DESCRIPCIONES['63'].subcuentas['635']).toMatch(/arrendamiento operativo/i);
  });

  it('la lista seca de subcuentas no se cuela como si fuera una descripción', () => {
    // Antes, subcuentas['631'] arrancaba con los nueve nombres pegados.
    expect(PCGE_DESCRIPCIONES['63'].subcuentas['631']).not.toMatch(/632 Asesoría/);
  });

  it('las cuentas que el PDF explica en bloque guardan esa nota', () => {
    // La 60 no describe subcuenta por subcuenta: lo dice todo en un párrafo.
    expect(PCGE_DESCRIPCIONES['60'].contenido.join(' ')).toMatch(/subcuentas 601 a 604/i);
  });

  it('las normas referidas se leen enteras', () => {
    expect(PCGE_DESCRIPCIONES['60'].niif.length).toBeGreaterThan(0);
    expect(PCGE_DESCRIPCIONES['63'].niif.join(' ')).toMatch(/NIC 17 Arrendamientos/);
  });

  it('toda cuenta descrita existe en el catálogo', () => {
    const fantasmas = Object.keys(PCGE_DESCRIPCIONES).filter(c => !esCuentaValida(c));
    expect(fantasmas).toEqual([]);
  });
});

describe('los niveles nombrados', () => {
  it('son 2, 3 y 5 — la decisión de Gabriel del 17-set', () => {
    expect([NIVEL_CUENTA, NIVEL_SUBCUENTA, NIVEL_MAXIMO]).toEqual([2, 3, 5]);
  });

  it('PCGE_NIVEL_CUENTA son las 83 cuentas con las que se trabaja', () => {
    expect(PCGE_NIVEL_CUENTA.length).toBe(83);
    expect(PCGE_NIVEL_CUENTA.every(c => c.codigo.length === NIVEL_CUENTA)).toBe(true);
  });
});
