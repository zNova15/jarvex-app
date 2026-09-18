// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL ELEMENTO 9: A DÓNDE FUE LA PLATA (tanda 1 del destino).
//
// ── QUÉ ES ────────────────────────────────────────────────────────
// El PCGE tiene dos vocabularios para el mismo gasto:
//   · POR NATURALEZA (elemento 6): QUÉ se compró — 6032 Suministros.
//   · POR FUNCIÓN (elemento 9):    PARA QUÉ fue  — 92 Costo de obra.
//
// Hasta hoy JARVEX escribía solo el primero. Eso alcanza para el Registro de
// Compras, pero no para saber cuánto costó una obra, ni para el Estado de
// Resultados por función, ni para el Registro de Costos de SUNAT.
//
// El caso que dieron las contadoras (18-set-2026) lo muestra mejor que
// cualquier definición: dos facturas de «PETRÓLEO DIESEL B5», mismo proveedor,
// mismo importe. Una es para el generador de la obra; la otra, para la
// camioneta de reparto. La cuenta por naturaleza es la MISMA en las dos
// (6032). Lo único que las distingue es el destino: 92 contra 95. Sin este
// elemento no hay dónde escribir esa diferencia, y las dos terminan siendo la
// misma fila.
//
// ── POR QUÉ ESTA LISTA VIVE EN EL BUNDLE Y NO EN LA BASE ──────────
// El PCGE 2019 (p. 206) NO define las cuentas de este elemento. Dice textual:
//
//     «Se deja a criterio de las entidades el uso de las cuentas de este
//      elemento, con el objetivo que cubran las necesidades de información de
//      sus costos de producción y gastos por función.»
//
// O sea: 90…97 es la costumbre peruana, no la norma. Siendo «propio» podría
// argumentarse que va a la base, como `clasificaciones` (mig 205). No va, y es
// deliberado: son SIETE filas que se acordaron una vez con las contadoras y no
// cambian de un mes a otro. Sincronizar siete filas para siempre es tráfico
// permanente para guardar algo fijo — la misma lección del corte por egress
// del 9-set. Lo que sí irá a la base el día que haga falta es el DESGLOSE por
// obra (92 + obra + frente), que sí es propio de cada empresa y sí cambia.
//
// ── CUÁLES USAN ───────────────────────────────────────────────────
// Gabriel, 18-set-2026: «de la 90 solo utilizan la 94, 95 y 97, pero podríamos
// tener 90, 91, 92 y 93». Las siete existen; las tres en uso salen primero en
// el desplegable y las otras cuatro abajo, disponibles. No se esconden: el día
// que arranquen a costear obra van a necesitar la 92 y tiene que estar ahí sin
// pedirle una migración a nadie.
//
// Funciones puras. Testeadas en __tests__/destino-asiento.test.js.
// ═══════════════════════════════════════════════════════════════════

/** El nombre oficial del elemento, tal como lo titula el PCGE 2019 (p. 206). */
export const ELEMENTO_9_NOMBRE =
  'Contabilidad analítica de explotación: costos de producción y gastos por función';

/**
 * Las siete cuentas del elemento 9.
 *
 * `enUso` marca las que las contadoras del grupo usan hoy. Es un dato de
 * presentación —ordena el desplegable—, NO un permiso: una cuenta «no en uso»
 * se puede elegir igual. Apagarle la opción a la contadora que decidió costear
 * una obra sería hacerle pedir una migración para escribir un número.
 */
export const ELEMENTO_9 = [
  {
    codigo: '94', nombre: 'Gastos de administración', enUso: true,
    porque: 'Lo que sostiene a la empresa y no es de una obra: contabilidad, alquiler de oficina, útiles.',
  },
  {
    codigo: '95', nombre: 'Gastos de ventas', enUso: true,
    porque: 'Lo que cuesta vender y entregar: comisiones, publicidad, flete de la venta, combustible de reparto.',
  },
  {
    codigo: '97', nombre: 'Gastos financieros', enUso: true,
    porque: 'Intereses, portes y comisiones del banco. Es el destino natural de la cuenta 67.',
  },
  {
    codigo: '90', nombre: 'Costo de servicios', enUso: false,
    porque: 'El costo de un servicio que la empresa presta y factura.',
  },
  {
    codigo: '91', nombre: 'Costo por distribuir', enUso: false,
    porque: 'Lo que todavía no se sabe a qué obra o producto cargar, y se reparte después.',
  },
  {
    codigo: '92', nombre: 'Costo de producción', enUso: false,
    porque: 'El costo de la obra: material, mano de obra y todo lo que se consume ejecutándola.',
  },
  {
    codigo: '93', nombre: 'Centro de costos', enUso: false,
    porque: 'El costo abierto por centro —una obra, un frente, una máquina— cuando hace falta ese detalle.',
  },
];

const POR_CODIGO = new Map(ELEMENTO_9.map(c => [c.codigo, c]));

/** ¿Es una cuenta del elemento 9 que conocemos? Acepta el código a 2 dígitos o más. */
export const esCuentaElemento9 = (codigo) => POR_CODIGO.has(madre9(codigo));

/** Los dos primeros dígitos, que es el nivel con el que trabajan las contadoras. */
export function madre9(codigo) {
  return String(codigo ?? '').trim().slice(0, 2);
}

/** La cuenta del elemento 9, o null. */
export const cuenta9 = (codigo) => POR_CODIGO.get(madre9(codigo)) || null;

/** El nombre de una cuenta del elemento 9, o cadena vacía. */
export const nombre9 = (codigo) => cuenta9(codigo)?.nombre || '';

export default { ELEMENTO_9, ELEMENTO_9_NOMBRE, esCuentaElemento9, cuenta9, nombre9, madre9 };
