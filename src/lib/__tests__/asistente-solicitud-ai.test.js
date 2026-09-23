import { describe, it, expect } from 'vitest';
import { armarCatalogo, armarPersonal, volcarEnItems, armarRazon } from '../asistente-solicitud-ai.js';
import { sanearResultado } from '../../../api/asistente-solicitud.js';

let n = 0;
const nuevoItem = () => ({ id: `local_${++n}`, tipo: 'material', insumo_id: '', nombre: '', unidad: '', cantidad: '', cantidad_minima: '', notas: '' });

const CATALOGO = [
  { id: 'cem', tipo: 'material', nombre: 'Cemento Sol Tipo I', unidad: 'bls', stock_actual: 10 },
  { id: 'tri', tipo: 'material', nombre: 'Triplay 30 cm x 55 cm', unidad: 'und', stock_actual: 4 },
  { id: 'gua', tipo: 'epp', nombre: 'Guantes de badana', unidad: 'par', stock_actual: 20 },
];
const PERSONAL = [
  { id: 'p1', nombres: 'Roxana', apellidos: 'Vásquez', cargo: 'Ing. SSOMA' },
  { id: 'p2', nombres: 'Eddy', apellidos: 'Gil', cargo: 'Maestro' },
];

describe('armarCatalogo', () => {
  it('aplana los cinco inventarios en una sola lista con su tipo', () => {
    const cat = armarCatalogo({
      material: [{ id: 'm1', nombre: 'Cemento', unidad: 'bls', stock_actual: 3 }],
      epp: [{ id: 'e1', nombre: 'Casco', unidad: 'und' }],
      maquinaria: [{ id: 'q1', nombre: 'Mezcladora' }],
    });
    expect(cat).toHaveLength(3);
    expect(cat.find(x => x.id === 'e1').tipo).toBe('epp');
    expect(cat.find(x => x.id === 'q1').tipo).toBe('maquinaria');
  });

  it('descarta filas sin id o sin nombre y respeta el tope', () => {
    const cat = armarCatalogo({ material: [{ id: 'a', nombre: '' }, { nombre: 'sin id' }, { id: 'b', nombre: 'Arena' }] });
    expect(cat).toEqual([{ id: 'b', tipo: 'material', nombre: 'Arena', unidad: '', stock_actual: null }]);
    expect(armarCatalogo({ material: [{ id: '1', nombre: 'a' }, { id: '2', nombre: 'b' }] }, 1)).toHaveLength(1);
  });
});

describe('armarPersonal', () => {
  it('junta nombres y apellidos y descarta los borrados', () => {
    const p = armarPersonal([...PERSONAL, { id: 'p3', nombres: 'Ex', apellidos: 'Empleado', deleted_at: '2026-01-01' }]);
    expect(p).toHaveLength(2);
    expect(p[0]).toEqual({ id: 'p1', nombre: 'Roxana Vásquez', cargo: 'Ing. SSOMA' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// sanearResultado — la defensa contra el id inventado
// ═══════════════════════════════════════════════════════════════════
describe('sanearResultado', () => {
  it('tira el insumo_id que no está en el catálogo y lo dice en una advertencia', () => {
    const r = sanearResultado({
      items: [{ tipo: 'material', insumo_id: 'no-existe', nombre: 'Biodigestor', cantidad: 5, unidad: 'und' }],
    }, { catalogo: CATALOGO });
    expect(r.items[0].insumo_id).toBeNull();
    expect(r.advertencias.join(' ')).toMatch(/no está en el catálogo/i);
  });

  it('conserva el insumo_id que SÍ está', () => {
    const r = sanearResultado({ items: [{ tipo: 'material', insumo_id: 'cem', nombre: 'Cemento', cantidad: 5 }] }, { catalogo: CATALOGO });
    expect(r.items[0].insumo_id).toBe('cem');
  });

  it('tira el responsable_id que no está en el personal', () => {
    expect(sanearResultado({ responsable_id: 'fantasma', responsable_nombre: 'Juan' }, { personal: PERSONAL }).responsable_id).toBeNull();
    expect(sanearResultado({ responsable_id: 'p1' }, { personal: PERSONAL }).responsable_id).toBe('p1');
  });

  it('un tipo o una prioridad que no existen caen al default, no rompen', () => {
    const r = sanearResultado({ items: [{ tipo: 'inventado', nombre: 'X', cantidad: 1 }], prioridad: 'altísima' });
    expect(r.items[0].tipo).toBe('material');
    expect(r.prioridad).toBe('normal');
  });

  it('las fechas que no son YYYY-MM-DD se descartan', () => {
    const r = sanearResultado({ fecha_necesidad: 'jueves 25', fecha_urgente: '2026-09-23' });
    expect(r.fecha_necesidad).toBeNull();
    expect(r.fecha_urgente).toBe('2026-09-23');
  });

  it('cantidad cero o negativa queda en null (la escribe la persona)', () => {
    const r = sanearResultado({ items: [{ nombre: 'X', cantidad: 0 }, { nombre: 'Y', cantidad: -3 }] });
    expect(r.items.map(i => i.cantidad)).toEqual([null, null]);
  });

  it('un ítem sin nombre se descarta entero', () => {
    expect(sanearResultado({ items: [{ nombre: '   ', cantidad: 5 }] }).items).toHaveLength(0);
  });

  it('sobrevive a una respuesta vacía o basura', () => {
    for (const basura of [null, {}, { items: 'no es lista' }]) {
      const r = sanearResultado(basura);
      expect(r.items).toEqual([]);
      expect(r.prioridad).toBe('normal');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Los dos mensajes REALES que pasó Gabriel (23-set-2026)
// ═══════════════════════════════════════════════════════════════════
describe('volcarEnItems — el mensaje de los biodigestores', () => {
  // "5 biodigestores / 1 techo metálico / Responsable Eddy Gil / ..."
  const result = sanearResultado({
    items: [
      { tipo: 'material', insumo_id: null, nombre: 'Biodigestor', cantidad: 5, unidad: 'und' },
      { tipo: 'material', insumo_id: null, nombre: 'Techo metálico', cantidad: 1, unidad: 'und' },
    ],
    responsable_id: 'p2', responsable_nombre: 'Eddy Gil',
    razon: 'UBS: instalación biodigestor, y ubicación de techo metálico',
    fecha_necesidad: '2026-09-25', prioridad: 'normal',
  }, { catalogo: CATALOGO, personal: PERSONAL });

  it('saca la cantidad del nombre: el nombre es el nombre, nada más', () => {
    const filas = volcarEnItems(result, { catalogo: CATALOGO, nuevoItem });
    expect(filas[0].nombre).toBe('Biodigestor');
    expect(filas[0].cantidad).toBe('5');
    expect(filas[0].nombre).not.toMatch(/\d/);
  });

  it('lo que no está en el catálogo queda sin vincular, listo para darlo de alta', () => {
    const filas = volcarEnItems(result, { catalogo: CATALOGO, nuevoItem });
    expect(filas.every(f => f.insumo_id === '')).toBe(true);
  });

  it('reconoce al responsable que sí está en el personal', () => {
    expect(result.responsable_id).toBe('p2');
  });
});

describe('volcarEnItems — el mensaje del triplay', () => {
  const result = sanearResultado({
    items: [
      { tipo: 'material', insumo_id: null, nombre: 'TRIPLAY 30 CM X 55 CM', cantidad: 9, unidad: 'und' },
      { tipo: 'material', insumo_id: null, nombre: 'Cinta de embalaje', cantidad: 1, unidad: 'und' },
    ],
    responsable_id: 'p1', responsable_nombre: 'Roxana Vásquez',
    razon: 'Señalización de frentes de trabajo.',
    frente: 'Todos los frentes de trabajo para señalización SST',
    fecha_necesidad: '2026-09-22', fecha_urgente: '2026-09-23',
  }, { catalogo: CATALOGO, personal: PERSONAL });

  it('la red local vincula el triplay aunque la IA no lo haya hecho (nombre exacto normalizado)', () => {
    const filas = volcarEnItems(result, { catalogo: CATALOGO, nuevoItem });
    expect(filas[0].insumo_id).toBe('tri');
    expect(filas[0].unidad).toBe('und');     // la unidad sale del catálogo
  });

  it('la cinta de embalaje no existe: queda libre, sin inventar vínculo', () => {
    const filas = volcarEnItems(result, { catalogo: CATALOGO, nuevoItem });
    expect(filas[1].insumo_id).toBe('');
    expect(filas[1].nombre).toBe('Cinta de embalaje');
  });

  it('el mínimo urgente viaja como fecha aparte de la deseada', () => {
    expect(result.fecha_necesidad).toBe('2026-09-22');
    expect(result.fecha_urgente).toBe('2026-09-23');
  });

  it('el frente no se tira: se junta con la razón', () => {
    expect(armarRazon(result)).toBe('Señalización de frentes de trabajo.\nFrente: Todos los frentes de trabajo para señalización SST');
  });
});

describe('volcarEnItems — bordes', () => {
  it('un EPP no se vincula con un material que se llama igual', () => {
    const cat = [{ id: 'm', tipo: 'material', nombre: 'Guantes', unidad: 'par' }];
    const r = sanearResultado({ items: [{ tipo: 'epp', nombre: 'Guantes', cantidad: 2 }] }, { catalogo: cat });
    expect(volcarEnItems(r, { catalogo: cat, nuevoItem })[0].insumo_id).toBe('');
  });

  it('sin ítems devuelve una fila vacía para que el formulario no quede roto', () => {
    const filas = volcarEnItems({ items: [] }, { catalogo: CATALOGO, nuevoItem });
    expect(filas).toHaveLength(1);
    expect(filas[0].nombre).toBe('');
  });

  it('respeta la unidad que dijo la obra por encima de la del catálogo', () => {
    const r = sanearResultado({ items: [{ tipo: 'material', insumo_id: 'cem', nombre: 'Cemento Sol Tipo I', cantidad: 2, unidad: 'kg' }] }, { catalogo: CATALOGO });
    expect(volcarEnItems(r, { catalogo: CATALOGO, nuevoItem })[0].unidad).toBe('kg');
  });
});

describe('armarRazon', () => {
  it('sin frente devuelve solo la razón, y sin razón solo el frente', () => {
    expect(armarRazon({ razon: 'Se acabó el cemento' })).toBe('Se acabó el cemento');
    expect(armarRazon({ frente: 'Losa nivel 3' })).toBe('Frente: Losa nivel 3');
    expect(armarRazon({})).toBe('');
  });
});
