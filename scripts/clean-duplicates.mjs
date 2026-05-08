#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Limpieza automática de duplicados (Opción B)
//
// Borra (soft-delete) los duplicados que detecta detect-duplicates.mjs
// en las tablas de movimientos. NO toca obras, materiales ni asistencia.
//
// Lógica:
//   - Mismo material/herramienta + tipo + cantidad + fecha + responsable,
//     creados por el mismo usuario en una ventana de 5 min → duplicado.
//   - Conserva el PRIMER registro (el más antiguo por created_at).
//   - Marca los demás con deleted_at = now() y deleted_by = service_role.
//
// Las tablas de movimientos NO tienen deleted_at, así que se hace DELETE
// físico. Por seguridad, el script imprime el JSON de cada fila antes de
// borrarla — si algo sale mal, podés restaurarlo manualmente desde el log.
//
// Uso:
//   node scripts/clean-duplicates.mjs --dry-run   (default, solo muestra)
//   node scripts/clean-duplicates.mjs --apply     (ejecuta de verdad)
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
const DRY = !APPLY;

async function fetchAll(tabla) {
  const r = await fetch(`${url}/rest/v1/${tabla}?select=*&order=created_at.asc&limit=10000`, {
    headers: { apikey: sk, Authorization: `Bearer ${sk}` },
  });
  if (!r.ok) throw new Error(`${tabla}: HTTP ${r.status}`);
  return r.json();
}

async function hardDelete(tabla, id) {
  const r = await fetch(`${url}/rest/v1/${tabla}?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      apikey: sk,
      Authorization: `Bearer ${sk}`,
      Prefer: 'return=minimal',
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`DELETE ${tabla}/${id}: HTTP ${r.status} ${txt.slice(0, 120)}`);
  }
}

function findDuplicateClusters(rows, keyFields, windowMs = 5 * 60 * 1000) {
  const groups = new Map();
  for (const r of rows) {
    if (r.deleted_at) continue;
    const key = keyFields.map(k => r[k] ?? '').join('||');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const clusters = [];
  for (const [, items] of groups) {
    if (items.length < 2) continue;
    items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let cluster = [items[0]];
    for (let i = 1; i < items.length; i++) {
      const last = cluster[cluster.length - 1];
      const diff = new Date(items[i].created_at) - new Date(last.created_at);
      if (diff < windowMs && items[i].created_by === last.created_by) {
        cluster.push(items[i]);
      } else {
        if (cluster.length >= 2) clusters.push(cluster);
        cluster = [items[i]];
      }
    }
    if (cluster.length >= 2) clusters.push(cluster);
  }
  return clusters;
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Limpieza de duplicados — modo ${APPLY ? 'APPLY (escribirá)' : 'DRY-RUN (solo lectura)'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const targets = [
  {
    tabla: 'movimientos_materiales',
    keys: ['material_id', 'tipo_movimiento', 'cantidad', 'fecha', 'created_by'],
  },
  {
    tabla: 'movimientos_herramientas',
    keys: ['herramienta_id', 'tipo_movimiento', 'cantidad', 'fecha', 'created_by'],
  },
];

let totalACborrar = 0;
let totalBorrados = 0;
let totalErrores = 0;

for (const { tabla, keys } of targets) {
  console.log(`📋 ${tabla}`);
  const rows = await fetchAll(tabla);
  const clusters = findDuplicateClusters(rows, keys);

  if (clusters.length === 0) {
    console.log('   ✓ Sin duplicados\n');
    continue;
  }

  for (const cluster of clusters) {
    const [keep, ...toDelete] = cluster;
    console.log(`   Grupo de ${cluster.length}:`);
    console.log(`     ✓ CONSERVAR: ${keep.id} (${keep.created_at})`);
    for (const dup of toDelete) {
      totalACborrar++;
      console.log(`     ✗ BORRAR:    ${dup.id} (${dup.created_at})`);
      if (APPLY) {
        // Backup compacto a stdout antes de borrar — si algo falla, podés
        // restaurar manualmente desde este JSON.
        console.log(`       [backup] ${JSON.stringify(dup)}`);
        try {
          await hardDelete(tabla, dup.id);
          totalBorrados++;
          console.log(`       ✓ DELETE OK`);
        } catch (e) {
          totalErrores++;
          console.log(`       ✗ ERROR: ${e.message}`);
        }
      }
    }
  }
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (DRY) {
  console.log(`DRY-RUN: ${totalACborrar} registros se borrarían (DELETE físico).`);
  console.log('Para aplicar: node scripts/clean-duplicates.mjs --apply');
} else {
  console.log(`APPLY: ${totalBorrados}/${totalACborrar} DELETEs OK, ${totalErrores} errores.`);
  if (totalBorrados > 0) {
    console.log('\nLos JSON [backup] de arriba contienen el state previo.');
    console.log('Si querés restaurar alguno, hacé INSERT con esos valores.');
  }
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('NOTA: 3 materiales "madera tornillo para encofrado" tienen pares con');
console.log('created_at idéntico al ms — parecen duplicados de seed pero NO se');
console.log('tocaron porque están en stock vivo. Revisalos a mano si querés:');
console.log('  · obra 01e715c7: ba55dee7 / dc647761');
console.log('  · obra 4da8cbfa: 1c02f4eb / bbb537e6');
console.log('  · obra 1c315226: 05f3e725 / 67caf638');
