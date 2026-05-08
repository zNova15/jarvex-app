#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Detector de duplicados en movimientos
//
// Busca en producción registros que parecen duplicados:
//   - Mismo material/herramienta + misma cantidad + misma fecha + mismo
//     responsable/proveedor, todos creados por el MISMO usuario, separados
//     por menos de 5 minutos.
//
// Estos suelen ser artefactos del bug de doble-click pre-fix de useBusy.
// El script SOLO REPORTA. No borra nada. Vos decidís qué hacer con ellos.
//
// Uso:
//   node scripts/detect-duplicates.mjs
//
// Salida: lista de grupos de duplicados con sus IDs para que vos puedas
// borrarlos manualmente desde Supabase SQL Editor (o con un script de
// limpieza posterior si son muchos).
// ═══════════════════════════════════════════════════════════════════

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

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !sk) {
  console.error('✗ Falta VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function fetchAll(tabla) {
  const r = await fetch(`${url}/rest/v1/${tabla}?select=*&order=created_at.asc&limit=10000`, {
    headers: { apikey: sk, Authorization: `Bearer ${sk}` },
  });
  if (!r.ok) {
    console.warn(`  ⚠ ${tabla}: HTTP ${r.status}`);
    return [];
  }
  return r.json();
}

// Considera duplicados los registros que tienen los mismos campos clave
// dentro de una ventana de tiempo (default 5 minutos).
function findDuplicates(rows, keyFields, windowMs = 5 * 60 * 1000) {
  const groups = new Map();
  for (const r of rows) {
    if (r.deleted_at) continue;
    const key = keyFields.map(k => r[k] ?? '').join('||');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const duplicates = [];
  for (const [key, items] of groups) {
    if (items.length < 2) continue;
    items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let cluster = [items[0]];
    for (let i = 1; i < items.length; i++) {
      const last = cluster[cluster.length - 1];
      const diff = new Date(items[i].created_at) - new Date(last.created_at);
      if (diff < windowMs && items[i].created_by === last.created_by) {
        cluster.push(items[i]);
      } else {
        if (cluster.length >= 2) duplicates.push(cluster);
        cluster = [items[i]];
      }
    }
    if (cluster.length >= 2) duplicates.push(cluster);
  }
  return duplicates;
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Detector de duplicados en JARVEX');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ── 1. movimientos_materiales ──────────────────────────────────────
console.log('1. movimientos_materiales...');
const movs = await fetchAll('movimientos_materiales');
console.log(`   ${movs.length} registros totales`);
const dupMov = findDuplicates(movs, [
  'material_id', 'tipo_movimiento', 'cantidad', 'fecha', 'created_by',
]);
if (dupMov.length === 0) {
  console.log('   ✓ Sin duplicados sospechosos');
} else {
  console.log(`   ⚠ ${dupMov.length} grupos de duplicados detectados:`);
  for (const cluster of dupMov.slice(0, 10)) {
    const first = cluster[0];
    console.log(`     · material=${first.material_id?.slice(0,8)} · ${first.tipo_movimiento} ` +
                `· ${first.cantidad} · ${first.fecha} → ${cluster.length} entradas:`);
    for (const r of cluster) {
      console.log(`       - ${r.id} · created_at: ${r.created_at}`);
    }
  }
  if (dupMov.length > 10) console.log(`     ... y ${dupMov.length - 10} grupos más`);
}

// ── 2. movimientos_herramientas ────────────────────────────────────
console.log('\n2. movimientos_herramientas...');
const movsH = await fetchAll('movimientos_herramientas');
console.log(`   ${movsH.length} registros totales`);
const dupH = findDuplicates(movsH, [
  'herramienta_id', 'tipo_movimiento', 'cantidad', 'fecha', 'created_by',
]);
if (dupH.length === 0) {
  console.log('   ✓ Sin duplicados sospechosos');
} else {
  console.log(`   ⚠ ${dupH.length} grupos de duplicados`);
  for (const cluster of dupH.slice(0, 5)) {
    console.log(`     · ${cluster.length} entradas: ${cluster.map(r => r.id.slice(0, 8)).join(', ')}`);
  }
}

// ── 3. asistencia (mismo personal, misma fecha) ────────────────────
console.log('\n3. asistencia...');
const asist = await fetchAll('asistencia');
console.log(`   ${asist.length} registros totales`);
const dupA = findDuplicates(asist, ['personal_id', 'fecha'], 24 * 60 * 60 * 1000); // 24h
if (dupA.length === 0) {
  console.log('   ✓ Sin duplicados sospechosos');
} else {
  console.log(`   ⚠ ${dupA.length} grupos de duplicados (mismo personal en misma fecha)`);
}

// ── 4. obras (nombre repetido) ─────────────────────────────────────
console.log('\n4. obras...');
const obras = await fetchAll('obras');
console.log(`   ${obras.length} registros totales`);
const obrasGrupo = new Map();
for (const o of obras) {
  if (o.deleted_at) continue;
  const key = (o.nombre_obra || '').toLowerCase().trim();
  if (!key) continue;
  if (!obrasGrupo.has(key)) obrasGrupo.set(key, []);
  obrasGrupo.get(key).push(o);
}
const obrasDup = [...obrasGrupo.entries()].filter(([_, arr]) => arr.length >= 2);
if (obrasDup.length === 0) {
  console.log('   ✓ Sin obras con nombre duplicado');
} else {
  console.log(`   ⚠ ${obrasDup.length} obras con nombre duplicado:`);
  for (const [nombre, arr] of obrasDup) {
    console.log(`     · "${nombre}" → ${arr.length} registros: ${arr.map(o => o.id.slice(0, 8)).join(', ')}`);
  }
}

// ── 5. materiales (nombre repetido en misma obra) ──────────────────
console.log('\n5. materiales...');
const mats = await fetchAll('materiales');
console.log(`   ${mats.length} registros totales`);
const matsGrupo = new Map();
for (const m of mats) {
  if (m.deleted_at) continue;
  const key = `${m.obra_id}||${(m.nombre_material || '').toLowerCase().trim()}`;
  if (!matsGrupo.has(key)) matsGrupo.set(key, []);
  matsGrupo.get(key).push(m);
}
const matsDup = [...matsGrupo.entries()].filter(([_, arr]) => arr.length >= 2);
if (matsDup.length === 0) {
  console.log('   ✓ Sin materiales con nombre duplicado en misma obra');
} else {
  console.log(`   ⚠ ${matsDup.length} materiales con nombre duplicado:`);
  for (const [key, arr] of matsDup.slice(0, 20)) {
    const [obraId, nombre] = key.split('||');
    console.log(`     · obra=${obraId.slice(0,8)} "${nombre}" → ${arr.length} registros`);
    for (const m of arr) {
      console.log(`       - ${m.id} · stock_actual=${m.stock_actual} · created: ${m.created_at}`);
    }
  }
  if (matsDup.length > 20) console.log(`     ... y ${matsDup.length - 20} más`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Resumen:');
console.log(`  · ${dupMov.length} grupos de mov. materiales duplicados`);
console.log(`  · ${dupH.length} grupos de mov. herramientas duplicados`);
console.log(`  · ${dupA.length} grupos de asistencia duplicada`);
console.log(`  · ${obrasDup.length} obras con nombre repetido`);
console.log(`  · ${matsDup.length} materiales con nombre repetido en su obra`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Si hay duplicados, revisalos manualmente antes de borrar — algunos');
console.log('pueden ser legítimos (ej: 2 ingresos del mismo material en el mismo día).');
