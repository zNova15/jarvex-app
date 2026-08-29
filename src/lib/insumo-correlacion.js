// ═══════════════════════════════════════════════════════════════════
// JARVEX — Correlación de insumos SUPERVISADA (mejora 1c, sep-2026).
//
// El sistema PROPONE pares de nombres que parecen el mismo insumo; el
// admin/gerente decide en el panel de Análisis de Insumos y la decisión se
// guarda en `insumo_correlaciones` (pares 'mismo'/'distinto') para no volver
// a preguntar. Esta lib es PURA: normalización, resolución de pares (manual >
// sugerido), grupos por union-find y el sugeridor fuzzy. Captura Mágica NO se
// toca (decisión explícita de Gabriel): esto corre como capa de análisis.
// ═══════════════════════════════════════════════════════════════════

// Normalización canónica de ESTE subsistema (las claves guardadas dependen de
// ella — no cambiarla sin migrar datos): minúsculas, sin tildes, ñ→n, todo lo
// no alfanumérico → espacio, colapsado. "Clavos de 8''" → "clavos de 8".
export const normInsumo = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Par canónico: ordenado para que (a,b) y (b,a) sean la misma clave.
export function parClave(a, b) {
  const [x, y] = [normInsumo(a), normInsumo(b)].sort();
  return `${x}|${y}`;
}

// Resuelve las filas crudas de insumo_correlaciones a UNA decisión por par:
// manual > sugerido; a igual fuente gana updated_at más reciente. Ignora
// deleted_at y (salvo opts.demo) las filas demo.
export function resolverPares(filas, opts = {}) {
  const porPar = new Map();
  for (const f of (filas || [])) {
    if (!f || f.deleted_at) continue;
    if (!!f.demo !== !!opts.demo) continue;
    if (f.relacion !== 'mismo' && f.relacion !== 'distinto') continue;
    const k = parClave(f.nombre_a, f.nombre_b);
    if (k.startsWith('|') || k.endsWith('|')) continue;   // nombre vacío
    const prev = porPar.get(k);
    if (!prev) { porPar.set(k, f); continue; }
    const rango = (x) => (x.fuente === 'manual' ? 1 : 0);
    if (rango(f) > rango(prev)) { porPar.set(k, f); continue; }
    if (rango(f) === rango(prev) && String(f.updated_at || '') > String(prev.updated_at || '')) porPar.set(k, f);
  }
  return porPar;
}

// Grupos de equivalencia (union-find sobre los pares 'mismo' resueltos).
// → { grupoDe: Map(nombreNorm → gid), grupos: Map(gid → {nombres:[], canonico}) }
// El canónico del grupo: el `canonico` más reciente entre sus pares; si nadie
// lo fijó, el nombre más largo (suele ser el más descriptivo).
export function construirGrupos(paresResueltos) {
  const padre = new Map();
  const find = (x) => {
    let r = x;
    while (padre.get(r) !== r) r = padre.get(r);
    let c = x;
    while (padre.get(c) !== c) { const n = padre.get(c); padre.set(c, r); c = n; }
    return r;
  };
  const union = (a, b) => {
    if (!padre.has(a)) padre.set(a, a);
    if (!padre.has(b)) padre.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) padre.set(rb, ra);
  };

  const canonicos = [];   // [{a, b, canonico, updated_at}]
  for (const f of paresResueltos.values()) {
    if (f.relacion !== 'mismo') continue;
    const a = normInsumo(f.nombre_a), b = normInsumo(f.nombre_b);
    if (!a || !b) continue;
    union(a, b);
    if (f.canonico) canonicos.push({ a, canonico: f.canonico, updated_at: String(f.updated_at || '') });
  }

  const grupoDe = new Map();
  const grupos = new Map();
  for (const nombre of padre.keys()) {
    const gid = find(nombre);
    grupoDe.set(nombre, gid);
    if (!grupos.has(gid)) grupos.set(gid, { nombres: [], canonico: null, _canonicoAt: '' });
    grupos.get(gid).nombres.push(nombre);
  }
  for (const c of canonicos) {
    const g = grupos.get(find(c.a));
    if (g && c.updated_at >= g._canonicoAt) { g.canonico = c.canonico; g._canonicoAt = c.updated_at; }
  }
  for (const g of grupos.values()) {
    g.nombres.sort();
    if (!g.canonico) g.canonico = g.nombres.reduce((m, n) => (n.length > m.length ? n : m), g.nombres[0] || '');
    delete g._canonicoAt;
  }
  return { grupoDe, grupos };
}

// Clave de agrupación para un nombre cualquiera (miembro de grupo → gid;
// suelto → su propia forma normalizada).
export function claveGrupoDe(nombre, grupoDe) {
  const n = normInsumo(nombre);
  return (grupoDe && grupoDe.get(n)) || n;
}

// ── Sugeridor fuzzy ──────────────────────────────────────────────────
// Score entre dos nombres normalizados: tokens compartidos / tokens del más
// largo. Un token "matchea" si es igual, o si uno es prefijo del otro con ≥4
// letras (clavo ≈ clavos, tubo ≈ tubos). Los NÚMEROS deben coincidir exacto
// (clavo de 8 ≠ clavo de 4 — medidas distintas son insumos distintos).
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'en', 'y', 'a', 'un', 'una', 'x']);
const tokensDe = (nombreNorm) => nombreNorm.split(' ').filter(t => t && !STOPWORDS.has(t));
const tokenMatch = (t, u) => {
  if (t === u) return true;
  if (/^\d/.test(t) || /^\d/.test(u)) return false;   // numéricos: exacto o nada
  const [corto, largo] = t.length <= u.length ? [t, u] : [u, t];
  return corto.length >= 4 && largo.startsWith(corto);
};

export function scoreNombres(a, b) {
  const ta = tokensDe(normInsumo(a));
  const tb = tokensDe(normInsumo(b));
  if (!ta.length || !tb.length) return 0;
  // MEDIDAS: si AMBOS nombres traen números y difieren → 0 (clavo de 8 ≠ clavo
  // de 4). Si solo UNO trae números ("Cemento Sol" vs "Cemento Sol x 42.5kg")
  // no se anula: puede ser el mismo insumo con la presentación explícita —
  // justamente el tipo de duda que decide el admin en el panel.
  const numsA = ta.filter(t => /^\d/.test(t)), numsB = tb.filter(t => /^\d/.test(t));
  if (numsA.length && numsB.length) {
    for (const n of numsA) if (!numsB.includes(n)) return 0;
    for (const n of numsB) if (!numsA.includes(n)) return 0;
  }
  const usados = new Set();
  let m = 0;
  for (const t of ta) {
    const j = tb.findIndex((u, i) => !usados.has(i) && tokenMatch(t, u));
    if (j >= 0) { usados.add(j); m++; }
  }
  return m / Math.max(ta.length, tb.length);
}

// Score sobre tokens YA precomputados (camino caliente del sugeridor: evita
// re-normalizar cada nombre miles de veces — hallazgo de rendimiento de la
// revisión adversarial: 2000 nombres tardaban ~13 s re-normalizando por par).
function scoreTokens(ta, tb) {
  if (!ta.length || !tb.length) return 0;
  const numsA = ta.filter(t => /^\d/.test(t)), numsB = tb.filter(t => /^\d/.test(t));
  if (numsA.length && numsB.length) {
    for (const n of numsA) if (!numsB.includes(n)) return 0;
    for (const n of numsB) if (!numsA.includes(n)) return 0;
  }
  const usados = new Set();
  let m = 0;
  for (const t of ta) {
    const j = tb.findIndex((u, i) => !usados.has(i) && tokenMatch(t, u));
    if (j >= 0) { usados.add(j); m++; }
  }
  return m / Math.max(ta.length, tb.length);
}

// Propone pares AÚN NO decididos entre los nombres dados.
// nombres: lista de nombres (crudos); paresResueltos: de resolverPares();
// grupoDe: de construirGrupos() (dos nombres ya en el mismo grupo no se
// vuelven a proponer).
// Rendimiento (para presupuestos reales con miles de nombres): tokens
// precomputados una sola vez; cada nombre se indexa SOLO por su raíz MÁS RARA
// (la que menos nombres comparten — evita que familias enteras tipo
// "cemento…" formen un bucket cuadrático); buckets gigantes y la enumeración
// total van con tope duro.
export function sugerirPares(nombres, paresResueltos, grupoDe, opts = {}) {
  const { umbral = 0.55, max = 60, maxBucket = 150, maxEnum = 40000 } = opts;
  const unicos = [...new Set((nombres || []).map(normInsumo).filter(Boolean))];
  const toks = unicos.map(n => tokensDe(n));

  // Frecuencia de cada raíz de 4 letras (solo palabras, no medidas).
  const raicesDe = (ts) => [...new Set(ts.filter(t => !/^\d/.test(t)).map(t => t.slice(0, 4)))];
  const freq = new Map();
  const raicesPorNombre = unicos.map((_, i) => raicesDe(toks[i]));
  for (const rs of raicesPorNombre) for (const r of rs) freq.set(r, (freq.get(r) || 0) + 1);

  // Indexar cada nombre por sus DOS raíces más raras (con >1 aparición). Solo
  // una perdería cobertura: "clavo especial 8" iría al bucket 'espe' y
  // "clavos de 8" al bucket 'clav' y jamás se compararían. Con dos, basta que
  // COMPARTAN una de sus raíces raras para encontrarse.
  const porRaiz = new Map();
  raicesPorNombre.forEach((rs, i) => {
    const candidatas = rs
      .filter(r => (freq.get(r) || 0) >= 2)                  // raíz única: nadie con quien parear
      .sort((a, b) => freq.get(a) - freq.get(b))
      .slice(0, 2);
    for (const r of candidatas) {
      if (!porRaiz.has(r)) porRaiz.set(r, []);
      porRaiz.get(r).push(i);
    }
  });

  const vistos = new Set();
  const out = [];
  let enumeradas = 0;
  for (const idxs of porRaiz.values()) {
    if (idxs.length > maxBucket) continue;                   // familia gigante: no vale un cuadrático
    for (let x = 0; x < idxs.length && enumeradas < maxEnum; x++) {
      for (let y = x + 1; y < idxs.length && enumeradas < maxEnum; y++) {
        enumeradas++;
        const ia = idxs[x], ib = idxs[y];
        const a = unicos[ia], b = unicos[ib];
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;         // ya normalizados: clave directa
        if (vistos.has(k)) continue;
        vistos.add(k);
        if (paresResueltos && paresResueltos.has(k)) continue;               // ya decidido
        if (grupoDe && grupoDe.get(a) && grupoDe.get(a) === grupoDe.get(b)) continue;  // ya agrupados
        const s = scoreTokens(toks[ia], toks[ib]);
        if (s >= umbral) out.push({ nombre_a: a, nombre_b: b, score: Math.round(s * 100) / 100 });
      }
    }
  }
  out.sort((p, q) => q.score - p.score);
  return out.slice(0, max);
}
