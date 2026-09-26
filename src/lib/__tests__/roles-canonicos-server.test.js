// ═══════════════════════════════════════════════════════════════════
// TANDA G (26-set-2026): antes de esto, api/asistente-solicitud.js tenía
// 'almacenera', 'jefe_almacen' y 'residente' en su allowlist — ninguno existe
// como rol real (es 'ingeniero_residente') — y api/create-user.js tenía su
// propia lista sin 'licitaciones'. Este test impide que una allowlist de
// server vuelva a divergir del canon compartido en lib/roles.js.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { ROLES_CANONICOS } from '../../../lib/roles.js';
import { ROLES as ROLES_ASISTENTE, ROLES_ENFOQUES } from '../../../api/asistente-solicitud.js';

describe('roles del server — asistente-solicitud usa nombres reales', () => {
  it('ROLES_CANONICOS no está vacío (si no, el test no prueba nada)', () => {
    expect(ROLES_CANONICOS.length).toBeGreaterThan(15);
  });

  it('todos los roles de la allowlist de asistente-solicitud existen en el canon', () => {
    const invalidos = ROLES_ASISTENTE.filter(r => !ROLES_CANONICOS.includes(r));
    expect(invalidos, `roles inexistentes en ROLES: ${invalidos.join(', ')}`).toEqual([]);
  });

  it('todos los roles de ROLES_ENFOQUES (simulador) existen en el canon', () => {
    const invalidos = ROLES_ENFOQUES.filter(r => !ROLES_CANONICOS.includes(r));
    expect(invalidos, `roles inexistentes en ROLES_ENFOQUES: ${invalidos.join(', ')}`).toEqual([]);
  });

  it('el residente (ingeniero_residente) puede usar el asistente de solicitudes', () => {
    expect(ROLES_ASISTENTE).toContain('ingeniero_residente');
  });

  it('licitaciones es un rol canónico válido (create-user ya no lo degrada)', () => {
    expect(ROLES_CANONICOS).toContain('licitaciones');
  });
});
