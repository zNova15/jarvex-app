import { describe, it, expect } from 'vitest';
import {
  tokensInsumo, prepararCatalogo, recomendarInsumos, decidirSugerencia, candidatosDelTexto,
  parsearTextoLocal, fechaDeTexto, responsableDe, completarConAlmacen, familiaUnidad, mismaUnidad,
} from '../match-solicitud.js';
import { armarRespuesta } from '../../../api/asistente-solicitud.js';
import { volcarEnItems, notaPedidoComo, interpretarLocal } from '../asistente-solicitud-ai.js';
import ALMACEN from './fixtures/almacen-obra-agua-24set.json';

// Recorte REAL del almacén de la obra de agua (24-set-2026): los 139 insumos
// que empiezan con codo/tee/adaptador/niple/unión/válvula/llave/tubo/caja/
// alambre/cable, con sus nombres tal cual (comillas ¨ ` ", F°G°, x90°, etc.).
const PREP = prepararCatalogo(ALMACEN);
const id = (nombre) => ALMACEN.find(m => m.nombre === nombre)?.id;

// Los dos mensajes que Gabriel pegó el 24-set y que devolvían «El
// requerimiento es demasiado largo para procesarlo de una vez».
const AGUA = `Buenos días
*Requerimiento:*
369 Codo pvc 1/2"x90°
123 Tee pvc 1/2"
328 adaptador pvc 1/2"
164 codo bronce 1/2" x90°
82 Codo pvc hilo a/l 1/2"
164 niples pvc 1/2" x 1"
82 unión universal pvc roscado
41 valvula 1/2"
41 llave para ducha
*Responsable*
Eddy Gil
*Fecha de requerimiento*
Lunes 14 de septiembre
*Razón de requerimiento*
 UBS: Sistema de agua`;

const LUZ = `Buenos días
*Requerimiento:*
82 TUBERIA PVC SEL 3/4"
205 CURVAS PVC-SEL 3/4" (20 mm)
41 CAJA PARA LLAVE TERMOMAGNETICA
41 LLAVE TERMOMAGNETICA DE 2x16 AMP
41 INTERRUPTOR BIPOLAR
82 CAJA OCTOGONAL SEL DE 100X50 mm
41 CAJA RECTANGULAR SAP DE 100 x 55 x 50 mm
615 ALAMBRE TW 2.5 mm2
41 SOQUETE DE BAQUELITA + FOCO AHORRADOR
LUZ CALIDA x 15w
*Responsable*
Eddy Gil
*Fecha de requerimiento*
Lunes 14 de septiembre
*Razón de requerimiento*
 UBS: Sistema de electricidad para los 41 UBS`;

const PERSONAL = [{ id: 'p-eddy', nombre: 'Eddy Gil', cargo: 'Maestro' }, { id: 'p-rox', nombre: 'Roxana Vásquez', cargo: 'Ing. SSOMA' }];

const mejor = (nombre, tipo = 'material') => {
  const c = recomendarInsumos(nombre, PREP, { tipo });
  return { c, d: decidirSugerencia(c, { tipo }) };
};

// ═══════════════════════════════════════════════════════════════════
describe('tokensInsumo — las medidas como las escribe cada uno', () => {
  it('todas las comillas de pulgada dicen lo mismo', () => {
    for (const n of ['TEE 1/2"', 'TEE 1/2`', 'TEE 1/2¨', "TEE 1/2''", 'TEE ½']) {
      expect(tokensInsumo(n).medidas).toEqual(['1/2']);
    }
  });

  it('1 1/2 es UNA medida, no un 1 y un 1/2', () => {
    expect(tokensInsumo('CODO DE 1 1/2 X 90°').medidas).toEqual(['1y1/2', '90']);
    expect(tokensInsumo('TUBO DE 1¨1/2¨ C-10').medidas).toEqual(['1y1/2']);
  });

  it('la x pegada y el grado no ensucian: «1/2"x90°» = 1/2 y 90', () => {
    expect(tokensInsumo('Codo pvc 1/2"x90°')).toEqual({ palabras: ['codo', 'pvc'], medidas: ['1/2', '90'] });
  });

  it('F°G° y galvanizado son lo mismo', () => {
    expect(tokensInsumo('CODO DE 2" X 90° F°G°').palabras).toContain('fg');
    expect(tokensInsumo('codo 2 galvanizado').palabras).toContain('fg');
  });

  it('la clase del tubo (C-10, S-25) no es una medida suelta', () => {
    expect(tokensInsumo('TUBO PVC-U 3/4" C-10 SP PRESION HT').medidas).toEqual(['3/4']);
  });

  it('decimales con coma o punto, y la unidad pegada se despega', () => {
    expect(tokensInsumo('ALAMBRE TW 2,5mm2').medidas).toEqual(['2.5']);
    expect(tokensInsumo('ALAMBRE TW 2.5 mm2').medidas).toEqual(['2.5']);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('recomendar — el mensaje del sistema de agua contra el almacén real', () => {
  it('codo pvc 1/2 x 90 → el CODO DE 1/2" x 90° PVC, no el de 45 ni el F°G°', () => {
    const { c, d } = mejor('Codo pvc 1/2"x90°');
    expect(d.elegido.id).toBe(id('CODO DE 1/2" x 90° PVC'));
    // El de 45° y el galvanizado NO pueden estar arriba del de PVC 90°.
    const idx = (n) => c.findIndex(x => x.id === id(n));
    expect(idx('CODO 1/2" X 45')).toBe(-1);
    const fg = idx('CODO DE 1/2" X 90° F°G°');
    expect(fg === -1 || fg > 0).toBe(true);
  });

  it('tee pvc 1/2 → el TEE INY 1/2 (inyectado ES pvc)', () => {
    expect(mejor('Tee pvc 1/2"').d.elegido.id).toBe(id('TEE INY 1/2` SP PRESIÒN'));
  });

  it('adaptador pvc 1/2 → ADAPTADOR 1/2", nunca el de 3/4 ni el de 1 1/2', () => {
    const { c, d } = mejor('adaptador pvc 1/2"');
    expect(d.elegido.id).toBe(id('ADAPTADOR 1/2"'));
    expect(c.some(x => x.id === id('ADAPTADOR DE 3/4"'))).toBe(false);
    expect(c.some(x => x.id === id('ADAPTADOR 1 1/2"'))).toBe(false);
  });

  it('válvula 1/2 → VALVULA 1/2", el nombre exacto le gana al «para medidor»', () => {
    const { c, d } = mejor('valvula 1/2"');
    expect(d.elegido.id).toBe(id('VALVULA 1/2"'));
    expect(c.some(x => x.id === id('VALVULA DE 1/2" PARA MEDIDOR'))).toBe(true);   // queda de alternativa
  });

  it('codo de BRONCE: en el almacén no hay → no se vincula a uno de PVC ni F°G°', () => {
    expect(mejor('codo bronce 1/2" x90°').d.elegido).toBeNull();
  });

  it('niple 1/2 x 1: ningún niple de otra medida se acerca', () => {
    const { c, d } = mejor('niples pvc 1/2" x 1"');
    expect(d.elegido).toBeNull();
    expect(c.every(x => !/2" X 2"|4" X/.test(x.nombre))).toBe(true);
  });

  it('unión universal SIN medida: empatan 1/2, 3/4, 1… → no elige, las muestra', () => {
    const { c, d } = mejor('unión universal pvc roscado');
    expect(d.elegido).toBeNull();
    expect(c.filter(x => /UNION UNIVERSAL/i.test(x.nombre)).length).toBeGreaterThanOrEqual(3);
  });

  it('llave para ducha no es una LLAVE ESTILSON', () => {
    expect(mejor('llave para ducha').d.elegido).toBeNull();
  });
});

describe('recomendar — el mensaje eléctrico: en el almacén de agua no hay nada', () => {
  it('tubería PVC SEL 3/4 NO es un tubo PVC SAP/presión 3/4 (eléctrico vs agua)', () => {
    const { c, d } = mejor('TUBERIA PVC SEL 3/4"');
    expect(d.elegido).toBeNull();
    expect(c.some(x => x.id === id('TUBO PVC SAP 3/4" X 5MTS C-10TUBOP') && x.score >= 0.6)).toBe(false);
  });

  it('caja para llave termomagnética no es una «CAJA Y MARCO Y TAPA PARA AGUA»', () => {
    expect(mejor('CAJA PARA LLAVE TERMOMAGNETICA').d.elegido).toBeNull();
  });

  it('alambre TW 2.5 mm2 no es alambre N° 16', () => {
    expect(mejor('ALAMBRE TW 2.5 mm2').d.elegido).toBeNull();
  });

  it('ningún ítem del mensaje eléctrico se vincula', () => {
    const r = completarConAlmacen(parsearTextoLocal(LUZ, { hoy: '2026-09-24' }), PREP);
    expect(r.items).toHaveLength(9);
    expect(r.items.every(i => i.insumo_id === null)).toBe(true);
  });
});

describe('decidirSugerencia', () => {
  it('no preselecciona un candidato de OTRO tipo aunque sea idéntico', () => {
    const prep = prepararCatalogo([{ id: 'm', tipo: 'material', nombre: 'Guantes de badana', unidad: 'par' }]);
    const c = recomendarInsumos('Guantes de badana', prep, { tipo: 'epp' });
    expect(c[0].id).toBe('m');                                  // aparece como alternativa
    expect(decidirSugerencia(c, { tipo: 'epp' }).elegido).toBeNull();
  });
});

describe('candidatosDelTexto — lo que ve la IA', () => {
  it('achica el catálogo a lo que se parece al mensaje', () => {
    const c = candidatosDelTexto(AGUA, PREP);
    expect(c.length).toBeGreaterThan(3);
    expect(c.length).toBeLessThan(60);
    expect(c.some(x => x.id === id('CODO DE 1/2" x 90° PVC'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('parsearTextoLocal — el mensaje de WhatsApp sin IA', () => {
  const r = parsearTextoLocal(AGUA, { hoy: '2026-09-24', personal: PERSONAL });

  it('saca los 9 ítems con cantidad y nombre separados', () => {
    expect(r.items).toHaveLength(9);
    expect(r.items[0]).toMatchObject({ nombre: 'Codo pvc 1/2"x90°', cantidad: 369, unidad: 'und', tipo: 'material' });
    expect(r.items[8]).toMatchObject({ nombre: 'llave para ducha', cantidad: 41 });
    expect(r.items.every(i => !/^\d/.test(i.nombre))).toBe(true);
  });

  it('el saludo no es un ítem', () => {
    expect(r.items.some(i => /buenos/i.test(i.nombre))).toBe(false);
  });

  it('responsable, fecha y razón salen de sus secciones', () => {
    expect(r.responsable_nombre).toBe('Eddy Gil');
    expect(r.responsable_id).toBe('p-eddy');
    expect(r.fecha_necesidad).toBe('2026-09-14');
    expect(r.razon).toBe('UBS: Sistema de agua');
  });

  it('el renglón sin cantidad es la continuación del ítem de arriba', () => {
    const l = parsearTextoLocal(LUZ, { hoy: '2026-09-24' });
    expect(l.items).toHaveLength(9);
    expect(l.items[8].nombre).toBe('SOQUETE DE BAQUELITA + FOCO AHORRADOR LUZ CALIDA x 15w');
  });

  it('«CAJA» al principio es lo que se pide, no la unidad', () => {
    const l = parsearTextoLocal(LUZ, { hoy: '2026-09-24' });
    expect(l.items[2]).toMatchObject({ nombre: 'CAJA PARA LLAVE TERMOMAGNETICA', unidad: 'und' });
    expect(parsearTextoLocal('*Requerimiento*\n3 cajas de clavos').items[0]).toMatchObject({ nombre: 'clavos', unidad: 'caja' });
  });

  it('entiende «Responsable: X» y «Mínimo necesario: fecha» en la misma línea', () => {
    const l = parsearTextoLocal('Requerimiento: 9 und Triplay 30 cm x 55 cm\nResponsable: ING. ROXANA VÁSQUEZ\nFecha: 30/09/2026\nMínimo Necesario: 28/09/2026', { hoy: '2026-09-24', personal: PERSONAL });
    expect(l.items[0]).toMatchObject({ nombre: 'Triplay 30 cm x 55 cm', cantidad: 9, unidad: 'und' });
    expect(l.responsable_id).toBe('p-rox');
    expect(l.fecha_necesidad).toBe('2026-09-30');
    expect(l.fecha_urgente).toBe('2026-09-28');
  });
});

describe('fechaDeTexto / responsableDe / unidades', () => {
  it('fechas en los formatos de obra', () => {
    expect(fechaDeTexto('Lunes 14 de septiembre', '2026-09-24')).toBe('2026-09-14');
    expect(fechaDeTexto('jueves 1 de octubre', '2026-09-24')).toBe('2026-10-01');
    expect(fechaDeTexto('14/09', '2026-09-24')).toBe('2026-09-14');
    expect(fechaDeTexto('14-09-26', '2026-09-24')).toBe('2026-09-14');
    expect(fechaDeTexto('mañana', '2026-09-24')).toBeNull();
  });

  it('un nombre ambiguo no se adivina', () => {
    const dos = [{ id: 'a', nombre: 'Eddy Gil' }, { id: 'b', nombre: 'Eddy Ramos' }];
    expect(responsableDe('Eddy', dos)).toBeNull();
    expect(responsableDe('eddy gil', dos).id).toBe('a');
  });

  it('und = UNIDAD = pza; m = MTR; kg ≠ bls', () => {
    expect(mismaUnidad('und', 'UNIDAD')).toBe(true);
    expect(mismaUnidad('m', 'MTR')).toBe(true);
    expect(mismaUnidad('kg', 'bls')).toBe(false);
    expect(familiaUnidad('KILOS')).toBe('kg');
  });
});

// ═══════════════════════════════════════════════════════════════════
// El camino entero, como lo arma el endpoint (sin red).
// ═══════════════════════════════════════════════════════════════════
describe('armarRespuesta — de la lectura a la pantalla', () => {
  const body = { texto: AGUA, catalogo: ALMACEN, personal: PERSONAL, fecha_actual: '2026-09-24' };

  it('con el lector local: vincula lo que hay, deja libre lo que no, y avisa', () => {
    const r = armarRespuesta(parsearTextoLocal(AGUA, { hoy: '2026-09-24', personal: PERSONAL }), body, { motivoLocal: 'prueba' });
    const porNombre = Object.fromEntries(r.items.map(i => [i.nombre, i]));
    expect(porNombre['Codo pvc 1/2"x90°'].insumo_id).toBe(id('CODO DE 1/2" x 90° PVC'));
    expect(porNombre['Codo pvc 1/2"x90°'].sugerencia).toMatchObject({ fuente: 'similitud' });
    expect(porNombre['codo bronce 1/2" x90°'].insumo_id).toBeNull();
    expect(porNombre['unión universal pvc roscado'].insumo_id).toBeNull();
    expect(porNombre['unión universal pvc roscado'].alternativas.length).toBeGreaterThan(2);
    expect(r.responsable_id).toBe('p-eddy');
    expect(r.advertencias[0]).toMatch(/sin IA/);
    expect(r.advertencias.join(' ')).toMatch(/varios parecidos/);
  });

  it('la fecha del mensaje que ya pasó no va al formulario, y se avisa', () => {
    const r = armarRespuesta(parsearTextoLocal(AGUA, { hoy: '2026-09-24' }), body);
    expect(r.fecha_necesidad).toBeNull();
    expect(r.advertencias.join(' ')).toMatch(/14\/09\/2026\) ya pasó/);
  });

  it('la elección de la IA se respeta si la medida coincide…', () => {
    const r = armarRespuesta({ items: [{ tipo: 'material', nombre: 'valvula 1/2"', cantidad: 41, insumo_id: id('VALVULA DE 1/2" PARA MEDIDOR') }] }, body);
    expect(r.items[0].insumo_id).toBe(id('VALVULA DE 1/2" PARA MEDIDOR'));
    expect(r.items[0].sugerencia.fuente).toBe('ia');
  });

  it('…y se descarta si la IA eligió otra medida', () => {
    const r = armarRespuesta({ items: [{ tipo: 'material', nombre: 'adaptador pvc 1/2"', cantidad: 5, insumo_id: id('ADAPTADOR 1 1/2"') }] }, body);
    // No queda el de 1 1/2: gana la similitud (el de 1/2).
    expect(r.items[0].insumo_id).toBe(id('ADAPTADOR 1/2"'));
    expect(r.items[0].sugerencia.fuente).toBe('similitud');
    expect(r.advertencias.join(' ')).toMatch(/no coincide en medida o material/);
  });

  it('las advertencias de la IA sobre el almacén o la fecha se tiran (las decide la app)', () => {
    // Textuales de la prueba real del 24-set: la primera contradecía al tee ya vinculado.
    const r = armarRespuesta({
      items: [{ tipo: 'material', nombre: 'Tee pvc 1/2"', cantidad: 123 }],
      advertencias: [
        'Varios ítems no tienen match exacto en el almacén y se deberán comprar: Tee pvc 1/2"',
        'La fecha de requerimiento (2026-09-14) ya ha pasado respecto a la fecha de hoy (2026-09-24)',
        '"llave para ducha" no especifica unidad, se infiere "und"',
      ],
    }, body);
    expect(r.advertencias).toEqual(['"llave para ducha" no especifica unidad, se infiere "und"']);
    expect(r.items[0].insumo_id).toBe(id('TEE INY 1/2` SP PRESIÒN'));
  });

  it('si la IA vincula a otra tabla, la fila toma ese tipo', () => {
    const cat = [...ALMACEN, { id: 'h1', tipo: 'herramienta', nombre: 'Carretilla buggy', unidad: 'und', stock_actual: 3 }];
    const r = armarRespuesta({ items: [{ tipo: 'material', nombre: 'carretilla buggy', cantidad: 2, insumo_id: 'h1' }] }, { ...body, catalogo: cat });
    expect(r.items[0]).toMatchObject({ insumo_id: 'h1', tipo: 'herramienta' });
  });
});

describe('volcarEnItems — la fila vinculada muestra el nombre del almacén y recuerda lo pedido', () => {
  let n = 0;
  const nuevoItem = () => ({ id: `l${++n}`, tipo: 'material', insumo_id: '', nombre: '', unidad: '', cantidad: '', cantidad_minima: '', notas: '' });
  const r = armarRespuesta(parsearTextoLocal(AGUA, { hoy: '2026-09-24' }), { texto: AGUA, catalogo: ALMACEN, fecha_actual: '2026-09-24' });
  const filas = volcarEnItems(r, { catalogo: ALMACEN, nuevoItem });

  it('nombre del almacén, texto de la obra aparte, y marcado como sugerido', () => {
    const f = filas[0];
    expect(f.nombre).toBe('CODO DE 1/2" x 90° PVC');
    expect(f.texto_pedido).toBe('Codo pvc 1/2"x90°');
    expect(f.sugerencia.fuente).toBe('similitud');
    expect(f.unidad).toBe('und');
    expect(f.cantidad).toBe('369');
  });

  it('la nota «Pedido como» solo cuando el nombre cambió', () => {
    expect(notaPedidoComo(filas[0])).toBe('Pedido como «Codo pvc 1/2"x90°»');
    expect(notaPedidoComo({ insumo_id: 'x', nombre: 'Cemento', texto_pedido: 'cemento' })).toBe('');
    expect(notaPedidoComo({ insumo_id: '', nombre: 'X', texto_pedido: 'Y' })).toBe('');
  });

  it('lo que no está queda con su nombre y con alternativas para elegir', () => {
    const f = filas.find(x => x.texto_pedido === 'unión universal pvc roscado');
    expect(f.insumo_id).toBe('');
    expect(f.nombre).toBe('unión universal pvc roscado');
    expect(f.alternativas.length).toBeGreaterThan(2);
  });
});

describe('interpretarLocal — sin señal en la obra', () => {
  it('arma la solicitud entera en el dispositivo', () => {
    const r = interpretarLocal({ texto: LUZ, catalogo: ALMACEN, personal: PERSONAL, fechaActual: '2026-09-24' });
    expect(r.items).toHaveLength(9);
    expect(r.responsable_nombre).toBe('Eddy Gil');
    expect(r.fecha_necesidad).toBeNull();                // 14-set ya pasó
    expect(r.advertencias[0]).toMatch(/sin IA \(sin conexión\)/);
  });
});
