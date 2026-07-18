import { describe, it, expect } from 'vitest';
import { partesLima, debeEnviarse, rangoDe, fechaMenosDias } from '../reporte-email-programacion.js';

const base = { activo: true, destinatarios: ['a@b.com'], hora_envio: '18:00', ultimo_envio: null };
// Viernes 17/07/2026 a las 18:xx Lima = 23:xx UTC
const vie18 = { fecha: '2026-07-17', hora: 18, diaSemana: 5, diaMes: 17 };

describe('partesLima (UTC-5 fijo)', () => {
  it('convierte UTC a Lima con día de semana 1=Lunes', () => {
    // 2026-07-17 23:30 UTC = 18:30 Lima (viernes)
    const p = partesLima(new Date('2026-07-17T23:30:00Z'));
    expect(p).toEqual({ fecha: '2026-07-17', hora: 18, diaSemana: 5, diaMes: 17 });
  });
  it('el cruce de medianoche UTC no cambia el día Lima', () => {
    // 2026-07-18 02:00 UTC = 21:00 Lima del 17
    const p = partesLima(new Date('2026-07-18T02:00:00Z'));
    expect(p.fecha).toBe('2026-07-17');
    expect(p.hora).toBe(21);
  });
});

describe('debeEnviarse — diario', () => {
  it('sale a la hora configurada', () => {
    expect(debeEnviarse({ ...base, tipo: 'diario' }, vie18)).toBe(true);
  });
  it('no sale antes de la hora', () => {
    expect(debeEnviarse({ ...base, tipo: 'diario' }, { ...vie18, hora: 17 })).toBe(false);
  });
  it('catch-up: después de la hora sí sale (corrida saltada)', () => {
    expect(debeEnviarse({ ...base, tipo: 'diario' }, { ...vie18, hora: 21 })).toBe(true);
  });
  it('no repite si ya salió hoy', () => {
    expect(debeEnviarse({ ...base, tipo: 'diario', ultimo_envio: '2026-07-17' }, { ...vie18, hora: 21 })).toBe(false);
  });
  it('desactivado o sin destinatarios → no sale', () => {
    expect(debeEnviarse({ ...base, tipo: 'diario', activo: false }, vie18)).toBe(false);
    expect(debeEnviarse({ ...base, tipo: 'diario', destinatarios: [] }, vie18)).toBe(false);
  });
  it('legacy cada_3_dias: respeta el intervalo', () => {
    const c = { ...base, tipo: 'diario', frecuencia: 'cada_3_dias' };
    expect(debeEnviarse({ ...c, ultimo_envio: '2026-07-15' }, vie18)).toBe(false); // hace 2 días
    expect(debeEnviarse({ ...c, ultimo_envio: '2026-07-14' }, vie18)).toBe(true);  // hace 3
    expect(debeEnviarse({ ...c, ultimo_envio: null }, vie18)).toBe(true);          // nunca envió
  });
});

describe('debeEnviarse — semanal y mensual', () => {
  it('semanal: solo el día configurado (5=viernes)', () => {
    expect(debeEnviarse({ ...base, tipo: 'semanal', dia_semana: 5 }, vie18)).toBe(true);
    expect(debeEnviarse({ ...base, tipo: 'semanal', dia_semana: 1 }, vie18)).toBe(false);
  });
  it('mensual: solo el día del mes configurado', () => {
    expect(debeEnviarse({ ...base, tipo: 'mensual', dia_mes: 17 }, vie18)).toBe(true);
    expect(debeEnviarse({ ...base, tipo: 'mensual', dia_mes: 1 }, vie18)).toBe(false);
  });
  it('semanal con hora personalizada respeta hora + día', () => {
    const c = { ...base, tipo: 'semanal', dia_semana: 5, hora_envio: '08:00' };
    expect(debeEnviarse(c, { ...vie18, hora: 7 })).toBe(false);
    expect(debeEnviarse(c, { ...vie18, hora: 8 })).toBe(true);
  });
});

describe('rangoDe', () => {
  it('diario = solo hoy; semanal = 7 días; mensual = 30 días', () => {
    expect(rangoDe('diario', '2026-07-17')).toEqual({ desde: '2026-07-17', hasta: '2026-07-17' });
    expect(rangoDe('semanal', '2026-07-17')).toEqual({ desde: '2026-07-11', hasta: '2026-07-17' });
    expect(rangoDe('mensual', '2026-07-17')).toEqual({ desde: '2026-06-18', hasta: '2026-07-17' });
  });
  it('fechaMenosDias cruza meses', () => {
    expect(fechaMenosDias('2026-03-02', 5)).toBe('2026-02-25');
  });
});
