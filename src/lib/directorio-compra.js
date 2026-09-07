// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL DIRECTORIO DE «A QUIÉN SE LE COMPRA» (tanda 8, entrega 1).
//
// EL PEDIDO (Gabriel, 6-set-2026, probando las órdenes en Miraflores):
//   «me gustaría que aquí podamos agregar, si estamos colocando un nuevo
//    proveedor o una empresa tercera, o incluso una nueva de nuestro grupo, el
//    RUC. Y por el RUC podamos identificarlo […] buscar rápidamente el RUC, si
//    es que me acuerdo, para emitir esta orden».
//
// LO QUE ESTABA MAL: la pantalla pedía PRIMERO decidir de qué clase es el
// destinatario —«escribirlo», «un proveedor ya cargado», «una empresa del
// grupo»— y recién después buscarlo, cada clase en su propio <select>. Eso
// invierte el orden real: la contadora sabe el RUC o el nombre; NO sabe (ni
// tiene por qué saber) si ese RUC ya está cargado como proveedor, si es una de
// nuestras ocho empresas, o si nunca se le compró. La clase es una RESPUESTA,
// no una pregunta.
//
// Acá se da vuelta: un solo buscador sobre TODO lo que la app ya sabe, y la
// clase sale del resultado que se elige. Si no aparece nada, entonces —y solo
// entonces— se escribe a mano, con el RUC que ya se tipeó.
//
// ── LAS TRES FUENTES, Y POR QUÉ LAS TRES ──────────────────────────
//   grupo     — `companies`. Son nuestras: al emitirles una orden queda en SU
//               buzón de órdenes recibidas (ver ordenes-recibidas.js).
//   proveedor — `proveedores`. El catálogo formal, 378 filas en producción.
//   tercero   — el RUC + nombre que quedó escrito en un comprobante de compra
//               y que NO está en ninguna de las dos listas de arriba. Es la
//               fuente más grande y la que nadie había expuesto: se le compró
//               de verdad, con papel, pero nunca se lo dio de alta.
//
// ── LA DEDUPLICACIÓN ES POR RUC, Y EL GRUPO GANA ──────────────────
// Un mismo RUC puede estar en las tres listas (nuestra empresa cargada además
// como proveedor porque alguien la tipeó al capturar una factura). Mostrarlo
// tres veces obliga a adivinar cuál elegir, y elegir mal rompe el buzón: una
// orden a «GASOMI (proveedor)» no le llega a GASOMI. Por eso gana el grupo,
// después el proveedor del catálogo, y último el tercero suelto.
//
// El RUC sin 11 dígitos NO deduplica: un proveedor sin RUC cargado no es «el
// mismo» que otro sin RUC. Ahí la clave es el nombre normalizado.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/directorio-compra.test.js
// ═══════════════════════════════════════════════════════════════════

import { rucLimpio } from './documento-dos-lados.js';
import { esCompraMov } from './costo-obra.js';

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);

/** Texto comparable: sin tildes, sin puntuación, en minúsculas y colapsado. */
export function normNombre(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Solo los dígitos de lo que se haya tipeado. '20 512 345 678' → '20512345678' */
export const soloDigitos = (s) => String(s || '').replace(/\D/g, '');

/**
 * ¿Esto que tipeó la persona parece un RUC?
 *
 * 11 dígitos y prefijo 10/15/17/20 — los cuatro que SUNAT emite. No validamos
 * el dígito verificador: rechazar un RUC real por un módulo 11 mal aplicado es
 * peor que aceptar uno tipeado con un dedo de más, que la persona ve en
 * pantalla. Se usa solo para DECIDIR SI OFRECER dar de alta, nunca para
 * bloquear la emisión.
 */
export function pareceRuc(s) {
  const d = soloDigitos(s);
  return d.length === 11 && ['10', '15', '17', '20'].includes(d.slice(0, 2));
}

/** Lo que se tipeó, ¿es una búsqueda por número? (3+ dígitos y nada más) */
export function esBusquedaPorRuc(texto) {
  const t = String(texto || '').trim();
  return t.length >= 3 && /^[\d\s.-]+$/.test(t);
}

const PRIORIDAD = { grupo: 0, proveedor: 1, tercero: 2 };

/**
 * El directorio completo de posibles destinatarios de una orden.
 *
 * @param opts.companies      catálogo de empresas del grupo
 * @param opts.proveedores    catálogo de proveedores
 * @param opts.movs           accounting_movements (para los terceros con papel)
 * @param opts.excluirCompanyId  la empresa que EMITE: nadie se compra a sí mismo
 * @returns [{ clave, tipo, companyId, proveedorId, nombre, ruc, direccion, veces, ultimaFecha }]
 */
export function directorioDeCompra({
  companies = [], proveedores = [], movs = [], excluirCompanyId = null,
} = {}) {
  // clave de dedupe → candidato
  const porClave = new Map();
  const claveDe = (ruc, nombre) => (ruc ? `r:${ruc}` : `n:${normNombre(nombre)}`);

  const poner = (cand) => {
    const k = claveDe(cand.ruc, cand.nombre);
    if (!k || k === 'n:') return;
    const previo = porClave.get(k);
    if (!previo) { porClave.set(k, { ...cand, clave: k }); return; }
    // Gana el de mayor jerarquía; el otro solo aporta lo que al ganador le falte.
    if (PRIORIDAD[cand.tipo] < PRIORIDAD[previo.tipo]) {
      porClave.set(k, {
        ...cand, clave: k,
        proveedorId: cand.proveedorId || previo.proveedorId,
        direccion: cand.direccion || previo.direccion,
        veces: previo.veces + cand.veces,
        ultimaFecha: previo.ultimaFecha > cand.ultimaFecha ? previo.ultimaFecha : cand.ultimaFecha,
      });
    } else {
      previo.proveedorId = previo.proveedorId || cand.proveedorId;
      previo.companyId = previo.companyId || cand.companyId;
      previo.direccion = previo.direccion || cand.direccion;
      previo.veces += cand.veces;
      if (cand.ultimaFecha > previo.ultimaFecha) previo.ultimaFecha = cand.ultimaFecha;
    }
  };

  for (const c of vivos(companies)) {
    if (excluirCompanyId && c.id === excluirCompanyId) continue;
    poner({
      tipo: 'grupo', companyId: c.id, proveedorId: null,
      nombre: c.name || c.legal_name || '(sin nombre)',
      razonSocial: c.legal_name || c.name || '',
      ruc: rucLimpio(c.ruc), direccion: c.address || '',
      veces: 0, ultimaFecha: '',
    });
  }

  for (const p of vivos(proveedores)) {
    if (p.estado === 'inactivo') continue;
    poner({
      tipo: 'proveedor', companyId: null, proveedorId: p.id,
      nombre: p.razon_social || p.nombre || '(sin nombre)',
      razonSocial: p.razon_social || p.nombre || '',
      ruc: rucLimpio(p.ruc), direccion: p.direccion || '',
      veces: 0, ultimaFecha: '',
    });
  }

  // Los terceros con papel. Solo COMPRAS: en una venta el tercero es el
  // CLIENTE, y a un cliente no se le emite una orden de compra.
  for (const m of vivos(movs)) {
    if (m.payment_status === 'cancelled') continue;
    if (!esCompraMov(m)) continue;
    const nombre = String(m.third_party_name || '').trim();
    const ruc = rucLimpio(m.third_party_ruc);
    if (!nombre && !ruc) continue;
    poner({
      tipo: 'tercero', companyId: null, proveedorId: m.proveedor_id || null,
      nombre: nombre || ruc, razonSocial: nombre || '',
      ruc, direccion: '',
      veces: 1, ultimaFecha: String(m.date || ''),
    });
  }

  return [...porClave.values()];
}

/**
 * Relevancia de un candidato contra lo que se tipeó.
 *
 * El RUC se compara aparte y pesa MÁS que el nombre: si alguien escribe once
 * dígitos está diciendo exactamente a quién quiere, y un nombre que por
 * casualidad contenga ese número no puede ganarle.
 *
 * @returns número (0 = no coincide)
 */
function puntaje(cand, { digitos, tokens }) {
  let p = 0;
  if (digitos) {
    if (!cand.ruc) return 0;
    if (cand.ruc === digitos) p += 1000;
    else if (cand.ruc.startsWith(digitos)) p += 600;
    else if (cand.ruc.includes(digitos)) p += 300;
    else return 0;
    return p;
  }
  if (!tokens.length) return 1;
  const heno = normNombre(`${cand.nombre} ${cand.razonSocial || ''}`);
  for (const t of tokens) {
    if (!heno.includes(t)) return 0;           // TODOS los tokens, como el resto de la app
    p += heno.startsWith(t) ? 40 : 20;
    // Un token que arranca palabra vale más que uno en el medio: «inca»
    // debería traer CONSORCIO EL INCA antes que FERRETERIA VINCADO.
    if (new RegExp(`(^| )${t}`).test(heno)) p += 15;
  }
  return p;
}

/**
 * Busca en el directorio por RUC o por razón social.
 *
 * Sin texto devuelve los más usados (los que tienen papel), que es lo que
 * sirve al abrir el formulario: los de siempre arriba.
 */
export function buscarDestinatario(directorio = [], texto = '', { limite = 12 } = {}) {
  const t = String(texto || '').trim();
  const porRuc = esBusquedaPorRuc(t);
  const digitos = porRuc ? soloDigitos(t) : '';
  const tokens = porRuc ? [] : normNombre(t).split(' ').filter(Boolean);

  const out = [];
  for (const c of directorio) {
    const p = puntaje(c, { digitos, tokens });
    if (p === 0) continue;
    out.push({ ...c, puntaje: p });
  }
  out.sort((a, b) =>
    b.puntaje - a.puntaje
    || PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo]
    || b.veces - a.veces
    || String(a.nombre).localeCompare(String(b.nombre)));
  return out.slice(0, limite);
}

/**
 * ¿Ese RUC ya está en el directorio? Devuelve el candidato o null.
 *
 * Es la pregunta que hace la pantalla antes de dejar dar de alta a alguien:
 * emitir dos órdenes al mismo RUC bajo dos nombres distintos es exactamente el
 * lío que después hay que fusionar a mano.
 */
export function porRucExacto(directorio = [], ruc) {
  const d = soloDigitos(ruc);
  if (d.length !== 11) return null;
  return directorio.find(c => c.ruc === d) || null;
}

const ETIQUETA = { grupo: 'Empresa del grupo', proveedor: 'Proveedor del catálogo', tercero: 'Ya le compramos' };
export const etiquetaTipo = (tipo) => ETIQUETA[tipo] || '';

/**
 * El candidato elegido, llevado a los campos que guarda la orden.
 *
 * `companyId` es el que habilita el buzón: una orden a una empresa del grupo
 * tiene que saber A CUÁL, y hasta la mig 186 solo se guardaba el nombre.
 */
export function destinatarioDeCandidato(cand) {
  if (!cand) return { modo: 'nuevo', companyId: null, proveedorId: null, nombre: '', ruc: '', direccion: '' };
  return {
    modo: cand.tipo,
    companyId: cand.companyId || null,
    proveedorId: cand.proveedorId || null,
    nombre: cand.razonSocial || cand.nombre || '',
    ruc: cand.ruc || '',
    direccion: cand.direccion || '',
  };
}
