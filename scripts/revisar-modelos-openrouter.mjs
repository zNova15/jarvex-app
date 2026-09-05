#!/usr/bin/env node
// Revisa si la cadena de modelos gratuitos de OpenRouter sigue viva.
//
// POR QUÉ EXISTE: ningún modelo gratuito es permanente. Los `:free` de DeepSeek
// fueron los más usados de 2025 y a mediados de 2026 estaban todos en pago; los
// tiers gratis de Llama y Qwen desaparecieron antes de agosto de 2026. La lista
// rota sin aviso. Este script contesta, en 30 segundos, dos preguntas:
//   1. ¿Los modelos que JARVEX tiene configurados siguen gratis y respondiendo?
//   2. Si alguno cayó, ¿qué gratuito lo reemplaza cumpliendo la MISMA política
//      de privacidad?
//
// No cambia nada: solo mira e informa. Correr cada tanto (o cuando la bandeja
// de Captura Mágica empiece a mostrar filas en ámbar con "(respaldo)").
//
//   node --env-file=.env.local scripts/revisar-modelos-openrouter.mjs
//   OPENROUTER_API_KEY=sk-or-... node scripts/revisar-modelos-openrouter.mjs
//
// Con --probar hace además una llamada real (barata, 20 tokens) a cada modelo
// de la cadena para ver si de verdad contesta y no solo si está listado.

import { leerConfig, construirCuerpo, openrouterChat, errorDelCuerpo } from '../lib/openrouter.js';

const PROBAR = process.argv.includes('--probar');
const cfg = leerConfig({ ...process.env, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || 'x' });

if (!process.env.OPENROUTER_API_KEY) {
  console.error('Falta OPENROUTER_API_KEY. Pasala por --env-file=.env.local o por variable de entorno.');
  process.exit(1);
}

const HOY = new Date();
const dias = (ts) => (ts ? Math.round((HOY - new Date(ts * 1000)) / 86400000) : null);

const catalogo = await fetch('https://openrouter.ai/api/v1/models')
  .then((r) => r.json())
  .then((j) => j.data || []);

const gratis = catalogo.filter((m) =>
  Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0);
const porId = new Map(catalogo.map((m) => [m.id, m]));

console.log(`\nCatálogo de OpenRouter: ${catalogo.length} modelos, ${gratis.length} gratuitos.`);
console.log(`Política de datos exigida: ${cfg.politica === 'zdr' ? 'zdr (Zero Data Retention)' : 'deny (no entrenar)'}\n`);

// ── 1. La cadena configurada ──────────────────────────────────────
const cadena = [cfg.modelo, ...cfg.respaldos];
console.log('CADENA CONFIGURADA (en orden):');
let caidos = 0;
for (const id of cadena) {
  const m = porId.get(id);
  if (!m) {
    caidos++;
    console.log(`  ❌ ${id.padEnd(46)} YA NO ESTÁ EN EL CATÁLOGO`);
    continue;
  }
  const esGratis = Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;
  const edad = dias(m.created);
  if (!esGratis) {
    caidos++;
    console.log(`  💸 ${id.padEnd(46)} YA NO ES GRATIS (in $${m.pricing.prompt}/tok)`);
    continue;
  }
  console.log(`  ✅ ${id.padEnd(46)} gratis · listado hace ${edad} días`);
}

// ── 2. Prueba real (opcional) ─────────────────────────────────────
if (PROBAR) {
  console.log('\nPRUEBA REAL (una llamada de 20 tokens a cada uno, con la política puesta):');
  for (const id of cadena) {
    const t0 = Date.now();
    try {
      const d = await openrouterChat(process.env.OPENROUTER_API_KEY, construirCuerpo({
        modelo: id, respaldos: [], politica: cfg.politica,
        system: 'Responde con una sola palabra.', user: 'Di OK', maxTokens: 20,
      }), Date.now() + 60000, { intentos: 1 });
      console.log(`  ✅ ${id.padEnd(46)} ${Date.now() - t0} ms · proveedor ${d.provider}`);
    } catch (e) {
      const nota = e.politicaImposible ? 'NO cumple la política de datos'
        : e.upstreamStatus === 429 ? 'saturado (429)'
        : `${e.upstreamStatus || e.name}`;
      console.log(`  ❌ ${id.padEnd(46)} ${nota}`);
    }
  }
}

// ── 3. Alternativas ───────────────────────────────────────────────
// Ordenadas por ANTIGÜEDAD: cuanto más tiempo lleva listado un gratuito, menos
// probable es que lo retiren mañana. No es garantía, es la mejor señal que hay.
const enCadena = new Set(cadena);
const alternativas = gratis
  .filter((m) => !enCadena.has(m.id))
  .filter((m) => (m.architecture?.input_modalities || []).includes('text'))
  .sort((a, b) => (a.created || 0) - (b.created || 0));

console.log(`\nOTROS GRATUITOS HOY (${alternativas.length}), del más veterano al más nuevo:`);
for (const m of alternativas) {
  console.log(`  ${String(dias(m.created)).padStart(4)} días  ${m.id}`);
}
console.log('\nOJO: estar listado NO garantiza que pase la política de datos ni que');
console.log('responda sin 429. Antes de poner uno en la cadena, medilo con el prompt');
console.log('real (ver docs/ia-postproceso-openrouter.md).');

if (caidos > 0) {
  console.log(`\n🔴 ${caidos} modelo(s) de la cadena se cayeron. Mientras tanto la app usa el`);
  console.log('respaldo (Claude, que SÍ cuesta) — conviene reemplazarlos.');
  process.exit(2);
}
console.log('\n🟢 La cadena está entera.');
