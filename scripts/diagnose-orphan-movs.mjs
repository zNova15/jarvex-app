#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Diagnóstico de movimientos huérfanos
//
// Detecta movs cuyo material_id apunta a:
//   (a) un material que NO existe en server (referencia rota)
//   (b) un material que existe pero en OTRA obra (cross-obra ref)
//   (c) un material soft-deleted (eliminado del catálogo)
//
// Solo reporta — NO modifica nada.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const envFile = join(REPO, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !sk) {
  console.error('✗ Falta VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function fetchAll(tabla) {
  const r = await fetch(`${url}/rest/v1/${tabla}?select=*&limit=10000`, {
    headers: { apikey: sk, Authorization: `Bearer ${sk}` },
  });
  if (!r.ok) throw new Error(`${tabla}: HTTP ${r.status}`);
  return r.json();
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Diagnóstico de movimientos huérfanos');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const [movs, mats, obras] = await Promise.all([
  fetchAll('movimientos_materiales'),
  fetchAll('materiales'),
  fetchAll('obras'),
]);

console.log(`📊 ${movs.length} movs · ${mats.length} materiales · ${obras.length} obras\n`);

const matsById = new Map(mats.map(m => [m.id, m]));
const obrasById = new Map(obras.map(o => [o.id, o]));

const orphans = [];        // material_id no existe
const crossObra = [];      // material existe pero está en otra obra
const softDeleted = [];    // material soft-deleted
const obraMismatch = [];   // mov.obra_id no corresponde a obra existente

for (const mov of movs) {
  if (mov.deleted_at) continue;
  const mat = matsById.get(mov.material_id);
  if (!mat) {
    orphans.push(mov);
    continue;
  }
  if (mat.obra_id !== mov.obra_id) {
    crossObra.push({ mov, mat });
    continue;
  }
  if (mat.deleted_at) {
    softDeleted.push({ mov, mat });
  }
  if (!obrasById.has(mov.obra_id)) {
    obraMismatch.push(mov);
  }
}

const obraNombre = (id) => obrasById.get(id)?.nombre_obra || `(obra ${id?.slice(0,8)})`;

if (orphans.length === 0 && crossObra.length === 0 && softDeleted.length === 0) {
  console.log('✓ Ningún movimiento huérfano detectado.\n');
  process.exit(0);
}

if (orphans.length > 0) {
  console.log(`⚠ ${orphans.length} movs con material_id INEXISTENTE:`);
  for (const m of orphans.slice(0, 10)) {
    console.log(`  · mov ${m.id.slice(0,8)} · obra "${obraNombre(m.obra_id)}" · ${m.fecha} · ${m.tipo_movimiento} ${m.cantidad} ${m.unidad || ''}`);
    console.log(`    → material_id: ${m.material_id} (NO existe en BD)`);
  }
  if (orphans.length > 10) console.log(`  ... y ${orphans.length - 10} más\n`);
  console.log('');
}

if (crossObra.length > 0) {
  console.log(`⚠ ${crossObra.length} movs cuyo material está en OTRA obra (UI los muestra como "no disponible"):`);
  for (const { mov, mat } of crossObra.slice(0, 15)) {
    console.log(`  · mov ${mov.id.slice(0,8)} · ${mov.fecha} · ${mov.tipo_movimiento} ${mov.cantidad} ${mov.unidad || ''}`);
    console.log(`    obra del mov:   "${obraNombre(mov.obra_id)}"`);
    console.log(`    obra del mat:   "${obraNombre(mat.obra_id)}" → "${mat.nombre_material}" (${mat.id.slice(0,8)})`);
  }
  if (crossObra.length > 15) console.log(`  ... y ${crossObra.length - 15} más\n`);
  console.log('');
}

if (softDeleted.length > 0) {
  console.log(`ℹ ${softDeleted.length} movs cuyo material fue soft-deleted (esto es OK, la UI lo etiqueta "histórico"):`);
  for (const { mov, mat } of softDeleted.slice(0, 5)) {
    console.log(`  · mov ${mov.id.slice(0,8)} · "${mat.nombre_material}" deleted_at=${mat.deleted_at?.slice(0,10)}`);
  }
  if (softDeleted.length > 5) console.log(`  ... y ${softDeleted.length - 5} más`);
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Sugerencia:');
if (crossObra.length > 0) {
  console.log('  Los "cross-obra" son el bug visual real. Causa probable: en algún');
  console.log('  flujo de creación, el form heredó la obra_id del material en lugar');
  console.log('  de pisarla con la obra activa al guardar el movimiento. O viceversa.');
  console.log('  Fix UI: en jx-movimientos.jsx, ampliar el query de materiales a TODOS');
  console.log('  (sin filtro de obra) para el lookup. Ya está parcialmente hecho,');
  console.log('  pero el .where("obra_id") sigue limitando.');
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
