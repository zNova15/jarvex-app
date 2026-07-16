// ═══════════════════════════════════════════════════════════════════
// JARVEX — Scope de PERSONAL OBRERO (Peón / Oficial / Operario).
//
// La ing. de seguridad, la almacenera y el residente gestionan SOLO personal
// obrero: ven/crean/inhabilitan trabajadores con estos cargos y nada más
// (pedido de Gabriel). Comparación laxa: sin acentos, case-insensitive, y
// admite variantes tipo "Operario Civil" / "Oficial Encofrador".
// ═══════════════════════════════════════════════════════════════════

export const CARGOS_OBRERO = ['peon', 'oficial', 'operario'];
// Plurales aceptados (imports históricos tipean "Peones"/"Operarios").
const CARGOS_OBRERO_PLURAL = ['peones', 'oficiales', 'operarios'];
// Cargos STAFF que empiezan con palabra canónica pero NO son obreros
// ("Oficial de Seguridad" es la prevencionista, no una obrera).
const CARGOS_STAFF_BLOCKLIST = ['oficial de seguridad', 'oficial administrativo', 'oficial de oficina', 'oficial de cumplimiento'];

// Cargos canónicos para CREAR personal cuando el rol tiene scope obrero.
export const CARGOS_OBRERO_CANONICOS = ['Peón', 'Oficial', 'Operario'];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** ¿El cargo corresponde a personal obrero? ("Peón", "Operario Civil", etc.) */
export function esObrero(cargo) {
  const c = norm(cargo);
  if (!c) return false;
  if (CARGOS_STAFF_BLOCKLIST.includes(c)) return false;
  if (CARGOS_OBRERO_PLURAL.includes(c)) return true;
  return CARGOS_OBRERO.some(k => c === k || c.startsWith(k + ' '));
}

/** Roles cuya gestión de personal queda ACOTADA a obreros. */
export const ROLES_SCOPE_OBRERO = new Set(['prevencionista', 'almacenero', 'ingeniero_residente']);
export function rolScopeObrero(rol) { return ROLES_SCOPE_OBRERO.has(rol); }
