// Qué puede ver un dispositivo (tanda E, 26-set-2026): quién lo usa, con qué
// rol y qué obras. Si cambia, los cursores del pull quedan por delante de
// filas que recién ahora le corresponden — ver src/lib/alcance-sync.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  firmaAlcance, decidirPorUsuario, decidirPorAlcance,
  CERCO_LECTURA, tablasQueElRolNoLee, filaDescartable,
} from '../alcance-sync';

describe('firmaAlcance — la huella de lo que el servidor deja ver', () => {
  it('rol + obras ordenadas: el orden en que vienen no cambia la huella', () => {
    const a = firmaAlcance({ rol: 'ingeniero', global: false, obras: ['b', 'a'] });
    const b = firmaAlcance({ rol: 'ingeniero', global: false, obras: ['a', 'b'] });
    expect(a).toBe(b);
  });

  it('otra obra designada → otra huella (es lo que dispara la re-descarga)', () => {
    expect(firmaAlcance({ rol: 'ingeniero', obras: ['a'] }))
      .not.toBe(firmaAlcance({ rol: 'ingeniero', obras: ['a', 'b'] }));
  });

  it('otro rol → otra huella', () => {
    expect(firmaAlcance({ rol: 'almacenero', obras: ['a'] }))
      .not.toBe(firmaAlcance({ rol: 'residente', obras: ['a'] }));
  });

  it('rol global: sus obras no cuentan (el servidor manda null) — crear una obra no re-descarga todo', () => {
    const f = firmaAlcance({ rol: 'admin', global: true, obras: null });
    expect(f).toBe('admin|global|*');
  });

  it('sin `__yo` (servidor sin la mig 235) → sin huella: no se decide nada', () => {
    expect(firmaAlcance(null)).toBe(null);
    expect(firmaAlcance(undefined)).toBe(null);
    expect(firmaAlcance([])).toBe(null);
  });
});

describe('decidirPorUsuario — PC compartida por turnos', () => {
  it('primera vez (dispositivo nuevo o versión nueva): se anota y no se borra nada', () => {
    expect(decidirPorUsuario(null, 'u1')).toBe('primera');
    expect(decidirPorUsuario({}, 'u1')).toBe('primera');
  });
  it('mismo usuario', () => {
    expect(decidirPorUsuario({ uid: 'u1' }, 'u1')).toBe('mismo');
  });
  it('entró otra persona', () => {
    expect(decidirPorUsuario({ uid: 'u1' }, 'u2')).toBe('otro');
  });
  it('sin uid (no debería pasar): no toca nada', () => {
    expect(decidirPorUsuario({ uid: 'u1' }, null)).toBe('mismo');
  });
});

describe('decidirPorAlcance', () => {
  it('primera huella → se anota; igual → nada; distinta → cambio', () => {
    expect(decidirPorAlcance(null, 'x')).toBe('primera');
    expect(decidirPorAlcance({ firma: 'x' }, 'x')).toBe('igual');
    expect(decidirPorAlcance({ firma: 'x' }, 'y')).toBe('cambio');
  });
  it('sin huella nueva (respuesta sin __yo) → igual', () => {
    expect(decidirPorAlcance({ firma: 'x' }, null)).toBe('igual');
  });
});

describe('cerco de LECTURA — espejo de la mig 234', () => {
  it('las cuentas bancarias del personal: los mismos roles que la policy lectura_cerco_select', () => {
    const sql = readFileSync(new URL('../../../supabase/migrations/234_cuentas_personal_solo_contabilidad.sql', import.meta.url), 'utf8');
    const m = sql.match(/lectura_cerco_select ON public\.personal_cuentas_bancarias[\s\S]*?ARRAY\[([^\]]+)\]/);
    expect(m, 'no se encontró la policy en la 234').toBeTruthy();
    const roles = m[1].split(',').map(r => r.trim().replace(/'/g, '')).sort();
    expect([...CERCO_LECTURA.personal_cuentas_bancarias].sort()).toEqual(roles);
  });

  it('la almacenera, el residente y el ingeniero no la leen; contabilidad sí', () => {
    for (const rol of ['almacenero', 'ingeniero_residente', 'ingeniero', 'asistente_admin']) {
      expect(tablasQueElRolNoLee(rol)).toContain('personal_cuentas_bancarias');
    }
    for (const rol of ['admin', 'contador', 'ayudante_contador']) {
      expect(tablasQueElRolNoLee(rol)).not.toContain('personal_cuentas_bancarias');
    }
    expect(tablasQueElRolNoLee(null)).toEqual([]);
  });
});

describe('filaDescartable — nunca se borra trabajo sin subir', () => {
  it('lo sincronizado (o sin estado, como llegaba del pull maestro) se puede volver a bajar', () => {
    expect(filaDescartable({ id: 1, sync_status: 'synced' })).toBe(true);
    expect(filaDescartable({ id: 1 })).toBe(true);
  });
  it('pendiente, fallido, en conflicto, evidencia sin subir o de modo prueba → se queda', () => {
    for (const sync_status of ['pending_create', 'pending_update', 'pending_delete', 'failed', 'conflict', 'pending_upload', 'uploaded']) {
      expect(filaDescartable({ id: 1, sync_status })).toBe(false);
    }
    expect(filaDescartable({ id: 1, sync_status: 'synced', demo: true })).toBe(false);
    expect(filaDescartable(null)).toBe(false);
  });
});

describe('espejo de la mig 235 (lo que el cliente espera de sync_pull)', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/235_usuario_activo_y_alcance_del_pull.sql', import.meta.url), 'utf8');
  it('usuario desactivado → {"__err":"usuario_inactivo"} (el SyncEngine cierra la sesión con ese texto)', () => {
    expect(sql).toMatch(/jsonb_build_object\('__err', 'usuario_inactivo'\)/);
  });
  it('__yo trae rol, global y obras (lo que lee firmaAlcance)', () => {
    const yo = sql.match(/'__yo', jsonb_build_object\(([\s\S]*?)\)\);/);
    expect(yo).toBeTruthy();
    for (const k of ["'rol'", "'global'", "'obras'"]) expect(yo[1]).toContain(k);
  });
  it('el cerco activo_cerco va en TODA tabla de public (y el chequeo de invariantes lo exige)', () => {
    expect(sql).toMatch(/FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'/);
    expect(sql).toMatch(/\('activo_cerco'\)\) x\(pol\)/);
  });
});
