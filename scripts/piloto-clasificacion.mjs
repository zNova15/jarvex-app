#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// JARVEX — PILOTO: ¿QUÉ MODELO CLASIFICA MEJOR? (tanda 2, 15-set-2026)
//
// Gabriel, 14-set: «no autorizo Haiku, es caro a comparación de otros modelos
// que pueden ofrecer lo mismo a menor precio». La respuesta a eso no es una
// opinión: es correr los mismos casos por cada modelo y mirar el tablero.
//
// QUÉ MIDE, y por qué cada columna:
//   · ACIERTOS  — contra `scripts/piloto/set-clasificacion.json`, que son
//                 descripciones REALES de la base con su respuesta correcta.
//   · FUERA DE LISTA — cuántas veces propuso un código que no estaba entre los
//                 candidatos. El server descarta esas respuestas, así que son
//                 preguntas pagadas que no sirvieron para nada.
//   · GEMELAS   — si «TUBO E. CUAD. 3/4IN * 1.2» y «… * 1.5» cayeron en el
//                 MISMO código. Es la contradicción que originó toda esta tanda.
//   · COSTO     — el que informa OpenRouter por llamada, no una estimación.
//   · SEGUNDOS  — importa: un barrido son cientos de preguntas seguidas.
//
// USA EL PROMPT DE PRODUCCIÓN (lib/prompt-clasificacion.js) y el mismo recorte
// de candidatos que la app (candidatosParaIA). Si esto armara su propio prompt,
// mediría el script y no el modelo.
//
// CÓMO SE CORRE
//   1. Poné la key en .env.local (gitignored):  OPENROUTER_API_KEY=sk-or-...
//   2. node scripts/piloto-clasificacion.mjs
//      node scripts/piloto-clasificacion.mjs --modelos openai/gpt-oss-120b,z-ai/glm-5.3-flash
//      node scripts/piloto-clasificacion.mjs --casos 5      (prueba corta)
//
// NO ESCRIBE NADA EN LA BASE NI EN LA APP: solo pregunta y cuenta.
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// En Windows un import() con ruta absoluta ('C:\...') no es una URL válida:
// hay que pasarla como file://. Sin esto el script no arranca en la PC de
// Gabriel, que es justo donde se va a correr.
const mod = (rel) => import(pathToFileURL(path.join(RAIZ, rel)).href);

// ── La key, sin pedirle a nadie que la pegue en un chat ───────────
function cargarEnvLocal() {
  for (const archivo of ['.env.local', '.env']) {
    const p = path.join(RAIZ, archivo);
    if (!fs.existsSync(p)) continue;
    for (const linea of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const valor = m[2].replace(/^["']|["']$/g, '');
      if (valor && !process.env[m[1]]) process.env[m[1]] = valor;
    }
  }
}
cargarEnvLocal();

const { promptClasificacion } = await mod('lib/prompt-clasificacion.js');
const { construirCuerpo, normalizarRespuesta, openrouterChat } = await mod('lib/openrouter.js');
const { candidatosParaIA, evidenciaDiccionario, clasificarConIUPC, etiquetaCategoria } =
  await mod('src/lib/indices-unificados-iupc.js');

// ── Argumentos ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (nombre, porDefecto = null) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};

// Los tres candidatos con ZDR verificado contra la API de OpenRouter el
// 15-set-2026 (`?zdr=true`), que es la política con la que la app llama de
// verdad. Precios USD por millón de tokens, de esa misma consulta.
const MODELOS_PILOTO = [
  { id: 'openai/gpt-oss-120b',   precio: { in: 0.037, out: 0.17 } },
  { id: 'z-ai/glm-5.3-flash',    precio: { in: 0.15,  out: 0.50 } },
  { id: 'openai/gpt-5.6-luna',   precio: { in: 0.20,  out: 1.20 } },
];
const modelos = (arg('modelos') || MODELOS_PILOTO.map(m => m.id).join(','))
  .split(',').map(s => s.trim()).filter(Boolean)
  .map(id => MODELOS_PILOTO.find(m => m.id === id) || { id, precio: null });

const apiKey = process.env.OPENROUTER_API_KEY || '';
if (!apiKey) {
  console.error('\n✗ Falta OPENROUTER_API_KEY.\n');
  console.error('  Ponela en .env.local (está en .gitignore, no se commitea):');
  console.error('    OPENROUTER_API_KEY=sk-or-...\n');
  console.error('  Es la MISMA key que ya usa la app en Vercel (Settings → Environment Variables).\n');
  process.exit(1);
}

const SET = JSON.parse(fs.readFileSync(path.join(RAIZ, 'scripts/piloto/set-clasificacion.json'), 'utf8'));
const tope = Number(arg('casos', 0)) || 0;
const casos = tope > 0 ? SET.casos.slice(0, tope) : SET.casos;

// ── Una pregunta, exactamente como la hace la app ─────────────────
async function preguntar(modelo, caso) {
  const propuestaRec = clasificarConIUPC(caso.descripcion);
  const propuestaLocal = propuestaRec?.codigo && propuestaRec.codigo !== 'sin_clasificar'
    ? { codigo: propuestaRec.codigo, nombre: etiquetaCategoria(propuestaRec.codigo), motivo: (propuestaRec.motivos || []).join(', ') }
    : null;
  const candidatos = candidatosParaIA(caso.descripcion, { propuestaLocal })
    .map(c => ({ codigo: String(c.codigo), nombre: String(c.nombre || c.label || '') }));
  const ev = evidenciaDiccionario(caso.descripcion);

  const { sys, usr, codigosValidos } = promptClasificacion({
    descripcion: caso.descripcion,
    unidad: caso.unidad || '',
    candidatos,
    evidencia: ev.filter(g => g.terminos.length).map(g => ({ codigo: g.codigo, terminos: g.terminos })),
    evidenciaPropia: [],
    propuestaLocal,
  });

  // 🔴 Sin respaldos: si el titular falla, falla y se anota. Una cadena de
  // respaldo mediría una mezcla de modelos, que es justo lo que pasó el 8-set
  // con las bases y arruinó esa medición.
  const cuerpo = construirCuerpo({
    modelo: modelo.id, respaldos: [], politica: 'zdr',
    system: sys, user: usr, maxTokens: 1200, razonamiento: 'bajo',
  });

  const t0 = Date.now();
  const cruda = await openrouterChat(apiKey, cuerpo, Date.now() + 60000, { intentos: 2 });
  const ms = Date.now() - t0;
  const r = normalizarRespuesta(cruda);
  const texto = r.content?.[0]?.text || '';
  const jm = texto.match(/\{[\s\S]*\}/);
  let parsed = null;
  try { parsed = jm ? JSON.parse(jm[0]) : null; } catch { parsed = null; }

  const propuesto = String(parsed?.codigo_sugerido || '').trim();
  return {
    propuesto,
    valido: codigosValidos.has(propuesto),
    candidatosOfrecidos: candidatos.length,
    confianza: typeof parsed?.confianza === 'number' ? parsed.confianza : null,
    razonamiento: String(parsed?.razonamiento || '').slice(0, 160),
    local: propuestaLocal?.codigo || null,
    ms,
    tokensIn: r.usage?.input_tokens ?? null,
    tokensOut: r.usage?.output_tokens ?? null,
    costo: typeof r.costo === 'number' ? r.costo : null,
    modeloServido: r.model || modelo.id,
    sinJson: !parsed,
  };
}

const ok = (caso, propuesto) =>
  propuesto === caso.esperado || (caso.tambien_ok || []).includes(propuesto);

// ── Corrida ───────────────────────────────────────────────────────
console.log(`\nPILOTO DE CLASIFICACIÓN — ${casos.length} casos × ${modelos.length} modelos`);
console.log(`Set medido el ${SET.medido_el}. Política de datos: ZDR.\n`);

const tablero = [];
for (const modelo of modelos) {
  console.log(`\n━━━ ${modelo.id} ━━━`);
  const filas = [];
  let errores = 0;
  for (const caso of casos) {
    let r;
    try {
      r = await preguntar(modelo, caso);
    } catch (e) {
      errores++;
      console.log(`  ✗ ERROR  ${caso.descripcion.slice(0, 48)} — ${e?.upstreamText || e?.message || e}`);
      filas.push({ caso, error: true });
      await new Promise(s => setTimeout(s, 1500));
      continue;
    }
    const acerto = ok(caso, r.propuesto);
    const marca = !r.valido ? '⚠' : acerto ? '✓' : '✗';
    console.log(`  ${marca} ${String(r.propuesto || '—').padEnd(16)} (esperado ${caso.esperado.padEnd(16)}) `
      + `${String(r.ms + 'ms').padStart(7)}  ${caso.descripcion.slice(0, 44)}`);
    if (!acerto && r.razonamiento) console.log(`      ↳ ${r.razonamiento}`);
    filas.push({ caso, ...r, acerto });
    // OpenRouter rate-limitea; la app también espera entre preguntas.
    await new Promise(s => setTimeout(s, 1100));
  }

  const validas = filas.filter(f => !f.error);
  const aciertos = validas.filter(f => f.acerto).length;
  const fuera = validas.filter(f => !f.valido).length;
  const sinJson = validas.filter(f => f.sinJson).length;
  const tIn = validas.reduce((a, f) => a + (f.tokensIn || 0), 0);
  const tOut = validas.reduce((a, f) => a + (f.tokensOut || 0), 0);
  const costoReal = validas.reduce((a, f) => a + (f.costo || 0), 0);
  const costoEstimado = modelo.precio
    ? (tIn / 1e6) * modelo.precio.in + (tOut / 1e6) * modelo.precio.out
    : null;
  const msProm = validas.length ? Math.round(validas.reduce((a, f) => a + f.ms, 0) / validas.length) : 0;

  // Las gemelas: misma pieza, dos espesores. Tienen que caer en el mismo lado.
  const gem = validas.filter(f => /TUBO E\. CUAD/.test(f.caso.descripcion)).map(f => f.propuesto);
  const gemelasOk = gem.length === 2 ? gem[0] === gem[1] : null;

  tablero.push({
    modelo: modelo.id, aciertos, total: validas.length, fuera, sinJson, errores,
    tIn, tOut, costoReal, costoEstimado, msProm, gemelasOk,
  });
}

// ── El tablero ────────────────────────────────────────────────────
console.log('\n\n═══ RESULTADO ═══\n');
console.log('modelo                          aciertos   fuera  sin    gemelas  seg/    USD este   USD 875');
console.log('                                           lista  JSON   iguales  caso    set       descrip.');
for (const t of tablero) {
  const pct = t.total ? Math.round((t.aciertos * 100) / t.total) : 0;
  const costo = t.costoReal || t.costoEstimado || 0;
  const porCaso = t.total ? costo / t.total : 0;
  console.log(
    `${t.modelo.padEnd(30)} ${String(t.aciertos + '/' + t.total).padStart(7)} ${String(pct + '%').padStart(5)} `
    + `${String(t.fuera).padStart(5)} ${String(t.sinJson).padStart(5)} `
    + `${(t.gemelasOk === null ? '—' : t.gemelasOk ? 'sí' : 'NO').padStart(8)} `
    + `${String((t.msProm / 1000).toFixed(1)).padStart(6)} `
    + `${('$' + costo.toFixed(4)).padStart(9)} ${('$' + (porCaso * 875).toFixed(2)).padStart(9)}`
  );
  if (t.errores) console.log(`${''.padEnd(30)} ${t.errores} llamadas fallaron y no cuentan.`);
}
console.log('\nUSD 875 descripciones = lo que costaría un barrido completo de una empresa.');
console.log('«fuera lista» son respuestas que el server descarta: preguntas pagadas que no sirvieron.\n');
