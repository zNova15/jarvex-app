#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — DELETE de movimientos huérfanos
//
// Borra (DELETE físico) los movs cuyo material_id no existe en la BD.
// Antes de cada DELETE, imprime el JSON completo del registro como
// backup, así si te arrepentís podés restaurarlo con un INSERT.
//
// Uso:
//   node scripts/delete-orphan-movs.mjs            # dry-run (default)
//   node scripts/delete-orphan-movs.mjs --apply    # ejecuta de verdad
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

const APPLY = process.argv.includes('--apply');

async function fetchAll(tabla) {
  const r = await fetch(`${url}/rest/v1/${tabla}?select=*&limit=10000`, {
    headers: { apikey: sk, Authorization: `Bearer ${sk}` },
  });
  if (!r.ok) throw new Error(`${tabla}: HTTP ${r.status}`);
  return r.json();
}

async function hardDelete(id) {
  const r = await fetch(`${url}/rest/v1/movimientos_materiales?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      apikey: sk,
      Authorization: `Bearer ${sk}`,
      Prefer: 'return=minimal',
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`DELETE ${id}: HTTP ${r.status} ${txt.slice(0, 200)}`);
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Borrar movs huérfanos — modo ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const [movs, mats] = await Promise.all([
  fetchAll('movimientos_materiales'),
  fetchAll('materiales'),
]);

const matsById = new Map(mats.map(m => [m.id, m]));
const huerfanos = movs.filter(m => !m.deleted_at && !matsById.has(m.material_id));

if (huerfanos.length === 0) {
  console.log('✓ No hay movs huérfanos. Nada que borrar.\n');
  process.exit(0);
}

console.log(`Detectados ${huerfanos.length} movs huérfanos:\n`);

let borrados = 0, errores = 0;
for (const m of huerfanos) {
  console.log(`  ✗ BORRAR mov ${m.id}`);
  console.log(`    fecha=${m.fecha} hora=${m.hora || '-'} ${m.tipo_movimiento} ` +
              `${m.cantidad} ${m.unidad || ''}` +
              (m.precio_unitario_real ? ` precio=${m.precio_unitario_real}` : ''));
  if (APPLY) {
    console.log(`    [backup] ${JSON.stringify(m)}`);
    try {
      await hardDelete(m.id);
      borrados++;
      console.log(`    ✓ DELETE OK`);
    } catch (e) {
      errores++;
      console.log(`    ✗ ERROR: ${e.message}`);
    }
  }
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (!APPLY) {
  console.log(`DRY-RUN: ${huerfanos.length} movs se borrarían.`);
  console.log('Para ejecutar: node scripts/delete-orphan-movs.mjs --apply');
} else {
  console.log(`APPLY: ${borrados}/${huerfanos.length} DELETEs OK · ${errores} errores`);
  console.log('\nLos JSON [backup] de arriba contienen el state previo.');
  console.log('Si querés restaurar alguno, hacé INSERT con esos valores.');
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
