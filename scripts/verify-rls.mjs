#!/usr/bin/env node
// Verifica que la migration 033 (RLS por roles) quedó correctamente aplicada.
// Lee policies desde pg_policies via REST API + chequea funciones helper.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

// Cargar .env.local
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

let url = (process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !sk) {
  console.error('✗ Falta VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}

// PostgREST no expone pg_policies por default. Usamos un RPC fake: invocamos
// la función has_role() que la 033 crea. Si responde, la migration corrió.

async function rpc(fn, args = {}) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: sk,
      Authorization: `Bearer ${sk}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return { ok: r.ok, status: r.status, body: r.ok ? await r.json().catch(() => null) : await r.text() };
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Verificando migration 033 (RLS por roles)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 1. Verificar que has_role() existe
console.log('1. Función has_role(roles[])...');
const r1 = await rpc('has_role', { roles: ['admin'] });
if (r1.ok) {
  console.log(`   ✓ has_role existe (response: ${JSON.stringify(r1.body)})`);
} else {
  console.log(`   ✗ has_role NO existe: HTTP ${r1.status}`);
  console.log(`      ${typeof r1.body === 'string' ? r1.body.slice(0, 200) : JSON.stringify(r1.body)}`);
}

// 2. Verificar que current_user_rol() existe
console.log('\n2. Función current_user_rol()...');
const r2 = await rpc('current_user_rol');
if (r2.ok) {
  console.log(`   ✓ current_user_rol existe (response: ${JSON.stringify(r2.body)})`);
} else {
  console.log(`   ✗ current_user_rol NO existe: HTTP ${r2.status}`);
}

// 3. Probar acceso a tablas críticas con SERVICE_ROLE (debe pasar — bypassea RLS)
console.log('\n3. Verificar tablas accesibles con service_role (bypass RLS)...');
const tablas = ['materiales', 'planillas', 'audit_log', 'epps', 'cuentas_bancarias'];
for (const t of tablas) {
  const r = await fetch(`${url}/rest/v1/${t}?limit=1`, {
    headers: { apikey: sk, Authorization: `Bearer ${sk}` },
  });
  console.log(`   ${r.ok ? '✓' : '✗'} ${t.padEnd(25)} HTTP ${r.status}`);
}

// 4. Probar acceso con ANON_KEY (sin auth) → debe fallar/devolver vacío en TODAS
console.log('\n4. Verificar bloqueo a anon (sin auth)...');
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (anonKey) {
  for (const t of tablas) {
    const r = await fetch(`${url}/rest/v1/${t}?limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    let bodyText = '';
    try { bodyText = await r.text(); } catch {}
    const isEmpty = bodyText.trim() === '[]';
    const isBlocked = !r.ok || isEmpty;
    const indicator = isBlocked ? '✓' : '✗';
    const note = !r.ok ? `BLOQUEADO (${r.status})` : (isEmpty ? 'vacío (RLS oculta filas)' : 'LEYÓ DATA — ¡problema!');
    console.log(`   ${indicator} ${t.padEnd(25)} ${note}`);
  }
} else {
  console.log('   (skip — no anon key)');
}

// 5. Listar policies aplicadas via SQL function (creamos una temporal)
console.log('\n5. Resumen de policies aplicadas...');
// Intento crear una función rpc para listar pg_policies. Si ya existe, usar.
const create = await fetch(`${url}/rest/v1/rpc/list_jx_policies`, {
  method: 'POST',
  headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
  body: '{}',
});
if (create.ok) {
  const policies = await create.json();
  console.log(`   ✓ ${policies.length} policies con prefijo rls033_`);
  // Agrupar por tabla
  const byTable = {};
  for (const p of policies) {
    byTable[p.tablename] = (byTable[p.tablename] || 0) + 1;
  }
  console.log(`   ${Object.keys(byTable).length} tablas con RLS de la 033`);
  console.log('   Tablas: ' + Object.keys(byTable).sort().join(', '));
} else {
  console.log(`   (skip — list_jx_policies() RPC no existe; podés crearla manualmente)`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Si los puntos 1, 2 y 4 están con ✓ → migration 033 aplicada OK');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
