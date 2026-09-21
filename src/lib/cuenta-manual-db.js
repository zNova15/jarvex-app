// ═══════════════════════════════════════════════════════════════════
// JARVEX — CORREGIR A MANO LA CUENTA DE UN ASIENTO (mig 220).
//
// Pedido de las contadoras: «actualmente no es editable, y eso está mal. Las
// contadoras tienen el criterio del estado peruano mucho más claro, está súper
// bien tener las recomendaciones de la IA pero en caso se crea que se debe
// cambiar el código se debería poder».
//
// ── QUÉ SE GUARDA, Y POR QUÉ NO EL ASIENTO ────────────────────────
// El Libro Diario NO se persiste: se deriva de los movimientos cada vez. Si
// «editar el asiento» guardara el asiento, quedaría una foto congelada que no
// se actualiza cuando cambia el movimiento —el importe, la fecha, el IGV— y a
// la semana el libro y los comprobantes dirían cosas distintas.
//
// Lo que se guarda es la DECISIÓN, en el movimiento:
//   · `cuenta_pcge`               → la cuenta del gasto o del ingreso
//   · `cuenta_pcge_contrapartida` → caja / bancos / por pagar / por cobrar
// y el asiento se sigue derivando, ahora respetándolas.
//
// ── LA DECISIÓN HUMANA LE GANA A LA MÁQUINA, Y SE PUEDE DESHACER ──
// Elegir una cuenta a mano la fija para siempre; «Volver a automático» la
// borra y el reparto vuelve a mandar. Las dos cosas quedan en auditoría: una
// cuenta que le gana al sistema sin que se sepa quién la puso es una cuenta
// que dentro de seis meses nadie se anima ni a confirmar ni a cambiar.
//
// La lógica pura —qué cuentas existen, cuál corresponde— vive en `pcge.js` y
// `pcge-puente.js`, con sus tests. Acá solo está el aterrizaje en Dexie.
// ═══════════════════════════════════════════════════════════════════
import { db, SYNC_STATUS } from '../db/jarvex.db';
import { esCuentaValida, cuenta as cuentaPcge } from './pcge.js';
import { validarDestino } from './destino-asiento.js';
import {
  validarSalida, salidaQuedaHuerfana, SALIDA_VACIA, esDestinoExistencia,
} from './existencias-balance.js';
import { derivarTypeContable } from './clasificacion-contable.js';
import {
  CERRADO_HASTA_DEFAULT, movEnPeriodoCerrado, motivoForzado, periodoCerrado,
} from './periodo-contable.js';

const avisar = () => {
  try {
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } }));
  } catch { /* SSR / tests */ }
};

// Qué cuentas se ofrecen como CONTRAPARTIDA ya no es una lista fija acá: la
// arma `opcionesContrapartida()` en `contrapartida.js` según el comprobante
// —pagado o pendiente, compra o venta, sobre o bajo el umbral de
// bancarización— y es la misma función que usa el generador del asiento. Dos
// listas de contrapartidas en dos archivos era garantía de que un día
// dijeran cosas distintas.

/** ¿Se puede guardar esta cuenta? Misma forma que valida el CHECK de la mig 220. */
export function validarCuentaManual(codigo) {
  const c = String(codigo ?? '').trim();
  if (!c) return { ok: true, codigo: null };          // vaciar = volver a automático
  if (!/^[0-9]{2,5}$/.test(c)) {
    return { ok: false, error: 'Una cuenta del PCGE son de 2 a 5 dígitos (63, 631, 6311, 63111).' };
  }
  if (!esCuentaValida(c)) {
    return { ok: false, error: `La cuenta ${c} no existe en el Plan Contable General Empresarial.` };
  }
  return { ok: true, codigo: c, nombre: cuentaPcge(c)?.nombre || '' };
}

/**
 * ¿Se puede guardar este costo/gasto a mano? Es el CHECK de la mig 163:
 * 'cost', 'expense' o nada (nada = lo decide la vinculación).
 */
export function validarTipoManual(valor) {
  const v = String(valor ?? '').trim();
  if (!v) return { ok: true, codigo: null };
  if (v === 'cost' || v === 'expense') return { ok: true, codigo: v };
  return { ok: false, error: 'El tipo a mano es «cost» (costo) o «expense» (gasto).' };
}

/**
 * Las decisiones que se pueden guardar, con su columna y su validador.
 *
 * `tipo` (tanda 3 del destino) no es una cuenta: es el costo/gasto que lee el
 * Estado de Resultados. Viaja en la MISMA escritura que el destino que lo
 * motivó, y no en una aparte, para que no pueda quedar guardado uno sin el
 * otro: un destino 94 con el comprobante todavía en «costo» es justo la
 * incoherencia que la ventana de consecuencias viene a cerrar.
 *
 * El destino NO usa `validarCuentaManual` y no es un descuido: sus cuentas del
 * elemento 9 no existen en el catálogo del PCGE —la norma no las define— así
 * que `esCuentaValida('94')` da false. `validarDestino` conoce los dos
 * catálogos y además exige que la existencia elegida tenga espejo en la 61.
 */
const DECISIONES = [
  { clave: 'cuenta',        columna: 'cuenta_pcge',                validar: validarCuentaManual },
  { clave: 'contrapartida', columna: 'cuenta_pcge_contrapartida',  validar: validarCuentaManual },
  { clave: 'destino',       columna: 'cuenta_pcge_destino',        validar: validarDestino },
  { clave: 'tipo',          columna: 'clasificacion_manual',       validar: validarTipoManual },
];

/** Las columnas que son CUENTAS: son las que firman la decisión (mig 220). */
const COLUMNAS_CUENTA = ['cuenta_pcge', 'cuenta_pcge_contrapartida', 'cuenta_pcge_destino'];

/**
 * Fija (o borra) la cuenta de un movimiento.
 *
 * @param {string} movimientoId
 * @param {object} cambios   { cuenta, contrapartida, destino, tipo } — `null`
 *                           en cualquiera la devuelve a automático; `undefined`
 *                           la deja como está. `tipo` es 'cost' | 'expense' y
 *                           recalcula el `type` con `derivarTypeContable`.
 * @param {object} ctx       { userId, motivo, cerradoHasta }
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function fijarCuentaManual(movimientoId, cambios = {}, {
  userId = null, motivo = '', cerradoHasta = CERRADO_HASTA_DEFAULT,
} = {}) {
  if (!movimientoId) return { ok: false, error: 'Falta el movimiento.' };

  const campos = {};
  for (const { clave, columna, validar } of DECISIONES) {
    if (!(clave in cambios)) continue;
    const v = validar(cambios[clave]);
    if (!v.ok) return { ok: false, error: v.error };
    campos[columna] = v.codigo;
  }
  if (!Object.keys(campos).length) return { ok: false, error: 'No hay nada que cambiar.' };

  // Se lee fresco antes de escribir: `version` tiene que salir de lo que está
  // en el disco, no de la copia que la pantalla tenga en memoria.
  const fresh = await db.accounting_movements.get(movimientoId);
  if (!fresh) return { ok: false, error: 'El comprobante no está en este dispositivo — sincronizá.' };

  // ── EL PERÍODO YA PRESENTADO: SE REGISTRA, NO SE FRENA ──────────
  // Hasta el 22-set-2026 esto devolvía un error y pedía `forzarPeriodoCerrado`.
  // Se sacó a pedido de Gabriel: el cierre anual reclasifica el ejercicio
  // entero hacia atrás y el 94 % de los comprobantes es de un mes presentado,
  // así que el freno se disparaba casi siempre y solo enseñaba a marcar la
  // casilla sin leerla. Lo que sí queda —y es lo que siempre valió— es que la
  // auditoría diga que se tocó un mes declarado. Ver `periodo-contable.js`.
  const enCerrado = movEnPeriodoCerrado(fresh, cerradoHasta);

  // ── EL GUARDIÁN DEL CHECK DE LA MIG 224 (tanda 5) ───────────────
  // 🔴 La salida de inventario solo puede existir colgada de un destino que
  // SEA una existencia; el CHECK de la base lo exige. Si alguien cambia el
  // destino de 24 a 94 y la salida se queda, la fila viola el CHECK, el push
  // rebota con 23514 y el sync entra en reintento eterno — la regla 9 del
  // CLAUDE.md, ya pagada una vez con `insumo_categoria`.
  //
  // Se borra en la MISMA escritura, no en otra: entre dos updates la fila
  // queda inválida, y el sync no espera a que terminemos.
  if ('cuenta_pcge_destino' in campos && salidaQuedaHuerfana(campos.cuenta_pcge_destino, fresh)) {
    Object.assign(campos, SALIDA_VACIA);
  }

  // El `type` NO se elige: se deriva, con la misma función que usan Captura
  // Mágica y Movimientos. Así un intercompany sigue siendo costo aunque llegue
  // un 'expense' (la regla dura del Consolidado vive en esa función).
  if ('clasificacion_manual' in campos) {
    campos.type = derivarTypeContable({ ...fresh, clasificacion_manual: campos.clasificacion_manual });
  }

  const vuelveAAutomatico = COLUMNAS_CUENTA
    .filter(c => c in campos)
    .every(c => campos[c] === null)
    && COLUMNAS_CUENTA.every(c => (c in campos) || !fresh[c]);
  const ahora = new Date().toISOString();

  await db.accounting_movements.update(movimientoId, {
    ...campos,
    // La firma se borra junto con la última cuenta manual: si no queda ninguna
    // decisión, tampoco tiene que quedar el rastro de quién la tomó.
    cuenta_pcge_por: vuelveAAutomatico ? null : (userId || fresh.cuenta_pcge_por || null),
    cuenta_pcge_at: vuelveAAutomatico ? null : ahora,
    updated_at: ahora,
    updated_by: userId,
    version: (fresh.version ?? 0) + 1,
    sync_status: fresh.sync_status === SYNC_STATUS.PENDING_CREATE
      ? SYNC_STATUS.PENDING_CREATE
      : SYNC_STATUS.PENDING_UPDATE,
  });

  try {
    await window.__logAudit?.({
      action: 'update',
      table: 'accounting_movements',
      recordId: movimientoId,
      oldData: {
        cuenta_pcge: fresh.cuenta_pcge ?? null,
        cuenta_pcge_contrapartida: fresh.cuenta_pcge_contrapartida ?? null,
        cuenta_pcge_destino: fresh.cuenta_pcge_destino ?? null,
        // La salida borrada por arrastre se dice: dentro de un año, «¿dónde
        // fue a parar la descarga de esa compra?» es una pregunta legítima y
        // la respuesta es «se la llevó el cambio de destino».
        ...('existencia_salida_cuenta' in campos
          ? {
            existencia_salida_cuenta: fresh.existencia_salida_cuenta ?? null,
            existencia_salida_fecha: fresh.existencia_salida_fecha ?? null,
            existencia_salida_importe: fresh.existencia_salida_importe ?? null,
          }
          : {}),
        ...('clasificacion_manual' in campos
          ? { clasificacion_manual: fresh.clasificacion_manual ?? null, type: fresh.type ?? null }
          : {}),
      },
      newData: campos,
      // Forzar un mes ya declarado se dice SIEMPRE, aunque venga otro motivo:
      // es el dato que alguien va a buscar dentro de un año, y perderlo porque
      // se pisó con un texto más nuevo sería perder justo ese.
      reason: [
        motivo
          || (vuelveAAutomatico
            ? `Libro Diario · ${fresh.document_number || 'el comprobante'} vuelve a la cuenta automática`
            : `Libro Diario · cuenta corregida a mano en ${fresh.document_number || 'el comprobante'}`),
        enCerrado ? motivoForzado(fresh, cerradoHasta) : '',
      ].filter(Boolean).join(' · '),
    });
  } catch { /* la auditoría no puede impedir la corrección */ }

  avisar();
  return { ok: true, vuelveAAutomatico };
}

/**
 * Descargar del inventario lo que ya salió del almacén (tanda 5 del destino).
 *
 * Es la OTRA mitad del destino de existencia. Hasta la mig 224 se podía mandar
 * una compra a la 20/24/25/26 y no había forma de sacarla: el costo quedaba en
 * el Balance para siempre y la empresa pagaba renta sobre una utilidad que no
 * tuvo. Acá se escribe cuándo salió, a dónde fue y cuánto — las otras tres
 * patas del asiento las deriva `existencias-balance.js`.
 *
 * ── EL CANDADO MIRA LA FECHA DE LA SALIDA, NO LA DE LA FACTURA ──
 * 🔴 Y es el punto entero de la tanda. El costo pertenece al mes en que la
 * cosa se USÓ. Una factura de mayo (período ya presentado) que se consume en
 * setiembre genera un asiento de SETIEMBRE, que está abierto: frenarlo porque
 * la factura es vieja sería prohibir justo la operación que corrige el
 * problema. Al revés también vale: descargar con fecha de junio SÍ toca un mes
 * declarado y ahí el freno tiene que aplicar.
 *
 * @param {string} movimientoId
 * @param {object} salida  { cuenta, fecha, importe } — todo null/vacío la borra
 * @param {object} ctx     { userId, motivo, entro, cerradoHasta }
 *                         `entro` es la base del asiento de destino: el tope
 *                         de lo que puede salir. Lo calcula el generador.
 */
export async function fijarSalidaExistencia(movimientoId, salida = {}, {
  userId = null, motivo = '', entro = null,
  cerradoHasta = CERRADO_HASTA_DEFAULT,
} = {}) {
  if (!movimientoId) return { ok: false, error: 'Falta el movimiento.' };

  const fresh = await db.accounting_movements.get(movimientoId);
  if (!fresh) return { ok: false, error: 'El comprobante no está en este dispositivo — sincronizá.' };

  const destino = String(fresh.cuenta_pcge_destino || '').trim();
  const borrar = !salida?.cuenta && !salida?.fecha
    && (salida?.importe === null || salida?.importe === undefined || salida?.importe === '');

  // Borrar no exige que el destino siga siendo una existencia: si el destino
  // cambió, borrar la salida es exactamente lo que hay que poder hacer.
  if (!borrar && !esDestinoExistencia(destino)) {
    return {
      ok: false,
      error: 'Este comprobante no está en una existencia: elegí primero el destino de inventario '
        + '(20, 24, 25 o 26) y después decí cuándo salió.',
    };
  }

  const v = validarSalida(salida, { destino, entro });
  if (!v.ok) return { ok: false, error: v.error };

  // El período de la salida se mira por SU fecha, no por la de la factura (ver
  // arriba). Al borrar, la que se estaba usando: deshacer una descarga de un
  // mes declarado también cambia ese mes. Desde el 22-set-2026 esto solo
  // alimenta la auditoría — no frena nada.
  const fechaPeriodo = borrar
    ? String(fresh.existencia_salida_fecha || '').slice(0, 10)
    : v.salida.fecha;
  const enCerrado = !!fechaPeriodo && periodoCerrado(fechaPeriodo, cerradoHasta);

  const ahora = new Date().toISOString();
  const campos = v.salida.cuenta
    ? {
      existencia_salida_cuenta: v.salida.cuenta,
      existencia_salida_fecha: v.salida.fecha,
      existencia_salida_importe: v.salida.importe,
      existencia_salida_por: userId || null,
      existencia_salida_at: ahora,
    }
    : { ...SALIDA_VACIA };

  await db.accounting_movements.update(movimientoId, {
    ...campos,
    updated_at: ahora,
    updated_by: userId,
    version: (fresh.version ?? 0) + 1,
    sync_status: fresh.sync_status === SYNC_STATUS.PENDING_CREATE
      ? SYNC_STATUS.PENDING_CREATE
      : SYNC_STATUS.PENDING_UPDATE,
  });

  try {
    await window.__logAudit?.({
      action: 'update',
      table: 'accounting_movements',
      recordId: movimientoId,
      oldData: {
        existencia_salida_cuenta: fresh.existencia_salida_cuenta ?? null,
        existencia_salida_fecha: fresh.existencia_salida_fecha ?? null,
        existencia_salida_importe: fresh.existencia_salida_importe ?? null,
      },
      newData: campos,
      reason: [
        motivo || (v.salida.cuenta
          ? `Libro Diario · ${fresh.document_number || 'el comprobante'} sale del inventario el `
            + `${v.salida.fecha} hacia la cuenta ${v.salida.cuenta}`
          : `Libro Diario · se deshace la salida de inventario de ${fresh.document_number || 'el comprobante'}`),
        enCerrado
          ? `se toca el período ya presentado (hasta ) con fecha `
          : '',
      ].filter(Boolean).join(' · '),
    });
  } catch { /* la auditoría no puede impedir la corrección */ }

  avisar();
  return { ok: true, borrada: !v.salida.cuenta };
}

/**
 * La misma corrección sobre VARIOS movimientos.
 *
 * Es lo que hace usable la pila de «cuentas por definir»: son 345 en
 * producción y muchas se repiten por proveedor —treinta facturas del mismo
 * grifo son todas 603—. De a una serían treinta decisiones idénticas.
 *
 * Devuelve cuántas se aplicaron y cuáles fallaron; NO aborta al primer error,
 * porque dejar la mitad hecha sin decir cuál es peor que seguir.
 */
export async function fijarCuentaEnLote(ids = [], cambios = {}, ctx = {}) {
  const out = { ok: 0, fallaron: [] };
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const r = await fijarCuentaManual(id, cambios, ctx);
    if (r.ok) out.ok++; else out.fallaron.push({ id, error: r.error });
  }
  return out;
}

export default {
  validarCuentaManual, validarTipoManual, fijarCuentaManual, fijarCuentaEnLote,
  fijarSalidaExistencia,
};
