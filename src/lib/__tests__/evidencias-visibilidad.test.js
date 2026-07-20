import { describe, it, expect } from 'vitest';
import { puedeVerEvidencia, TIPOS_CONTABLES } from '../evidencias-visibilidad.js';

const ev = (tipo, extra = {}) => ({ tipo_evidencia: tipo, subido_por: 'u-otro', created_by: 'u-otro', ...extra });
const ve = (rol, tipo, userId = 'u-yo') => puedeVerEvidencia({ rol, userId, ev: ev(tipo) });

describe('evidencias-visibilidad — ámbito contable', () => {
  it('la guía de remisión ahora es contable', () => {
    expect(TIPOS_CONTABLES).toContain('guia_remision');
  });
  it('contable: solo admin + contabilidad', () => {
    for (const tipo of TIPOS_CONTABLES) {
      expect(ve('admin', tipo)).toBe(true);
      expect(ve('contador', tipo)).toBe(true);
      expect(ve('ayudante_contador', tipo)).toBe(true);
      expect(ve('almacenero', tipo)).toBe(false);
      expect(ve('gerente', tipo)).toBe(false);
      expect(ve('ingeniero_residente', tipo)).toBe(false);
      expect(ve('prevencionista', tipo)).toBe(false);
    }
  });
  it('el autor siempre ve lo que subió (guía adjuntada por el almacenero)', () => {
    const propia = { tipo_evidencia: 'guia_remision', subido_por: 'u-yo', created_by: 'u-yo' };
    expect(puedeVerEvidencia({ rol: 'almacenero', userId: 'u-yo', ev: propia })).toBe(true);
  });
});

describe('evidencias-visibilidad — por función', () => {
  it('almacenero: ve lo de almacén/EPP/asistencia, no avance ni especialidades', () => {
    expect(ve('almacenero', 'foto_material')).toBe(true);
    expect(ve('almacenero', 'foto_herramienta')).toBe(true);
    expect(ve('almacenero', 'firma_epp')).toBe(true);
    expect(ve('almacenero', 'foto_asistencia')).toBe(true);
    expect(ve('almacenero', 'foto_avance')).toBe(false);
    expect(ve('almacenero', 'foto_especialidad')).toBe(false);
    expect(ve('almacenero', 'sctr')).toBe(false);
  });
  it('especialistas: cada uno lo suyo', () => {
    expect(ve('prevencionista', 'sctr')).toBe(true);
    expect(ve('prevencionista', 'firma_epp')).toBe(true);
    expect(ve('ing_ambiental', 'evidencia_ambiental')).toBe(true);
    expect(ve('ing_ambiental', 'foto_material')).toBe(false);
    expect(ve('ing_calidad', 'certificado_calidad')).toBe(true);
    expect(ve('ing_calidad', 'foto_material')).toBe(true);
    expect(ve('ing_social', 'foto_especialidad')).toBe(true);
    expect(ve('ing_social', 'certificado_calidad')).toBe(false);
  });
  it('operativos (residente/supervisor/gerente): todo menos contable', () => {
    expect(ve('ingeniero_residente', 'foto_avance')).toBe(true);
    expect(ve('ingeniero_residente', 'movimiento_maquinaria')).toBe(true);
    expect(ve('gerente', 'foto_material')).toBe(true);
  });
  it('rol desconocido/custom: solo lo básico', () => {
    expect(ve('rol_custom_x', 'foto_avance')).toBe(true);
    expect(ve('rol_custom_x', 'documento_general')).toBe(true);
    expect(ve('rol_custom_x', 'foto_material')).toBe(false);
    expect(ve('rol_custom_x', 'bancarizacion')).toBe(false);
  });
});
