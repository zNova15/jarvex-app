// ═══════════════════════════════════════════════════════════════════
// JARVEX — GENERADOR DEL PCGE A PARTIR DEL PDF OFICIAL DEL MEF.
//
// Lee `VERSION_MODIFICADA_PCG_EMPRESARIAL.pdf` (Plan Contable General
// Empresarial, versión modificada — Consejo Normativo de Contabilidad) y
// escribe DOS librerías generadas:
//
//   src/lib/pcge-catalogo.js      — los 1.800+ códigos con su nombre y nivel.
//                                   Liviano a propósito: lo importa también el
//                                   generador de asientos, que corre en otro
//                                   chunk y no necesita el texto largo.
//   src/lib/pcge-descripciones.js — el contenido, la nomenclatura, la dinámica
//                                   debe/haber y los comentarios de cada
//                                   cuenta. Solo lo usa la pantalla.
//
// POR QUÉ UN GENERADOR Y NO UN ARCHIVO ESCRITO A MANO
// El PDF es la ley: si el MEF publica otra versión, se reemplaza el PDF y se
// corre esto. Tipear 1.800 códigos a mano garantiza erratas justo en lo que no
// se puede tener mal — y un dígito equivocado manda plata a otra cuenta.
//
// Uso:  node scripts/generar-pcge.mjs
// ═══════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PDF = path.join(RAIZ, 'VERSION_MODIFICADA_PCG_EMPRESARIAL.pdf');
const SALIDA_CATALOGO = path.join(RAIZ, 'src', 'lib', 'pcge-catalogo.js');
const SALIDA_DESCRIPCIONES = path.join(RAIZ, 'src', 'lib', 'pcge-descripciones.js');

// ── 1. PDF → texto por página ─────────────────────────────────────
async function leerPdf() {
  const url = 'file:///' + path.join(RAIZ, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs').replace(/\\/g, '/');
  const pdfjs = await import(url);
  const data = new Uint8Array(fs.readFileSync(PDF));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const ancho = page.getViewport({ scale: 1 }).width;
    const lineas = [];
    let cur = [], xs = [], lastY = null;
    // La X de cada línea importa: la DINÁMICA de cada cuenta es una tabla de
    // dos columnas («Es debitada por:» a la izquierda, «Es acreditada por:» a
    // la derecha) y sin la X los bullets de los dos lados se mezclan — que es
    // lo mismo que decir que una cuenta se debita por algo que la acredita.
    const cerrar = () => {
      if (!cur.length) return;
      lineas.push({ txt: cur.join('').replace(/\s+/g, ' ').trim(), x: Math.min(...xs), ancho });
      cur = []; xs = [];
    };
    for (const it of tc.items) {
      if (it.str === undefined) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 3) cerrar();
      cur.push(it.str); xs.push(it.transform[4]); lastY = y;
      if (it.hasEOL) { cerrar(); lastY = null; }
    }
    cerrar();
    paginas.push(lineas.filter(l => l.txt));
  }
  return paginas;
}

// Ruido de encabezado/pie que se repite en cada página del PDF.
const RUIDO = /^(PLAN CONTABLE GENERAL EMPRESARIAL|CATÁLOGO DE CUENTAS|CUADRO DE CLASIFICACIÓN|ORDENADO POR ELEMENTO|\d{1,3})$/;

// ── 2. El catálogo (páginas 20 a 71 del PDF) ──────────────────────
//
// Cada línea del catálogo es «CÓDIGO NOMBRE». El código tiene 2 a 5 dígitos y
// su largo ES el nivel: 2 = cuenta, 3 = subcuenta, 4 = divisionaria,
// 5 = sub-divisionaria. El elemento sale del primer dígito, salvo en las
// cuentas de orden (elemento «0», códigos 01…09).
const RE_CODIGO = /^(\d{2,5}) (.+)$/;
const RE_ELEMENTO = /^ELEMENTO\s*["“]?(\d)["”]?\s*:\s*(.+)$/i;
const RE_BLOQUE = /^CUENTAS DE ORDEN (DEUDORAS|ACREEDORAS)$/i;

const enMayusculas = (s) => s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(s);

/** ¿`sig` es la continuación de `nombre`, cortada por el ancho de la página? */
function esContinuacion(nombre, sig) {
  if (/[.:]$/.test(nombre)) return false;
  return enMayusculas(nombre) === enMayusculas(sig);
}

const reenganches = [];
const desalineados = [];

function parsearCatalogo(paginas) {
  const cuentas = [];
  let elemento = null;
  let elementoNombre = '';
  const vistos = new Set();

  for (let p = 19; p < Math.min(paginas.length, 71); p++) {
    const lineas = paginas[p].map(l => l.txt);   // el catálogo no necesita la X
    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i];
      if (!linea || RUIDO.test(linea)) continue;

      const el = linea.match(RE_ELEMENTO);
      if (el) {
        elemento = el[1];
        elementoNombre = limpiarElemento(el[2], lineas[i + 1]);
        continue;
      }
      // Los títulos de bloque de las cuentas de orden no traen código.
      if (RE_BLOQUE.test(linea)) continue;

      // El PDF tiene UN lugar donde la columna se desalinea y los códigos
      // quedan sueltos, con sus nombres en las líneas de abajo, en orden:
      //     4691 Subsidios gubernamentales / 4692 / 4699 /
      //     Donaciones condicionadas / Otras cuentas por pagar
      // Se emparejan por orden. Solo se toman códigos de 4 o 5 dígitos: los de
      // 2 y 3 sueltos son los NÚMEROS DE PÁGINA del PDF (llegan hasta 224).
      if (/^\d{4,5}$/.test(linea)) {
        const huerfanos = [];
        while (i < lineas.length && /^\d{4,5}$/.test(lineas[i])) huerfanos.push(lineas[i++]);
        for (const h of huerfanos) {
          while (i < lineas.length && (!lineas[i] || RUIDO.test(lineas[i]))) i++;
          const nom = lineas[i];
          if (!nom || RE_CODIGO.test(nom)) break;
          i++;
          if (vistos.has(h)) continue;
          vistos.add(h);
          desalineados.push(`${h} ${nom}`);
          cuentas.push(hacerCuenta(h, nom, elemento, elementoNombre));
        }
        i--;   // el for vuelve a incrementar
        continue;
      }

      const m = linea.match(RE_CODIGO);
      if (!m) continue;
      const codigo = m[1];
      let nombre = m[2].trim();

      // Un nombre largo puede seguir en la línea siguiente: el PDF corta por
      // ancho de página, no por sentido («14 CUENTAS POR COBRAR AL PERSONAL, A
      // LOS ACCIONISTAS (SOCIOS), DIRECTORES / Y GERENTES»).
      //
      // La pista que lo distingue de la línea siguiente legítima es el CASO:
      // la continuación viene siempre en el mismo caso que lo que continúa —
      // MAYÚSCULAS si es una cuenta, capitalizado si es una subcuenta— y nunca
      // empieza con un código. Todos los reenganches se listan al final para
      // poder revisarlos a ojo: son pocos y son justo los nombres que no se
      // pueden tener cortados.
      const sig = lineas[i + 1];
      if (sig && !RE_CODIGO.test(sig) && !RUIDO.test(sig) && !RE_ELEMENTO.test(sig)
          && !RE_BLOQUE.test(sig) && !/^\d+$/.test(sig) && esContinuacion(nombre, sig)) {
        nombre += ' ' + sig.trim();
        reenganches.push(`${codigo} ${nombre}`);
        i++;
      }

      if (vistos.has(codigo)) continue;   // el catálogo no repite códigos
      vistos.add(codigo);
      cuentas.push(hacerCuenta(codigo, nombre, elemento, elementoNombre));
    }
  }
  return cuentas;
}

function hacerCuenta(codigo, nombre, elemento, elementoNombre) {
  return {
    codigo,
    nombre: normalizarNombre(nombre),
    nivel: codigo.length - 1,            // 1=cuenta, 2=subcuenta, 3=divisionaria, 4=sub-div.
    elemento: elemento ?? codigo[0],
    elementoNombre,
    padre: codigo.length > 2 ? codigo.slice(0, -1) : null,
  };
}

// El nombre del elemento viene partido en dos líneas en varios casos
// («ELEMENTO 8: SALDOS INTERMEDIARIOS DE GESTIÓN Y / DETERMINACIÓN DEL…»).
function limpiarElemento(txt, siguiente) {
  let t = txt.trim();
  if (siguiente && !RE_CODIGO.test(siguiente) && !RUIDO.test(siguiente)
      && !RE_BLOQUE.test(siguiente) && esContinuacion(t, siguiente)) {
    t += ' ' + siguiente.trim();
  }
  return capitalizar(t.replace(/\s+/g, ' ').trim());
}

function capitalizar(s) {
  const t = String(s || '').trim();
  if (!t) return t;
  // Los títulos del PDF vienen en MAYÚSCULAS; en pantalla se leen mejor con
  // capitalización normal, pero se respeta lo que ya viene en minúsculas.
  if (t !== t.toUpperCase()) return t;
  return t.charAt(0) + t.slice(1).toLowerCase();
}

function normalizarNombre(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  // Las cuentas (2 dígitos) vienen en MAYÚSCULAS y las subcuentas no. Se
  // uniforma a capitalización de oración sin tocar siglas conocidas.
  if (t === t.toUpperCase() && t.length > 3) t = capitalizar(t);
  return t
    .replace(/\bIgv\b/g, 'IGV').replace(/\bIpm\b/g, 'IPM')
    .replace(/\bNiif\b/g, 'NIIF').replace(/\bNic\b/g, 'NIC')
    .replace(/\bEssalud\b/g, 'EsSalud').replace(/\bOnp\b/g, 'ONP')
    .replace(/\bAfp\b/g, 'AFP').replace(/\bCts\b/g, 'CTS')
    .replace(/\bSunat\b/g, 'SUNAT').replace(/\bDua\b/g, 'DUA')
    .replace(/\bIes\b/g, 'IES').replace(/\bItf\b/g, 'ITF');
}

// ── 3. La Parte III: descripción y dinámica de cada cuenta ────────
//
// Estructura regular por cuenta:
//   «NN NOMBRE» · CONTENIDO · NOMENCLATURA DE LAS SUBCUENTAS ·
//   (descripción de cada subcuenta) · DINÁMICA DE LA CUENTA NN ·
//   COMENTARIOS · NIIF e INTERPRETACIONES REFERIDAS
const SECCIONES = [
  ['contenido',   /^CONTENIDO$/i],
  ['nomenclatura', /^NOMENCLATURA DE LAS SUBCUENTAS$/i],
  ['dinamica',    /^DIN[ÁA]MICA DE LA CUENTA\b/i],
  ['comentarios', /^COMENTARIOS$/i],
  // El PDF alterna entre «NIIF e INTERPRETACIONES REFERIDAS:» y «NIIF e
  // INTERPRETACIONES:» — con la primera forma sola, la cuenta 60 quedaba sin
  // ninguna norma referida.
  ['niif',        /^NIIF e INTERPRETACIONES/i],
];

function parsearDescripciones(paginas, codigosValidos, nombresParteIII) {
  // La Parte III arranca donde termina el catálogo.
  const inicio = paginas.findIndex((lineas, i) =>
    i > 70 && lineas.some(l => /^PARTE III/i.test(l.txt)));
  const porCuenta = new Map();
  let actual = null;
  let seccion = null;

  for (let p = Math.max(inicio, 71); p < paginas.length; p++) {
    const lineasPag = paginas[p];
    for (let j = 0; j < lineasPag.length; j++) {
      const linea = lineasPag[j].txt;
      if (!linea || RUIDO.test(linea)) continue;
      if (/^PARTE IV/i.test(linea)) { p = paginas.length; break; }

      // ¿Empieza la descripción de otra cuenta?
      const enc = linea.match(/^(\d{2}) ([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 ,.\-–/()]{4,})$/);
      if (enc && codigosValidos.has(enc[1]) && enc[1].length === 2) {
        actual = enc[1];
        seccion = null;
        // El título de la Parte III está mejor acentuado que el del catálogo
        // (el catálogo trae «OTROS GASTOS DE GESTION» y «PERDIDA POR
        // MEDICIÓN»). Se guarda para corregir el nombre después.
        let titulo = enc[2].trim();
        const sig = lineasPag[j + 1]?.txt;
        if (sig && !RUIDO.test(sig) && !/^(CONTENIDO|NOMENCLATURA)/i.test(sig) && esContinuacion(titulo, sig)) {
          titulo += ' ' + sig.trim();
          j++;
        }
        if (!nombresParteIII.has(actual)) nombresParteIII.set(actual, titulo);
        if (!porCuenta.has(actual)) {
          porCuenta.set(actual, { contenido: [], nomenclatura: [], dinamica: [], comentarios: [], niif: [] });
        }
        continue;
      }
      if (!actual) continue;

      const sec = SECCIONES.find(([, re]) => re.test(linea));
      if (sec) { seccion = sec[0]; continue; }
      if (!seccion) continue;
      porCuenta.get(actual)[seccion].push(lineasPag[j]);
    }
  }

  // Los párrafos vienen cortados por ancho de página: se rejuntan en textos.
  const out = {};
  for (const [codigo, secs] of porCuenta) {
    const { subcuentas, notas } = descripcionesDeSubcuenta(secs.nomenclatura);
    out[codigo] = {
      // Las notas generales de la nomenclatura van con el contenido: en varias
      // cuentas (la 60, sin ir más lejos) el PDF no describe subcuenta por
      // subcuenta y toda la explicación vive en ese párrafo.
      contenido: [...unirParrafos(secs.contenido), ...notas],
      subcuentas,
      dinamica: partirDinamica(secs.dinamica),
      comentarios: unirParrafos(secs.comentarios),
      niif: unirVinetas(secs.niif),
    };
  }
  return out;
}

/**
 * Une líneas en párrafos: una línea que NO termina en punto continúa en la
 * siguiente. Es la única forma de recuperar los párrafos de un PDF de ancho
 * fijo. `corte` permite forzar un párrafo nuevo (ej. al empezar una viñeta o
 * un código de subcuenta), que es lo que evita que se peguen cosas distintas.
 */
function unirParrafos(lineas, corte = null) {
  const parrafos = [];
  let buf = '';
  const cerrar = () => { if (buf.trim()) parrafos.push(buf.trim()); buf = ''; };
  for (const l of lineas) {
    const t = typeof l === 'string' ? l : l.txt;
    if (!t) continue;
    if (corte && buf && corte(t, buf)) cerrar();
    buf = buf ? buf + ' ' + t : t;
    if (/[.:]$/.test(t)) cerrar();
  }
  cerrar();
  return parrafos.filter(p => p.length > 2);
}

/**
 * De la sección NOMENCLATURA salen DOS cosas: la lista seca de subcuentas
 * («631 Transporte, correos y gastos de viaje») y, más abajo, la descripción
 * larga de cada una («631 Transporte… Incluye los fletes relacionados con la
 * venta de mercaderías…»). Solo interesa la segunda: es la que dice QUÉ va en
 * cada subcuenta, y es lo que la contadora necesita leer para decidir.
 *
 * Cada código empieza párrafo nuevo — si no, la lista seca entera se pega
 * adelante de la primera descripción.
 */
const RE_SUBCUENTA = /^(\d{3,5}) (.+)$/;

function descripcionesDeSubcuenta(lineas) {
  // Dos cortes:
  //  · cada código empieza párrafo nuevo (si no, la lista seca entera se pega
  //    adelante de la primera descripción);
  //  · una entrada de lista seca se cierra apenas sigue algo que no es un
  //    código — así la nota general de la cuenta 60 («Las subcuentas 601 a 604
  //    acumulan el costo de compra…») no termina disfrazada de descripción de
  //    la 609.
  const corte = (t, buf) =>
    RE_SUBCUENTA.test(t) || (RE_SUBCUENTA.test(buf) && buf.length < 60 && !/[.:]$/.test(buf));

  const parrafos = unirParrafos(lineas, corte);
  const out = {};
  const notas = [];
  for (const p of parrafos) {
    const m = p.match(RE_SUBCUENTA);
    if (!m) {
      // Párrafo sin código: es una nota general sobre el grupo de subcuentas.
      if (p.length > 60) notas.push(p);
      continue;
    }
    const cuerpo = m[2].trim();
    // La lista seca es solo el nombre: es corta y no lleva punto.
    if (cuerpo.length < 60 || !/\./.test(cuerpo)) continue;
    const previo = out[m[1]];
    if (!previo || previo.length < cuerpo.length) out[m[1]] = cuerpo;
  }
  return { subcuentas: out, notas };
}

/**
 * La DINÁMICA es una tabla de dos columnas: a la izquierda por qué se DEBITA
 * la cuenta, a la derecha por qué se ACREDITA. En el texto plano las dos
 * columnas se intercalan y quedan indistinguibles — y un bullet leído del lado
 * equivocado dice exactamente lo contrario de lo que el PCGE manda.
 *
 * Se separan por la X: todo lo que arranca a la izquierda del medio de la
 * página es debe; lo demás, haber.
 */
function partirDinamica(lineas) {
  const debe = [], haber = [];
  for (const l of lineas) {
    const t = l.txt;
    if (!t || /^Es (debitada|acreditada) por/i.test(t)) continue;
    (l.x < l.ancho / 2 ? debe : haber).push(l);
  }
  const limpiar = (arr) => unirParrafos(arr, (t) => /^[•·]/.test(t))
    .map(p => p.replace(/^[•·]\s*/, '').trim())
    .filter(Boolean);
  return { debe: limpiar(debe), haber: limpiar(haber) };
}

/** Las referencias a NIIF vienen como viñetas «− …», partidas por ancho. */
function unirVinetas(lineas) {
  return unirParrafos(lineas, (t) => /^[−–-]\s/.test(t))
    .filter(p => /^[−–-]\s/.test(p))
    .map(p => p.replace(/^[−–-]\s*/, '').trim())
    .filter(p => p.length > 3);
}

// ── 4. Escritura ──────────────────────────────────────────────────
const CABECERA = `// ⚠️ ARCHIVO GENERADO — NO EDITAR A MANO.
// Lo produce \`node scripts/generar-pcge.mjs\` leyendo el PDF oficial
// \`VERSION_MODIFICADA_PCG_EMPRESARIAL.pdf\` (Plan Contable General Empresarial,
// versión modificada, Consejo Normativo de Contabilidad — MEF).
// Si hay que corregir algo, se corrige el generador o el PDF, no esto.
`;

function escribirCatalogo(cuentas, elementos) {
  const filas = cuentas.map(c =>
    `  ['${c.codigo}', ${JSON.stringify(c.nombre)}],`).join('\n');
  const els = Object.entries(elementos)
    .map(([k, v]) => `  '${k}': ${JSON.stringify(v)},`).join('\n');

  const js = `${CABECERA}
// Los ${cuentas.length} códigos del catálogo, en el orden del PDF.
// El LARGO del código es el nivel: 2 = cuenta, 3 = subcuenta,
// 4 = divisionaria, 5 = sub-divisionaria. El padre es el código sin su último
// dígito, así que no hace falta guardarlo.
export const PCGE_FILAS = [
${filas}
];

/** Nombre de cada elemento (primer dígito del código). */
export const PCGE_ELEMENTOS = {
${els}
};
`;
  fs.writeFileSync(SALIDA_CATALOGO, js, 'utf8');
  return js.length;
}

function escribirDescripciones(desc) {
  const js = `${CABECERA}
// Descripción y dinámica de cada cuenta (Parte III del PCGE).
//   contenido   — qué acumula la cuenta.
//   subcuentas  — qué va en cada subcuenta, con los ejemplos del propio PDF.
//   dinamica    — por qué se debita y por qué se acredita.
//   comentarios — las precisiones del Consejo Normativo.
//   niif        — las normas referidas.
export const PCGE_DESCRIPCIONES = ${JSON.stringify(desc, null, 1)};
`;
  fs.writeFileSync(SALIDA_DESCRIPCIONES, js, 'utf8');
  return js.length;
}

// ── Main ──────────────────────────────────────────────────────────
const paginas = await leerPdf();
const cuentas = parsearCatalogo(paginas);
const codigos = new Set(cuentas.map(c => c.codigo));
const elementos = {};
for (const c of cuentas) if (!elementos[c.elemento]) elementos[c.elemento] = c.elementoNombre;
const nombresParteIII = new Map();
const descripciones = parsearDescripciones(paginas, codigos, nombresParteIII);

// El catálogo (Parte II) tiene erratas de acentuación que la Parte III no
// tiene. Cuando las dos dicen lo mismo salvo tildes, manda la Parte III.
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const corregidos = [];
for (const c of cuentas) {
  const otro = nombresParteIII.get(c.codigo);
  if (!otro) continue;
  const bueno = normalizarNombre(otro);
  if (bueno !== c.nombre && sinTildes(bueno) === sinTildes(c.nombre)) {
    corregidos.push(`${c.codigo} ${c.nombre} → ${bueno}`);
    c.nombre = bueno;
  }
}

const bytesCat = escribirCatalogo(cuentas, elementos);
const bytesDesc = escribirDescripciones(descripciones);

const porNivel = {};
for (const c of cuentas) porNivel[c.nivel] = (porNivel[c.nivel] || 0) + 1;

console.log(`PCGE generado desde el PDF (${paginas.length} páginas)`);
console.log(`  cuentas totales : ${cuentas.length}`);
console.log(`  por nivel       : ${JSON.stringify(porNivel)}`);
console.log(`  elementos       : ${Object.keys(elementos).sort().join(' ')}`);
console.log(`  descripciones   : ${Object.keys(descripciones).length} cuentas`);
console.log(`  pcge-catalogo.js      ${(bytesCat / 1024).toFixed(1)} KB`);
console.log(`  pcge-descripciones.js ${(bytesDesc / 1024).toFixed(1)} KB`);
console.log(`\n  nombres reenganchados (${reenganches.length}) — revisar a ojo:`);
reenganches.forEach(r => console.log('    ', r));
console.log(`
  columnas desalineadas del PDF, emparejadas por orden (${desalineados.length}):`);
desalineados.forEach(r => console.log('    ', r));
console.log(`\n  tildes corregidas con la Parte III (${corregidos.length}):`);
corregidos.forEach(r => console.log('    ', r));
