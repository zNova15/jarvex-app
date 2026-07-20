// ═══════════════════════════════════════════════════════════════════
// JARVEX — Categoría de PERSONAL: Obrero / Profesionales / Subcontratos / Otros.
//
// Ordena el personal para el filtro de la página, para el SCOPE de gestión de
// la ing. de seguridad y la almacenera (gestionan las 3 primeras, NO "Otros")
// y para la sección SCTR. La categoría se DERIVA del cargo + vínculo, pero
// admite un OVERRIDE manual guardado en personal.categoria (el admin corrige
// lo que no se clasifique bien).
//
// Reglas (pedido de Gabriel, jul 2026):
//  · Subcontratos: tiene subcontratista_id (sin importar el cargo), subdividido
//    por subcontrato.
//  · Personal Obrero: directo + Peón/Oficial/Operario/Maestro de Obra/Capataz.
//  · Profesionales: directo + Ingeniero*/Arquitecto/Técnico/Topógrafo/Sanitario…
//  · Otros: el resto (Otro/Supervisión/JASS/Administrador/Asistentes/Almacenero…)
//    — NO gestionable por seguridad, NO entra a SCTR.
// ═══════════════════════════════════════════════════════════════════
import { esObrero } from './personal-scope.js';

export const CATEGORIAS = [
  { key: 'obrero',        label: 'Personal Obrero', badge: 'b-green'  },
  { key: 'profesionales', label: 'Profesionales',   badge: 'b-blue'   },
  { key: 'subcontratos',  label: 'Subcontratos',    badge: 'b-purple' },
  { key: 'otros',         label: 'Otros',           badge: 'b-gray'   },
];
export const CATEGORIA_LABEL = Object.fromEntries(CATEGORIAS.map(c => [c.key, c.label]));
export const CATEGORIA_BADGE = Object.fromEntries(CATEGORIAS.map(c => [c.key, c.badge]));
export const CATEGORIA_KEYS = CATEGORIAS.map(c => c.key);

// Categorías que la ing. de seguridad / almacenera gestionan y que la sección
// SCTR considera (todo MENOS "Otros").
export const CATEGORIAS_GESTIONABLES = ['obrero', 'profesionales', 'subcontratos'];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Palabras clave de cargo PROFESIONAL (técnico / ingeniería).
const PROF_KEYS = ['ingenier', 'arquitect', 'tecnico', 'topograf', 'bachiller', 'sanitari', 'residente', 'proyectista', 'especialista', 'geolog'];
// Cargos OBREROS extra (además de peón/oficial/operario que resuelve esObrero).
const OBRERO_EXTRA = ['maestro de obra', 'capataz', 'ayudante'];

/** Categoría DERIVADA del cargo + vínculo (sin considerar el override manual). */
export function categoriaDerivada(persona) {
  if (persona?.subcontratista_id) return 'subcontratos';
  const c = norm(persona?.cargo);
  if (!c) return 'otros';
  if (esObrero(persona?.cargo)) return 'obrero';
  if (OBRERO_EXTRA.some(k => c.startsWith(k))) return 'obrero';
  if (PROF_KEYS.some(k => c.includes(k))) return 'profesionales';
  return 'otros';
}

function getSub(subsById, id) {
  if (!id || !subsById) return null;
  if (typeof subsById.get === 'function') return subsById.get(id) || null;
  return subsById[id] || null;
}

/** Categoría EFECTIVA (respeta el override manual válido) + subcategoría
 *  (nombre del subcontrato cuando la categoría es 'subcontratos'). */
export function categoriaDe(persona, subsById) {
  const ov = persona?.categoria;
  const cat = (ov && CATEGORIA_LABEL[ov]) ? ov : categoriaDerivada(persona);
  const sub = cat === 'subcontratos' ? (getSub(subsById, persona?.subcontratista_id)?.razon_social || null) : null;
  return { categoria: cat, sub };
}

/** ¿La ing. de seguridad / almacenera gestionan a esta persona? (no "Otros"). */
export function esGestionableSeguridad(persona, subsById) {
  return CATEGORIAS_GESTIONABLES.includes(categoriaDe(persona, subsById).categoria);
}

// Cargos canónicos ofrecidos al CREAR personal bajo scope (obrero + profesionales;
// para subcontratos se usa el selector de subcontratista). NO incluye cargos de
// "Otros" para que los roles con scope no creen personal fuera de su alcance.
export const CARGOS_GESTIONABLES_CANONICOS = [
  'Peón', 'Oficial', 'Operario', 'Maestro de Obra', 'Capataz',
  'Ingeniero', 'Ingeniero Residente', 'Ingeniero de Campo', 'Ingeniero Sanitario',
  'Ingeniero Ambiental', 'Ingeniero de Seguridad', 'Arquitecto', 'Topógrafo', 'Asistente de Ingeniería',
];
export const CARGOS_OBRERO_CANONICOS = ['Peón', 'Oficial', 'Operario', 'Maestro de Obra', 'Capataz'];

// ── Alcance por ROL (pedido 20-jul-2026) ────────────────────────────
// El RESIDENTE es netamente técnico: en Personal ve y gestiona SOLO Personal
// Obrero y Subcontratos (los Profesionales y "Otros" no son su alcance).
// Ing. de seguridad y almacenera mantienen las 3 categorías gestionables.
export function categoriasParaRol(rol) {
  if (rol === 'ingeniero_residente') return ['obrero', 'subcontratos'];
  return CATEGORIAS_GESTIONABLES;
}
/** Cargos ofrecidos al CREAR personal bajo scope: SOLO obreros (pedido 20-jul —
 *  "ingeniero residente" o similares NO son cargos que seguridad/almacenera/
 *  residente puedan crear; los profesionales los registra el admin). El
 *  personal de subcontrato se crea con estos mismos cargos + su subcontratista. */
export function cargosParaRol(_rol) {
  return CARGOS_OBRERO_CANONICOS;
}
