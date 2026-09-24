// ═══════════════════════════════════════════════════════════════════
// JARVEX — Aviso de DUPLICADOS en almacén (movimientos y catálogo).
//
// Revisión del 24-set-2026 sobre lo que reportó la almacenera (plastificante,
// escobillón, collarín, unión 1", enchufe). Lo que mostraron los datos:
//
//  · El aviso viejo (22-jul) solo saltaba con MISMA fecha + MISMA cantidad y
//    creado hace < 6 h. Si al re-registrar se corregía la fecha (lo más común:
//    "no lo veo, lo subo de nuevo con la fecha de la guía"), pasaba sin aviso.
//  · El catálogo no avisaba NADA al crear un material con el mismo nombre:
//    UNIONES SIMPLES 1" existe dos veces (29-ago y 02-set) y ACEITE SINTÉTICO
//    10W30 4T dos veces con 47 s de diferencia. Un typo (ESCHUFE) hizo que
//    días después se creara ENCHUFE y el mismo ingreso quedara contado en los
//    dos — el "duplicado" que ella veía.
//
// Todo acá es PURO (sin Dexie ni React) para poder testearlo. Los avisos nunca
// bloquean: devuelven coincidencias y la pantalla pregunta.
// ═══════════════════════════════════════════════════════════════════

const DIA_MS = 24 * 3600 * 1000;

// ── Nombres ─────────────────────────────────────────────────────────

// Palabras que no distinguen un material de otro ("TUBO DE 1" = "TUBO 1").
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'y', 'en', 'x', 'a']);

function sinAcentos(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Forma CANÓNICA de singular/plural — no es el singular real, es una forma que
// da lo mismo para las dos: UNIONES/UNION → "union", CABLES/CABLE → "cabl",
// SIMPLES/SIMPLE → "simpl", TUBOS/TUBO → "tubo". Se aplica igual a los dos
// lados de la comparación, así que no hace falta lingüística fina.
function singular(p) {
  let w = p;
  if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e') && /[lnrdzj]/.test(w[w.length - 2])) w = w.slice(0, -1);
  return w;
}

/**
 * Descompone un nombre en palabras (singularizadas, sin vacías) y MEDIDAS
 * (números y fracciones: 1, 1/2, 10w30, 4t). Las medidas tienen que coincidir
 * exacto para decir "parecido": UNIÓN 1" y UNIÓN 1 1/2" son materiales
 * distintos aunque se escriban casi igual.
 */
export function claveNombre(nombre) {
  const base = sinAcentos(nombre).toLowerCase()
    .replace(/[°º]/g, '')               // F°G° → FG
    .replace(/["”“¨'’]+/g, ' ')          // pulgadas en todas sus formas
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();
  const tokens = base.split(/\s+/).filter(Boolean);
  const medidas = [];
  const palabras = [];
  for (const t of tokens) {
    if (/\d/.test(t)) medidas.push(t);
    else if (!VACIAS.has(t)) palabras.push(singular(t));
  }
  return {
    palabras,
    medidas: medidas.slice().sort(),
    // Texto plano comparable: palabras (en su orden) + medidas.
    plano: [...palabras, ...medidas].join(' '),
  };
}

/** Distancia de edición (Levenshtein) — solo para nombres cortos. */
export function distanciaEdicion(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function mismasMedidas(a, b) {
  return a.medidas.length === b.medidas.length && a.medidas.every((m, i) => m === b.medidas[i]);
}

/**
 * Busca en `existentes` los ítems del catálogo con un nombre IGUAL o PARECIDO
 * a `nombre`. Devuelve [{ item, tipo: 'igual'|'parecido' }], los iguales
 * primero. `getNombre` lee el nombre de cada ítem (materiales usan
 * nombre_material, herramientas nombre_herramienta, epps nombre_epp).
 *
 * Parecido = mismas medidas y además:
 *   - las mismas palabras en otro orden ("CINTA SEGURIDAD AMARILLA" / "CINTA
 *     AMARILLA SEGURIDAD"), o
 *   - uno es el otro + una palabra ("UNION SIMPLE 1 1/2" / "... F°G°"), o
 *   - a 1 letra de distancia (a 2 si el nombre es largo): ESCHUFE ↔ ENCHUFE.
 */
export function buscarNombresParecidos(nombre, existentes, {
  getNombre = (x) => x?.nombre, excluirId = null, max = 5,
  // Variante en un campo APARTE del nombre (la talla de un EPP: ZAPATOS 39 y
  // ZAPATOS 40 se llaman igual). Si las dos la tienen y difiere, no es el mismo.
  variante = null, getVariante = null,
} = {}) {
  const k = claveNombre(nombre);
  if (!k.plano) return [];
  const normVar = (v) => sinAcentos(v).toLowerCase().replace(/[^a-z0-9/]+/g, '');
  const miVariante = normVar(variante);
  const iguales = [];
  const parecidos = [];
  for (const item of existentes || []) {
    if (!item || item.deleted_at) continue;
    if (excluirId && item.id === excluirId) continue;
    if (getVariante && miVariante) {
      const suya = normVar(getVariante(item));
      if (suya && suya !== miVariante) continue;
    }
    const otro = claveNombre(getNombre(item));
    if (!otro.plano) continue;
    if (otro.plano === k.plano) { iguales.push({ item, tipo: 'igual' }); continue; }
    if (!mismasMedidas(k, otro)) continue;
    const mismasPalabras = k.palabras.length > 0
      && k.palabras.length === otro.palabras.length
      && k.palabras.slice().sort().join(' ') === otro.palabras.slice().sort().join(' ');
    // Uno es el otro + UNA palabra ("UNION SIMPLE 1 1/2" / "... F°G°"). El
    // corto tiene que tener ≥2 palabras: "UNION 1" no se empareja con todo.
    const [corto, largoP] = k.palabras.length <= otro.palabras.length ? [k.palabras, otro.palabras] : [otro.palabras, k.palabras];
    const contenido = corto.length >= 2 && largoP.length - corto.length === 1
      && corto.every(p => largoP.includes(p));
    const txtA = k.palabras.join(' ');
    const txtB = otro.palabras.join(' ');
    const largo = Math.min(txtA.length, txtB.length);
    const tope = largo >= 12 ? 2 : largo >= 5 ? 1 : 0;
    if (mismasPalabras || contenido || (tope > 0 && distanciaEdicion(txtA, txtB) <= tope)) {
      parecidos.push({ item, tipo: 'parecido' });
    }
  }
  return [...iguales, ...parecidos].slice(0, max);
}

// ── Movimientos ─────────────────────────────────────────────────────

function diasEntre(fechaA, fechaB) {
  const a = Date.parse(`${fechaA}T12:00:00Z`);
  const b = Date.parse(`${fechaB}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.round(Math.abs(a - b) / DIA_MS);
}

function vivo(m) {
  return m && !m.deleted_at && !m.reverses_id && !m.reversed_by_id;
}

/**
 * ¿Ya hay un movimiento registrado que se parece al que se va a guardar?
 *
 * @param {Object}   nuevo       { itemId, tipo, cantidad, fecha, destino? }
 * @param {Object[]} existentes  movimientos del MISMO ítem (o de todos; se filtra)
 * @param {Object}   opts
 *   - getItemId(m)  id del ítem en la fila (material_id / epp_id / herramienta_id)
 *   - getTipo(m)    tipo normalizado de la fila (default m.tipo_movimiento)
 *   - ahoraMs       reloj (inyectable para tests)
 *   - horasRecientes  ventana de "lo registraste hace poco" (default 72 h)
 *   - diasFecha       tolerancia de fecha para el caso "otra fecha" (default 7)
 *
 * Dos niveles, ambos con la MISMA cantidad (una salida de 5 y otra de 3 el
 * mismo día es trabajo normal, no un duplicado):
 *   'misma_fecha'  — misma fecha del movimiento, sin importar cuándo se cargó.
 *                    Es el re-registro clásico ("no aparece, lo subo otra vez").
 *   'otra_fecha'   — fecha distinta (±diasFecha) pero cargado hace poco: el
 *                    re-registro en el que además se "corrigió" la fecha.
 */
export function buscarMovimientosParecidos(nuevo, existentes, opts = {}) {
  const {
    getItemId = (m) => m.material_id,
    getTipo = (m) => m.tipo_movimiento,
    ahoraMs = Date.now(),
    horasRecientes = 72,
    diasFecha = 7,
    // Destino que tiene que coincidir (EPP: el trabajador). Entregar 1 par de
    // guantes a 10 personas el mismo día es trabajo normal, no un duplicado.
    getDestino = null,
  } = opts;
  const cant = Number(nuevo?.cantidad);
  if (!nuevo?.itemId || !nuevo?.tipo || !Number.isFinite(cant) || cant <= 0) return [];
  const desde = ahoraMs - horasRecientes * 3600 * 1000;
  const out = [];
  for (const m of existentes || []) {
    if (!vivo(m)) continue;
    if (getItemId(m) !== nuevo.itemId) continue;
    if (getTipo(m) !== nuevo.tipo) continue;
    if (Math.abs(Number(m.cantidad) - cant) > 1e-9) continue;
    if (getDestino && (getDestino(m) || null) !== (nuevo.destino || null)) continue;
    if (nuevo.fecha && m.fecha === nuevo.fecha) {
      out.push({ mov: m, nivel: 'misma_fecha' });
      continue;
    }
    const creado = Date.parse(m.created_at || '');
    if (Number.isFinite(creado) && creado >= desde && diasEntre(m.fecha, nuevo.fecha) <= diasFecha) {
      out.push({ mov: m, nivel: 'otra_fecha' });
    }
  }
  // Lo más reciente primero: es lo que la persona tiene fresco.
  out.sort((a, b) => String(b.mov.created_at || '').localeCompare(String(a.mov.created_at || '')));
  return out;
}

/** id de usuario → "Nombres Apellidos" (o email), para decir QUIÉN cargó. */
export function mapaNombresUsuarios(profiles) {
  const m = new Map();
  for (const p of profiles || []) {
    if (!p?.id) continue;
    const n = [p.nombres, p.apellidos].filter(Boolean).join(' ').trim();
    m.set(p.id, n || p.email || null);
  }
  return m;
}

function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '—');
}

/**
 * Arma los `grupos` que muestra window.__avisoDuplicado a partir de lo que
 * encontró buscarMovimientosParecidos para cada fila del lote.
 *
 * @param {Object[]} filas  [{ nombre, unidad, cantidad, fecha, parecidos }]
 * @param {Object}   opts   { ahoraMs, nombreDe(userId) → string|null }
 */
export function armarAvisoMovimientos(filas, { ahoraMs = Date.now(), nombreDe = () => null } = {}) {
  return (filas || [])
    .filter(f => f?.parecidos?.length)
    .map(f => ({
      titulo: `${f.nombre} × ${f.cantidad}${f.unidad ? ' ' + f.unidad : ''} — fecha ${fechaCorta(f.fecha)}`,
      filas: f.parecidos.slice(0, 3).map(({ mov, nivel }) => {
        const quien = nombreDe(mov.created_by);
        const cuando = haceCuanto(mov.created_at, ahoraMs);
        const partes = [
          `Ya hay uno igual con fecha ${fechaCorta(mov.fecha)}${nivel === 'otra_fecha' ? ' (OTRA fecha)' : ''}`,
          cuando ? `cargado ${cuando}` : null,
          quien ? `por ${quien}` : null,
        ].filter(Boolean);
        return partes.join(' · ');
      }).concat(f.parecidos.length > 3 ? [`… y ${f.parecidos.length - 3} más`] : []),
    }));
}

// ── Registro: encontrar lo cargado con fecha atrasada ───────────────
//
// Caso COLLARINES (24-set): la salida de 2 jgo se cargó hoy con fecha 11/09.
// El registro ordena por FECHA DEL MOVIMIENTO, así que quedó 13 días abajo,
// enterrada bajo todo lo posterior — "lo subí pero no salía en el registro".
// No se había perdido. Estas dos funciones dan la otra vista.

/**
 * Ordena movimientos. 'fecha' = por fecha+hora del movimiento (lo de siempre);
 * 'cargado' = por cuándo se REGISTRÓ en el sistema (created_at), lo último
 * cargado arriba sin importar la fecha que se le puso.
 */
export function ordenarMovimientos(movs, orden = 'fecha') {
  const arr = (movs || []).slice();
  if (orden === 'cargado') {
    return arr.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }
  return arr.sort((a, b) => {
    const fa = (a.fecha || '') + ' ' + (a.hora || '');
    const fb = (b.fecha || '') + ' ' + (b.hora || '');
    return fb.localeCompare(fa);
  });
}

/**
 * Si el movimiento se cargó 2+ días DESPUÉS de su fecha, devuelve la fecha
 * local (YYYY-MM-DD) en que se cargó; si no, null. `fechaLocalDe` convierte el
 * created_at (UTC) a la fecha de la obra — se inyecta para no depender del TZ.
 */
export function cargadoDespues(m, fechaLocalDe) {
  if (!m?.created_at || !m?.fecha) return null;
  const cargado = fechaLocalDe(m.created_at);
  if (!cargado) return null;
  return diasEntre(cargado, m.fecha) >= 2 && cargado > m.fecha ? cargado : null;
}

/**
 * "hace 5 min", "hace 3 h", "hace 2 días" — para que el aviso diga CUÁNDO se
 * cargó el movimiento anterior (es lo que la persona reconoce).
 */
export function haceCuanto(iso, ahoraMs = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((ahoraMs - t) / 60000));
  if (min < 1) return 'hace instantes';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}
