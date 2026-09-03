// ═══════════════════════════════════════════════════════════════════
// JARVEX — Qué obras puede ver un usuario (tabla obra_usuarios, Supabase).
//
// obra_usuarios NO se sincroniza a Dexie → se consulta directo a Supabase.
//
// ⚠ EL AGUJERO QUE CIERRA LA TANDA 2D (hallazgo de Gabriel, 3-sep-2026):
// hasta hoy, "sin asignaciones" devolvía `null` = SIN RESTRICCIÓN, así que un
// usuario de obra al que nadie le asignó nada veía TODAS las obras del grupo.
// La regla correcta, y la que confirmó Gabriel, es la contraria:
//
//   · ROL GLOBAL (admin, gerente, contadora jefe, ayudante, tesorero,
//     licitaciones) → `null` = ve todas. Su trabajo ES cross-obra.
//   · ROL DE OBRA (almacenero, ingeniero, residente, prevencionista…) → SOLO
//     las obras donde está designado. Sin designaciones → Set VACÍO: no ve
//     ninguna, y la pantalla le dice que pida acceso al administrador.
//
// Y como la app es OFFLINE-FIRST, un fallo de red no puede convertirse en
// "no ve nada" ni en "ve todo": se cachea la última respuesta buena por
// usuario en localStorage y se usa como respaldo. Sin caché y sin red, un rol
// de obra ve el Set vacío (cerrado) — nunca el `null` abierto.
//
// La UI es solo la mitad: el espejo en RLS vive en la mig 175.
// ═══════════════════════════════════════════════════════════════════

const CACHE_KEY = 'jx_obras_asignadas_v1';

/**
 * Roles cuyo trabajo es cross-obra: ven todas sin necesidad de designación.
 * ESPEJO de `es_rol_global()` en la mig 175 — si acá se agrega un rol y allá
 * no, la pantalla muestra obras que el servidor después niega (o al revés).
 */
export const ROLES_GLOBALES = new Set([
  'admin', 'gerente', 'contador', 'ayudante_contador', 'tesorero', 'licitaciones',
]);

/** ¿Este rol ve todas las obras por definición? */
export function esRolGlobal(rol) {
  return ROLES_GLOBALES.has(String(rol || ''));
}

/**
 * La decisión PURA, sin I/O: qué obras ve este usuario.
 *
 * @param rol         rol del profile
 * @param filas       filas de obra_usuarios ya leídas ([{obra_id}]), o null si
 *                    la consulta no se pudo hacer (offline / error).
 * @param modoPrueba  true en modo 'prueba' — los datos demo viven solo en
 *                    Dexie y JAMÁS están en obra_usuarios: cualquier Set del
 *                    server dejaría la app sin obras. Por eso no restringe.
 * @param cache       último Set bueno conocido (array de ids) o null.
 * @returns Set<string> (restringido) | null (sin restricción)
 */
export function resolverObrasPermitidas({ rol, filas, modoPrueba = false, cache = null } = {}) {
  if (modoPrueba) return null;
  if (esRolGlobal(rol)) return null;
  // Sin rol todavía (profile a medio cargar): NO abrir el acceso. Cerrado
  // hasta saber quién es — el arranque vuelve a pedirlo cuando llega el rol.
  if (!rol) return new Set();

  if (Array.isArray(filas)) {
    return new Set(filas.map(r => r?.obra_id).filter(Boolean));
  }
  // La consulta falló (offline o error): respaldo en la última respuesta buena.
  if (Array.isArray(cache)) return new Set(cache.filter(Boolean));
  // Sin datos y sin caché: cerrado. Antes acá se devolvía `null` y era la fuga.
  return new Set();
}

/**
 * Qué mostrar MIENTRAS la consulta va en camino (arranque de la app).
 *
 * La otra mitad del agujero: `window.__obrasPermitidas` se poblaba en un
 * efecto async, y hasta que resolvía valía `undefined`, que todos los
 * consumidores leen como `?? null` = SIN RESTRICCIÓN. O sea: en cada arranque
 * había una ventana donde el selector mostraba todas las obras del grupo.
 *
 * @returns {{ permitidas: Set|null, confiable: boolean }}
 *   confiable=false → todavía no sabemos: la UI debe esperar (loading), no
 *   mostrar "no tenés obras" ni, mucho menos, mostrarlas todas.
 */
export function obrasPermitidasIniciales({ userId, rol } = {}) {
  if (esRolGlobal(rol)) return { permitidas: null, confiable: true };
  const cache = userId ? leerCache(userId) : null;
  if (Array.isArray(cache)) return { permitidas: new Set(cache.filter(Boolean)), confiable: true };
  // Sin caché: cerrado y marcado como no confiable.
  return { permitidas: new Set(), confiable: false };
}

function leerCache(userId) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const v = raw?.[userId];
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

function guardarCache(userId, ids) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    raw[userId] = ids;
    localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
  } catch {}
}

/**
 * Set de obra_ids que el usuario puede ver, o `null` = sin restricción.
 * Envuelve `resolverObrasPermitidas` con la I/O (Supabase + caché local).
 */
export async function cargarObrasAsignadas({ userId, rol } = {}) {
  let modoPrueba = false;
  try {
    const { getCurrentMode } = await import('./app-mode-core.js');
    modoPrueba = getCurrentMode() === 'prueba';
  } catch {}
  if (modoPrueba) return null;
  if (esRolGlobal(rol)) return null;
  // Sesión offline sin identidad: cerrado (el guard de páginas ya deniega).
  if (!userId || userId === 'offline') return resolverObrasPermitidas({ rol, filas: null, cache: null });

  const cache = leerCache(userId);
  try {
    const sb = window.__supabase;
    if (!sb) return resolverObrasPermitidas({ rol, filas: null, cache });
    const { data, error } = await sb.from('obra_usuarios')
      .select('obra_id').eq('usuario_id', userId).eq('activo', true);
    if (error) {
      console.warn('[obras-asignadas] load falló:', error?.message);
      return resolverObrasPermitidas({ rol, filas: null, cache });
    }
    const ids = (data || []).map(r => r.obra_id).filter(Boolean);
    guardarCache(userId, ids);
    return resolverObrasPermitidas({ rol, filas: data || [], cache });
  } catch {
    return resolverObrasPermitidas({ rol, filas: null, cache });
  }
}
