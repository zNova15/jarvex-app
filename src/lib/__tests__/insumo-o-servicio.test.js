// Tests del corte insumo / servicio / ni-uno-ni-otro (tanda 3, 15-set-2026).
//
// El caso que originó todo es REAL y está acá con su texto exacto: los
// «gastos administrativos del centro del proceso arbitral» de E001-209 y
// E001-210 (S/ 7.000 cada uno), que aparecían en la pestaña 🧱 Insumos.
//
// Lo que estos tests protegen es la CASCADA: que una señal no le gane a otra
// que va antes. `tipo_insumo` dice «material» para el arbitraje, para el
// alquiler de equipos topográficos y para el SCTR — si esa señal se colara
// primero, el problema volvería con otra cara.
import { describe, it, expect } from 'vitest';
import {
  arbolDeNombre, arbolPorNombre, entraEnPestania, contarArboles,
  noInventariables, llaveNoInventario,
  AMBITO_NO_INVENTARIO, DECISION_NO_INVENTARIO,
} from '../insumo-o-servicio.js';

const linea = (nombre, tipoInsumo = null) => ({ nombre, tipoInsumo });

describe('arbolDeNombre — el caso que lo pidió', () => {
  const ARBITRAJE = 'gastos administrativos del centro, del proceso arbitral seguido entre el consorcio santa y la municipaldad distrital de nuevo chimbote- exp.nro.044-2023-coar - pago en via de subrogacion.';

  it('el arbitraje del Consorcio Santa NO es un insumo', () => {
    // tipo_insumo REAL de esa línea en producción: 'material'.
    expect(arbolDeNombre(linea(ARBITRAJE, 'material'))).toBe('otro');
  });

  it('su gemela de la otra factura cae en el mismo árbol (se pueden correlacionar)', () => {
    const otra = 'gastos administrativos del centro, del proceso arbitral seguido entre el consorcio santa contra la municipalidad distrital de nuevo chimbote-exp nro.044-2023-coar.';
    expect(arbolDeNombre(linea(otra, 'material'))).toBe('otro');
  });
});

describe('arbolDeNombre — las tres señales, en orden', () => {
  it('lo contractual y financiero va a «otro», aunque la IA diga material', () => {
    expect(arbolDeNombre(linea('ANTICIPO DE CLIENTE', 'material'))).toBe('otro');
    expect(arbolDeNombre(linea('DETRACCION DEL 12%', 'material'))).toBe('otro');
    expect(arbolDeNombre(linea('PENALIDAD POR INCUMPLIMIENTO DE PLAZO', 'material'))).toBe('otro');
    expect(arbolDeNombre(linea('INTERESES POR PAGO FUERA DE FECHA', 'material'))).toBe('otro');
    expect(arbolDeNombre(linea('CT CANCELACION RECIBO 171515564. SEGURO DE SCTR SALUD', 'material'))).toBe('otro');
  });

  it('las valorizaciones de obra son un SERVICIO, no una herramienta', () => {
    // tipo_insumo REAL en producción para esta línea: 'herramienta'.
    const v = 'valorizacion n 06 correspondiente al mes de julio del 2022 de la obra: saldo de obra: recuperacion de la i.e. n 040';
    expect(arbolDeNombre(linea(v, 'herramienta'))).toBe('servicio');
  });

  it('el alquiler es un servicio aunque la factura lo tipee como material', () => {
    const a = 'alquiler de equipos topograficos (01 gps diferencial, 02 colectoras, 01 estacion total)';
    expect(arbolDeNombre(linea(a, 'material'))).toBe('servicio');
  });

  it('`tipo_insumo` decide solo cuando las otras dos callaron', () => {
    // Un texto que ni el IUPC ni los patrones reconocen.
    expect(arbolDeNombre(linea('ZZQX-9 REF 4410', 'servicio'))).toBe('servicio');
    expect(arbolDeNombre(linea('ZZQX-9 REF 4410', 'maquinaria'))).toBe('insumo');
    expect(arbolDeNombre(linea('ZZQX-9 REF 4410', 'epp'))).toBe('insumo');
    expect(arbolDeNombre(linea('ZZQX-9 REF 4410', null))).toBe('desconocido');
  });

  it('un bien reconocido sigue siendo un insumo (no se rompió lo que andaba)', () => {
    expect(arbolDeNombre(linea('CEMENTO PORTLAND TIPO I', 'material'))).toBe('insumo');
    expect(arbolDeNombre(linea('VARILLA DE ACERO CORRUGADO 1/2', 'material'))).toBe('insumo');
  });

  it('acepta un string suelto (sin línea): corren las dos primeras señales', () => {
    expect(arbolDeNombre('ALQUILER DE RETROEXCAVADORA')).toBe('servicio');
    expect(arbolDeNombre('')).toBe('desconocido');
    expect(arbolDeNombre(null)).toBe('desconocido');
  });
});

describe('entraEnPestania — lo desconocido no se queda huérfano', () => {
  it('lo «desconocido» entra en las tres: su gemela puede estar de cualquier lado', () => {
    expect(entraEnPestania('desconocido', 'insumo')).toBe(true);
    expect(entraEnPestania('desconocido', 'servicio')).toBe(true);
    expect(entraEnPestania('desconocido', 'otro')).toBe(true);
  });

  it('lo que SÍ se reconoce vive en UNA sola pestaña', () => {
    expect(entraEnPestania('otro', 'insumo')).toBe(false);
    expect(entraEnPestania('otro', 'otro')).toBe(true);
    expect(entraEnPestania('insumo', 'servicio')).toBe(false);
    expect(entraEnPestania('servicio', 'servicio')).toBe(true);
  });
});

describe('arbolPorNombre y contarArboles', () => {
  const lineas = [
    { nombre: 'CEMENTO SOL', nombreNorm: 'cemento sol', tipoInsumo: 'material' },
    { nombre: 'Cemento Sol', nombreNorm: 'cemento sol', tipoInsumo: 'servicio' },  // mal tipeada: gana la primera
    { nombre: 'ALQUILER DE VOLQUETE', nombreNorm: 'alquiler de volquete', tipoInsumo: 'material' },
    { nombre: 'DETRACCION', nombreNorm: 'detraccion', tipoInsumo: 'material' },
    { nombre: 'ZZQX-9 REF 4410', nombreNorm: 'zzqx 9 ref 4410', tipoInsumo: null },
  ];

  it('clasifica cada nombre una sola vez y gana la primera línea', () => {
    const m = arbolPorNombre(lineas);
    expect(m.get('cemento sol')).toBe('insumo');
    expect(m.get('alquiler de volquete')).toBe('servicio');
    expect(m.get('detraccion')).toBe('otro');
    expect(m.get('zzqx 9 ref 4410')).toBe('desconocido');
    expect(m.size).toBe(4);
  });

  it('cuenta por árbol para los carteles de la pantalla', () => {
    expect(contarArboles(arbolPorNombre(lineas)))
      .toEqual({ insumo: 1, servicio: 1, otro: 1, desconocido: 1 });
  });

  it('no explota sin datos', () => {
    expect(arbolPorNombre(null).size).toBe(0);
    expect(contarArboles(null)).toEqual({ insumo: 0, servicio: 0, otro: 0, desconocido: 0 });
  });
});

describe('noInventariables — «esto no va al inventario»', () => {
  const fila = (extra) => ({
    ambito: AMBITO_NO_INVENTARIO, decision: DECISION_NO_INVENTARIO,
    llave: 'detraccion', deleted_at: null, ...extra,
  });

  it('junta las llaves marcadas', () => {
    const s = noInventariables([fila({}), fila({ llave: 'penalidad' })]);
    expect([...s].sort()).toEqual(['detraccion', 'penalidad']);
  });

  it('ignora otros ámbitos, otras decisiones y las dadas de baja', () => {
    const s = noInventariables([
      fila({ ambito: 'escaner' }),
      fila({ decision: 'revisada', llave: 'x' }),
      fila({ deleted_at: '2026-09-15', llave: 'y' }),
      fila({ llave: '' }),
      null,
    ]);
    expect(s.size).toBe(0);
  });

  it('la llave es el nombre normalizado (misma norma que las correlaciones)', () => {
    expect(llaveNoInventario('  DETRACCIÓN  del 12% ')).toBe('detraccion del 12');
    expect(llaveNoInventario('Clavos de 8\'\'')).toBe('clavos de 8');
  });

  it('sin datos devuelve un set vacío', () => {
    expect(noInventariables(null).size).toBe(0);
    expect(noInventariables([]).size).toBe(0);
  });
});
