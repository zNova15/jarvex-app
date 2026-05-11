// ══════════════════════════════════════════════════════════════════════════
//  JARVEX — Clasificador de insumos por nombre
//
//  Categoriza un nombre de insumo en una de cuatro familias:
//    'material'    → tabla `materiales` (cemento, fierro, ladrillos, etc)
//    'herramienta' → tabla `herramientas` (taladros, martillos, llaves)
//    'epp'         → tabla `epps` (cascos, guantes, lentes — SUNAFIL)
//    'maquinaria'  → tabla `activos_pesados` (mezcladoras, retroexcavadoras)
//
//  Reusa detectarEPP() de epp-utils para la detección de EPPs. Las otras
//  3 familias se detectan con regex específicas. El default es 'material'.
// ══════════════════════════════════════════════════════════════════════════
import { detectarEPP } from './epp-utils.js';

// ─── Herramientas (manuales / eléctricas / medición) ────────────────────
const HERRAMIENTA_RE = /\b(martillo|taladro|sierra|amoladora|pulidora|esmeril|llave inglesa|alicate|pinza|destornillador|broca|disco de corte|cinta m[eé]trica|wincha|nivel(?:\s|$)|escuadra|plomada|palana|pala(?:\s|$)|pico|lampa|carretilla|combo|cincel|p[uú]a|barreta|tenaza|spray pintar|cepillo de acero|cuchara de albañil|frot[aá]s|reglas?\s+de\s+aluminio|extensiones?\s+el[eé]ctricas?)\b/i;

// ─── Maquinaria (equipos pesados, motorizados) ──────────────────────────
const MAQUINARIA_RE = /\b(mezcladora|vibradora|trompo|compactadora|plancha vibratoria|retroexcavadora|cargador frontal|motoniveladora|gr[uú]a|montacargas|rodillo|motobomba|andamio|generador|compresor|soldadora|grupo electr[oó]geno|excavadora|volquete|cami[oó]n|tract[oó]r|tolva|winche|polipasto|martillo neum[aá]tico|mart[ií]n compactador|apisonadora)\b/i;

// ─── Servicios / gastos generales (NO van a inventario) ─────────────────
// Hay que detectarlos para que el contador NO marque "crear material" por error.
const SERVICIO_RE = /\b(combustible|gasolina|gas[oó]leo|petr[oó]leo|di[eé]sel|gasohol|flete|transporte|alquiler(?!.*?(de|equipo|maquinari))|servicio|honorario|consultor[ií]a|comisi[oó]n|tel[eé]fono|electricidad|agua potable|internet|hosting|seguros?|movilidad|peaje|comida|alimentaci[oó]n|hospedaje|hotel|notari[aá]l|tr[aá]mite|sunat|impuesto|gasto bancario|inter[eé]s)\b/i;

/**
 * Clasifica un insumo por su nombre.
 * @param {string} nombre
 * @returns {'material'|'herramienta'|'epp'|'maquinaria'|'servicio'}
 */
export function clasificarInsumo(nombre) {
  if (!nombre || typeof nombre !== 'string') return 'material';
  // Orden de prioridad: EPP primero (más específico), después servicios
  // (para no clasificar "alquiler de mezcladora" como material), después
  // maquinaria, herramienta, material como fallback.
  if (detectarEPP(nombre)) return 'epp';
  if (SERVICIO_RE.test(nombre)) return 'servicio';
  if (MAQUINARIA_RE.test(nombre)) return 'maquinaria';
  if (HERRAMIENTA_RE.test(nombre)) return 'herramienta';
  return 'material';
}

// Etiquetas para la UI
export const TIPO_INSUMO_LABEL = {
  material:    'Material',
  herramienta: 'Herramienta',
  epp:         'EPP',
  maquinaria:  'Maquinaria',
  servicio:    'Servicio / Gasto',
};

export const TIPO_INSUMO_BADGE = {
  material:    'b-gray',
  herramienta: 'b-blue',
  epp:         'b-amber',
  maquinaria:  'b-red',
  servicio:    'b-purple',
};

// Tabla destino para crear el insumo en Dexie
export const TIPO_INSUMO_TABLA = {
  material:    'materiales',
  herramienta: 'herramientas',
  epp:         'epps',
  maquinaria:  'activos_pesados',
  servicio:    null, // no se crea en inventario
};
