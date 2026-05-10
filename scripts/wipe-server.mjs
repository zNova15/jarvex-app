#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — WIPE DESTRUCTIVO del server (estado de fábrica)
//
// Borra TODOS los registros de las tablas operativas + RRHH + tesorería
// + auth users no-admin. SOLO mantiene los 2 admins en profiles.
//
// USAR CON EXTREMO CUIDADO. Es IRREVERSIBLE. Hacé backup ANTES.
//
// Uso:
//   node scripts/wipe-server.mjs                  # dry-run (lista contar
//                                                   qué va a borrar)
//   node scripts/wipe-server.mjs --apply          # ejecuta el wipe
//   node scripts/wipe-server.mjs --apply --keep-users  # NO borra users
//                                                   no-admin (los desactiva)
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
const KEEP_USERS = process.argv.includes('--keep-users');

// ════════════════════════════════════════════════════════════════
// ORDEN IMPORTA: borrar HIJOS antes que PADRES para no violar FKs.
// (Si una FK no tiene CASCADE, el DELETE del padre falla con violación.)
// ════════════════════════════════════════════════════════════════

const TABLAS_HIJOS = [
  // Items / detalles primero
  'requisicion_items', 'cotizacion_items', 'oc_items', 'recepcion_items',
  'valorizacion_partidas', 'valorizacion_adicionales',
  'subcontrato_valorizaciones', 'planilla_boletas', 'charla_asistentes',
  'movimientos_bancarios', 'cronograma_pagos', 'horas_maquina',
  'consumos_combustible', 'mantenimientos_maquinaria',
  'epp_entregas', 'evidencias_blobs',
  'insumos_partida_versionadas', 'insumos_partida',
  'partidas_versionadas',
  // Movimientos / operaciones
  'movimientos_materiales', 'movimientos_herramientas', 'movimientos_epp',
  'asistencia', 'avance_obra', 'incidencias', 'evidencias',
  'iperc', 'inspecciones_seguridad', 'capacitaciones', 'charlas_seguridad',
  'requisiciones', 'cotizaciones', 'ordenes_compra', 'recepciones',
  'valorizaciones', 'subcontratos', 'personal_contrato', 'planillas',
  'trazabilidad_cadenas',
  // Maestros operativos
  'partidas', 'cronograma', 'presupuestos_versiones',
  'material_precios_historial',
  'materiales', 'herramientas', 'epps', 'ubicaciones_obra',
  'personal', 'proveedores', 'subcontratistas', 'activos_pesados',
  // Tesorería / contabilidad
  'cuentas_bancarias', 'accounting_movements', 'intercompany_transactions',
  // Asignaciones
  'obra_usuarios',
  // Cambios pendientes
  'change_requests',
  // Audit log
  'audit_log',
  // Padre final
  'companies',
  'obras',
];

async function getCount(tabla) {
  try {
    const r = await fetch(`${url}/rest/v1/${tabla}?select=id&limit=1`, {
      headers: { apikey: sk, Authorization: `Bearer ${sk}`, Prefer: 'count=exact', Range: '0-0' },
    });
    if (!r.ok) return null;
    const cr = r.headers.get('content-range');
    if (!cr) return 0;
    const total = cr.split('/')[1];
    return parseInt(total) || 0;
  } catch { return null; }
}

async function deleteAll(tabla) {
  // PostgREST: DELETE sin filtros está bloqueado. Hay que pasar un filtro
  // que matchee TODO. Usamos id=gte.00000000-0000-0000-0000-000000000000
  // que matchea cualquier UUID (todos son > que ese mínimo).
  try {
    const r = await fetch(`${url}/rest/v1/${tabla}?id=gte.00000000-0000-0000-0000-000000000000`, {
      method: 'DELETE',
      headers: { apikey: sk, Authorization: `Bearer ${sk}`, Prefer: 'return=minimal' },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, err: `HTTP ${r.status} ${txt.slice(0, 150)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e.message || e) };
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`WIPE COMPLETO del server — modo ${APPLY ? '🔥 APPLY (DESTRUCTIVO)' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (APPLY) {
  console.log('⚠ ÚLTIMA OPORTUNIDAD: este script va a borrar TODOS los registros');
  console.log('  operativos del server. Solo se mantienen los profiles admins.');
  console.log('  Esperando 5 segundos antes de empezar... (Ctrl+C para cancelar)\n');
  await new Promise(r => setTimeout(r, 5000));
}

// ── Paso 1: contar cuánto se va a borrar
console.log('Conteo previo:');
let totalRows = 0;
for (const t of TABLAS_HIJOS) {
  const n = await getCount(t);
  if (n === null) {
    console.log(`  ${t}: tabla no existe (skip)`);
    continue;
  }
  if (n > 0) {
    console.log(`  ${t}: ${n} registros`);
    totalRows += n;
  }
}
console.log(`\nTotal: ${totalRows} registros a borrar\n`);

// ── Paso 2: borrar en orden
if (APPLY) {
  console.log('Iniciando wipe...\n');
  let exitosos = 0, fallidos = 0;
  for (const t of TABLAS_HIJOS) {
    const n = await getCount(t);
    if (n === null || n === 0) continue;
    process.stdout.write(`  ${t.padEnd(36)} ${n.toString().padStart(6)} → `);
    const r = await deleteAll(t);
    if (r.ok) {
      const after = await getCount(t);
      if (after === 0) {
        console.log(`✓ wiped (0 left)`);
        exitosos++;
      } else {
        console.log(`⚠ ${after} restantes (RLS o FK?)`);
        fallidos++;
      }
    } else {
      console.log(`✗ ${r.err}`);
      fallidos++;
    }
  }
  console.log(`\n${exitosos} tablas wiped, ${fallidos} con problemas.`);
} else {
  console.log('DRY-RUN: nada se borró. Para ejecutar: --apply');
}

// ── Paso 3: borrar/desactivar users no-admin
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Users no-admin:');
const profilesR = await fetch(`${url}/rest/v1/profiles?select=id,email,rol`, {
  headers: { apikey: sk, Authorization: `Bearer ${sk}` },
});
const profiles = await profilesR.json();
const noAdmins = profiles.filter(p => p.rol !== 'admin');
console.log(`  ${noAdmins.length} users no-admin: ${noAdmins.map(p => p.email).join(', ')}`);

if (APPLY && !KEEP_USERS) {
  console.log('\nBorrando users no-admin (auth + profile)...');
  for (const p of noAdmins) {
    process.stdout.write(`  ${p.email.padEnd(35)} → `);
    // Eliminar de auth.users via Admin API
    try {
      const r1 = await fetch(`${url}/auth/v1/admin/users/${p.id}`, {
        method: 'DELETE',
        headers: { apikey: sk, Authorization: `Bearer ${sk}` },
      });
      if (!r1.ok && r1.status !== 404) {
        const t = await r1.text();
        console.log(`✗ auth ${r1.status}: ${t.slice(0,100)}`);
        continue;
      }
    } catch (e) {
      console.log(`✗ auth err: ${e.message}`);
      continue;
    }
    // Borrar profile
    try {
      const r2 = await fetch(`${url}/rest/v1/profiles?id=eq.${p.id}`, {
        method: 'DELETE',
        headers: { apikey: sk, Authorization: `Bearer ${sk}`, Prefer: 'return=minimal' },
      });
      if (!r2.ok) {
        console.log(`⚠ auth borrado, pero profile falló: HTTP ${r2.status}`);
        continue;
      }
      console.log('✓ borrado');
    } catch (e) {
      console.log(`⚠ auth borrado, profile err: ${e.message}`);
    }
  }
} else if (APPLY && KEEP_USERS) {
  console.log('\nDesactivando users no-admin (--keep-users)...');
  for (const p of noAdmins) {
    process.stdout.write(`  ${p.email.padEnd(35)} → `);
    try {
      const r = await fetch(`${url}/rest/v1/profiles?id=eq.${p.id}`, {
        method: 'PATCH',
        headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ activo: false }),
      });
      if (!r.ok) {
        console.log(`✗ HTTP ${r.status}`);
        continue;
      }
      console.log('✓ desactivado');
    } catch (e) {
      console.log(`✗ err: ${e.message}`);
    }
  }
} else {
  console.log('  (DRY-RUN: no se tocan)');
}

// ── Paso 4: resetear sync_state local solo afecta a clientes — no aplica acá
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (APPLY) {
  console.log('✓ Wipe completado. Estado del server:');
  console.log('  - 0 obras, 0 partidas, 0 materiales, 0 herramientas, 0 personal, 0 movs');
  console.log('  - 0 companies, 0 cuentas bancarias, 0 audit_log');
  console.log(`  - ${KEEP_USERS ? noAdmins.length + ' users desactivados' : '0 users no-admin'}`);
  console.log('  - 2 admins activos en profiles');
  console.log('\nEn cada device de los admins:');
  console.log('  Hacé Clear site data + reabrir browser para que el sync local');
  console.log('  vea el server vacío y limpie su Dexie.');
} else {
  console.log('DRY-RUN. Para ejecutar de verdad:');
  console.log('  node scripts/wipe-server.mjs --apply');
  console.log('  o (más conservador):');
  console.log('  node scripts/wipe-server.mjs --apply --keep-users');
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
