// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL ASIENTO DE DESTINO (tanda 1, 18-set-2026).
//
// ── LO QUE PIDIERON, EN SUS PALABRAS ──────────────────────────────
// Las contadoras, vía Gabriel: «ya se tiene el libro diario y cada factura se
// desglosa en las cuentas a las que pertenece. Eso está bien, se puede
// corregir incluso. Ahora, luego cada asiento se traslada a su asiento de
// destino». Y el caso que mandaron:
//
//     Flete que trae la mercadería comprada:
//       Debe  60911 Transportes   ·  40111 IGV
//       Haber 4212 Emitidas
//     «Posteriormente este valor se traslada a la cuenta 20 Mercaderías
//      mediante el asiento de destino (20111 / 6111).»
//
// Ese «20111 / 6111» es toda la regla de este archivo: eligen UNA cuenta —el
// destino— y la otra pata sale sola. Nadie tiene que escribir dos.
//
// ── LAS DOS REGLAS, Y DE DÓNDE SALEN ──────────────────────────────
// 1) Destino en el ELEMENTO 2 (existencias): la contrapartida es la subcuenta
//    espejo de la 61. El PCGE lo dice en la propia cuenta 61 (p. 163): «611
//    Mercaderías… se encuentra relacionada con la cuenta 20», y así 612↔24,
//    613↔25, 614↔26. Es el caso del flete de arriba.
//
// 2) Destino en el ELEMENTO 9 (función): la contrapartida es la 791. PCGE
//    p. 195: «791 Cargas imputables a cuentas de costos y gastos. Transfiere
//    costos y gastos acumulados por su naturaleza, a cuentas de costo de
//    producción o cuentas acumulativas de función del gasto (Elemento 9)».
//
//    EXCEPCIÓN que es fácil pasar por alto: si lo que se traslada salió de la
//    cuenta 68 (depreciación, deterioro, provisiones), la contrapartida NO es
//    la 79 sino la 78. Lo manda el PCGE en la propia 79 (p. 195): «Los gastos
//    cubiertos por provisiones se transfieren a través de la cuenta 78».
//
// ── POR QUÉ NO HAY IA ACÁ ─────────────────────────────────────────
// El caso del combustible que dieron —generador de obra contra camioneta de
// reparto— es exactamente el que NINGÚN modelo puede resolver: las dos
// facturas dicen «PETRÓLEO DIESEL B5» y el dato que las separa no está en el
// comprobante, está en qué se hizo con el diesel. Se buscó ese dato en la app
// y no existe: medido el 18-set, `consumos_combustible` tiene 0 filas y
// `horas_maquina` 0. Adivinarlo sería inventar, que es justo lo que la regla 8
// del CLAUDE.md prohíbe. Acá se sugiere solo cuando hay de dónde, y cuando no,
// el destino queda vacío y a la vista.
//
// ── LAS VENTAS NO LLEVAN DESTINO ──────────────────────────────────
// La 79 transfiere gastos del elemento 6. Un ingreso (70/704) no se traslada a
// ningún lado: se cierra contra el resultado. Por eso `destinoSugerido` de un
// movimiento `income` devuelve null y la pantalla no ofrece el campo.
//
// Funciones puras, sin Dexie ni React. Testeadas en
// __tests__/destino-asiento.test.js.
// ═══════════════════════════════════════════════════════════════════

import { esCuentaValida, cuenta as cuentaPcge } from './pcge.js';
import { ELEMENTO_9, esCuentaElemento9, cuenta9, madre9 } from './pcge-elemento9.js';

/** Elemento (primer dígito) de un código de cuenta. */
const elementoDe = (codigo) => String(codigo ?? '').trim()[0] || '';

/** Los dos primeros dígitos: el nivel con el que trabajan las contadoras. */
const madre = (codigo) => String(codigo ?? '').trim().slice(0, 2);

/**
 * Existencia (elemento 2) → su subcuenta espejo en la 61.
 * Son las CUATRO que la 61 nombra; no hay más existencias con espejo.
 */
export const ESPEJO_61 = {
  '20': '611',   // Mercaderías
  '24': '612',   // Materias primas
  '25': '613',   // Materiales auxiliares, suministros y repuestos
  '26': '614',   // Envases y embalajes
};

/** La contrapartida cuando el destino es del elemento 9. */
export const CARGAS_IMPUTABLES = '791';
/** La contrapartida cuando lo que se traslada salió de la 68 (provisiones). */
export const CARGAS_POR_PROVISIONES = '781';

/**
 * La existencia que le corresponde a una cuenta de COMPRAS (60).
 *
 * Cubre la 609 con su divisionaria, que es el caso del flete que mandaron las
 * contadoras: 60911 (transporte vinculado a la compra de mercadería) tiene que
 * poder ir a la 20, no a la 25.
 */
export function existenciaDeCompra(cuentaOrigen) {
  const c = String(cuentaOrigen ?? '').trim();
  if (!c.startsWith('60')) return null;
  // 609 Costos vinculados con las compras: el tipo lo dice la CUARTA cifra.
  if (c.startsWith('609')) {
    return { '1': '20', '2': '24', '3': '25', '4': '26' }[c[3]] || null;
  }
  return { '1': '20', '2': '24', '3': '25', '4': '26' }[c[2]] || null;
}

/**
 * ¿Sirve como cuenta de destino?
 *
 * Vale una cuenta del elemento 9 (que NO está en el catálogo del PCGE porque
 * la norma no la define) o una existencia del elemento 2 con espejo en la 61.
 * Cualquier otra cosa —una 63, una 42— no es un destino: es otra pata.
 */
export function validarDestino(codigo) {
  const c = String(codigo ?? '').trim();
  if (!c) return { ok: true, codigo: null };            // vaciar = sin destino
  if (!/^[0-9]{2,5}$/.test(c)) {
    return { ok: false, error: 'Una cuenta del PCGE son de 2 a 5 dígitos (92, 613, 20111).' };
  }
  if (elementoDe(c) === '9') {
    if (!esCuentaElemento9(c)) {
      return { ok: false, error: `La cuenta ${c} no es una de las siete del elemento 9 que usa la empresa.` };
    }
    return { ok: true, codigo: c, nombre: cuenta9(c)?.nombre || '' };
  }
  if (elementoDe(c) === '2') {
    if (!esCuentaValida(c)) {
      return { ok: false, error: `La cuenta ${c} no existe en el Plan Contable General Empresarial.` };
    }
    if (!ESPEJO_61[madre(c)]) {
      return {
        ok: false,
        error: `La ${madre(c)} no tiene contrapartida en la 61. Como destino sirven la 20, la 24, la 25 y la 26.`,
      };
    }
    return { ok: true, codigo: c, nombre: cuentaPcge(c)?.nombre || '' };
  }
  return {
    ok: false,
    error: 'El destino va al elemento 9 (costos y gastos por función) o a una existencia del elemento 2.',
  };
}

/**
 * La otra pata del asiento de destino. Es lo que hace que la contadora elija
 * UNA cuenta y no dos.
 *
 * @param {string} destino      la cuenta elegida (92, 20111…)
 * @param {string} cuentaOrigen la cuenta por naturaleza del asiento (6032, 681…)
 * @returns {{cuenta:string|null, porque:string, error?:string}}
 */
export function contrapartidaDeDestino(destino, cuentaOrigen = '') {
  const d = String(destino ?? '').trim();
  if (!d) return { cuenta: null, porque: '' };

  if (elementoDe(d) === '2') {
    const espejo = ESPEJO_61[madre(d)];
    if (!espejo) {
      return {
        cuenta: null, porque: '',
        error: `La ${madre(d)} no tiene subcuenta espejo en la 61.`,
      };
    }
    return {
      cuenta: espejo,
      porque: `La 61 tiene una subcuenta por cada existencia: la ${madre(d)} se cancela contra la ${espejo}.`,
    };
  }

  if (elementoDe(d) === '9') {
    // La 68 se traslada por la 78, no por la 79 (PCGE p. 195). Pasa con la
    // depreciación de la maquinaria de obra, que es un costo de obra real.
    if (madre(cuentaOrigen) === '68') {
      return {
        cuenta: CARGAS_POR_PROVISIONES,
        porque: 'Sale de la 68 (valuación y provisiones): el PCGE la traslada por la 78, no por la 79.',
      };
    }
    return {
      cuenta: CARGAS_IMPUTABLES,
      porque: 'La 791 es el nexo entre el gasto por naturaleza y el costo por función.',
    };
  }

  return { cuenta: null, porque: '', error: 'Esa cuenta no es un destino válido.' };
}

/**
 * Qué destino proponerle a un movimiento que todavía no tiene uno.
 *
 * SALE DE UN CAMPO QUE YA EXISTE. `destino_contable` (mig 139) se usaba solo
 * para decidir costo contra gasto; dice exactamente lo que el elemento 9
 * pregunta. Medido el 18-set sobre los 1.789 movimientos vivos: 708 dicen
 * `gastos_generales` y 396 dicen `obra` — 1.104, el 62 %, traen el destino ya
 * decidido sin que nadie toque nada.
 *
 * `contabilidad_neta` (403) SÍ recibe propuesta desde el 18-set, por pedido
 * de Gabriel («puede que sí haga falta»): es un costo real de la empresa que
 * no está atado a ninguna obra, y eso es exactamente lo que el PCGE describe
 * con la 91 «Costo por distribuir» — se junta ahí y se reparte después. Va
 * con confianza BAJA, que la pantalla muestra distinto: es un punto de
 * partida para que la contadora decida, no una deducción.
 *
 * Lo que NO se propone es el movimiento sin destino (282): es «no se sabe», y
 * sugerir «no sé» con un botón verde al lado es lo mismo que no sugerir nada,
 * pero encima se guarda.
 *
 * @returns {{cuenta:string, porque:string, confianza:string}|null}
 */
export function destinoSugerido(movimiento, { cuentaOrigen = '' } = {}) {
  const m = movimiento || {};
  // Una venta no se traslada a ningún lado.
  if ((m.type || 'expense') === 'income') return null;

  // La naturaleza financiera manda sobre el destino del comprobante: un
  // interés bancario de una obra sigue siendo gasto financiero.
  if (madre(cuentaOrigen) === '67') {
    return {
      cuenta: '97', confianza: 'alta',
      porque: 'Es un gasto financiero (cuenta 67): su destino natural es la 97.',
    };
  }

  const destino = String(m.destino_contable || '').trim();
  if (destino === 'gastos_generales') {
    return {
      cuenta: '94', confianza: 'alta',
      porque: 'El comprobante está marcado como gasto general de la empresa, no de una obra.',
    };
  }
  if (destino === 'obra') {
    return {
      cuenta: '92', confianza: 'media',
      porque: 'El comprobante está vinculado a una obra: lo que se compra para una obra se consume ahí.',
    };
  }
  if (destino === 'contabilidad_neta') {
    return {
      cuenta: '91', confianza: 'baja',
      porque: 'Es contabilidad neta: un costo de la empresa que no está vinculado a ninguna obra. '
        + 'La 91 «Costo por distribuir» lo junta hasta decidir a qué se carga. Propuesta floja: confirmala o cambiala.',
    };
  }
  return null;
}

/**
 * Las cuentas que se le ofrecen a la contadora, en el orden en que las quiere.
 *
 * Primero el elemento 9 (las tres en uso, después las cuatro disponibles).
 * Después —solo si el gasto salió de una COMPRA— la existencia que le
 * corresponde, porque ahí sí hay una decisión real que tomar y tiene
 * consecuencia tributaria.
 */
export function opcionesDestino(movimiento, { cuentaOrigen = '' } = {}) {
  const m = movimiento || {};
  if ((m.type || 'expense') === 'income') return [];

  const out = ELEMENTO_9
    .slice()
    .sort((a, b) => (b.enUso === true) - (a.enUso === true))
    .map(c => ({
      codigo: c.codigo,
      nombre: c.nombre,
      porque: c.porque,
      grupo: c.enUso ? 'En uso' : 'Disponibles',
    }));

  const existencia = existenciaDeCompra(cuentaOrigen);
  if (existencia) {
    const c = cuentaPcge(existencia);
    out.push({
      codigo: existencia,
      nombre: c?.nombre || '',
      grupo: 'Queda en inventario',
      porque: 'Solo si el material NO se consumió todavía. Lo que entra al inventario no baja '
        + 'el resultado del período: si ya se usó y se manda acá, la empresa paga más renta de la que debe.',
      avisa: true,
    });
  }
  return out;
}

/**
 * Todo junto: qué destino le corresponde a este movimiento y con qué
 * contrapartida. Es lo que consume el generador del asiento.
 *
 * @returns {{cuenta, contrapartida, porque, manual, confianza, porDefinir}|null}
 */
export function resolverDestino(movimiento, { cuentaOrigen = '' } = {}) {
  const m = movimiento || {};
  if ((m.type || 'expense') === 'income') return null;

  const manual = String(m.cuenta_pcge_destino || '').trim();
  if (manual) {
    const v = validarDestino(manual);
    if (!v.ok) return null;                 // un dato roto no genera medio asiento
    const contra = contrapartidaDeDestino(manual, cuentaOrigen);
    if (!contra.cuenta) return null;
    return {
      cuenta: manual,
      contrapartida: contra.cuenta,
      porque: contra.porque,
      manual: true,
      confianza: 'manual',
      porDefinir: false,
    };
  }

  const sug = destinoSugerido(m, { cuentaOrigen });
  if (!sug) {
    return { cuenta: null, contrapartida: null, porque: '', manual: false, confianza: 'ninguna', porDefinir: true };
  }
  const contra = contrapartidaDeDestino(sug.cuenta, cuentaOrigen);
  return {
    cuenta: sug.cuenta,
    contrapartida: contra.cuenta,
    porque: sug.porque,
    manual: false,
    confianza: sug.confianza,
    porDefinir: false,
  };
}

/** El nombre de una cuenta de destino, sea del elemento 9 o del 2. */
export function nombreDestino(codigo) {
  const c = String(codigo ?? '').trim();
  if (!c) return '';
  if (elementoDe(c) === '9') return cuenta9(c)?.nombre || '';
  return cuentaPcge(c)?.nombre || '';
}

export default {
  ESPEJO_61, CARGAS_IMPUTABLES, CARGAS_POR_PROVISIONES,
  existenciaDeCompra, validarDestino, contrapartidaDeDestino,
  destinoSugerido, opcionesDestino, resolverDestino, nombreDestino,
};
