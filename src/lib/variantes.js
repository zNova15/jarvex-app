// ═══════════════════════════════════════════════════════════════════
// JARVEX — Helpers de Variantes (SKU padre-hijo) y deduplicación
//
// Lógica pura y reutilizable por los 4 inventarios (materiales, epps,
// herramientas, insumos_emergencia). La UI vive en cada página; acá solo
// el cálculo: detección de genéricos, sugerencia de agrupar/añadir a
// grupo, detección de nombres duplicados y la fusión de un insumo en otro.
// ═══════════════════════════════════════════════════════════════════

// Normaliza un nombre: minúsculas, sin acentos, sin caracteres no
// alfanuméricos, sin espacios. "ZAPATO 39" y "ZAPATO39" → "zapato39".
// Sirve para detectar duplicados que solo difieren en espacios/acentos.
export function normNombre(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
}

// Palabra base de un nombre para agrupar variantes: primera palabra
// significativa, quitándole dígitos/talla del final. "Zapatos 38",
// "ZAPATOS38", "zapato" → "zapato"/"zapatos" según el texto, pero ambas
// formas con/sin espacio colapsan a la misma base alfabética.
export function palabraBase(s) {
  const limpio = String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
  const tokens = limpio.replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  // Primer token sin dígitos finales (zapatos38 → zapatos). Si el primer
  // token es puramente numérico, no sirve como base.
  let base = tokens[0].replace(/[0-9]+$/, '');
  if (base.length < 3) {
    // p. ej. "kit" o token corto: probá unir con el segundo si ayuda
    base = tokens[0];
  }
  return base.length >= 3 ? base : null;
}

// Construye Map(padre_id → [variantes]) a partir de la lista de insumos.
export function agruparPorPadre(items) {
  const m = new Map();
  for (const e of (items || [])) {
    if (e.padre_id) { const arr = m.get(e.padre_id) || []; arr.push(e); m.set(e.padre_id, arr); }
  }
  return m;
}

// Sugerencias de agrupación. Devuelve:
//   { tipo:'add', clave, grupo, items }      → sumar sueltos a un grupo existente
//   { tipo:'create', clave, titulo, items }  → crear grupo nuevo con ≥3 sueltos
// nombreField: 'nombre_material' | 'nombre_epp' | 'nombre_herramienta' | 'nombre'
export function detectarSugerencias(items, nombreField, { minCrear = 3 } = {}) {
  const vivos = (items || []).filter(e => !e.deleted_at);
  const gruposPorBase = new Map(); // base → grupo
  for (const g of vivos) {
    if (!g.es_grupo) continue;
    const b = palabraBase(g[nombreField]);
    if (b) gruposPorBase.set(b, g);
  }
  const sueltosPorBase = new Map(); // base → [sueltos]
  for (const e of vivos) {
    if (e.es_grupo || e.padre_id) continue;
    const b = palabraBase(e[nombreField]);
    if (!b) continue;
    const arr = sueltosPorBase.get(b) || []; arr.push(e); sueltosPorBase.set(b, arr);
  }
  const out = [];
  for (const [base, arr] of sueltosPorBase.entries()) {
    const grupo = gruposPorBase.get(base);
    if (grupo) {
      out.push({ tipo: 'add', clave: base, grupo, items: arr });
    } else if (arr.length >= minCrear) {
      const titulo = base.charAt(0).toUpperCase() + base.slice(1);
      out.push({ tipo: 'create', clave: base, titulo, items: arr });
    }
  }
  return out.sort((a, b) => b.items.length - a.items.length);
}

// Detecta nombres duplicados (mismo nombre normalizado) entre ítems que NO
// son grupos. Devuelve [{ clave, nombre, items:[...] }] con ≥2 ítems.
export function detectarDuplicados(items, nombreField) {
  const porClave = new Map();
  for (const e of (items || [])) {
    if (e.deleted_at || e.es_grupo) continue;
    const k = normNombre(e[nombreField]);
    if (!k) continue;
    const arr = porClave.get(k) || []; arr.push(e); porClave.set(k, arr);
  }
  return Array.from(porClave.entries())
    .filter(([, arr]) => arr.length >= 2)
    .map(([k, arr]) => ({ clave: k, nombre: arr[0][nombreField], items: arr }));
}

// Fusiona varios insumos duplicados en uno (el "sobreviviente"). Mueve sus
// movimientos, stock por ubicación y (EPP) entregas al sobreviviente, suma el
// stock y da de baja los duplicados. Devuelve { movidos, stockFinal }.
//
// config: {
//   db,                       // window.__db
//   tabla,                    // 'materiales' | 'epps' | 'herramientas' | 'insumos_emergencia'
//   movTabla,                 // 'movimientos_materiales' | ...
//   fk,                       // 'material_id' | 'epp_id' | 'herramienta_id' | 'insumo_emergencia_id'
//   itemTipoStock,            // 'material' | 'epp' | 'herramienta' (para stock_ubicaciones) | null
//   userId,
//   calcAlerta,               // fn(stock, minimo)
// }
export async function fusionarInsumos(config, survivorId, dupIds) {
  const { db, tabla, movTabla, fk, itemTipoStock, userId, calcAlerta } = config;
  const now = new Date().toISOString();
  let movidos = 0;
  const survivor = await db[tabla].get(survivorId);
  if (!survivor) throw new Error('No se encontró el insumo sobreviviente');

  for (const dupId of dupIds) {
    if (dupId === survivorId) continue;
    // 1) Reapuntar movimientos del duplicado al sobreviviente.
    const movs = await db[movTabla].where(fk).equals(dupId).toArray();
    for (const mv of movs) {
      if (mv.deleted_at) continue;
      await db[movTabla].update(mv.id, {
        [fk]: survivorId, updated_at: now, updated_by: userId,
        version: (mv.version ?? 0) + 1,
        sync_status: mv.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      movidos++;
    }
    // 2) Stock por ubicación (si la tabla lo usa).
    if (itemTipoStock && db.stock_ubicaciones) {
      const su = await db.stock_ubicaciones.where('[item_tipo+item_id]').equals([itemTipoStock, dupId]).toArray().catch(() => []);
      for (const s of su) {
        if (s.deleted_at) continue;
        await db.stock_ubicaciones.update(s.id, {
          item_id: survivorId, updated_at: now,
          version: (s.version ?? 0) + 1,
          sync_status: s.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      }
    }
    // 3) EPP: entregas a trabajadores referencian el epp dentro de items[],
    //    pero movimientos_epp ya se reapuntó arriba. epp_entregas se deja.
    // 4) Dar de baja el duplicado.
    const dup = await db[tabla].get(dupId);
    if (dup) {
      await db[tabla].update(dupId, {
        deleted_at: now, updated_at: now, updated_by: userId,
        version: (dup.version ?? 0) + 1,
        sync_status: dup.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
    }
  }

  // 5) Recalcular stock del sobreviviente desde sus movimientos.
  const movsSurv = await db[movTabla].where(fk).equals(survivorId).toArray();
  let stock = 0;
  for (const mv of movsSurv) {
    if (mv.deleted_at || mv.reverses_id || mv.reversed_by_id) continue;
    if (mv.cantidad == null) continue;
    const c = Number(mv.cantidad || 0);
    const tipo = mv.tipo_movimiento || mv.accion;
    if (tipo === 'entrada') stock += c; else if (tipo === 'salida') stock -= c;
  }
  stock = Math.max(0, stock);
  await db[tabla].update(survivorId, {
    stock_actual: stock,
    alerta: calcAlerta ? calcAlerta(stock, Number(survivor.stock_minimo || 0)) : survivor.alerta,
    updated_at: now, updated_by: userId,
    version: (survivor.version ?? 0) + 1,
    sync_status: survivor.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
  });

  return { movidos, stockFinal: stock };
}
