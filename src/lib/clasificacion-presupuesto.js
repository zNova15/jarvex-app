// ═══════════════════════════════════════════════════════════════════
// JARVEX — QUÉ ES CADA INSUMO DEL PRESUPUESTO (22-set-2026).
//
// Gabriel, mirando el Simulador de Órdenes: «debemos tener dónde clasificar el
// presupuesto». Hasta acá no existía: los insumos del expediente NO se
// guardaban clasificados en ninguna parte y el simulador los clasificaba al
// vuelo en cada corrida, sin forma de corregir un error.
//
// ── LO QUE ESTE ARCHIVO HACE, Y LO QUE NO ─────────────────────────
// Toma las filas crudas de `insumos_partida` de una obra y devuelve UNA FILA
// POR NOMBRE, con su clasificación, su rubro de proveedor, en cuántas partidas
// aparece y cuánta plata mueve. No escribe nada: la corrección se guarda como
// término del diccionario propio desde la pantalla.
//
// ── POR QUÉ POR NOMBRE Y NO POR FILA ──────────────────────────────
// Miraflores tiene **6.722 líneas de presupuesto y 432 nombres distintos**
// (medido el 22-set-2026). Clasificar es una decisión sobre el NOMBRE —
// «CEMENTO PORTLAND TIPO I (42.5 kg)» es cemento en las 40 partidas donde
// aparece—, así que la unidad de trabajo son 432 decisiones, no 6.722. Y
// ordenadas por plata: las primeras 20 filas ya mueven la mayor parte del
// plan.
//
// ── EL ORDEN IMPORTA MÁS DE LO QUE PARECE ─────────────────────────
// Sin ordenar por monto, la lista es alfabética y la primera decisión que toma
// una persona vale lo mismo que la última. Ordenada por plata, el trabajo se
// puede ABANDONAR a la mitad y aun así haber arreglado lo que mueve las
// órdenes. Es la misma idea de las bandas de confianza de la bandeja.
//
// Testeado en __tests__/clasificacion-presupuesto.test.js
// ═══════════════════════════════════════════════════════════════════
import {
  clasificarConIUPC, etiquetaCategoria, normIUPC,
  rubroDeCompra, RUBRO_COMPRA_POR_ID,
} from './indices-unificados-iupc.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

/**
 * Una fila por NOMBRE de insumo del presupuesto, clasificada y ordenada por
 * la plata que mueve.
 *
 * @param rows            filas crudas de `insumos_partida` (ya filtradas por obra)
 * @param terminosCustom  el diccionario propio; le gana a la base oficial
 *                        cuando el término es `origen:'manual'`
 */
export function resumirInsumosDePresupuesto(rows = [], { terminosCustom = null } = {}) {
  const porNombre = new Map();
  for (const r of (rows || [])) {
    if (!r || r.deleted_at) continue;
    const nombre = String(r.nombre_insumo || '').trim();
    if (!nombre) continue;
    const k = normIUPC(nombre);
    if (!k) continue;
    let f = porNombre.get(k);
    if (!f) {
      f = {
        k, nombre, unidad: r.unidad || '', tipo: r.tipo_insumo || '',
        partidas: new Set(), monto: 0, lineas: 0,
      };
      porNombre.set(k, f);
    }
    if (r.partida_id) f.partidas.add(r.partida_id);
    f.lineas += 1;
    f.monto += num(r.cantidad_presupuestada) * num(r.precio_presupuestado);
  }

  return [...porNombre.values()].map(f => {
    const rec = clasificarConIUPC(f.nombre, { terminosCustom });
    const rubro = rubroDeCompra(rec.codigo);
    const info = RUBRO_COMPRA_POR_ID.get(rubro);
    return {
      clave: f.k,
      nombre: f.nombre,
      unidad: f.unidad,
      tipo: f.tipo,
      nPartidas: f.partidas.size,
      lineas: f.lineas,
      monto: r2(f.monto),
      codigo: rec.codigo,
      etiqueta: etiquetaCategoria(rec.codigo),
      banda: rec.banda,
      score: r2(rec.score),
      // `capa:'manual'` = alguien lo decidió a mano y le gana hasta al Anexo 2.
      // Es la diferencia entre «el motor cree» y «esto ya está resuelto».
      decidido: rec.capa === 'manual',
      sinClasificar: rec.codigo === 'sin_clasificar',
      rubro,
      rubroNombre: info?.nombre || rubro,
      rubroIcono: info?.icono || '',
    };
  }).sort((a, b) => b.monto - a.monto);
}

/**
 * Lo que hay para mirar de un vistazo. `montoSinClasificar` es el número que
 * dice si vale la pena sentarse: sin clasificar no es un problema si son tres
 * filas de S/ 50, y sí lo es si son S/ 200.000 que van a caer en una orden
 * con el título «Sin clasificar».
 */
export function resumenDeClasificacion(filas = []) {
  const sin = filas.filter(f => f.sinClasificar);
  const porRevisar = filas.filter(f => !f.decidido && (f.sinClasificar || f.banda !== 'alta'));
  return {
    total: filas.length,
    sinClasificar: sin.length,
    montoSinClasificar: r2(sin.reduce((s, f) => s + f.monto, 0)),
    decididas: filas.filter(f => f.decidido).length,
    porRevisar: porRevisar.length,
    rubros: new Set(filas.map(f => f.rubro)).size,
    monto: r2(filas.reduce((s, f) => s + f.monto, 0)),
  };
}

/** El filtro de la pantalla, acá para poder testearlo sin montar React. */
export function filtrarClasificacion(filas = [], { filtro = 'todos', busca = '' } = {}) {
  const q = String(busca || '').trim().toLowerCase();
  return filas.filter(f => {
    if (filtro === 'sin' && !f.sinClasificar) return false;
    if (filtro === 'dudosas' && (f.decidido || (f.banda === 'alta' && !f.sinClasificar))) return false;
    if (!q) return true;
    return f.nombre.toLowerCase().includes(q) || f.etiqueta.toLowerCase().includes(q);
  });
}
