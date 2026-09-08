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
// Del paquete SCTR (21-jul): cotización, pago y factura son contables; el
// CERTIFICADO ('sctr') NO — lo consulta también la ing. de seguridad.
export const TIPOS_CONTABLES = [
  'bancarizacion', 'comprobante_captura', 'factura', 'recibo_honorarios',
  'pago_evidencia', 'guia_remision',
  'sctr_cotizacion', 'sctr_pago', 'sctr_factura', 'sctr_otro',
  'constancia_detraccion',
  // Fotos de facturas subidas por el personal de CAMPO (mejora 2, mig 155):
  // contables las revisan en la bandeja de Captura Mágica; el que la subió
  // siempre ve la suya (regla del autor).
  'factura_campo',
];

// Bloques por función (un tipo puede estar en varios bloques).
const COMUN      = ['acta', 'documento_general', 'pdf_formato_firmado'];
// Registro profesional (mig 171): CV y constancias de experiencia. Son datos
// personales — los ve el equipo de propuestas, RR.HH. y la conducción.
const PROFESIONAL = ['cv_profesional', 'constancia_experiencia'];
// Papeles societarios de la EMPRESA (tanda 10, mig 189): ficha RUC, vigencia de
// poder, testimonio y RNP. Traen datos del representante legal y son los que se
// adjuntan en cada licitación → los ve la conducción, contabilidad, tesorería y
// el equipo de propuestas. NO el personal de obra.
export const TIPOS_DOC_EMPRESA_VIS = [
  'doc_empresa_ficha_ruc', 'doc_empresa_vigencia_poder',
  'doc_empresa_testimonio', 'doc_empresa_rnp', 'doc_empresa_otro',
];
const ROLES_DOC_EMPRESA = ['admin', 'gerente', 'contador', 'ayudante_contador', 'tesorero', 'licitaciones', 'asistente_admin'];
// Respaldo de un movimiento de CAJA CHICA (mig 200): la boleta, la factura o
// la foto del gasto. No es contable —la caja chica no entra al libro por acá—
// pero tampoco es de todos: lo ve quien lleva la caja (almacén), quien la
// controla (contabilidad, admin) y la conducción. Sin esta lista caería en el
// `ELSE true` de la policy y lo vería cualquier usuario autenticado.
// ⚠ Regla crítica 5: espejo exacto de la policy «evidencias: ver segun tipo».
export const TIPOS_CAJA_CHICA_VIS = ['caja_chica_respaldo'];
const ROLES_CAJA_CHICA = ['admin', 'gerente', 'contador', 'ayudante_contador', 'tesorero', 'almacenero', 'asistente_admin'];
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
  tesorero:            [...TIPOS_DOC_EMPRESA_VIS, ...COMUN],
  rrhh:                [...ASISTENCIA, ...PROFESIONAL, ...COMUN],
  // Licitaciones: SOLO el material del plantel profesional. Nada de obra,
  // almacén ni contabilidad.
  licitaciones:        [...PROFESIONAL, ...TIPOS_DOC_EMPRESA_VIS, ...COMUN],
  solo_lectura:        BASICO,
  // Rol campo (cuenta compartida con PIN): SOLO sus fotos de factura — y por
  // la regla del autor, únicamente las que él mismo subió (el RLS del server
  // lo garantiza además con el cerco de la mig 155).
  campo:               ['factura_campo'],
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
  // Papeles societarios: lista cerrada de roles, igual que el CASE del RLS.
  // Va ANTES del 'operativo' porque ingenieros y supervisores son operativos y
  // no tienen por qué ver el testimonio ni la vigencia de poder.
  if (TIPOS_DOC_EMPRESA_VIS.includes(ev.tipo_evidencia)) return ROLES_DOC_EMPRESA.includes(rol);
  // Igual que los papeles societarios: lista cerrada, ANTES del 'operativo'.
  // El almacenero no es 'operativo' (tiene lista propia) y sí tiene que verlos:
  // es quien lleva la caja.
  if (TIPOS_CAJA_CHICA_VIS.includes(ev.tipo_evidencia)) return ROLES_CAJA_CHICA.includes(rol);
  if (regla === 'operativo') return true;
  const lista = Array.isArray(regla) ? regla : BASICO;
  return lista.includes(ev.tipo_evidencia);
}
