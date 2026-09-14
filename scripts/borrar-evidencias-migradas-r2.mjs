#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Paso final de la migración a R2: vaciar Supabase Storage.
//
// El ÚLTIMO paso de docs/migracion-r2.md (Paso 7), que ese documento dejó sin
// script porque hacía falta primero terminar de migrar y verificar. Ahora que
// `migrar-evidencias-r2.mjs` corrió limpio, esto CIERRA el ciclo: borra de
// Supabase Storage SOLO lo que ya está confirmado en R2 con el MISMO TAMAÑO.
//
// NUNCA borra a ciegas. Por cada objeto de Supabase:
//   1. HEAD a R2 en la misma ruta.
//   2. Si no está (404), o si el tamaño no coincide, o si CUALQUIER otra cosa
//      sale mal → NO se borra, se cuenta como "sin confirmar" y se lista al
//      final. Solo el 404-y-nada-más es "aborta la corrida entera" (ver
//      verificarAccesoR2, igual que en el script de migración): un token o
//      bucket mal escritos no pueden hacer que esto piense "no está en
//      ninguna parte, hay que conservar todo" y tampoco lo contrario.
//   3. Recién con el tamaño confirmado IGUAL se borra el objeto de Supabase.
//
// GRACIA POR FECHA (mismo criterio que limpiar-huerfanos-storage.mjs): no
// toca nada subido en los últimos DIAS_GRACIA días, para no pisar una carga
// reciente que el próximo ciclo de migración todavía no alcanzó a copiar.
//
// Uso (desde jarvex-app/):
//   node --env-file=.env.local scripts/borrar-evidencias-migradas-r2.mjs             # en seco (no borra)
//   node --env-file=.env.local scripts/borrar-evidencias-migradas-r2.mjs --apply     # borra de verdad
//   node --env-file=.env.local scripts/borrar-evidencias-migradas-r2.mjs --dias 60   # más conservador
//   node --env-file=.env.local scripts/borrar-evidencias-migradas-r2.mjs --apply --concurrency=12
//
// Requiere en .env.local: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
// ═══════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const BUCKET_SB = 'evidencias';
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const CONCURRENCY = Number((argv.find(a => a.startsWith('--concurrency=')) || '').split('=')[1]) || 8;
// Mismo parseo que limpiar-huerfanos-storage.mjs (`--dias 60`, con espacio).
const iDias = argv.indexOf('--dias');
const DIAS_GRACIA = iDias > -1 ? Number(argv[iDias + 1]) || 30 : 30;

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

// ── SigV4 presign para R2 (idéntico al de api/r2.js y migrar-evidencias-r2.mjs) ──
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

// Comprueba credenciales/bucket ANTES de tocar Supabase — mismo guard que el
// script de migración: un 403 no puede leerse como "no existe nada".
async function verificarAccesoR2() {
  const resp = await fetch(presignR2('HEAD', '_preflight/0000-00/ping.txt'), { method: 'HEAD' });
  if (resp.status === 404 || resp.ok) return;
  throw new Error(`No hay acceso al bucket '${R2_BUCKET}' (HTTP ${resp.status}). Revisá las variables R2_* en .env.local.`);
}

// { existe, tamano } — nunca tira: un error de red cuenta como "no confirmado".
async function estadoEnR2(key) {
  try {
    const resp = await fetch(presignR2('HEAD', key), { method: 'HEAD' });
    if (resp.status === 404) return { existe: false, tamano: null };
    if (!resp.ok) return { existe: false, tamano: null, error: `HTTP ${resp.status}` };
    const len = resp.headers.get('content-length');
    return { existe: true, tamano: len != null ? Number(len) : null };
  } catch (e) {
    return { existe: false, tamano: null, error: e?.message || String(e) };
  }
}

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
      if (entry.id === null) {
        out.push(...await listarTodo(full));
      } else {
        out.push({
          path: full,
          size: entry.metadata?.size ?? null,
          updatedAt: entry.updated_at || entry.created_at || null,
        });
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// Verifica UN objeto y, si corresponde y APPLY está activo, lo borra.
async function procesarUno(obj) {
  const edad = obj.updatedAt ? (Date.now() - new Date(obj.updatedAt).getTime()) / 86400000 : 0;
  if (edad < DIAS_GRACIA) return { path: obj.path, estado: 'muy-reciente' };

  const r2 = await estadoEnR2(obj.path);
  if (!r2.existe) return { path: obj.path, estado: 'sin-confirmar', detalle: r2.error || 'no está en R2' };
  if (obj.size != null && r2.tamano != null && obj.size !== r2.tamano) {
    return { path: obj.path, estado: 'sin-confirmar', detalle: `tamaño distinto: Supabase ${obj.size} B, R2 ${r2.tamano} B` };
  }

  if (!APPLY) return { path: obj.path, estado: 'confirmado (dry-run, no se borró)' };

  const { error } = await supabase.storage.from(BUCKET_SB).remove([obj.path]);
  if (error) return { path: obj.path, estado: 'sin-confirmar', detalle: `borrado falló: ${error.message}` };
  return { path: obj.path, estado: 'borrado' };
}

async function main() {
  console.log(`\n🧹 Vaciar Supabase Storage de lo ya migrado a R2 (bucket: ${R2_BUCKET})`);
  console.log(`   modo: ${APPLY ? '⚠️  APPLY (borra de verdad)' : 'DRY-RUN (no borra nada)'} · gracia: ${DIAS_GRACIA} días · concurrencia: ${CONCURRENCY}\n`);

  process.stdout.write('🔑 Verificando acceso a R2… ');
  await verificarAccesoR2();
  console.log('OK\n');

  console.log('📋 Listando el bucket de Supabase…');
  const objetos = await listarTodo('');
  console.log(`   ${objetos.length} objetos\n`);
  if (!objetos.length) { console.log('Nada que hacer.'); return; }

  let hechos = 0, confirmados = 0, borrados = 0, sinConfirmar = 0, recientes = 0;
  const fallidos = [];
  const cola = [...objetos];
  async function worker() {
    for (;;) {
      const obj = cola.shift();
      if (!obj) break;
      const r = await procesarUno(obj);
      hechos++;
      if (r.estado === 'borrado') { borrados++; confirmados++; }
      else if (r.estado.startsWith('confirmado')) confirmados++;
      else if (r.estado === 'muy-reciente') recientes++;
      else { sinConfirmar++; fallidos.push(r); }
      if (hechos % 25 === 0 || hechos === objetos.length) {
        const pct = ((hechos / objetos.length) * 100).toFixed(0);
        process.stdout.write(`\r   ⏳ ${hechos}/${objetos.length} (${pct}%) · confirmados ${confirmados} · borrados ${borrados} · sin confirmar ${sinConfirmar} · muy recientes ${recientes}   `);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('\n');

  if (fallidos.length) {
    console.log(`⚠️  ${fallidos.length} sin confirmar (NO se tocaron):`);
    for (const f of fallidos.slice(0, 30)) console.log(`   ✗ ${f.path} — ${f.detalle}`);
    if (fallidos.length > 30) console.log(`   … y ${fallidos.length - 30} más`);
  }

  console.log(`\n✅ Listo: ${confirmados} confirmados en R2${APPLY ? ` (${borrados} borrados de Supabase)` : ' (dry-run: ninguno borrado todavía)'}, ${recientes} muy recientes (sin tocar), ${sinConfirmar} sin confirmar (sin tocar).`);
  if (!APPLY && confirmados > 0) {
    console.log(`   Corré de nuevo con --apply para borrar los ${confirmados} confirmados.`);
  }
  if (sinConfirmar) process.exit(1);
}

main().catch(e => { console.error('\n❌ Abortado:', e.message); process.exit(1); });
