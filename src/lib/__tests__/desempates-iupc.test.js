// ═══════════════════════════════════════════════════════════════════
// LOS SEIS PARES DIFÍCILES (tanda 3, 15-set-2026).
//
// Cada `it` de la primera mitad es un error REAL: o lo reportó Gabriel, o lo
// falló el motor local en la medición del 15-set, o lo fallaron los tres
// modelos del piloto de la tanda 2. Si alguien afloja una regla, el caso que
// la pidió vuelve a fallar acá y no en la bandeja de la contadora.
//
// La segunda mitad es la que cuida lo que NO hay que romper: una regla de
// desempate que pise el Anexo 2 o una corrección escrita a mano sería
// exactamente el envenenamiento que arregló la tanda 1, al revés.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DESEMPATES, desempateDe, reglasDesempateParaIA } from '../desempates-iupc.js';
import { clasificarConIUPC } from '../indices-unificados-iupc.js';

const cod = (texto, terminosCustom = null) => clasificarConIUPC(texto, { terminosCustom }).codigo;

describe('1. cable eléctrico ↔ acero y planchas', () => {
  it('🔴 ROLLO INDECO 14MM es cable [07] — el caso que los TRES modelos fallaron', () => {
    // Indeco es marca de conductores eléctricos. La descripción no dice
    // «cable» en ninguna parte: el motor lo dejaba en sin_clasificar y el
    // diccionario aprendido lo tenía en [87] Plancha aluzinc.
    expect(cod('ROLLO INDECO 14MM')).toBe('07');
  });

  it('el tipo de cable decide el código: NYY va a [19], no a [07]', () => {
    expect(cod('CABLE NYY 3-1X120MM2')).toBe('19');
    expect(cod('CABLE THW 90 14 AWG CEPER')).toBe('07');
  });

  it('un cable de acero NO es un conductor eléctrico', () => {
    // La regla se abstiene: acá «cable» es una guaya, no electricidad.
    const d = desempateDe('CABLE DE ACERO 1/2 PARA WINCHE', { codigoActual: '02' });
    expect(d).toBe(null);
  });
});

describe('2. EPP ↔ el material de la prenda', () => {
  it('🔴 GUANTE DE ACERO ANTICORTE es EPP [83], no [46] malla de acero', () => {
    expect(cod('GUANTE DE ACERO ANTICORTE DE MALLA METÁLICA TALLA M')).toBe('83');
  });

  it('🔴 PANTALON Y CAMISACO DE DRILL OBRERO es EPP, no [37] herramienta', () => {
    expect(cod('PANTALON Y CAMISACO DE DRILL OBRERO AZUL CON CINTA REFLECTIVA')).toBe('83');
  });

  it('pero el SERVICIO sobre la prenda no es la prenda', () => {
    // «SERVICIO DE LAVADO DE UNIFORMES» no es un EPP porque diga uniformes.
    expect(cod('SERVICIO DE LAVADO DE UNIFORMES DE OBRA')).not.toBe('83');
  });
});

describe('3. tubería ↔ [10] aparato sanitario', () => {
  it('🔴 el token «tubo» arrastraba media tubería al [10] («Tubo de abasto»)', () => {
    expect(cod('TUBO HDPE PE100 SDR 11 PN 16 110 mm N- franja A')).toBe('90');
    expect(cod('tubo rectangular 4 x 8 x 3mm')).toBe('65');
  });

  it('🔴 las dos gemelas caen en el MISMO código — la contradicción que abrió la tanda', () => {
    expect(cod('TUBO E. CUAD. 3/4IN * 1.2')).toBe(cod('TUBO E. CUAD. 3/4IN * 1.5'));
    expect(cod('TUBO E. CUAD. 3/4IN * 1.2')).toBe('65');
  });

  it('el PVC se parte según el uso: red [66] vs redes interiores [72]', () => {
    expect(cod('TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO')).toBe('66');
    expect(cod('TUBO PVC SAP 1/2 PARA INSTALACION')).toBe('72');
  });

  it('un tubo de abasto SÍ es aparato sanitario: la regla no se mete', () => {
    const d = desempateDe('TUBO DE ABASTO PARA LAVATORIO', { codigoActual: '10' });
    expect(d).toBe(null);
  });
});

describe('4. administrativos ↔ el material que parece', () => {
  it('🔴 PERFORADOR INDUSTRIAL FABER CASTELL perfora papel, no asfalto', () => {
    expect(cod('PERFORADOR INDUSTRIAL FABER CASTELL')).toBe('administrativos');
  });

  it('🔴 MESA DE MELAMINE es un mueble, no madera terciada', () => {
    expect(cod('MESA DE MELAMINE MARCA QUADRA')).toBe('administrativos');
  });

  it('🔴 CUSQUEÑA es cerveza (estaba aprendida como [21] cemento)', () => {
    expect(cod('CUSQUEÑA')).toBe('administrativos');
  });

  it('🔴 un cargo de banco o un anticipo no es un insumo de nada', () => {
    expect(cod('LA INMOBILIARIA BCP')).toBe('administrativos');
    expect(cod('ANTICIPO DE CLIENTE')).toBe('administrativos');
  });

  it('una mesa vibradora es maquinaria, no mobiliario', () => {
    expect(cod('MESA VIBRADORA PARA CONCRETO')).not.toBe('administrativos');
  });
});

describe('5. póliza ↔ material', () => {
  it('🔴 SEGURO DE CONSTRUCCION salía [37] Herramienta manual', () => {
    expect(cod('CT CANCELACION RECIBO 172949319. SEGURO DE CONSTRUCCION')).toBe('servicios');
  });

  it('el SCTR y el SOAT también son servicios', () => {
    expect(cod('RENOVACION SOAT CAMIONETA')).toBe('servicios');
  });
});

describe('6. [48] maquinaria liviana ↔ [37] herramienta manual', () => {
  it('con motor es maquinaria liviana', () => {
    expect(cod('MARTILLO DEMOLEDOR ROTOMARTILLO PROFESIONAL BOSCH 30KG GSH27')).toBe('48');
  });

  it('sin motor es herramienta manual', () => {
    expect(cod('CARRETILLA BUGGY TRUPER 11776 6 FT CAPACIDAD')).toBe('37');
  });

  it('este par solo se corrige entre ellos dos', () => {
    // Que una descripción diga «llave» no puede convertir un cemento en
    // herramienta: `pisa` está acotado a ['37','48'].
    const regla = DESEMPATES.find(r => r.id === 'maquinaria-vs-herramienta');
    expect(regla.pisa).toEqual(['37', '48']);
    expect(desempateDe('LLAVE DE PASO', { codigoActual: '77' })).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LO QUE LAS REGLAS NO PUEDEN PISAR (la jerarquía de la tanda 1)
// ═══════════════════════════════════════════════════════════════════
describe('la ley y la corrección a mano siguen ganando', () => {
  it('una coincidencia EXACTA del Anexo 2 es intocable', () => {
    expect(desempateDe('GUANTE DE CUERO', { codigoActual: '03', capa: 'oficial-exacto' })).toBe(null);
  });

  it('un término escrito A MANO en el panel es intocable', () => {
    expect(desempateDe('CUSQUEÑA', { codigoActual: '21', capa: 'manual' })).toBe(null);
  });

  it('🔴 pero SÍ le gana al diccionario APRENDIDO — ahí está el valor', () => {
    // «CUSQUEÑA → [21] cemento» era un término aprendido de una decisión mala.
    // Con la regla, la cerveza vuelve a ser cerveza sin que nadie limpie nada.
    const aprendido = [{ termino: 'CUSQUEÑA', clasificacion_codigo: '21', origen: 'decision' }];
    expect(cod('CUSQUEÑA', aprendido)).toBe('administrativos');
    const aMano = [{ termino: 'CUSQUEÑA', clasificacion_codigo: '21', origen: 'manual' }];
    expect(cod('CUSQUEÑA', aMano)).toBe('21');
  });

  it('no pisa un servicio ya encontrado por el árbol de servicios', () => {
    // Salvo la regla de póliza, que es la que lleva hacia allá.
    expect(desempateDe('MAMELUCO', { codigoActual: 'S09' })).toBe(null);
  });

  it('la respuesta corregida no queda en banda invisible', () => {
    // Una regla es evidencia dura: si quedara en «coincidencia rara» nadie la
    // miraría. Piso 0,60 y tope 0,90 (no es una coincidencia exacta).
    const r = clasificarConIUPC('ROLLO INDECO 14MM');
    expect(r.score).toBeGreaterThanOrEqual(0.6);
    expect(r.score).toBeLessThanOrEqual(0.9);
    expect(r.banda).toBe('media');
    expect(r.motivos.join(' ')).toMatch(/desempate/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LAS REGLAS TAMBIÉN SE LE CUENTAN A LA IA
// ═══════════════════════════════════════════════════════════════════
describe('reglasDesempateParaIA', () => {
  it('manda solo las que dispara ESTA descripción, no las seis', () => {
    const r = reglasDesempateParaIA('GUANTE DE ACERO ANTICORTE');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('epp-vs-material');
  });

  it('no manda una regla que empuja a un código que no está en la lista', () => {
    // Sería texto pagado que no puede terminar en ninguna respuesta válida.
    expect(reglasDesempateParaIA('ROLLO INDECO 14MM', ['21', '03'])).toHaveLength(0);
    expect(reglasDesempateParaIA('ROLLO INDECO 14MM', ['21', '07'])).toHaveLength(1);
  });

  it('un texto sin par difícil no agrega nada al prompt', () => {
    expect(reglasDesempateParaIA('CEMENTO PORTLAND TIPO I 42.5 KG')).toEqual([]);
    expect(reglasDesempateParaIA('')).toEqual([]);
  });

  it('todas las reglas tienen su texto para el prompt y su motivo para la persona', () => {
    for (const r of DESEMPATES) {
      expect(typeof r.prompt).toBe('string');
      expect(r.prompt.length).toBeGreaterThan(40);
      expect(r.prompt.length).toBeLessThan(400);   // el prompt se paga por token
      expect(typeof r.par).toBe('string');
    }
    expect(DESEMPATES).toHaveLength(6);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LA MEDICIÓN COMPLETA, CONTRA LOS 32 CASOS REALES DEL PILOTO.
//
// 🔴 ES UNA MEDICIÓN EN MUESTRA, y hay que leerla como tal: las reglas se
// escribieron mirando estos mismos casos, así que el número dice «las 13
// fallas medidas están cerradas», no «el motor acierta el 100% del mundo».
// Sirve igual para lo que tiene que servir: que ninguna vuelva sin que nadie
// se entere. Antes de la tanda 3 el motor local sacaba 19 de 32.
// ═══════════════════════════════════════════════════════════════════
describe('el motor local contra el set del piloto', () => {
  const SET = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'scripts/piloto/set-clasificacion.json'), 'utf8'));

  it('ninguno de los 32 casos reales queda fuera de su respuesta aceptable', () => {
    const fallan = SET.casos.filter(c =>
      ![c.esperado, ...(c.tambien_ok || [])].includes(clasificarConIUPC(c.descripcion).codigo));
    expect(fallan.map(c => c.descripcion)).toEqual([]);
  });

  it('y al menos 25 caen en el código esperado EXACTO, no en el tolerado', () => {
    const exactos = SET.casos.filter(c =>
      clasificarConIUPC(c.descripcion).codigo === c.esperado).length;
    expect(exactos).toBeGreaterThanOrEqual(25);
  });
});
