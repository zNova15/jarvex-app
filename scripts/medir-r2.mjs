#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — Cuánto hay hoy en el bucket R2 (jarvex-evidencias).
//
// Cloudflare no expone esto por ninguna herramienta de Claude (ni por MCP: el
// conector solo da metadata del bucket, no bytes ni objetos). Lo único
// disponible es la API S3-compatible de R2, así que este script firma un
// ListObjectsV2 con las MISMAS credenciales que ya usa la migración
// (scripts/migrar-evidencias-r2.mjs) y suma lo que encuentra. SOLO LEE: no
// sube, no borra, no toca nada.
//
// Uso: node --env-file=.env.local scripts/medir-r2.mjs
// Requiere las mismas variables que la migración: R2_ACCOUNT_ID,
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
// ═══════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET || 'jarvex-evidencias';

for (const [k, v] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET })) {
  if (!v) { console.error(`❌ Falta la variable de entorno: ${k}`); process.exit(1); }
}

function hmac(key, data) { return crypto.createHmac('sha256', key).update(data, 'utf8').digest(); }
function sha256hex(data) { return crypto.createHash('sha256').update(data, 'utf8').digest('hex'); }

// Presign de un GET a la RAÍZ del bucket (ListObjectsV2), no a un objeto —
// por eso canonicalUri es solo `/${R2_BUCKET}` y los query params van
// firmados junto con los de autenticación (orden alfabético, como pide SigV4).
function presignList({ continuationToken = null, maxKeys = 1000 } = {}) {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const region = 'auto', service = 's3';
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = `/${R2_BUCKET}`;
  const params = {
    'list-type': '2',
    'max-keys': String(maxKeys),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${R2_ACCESS_KEY_ID}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '60',
    'X-Amz-SignedHeaders': 'host',
  };
  if (continuationToken) params['continuation-token'] = continuationToken;
  const canonicalQuery = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const canonicalRequest = ['GET', canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${R2_SECRET}`, dateStamp), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// Parser XML mínimo: el XML de ListObjectsV2 es plano (sin anidar Contents),
// así que match por regex alcanza y evita sumar una dependencia solo para esto.
function extraerTodos(xml, tag) {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

async function main() {
  let total = 0, bytes = 0, token = null;
  const porMes = new Map(); // 'YYYY-MM' del PREFIJO del key (si lo trae) → bytes
  let vueltas = 0;
  for (;;) {
    vueltas++;
    const resp = await fetch(presignList({ continuationToken: token }));
    const xml = await resp.text();
    if (!resp.ok) {
      console.error(`❌ ListObjectsV2 devolvió ${resp.status}:\n${xml.slice(0, 500)}`);
      process.exit(1);
    }
    const keys = extraerTodos(xml, 'Key');
    const sizes = extraerTodos(xml, 'Size').map(Number);
    for (let i = 0; i < keys.length; i++) {
      total++;
      bytes += sizes[i] || 0;
      const mm = keys[i].match(/\/(\d{4}-\d{2})\//);
      const mes = mm ? mm[1] : '(sin fecha en el path)';
      porMes.set(mes, (porMes.get(mes) || 0) + (sizes[i] || 0));
    }
    const truncated = (xml.match(/<IsTruncated>([^<]*)<\/IsTruncated>/) || [])[1] === 'true';
    token = (xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/) || [])[1] || null;
    process.stdout.write(`\r⏳ ${total} objetos leídos (página ${vueltas})…`);
    if (!truncated || !token) break;
  }
  console.log('\n');
  console.log(`📦 Bucket R2 "${R2_BUCKET}"`);
  console.log(`   ${total} objetos · ${(bytes / 1024 / 1024).toFixed(1)} MB (${(bytes / 1024 / 1024 / 1024).toFixed(3)} GB)`);
  console.log('\n   Por mes (del path, cuando lo trae):');
  for (const [mes, b] of [...porMes.entries()].sort()) {
    console.log(`     ${mes}: ${(b / 1024 / 1024).toFixed(1)} MB`);
  }
}

main().catch(e => { console.error('❌', e.message || e); process.exit(1); });
