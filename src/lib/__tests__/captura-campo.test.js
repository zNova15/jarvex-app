import { describe, it, expect } from 'vitest';
import {
  identidadDePerfil, armarObservacionCampo, parseObservacionCampo, filtrarBandeja, yaLeidaConIA,
  esFaltaMigracion164, esPdf, ESTADO_LEIDA, ESTADO_PENDIENTE,
} from '../captura-campo.js';

describe('identidadDePerfil — bug del nombre (1-sep)', () => {
  it('usa nombres + apellidos, que son las columnas REALES de profiles', () => {
    expect(identidadDePerfil({ nombres: 'Gabriel', apellidos: 'Julca', email: 'g@j.pe' }))
      .toBe('Gabriel Julca');
  });

  it('no se queda con el email cuando hay nombre (el bug: profile.nombre no existe)', () => {
    const perfil = { nombres: 'Gabriel', apellidos: 'Julca', email: 'g@j.pe' };
    expect(identidadDePerfil(perfil)).not.toBe(perfil.email);
    expect(perfil.nombre).toBeUndefined();
    expect(perfil.full_name).toBeUndefined();
  });

  it('cae al email solo si no hay nombre ni apellido', () => {
    expect(identidadDePerfil({ email: 'g@j.pe' })).toBe('g@j.pe');
    expect(identidadDePerfil({ nombres: '  ', apellidos: '', email: 'g@j.pe' })).toBe('g@j.pe');
  });

  it('sin perfil no rompe', () => {
    expect(identidadDePerfil(null)).toBe('usuario del sistema');
  });
});

describe('observación de campo — ida y vuelta', () => {
  it('cuenta de campo: guarda el nombre tecleado y lo recupera', () => {
    const obs = armarObservacionCampo({ quienSube: 'Juan Pérez', comentario: 'ferretería', esCuentaCampo: true });
    expect(parseObservacionCampo(obs)).toEqual({ quien: 'Juan Pérez', cuentaCampo: true, comentario: 'ferretería' });
  });

  it('cuenta real: marca que la identidad sale del sistema', () => {
    const obs = armarObservacionCampo({ quienSube: 'Gabriel Julca', comentario: '', esCuentaCampo: false });
    const r = parseObservacionCampo(obs);
    expect(r.quien).toBe('Gabriel Julca');
    expect(r.cuentaCampo).toBe(false);
    expect(r.comentario).toBe('');
  });

  it('comentario con · adentro no se pierde', () => {
    const obs = armarObservacionCampo({ quienSube: 'Ana', comentario: 'cemento · 5 bolsas', esCuentaCampo: true });
    expect(parseObservacionCampo(obs).comentario).toBe('cemento · 5 bolsas');
  });

  it('sin nombre no deja la etiqueta vacía', () => {
    expect(armarObservacionCampo({ quienSube: '   ', esCuentaCampo: true })).toContain('De: sin nombre');
  });

  it('observación vieja o escrita a mano: no rompe, va como comentario', () => {
    expect(parseObservacionCampo('foto suelta del almacén'))
      .toEqual({ quien: null, cuentaCampo: false, comentario: 'foto suelta del almacén' });
    expect(parseObservacionCampo(null)).toEqual({ quien: null, cuentaCampo: false, comentario: '' });
  });
});

describe('pestañas de la bandeja', () => {
  const filas = [
    { id: 1, tipo_evidencia: 'factura_campo', campo_revision: 'pendiente' },
    { id: 2, tipo_evidencia: 'factura_campo', campo_revision: 'leida' },
    { id: 3, tipo_evidencia: 'factura_campo', campo_revision: 'registrada' },
    { id: 4, tipo_evidencia: 'factura_campo', campo_revision: 'descartada' },
    { id: 5, tipo_evidencia: 'factura_campo', campo_revision: null },        // vieja, sin estado
    { id: 6, tipo_evidencia: 'factura_campo', campo_revision: 'pendiente', deleted_at: 'x' },
    { id: 7, tipo_evidencia: 'foto_epp', campo_revision: 'pendiente' },       // otra evidencia
  ];

  it('Pendientes: incluye las viejas sin estado y excluye borradas/ajenas', () => {
    // 5-sep: la LEÍDA (2) también sigue acá. Leer con IA marca, no resuelve.
    expect(filtrarBandeja(filas, ESTADO_PENDIENTE).map(f => f.id)).toEqual([1, 2, 5]);
  });

  it('una foto leída con IA NO sale de Pendientes: la saca la contadora, no la IA', () => {
    const ids = filtrarBandeja(filas, ESTADO_PENDIENTE).map(f => f.id);
    expect(ids).toContain(2);          // campo_revision = 'leida'
    expect(yaLeidaConIA(filas[1])).toBe(true);
    expect(yaLeidaConIA(filas[0])).toBe(false);
  });

  it('Leídas: sigue siendo el historial de lo que pasó por la IA', () => {
    expect(filtrarBandeja(filas, ESTADO_LEIDA).map(f => f.id)).toEqual([2]);
  });

  it('registrada/descartada no aparecen en ninguna de las dos pestañas', () => {
    const vistos = [...filtrarBandeja(filas, ESTADO_PENDIENTE), ...filtrarBandeja(filas, ESTADO_LEIDA)].map(f => f.id);
    expect(vistos).not.toContain(3);
    expect(vistos).not.toContain(4);
  });
});

describe('detección de "falta la migración 164"', () => {
  it('reconoce el check_violation de Postgres', () => {
    expect(esFaltaMigracion164({ code: '23514' })).toBe(true);
    expect(esFaltaMigracion164({ message: 'new row violates check constraint "evidencias_campo_revision_check"' })).toBe(true);
  });
  it('no confunde otros errores (sin señal, RLS)', () => {
    expect(esFaltaMigracion164({ message: 'Failed to fetch' })).toBe(false);
    expect(esFaltaMigracion164({ code: '42501', message: 'row-level security' })).toBe(false);
  });
});

describe('esPdf', () => {
  it('por mime y por extensión (Android a veces manda type vacío)', () => {
    expect(esPdf({ type: 'application/pdf', name: 'f.pdf' })).toBe(true);
    expect(esPdf({ type: '', name: 'factura.PDF' })).toBe(true);
    expect(esPdf({ type: 'image/jpeg', name: 'foto.jpg' })).toBe(false);
  });
});
