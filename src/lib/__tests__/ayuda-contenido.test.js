import { describe, it, expect } from 'vitest';
import { ayudaDe, AYUDA } from '../ayuda-contenido.js';

describe('ayuda-contenido — estructura', () => {
  it('toda entrada tiene título, descripción y pasos', () => {
    for (const [id, e] of Object.entries(AYUDA)) {
      expect(e.titulo, id).toBeTruthy();
      expect(e.que, id).toBeTruthy();
      expect(Array.isArray(e.como) && e.como.length > 0, id).toBe(true);
    }
  });
  it('cubre las secciones clave de la app', () => {
    for (const id of ['inicio', 'captura-magica', 'materiales', 'mov-materiales', 'evidencias',
      'movimientos-contables', 'guias-remision', 'sctr-personal', 'epp', 'personal',
      'usuarios', 'solicitudes', 'reportes', 'reporte-diario', 'avance']) {
      expect(AYUDA[id], id).toBeTruthy();
    }
  });
});

describe('ayudaDe — resolución por página y rol', () => {
  it('página conocida + rol con nota específica', () => {
    const a = ayudaDe('movimientos-contables', 'ayudante_contador');
    expect(a.titulo).toBe('Movimientos Contables');
    expect(a.notaRol).toMatch(/Solicitar/);
    expect(a.notaRolGeneral).toBeTruthy();
  });
  it('página conocida + rol sin nota específica', () => {
    const a = ayudaDe('materiales', 'gerente');
    expect(a.titulo).toBe('Materiales');
    expect(a.notaRol).toBeNull();
  });
  it('página desconocida → fallback utilizable', () => {
    const a = ayudaDe('pagina-que-no-existe', 'admin');
    expect(a.titulo).toBeTruthy();
    expect(a.como.length).toBeGreaterThan(0);
  });
  it('sin rol no revienta', () => {
    const a = ayudaDe('evidencias', undefined);
    expect(a.notaRol).toBeNull();
    expect(a.notaRolGeneral).toBeNull();
  });
});
