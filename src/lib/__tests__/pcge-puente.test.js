// Tests del puente familia → cuenta del PCGE (src/lib/pcge-puente.js).
//
// Es la tabla que arregla el bug que reportaron las contadoras: el Libro
// Diario ponía 60 a TODO porque decidía la cuenta con un regex sobre
// `category`, y `category` contiene el tipo de documento ('Factura'), no la
// naturaleza del gasto.
//
// Estos tests son el contrato con la contadora: cada uno dice, en una línea,
// dónde va una cosa concreta. Si alguien cambia la tabla, acá se ve qué
// cambió de lugar.
import { describe, it, expect } from 'vitest';
import {
  CUENTA_POR_FAMILIA, FAMILIAS_SIN_CUENTA, CUENTA_PROVISIONAL,
  cuentaDeFamilia, cuentaMadreDeFamilia, familiaTieneCuenta,
} from '../pcge-puente.js';
import { esCuentaValida, cuentaMadreDe } from '../pcge.js';
import { IUPC_CODIGOS, CATEGORIAS_COMPLEMENTARIAS, SERVICIOS_CODIGOS, REAGRUPACIONES_IUPC } from '../indices-unificados-iupc.js';

describe('EL CASO QUE REPORTARON LAS CONTADORAS', () => {
  it('un flete va a la 631, no a la 60', () => {
    // Factura F055-6246 de AREQUIPA EXPRESO MARVISUR, ítem «TRANSPORTE
    // NACIONAL». El catálogo del grupo ya clasificaba el transporte como S03.
    const r = cuentaDeFamilia('S03');
    expect(r.cuenta).toBe('631');
    expect(cuentaMadreDeFamilia('S03')).toBe('63');
  });

  it('los tres fletes del IUPC van al mismo lugar que S03', () => {
    for (const f of ['32', '33', '92']) expect(cuentaDeFamilia(f).cuenta).toBe('631');
  });
});

describe('la tabla cubre TODO el vocabulario', () => {
  const todas = [
    ...IUPC_CODIGOS.map(c => String(c.codigo)),
    ...CATEGORIAS_COMPLEMENTARIAS.map(c => String(c.codigo)),
    ...SERVICIOS_CODIGOS.map(c => String(c.codigo)),
  ];

  it('no queda ninguna familia sin cuenta y sin motivo', () => {
    const huerfanas = todas.filter(f => !familiaTieneCuenta(f) && !FAMILIAS_SIN_CUENTA.has(f));
    expect(huerfanas).toEqual([]);
  });

  it('toda cuenta de la tabla existe en el PCGE', () => {
    const inventadas = [];
    for (const [familia, m] of Object.entries(CUENTA_POR_FAMILIA)) {
      if (!esCuentaValida(m.compra)) inventadas.push(`${familia} compra→${m.compra}`);
      if (!esCuentaValida(m.venta)) inventadas.push(`${familia} venta→${m.venta}`);
    }
    expect(inventadas).toEqual([]);
  });

  it('toda familia mapeada dice qué es', () => {
    // El umbral es bajo a propósito: para «Asfalto» o «Vidrio» alcanza con
    // nombrarlo, y exigir un párrafo llevaría a rellenar con palabras. Lo que
    // no se admite es una fila muda.
    const mudas = Object.entries(CUENTA_POR_FAMILIA)
      .filter(([, m]) => !m.porque || m.porque.trim().length < 6).map(([f]) => f);
    expect(mudas).toEqual([]);
  });

  it('las que van a una cuenta no evidente explican el motivo, no solo el qué', () => {
    // Que el cemento vaya a «Materias primas» se entiende solo. Que una
    // herramienta vaya a la 656 y no a la 60, no: ésas tienen que decir por qué.
    for (const f of ['37', '83', 'administrativos', '47', 'S04', 'S11', 'S03']) {
      expect(CUENTA_POR_FAMILIA[f].porque.length).toBeGreaterThan(30);
    }
  });

  it('las cuentas provisionales también son cuentas de verdad', () => {
    expect(esCuentaValida(CUENTA_PROVISIONAL.compra)).toBe(true);
    expect(esCuentaValida(CUENTA_PROVISIONAL.venta)).toBe(true);
  });
});

describe('dónde va cada cosa — el contrato con la contadora', () => {
  const madre = (f) => cuentaMadreDeFamilia(f);

  it.each([
    ['21', '602', 'el cemento se incorpora a la obra'],
    ['03', '602', 'el fierro corrugado también'],
    ['72', '602', 'la tubería de PVC de redes interiores'],
    ['80', '602', 'el concreto premezclado'],
    ['53', '603', 'el diésel se consume, no queda en la obra'],
    ['34', '603', 'el gasohol igual'],
    ['01', '603', 'el aceite y lubricante'],
    ['94', '603', 'el encofrado se reutiliza, no queda'],
    ['37', '656', 'la 656 nombra las herramientas desechables'],
    ['83', '656', 'la 656 nombra la vestimenta y suministros de campo'],
    ['administrativos', '656', 'la 656 nombra lo que se consume en oficina'],
  ])('%s → %s (%s)', (familia, cuenta) => {
    expect(cuentaDeFamilia(familia).cuenta).toBe(cuenta);
  });

  it.each([
    ['S01', '635', 'alquiler de local'],
    ['S02', '635', 'alquiler de maquinaria'],
    ['S04', '624', 'el PCGE tiene subcuenta propia de capacitación'],
    ['S05', '632', 'la 632 incluye la consultoría medioambiental'],
    ['S07', '632', 'estudios y supervisión'],
    ['S08', '634', 'mantenimiento y reparaciones'],
    ['S09', '638', 'subcontrato es un contratista'],
    ['S12', '637', 'publicaciones'],
    ['S13', '636', 'servicios básicos'],
    ['S14', '638', 'la obra facturada por un tercero'],
    ['servicios', '639', 'el cajón del PCGE'],
  ])('%s → %s (%s)', (familia, cuenta) => {
    expect(cuentaDeFamilia(familia).cuenta).toBe(cuenta);
  });

  it('la mano de obra FACTURADA por un tercero es un contratista, no planilla', () => {
    // La 62 es la planilla propia. Si un tercero factura mano de obra, es un
    // servicio: mandarlo a 62 metería en gastos de personal a alguien que no
    // está en la planilla.
    expect(cuentaDeFamilia('47').cuenta).toBe('638');
    expect(madre('47')).toBe('63');
    expect(cuentaDeFamilia('47-1').cuenta).toBe('638');
  });

  it('los materiales se agrupan en la 60 y los servicios en la 63', () => {
    expect(madre('21')).toBe('60');
    expect(madre('53')).toBe('60');
    expect(madre('S03')).toBe('63');
    expect(madre('S09')).toBe('63');
    expect(madre('37')).toBe('65');
  });
});

describe('lo que NO se mapea, a propósito', () => {
  it('los índices de precios del INEI no son un gasto', () => {
    // 30 («dólar más inflación») y 39 (IPC) son índices del IUPC, no cosas que
    // se compren. Si el clasificador se los asigna a una descripción es un
    // falso positivo, y mandarlos a una cuenta sería asentar un error con cara
    // de dato bueno.
    expect(cuentaDeFamilia('30')).toBe(null);
    expect(cuentaDeFamilia('39')).toBe(null);
  });

  it('«no sé» no se convierte en una cuenta inventada', () => {
    expect(cuentaDeFamilia('sin_clasificar')).toBe(null);
    expect(cuentaDeFamilia('')).toBe(null);
    expect(cuentaDeFamilia(null)).toBe(null);
    expect(cuentaDeFamilia('una-familia-que-no-existe')).toBe(null);
  });
});

describe('ventas', () => {
  it('vender un servicio va a 704 Prestación de servicios', () => {
    expect(cuentaDeFamilia('S09', { esVenta: true }).cuenta).toBe('704');
    expect(cuentaDeFamilia('S14', { esVenta: true }).cuenta).toBe('704');
  });

  it('vender un material va a 701 Mercaderías', () => {
    expect(cuentaDeFamilia('21', { esVenta: true }).cuenta).toBe('701');
    expect(cuentaDeFamilia('37', { esVenta: true }).cuenta).toBe('701');
  });

  it('todas las ventas caen en la 70', () => {
    for (const f of ['21', 'S03', '37', 'administrativos']) {
      expect(cuentaMadreDe(cuentaDeFamilia(f, { esVenta: true }).cuenta).codigo).toBe('70');
    }
  });
});

describe('reagrupaciones del IUPC', () => {
  it('un código absorbido usa la cuenta del que lo absorbe', () => {
    // 22 y 23 se reagrupan en 21 (cemento). La tabla no los repite: los
    // resuelve por la misma reagrupación que usa el resto de la app.
    expect(REAGRUPACIONES_IUPC['22']).toBe('21');
    expect(cuentaDeFamilia('22').cuenta).toBe(cuentaDeFamilia('21').cuenta);
    expect(cuentaDeFamilia('73').cuenta).toBe(cuentaDeFamilia('72').cuenta);
  });
});

describe('las que hay que mirar', () => {
  it('la maquinaria queda marcada para revisar', () => {
    // Comprar una máquina es un activo fijo; alquilarla es un servicio; un
    // repuesto es un suministro. La familia no distingue, así que se elige lo
    // más probable y se avisa.
    for (const f of ['48', '49', '95']) expect(cuentaDeFamilia(f).revisar).toBe(true);
  });

  it('la alimentación del personal queda marcada: 625 o 631 según el caso', () => {
    expect(cuentaDeFamilia('S11').cuenta).toBe('625');
    expect(cuentaDeFamilia('S11').revisar).toBe(true);
  });

  it('lo que no admite duda no se marca', () => {
    expect(cuentaDeFamilia('S03').revisar).toBe(false);
    expect(cuentaDeFamilia('21').revisar).toBe(false);
  });
});
