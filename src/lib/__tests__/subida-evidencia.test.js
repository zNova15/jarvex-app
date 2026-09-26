// Por qué falló la subida de una evidencia (tanda E, 26-set-2026). Antes todo
// contaba como intento: un corte de R2 de 4 minutos o la sesión vencida
// dejaban las fotos de obra `failed` hasta que alguien recargara la app.
import { describe, it, expect } from 'vitest';
import {
  clasificarFalloSubida, esRechazoRLS, esperaAntesDelIntento, leTocaSubir,
  ESPERA_BASE_MS, ESPERA_MAX_MS,
} from '../subida-evidencia';

describe('clasificarFalloSubida', () => {
  it('sesión: 401 de /api/r2, JWT vencido, o no había token', () => {
    expect(clasificarFalloSubida({ etapa: 'firma', status: 401, message: 'Token inválido o expirado' })).toBe('sesion');
    expect(clasificarFalloSubida({ etapa: 'metadata', code: 'PGRST301', message: 'JWT expired' })).toBe('sesion');
    expect(clasificarFalloSubida({ etapa: 'firma', status: 401, message: 'No se pudo firmar la subida a R2 (sin sesión)' })).toBe('sesion');
  });

  it('transitorio: red caída, timeout, límite, 5xx — NO cuenta como intento', () => {
    expect(clasificarFalloSubida({ etapa: 'firma', status: 503, message: 'R2 no configurado' })).toBe('transitorio');
    expect(clasificarFalloSubida({ etapa: 'firma', status: 502 })).toBe('transitorio');
    expect(clasificarFalloSubida({ etapa: 'put', status: 0, message: 'PUT a R2 error de red: Failed to fetch' })).toBe('transitorio');
    expect(clasificarFalloSubida({ etapa: 'put', status: 429 })).toBe('transitorio');
    expect(clasificarFalloSubida({ etapa: 'metadata', status: 0, message: 'TypeError: Failed to fetch' })).toBe('transitorio');
    expect(clasificarFalloSubida({ etapa: 'put', message: 'Load failed' })).toBe('transitorio');
  });

  it('definitivo: el servidor dijo que no — sí cuenta (a los 5, failed con el motivo a la vista)', () => {
    expect(clasificarFalloSubida({ etapa: 'firma', status: 422, message: 'Extensión no permitida para subir' })).toBe('definitivo');
    expect(clasificarFalloSubida({ etapa: 'firma', status: 403, message: 'Esa evidencia es de otro usuario' })).toBe('definitivo');
    expect(clasificarFalloSubida({ etapa: 'metadata', code: '42501', status: 403, message: 'new row violates row-level security policy' })).toBe('definitivo');
    expect(clasificarFalloSubida({ etapa: 'metadata', code: '23514', status: 400, message: 'violates check constraint' })).toBe('definitivo');
  });

  it('«credencial» no es «red»: un 4xx con esa palabra sigue siendo definitivo', () => {
    expect(clasificarFalloSubida({ etapa: 'firma', status: 403, message: 'credencial rechazada' })).toBe('definitivo');
  });
});

describe('esRechazoRLS', () => {
  it('42501 o el mensaje de RLS', () => {
    expect(esRechazoRLS({ code: '42501' })).toBe(true);
    expect(esRechazoRLS({ message: 'new row violates row-level security policy for table "evidencias"' })).toBe(true);
    expect(esRechazoRLS({ code: '23514', message: 'check' })).toBe(false);
  });
});

describe('espera entre intentos', () => {
  it('crece al doble y se topa en 30 min', () => {
    expect(esperaAntesDelIntento(1)).toBe(ESPERA_BASE_MS);
    expect(esperaAntesDelIntento(2)).toBe(ESPERA_BASE_MS * 2);
    expect(esperaAntesDelIntento(3)).toBe(ESPERA_BASE_MS * 4);
    expect(esperaAntesDelIntento(50)).toBe(ESPERA_MAX_MS);
    expect(esperaAntesDelIntento(0)).toBe(ESPERA_BASE_MS);
  });

  it('leTocaSubir respeta la espera', () => {
    const ahora = 1_000_000;
    expect(leTocaSubir({}, ahora)).toBe(true);
    expect(leTocaSubir({ _proximo_intento: ahora - 1 }, ahora)).toBe(true);
    expect(leTocaSubir({ _proximo_intento: ahora + 1 }, ahora)).toBe(false);
  });
});
