#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Asigna users no-admin a obras
//
// Lee los profiles que NO tienen entrada en obra_usuarios y los
// asigna a la(s) obra(s) que vos definas en el mapeo de abajo.
//
// Editar el objeto MAPEO con tu plan, después correr:
//   node scripts/assign-users-to-obras.mjs           (dry-run)
//   node scripts/assign-users-to-obras.mjs --apply   (aplica)
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

// ════════════════════════════════════════════════════════════════
// EDITAR ACÁ: mapear cada email a la(s) obra_id donde lo querés.
// Si dejás un email en lista vacía → no se asigna y queda bloqueado
// (el script avisa).
// ════════════════════════════════════════════════════════════════
const OBRA_CAJAMARCA = '85b15fa8-0a8d-43b1-9680-f5933366d907';

const MAPEO = {
  // Almaceneros
  'miguelitojs@hotmail.com':    [OBRA_CAJAMARCA],
  'ytafurchugnas@gmail.com':    [OBRA_CAJAMARCA],
  // Gerentes
  'jrjsdc@gmail.com':           [OBRA_CAJAMARCA],
  'julca188@hotmail.com':       [OBRA_CAJAMARCA],
};
// ════════════════════════════════════════════════════════════════

async function api(path, opts = {}) {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: sk,
      Authorization: `Bearer ${sk}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`HTTP ${r.status} · ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 200)}`);
  return data;
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Asignación de users a obras — modo ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const [profiles, obras, asignaciones] = await Promise.all([
  api('profiles?select=id,email,rol,nombres,apellidos'),
  api('obras?select=id,nombre_obra&deleted_at=is.null'),
  api('obra_usuarios?select=usuario_id,obra_id,activo'),
]);

const obrasById = new Map(obras.map(o => [o.id, o]));
const asignActivas = asignaciones.filter(a => a.activo !== false);

let totalCreadas = 0;
let totalSkipped = 0;
let totalErrores = 0;

for (const [email, obraIds] of Object.entries(MAPEO)) {
  const profile = profiles.find(p => p.email === email);
  if (!profile) {
    console.log(`⚠ ${email}: NO existe en profiles, skip`);
    continue;
  }
  if (profile.rol === 'admin') {
    console.log(`ℹ ${email}: es admin, no necesita asignación, skip`);
    continue;
  }
  if (!obraIds.length) {
    console.log(`✗ ${email}: lista de obras vacía en el mapeo, skip`);
    totalSkipped++;
    continue;
  }

  console.log(`▶ ${email} (${profile.rol}):`);
  for (const obraId of obraIds) {
    const obra = obrasById.get(obraId);
    if (!obra) {
      console.log(`   ✗ obra ${obraId} no existe (o está borrada)`);
      totalErrores++;
      continue;
    }
    const yaAsignado = asignActivas.find(a => a.usuario_id === profile.id && a.obra_id === obraId);
    if (yaAsignado) {
      console.log(`   ✓ ya asignado a "${obra.nombre_obra.slice(0,40)}"`);
      continue;
    }
    if (APPLY) {
      try {
        await api('obra_usuarios', {
          method: 'POST',
          body: JSON.stringify({
            obra_id: obraId,
            usuario_id: profile.id,
            rol_obra: profile.rol,
            activo: true,
          }),
        });
        console.log(`   ✓ asignado a "${obra.nombre_obra.slice(0,40)}"`);
        totalCreadas++;
      } catch (e) {
        console.log(`   ✗ ERROR asignar a ${obraId.slice(0,8)}: ${e.message}`);
        totalErrores++;
      }
    } else {
      console.log(`   → SE ASIGNARÁ a "${obra.nombre_obra.slice(0,40)}"`);
      totalCreadas++;
    }
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (APPLY) {
  console.log(`APPLY: ${totalCreadas} asignaciones creadas, ${totalErrores} errores`);
} else {
  console.log(`DRY-RUN: ${totalCreadas} asignaciones se crearían.`);
  console.log('Para aplicar: node scripts/assign-users-to-obras.mjs --apply');
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
