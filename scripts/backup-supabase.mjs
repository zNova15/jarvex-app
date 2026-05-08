#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Backup de Supabase vía REST API
//
// Funciona en redes que bloquean el puerto Postgres (5432/6543) porque
// usa solo HTTPS (443). Usa la SERVICE_ROLE_KEY para bypassear RLS y
// leer TODAS las filas de TODAS las tablas del schema public.
//
// Uso:
//   node scripts/backup-supabase.mjs
//
// Variables (en .env.local):
//   VITE_SUPABASE_URL          → URL del proyecto
//   SUPABASE_SERVICE_ROLE_KEY  → clave service_role (NO la anon!)
//   BACKUP_DIR (default ~/jarvex-backups)
//
// Salida: <BACKUP_DIR>/jarvex-YYYYMMDD-HHMM/<tabla>.jsonl
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_DIR   = resolve(__dirname, '..');

// ── Cargar .env.local ─────────────────────────────────────────────
const envFile = join(REPO_DIR, '.env.local');
if (existsSync(envFile)) {
  const content = readFileSync(envFile, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── Validar config ────────────────────────────────────────────────
let supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('✗ Faltan variables:');
  if (!supabaseUrl)     console.error('  VITE_SUPABASE_URL (o SUPABASE_URL)');
  if (!serviceRoleKey)  console.error('  SUPABASE_SERVICE_ROLE_KEY');
  console.error('');
  console.error('  Sacá SERVICE_ROLE_KEY de:');
  console.error('  Supabase Dashboard → Settings → API → "service_role" → Reveal');
  console.error('  ⚠ Esa clave bypassea RLS — guardala SOLO en .env.local (gitignored).');
  process.exit(1);
}

// Normalizar URL: quitar trailing /rest/v1/ si lo tiene
supabaseUrl = supabaseUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');

const BACKUP_DIR = process.env.BACKUP_DIR
  ? process.env.BACKUP_DIR.replace(/^~/, homedir()).replace(/^\$HOME/, homedir())
  : join(homedir(), 'jarvex-backups');

mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString()
  .replace(/[-:]/g, '')
  .replace('T', '-')
  .slice(0, 13);
const dumpDir = join(BACKUP_DIR, `jarvex-${stamp}`);
mkdirSync(dumpDir, { recursive: true });

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('JARVEX backup (REST API, HTTPS)');
console.log(`URL:     ${supabaseUrl}`);
console.log(`Output:  ${dumpDir}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const startedAt = Date.now();

// ── Headers comunes ──────────────────────────────────────────────
const baseHeaders = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

// ── Listar tablas vía RPC nativo de PostgREST ────────────────────
// PostgREST expone /rest/v1/?schema=public con OpenAPI; las tablas
// aparecen en la spec. Usamos un endpoint más directo: pgrest devuelve
// el spec si pegamos a la raíz con Accept: application/openapi+json
async function listarTablas() {
  // Llamamos a /rest/v1/ con Accept: application/openapi+json y parseamos
  const r = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: { ...baseHeaders, Accept: 'application/openapi+json' },
  });
  if (!r.ok) {
    throw new Error(`No se pudo listar tablas: HTTP ${r.status} — ${await r.text()}`);
  }
  const spec = await r.json();
  // Las tablas aparecen como paths que NO empiezan con / seguido de RPC
  const tablas = Object.keys(spec.paths || {})
    .filter(p => /^\/[a-z_][a-z0-9_]*$/i.test(p))
    .map(p => p.slice(1))
    .filter(t => !t.startsWith('rpc_') && !t.startsWith('_'));
  return tablas.sort();
}

const tablas = await listarTablas();
console.log(`Tablas a backupear: ${tablas.length}\n`);

const manifest = {
  generated_at: new Date().toISOString(),
  source: { url: supabaseUrl, method: 'rest-api' },
  tables: {},
};

let totalRows = 0;
const PAGE = 1000; // PostgREST default max es ~1000

for (const tabla of tablas) {
  process.stdout.write(`  ${tabla.padEnd(40)} `);
  const filePath = join(dumpDir, `${tabla}.jsonl`);
  let total = 0;
  let allLines = [];

  try {
    let from = 0;
    while (true) {
      const url = `${supabaseUrl}/rest/v1/${encodeURIComponent(tabla)}?select=*`;
      const r = await fetch(url, {
        headers: {
          ...baseHeaders,
          Range: `${from}-${from + PAGE - 1}`,
          'Range-Unit': 'items',
          Prefer: 'count=exact',
        },
      });
      if (!r.ok) {
        // Algunas tablas son views o tienen permisos especiales — saltamos con warning
        const txt = await r.text().catch(() => '');
        manifest.tables[tabla] = { error: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
        console.log(`✗ HTTP ${r.status}`);
        break;
      }
      const rows = await r.json();
      if (!Array.isArray(rows)) {
        manifest.tables[tabla] = { error: 'respuesta no es array' };
        console.log('✗ formato');
        break;
      }
      for (const row of rows) {
        allLines.push(JSON.stringify(row));
      }
      total += rows.length;
      if (rows.length < PAGE) break;
      from += PAGE;
    }

    if (manifest.tables[tabla]?.error) continue;

    if (allLines.length === 0) {
      writeFileSync(filePath, '');
    } else {
      writeFileSync(filePath, allLines.join('\n') + '\n');
    }

    const size = statSync(filePath).size;
    const hash = createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 16);

    manifest.tables[tabla] = {
      rows: total,
      size_bytes: size,
      sha256_prefix: hash,
    };
    totalRows += total;
    console.log(`${String(total).padStart(8)} rows · ${humanSize(size)}`);
  } catch (e) {
    console.log(`✗ ${e.message}`);
    manifest.tables[tabla] = { error: e.message };
  }
}

// ── Manifest ─────────────────────────────────────────────────────
manifest.summary = {
  total_tables: tablas.length,
  total_rows: totalRows,
  duration_ms: Date.now() - startedAt,
};
writeFileSync(join(dumpDir, '_manifest.json'), JSON.stringify(manifest, null, 2));

let totalSize = 0;
for (const info of Object.values(manifest.tables)) {
  if (info.size_bytes) totalSize += info.size_bytes;
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✓ Backup completo en ${(manifest.summary.duration_ms / 1000).toFixed(1)}s`);
console.log(`  Tablas:  ${tablas.length}`);
console.log(`  Filas:   ${totalRows.toLocaleString()}`);
console.log(`  Tamaño:  ${humanSize(totalSize)}`);
console.log(`  Carpeta: ${dumpDir}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ── Limpieza de backups viejos ──────────────────────────────────
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
let deleted = 0;
for (const name of readdirSync(BACKUP_DIR)) {
  if (!name.startsWith('jarvex-')) continue;
  const p = join(BACKUP_DIR, name);
  const st = statSync(p);
  if (st.isDirectory() && st.mtimeMs < cutoff) {
    rmSync(p, { recursive: true, force: true });
    deleted++;
  }
}
if (deleted > 0) {
  console.log(`Limpieza:  ${deleted} backups con > ${RETENTION_DAYS} días eliminados`);
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
