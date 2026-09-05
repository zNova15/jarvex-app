#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Migración de fotos de evidencias: Supabase Storage → Cloudflare R2.
//
// Copia TODOS los objetos del bucket `evidencias` a un bucket R2, con la MISMA
// ruta (`<obra>/<aaaa-mm>/<id>.<ext>`). NO borra nada de Supabase: queda intacto
// como respaldo hasta que Gabriel confirme que R2 anda bien un ciclo entero.
//
// Uso (desde jarvex-app/):
//   node --env-file=.env.local scripts/migrar-evidencias-r2.mjs            # migra (salta los que ya están)
//   node --env-file=.env.local scripts/migrar-evidencias-r2.mjs --dry-run  # solo lista, no sube
//   node --env-file=.env.local scripts/migrar-evidencias-r2.mjs --force    # re-sube aunque ya exista
//   node --env-file=.env.local scripts/migrar-evidencias-r2.mjs --concurrency=12
//
// Requiere en .env.local: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
// ═══════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const BUCKET_SB = 'evidencias';
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const FORCE = argv.includes('--force');
const CONCURRENCY = Number((argv.find(a => a.startsWith('--concurrency=')) || '').split('=')[1]) || 8;

// Normalizar: la variable a veces viene con el sufijo '/rest/v1/' pegado. El
// cliente necesita la URL BASE del proyecto; con el sufijo, las llamadas a
// Storage terminaban en '/rest/v1/storage/v1/...' y contestaba PostgREST con
// "Invalid path specified in request URL" (PGRST125).
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '')
  .replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET || 'jarvex-evidencias';

for (const [k, v] of Object.entries({ SUPABASE_URL, SERVICE_ROLE, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET })) {
  if (!v) { console.error(`❌ Falta la variable de entorno: ${k}`); process.exit(1); }
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ── SigV4 presign para R2 (idéntico al de api/r2.js) ──────────────────
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data, 'utf8').digest(); }
function sha256hex(data) { return crypto.createHash('sha256').update(data, 'utf8').digest('hex'); }
function encodeKey(key) { return key.split('/').map(encodeURIComponent).join('/'); }
function presignR2(method, key, expires = 3600) {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const region = 'auto', service = 's3';
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = `/${R2_BUCKET}/${encodeKey(key)}`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${R2_ACCESS_KEY_ID}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${R2_SECRET}`, dateStamp), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ¿Ya está en R2? Distingue 404 (no está: hay que subirlo) de CUALQUIER otro
// error. Si tratáramos un 403 como "no está", una credencial o un bucket mal
// escritos harían que el script se descargue el bucket ENTERO de Supabase
// (pagando justo el egress que queremos eliminar) para no subir nada.
async function existeEnR2(key) {
  const resp = await fetch(presignR2('HEAD', key), { method: 'HEAD' });
  if (resp.status === 404) return false;
  if (resp.ok) return true;
  throw new Error(`HEAD a R2 devolvió ${resp.status}. Revisá R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET.`);
}

// Reintento con backoff para errores transitorios (red, 429, 5xx).
async function conReintento(fn, intentos = 3) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try { return await fn(); } catch (e) {
      ultimo = e;
      if (i < intentos - 1) await new Promise(r => setTimeout(r, 1000 * Math.pow(3, i)));
    }
  }
  throw ultimo;
}

// Comprueba credenciales/bucket ANTES de tocar Supabase. Un HEAD a una clave
// centinela inexistente debe dar 404; cualquier otra cosa aborta la corrida.
async function verificarAccesoR2() {
  const resp = await fetch(presignR2('HEAD', '_preflight/0000-00/ping.txt'), { method: 'HEAD' });
  if (resp.status === 404 || resp.ok) return;
  throw new Error(`No hay acceso al bucket '${R2_BUCKET}' (HTTP ${resp.status}). Revisá las variables R2_* en .env.local y que el token tenga permiso 'Object Read & Write' sobre ese bucket.`);
}

// ── Listar recursivamente el bucket de Supabase ───────────────────────
async function listarTodo(prefix = '') {
  const out = [];
  let offset = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET_SB).list(prefix, {
      limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list(${prefix}): ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Carpeta: id === null (Supabase Storage). Archivo: tiene metadata/id.
      if (entry.id === null) {
        out.push(...await listarTodo(full));
      } else {
        out.push({ path: full, size: entry.metadata?.size ?? null });
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// ── Migrar un objeto ──────────────────────────────────────────────────
// Migra un objeto. NUNCA tira: un fallo puntual no puede abortar la corrida
// entera (supabase-js RE-TIRA los errores que no son StorageError, y un
// ECONNRESET en el PUT también) — sin este try/catch, Promise.all rechazaba en
// el acto y se perdían el resumen y los objetos ya procesados.
async function migrarUno(obj) {
  try {
    if (!FORCE && await existeEnR2(obj.path)) return { path: obj.path, estado: 'ya-estaba' };
    const { data: blob, error } = await conReintento(async () => {
      const r = await supabase.storage.from(BUCKET_SB).download(obj.path);
      if (r.error) throw new Error(r.error.message || 'download falló');
      return r;
    });
    if (error || !blob) return { path: obj.path, estado: 'error', detalle: `download: ${error?.message || 'sin blob'}` };
    const buf = Buffer.from(await blob.arrayBuffer());
    // Verificación de integridad: si Supabase cortó el cuerpo a mitad, el
    // tamaño no coincide → mejor fallar que subir un archivo truncado y darlo
    // por migrado (el HEAD del próximo pase lo daría por bueno para siempre).
    if (obj.size != null && buf.length !== obj.size) {
      return { path: obj.path, estado: 'error', detalle: `tamaño no coincide: bajó ${buf.length} B, esperaba ${obj.size} B` };
    }
    const contentType = blob.type || 'application/octet-stream';
    const resp = await conReintento(async () => {
      const r = await fetch(presignR2('PUT', obj.path), {
        method: 'PUT',
        body: buf,
        headers: {
          'Content-Type': contentType,
          // 30 días: la evidencia es inmutable. R2 lo guarda como metadata y lo
          // devuelve en cada GET (igual que el cacheControl que usaba Supabase).
          'Cache-Control': 'public, max-age=2592000, immutable',
        },
      });
      // 5xx/429 = transitorio → reintentar. 4xx = definitivo → devolver.
      if (r.status >= 500 || r.status === 429) throw new Error(`HTTP ${r.status}`);
      return r;
    });
    if (!resp.ok) return { path: obj.path, estado: 'error', detalle: `PUT R2: HTTP ${resp.status} ${await resp.text().catch(() => '')}` };
    return { path: obj.path, estado: 'subido', bytes: buf.length };
  } catch (e) {
    return { path: obj.path, estado: 'error', detalle: e?.message || String(e) };
  }
}

// ── Correr con límite de concurrencia + progreso visible ──────────────
async function main() {
  console.log(`\n🚚 Migración de evidencias Supabase → R2 (bucket destino: ${R2_BUCKET})`);
  console.log(`   modo: ${DRY_RUN ? 'DRY-RUN (no sube)' : FORCE ? 'FORCE (re-sube todo)' : 'normal (salta existentes)'} · concurrencia: ${CONCURRENCY}\n`);
  process.stdout.write('🔑 Verificando acceso a R2… ');
  await verificarAccesoR2();
  console.log('OK\n');
  console.log('📋 Listando el bucket de Supabase…');
  const objetos = await listarTodo('');
  const totalBytes = objetos.reduce((a, o) => a + (o.size || 0), 0);
  console.log(`   ${objetos.length} objetos · ${(totalBytes / 1024 / 1024).toFixed(1)} MB\n`);
  if (DRY_RUN) {
    for (const o of objetos.slice(0, 20)) console.log(`   ${o.path}  (${o.size ?? '?'} B)`);
    if (objetos.length > 20) console.log(`   … y ${objetos.length - 20} más`);
    console.log('\n(DRY-RUN: no se subió nada)');
    return;
  }

  let hechos = 0, subidos = 0, yaEstaban = 0, errores = 0;
  const fallidos = [];
  const cola = [...objetos];
  async function worker() {
    for (;;) {
      const obj = cola.shift();
      if (!obj) break;
      const r = await migrarUno(obj);
      hechos++;
      if (r.estado === 'subido') subidos++;
      else if (r.estado === 'ya-estaba') yaEstaban++;
      else { errores++; fallidos.push(r); }
      if (hechos % 25 === 0 || hechos === objetos.length) {
        const pct = ((hechos / objetos.length) * 100).toFixed(0);
        process.stdout.write(`\r   ⏳ ${hechos}/${objetos.length} (${pct}%) · subidos ${subidos} · ya estaban ${yaEstaban} · errores ${errores}   `);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('\n');

  if (fallidos.length) {
    console.log(`⚠️  ${fallidos.length} fallaron:`);
    for (const f of fallidos.slice(0, 30)) console.log(`   ✗ ${f.path} — ${f.detalle}`);
    if (fallidos.length > 30) console.log(`   … y ${fallidos.length - 30} más`);
  }
  console.log(`\n✅ Listo: ${subidos} subidos, ${yaEstaban} ya estaban, ${errores} errores (de ${objetos.length}).`);
  console.log(`   Supabase queda INTACTO como respaldo. Verificá la app antes de vaciarlo.\n`);
  if (errores) process.exit(1);
}

main().catch(e => { console.error('\n❌ Migración abortada:', e.message); process.exit(1); });
