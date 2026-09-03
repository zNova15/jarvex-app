// ═══════════════════════════════════════════════════════════════════
// JARVEX — Consorcio: quién ejecuta una obra y con qué socios.
//
// Punto único de verdad para una pregunta que hasta la mig 172 se contestaba
// a mano en SIETE archivos distintos, cada uno leyendo el jsonb
// `obras.consorcio_miembros` con su propia interpretación: jx-obra,
// jx-contabilidad (rolesPorObra), jx-comprobantes, jx-captura-magica,
// jx-evidencias, jx-ordenes-intercompany.
//
// EL MODELO, EN UNA FRASE: el consorcio cuelga de la obra (1:1), y su
// TITULAR CONTABLE es una fila de `companies` con el RUC del consorcio.
//
// De ahí salen las dos reglas que gobiernan este archivo:
//
// 1. EL TITULAR NO ES UN SOCIO. `obras.ejecutora_company_id` apunta a la
//    company del consorcio — la que factura, la que lleva los libros. Los
//    socios son OTRAS empresas que ponen capital o experiencia. Confundirlos
//    hace que el consorcio se cuente a sí mismo como socio y que la suma de
//    participaciones nunca cierre.
//
// 2. FALLBACK AL JSONB DEPRECADO. `obras.consorcio_miembros` (mig 035) nunca
//    se usó en producción — estaba NULL en todas las obras al migrar. Pero un
//    cliente PWA con bundle viejo pudo haberlo escrito, así que se lee cuando
//    no hay filas en `consorcio_socios`. Nunca se escribe.
//
// El socio de consorcio NO es un subcontratista y este archivo no sabe nada de
// subcontratos: el socio aporta capital o experiencia y solo tiene su %; el
// subcontratista aporta mano de obra ejecutora y vive en su propia cadena
// (subcontratistas → subcontratos → personal). No fusionar.
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

/**
 * Roles que pueden constituir un consorcio y fijar participaciones.
 *
 * ESPEJO EXACTO de la policy "consorcios: conduccion escribe" de la mig 172.
 * Si el cliente deja editar a un rol que el servidor rechaza, el push falla en
 * silencio y el usuario pierde el trabajo sin entender por qué: los dos lados
 * se cambian juntos o no se cambian.
 */
export const ROLES_ESCRIBEN_CONSORCIO = ['admin', 'gerente', 'contador'];

/** ¿Este rol puede tocar el consorcio y sus socios? */
export function puedeEditarConsorcio(rol) {
  return ROLES_ESCRIBEN_CONSORCIO.includes(String(rol || ''));
}

/** Tolerancia al comparar la suma de participaciones contra 100. */
export const TOLERANCIA_PCT = 0.01;

/** Mínimo de socios para que un consorcio sea un consorcio y no una empresa. */
export const MIN_SOCIOS = 2;

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** El consorcio de una obra, o null si la ejecuta una empresa directa. */
export function consorcioDeObra(obraId, consorcios) {
  if (!obraId) return null;
  return vivos(consorcios).find(c => c.obra_id === obraId) || null;
}

/** ¿Esta obra la ejecuta un consorcio? Mira la tabla nueva y cae al flag viejo. */
export function esObraDeConsorcio(obra, consorcios) {
  if (!obra) return false;
  if (consorcioDeObra(obra.id, consorcios)) return true;
  return obra.ejecutora_tipo === 'consorcio';
}

/** Socios de un consorcio, ordenados: el líder primero, después por % desc. */
export function sociosDeConsorcio(consorcioId, socios) {
  if (!consorcioId) return [];
  return vivos(socios)
    .filter(s => s.consorcio_id === consorcioId)
    .slice()
    .sort((a, b) => (b.es_lider ? 1 : 0) - (a.es_lider ? 1 : 0)
      || num(b.participacion_pct) - num(a.participacion_pct));
}

/**
 * Socios de una obra, normalizados a { company_id, participacion_pct, es_lider }.
 * Lee `consorcio_socios`; si esa obra no tiene ninguno todavía, cae al jsonb
 * deprecado para no perder de vista datos escritos por un bundle viejo.
 */
export function sociosDeObra(obra, consorcios, socios) {
  if (!obra) return [];
  const c = consorcioDeObra(obra.id, consorcios);
  if (c) {
    const filas = sociosDeConsorcio(c.id, socios);
    if (filas.length) {
      return filas.map(s => ({
        company_id: s.company_id,
        participacion_pct: num(s.participacion_pct),
        es_lider: !!s.es_lider,
        _socio_id: s.id,
      }));
    }
  }
  // Fallback: jsonb de la mig 035. Deprecado — se lee, no se escribe.
  return (Array.isArray(obra.consorcio_miembros) ? obra.consorcio_miembros : [])
    .filter(m => m && m.company_id)
    .map(m => ({
      company_id: m.company_id,
      participacion_pct: num(m.participacion_pct),
      es_lider: false,
      _legacy: true,
    }));
}

/**
 * La company que lleva los libros de esta obra.
 * INVARIANTE: para una obra de consorcio es la company del consorcio, no la de
 * ningún socio. Todo el bloque contable (accounting_movements.company_id, PLE,
 * EE.FF., comprobantes) depende de que esto y obras.ejecutora_company_id
 * apunten al mismo lado.
 */
export function titularContableDeObra(obra, consorcios) {
  if (!obra) return null;
  const c = consorcioDeObra(obra.id, consorcios);
  return c?.company_id || obra.ejecutora_company_id || null;
}

/**
 * Todas las companies vinculadas a la obra: el titular MÁS los socios.
 * Es el conjunto que usan los matcheos de facturas y comprobantes para decidir
 * "¿esta obra le corresponde a la empresa que emitió este documento?".
 */
export function companyIdsDeObra(obra, consorcios, socios) {
  const ids = new Set();
  const titular = titularContableDeObra(obra, consorcios);
  if (titular) ids.add(titular);
  for (const s of sociosDeObra(obra, consorcios, socios)) {
    if (s.company_id) ids.add(s.company_id);
  }
  return ids;
}

/**
 * Qué es esta empresa respecto de esta obra.
 * Reemplaza el cálculo suelto de `rolesPorObra` en jx-contabilidad.
 */
export function rolDeCompanyEnObra(companyId, obra, consorcios, socios) {
  if (!companyId || !obra) return null;
  if (titularContableDeObra(obra, consorcios) === companyId) return 'ejecutora';
  const esSocio = sociosDeObra(obra, consorcios, socios).some(s => s.company_id === companyId);
  return esSocio ? 'miembro_consorcio' : null;
}

/** Suma de participaciones, redondeada a 2 decimales para no arrastrar flotantes. */
export function sumaParticipacion(socios) {
  const t = (Array.isArray(socios) ? socios : []).reduce((a, s) => a + num(s?.participacion_pct), 0);
  return Math.round(t * 100) / 100;
}

/**
 * Las reglas que un CHECK de Postgres no puede expresar, porque miran al
 * conjunto y no a la fila. El servidor valida cada socio por separado
 * (0 < pct <= 100, par consorcio+company único); esto valida el grupo.
 *
 * @param socios  [{ company_id, participacion_pct, es_lider }]
 * @param opts.titularCompanyId  company del consorcio, para que no sea su propio socio
 * @returns { ok, errores: string[], suma }
 */
export function validarSocios(socios, opts = {}) {
  const arr = Array.isArray(socios) ? socios : [];
  const errores = [];
  const suma = sumaParticipacion(arr);

  const conEmpresa = arr.filter(s => s?.company_id);
  if (conEmpresa.length < arr.length) errores.push('Hay socios sin empresa elegida.');
  if (conEmpresa.length < MIN_SOCIOS) {
    errores.push(`Un consorcio necesita al menos ${MIN_SOCIOS} socios.`);
  }

  const ids = conEmpresa.map(s => s.company_id);
  if (new Set(ids).size !== ids.length) errores.push('Hay una empresa repetida entre los socios.');

  if (opts.titularCompanyId && ids.includes(opts.titularCompanyId)) {
    errores.push('El consorcio no puede ser socio de sí mismo.');
  }

  for (const s of conEmpresa) {
    const p = num(s.participacion_pct);
    if (p <= 0) { errores.push('Cada socio necesita un porcentaje mayor a 0.'); break; }
    if (p > 100) { errores.push('Ningún socio puede tener más de 100%.'); break; }
  }

  if (Math.abs(suma - 100) > TOLERANCIA_PCT) {
    errores.push(`Las participaciones suman ${suma}% y deben sumar 100%.`);
  }

  if (conEmpresa.filter(s => s.es_lider).length > 1) {
    errores.push('Solo un socio puede ser el líder del consorcio.');
  }

  return { ok: errores.length === 0, errores, suma };
}

/**
 * Texto de la ejecutora para listados: "Consorcio X (A + B)" o el nombre de la
 * empresa. `lookupCompany` recibe un id y devuelve la company (o undefined).
 */
export function etiquetaEjecutora(obra, consorcios, socios, lookupCompany) {
  if (!obra) return '—';
  const nombreDe = (id) => (typeof lookupCompany === 'function' ? lookupCompany(id)?.name : null);

  if (esObraDeConsorcio(obra, consorcios)) {
    const c = consorcioDeObra(obra.id, consorcios);
    const nombre = c?.nombre || obra.consorcio_nombre || nombreDe(obra.ejecutora_company_id);
    const partes = sociosDeObra(obra, consorcios, socios).map(s => nombreDe(s.company_id)).filter(Boolean);
    const cola = partes.length ? ` (${partes.join(' + ')})` : '';
    if (nombre) {
      return /^consorcio/i.test(nombre) ? `${nombre}${cola}` : `Consorcio ${nombre}${cola}`;
    }
    return `Consorcio${cola || ' (—)'}`;
  }

  return nombreDe(obra.ejecutora_company_id) || '—';
}
