// ═══════════════════════════════════════════════════════════════════
// JARVEX — LEER LAS MISMAS BASES DOS VECES Y COMPARAR (tanda 15, entrega 11).
//
// EL PROBLEMA QUE ESTO MIDE. La misma lectura del mismo documento no devuelve
// siempre lo mismo. El pedido va con `temperature: 0` desde el principio (ver
// lib/openrouter.js), pero eso NO alcanza para que sea reproducible:
//
//   · La cadena `models: [titular, ...respaldos]` con `allow_fallbacks: true`
//     hace que una corrida la atienda un modelo y la siguiente otro. Por eso
//     cada pasada devuelve `model`, y por eso se guarda: cuando una extracción
//     sale mal hay que saber quién la hizo.
//   · Aun con el MISMO modelo, un gratuito servido por dos proveedores
//     distintos —distinta cuantización, distinto tamaño de lote— no da bit a
//     bit lo mismo. `temperature: 0` quita la ruleta del muestreo, no la del
//     hardware.
//   · El barrido de respaldo solo se dispara SI la lectura dirigida no
//     encontró nada, así que una corrida puede recorrer el documento entero y
//     la siguiente no.
//
// La consecuencia práctica la vio Gabriel: leer las mismas bases dos veces y
// que salgan siete puestos una vez y seis la otra. Sin una segunda lectura no
// hay forma de saber CUÁL de los dos números creerse.
//
// POR QUÉ SE PUEDE HACER. El escaneo —lo único que cuesta plata— ya está
// pagado y guardado (lib/cache-lectura.js): la segunda corrida reusa el mismo
// markdown y solo repite las pasadas de IA, que van a modelos gratuitos. Dos
// lecturas cuestan lo mismo que una: el doble de espera y USD 0 más.
//
// 🔴 LO QUE NO SE HACE: DESCARTAR LO QUE SALIÓ UNA SOLA VEZ. La regla del
// módulo es la misma de siempre —perder un requisito cuesta la postulación, y
// mostrar uno de más cuesta una mirada— así que el resultado es la UNIÓN de
// las dos corridas, no la intersección. Lo que cambia es que cada hallazgo
// dice EN CUÁNTAS LECTURAS SALIÓ, y la pantalla lo muestra. Un requisito que
// salió en las dos es un requisito; uno que salió en una es un requisito que
// hay que ir a mirar al documento.
//
// La identidad de un hallazgo es su CITA normalizada, la misma huella que ya
// usa el dedup de `analizar` — es lo único que no cambia entre una pasada y
// la otra, porque es texto copiado del documento y no algo que el modelo
// redacte.
// ═══════════════════════════════════════════════════════════════════

import { normalizar } from './bases-extraccion.js';

/** Cuántas veces se lee como máximo. Tres lecturas son tres esperas: a partir
 *  de ahí lo que hay que hacer es abrir el documento. */
export const MAX_CORRIDAS = 3;

/**
 * La huella de un hallazgo: su cita, normalizada.
 *
 * Cae a la descripción o al cargo cuando no hay cita, que es el caso de un
 * dato que el verificador ya marcó como no comprobable. Ese cae igual bajo la
 * misma regla: si las dos corridas lo inventaron igual, sigue sin estar en el
 * documento — pero al menos no es ruido de una sola lectura.
 */
export function huellaDeHallazgo(x = {}) {
  const base = x.fuente_cita || x.descripcion || x.detalle || x.cargo || x.etapa || x.documento || '';
  return normalizar(String(base)).slice(0, 140);
}

/**
 * Une varias listas de hallazgos marcando en cuántas salió cada uno.
 *
 * Devuelve la lista de la PRIMERA corrida en su orden original, y detrás lo
 * que solo apareció en las siguientes. El orden importa: los requisitos van
 * numerados por el orden en que aparecen en las bases, y la primera corrida es
 * la que lo tiene bien.
 */
export function unirListas(listas, huella = huellaDeHallazgo) {
  const total = listas.length;
  const porHuella = new Map();
  listas.forEach((lista, i) => {
    for (const x of (Array.isArray(lista) ? lista : [])) {
      const h = huella(x);
      if (!h) continue;
      const ya = porHuella.get(h);
      if (ya) { ya._en.add(i); continue; }
      porHuella.set(h, { valor: x, _en: new Set([i]) });
    }
  });
  return [...porHuella.values()].map(({ valor, _en }) => ({
    ...valor,
    // En cuántas lecturas salió y cuántas hubo. Las dos, porque la fila las
    // muestra («1 de 2») y una sola no alcanza para escribir esa frase.
    _corridas: _en.size,
    _deCorridas: total,
    _deTodas: _en.size === total,
    // En cuál salió, por si algún día hace falta decir «solo en la segunda».
    _corridasEn: [..._en].map(i => i + 1),
  }));
}

/**
 * Los campos de cabecera en los que las corridas NO se pusieron de acuerdo.
 *
 * Es el dato más caro de la lectura —el valor referencial, el plazo, el CUI—
 * y el que menos se revisa, porque llega prellenado en un formulario. Que dos
 * lecturas del mismo documento devuelvan dos montos distintos es exactamente
 * lo que hay que avisar antes de que alguien lo guarde.
 */
export function cabecerasQueNoCoinciden(cabeceras) {
  const claves = new Set();
  for (const c of cabeceras) for (const k of Object.keys(c || {})) claves.add(k);
  const discrepan = [];
  for (const k of claves) {
    const vistos = new Set();
    for (const c of cabeceras) {
      const v = c?.[k];
      if (v == null || v === '') continue;      // «no lo encontré» no discrepa
      vistos.add(typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    if (vistos.size > 1) discrepan.push({ campo: k, valores: [...vistos] });
  }
  return discrepan;
}

/** La cabecera fundida: el primer valor no vacío de cada campo, corrida por
 *  corrida. La primera lectura manda; las siguientes solo llenan huecos. */
export function fundirCabeceras(cabeceras) {
  const out = {};
  for (const c of cabeceras) {
    if (!c || typeof c !== 'object') continue;
    for (const [k, v] of Object.entries(c)) {
      if (v == null || v === '') continue;
      if (out[k] == null || out[k] === '') out[k] = v;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Cuántos hallazgos salieron en TODAS las lecturas. Es el número que contesta
 *  «¿cuánto me puedo fiar de esta lectura?». */
export function estabilidadDe(listas) {
  const todos = listas.flat();
  const total = todos.length;
  const estables = todos.filter(x => x._deTodas).length;
  return {
    total,
    estables,
    inestables: total - estables,
    // Sin hallazgos no hay nada que medir: 100 sería mentir, 0 también.
    pct: total > 0 ? Math.round((estables / total) * 100) : null,
  };
}

const LISTAS_EXTRA = ['factores_evaluacion', 'garantias', 'penalidades', 'documentos_presentacion', 'condiciones'];

/**
 * Funde varias corridas de `analizar()` en un solo resultado con la misma
 * forma, para que la pantalla no tenga que saber cuántas lecturas hubo.
 *
 * Se apoya en la PRIMERA corrida: de ahí salen el markdown, el índice, el
 * régimen y las páginas leídas, que son cosas del documento y no del modelo, y
 * de ahí sale también lo que la caché necesita guardar.
 */
export function fusionarCorridas(corridas) {
  const lista = (Array.isArray(corridas) ? corridas : []).filter(Boolean);
  if (lista.length === 0) return null;
  if (lista.length === 1) return lista[0];
  const base = lista[0];

  const filas = unirListas(lista.map(r => r.filas || []));
  const filasEmpresa = unirListas(lista.map(r => r.filasEmpresa || []));
  // El calendario se identifica por etapa + fecha de inicio, que es la misma
  // llave con la que `aCronograma` ya deduplica, y se reordena: la unión mete
  // al final lo que solo salió en la segunda lectura y una fecha fuera de
  // orden en un calendario se lee como un error.
  const cronograma = unirListas(
    lista.map(r => r.cronograma || []),
    (e) => normalizar(`${e.etapa || ''}|${e.desde || ''}`).slice(0, 140),
  ).sort((a, b) => String(a.desde || '').localeCompare(String(b.desde || '')));

  const extras = {};
  for (const k of LISTAS_EXTRA) extras[k] = unirListas(lista.map(r => r.extras?.[k] || []));

  const cabeceras = lista.map(r => r.cabecera).filter(Boolean);
  const discrepan = cabecerasQueNoCoinciden(cabeceras);

  // La estabilidad se mide sobre lo que la persona va a guardar: requisitos,
  // calendario y las listas del contrato. No sobre las alertas.
  const estabilidad = estabilidadDe([filas, filasEmpresa, cronograma, ...LISTAS_EXTRA.map(k => extras[k])]);

  const alertas = [...new Set(lista.flatMap(r => r.alertas || []))];
  if (estabilidad.inestables > 0) {
    alertas.unshift(`Se leyó el documento ${lista.length} veces y ${estabilidad.inestables} de ${estabilidad.total} hallazgos salieron en solo una de las lecturas. Están marcados con «1 de ${lista.length}»: revísalos contra el documento antes de guardarlos.`);
  }
  for (const d of discrepan) {
    alertas.unshift(`Las ${lista.length} lecturas no coinciden en «${d.campo}»: ${d.valores.slice(0, 3).join(' · ')}. Se dejó el valor de la primera; confírmalo en el documento.`);
  }

  return {
    ...base,
    filas, filasEmpresa, cronograma, extras,
    cabecera: fundirCabeceras(cabeceras),
    alertas,
    alertasDeTramo: [...new Set(lista.flatMap(r => r.alertasDeTramo || []))],
    // Es una LISTA (los extras cuya cita no se pudo comprobar), no un contador.
    extrasDudosos: unirListas(lista.map(r => r.extrasDudosos || [])),
    modelos: [...new Set(lista.flatMap(r => r.modelos || []))],
    // El costo es la SUMA: el OCR se pagó una vez (la segunda corrida lo reusa)
    // y las pasadas de IA se pagaron cada vez — que con un gratuito es USD 0,
    // pero eso lo dice el número medido, no un supuesto.
    costo: {
      ocr: base.costo?.ocr ?? 0,
      pasadas: lista.reduce((t, r) => t + (r.costo?.pasadas ?? 0), 0),
      total: (base.costo?.ocr ?? 0) + lista.reduce((t, r) => t + (r.costo?.pasadas ?? 0), 0),
    },
    corridas: lista.length,
    estabilidad,
    cabeceraDiscrepa: discrepan,
  };
}
