// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA EMPRESA ACTIVA (tanda 2F).
//
// Hermana de la OBRA ACTIVA (`src/hooks/useObraActiva.js`), y por el mismo
// motivo. Gabriel, probando el desglose de empresa (3-sep-2026):
//
//   «Se supone que deberíamos mantener por empresa este tema de la
//    contabilidad […] si luego tú presionas movimientos, ahí te va a salir de
//    todos […] aquí tienes nuevamente todo mezclado.»
//
// EL PROBLEMA QUE RESUELVE: entrar a la contabilidad de UNA empresa y, al
// abrir cualquier pantalla contable, volver a ver las de TODAS. La obra ya
// tenía resuelto exactamente esto (entrega 2B: dentro de una obra, sus
// pantallas se acotan a ella y un cartel dice en cuál estás). La empresa no.
//
// CÓMO SE USA en una pantalla contable, en una línea:
//     const [filtroEmpresa, setFiltroEmpresa] = useState(() => filtroInicialEmpresa());
// Si hay empresa activa arranca filtrada por ella; si no, en 'todas', que es
// como funcionaba siempre. Y el cartel de contexto lo pone <EmpresaActivaBanner>.
//
// Se persiste en localStorage —igual que la obra activa— para que sobreviva a
// un F5 y a la recarga del PWA: si no, entrar a un comprobante y volver te
// sacaba del contexto de la empresa sin avisar.
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'empresa_activa_id';
const EVT_NAME = 'empresa_activa_change';

/** El id de la empresa activa, o null si se está mirando el grupo entero. */
export function getEmpresaActivaId() {
  try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
}

/**
 * Entrar (o salir, con null) del contexto de una empresa.
 * Emite `empresa_activa_change` para que las pantallas abiertas reaccionen.
 */
export function setEmpresaActivaId(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
  try { window.dispatchEvent(new CustomEvent(EVT_NAME, { detail: { id: id || null } })); } catch {}
}

/** Salir del contexto: volver a ver todas las empresas. */
export function limpiarEmpresaActiva() {
  setEmpresaActivaId(null);
}

/**
 * El valor inicial del filtro de empresa de una pantalla contable.
 *
 * @param todas  el valor que esa pantalla usa para "sin filtro" — casi todas
 *               usan la cadena 'todas', pero alguna usa null o ''.
 * @returns el id de la empresa activa, o `todas` si no hay ninguna.
 */
export function filtroInicialEmpresa(todas = 'todas') {
  return getEmpresaActivaId() || todas;
}

/**
 * ¿Esta pantalla está mostrando lo de UNA empresa por el contexto activo?
 * Sirve para decidir si mostrar el cartel y bloquear el selector.
 */
export function enContextoDeEmpresa(filtroActual) {
  const activa = getEmpresaActivaId();
  return !!activa && filtroActual === activa;
}

export const EMPRESA_ACTIVA_EVENT = EVT_NAME;
export const EMPRESA_ACTIVA_KEY = STORAGE_KEY;
