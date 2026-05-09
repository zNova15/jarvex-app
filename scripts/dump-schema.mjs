#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Genera docs/SCHEMA.md desde el server actual
//
// Hace una snapshot del schema de Supabase: tablas, columnas, tipos,
// nullable, defaults, FKs. Útil para tener un reference vivo del
// schema (no las migrations que pueden estar desactualizadas
// respecto al estado real).
//
// Uso:
//   node scripts/dump-schema.mjs        # imprime a stdout
//   node scripts/dump-schema.mjs --save # escribe a docs/SCHEMA.md
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

const SAVE = process.argv.includes('--save');

// PostgREST expone OpenAPI con todo el schema en GET / del REST API.
async function fetchOpenAPI() {
  const r = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: sk, Authorization: `Bearer ${sk}`, Accept: 'application/openapi+json' },
  });
  if (!r.ok) throw new Error(`OpenAPI: HTTP ${r.status}`);
  return r.json();
}

const spec = await fetchOpenAPI();
const defs = spec.definitions || {};
const tablas = Object.keys(defs).sort();

const lines = [];
lines.push('# JARVEX — Schema Supabase (auto-generado)');
lines.push('');
lines.push(`> Generado: ${new Date().toISOString().slice(0,10)} con \`node scripts/dump-schema.mjs\`.`);
lines.push('> NO editar a mano — re-correr el script para actualizar.');
lines.push('');
lines.push(`Tablas en \`public\`: **${tablas.length}**`);
lines.push('');

// Índice
lines.push('## Índice');
for (const t of tablas) {
  lines.push(`- [${t}](#${t.replace(/_/g, '_')})`);
}
lines.push('');

// Detalle por tabla
for (const t of tablas) {
  const def = defs[t];
  const props = def.properties || {};
  const required = new Set(def.required || []);

  lines.push(`## \`${t}\``);
  lines.push('');
  if (def.description) {
    lines.push(`> ${def.description.split('\n')[0]}`);
    lines.push('');
  }
  lines.push('| Columna | Tipo | Nullable | Default | Notas |');
  lines.push('|---|---|---|---|---|');

  for (const [col, info] of Object.entries(props)) {
    const tipo = info.format || info.type || '?';
    const nullable = required.has(col) ? 'no' : 'sí';
    const def_v = info.default !== undefined ? '`' + String(info.default).slice(0, 30) + '`' : '—';
    let notas = '';
    if (info.description) {
      // El description de PostgREST suele incluir referencias FK
      const fkMatch = /<fk table='([^']+)'/.exec(info.description);
      if (fkMatch) notas = `→ \`${fkMatch[1]}\``;
      else notas = info.description.split('\n')[0].slice(0, 40);
    }
    if (info.maxLength) notas += (notas ? ' · ' : '') + `max ${info.maxLength}`;
    lines.push(`| \`${col}\` | ${tipo} | ${nullable} | ${def_v} | ${notas || ''} |`);
  }
  lines.push('');
}

const content = lines.join('\n');

if (SAVE) {
  const outPath = join(REPO, 'docs', 'SCHEMA.md');
  writeFileSync(outPath, content);
  console.log(`✓ ${outPath} actualizado · ${tablas.length} tablas · ${content.length} bytes`);
} else {
  console.log(content);
}
