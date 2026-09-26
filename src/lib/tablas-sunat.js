// ═══════════════════════════════════════════════════════════════════
// JARVEX — TABLAS OFICIALES DE SUNAT que usan los registros y los PLE.
//
// Tanda 4 de contabilidad (pedido de las contadoras, 17-set-2026): el Registro
// de Compras y el de Ventas se llevan con el formato del Excel modelo
// (`Modelos/ejemplrvrc.xlsx`), y ese formato NO pide el nombre del documento:
// pide su CÓDIGO. Las tres columnas que lo dicen son, textualmente:
//   · «TIPO (TABLA 10)»  → tipo de comprobante de pago o documento
//   · «TIPO (TABLA 2)»   → tipo de documento de identidad del proveedor/cliente
//   · «SERIE DEL COMP. DE PAGO O CÓDIGO DE LA DEPENDENCIA ADUANERA (TABLA 11)»
//
// ── POR QUÉ VIVEN ACÁ Y NO EN CADA PANTALLA ────────────────────────
// Los códigos ya estaban, pero adentro de `sunat-ple.js`, privados, y solo
// con los siete que ese archivo necesitaba. El Registro de Compras necesita
// los mismos: si se copiaban, el día que alguien agregue el boleto aéreo
// (tipo 05, tanda 6) lo agregaría en un lado y el otro seguiría diciendo '00'.
// `sunat-ple.js` los importa de acá, así que la definición es UNA.
//
// ── LO QUE VIAJA Y LO QUE NO ───────────────────────────────────────
// Tabla 10 y Tabla 2 viajan completas para lo que el grupo emite y recibe.
// La Tabla 11 (dependencias aduaneras) NO trae los nombres de las 40 y pico
// aduanas: el grupo no importa —cero DUAs en producción— y escribir de memoria
// un catálogo de códigos que después alguien declara sería peor que no
// tenerlo. Lo que sí se hace es saber CUÁNDO esa columna lleva un código de
// aduana en vez de una serie, y validarle la forma. Si algún día entra una
// importación, el código se copia del documento y se agrega el nombre acá.
// ═══════════════════════════════════════════════════════════════════

/**
 * TABLA 10 — Tipo de Comprobante de Pago o Documento.
 *
 * Solo los que el grupo usa o puede llegar a usar. Agregar uno nuevo exige
 * mirar el Anexo de la SUNAT: un código inventado entra al PLE sin chistar y
 * lo rechaza SUNAT, no la app.
 */
export const TABLA_10 = Object.freeze([
  { codigo: '00', nombre: 'Otros comprobantes no considerados en esta tabla' },
  { codigo: '01', nombre: 'Factura' },
  { codigo: '02', nombre: 'Recibo por honorarios' },
  { codigo: '03', nombre: 'Boleta de venta' },
  { codigo: '04', nombre: 'Liquidación de compra' },
  { codigo: '05', nombre: 'Boleto de compañía de aviación comercial por el servicio de transporte aéreo de pasajeros' },
  { codigo: '06', nombre: 'Carta de porte aéreo por el servicio de transporte de carga aérea' },
  { codigo: '07', nombre: 'Nota de crédito' },
  { codigo: '08', nombre: 'Nota de débito' },
  { codigo: '09', nombre: 'Guía de remisión – Remitente' },
  { codigo: '10', nombre: 'Recibo por arrendamiento' },
  { codigo: '12', nombre: 'Ticket o cinta emitido por máquina registradora' },
  { codigo: '13', nombre: 'Documento emitido por bancos, instituciones financieras, crediticias y de seguros supervisadas por la SBS' },
  { codigo: '14', nombre: 'Recibo por servicios públicos (energía eléctrica, agua, teléfono, telex y telegráficos)' },
  { codigo: '50', nombre: 'Declaración Única de Aduanas – Importación definitiva' },
  { codigo: '52', nombre: 'Despacho simplificado – Importación simplificada' },
  { codigo: '91', nombre: 'Comprobante de no domiciliado' },
  { codigo: '97', nombre: 'Nota de crédito – No domiciliado' },
  { codigo: '98', nombre: 'Nota de débito – No domiciliado' },
]);

/** TABLA 2 — Tipo de documento de identidad del proveedor o del cliente. */
export const TABLA_2 = Object.freeze([
  { codigo: '0', nombre: 'Doc. Trib. no domiciliado sin RUC' },
  { codigo: '1', nombre: 'DNI / Libreta electoral' },
  { codigo: '4', nombre: 'Carnet de extranjería' },
  { codigo: '6', nombre: 'RUC' },
  { codigo: '7', nombre: 'Pasaporte' },
  { codigo: 'A', nombre: 'Cédula diplomática de identidad' },
]);

const T10 = new Map(TABLA_10.map(t => [t.codigo, t.nombre]));
const T2 = new Map(TABLA_2.map(t => [t.codigo, t.nombre]));

/** Nombre oficial de un código de la Tabla 10 ('' si no está en la tabla). */
export function nombreTabla10(codigo) {
  return T10.get(String(codigo || '').padStart(2, '0')) || '';
}

/** Nombre oficial de un código de la Tabla 2. */
export function nombreTabla2(codigo) {
  return T2.get(String(codigo || '').toUpperCase()) || '';
}

/**
 * Código de Tabla 10 del comprobante de un movimiento.
 *
 * Se decide por `document_type`, que en producción tiene cuatro valores
 * ('factura' 1.710, 'nota_credito' 28, 'recibo' 3, 'boleta' 1) y es el campo
 * que la captura llena de verdad. Si viniera vacío, se intenta con el número
 * del documento (una serie 'F001-…' es una factura, 'B004-…' una boleta), y si
 * eso tampoco alcanza se devuelve el fallback — nunca se adivina un código
 * plausible: un '01' inventado sobre un recibo por honorarios le declara a
 * SUNAT un crédito fiscal que no existe.
 *
 * @param {object|string} movOrTipo movimiento, o el `document_type` suelto
 * @param {string} fallback qué devolver cuando no se reconoce (por defecto '00' Otros)
 */
export function tipoComprobante(movOrTipo, fallback = '00') {
  // Un string suelto puede ser el tipo ('factura') o el documento
  // ('F001-00012345'): el Libro Diario le pasa lo segundo. Se prueba como los
  // dos antes de rendirse.
  const mov = typeof movOrTipo === 'string'
    ? { document_type: movOrTipo, document_number: movOrTipo }
    : (movOrTipo || {});
  const tipo = String(mov.document_type || '').toLowerCase().trim();

  if (tipo) {
    if (/nota.*cr[eé]d|^nc$/.test(tipo)) return '07';
    if (/nota.*d[eé]b|^nd$/.test(tipo)) return '08';
    // El recibo por honorarios va ANTES que el genérico 'recibo': los tres que
    // hay en producción se cargaron como 'recibo' con categoría «Recibo
    // Honorarios», y son eso.
    if (/honorar|^rh$/.test(tipo)) return '02';
    if (/arrendamiento/.test(tipo)) return '10';
    if (/servicios?.?p[uú]blicos|recibo.?(luz|agua|tel)/.test(tipo)) return '14';
    if (/^recibo/.test(tipo)) return reciboEsHonorarios(mov) ? '02' : '00';
    if (/factura/.test(tipo)) return '01';
    if (/boleta/.test(tipo)) return '03';
    if (/liquidaci/.test(tipo)) return '04';
    if (/boleto.?(a[eé]reo|avi)/.test(tipo)) return '05';
    if (/ticket/.test(tipo)) return '12';
    if (/gu[ií]a/.test(tipo)) return '09';
    if (/dua|importaci/.test(tipo)) return '50';
  }

  // Sin tipo: la serie del documento suele decirlo.
  const num = String(mov.document_number || '').toUpperCase().trim();
  if (/^[EF]\w*\d*-/.test(num) || /^F\d/.test(num)) return '01';
  if (/^B\d/.test(num)) return '03';

  return fallback;
}

/**
 * ¿Ese 'recibo' es un recibo por HONORARIOS?
 *
 * Marcador propio, pedido de Gabriel para la tanda 4. Se reconoce por tres
 * señales, y basta una: lo dice la categoría («Recibo Honorarios», que es
 * exactamente lo que tienen los tres de producción), lo dice el tipo, o el
 * emisor es una persona natural (RUC que arranca en 10 o en 15) — una empresa
 * no puede emitir un recibo por honorarios, y una persona natural con negocio
 * que emite factura ya cayó en la rama de factura antes de llegar acá.
 */
export function reciboEsHonorarios(mov) {
  const m = mov || {};
  const cat = String(m.category || '').toLowerCase();
  const tipo = String(m.document_type || '').toLowerCase();
  if (/honorar/.test(cat) || /honorar/.test(tipo)) return true;
  const ruc = String(m.third_party_ruc || '').replace(/\D/g, '');
  return /^recibo/.test(tipo) && ruc.length === 11 && (ruc.startsWith('10') || ruc.startsWith('15'));
}

/** ¿Es un recibo por honorarios? (el marcador que usan las dos pantallas). */
export function esReciboHonorarios(mov) {
  return tipoComprobante(mov) === '02';
}

/**
 * Código de Tabla 2 del documento de identidad, deducido del NÚMERO.
 *
 * Es más confiable que cualquier campo de tipo: 11 dígitos es RUC, 8 es DNI.
 * En producción los 1.742 movimientos tienen los 11 dígitos, así que esto
 * devuelve '6' en todos — pero los recibos por honorarios de personas y los
 * proveedores extranjeros no van a tenerlo.
 */
export function tipoDocIdentidad(numeroOTipo) {
  const s = String(numeroOTipo || '').trim();
  if (!s) return '0';
  const k = s.toUpperCase();
  if (k === 'RUC') return '6';
  if (k === 'DNI' || k === 'LE') return '1';
  if (k === 'CE' || k === 'CARNET') return '4';
  if (k === 'PAS' || k === 'PASAPORTE') return '7';
  const d = s.replace(/\D/g, '');
  if (d.length === 11) return '6';
  if (d.length === 8) return '1';
  if (d.length === 9) return '4';   // carnet de extranjería
  if (!d) return '7';               // alfanumérico → pasaporte
  return '0';
}

/**
 * Serie y número de un comprobante: 'F001-00012345' → { serie:'F001', numero:'00012345' }.
 *
 * El registro los pide en columnas separadas, y hay que respetar los ceros de
 * la izquierda del número: SUNAT coteja el correlativo tal como está impreso.
 */
export function partirComprobante(doc) {
  if (!doc) return { serie: '', numero: '' };
  const s = String(doc).trim().toUpperCase();
  const m = s.match(/^([A-Z0-9]+)[\s\-/]+(\d+)$/);
  if (m) return { serie: m[1], numero: m[2] };
  return { serie: '', numero: s.replace(/\s+/g, '') };
}

/**
 * El CAR (Código de Anotación de Registro) de un comprobante: la llave con la
 * que SUNAT identifica cada fila del RVIE y del RCE (tabla 7 del Anexo 1 de la
 * R.S. 112-2021). Son 27 caracteres: RUC del EMISOR (11) + tipo (2) + serie
 * (4) + número a 10 dígitos. Lo dice la propia propuesta de SUNAT: la factura
 * E001-1 de JARVEX a EL INCA trae `2061564650501E0010000000001`.
 *
 * Es el «dato estructurado» (campo 20) del Libro Diario de quien lleva el
 * registro en el SIRE. Devuelve '' cuando no se puede armar con certeza (serie
 * que no es de 4, número no numérico o de más de 10 dígitos): un CAR
 * inventado no enlaza con nada y el validador lo rechaza.
 */
export function carDeComprobante({ rucEmisor, tipo, serie, numero } = {}) {
  const ruc = String(rucEmisor || '').replace(/\D/g, '');
  const t = String(tipo || '').padStart(2, '0');
  const s = String(serie || '').trim().toUpperCase();
  const n = String(numero || '').trim();
  if (ruc.length !== 11 || !/^\d{2}$/.test(t) || t === '00') return '';
  if (!/^[A-Z0-9]{4}$/.test(s)) return '';
  if (!/^\d{1,10}$/.test(n) || !Number(n)) return '';
  return `${ruc}${t}${s}${n.padStart(10, '0')}`;
}

/**
 * ¿La columna «serie o dependencia aduanera» lleva un código de la Tabla 11?
 *
 * Sí solo en las importaciones (DUA 50 y despacho simplificado 52): ahí SUNAT
 * pide el código de 3 dígitos de la aduana en vez de la serie del documento.
 */
export function usaDependenciaAduanera(mov) {
  return ['50', '52'].includes(tipoComprobante(mov));
}

/**
 * Valida la FORMA de un código de dependencia aduanera (Tabla 11): 3 dígitos.
 *
 * No se valida contra un catálogo porque el catálogo no viaja (ver el
 * encabezado): el grupo no importa y un listado escrito de memoria sería
 * peor que ninguno. Lo que se evita acá es que una serie 'F001' termine en la
 * columna de la aduana.
 */
export function esDependenciaAduaneraValida(codigo) {
  return /^\d{3}$/.test(String(codigo || '').trim());
}

export default {
  TABLA_10, TABLA_2,
  nombreTabla10, nombreTabla2,
  tipoComprobante, tipoDocIdentidad, partirComprobante, carDeComprobante,
  esReciboHonorarios, reciboEsHonorarios,
  usaDependenciaAduanera, esDependenciaAduaneraValida,
};
