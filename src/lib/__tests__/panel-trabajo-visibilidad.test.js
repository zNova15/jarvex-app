import { describe, it, expect } from 'vitest';
import {
  puedeVerFichaTrabajo, puedeVerEquipoTrabajo, ROLES_PANEL_SENSIBLE,
} from '../panel-trabajo-visibilidad.js';

// Pedido de Gabriel (5-sep-2026): el equipo del trabajo y quién lo ejecuta
// solo para el administrador y la Contadora Jefe. Ampliarlo es decisión suya.

describe('quién ve los bloques sensibles del Panel del Trabajo', () => {
  it('el administrador ve todo', () => {
    expect(puedeVerFichaTrabajo('admin')).toBe(true);
    expect(puedeVerEquipoTrabajo('admin')).toBe(true);
  });

  it('la Contadora Jefe ve todo', () => {
    expect(puedeVerFichaTrabajo('contador')).toBe(true);
    expect(puedeVerEquipoTrabajo('contador')).toBe(true);
  });

  it('NADIE más lo ve — ni roles que antes pasaban por el permiso de menú', () => {
    // Estos son los que colaban con la puerta vieja: ayudante_contador tiene
    // Movimientos Contables, y los de obra suelen tener Personal.
    for (const rol of ['ayudante_contador', 'gerente', 'tesorero', 'licitaciones',
      'asistente_admin', 'jefe_compras', 'ingeniero_residente', 'ingeniero',
      'almacenero', 'prevencionista', 'ing_calidad', 'campo', 'solo_lectura']) {
      expect(puedeVerFichaTrabajo(rol), `ficha: ${rol}`).toBe(false);
      expect(puedeVerEquipoTrabajo(rol), `equipo: ${rol}`).toBe(false);
    }
  });

  it('un rol vacío, nulo o inventado no pasa', () => {
    for (const rol of [null, undefined, '', '  ', 'ADMIN', 'rol_que_no_existe']) {
      expect(puedeVerFichaTrabajo(rol)).toBe(false);
      expect(puedeVerEquipoTrabajo(rol)).toBe(false);
    }
  });

  it('la allowlist es CORTA a propósito: ampliarla debe ser deliberado', () => {
    expect(ROLES_PANEL_SENSIBLE.size).toBe(2);
    expect([...ROLES_PANEL_SENSIBLE].sort()).toEqual(['admin', 'contador']);
  });
});
