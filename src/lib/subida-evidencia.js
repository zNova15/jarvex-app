// ═══════════════════════════════════════════════════════════════════
// JARVEX — ¿Por qué falló la subida de una evidencia? (tanda E, 26-set-2026)
//
// El subidor contaba TODO fallo como un intento: cinco, cada 45 s, y la foto
// quedaba `failed` hasta que alguien recargara la app. Un corte de R2 de
// cuatro minutos, un arranque en frío de Vercel o la sesión vencida dejaban
// las fotos de avance de un ingeniero en obra marcadas como fallidas, con el
// archivo ahí al lado en el teléfono.
//
// No todos los fallos son iguales:
//   · 'sesion'      → el token venció o la sesión se revocó. No es culpa de la
//                     foto: no se cuenta, se corta la pasada (las demás
//                     fallarían igual) y se le avisa a useAuth.
//   · 'transitorio' → red caída, timeout, límite de pedidos, servidor 5xx.
//                     Tampoco se cuenta como intento: se espera (con espera
//                     creciente) y se vuelve a probar, sin tope.
//   · 'definitivo'  → el servidor dijo que NO (tipo de archivo, tamaño, RLS,
//                     CHECK de la tabla). Cuenta; a los 5 queda `failed` y el
//                     motivo se ve en el modal de sincronización.
// ═══════════════════════════════════════════════════════════════════

export const MAX_REINTENTOS = 5;

// Espera entre intentos: 45 s, 1,5 min, 3 min, 6 min… hasta 30 min.
export const ESPERA_BASE_MS = 45_000;
export const ESPERA_MAX_MS = 30 * 60_000;

/**
 * @param {object} f
 * @param {'firma'|'put'|'storage'|'metadata'} f.etapa
 * @param {number} [f.status]  HTTP (0 o ausente = no hubo respuesta)
 * @param {string} [f.code]    código de Postgres/PostgREST si lo hay
 * @param {string} [f.message]
 * @returns {'sesion'|'transitorio'|'definitivo'}
 */
export function clasificarFalloSubida({ etapa, status, code, message } = {}) {
  const st = Number(status) || 0;
  const cod = String(code || '');
  const msg = String(message || '').toLowerCase();

  if (cod === 'PGRST301' || msg.includes('jwt expired') || msg.includes('jwt is expired')
      || msg.includes('invalid jwt') || msg.includes('sin sesión')) return 'sesion';
  if (st === 401) return 'sesion';

  if (st === 408 || st === 425 || st === 429 || st >= 500) return 'transitorio';
  // Sin respuesta y sin código del servidor: la red.
  if (st === 0 && !cod) return 'transitorio';

  // La firma y el PUT sin status pero con mensaje de red también son red.
  // («Load failed» es como lo dice Safari/iPhone.)
  if ((etapa === 'firma' || etapa === 'put') && /network|failed to fetch|load failed|error de red|timeout/.test(msg)) return 'transitorio';

  return 'definitivo';
}

/** ¿El rechazo fue de la RLS? (requiere que alguien toque permisos) */
export function esRechazoRLS({ code, message } = {}) {
  const msg = String(message || '').toLowerCase();
  return String(code || '') === '42501' || msg.includes('row-level security') || msg.includes('row level security');
}

/** Espera antes del intento n (1 = primer reintento). */
export function esperaAntesDelIntento(n) {
  const k = Math.max(1, Number(n) || 1);
  return Math.min(ESPERA_BASE_MS * Math.pow(2, k - 1), ESPERA_MAX_MS);
}

/** ¿Ya le toca a esta evidencia? (respeta la espera del último fallo) */
export function leTocaSubir(evidencia, ahora = Date.now()) {
  const proximo = Number(evidencia?._proximo_intento) || 0;
  return proximo <= ahora;
}
