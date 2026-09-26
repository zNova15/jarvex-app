// ── TECHO DE PULL — detector de la próxima bomba de egress ─────────────────
//
// El cursor compuesto (cursor-incremental.js) arregla la bomba del 9-set-2026
// ([[jarvex-corte-egress-9sep]]): tablas con sellos `updated_at` idénticos de
// un import masivo, que hacían que el pull incremental re-bajara la tabla
// entera cada 30 s.
//
// Pero el cursor arregla ESA causa puntual. Nada avisaba que estaba pasando
// hasta que Supabase cortó el proyecto entero. JARVEX importa catálogos de
// golpe de manera rutinaria (ver jarvex-tanda14-plan, jarvex-tanda13-*), así
// que la FORMA de este bug puede volver por una vía distinta: una migración
// que toca `updated_at` de muchas filas a la vez, un trigger que se
// disparó de más, un bug nuevo en el cursor mismo.
//
// Este módulo es el humo antes del incendio: mide, en cada pull INCREMENTAL
// (no en un full pull — ahí bajar todo es esperado), qué fracción del total
// local trajo ese ciclo. Un pull incremental normal trae un puñado de filas
// (lo que cambió desde la última vez). Si trae una fracción grande de la
// tabla, o algo se rompió, o hay un import masivo en curso que amerita
// revisar el sello — de cualquier forma, vale la pena que alguien lo vea
// ANTES de que se repitan 848 MB/hora en silencio durante meses.

// Umbral: un pull incremental que trae más de este % de las filas totales de
// la tabla se marca como sospechoso. 20% porque un ciclo normal trae
// muchísimo menos (los cambios de 30 segundos de trabajo), y porque el caso
// real medido el 9-set traía 100% y 17% — este piso los agarra a los dos sin
// generar ruido por picos legítimos (ej. el primer sync tras un cache-clear
// SIEMPRE es full pull y no pasa por acá).
export const UMBRAL_SOSPECHOSO_PCT = 20;

// Historial acotado en memoria — no hace falta persistirlo: es una señal
// operativa de la sesión actual, no un registro contable. Últimos N ciclos
// por tabla, para que la UI de Administración pueda mostrar una tendencia y
// no solo el último valor (una tabla que SIEMPRE ronda el 18% preocupa más
// que una que tocó 22% una sola vez).
const HISTORIAL_MAX_POR_TABLA = 12;
const _historial = new Map(); // tabla -> [{ts, filasTraidas, filasLocales, pct, sospechoso}]

function registrar(tabla, filasTraidas, filasLocales) {
  if (filasLocales <= 0) return null; // sin base de comparación (tabla nueva)
  const pct = Math.round((filasTraidas / filasLocales) * 1000) / 10; // 1 decimal
  const sospechoso = pct > UMBRAL_SOSPECHOSO_PCT;
  const entrada = { ts: Date.now(), tabla, filasTraidas, filasLocales, pct, sospechoso };

  let lista = _historial.get(tabla);
  if (!lista) { lista = []; _historial.set(tabla, lista); }
  lista.push(entrada);
  if (lista.length > HISTORIAL_MAX_POR_TABLA) lista.shift();

  if (sospechoso) {
    console.warn(
      `[SyncEngine] ⚠ techo de pull: "${tabla}" trajo ${filasTraidas} de ${filasLocales} filas ` +
      `(${pct}%) en un pull INCREMENTAL. Eso es lo que hizo la bomba del 9-set — revisar si la ` +
      `tabla tuvo un import masivo reciente con updated_at repetido.`
    );
  }
  return entrada;
}

// Punto de entrada para el SyncEngine: llamar solo cuando el pull fue
// incremental (lastSync no era null — un full pull baja todo por diseño y no
// dice nada sobre una bomba). Desde la tanda E también lo llama el pull por
// RPC (antes solo la ruta legacy: justo la puerta por la que el RPC re-bajaba
// los bloques de sellos iguales no se medía).
export function medirCicloIncremental(tabla, filasTraidas, filasLocales) {
  return registrar(tabla, filasTraidas, filasLocales);
}

// Para Administración: el último ciclo de cada tabla, tablas sospechosas
// primero, y solo las que tienen historial (evita listar las ~85 tablas
// vacías de ruido).
export function saludDelTecho() {
  const filas = [];
  for (const [tabla, lista] of _historial) {
    const ultimo = lista[lista.length - 1];
    if (!ultimo) continue;
    filas.push({
      tabla,
      ...ultimo,
      vecesSospechosoReciente: lista.filter(e => e.sospechoso).length,
      ciclosMedidos: lista.length,
    });
  }
  filas.sort((a, b) => b.pct - a.pct);
  return filas;
}

export function haySospechaActiva() {
  for (const lista of _historial.values()) {
    const ultimo = lista[lista.length - 1];
    if (ultimo?.sospechoso) return true;
  }
  return false;
}

// ── FRENO (tanda E, 26-set-2026) ───────────────────────────────────────
// Hasta acá el techo solo AVISABA: ante la señal exacta del 9-set la app
// seguía bajando igual, ciclo tras ciclo. Un pico aislado es normal (un
// import grande, alguien que reclasificó 3.000 insumos); lo que no es normal
// es que la MISMA tabla traiga una fracción grande en varios ciclos
// SEGUIDOS — con el cursor compuesto cada ciclo parte de donde terminó el
// anterior, así que eso solo pasa si algo en el servidor re-sella las filas
// una y otra vez. Ahí la tabla se deja de pedir un rato: no se pierde nada
// (el cursor queda quieto y la retoma después), y se corta la sangría hasta
// que alguien mire.
export const CICLOS_SOSPECHOSOS_PARA_FRENAR = 5;
export const FRENO_MS = 10 * 60_000;
const _frenadas = new Map(); // tabla -> timestamp hasta el que no se pide

/**
 * ¿Hay que frenar esta tabla? Mira sus últimas N mediciones. Si frena,
 * devuelve true UNA vez (para avisar) y deja la tabla frenada FRENO_MS.
 */
export function evaluarFreno(tabla, ahora = Date.now()) {
  const lista = _historial.get(tabla) || [];
  if (lista.length < CICLOS_SOSPECHOSOS_PARA_FRENAR) return false;
  const ultimas = lista.slice(-CICLOS_SOSPECHOSOS_PARA_FRENAR);
  if (!ultimas.every(e => e.sospechoso)) return false;
  if (tablaFrenada(tabla, ahora)) return false;
  _frenadas.set(tabla, ahora + FRENO_MS);
  // Se vacía el historial: al volver, la tabla tiene que juntar otra vez N
  // ciclos seguidos para frenar de nuevo (y no quedar frenada para siempre
  // por lo que pasó antes del freno).
  _historial.set(tabla, []);
  return true;
}

export function tablaFrenada(tabla, ahora = Date.now()) {
  const hasta = _frenadas.get(tabla);
  if (!hasta) return false;
  if (hasta <= ahora) { _frenadas.delete(tabla); return false; }
  return true;
}

// Solo para tests — vuelve el módulo a su estado inicial entre casos.
export function _resetParaTests() {
  _historial.clear();
  _frenadas.clear();
}
