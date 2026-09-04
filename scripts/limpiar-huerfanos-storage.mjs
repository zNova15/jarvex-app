#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Borra los archivos del bucket `evidencias` que ya no usa nadie
//
// Un "huérfano" es un objeto en Storage cuyo path NO aparece en el
// `url_archivo` de ninguna fila de `evidencias`. Nadie lo puede abrir desde
// la app: no hay pantalla que lo liste, porque todas parten de la tabla.
//
// Medido el 4-sep-2026 contra producción: 86 objetos, 19,7 MB.
//
// ── LA RED DE SEGURIDAD QUE IMPORTA ──────────────────────────────
// Una subida EN VUELO se ve igual que un huérfano: el archivo ya está en
// Storage y la fila de `evidencias` todavía no sincronizó. Borrarla sería
// destruir una evidencia recién cargada. Por eso el script NO borra nada
// subido en los últimos DIAS_GRACIA días (30 por defecto).
//
// Verificado antes de escribir esto: de los 86 huérfanos, el más nuevo era
// del 4-ago — ninguno reciente. La guarda igual queda, para la próxima vez.
//
// Uso:
//   node scripts/limpiar-huerfanos-storage.mjs            # en seco (no borra)
//   node scripts/limpiar-huerfanos-storage.mjs --apply    # borra de verdad
//   node scripts/limpiar-huerfanos-storage.mjs --dias 60  # más conservador
//
// Necesita SUPABASE_SERVICE_ROLE_KEY en .env.local (no está en el repo).
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
  console.error('✗ Falta VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const iDias = process.argv.indexOf('--dias');
const DIAS_GRACIA = iDias > -1 ? Number(process.argv[iDias + 1]) || 30 : 30;
const BUCKET = 'evidencias';

const H = { apikey: sk, Authorization: `Bearer ${sk}` };
const mb = (b) => (b / 1048576).toFixed(1);

async function rest(path, opts = {}) {
  const r = await fetch(`${url}${path}`, {
    ...opts,
    headers: { ...H, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// ── 1. Los paths que la app SÍ usa ────────────────────────────────
// Se leen todas las evidencias paginando: con 1.744 filas una sola query
// entra, pero el día que sean 20.000 esto no se rompe.
async function pathsEnUso() {
  const usados = new Set();
  const PAGE = 1000;
  for (let desde = 0; ; desde += PAGE) {
    const filas = await rest(
      `/rest/v1/evidencias?select=url_archivo&url_archivo=not.is.null&limit=${PAGE}&offset=${desde}`);
    for (const f of filas) {
      const i = String(f.url_archivo).indexOf(`/${BUCKET}/`);
      if (i === -1) continue;
      let p = String(f.url_archivo).slice(i + BUCKET.length + 2);
      const q = p.indexOf('?');
      if (q !== -1) p = p.slice(0, q);
      if (p) usados.add(p);
    }
    if (filas.length < PAGE) break;
  }
  return usados;
}

// ── 2. Todo lo que hay en el bucket ───────────────────────────────
// La API de Storage lista por carpeta, así que se recorre en profundidad.
async function listarBucket(prefijo = '', salida = []) {
  const PAGE = 1000;
  for (let desde = 0; ; desde += PAGE) {
    const r = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: prefijo, limit: PAGE, offset: desde }),
    });
    if (!r.ok) throw new Error(`list ${prefijo} → ${r.status} ${await r.text()}`);
    const items = await r.json();
    for (const it of items) {
      const full = prefijo ? `${prefijo}/${it.name}` : it.name;
      // Sin `id` = es una carpeta, no un archivo.
      if (it.id) salida.push({ name: full, size: it.metadata?.size || 0, created_at: it.created_at });
      else await listarBucket(full, salida);
    }
    if (items.length < PAGE) break;
  }
  return salida;
}

const main = async () => {
  console.log(`\n🔎 Revisando el bucket "${BUCKET}"…\n`);
  const [usados, objetos] = await Promise.all([pathsEnUso(), listarBucket()]);
  console.log(`   ${objetos.length} archivos en Storage · ${usados.size} referenciados por la app`);

  const corte = Date.now() - DIAS_GRACIA * 86400000;
  const huerfanos = objetos.filter(o => !usados.has(o.name));
  const enGracia = huerfanos.filter(o => new Date(o.created_at).getTime() > corte);
  const borrables = huerfanos.filter(o => new Date(o.created_at).getTime() <= corte);

  const total = borrables.reduce((s, o) => s + o.size, 0);
  console.log(`   ${huerfanos.length} sin referencia`);
  if (enGracia.length) {
    console.log(`   ⏳ ${enGracia.length} protegidos: subidos hace menos de ${DIAS_GRACIA} días`);
    console.log(`      (pueden ser subidas cuyo registro todavía no sincronizó — NO se tocan)`);
  }
  console.log(`   🗑  ${borrables.length} borrables · ${mb(total)} MB\n`);

  if (!borrables.length) { console.log('Nada que hacer.\n'); return; }

  for (const o of borrables.slice(0, 15)) {
    console.log(`      ${String(mb(o.size)).padStart(6)} MB  ${o.created_at.slice(0, 10)}  ${o.name}`);
  }
  if (borrables.length > 15) console.log(`      … y ${borrables.length - 15} más`);

  if (!APPLY) {
    console.log(`\n⚠️  EN SECO — no se borró nada.`);
    console.log(`   Para borrar de verdad:  node scripts/limpiar-huerfanos-storage.mjs --apply\n`);
    return;
  }

  console.log(`\n🗑  Borrando ${borrables.length} archivos…`);
  let hechos = 0;
  for (let i = 0; i < borrables.length; i += 100) {
    const lote = borrables.slice(i, i + 100).map(o => o.name);
    const r = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: lote }),
    });
    if (!r.ok) { console.error(`   ✗ lote ${i}: ${r.status} ${await r.text()}`); continue; }
    hechos += lote.length;
    console.log(`   ✓ ${hechos}/${borrables.length}`);
  }
  console.log(`\n✅ Listo: ${hechos} archivos borrados, ${mb(total)} MB liberados.\n`);
};

main().catch(e => { console.error('\n✗', e.message, '\n'); process.exit(1); });
