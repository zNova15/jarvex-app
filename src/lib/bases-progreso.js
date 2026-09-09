// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA BARRA DE UNA LECTURA DE BASES (tanda 15, entrega 11).
//
// EL PROBLEMA. Analizar unas bases de 94 páginas escaneadas son entre dos y
// cinco minutos de espera, y hasta hoy la pantalla mostraba una barra SOLO
// durante el OCR. Después de esa fase quedaba un rótulo que iba cambiando
// («Extrayendo los requisitos…», «recorriendo el documento entero…») sin
// ningún número: no había forma de saber si faltaba medio minuto o tres, y
// una espera sin número se lee como «se colgó».
//
// POR QUÉ NO ALCANZA CON CONTAR LLAMADAS. Las fases no cuestan lo mismo ni se
// saben de antemano:
//   · el OCR domina el reloj cuando el documento es escaneado, y NO EXISTE
//     cuando el PDF ya es texto o cuando el archivo estaba en caché;
//   · cuántas pasadas de extracción hay depende de los anexos que se hayan
//     podido separar y de los rangos que eligió el Pase 1;
//   · el barrido de respaldo puede no correr nunca — y esa es la buena noticia,
//     porque significa que la lectura dirigida sí encontró algo.
//
// CÓMO SE RESUELVE. Cada fase tiene un PESO (cuánto del reloj se lleva) y un
// TOTAL de unidades que se declara cuando se sabe. Tres reglas:
//
//   1. UNA FASE QUE NO VA A CORRER SALE DEL DENOMINADOR. Se declara con total
//      0 y su peso se reparte entre las demás. Sin esto, un PDF nativo
//      arrancaba en 42% («el OCR ya está hecho») sin haber hecho nada, y una
//      lectura sin barrido terminaba en 92%.
//   2. LA BARRA NUNCA RETROCEDE. Declarar el barrido a mitad de camino agranda
//      el denominador; en vez de dar marcha atrás —que es lo que hace pensar
//      que algo se rompió— la barra se queda quieta hasta que el avance real
//      la alcanza.
//   3. NO LLEGA A 100 HASTA QUE TERMINÓ. Mientras corre, el techo es 99: una
//      barra llena con la ventana todavía abierta es una mentira chiquita que
//      igual hace cerrar la ventana antes de tiempo.
//
// El porcentaje es una ESTIMACIÓN del trabajo hecho, no del tiempo que falta.
// Se dice así en la pantalla.
// ═══════════════════════════════════════════════════════════════════

/**
 * Las fases y lo que se lleva cada una del reloj.
 *
 * Los pesos salen de la corrida real sobre BASES_INTEGRADAS_PROCESO_SELECCION_009
 * (94 páginas escaneadas): 16 tandas de OCR de ~25 s contra ~30 pasadas de
 * extracción de ~6 s. Son relativos, así que lo único que importa es la
 * proporción entre ellos — y cuando una fase no corre, su peso desaparece.
 */
export const FASES_ANALISIS = [
  { clave: 'ocr', peso: 42 },
  { clave: 'indice', peso: 3 },
  { clave: 'localizar', peso: 6 },
  { clave: 'extraer', peso: 36 },
  { clave: 'barrido', peso: 8 },
  { clave: 'verificar', peso: 5 },
];

/**
 * El contador de una corrida.
 *
 * @param avisar  la función que recibe { paso, pct, hecho, total, detalle }.
 *                Es el mismo `onProgreso` que ya consumía la pantalla, así que
 *                todo lo que había sigue funcionando: el `pct` se agrega.
 * @param fases   para los tests, y por si algún día hay otro encadenado.
 */
export function crearProgreso(avisar = () => {}, fases = FASES_ANALISIS) {
  const estado = new Map(fases.map(f => [f.clave, { peso: f.peso, total: null, hecho: 0 }]));
  let piso = 0;          // la barra no retrocede
  let terminado = false;

  /** El porcentaje de AHORA, antes del clamp. */
  const crudo = () => {
    let num = 0, den = 0;
    for (const f of estado.values()) {
      // Una fase declarada con total 0 no va a correr: no suma ni al de arriba
      // ni al de abajo. Es la regla 1.
      if (f.total === 0) continue;
      den += f.peso;
      if (f.total == null) continue;                 // todavía no se sabe: 0 avance
      num += f.peso * Math.min(1, f.hecho / f.total);
    }
    return den > 0 ? (num / den) * 100 : 0;
  };

  const pct = () => {
    if (terminado) return 100;
    const p = Math.min(99, Math.round(crudo()));
    if (p > piso) piso = p;
    return piso;
  };

  const emitir = (paso, extra = {}) => {
    const f = estado.get(paso);
    avisar({
      paso,
      pct: pct(),
      ...(f && f.total != null ? { hecho: f.hecho, total: f.total } : {}),
      ...extra,
    });
  };

  return {
    /** Cuántas unidades tiene esta fase. 0 = no va a correr. */
    plan(clave, total) {
      const f = estado.get(clave);
      if (!f) return;
      const n = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
      f.total = n;
      if (f.hecho > n) f.hecho = n;
    },
    /** Deja la fase EN tantas unidades hechas (absoluto). Lo usa el OCR, que
     *  ya lleva su propia cuenta y avisa con el acumulado, no con el delta. */
    en(clave, hecho, extra = {}) {
      const f = estado.get(clave);
      if (f && f.total != null) f.hecho = Math.max(0, Math.min(f.total, Math.floor(hecho) || 0));
      emitir(clave, extra);
    },
    /** Suma unidades hechas y avisa. `extra` viaja tal cual a la pantalla. */
    avance(clave, n = 1, extra = {}) {
      const f = estado.get(clave);
      if (f && f.total != null) f.hecho = Math.min(f.total, f.hecho + n);
      emitir(clave, extra);
    },
    /** Avisa sin sumar nada (cambió el rótulo, no el trabajo hecho). */
    paso(clave, extra = {}) { emitir(clave, extra); },
    /** Da una fase por cerrada aunque no se hayan contado sus unidades. */
    cerrar(clave) {
      const f = estado.get(clave);
      if (!f) return;
      if (f.total == null) f.total = 0;
      else f.hecho = f.total;
    },
    /** Terminó todo: recién acá la barra llega a 100. */
    fin(extra = {}) {
      terminado = true;
      avisar({ paso: 'listo', pct: 100, ...extra });
    },
    /** Para los tests y para el reparto entre dos corridas. */
    valor: () => pct(),
  };
}

/**
 * El porcentaje de UNA corrida dentro de una lectura de varias.
 *
 * Leer dos veces para comparar (ver lib/bases-corridas.js) son dos `analizar()`
 * seguidos, y cada uno lleva su barra de 0 a 100. Sin esto la barra se llenaba,
 * volvía a cero y arrancaba de nuevo — que es exactamente lo que hace pensar
 * que la primera lectura se perdió.
 *
 * @param i       qué corrida es (0 = la primera)
 * @param total   cuántas corridas hay
 */
export function pctDeCorrida(pct, i, total) {
  const n = Number.isFinite(total) && total > 0 ? total : 1;
  const idx = Number.isFinite(i) && i > 0 ? Math.min(i, n - 1) : 0;
  const p = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return Math.round((idx * 100 + p) / n);
}
