import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  arrancarBarrido, estadoBarrido, barridoActivo, cancelarBarrido, cerrarBarrido,
  suscribir, guardarRecomendacion, leerRecomendaciones, olvidarRecomendacion,
  limpiarRecomendaciones, _reiniciar,
} from '../barrido-store.js';
import { _reiniciarTurnoIA } from '../barrido-ia.js';
import { hayTrabajoEnCurso, _reiniciar as _reiniciarOcupada } from '../sesion-ocupada.js';

function setupLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

beforeEach(() => {
  setupLocalStorage();
  _reiniciar();
  _reiniciarTurnoIA();
  _reiniciarOcupada();
});

describe('las recomendaciones guardadas', () => {
  it('guarda, lee y olvida por sección + ámbito', () => {
    guardarRecomendacion('clasificacion', 'emp1', 'cemento', { codigo: '11', confianza: 0.9 });
    guardarRecomendacion('clasificacion', 'emp1', 'fierro', { codigo: '21', confianza: 0.8 });
    const recs = leerRecomendaciones('clasificacion', 'emp1');
    expect(Object.keys(recs).sort()).toEqual(['cemento', 'fierro']);
    expect(recs.cemento).toMatchObject({ codigo: '11', confianza: 0.9 });

    olvidarRecomendacion('clasificacion', 'emp1', 'cemento');
    expect(Object.keys(leerRecomendaciones('clasificacion', 'emp1'))).toEqual(['fierro']);
  });

  // La misma descripción en otra entidad es OTRA pregunta (otro catálogo,
  // otras clasificaciones propias): no se pueden pisar entre ámbitos.
  it('no se mezclan los ámbitos ni las secciones', () => {
    guardarRecomendacion('clasificacion', 'emp1', 'cemento', { codigo: '11' });
    guardarRecomendacion('clasificacion', 'emp2', 'cemento', { codigo: '99' });
    guardarRecomendacion('mapeo', 'emp1', 'cemento', { codigo: 'P-1' });
    expect(leerRecomendaciones('clasificacion', 'emp1').cemento.codigo).toBe('11');
    expect(leerRecomendaciones('clasificacion', 'emp2').cemento.codigo).toBe('99');
    expect(leerRecomendaciones('mapeo', 'emp1').cemento.codigo).toBe('P-1');
  });

  it('limpiar borra solo las de ese ámbito y devuelve cuántas eran', () => {
    guardarRecomendacion('clasificacion', 'emp1', 'a', { codigo: '1' });
    guardarRecomendacion('clasificacion', 'emp1', 'b', { codigo: '2' });
    guardarRecomendacion('clasificacion', 'emp2', 'c', { codigo: '3' });
    expect(limpiarRecomendaciones('clasificacion', 'emp1')).toBe(2);
    expect(leerRecomendaciones('clasificacion', 'emp1')).toEqual({});
    expect(Object.keys(leerRecomendaciones('clasificacion', 'emp2'))).toEqual(['c']);
  });

  // «Suele tardar y me pasó que se cerró sesión»: media hora de respuestas ya
  // pagadas no se puede ir con un refresco.
  it('sobreviven al refresco: van a localStorage apenas llegan', async () => {
    guardarRecomendacion('clasificacion', 'emp1', 'cemento', { codigo: '11' });
    const crudo = JSON.parse(globalThis.localStorage.getItem('jx_ia_recomendaciones_v1'));
    expect(crudo['clasificacion::emp1::cemento']).toMatchObject({ codigo: '11' });
    expect(crudo['clasificacion::emp1::cemento'].t).toBeGreaterThan(0);
  });

  it('avisa a los suscriptos de esa sección en cada cambio', () => {
    const vistoClasif = vi.fn();
    const vistoMapeo = vi.fn();
    suscribir('clasificacion', vistoClasif);
    suscribir('mapeo', vistoMapeo);
    guardarRecomendacion('clasificacion', 'emp1', 'a', { codigo: '1' });
    expect(vistoClasif).toHaveBeenCalledTimes(1);
    expect(vistoMapeo).not.toHaveBeenCalled();
    olvidarRecomendacion('clasificacion', 'emp1', 'a');
    expect(vistoClasif).toHaveBeenCalledTimes(2);
  });

  it('desuscribirse corta los avisos', () => {
    const visto = vi.fn();
    const cortar = suscribir('clasificacion', visto);
    cortar();
    guardarRecomendacion('clasificacion', 'emp1', 'a', { codigo: '1' });
    expect(visto).not.toHaveBeenCalled();
  });
});

describe('el recorrido, que vive fuera de React', () => {
  it('corre entero y deja el estado final visible', async () => {
    const procesados = [];
    await arrancarBarrido({
      seccion: 'clasificacion', ambito: 'emp1', etiqueta: 'lo pendiente',
      items: [1, 2, 3],
      procesarItem: async (x) => { procesados.push(x); return x === 3 ? 'saltada' : 'recomendada'; },
    });
    expect(procesados).toEqual([1, 2, 3]);
    const e = estadoBarrido('clasificacion');
    expect(e).toMatchObject({ activo: false, total: 3, i: 3, recomendadas: 2, saltadas: 1, modo: 'recomendar' });
  });

  // El defecto que originó todo esto: cambiar de pestaña desmontaba el
  // componente y con él se iba el recorrido. Acá el bucle no sabe que React
  // existe, así que el estado sigue estando al volver.
  it('el estado sobrevive a que la pantalla se desmonte (no vive en el componente)', async () => {
    let seguir;
    const trabado = new Promise(res => { seguir = res; });
    const p = arrancarBarrido({
      seccion: 'mapeo', ambito: 'obra1', items: [1, 2],
      procesarItem: async (x) => { if (x === 1) await trabado; return 'recomendada'; },
    });
    // "se desmonta la pantalla": nadie mira, nadie cancela
    await Promise.resolve();
    expect(barridoActivo('mapeo')).toBe(true);
    seguir();
    await p;
    expect(estadoBarrido('mapeo')).toMatchObject({ activo: false, recomendadas: 2 });
  });

  // Mientras corre, el cierre por inactividad de useAuth se posterga: si no,
  // 700 descripciones son media hora "sin actividad de persona".
  it('toma y suelta el token de «trabajo en curso» (la sesión no se cierra)', async () => {
    let seguir;
    const trabado = new Promise(res => { seguir = res; });
    const p = arrancarBarrido({
      seccion: 'clasificacion', items: [1],
      procesarItem: async () => { await trabado; return 'recomendada'; },
    });
    await Promise.resolve();
    expect(hayTrabajoEnCurso()).toBe(true);
    seguir();
    await p;
    expect(hayTrabajoEnCurso()).toBe(false);
  });

  it('no arranca dos veces la misma sección (anti doble click)', async () => {
    const procesarItem = vi.fn(async () => 'recomendada');
    const p1 = arrancarBarrido({ seccion: 'clasificacion', items: [1, 2], procesarItem });
    const p2 = arrancarBarrido({ seccion: 'clasificacion', items: [1, 2], procesarItem });
    expect(p2).toBe(p1);
    await p1;
    expect(procesarItem).toHaveBeenCalledTimes(2);
  });

  // «¿Puedo lanzar la recomendación de clasificación y correlación al mismo
  // tiempo?» — sí: son secciones distintas.
  it('sí deja correr DOS secciones a la vez', async () => {
    const a = arrancarBarrido({ seccion: 'clasificacion', items: [1], procesarItem: async () => 'recomendada' });
    const b = arrancarBarrido({ seccion: 'correlaciones', items: [1], procesarItem: async () => 'recomendada' });
    expect(barridoActivo('clasificacion')).toBe(true);
    expect(barridoActivo('correlaciones')).toBe(true);
    await Promise.all([a, b]);
    expect(estadoBarrido('clasificacion').recomendadas).toBe(1);
    expect(estadoBarrido('correlaciones').recomendadas).toBe(1);
  });

  it('cancelar corta antes del siguiente ítem y lo hecho queda', async () => {
    const procesarItem = vi.fn(async () => {
      cancelarBarrido('clasificacion');
      return 'recomendada';
    });
    await arrancarBarrido({ seccion: 'clasificacion', items: [1, 2, 3], procesarItem });
    expect(procesarItem).toHaveBeenCalledTimes(1);
    expect(estadoBarrido('clasificacion')).toMatchObject({ cancelado: true, recomendadas: 1, activo: false });
  });

  it('cerrar saca el cartel, pero no puede cerrar uno que sigue corriendo', async () => {
    let seguir;
    const trabado = new Promise(res => { seguir = res; });
    const p = arrancarBarrido({
      seccion: 'clasificacion', items: [1],
      procesarItem: async () => { await trabado; return 'recomendada'; },
    });
    await Promise.resolve();
    cerrarBarrido('clasificacion');
    expect(estadoBarrido('clasificacion')).not.toBeNull();   // sigue corriendo
    seguir();
    await p;
    cerrarBarrido('clasificacion');
    expect(estadoBarrido('clasificacion')).toBeNull();
  });

  it('cerrar NO borra las recomendaciones que dejó', async () => {
    await arrancarBarrido({
      seccion: 'clasificacion', ambito: 'emp1', items: [1],
      procesarItem: async () => {
        guardarRecomendacion('clasificacion', 'emp1', 'x', { codigo: '11' });
        return 'recomendada';
      },
    });
    cerrarBarrido('clasificacion');
    expect(Object.keys(leerRecomendaciones('clasificacion', 'emp1'))).toEqual(['x']);
  });
});
