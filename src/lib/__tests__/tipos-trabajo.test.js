import { describe, it, expect } from 'vitest';
import {
  TIPOS_TRABAJO, ORIGENES, ESTADOS_OBRA, ESTADO_OBRA_LEGACY,
  TIPO_TRABAJO_LBL, ESTADO_OBRA_LBL, ESTADO_OBRA_BADGE,
  normalizarEstadoObra, tipoTrabajoValido, etiquetaTrabajo,
  usaEstructuraCostos, usaPartidas, incluyeExpediente,
  TIPO_TRABAJO_DEFAULT, ORIGEN_DEFAULT,
} from '../tipos-trabajo.js';

describe('espejo de los CHECK del servidor', () => {
  it('tipo_trabajo son los 4 del CHECK de la mig 173 — bienes y servicios NO está', () => {
    expect(TIPOS_TRABAJO.map(t => t.v)).toEqual([
      'obra_ejecucion', 'obra_expediente', 'supervision', 'supervision_expediente',
    ]);
    // Va a la tabla `trabajos` (mig 174), no acá.
    expect(tipoTrabajoValido('bienes_servicios')).toBe(false);
  });

  it('origen son exactamente dos', () => {
    expect(ORIGENES.map(t => t.v)).toEqual(['publico', 'privado']);
  });

  it('estados son los 5 del CHECK de la mig 001', () => {
    expect(ESTADOS_OBRA.map(t => t.v)).toEqual([
      'planificacion', 'activo', 'pausado', 'terminado', 'cancelado',
    ]);
  });

  it('los defaults coinciden con los de la migración', () => {
    expect(TIPO_TRABAJO_DEFAULT).toBe('obra_ejecucion');
    expect(ORIGEN_DEFAULT).toBe('publico');
  });

  it('cada estado tiene etiqueta y badge', () => {
    for (const e of ESTADOS_OBRA) {
      expect(ESTADO_OBRA_LBL[e.v]).toBeTruthy();
      expect(ESTADO_OBRA_BADGE[e.v]).toMatch(/^b-/);
    }
    for (const t of TIPOS_TRABAJO) expect(TIPO_TRABAJO_LBL[t.v]).toBeTruthy();
  });
});

describe('normalizarEstadoObra — sana las filas del form viejo', () => {
  it('traduce los valores legacy que el CHECK nunca aceptó', () => {
    // Estos rebotaban con 23514 al editarse.
    expect(normalizarEstadoObra('finalizada')).toBe('terminado');
    expect(normalizarEstadoObra('cancelada')).toBe('cancelado');
    expect(Object.keys(ESTADO_OBRA_LEGACY)).toEqual(['finalizada', 'cancelada']);
  });

  it('deja pasar los válidos tal cual', () => {
    for (const e of ESTADOS_OBRA) expect(normalizarEstadoObra(e.v)).toBe(e.v);
  });

  it('cualquier basura cae en planificación, nunca en un valor que el server rechace', () => {
    for (const v of ['', null, undefined, 'inventado', 42]) {
      expect(ESTADO_OBRA_LBL[normalizarEstadoObra(v)]).toBeTruthy();
    }
    expect(normalizarEstadoObra('inventado')).toBe('planificacion');
  });

  it('todo valor legacy normaliza a un estado que el CHECK acepta', () => {
    for (const destino of Object.values(ESTADO_OBRA_LEGACY)) {
      expect(ESTADOS_OBRA.some(e => e.v === destino)).toBe(true);
    }
  });
});

describe('qué bloques aplican a cada tipo', () => {
  it('la supervisión sola no lleva estructura de costos ni partidas', () => {
    // No construye: se cobra por honorarios. Cargarle un presupuesto de obra
    // termina contradiciendo lo que realmente se factura.
    expect(usaEstructuraCostos('supervision')).toBe(false);
    expect(usaPartidas('supervision')).toBe(false);
  });

  it('los demás tipos sí las llevan', () => {
    for (const t of ['obra_ejecucion', 'obra_expediente', 'supervision_expediente']) {
      expect(usaEstructuraCostos(t)).toBe(true);
      expect(usaPartidas(t)).toBe(true);
    }
  });

  it('incluyeExpediente distingue los dos que lo traen', () => {
    expect(incluyeExpediente('obra_expediente')).toBe(true);
    expect(incluyeExpediente('supervision_expediente')).toBe(true);
    expect(incluyeExpediente('obra_ejecucion')).toBe(false);
    expect(incluyeExpediente('supervision')).toBe(false);
  });
});

describe('etiquetaTrabajo', () => {
  it('combina naturaleza y origen', () => {
    expect(etiquetaTrabajo({ tipo_trabajo: 'supervision', origen: 'privado' })).toBe('Supervisión · Privada');
  });

  it('una obra vieja sin los campos cae a los defaults de la migración', () => {
    expect(etiquetaTrabajo({})).toBe('Ejecución · Pública');
    expect(etiquetaTrabajo(null)).toBe('Ejecución · Pública');
  });
});
