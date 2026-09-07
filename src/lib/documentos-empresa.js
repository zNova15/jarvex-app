// ═══════════════════════════════════════════════════════════════════
// JARVEX — Los papeles de la empresa (Ficha de Empresa).
//
// Pedido de la contadora, vía Gabriel (7-sep-2026): en el bloque «Ficha de
// Empresa» debería poder subir y guardar, de cada empresa, la FICHA RUC, la
// VIGENCIA DE PODER, el TESTIMONIO y el RNP.
//
// Son documentos de la EMPRESA, no de una obra: la ficha de empresa es el único
// lugar donde tiene sentido buscarlos, y son los mismos que se adjuntan cada vez
// que se presenta una propuesta. Hasta hoy vivían en el correo o en una carpeta
// de Drive, y quien armaba una licitación los pedía por WhatsApp.
//
// Se guardan como EVIDENCIAS (el único camino de archivos de la app: obra_id
// null, modulo_relacionado 'companies', registro_relacionado_id = company.id).
// Dos de los cuatro CADUCAN —la vigencia de poder y el RNP— así que el que
// manda es el ÚLTIMO subido y la ficha avisa cuando está por vencer.
// ═══════════════════════════════════════════════════════════════════

/**
 * El catálogo. `venceUsualmente` marca los que caducan: solo esos piden fecha
 * de vencimiento y solo esos pueden aparecer en rojo.
 */
export const DOCS_EMPRESA = [
  {
    id: 'ficha_ruc', tipo: 'doc_empresa_ficha_ruc', titulo: 'Ficha RUC',
    desc: 'La ficha de inscripción que emite SUNAT con los datos del contribuyente',
    venceUsualmente: false,
  },
  {
    id: 'vigencia_poder', tipo: 'doc_empresa_vigencia_poder', titulo: 'Vigencia de poder',
    desc: 'La constancia de SUNARP de que el representante legal sigue facultado',
    venceUsualmente: true,
  },
  {
    id: 'testimonio', tipo: 'doc_empresa_testimonio', titulo: 'Testimonio',
    desc: 'La escritura pública de constitución y sus modificaciones',
    venceUsualmente: false,
  },
  {
    id: 'rnp', tipo: 'doc_empresa_rnp', titulo: 'RNP',
    desc: 'La constancia del Registro Nacional de Proveedores del Estado',
    venceUsualmente: true,
  },
  {
    id: 'otro', tipo: 'doc_empresa_otro', titulo: 'Otro documento',
    desc: 'Cualquier otro papel de la empresa que convenga tener a mano',
    venceUsualmente: false,
  },
];

/** Todos los tipo_evidencia que son papeles de empresa. */
export const TIPOS_DOC_EMPRESA = DOCS_EMPRESA.map(d => d.tipo);

/** ¿Este tipo_evidencia es un papel de empresa? */
export const esDocEmpresa = (tipo) => TIPOS_DOC_EMPRESA.includes(tipo);

/** La definición de un documento por su tipo_evidencia. */
export const docEmpresaPorTipo = (tipo) => DOCS_EMPRESA.find(d => d.tipo === tipo) || null;

/**
 * Los datos que la ficha guarda dentro de `observaciones` (la tabla evidencias
 * no tiene columnas propias para esto y no vale la pena migrarla por dos
 * fechas). Se serializa como JSON; si viene texto suelto, se respeta como nota.
 */
export function serializarMetaDoc({ numero, emision, vencimiento, nota } = {}) {
  const meta = {};
  if (numero) meta.numero = String(numero).trim();
  if (emision) meta.emision = emision;
  if (vencimiento) meta.vencimiento = vencimiento;
  if (nota) meta.nota = String(nota).trim();
  return Object.keys(meta).length ? JSON.stringify(meta) : '';
}

export function parsearMetaDoc(observaciones) {
  const raw = observaciones;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  const s = String(raw).trim();
  if (!s.startsWith('{')) return { nota: s };
  try {
    const j = JSON.parse(s);
    return (j && typeof j === 'object') ? j : { nota: s };
  } catch { return { nota: s }; }
}

const dia = 86400000;

/**
 * Estado de vigencia de un documento con fecha de vencimiento.
 * @returns 'sin_fecha' | 'vencido' | 'por_vencer' (≤30 días) | 'vigente'
 */
export function estadoVigencia(vencimiento, hoy) {
  if (!vencimiento) return 'sin_fecha';
  const ref = hoy ? new Date(hoy + 'T00:00:00') : new Date();
  const v = new Date(String(vencimiento) + 'T00:00:00');
  if (Number.isNaN(v.getTime())) return 'sin_fecha';
  const dias = Math.floor((v - ref) / dia);
  if (dias < 0) return 'vencido';
  if (dias <= 30) return 'por_vencer';
  return 'vigente';
}

/**
 * Agrupa las evidencias de UNA empresa por tipo de documento.
 *
 * De cada tipo, el que MANDA es el más reciente (por fecha de subida): la
 * vigencia de poder se renueva y la vieja queda como historial, no se pisa.
 *
 * @returns Map(docId → { def, vigente, historial:[…], meta, estado })
 */
export function documentosDeEmpresa(evidencias, companyId, { hoy } = {}) {
  const out = new Map();
  const propias = (evidencias || []).filter(e =>
    e && !e.deleted_at &&
    esDocEmpresa(e.tipo_evidencia) &&
    String(e.registro_relacionado_id || '') === String(companyId || ''));

  for (const def of DOCS_EMPRESA) {
    const delTipo = propias
      .filter(e => e.tipo_evidencia === def.tipo)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const vigente = delTipo[0] || null;
    const meta = vigente ? parsearMetaDoc(vigente.observaciones) : {};
    out.set(def.id, {
      def,
      vigente,
      historial: delTipo.slice(1),
      meta,
      estado: def.venceUsualmente ? estadoVigencia(meta.vencimiento, hoy) : 'sin_fecha',
    });
  }
  return out;
}

/** Cuántos de los papeles CLAVE están cargados (el "otro" no cuenta). */
export function resumenDocsEmpresa(evidencias, companyId, { hoy } = {}) {
  const docs = documentosDeEmpresa(evidencias, companyId, { hoy });
  const clave = DOCS_EMPRESA.filter(d => d.id !== 'otro');
  const cargados = clave.filter(d => docs.get(d.id)?.vigente).length;
  const vencidos = clave.filter(d => docs.get(d.id)?.estado === 'vencido').length;
  const porVencer = clave.filter(d => docs.get(d.id)?.estado === 'por_vencer').length;
  return { total: clave.length, cargados, vencidos, porVencer, faltan: clave.length - cargados };
}
