// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL PUENTE ENTRE LO QUE SE COMPRÓ Y LA CUENTA DEL PCGE.
//
// ── EL PROBLEMA QUE RESUELVE ──────────────────────────────────────
// Hasta el 17-set-2026 el Libro Diario elegía la cuenta con un regex sobre el
// campo `category` del movimiento. Pero `category` NO es la naturaleza del
// gasto: contiene el TIPO DE DOCUMENTO. Medido en producción ese día, sobre
// 1.742 movimientos vivos:
//
//     category = 'Factura'           1.710
//     category = 'Nota de Crédito'      28
//     category = 'Recibo Honorarios'     3
//     category = 'Boleta'                1
//
// Ninguno de esos cuatro valores coincidía con ningún regex, así que TODOS
// caían al `return` por defecto: costo → 60, gasto → 65, ingreso → 70. No
// fallaba a veces: no funcionó nunca. Por eso las contadoras veían la factura
// F055-6246 de AREQUIPA EXPRESO MARVISUR («TRANSPORTE NACIONAL», S/ 37) en la
// cuenta 60 cuando es un flete y va a la 63.
//
// ── DE DÓNDE SALE AHORA ───────────────────────────────────────────
// De lo que se compró, que la app ya sabe. Cada comprobante trae sus ítems
// («TRANSPORTE NACIONAL») y esos ítems ya se clasifican con el árbol que se
// armó en setiembre: el IUPC del INEI para insumos y los códigos S01…S14 para
// servicios. Lo único que faltaba era esta tabla: qué cuenta del PCGE le
// corresponde a cada familia.
//
// Medido el 17-set sobre los 3.609 ítems de producción: el catálogo de la
// empresa resuelve el 23,6 % por sí solo, y con el clasificador IUPC encima se
// llega al 77,1 % de los ítems y al 98,3 % del dinero.
//
// ── POR QUÉ NO ES IA ──────────────────────────────────────────────
// Porque no hace falta. Es una tabla de 95 filas que se escribe una vez, se
// lee, se discute con la contadora y se testea. Una IA encima de esto costaría
// plata por cada factura para adivinar algo que el sistema ya sabe, y no se
// podría auditar. La IA queda para lo que esta tabla no alcanza.
//
// ── NO SE INVENTA UNA CUENTA PLAUSIBLE ────────────────────────────
// Igual que el clasificador devuelve `sin_clasificar` en vez de un código
// inventado (regla 8 del CLAUDE.md), acá una familia sin cuenta devuelve null.
// Una fila que dice «no sé» se filtra y se resuelve; una con una cuenta
// inventada se pierde entre las buenas y nadie la vuelve a mirar.
//
// Funciones puras. Testeadas en __tests__/pcge-puente.test.js.
// ═══════════════════════════════════════════════════════════════════

import { esCuentaValida, cuentaMadreDe } from './pcge.js';
import { REAGRUPACIONES_IUPC } from './indices-unificados-iupc.js';

/**
 * La tabla. Por cada familia: a qué cuenta va cuando se COMPRA, a cuál cuando
 * se VENDE, y por qué.
 *
 * `revisar: true` marca las que son discutibles a propósito — el asiento las
 * muestra con un aviso para que la contadora las mire, en vez de hacerlas
 * pasar por seguras.
 *
 * Las cuentas son de TRES dígitos (subcuenta), que es el detalle natural del
 * PCGE. La pantalla las agrupa a dos, que es el nivel con el que se trabaja.
 */
const M = (compra, porque, extra = {}) => ({ compra, venta: '701', porque, ...extra });
const SERVICIO = (compra, porque, extra = {}) => ({ compra, venta: '704', porque, ...extra });

export const CUENTA_POR_FAMILIA = {
  // ── Materiales que se incorporan a la obra → 602 Materias primas ──
  // El PCGE define la 602 como el costo de compra de los bienes que entran al
  // proceso productivo. En una constructora el proceso productivo es la obra,
  // así que el cemento, el fierro y la tubería son su materia prima.
  '02': M('602', 'Acero de construcción liso — se incorpora a la obra.'),
  '03': M('602', 'Acero de construcción corrugado — se incorpora a la obra.'),
  '04': M('602', 'Agregado fino.'),
  '05': M('602', 'Agregado grueso.'),
  '06': M('602', 'Alambre y cable de cobre desnudo.'),
  '07': M('602', 'Alambre y cable TW, THW, LSOH.'),
  '08': M('602', 'Alambre y cable WP, CPI.'),
  '09': M('602', 'Alcantarilla metálica y guardavías.'),
  '10': M('602', 'Aparato sanitario con grifería.'),
  '11': M('602', 'Artefacto de alumbrado exterior.'),
  '12': M('602', 'Artefacto de alumbrado interior.'),
  '13': M('602', 'Asfalto.'),
  '14': M('602', 'Baldosa acústica.'),
  '16': M('602', 'Baldosa vinílica y PVC.'),
  '17': M('602', 'Bloque y ladrillo.'),
  '18': M('602', 'Cable telefónico y de red.'),
  '19': M('602', 'Cable NYY, N2XY, NPT, N2XOH, N2XSY.'),
  '20': M('602', 'Cemento asfáltico.'),
  '21': M('602', 'Cemento Portland e hidráulico.'),
  '24': M('602', 'Cerámica y porcelanato.'),
  '26': M('602', 'Cerrajería.'),
  '27': M('602', 'Detonante.'),
  '28': M('602', 'Dinamita.'),
  '31': M('602', 'Prefabricado de concreto.'),
  '38': M('602', 'Hormigón y afirmado.'),
  '40': M('602', 'Loseta y terrazo.'),
  '41': M('602', 'Madera nacional en tiras para piso.'),
  '42': M('602', 'Madera importada para encofrado y carpintería.'),
  '43': M('602', 'Madera nacional para encofrado y carpintería.'),
  '44': M('602', 'Madera terciada nacional.'),
  '46': M('602', 'Malla de acero.'),
  '50': M('602', 'Marco y tapa de fierro.'),
  '51': M('602', 'Perfil de acero al carbono.'),
  '52': M('602', 'Perfil de aluminio.'),
  '54': M('602', 'Pintura látex.'),
  '55': M('602', 'Pintura temple.'),
  '56': M('602', 'Plancha de acero LAC.'),
  '57': M('602', 'Plancha de acero LAF.'),
  '59': M('602', 'Plancha de fibrocemento y yeso.'),
  '60': M('602', 'Plancha de poliuretano, poliestireno y termoaislante.'),
  '61': M('602', 'Plancha galvanizada.'),
  '62': M('602', 'Poste de concreto.'),
  '65': M('602', 'Tubería de acero negro y/o galvanizado.'),
  '66': M('602', 'Tubería de PVC para agua potable y alcantarillado.'),
  '68': M('602', 'Tubería de cobre.'),
  '71': M('602', 'Tubería de hierro fundido y dúctil.'),
  '72': M('602', 'Tubería de PVC para redes interiores.'),
  '77': M('602', 'Válvula de bronce y latón.'),
  '78': M('602', 'Válvula de hierro y acero.'),
  '79': M('602', 'Vidrio.'),
  '80': M('602', 'Concreto premezclado.'),
  '81': M('602', 'Aditivo de concreto — se incorpora a la mezcla.'),
  '82': M('602', 'Alambre y cable de aluminio.'),
  '84': M('602', 'Madera terciada importada.'),
  '85': M('602', 'Perfil de acero galvanizado.'),
  '86': M('602', 'Pintura esmalte y epóxica.'),
  '87': M('602', 'Plancha con cubierta aluzinc.'),
  '88': M('602', 'Plancha y cobertura plástica.'),
  '89': M('602', 'Poste y tubería de fibra de vidrio.'),
  '90': M('602', 'Tubería de polietileno.'),
  '91': M('602', 'Geomembrana y geotextil.'),

  // ── Auxiliares y consumibles → 603 ────────────────────────────
  // «Materiales auxiliares, suministros y repuestos»: no se incorporan a la
  // obra, se consumen produciéndola.
  '01': M('603', 'Aceite y lubricante — se consume, no se incorpora a la obra.'),
  '34': M('603', 'Gasohol y gasolina — combustible de obra.'),
  '53': M('603', 'Petróleo diésel — combustible de obra.'),
  '94': M('603', 'Encofrado y andamio prefabricado — auxiliar reutilizable, no queda en la obra.'),

  // ── Lo que el PCGE manda a 656 Suministros ────────────────────
  // El propio PDF lo dice en la descripción de la 656: «suministros
  // consumidos […] incluyendo aquellos que se consumen en labores de oficina,
  // las herramientas y equipos desechables, vestimenta, suministros de campo,
  // medicinas, y equipos no reconocidos como activos».
  '37': M('656', 'Herramienta manual — la 656 nombra expresamente las herramientas desechables.'),
  '83': M('656', 'EPP — la 656 nombra la vestimenta y los suministros de campo.'),
  '48': M('656', 'Equipo de construcción liviano — «equipos no reconocidos como activos» (656). Si es un activo, va por Activos Fijos.', { revisar: true }),
  '49': M('656', 'Equipo de construcción pesado. Comprarlo sería activo fijo (33) y alquilarlo un servicio (635): revisar de cuál se trata.', { revisar: true }),
  '95': M('656', 'Equipamiento permanente de obra — revisar si corresponde activarlo.', { revisar: true }),
  administrativos: M('656', 'Consumos de oficina — la 656 nombra lo que «se consume en labores de oficina».'),

  // ── Servicios de terceros → 63 ────────────────────────────────
  '32': SERVICIO('631', 'Flete terrestre — la 631 es «Transporte, correos y gastos de viaje».'),
  '33': SERVICIO('631', 'Flete aéreo.'),
  '92': SERVICIO('631', 'Flete fluvial.'),
  '93': SERVICIO('639', 'Bienes y servicios auxiliares — no encaja en ninguna subcuenta previa.'),
  '47': SERVICIO('638', 'Mano de obra facturada por un tercero: es un contratista, no la planilla propia (que va a 62).'),
  '47-1': SERVICIO('638', 'Mano de obra de alta especialización facturada por un tercero.'),

  S01: SERVICIO('635', 'Alquiler de local y vehículo — la 635 es arrendamiento operativo de muebles e inmuebles.'),
  S02: SERVICIO('635', 'Alquiler de maquinaria y equipo.'),
  S03: SERVICIO('631', 'Flete y transporte. ES EL CASO QUE REPORTARON LAS CONTADORAS: iba a la 60.'),
  S04: SERVICIO('624', 'Capacitación — el PCGE tiene subcuenta propia: «624 Capacitación», dentro de gastos de personal.'),
  S05: SERVICIO('632', 'Monitoreo ambiental — la 632 incluye expresamente la consultoría en materia medioambiental.'),
  S06: SERVICIO('639', 'Salud ocupacional: lo factura una clínica, así que es un servicio de terceros. El SCTR, que sí es contribución de ley, va a la 627.', { revisar: true }),
  S07: SERVICIO('632', 'Estudios, consultoría y supervisión.'),
  S08: SERVICIO('634', 'Mantenimiento y reparación — la 634 incluye el servicio y los repuestos usados.'),
  S09: SERVICIO('638', 'Subcontrato de obra — la 638 es «Servicios de contratistas».'),
  S10: SERVICIO('639', 'Personal contratado por servicio (recibo por honorarios): servicio de un tercero, no planilla.'),
  S11: SERVICIO('625', 'Alimentación y hospedaje del personal. La 625 «Atención al personal» nombra los almuerzos; si fue un VIAJE, corresponde la 631.', { revisar: true }),
  S12: SERVICIO('637', 'Gestión documental y publicaciones — la 637 cubre publicaciones y anuncios.'),
  S13: SERVICIO('636', 'Servicios básicos — la 636 es «energía, agua y comunicaciones».'),
  S14: SERVICIO('638', 'Ejecución de obra facturada por un tercero: es un contratista.'),
  servicios: SERVICIO('639', 'Servicio sin clasificar más fino — la 639 es el cajón del PCGE para lo que no entra en las anteriores.'),
};

/**
 * Las familias que NO se mapean a propósito.
 *
 * 30 y 39 son ÍNDICES DE PRECIOS del INEI (el dólar más inflación, el IPC), no
 * cosas que se compren: si el clasificador se los asigna a una descripción es
 * un falso positivo, y mandarlos a una cuenta sería asentar un error con cara
 * de dato. `sin_clasificar` es «no sé», y eso ya es una respuesta.
 */
export const FAMILIAS_SIN_CUENTA = new Set(['30', '39', 'sin_clasificar']);

/** Las cuentas a las que caen los movimientos cuya naturaleza no se pudo determinar. */
export const CUENTA_PROVISIONAL = {
  // Se elige por el tipo de operación, no por la naturaleza —que es justo lo
  // que no se sabe—, y SIEMPRE viaja con `provisional: true` para que el
  // asiento la muestre con aviso y la contadora la corrija. Es lo mismo que
  // hacía la app antes con todo; la diferencia es que ahora se ve cuáles son.
  compra: '602',
  venta: '704',
};

const norm = (f) => String(f ?? '').trim();

/**
 * La cuenta PCGE de una familia.
 *
 * @param {string} familia  código IUPC ('32'), de servicio ('S03') o complementario
 * @param {object} [opts]   { esVenta } — la misma familia va a otra cuenta si se vende
 * @returns {{cuenta:string, porque:string, revisar:boolean}|null}  null si no se puede decir
 */
export function cuentaDeFamilia(familia, { esVenta = false } = {}) {
  const f = norm(familia);
  if (!f || FAMILIAS_SIN_CUENTA.has(f)) return null;
  // Las reagrupaciones del IUPC (22→21, 45→44, …) valen acá igual que en el
  // resto de la app: no se duplica la tabla para los códigos absorbidos.
  const clave = CUENTA_POR_FAMILIA[f] ? f : (REAGRUPACIONES_IUPC[f] || f);
  const hit = CUENTA_POR_FAMILIA[clave];
  if (!hit) return null;
  const cuenta = esVenta ? hit.venta : hit.compra;
  if (!esCuentaValida(cuenta)) return null;   // red de seguridad contra una errata
  return { cuenta, porque: hit.porque, revisar: hit.revisar === true };
}

/** La cuenta de dos dígitos de una familia — el nivel con el que se trabaja. */
export function cuentaMadreDeFamilia(familia, opts) {
  const r = cuentaDeFamilia(familia, opts);
  return r ? cuentaMadreDe(r.cuenta)?.codigo || null : null;
}

/** ¿Está esta familia en la tabla? Sirve para auditar el vocabulario. */
export const familiaTieneCuenta = (familia) => !!cuentaDeFamilia(familia);

export default {
  CUENTA_POR_FAMILIA, FAMILIAS_SIN_CUENTA, CUENTA_PROVISIONAL,
  cuentaDeFamilia, cuentaMadreDeFamilia, familiaTieneCuenta,
};
