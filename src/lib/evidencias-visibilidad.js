// ═══════════════════════════════════════════════════════════════════
// JARVEX — Visibilidad de EVIDENCIAS por rol (pedido de Gabriel, 20-jul-2026).
//
// Problema: la galería de Evidencias le mostraba al almacenero (y a los
// especialistas) material que no le compete — guías de remisión, facturas,
// comprobantes. Regla nueva: cada rol ve SOLO lo pertinente a su función.
//
// - Lo CONTABLE (bancarización, comprobantes, facturas, recibos, pagos y
//   AHORA TAMBIÉN las guías de remisión) lo ven únicamente contabilidad
//   (contadora jefe + asistente) y el admin. Espejo del RLS del server
//   (migs 136 + 143).
// - El resto de tipos se reparte por función: almacén ve lo de almacén,
//   SSOMA lo de seguridad, cada especialista lo suyo, etc.
// - Quien SUBIÓ una evidencia siempre puede verla (aunque su rol ya no
//   la liste — p. ej. el almacenero que adjuntó una guía a un movimiento).
// ═══════════════════════════════════════════════════════════════════

// Ámbito contable: SOLO admin + contador + ayudante_contador.
export const TIPOS_CONTABLES = [
  'bancarizacion', 'comprobante_captura', 'factura', 'recibo_honorarios',
  'pago_evidencia', 'guia_remision',
];

// Bloques por función (un tipo puede estar en varios bloques).
const COMUN      = ['acta', 'documento_general', 'pdf_formato_firmado'];
const ALMACEN    = ['foto_material', 'foto_herramienta', 'foto_herramienta_danada',
                    'foto_estado', 'registro_diario_materiales', 'foto_epp', 'firma_epp'];
const ASISTENCIA = ['foto_asistencia'];
const AVANCE     = ['foto_avance', 'foto_sin_avance'];
const SSOMA      = ['sctr', 'ficha_induccion', 'foto_epp', 'firma_epp', 'foto_especialidad'];
const BASICO     = [...AVANCE, ...ASISTENCIA, ...COMUN]; // roles desconocidos/custom

// 'todo' = ve todo (incluido lo contable). 'operativo' = todo MENOS lo
// contable. Lista = solo esos tipos (más lo que subió él mismo).
const MATRIZ = {
  admin:               'todo',
  contador:            'todo',
  ayudante_contador:   'todo',
  gerente:             'operativo',   // sin contable desde mig 136
  ingeniero_residente: 'operativo',
  ingeniero:           'operativo',
  supervisor:          'operativo',
  asistente_admin:     'operativo',
  almacenero:          [...ALMACEN, ...ASISTENCIA, ...COMUN],
  maestro_obra:        [...AVANCE, ...ASISTENCIA, ...COMUN],
  prevencionista:      [...SSOMA, ...ASISTENCIA, ...COMUN],
  ing_ambiental:       ['evidencia_ambiental', 'foto_especialidad', ...COMUN],
  ing_calidad:         ['certificado_calidad', 'foto_especialidad', 'foto_material', ...COMUN],
  ing_social:          ['foto_especialidad', ...ASISTENCIA, ...COMUN],
  jefe_compras:        ['oc_firmada', 'foto_material', ...COMUN],
  tesorero:            [...COMUN],
  rrhh:                [...ASISTENCIA, ...COMUN],
  solo_lectura:        BASICO,
};

/**
 * ¿Este usuario puede ver esta evidencia en la galería?
 * ev: { tipo_evidencia, subido_por, created_by }
 */
export function puedeVerEvidencia({ rol, userId, ev }) {
  if (!ev) return false;
  // Lo propio siempre se ve (el autor necesita ver el estado de su subida).
  if (userId && (ev.subido_por === userId || ev.created_by === userId)) return true;

  const regla = MATRIZ[rol];
  if (regla === 'todo') return true;
  if (TIPOS_CONTABLES.includes(ev.tipo_evidencia)) return false; // contable: nadie más
  if (regla === 'operativo') return true;
  const lista = Array.isArray(regla) ? regla : BASICO;
  return lista.includes(ev.tipo_evidencia);
}
