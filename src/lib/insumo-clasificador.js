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
const MAQUINARIA_RE = /\b(mezcladora|vibradora|trompo|compactadora|plancha vibratoria|retroexcavadora|cargador frontal|motoniveladora|gr[uú]a|montacargas|rodillo|motobomba|andamio|generador|compresora?|soldadora|grupo electr[oó]geno|excavadora|volquete|cami[oó]n|tract[oó]r|tolva|winche|polipasto|martillo neum[aá]tico|mart[ií]n compactador|apisonadora)\b/i;

// ─── Servicios / gastos generales (NO van a inventario) ─────────────────
// Hay que detectarlos para que el contador NO marque "crear material" por error.
const SERVICIO_RE = /\b(combustible|gasolina|gas[oó]leo|petr[oó]leo|di[eé]sel|gasohol|flete|acarreo|transporte|alquiler|arriendo|movilizaci[oó]n|desmovilizaci[oó]n|servicio|honorario|consultor[ií]a|comisi[oó]n|tel[eé]fono|electricidad|agua potable|internet|hosting|seguros?|movilidad|peaje|comida|alimentaci[oó]n|hospedaje|hotel|notari[aá]l|tr[aá]mite|sunat|impuesto|gasto bancario|inter[eé]s)\b/i;

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

// ══════════════════════════════════════════════════════════════════════════
//  CAPA «PRESUPUESTO»: clasificar una línea de `insumos_partida` (22-set-2026)
//
//  El clasificador de arriba lee SOLO el nombre, porque nació para las
//  descripciones sueltas de una factura. Una línea del expediente técnico
//  trae dos datos más que valen más que el nombre:
//
//    · `tipo_insumo` — 'material' | 'equipo' | 'mano_obra'. Solo tres cajones,
//      y adentro de `equipo` conviven cosas que NO son la misma orden: una
//      COMPRESORA NEUMATICA (alquiler, S/ 366.759 en Miraflores) y unos
//      ZAPATOS PUNTA DE ACERO (compra, S/ 13.210).
//    · `unidad` — y acá está la señal que desempata: `hm` es hora-MÁQUINA.
//      Nadie compra horas-máquina; se alquilan. Lo mismo `dia`. Un insumo de
//      `equipo` medido en `hm` es un servicio de alquiler, diga lo que diga
//      el nombre.
//
//  ── LAS PARTIDAS-SOBRE (unidades `%mo` y `glb`) ─────────────────────────
//  «HERRAMIENTAS MANUALES» (`%mo`, 1.115 filas, S/ 132.493) no es un insumo:
//  es un SOBRE. El expediente reserva un monto sin decir qué herramienta —
//  igual que el cajón «servicios» de la taxonomía del catálogo. Lo mismo los
//  `glb` sueltos (ACARREO S/ 152.031, FLETE TERRESTRE S/ 59.742,
//  MOVILIZACIÓN Y DESMOVILIZACIÓN S/ 5.000, TIJERAL METÁLICO S/ 39.460).
//
//  Un sobre NO se lee como lista de insumos porque no la tiene: se ordena
//  por descripción libre contra el monto como techo. Por eso `esSobre` es un
//  eje APARTE de la categoría: hay sobres de servicio (flete), de
//  herramienta (herramientas manuales) y de material (tijeral).
// ══════════════════════════════════════════════════════════════════════════

/** Unidades que solo existen alquilando: hora-máquina y día de equipo. */
export const UNIDADES_ALQUILER = new Set(['hm', 'dia', 'día', 'hd']);

/**
 * Unidades de «sobre»: un monto reservado sin lista de insumos detrás.
 * `mes` (ronda 2, 24-set-2026): el expediente de Miraflores reserva plata
 * mensual —GASTOS OPERATIVOS, MATERIAL PARA CAPACITACIÓN, TRANSPORTE DE
 * RESIDUOS— sin decir qué se compra. S/ 30.800 que salían como «3 mes» de
 * un material.
 */
export const UNIDADES_SOBRE = new Set(['%mo', 'glb', 'mes']);

// EPPs que la regex de `epp-utils` no ve porque nació del catálogo de SSOMA
// (casco/chaleco/guantes/…) y el expediente los nombra de otra manera.
// Todos medidos en el presupuesto de Miraflores el 22-set-2026.
const EPP_PRESUPUESTO_RE = /\b(zapatos?|zapatillas?|bot[ií]n(?:es)?|poncho impermeable|protector(?:es)? de o[ií]dos?|mameluco|overol|barbiquejo|careta|cortaviento|uniforme|pantal[oó]n de tela drill|camisa de tela drill|cinta reflectiva)\b/i;

/** Normaliza una unidad del expediente para compararla. */
export const normUnidad = (u) => String(u || '').trim().toLowerCase();

/**
 * Clasifica UNA línea del presupuesto (`insumos_partida`).
 *
 * @param {{tipo_insumo?:string, nombre_insumo?:string, unidad?:string}} ip
 * @returns {{subcategoria:string, categoria:string, esSobre:boolean, motivo:string}}
 *   `subcategoria` — 'material'|'herramienta'|'epp'|'maquinaria'|'servicio'|'mano_obra'
 *   `categoria`    — los cuatro cajones del filtro del simulador:
 *                    'materiales'|'herramientas'|'servicios'|'mano_obra'
 *   `motivo`       — por qué cayó ahí (para poder discutirlo en la pantalla).
 */
export function clasificarInsumoDePresupuesto(ip = {}) {
  const nombre = ip.nombre_insumo || '';
  const unidad = normUnidad(ip.unidad);
  const tipo = String(ip.tipo_insumo || '').trim().toLowerCase();
  const esSobre = UNIDADES_SOBRE.has(unidad);

  // 1) La mano de obra la decide la columna, no el nombre. Nunca se compra.
  if (tipo === 'mano_obra') {
    return { subcategoria: 'mano_obra', categoria: 'mano_obra', esSobre: false, motivo: 'tipo_insumo' };
  }

  // 2) Unidad de alquiler: gana sobre el nombre. Solo para `equipo` — un
  //    material medido en `dia` (raro) no es un alquiler de maquinaria.
  if (tipo === 'equipo' && UNIDADES_ALQUILER.has(unidad)) {
    return { subcategoria: 'servicio', categoria: 'servicios', esSobre, motivo: `unidad ${unidad}` };
  }

  // 3) El nombre, con el refuerzo de EPPs del expediente.
  let sub = EPP_PRESUPUESTO_RE.test(nombre) ? 'epp' : clasificarInsumo(nombre);

  // 4) Si vino de la columna `equipo`, no puede terminar en «material»: el
  //    expediente ya dijo que no lo es. Una ESCALERA TELESCOPICA que la
  //    regex no reconoce es una herramienta, no un material.
  if (tipo === 'equipo' && sub === 'material') sub = 'herramienta';

  return { subcategoria: sub, categoria: CATEGORIA_DE_SUBCATEGORIA[sub] || 'materiales', esSobre, motivo: 'nombre' };
}

/**
 * Las cinco subcategorías caen en los cuatro cajones del filtro (§3.4 del
 * plan). Dos decisiones que conviene tener a la vista:
 *
 *  · `epp` → «herramientas». Un EPP no es un consumible de obra: se entrega a
 *    una persona y se repone por vida útil, igual que una herramienta. La
 *    subcategoría se conserva igual, así que la pantalla puede seguir
 *    armando la orden «EPPs — primera dotación» por separado.
 *  · `maquinaria` COMPRADA (no alquilada — el alquiler ya salió por la
 *    unidad) → «herramientas»: es un equipo que pasa a ser de la empresa,
 *    no un material que se consume.
 */
export const CATEGORIA_DE_SUBCATEGORIA = {
  material: 'materiales',
  herramienta: 'herramientas',
  epp: 'herramientas',
  maquinaria: 'herramientas',
  servicio: 'servicios',
  mano_obra: 'mano_obra',
};

export const CATEGORIAS_SIMULADOR = ['materiales', 'herramientas', 'servicios', 'mano_obra'];

export const CATEGORIA_SIMULADOR_LABEL = {
  materiales: 'Materiales',
  herramientas: 'Herramientas y EPPs',
  servicios: 'Servicios y alquileres',
  mano_obra: 'Mano de obra',
};

export const SUBCATEGORIA_LABEL = {
  material: 'Materiales',
  herramienta: 'Herramientas',
  epp: 'EPPs',
  maquinaria: 'Maquinaria',
  servicio: 'Servicios y alquileres',
  mano_obra: 'Mano de obra',
};
