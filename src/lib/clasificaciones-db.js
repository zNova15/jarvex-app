// ═══════════════════════════════════════════════════════════════════
// JARVEX — ESCRITURA DE CLASIFICACIONES Y DICCIONARIO (mig 205).
//
// La lógica pura —qué clasificaciones existen, qué términos las disparan, cómo
// se clasifica un texto— vive en `indices-unificados-iupc.js` y
// `clasificacion-servicios.js`, que tienen tests. Acá solo está el aterrizaje
// en Dexie.
//
// LO QUE SE ESCRIBE ACÁ ES LA SEGUNDA CAPA. La base oficial (IUPC del INEI +
// árbol de servicios) viaja en el bundle y NO se toca desde la app: es la ley y
// no cambia. Estas dos tablas guardan lo que Gabriel agrega encima.
//
// AISLAMIENTO DEL MODO PRUEBA: las dos tablas son GLOBALES (sin obra), así que
// las filas demo y las reales conviven separadas solo por `demo: true`. Toda
// ruta scopea por modo y las demo nunca entran a la cola de push.
// ═══════════════════════════════════════════════════════════════════
import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { getCurrentMode } from './app-mode-core.js';
import { normIUPC, codigoSugerido, validarClasificacion } from './indices-unificados-iupc.js';

// Se re-exportan para que la pantalla importe todo de un solo lugar; la lógica
// pura (y sus tests) vive en `indices-unificados-iupc.js`.
export { codigoSugerido, validarClasificacion };

const esModoPrueba = () => { try { return getCurrentMode() === 'prueba'; } catch { return false; } };
const filaDelModo = (r, esPrueba) => (esPrueba ? r.demo === true : r.demo !== true);
const ahora = () => new Date().toISOString();

const parcheDeUpdate = (campos, prev, esPrueba, userId) => ({
  ...campos,
  updated_by: userId || null,
  updated_at: ahora(),
  version: (prev?.version ?? 0) + 1,
  sync_status: esPrueba ? SYNC_STATUS.SYNCED
    : (prev?.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
});

const filaNueva = (campos, tabla, esPrueba, userId) => ({
  id: newId(),
  ...campos,
  created_by: userId || null, updated_by: userId || null,
  created_at: ahora(), updated_at: ahora(),
  version: 1,
  idempotency_key: newIdempotencyKey(userId || 'anon', tabla),
  ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
});

// ── 1. CLASIFICACIONES PROPIAS ─────────────────────────────────────

export async function crearClasificacion({ codigo, nombre, arbol = 'insumo', gasto = null, nota = null, companyId = null }, { userId = null } = {}) {
  const esPrueba = esModoPrueba();
  const fila = filaNueva({
    codigo: String(codigo).trim(),
    nombre: String(nombre).trim(),
    arbol: arbol === 'servicio' ? 'servicio' : 'insumo',
    gasto: gasto || null,
    nota: nota || null,
    activo: true,
    company_id: companyId || null,
    deleted_at: null,
  }, 'clasificaciones', esPrueba, userId);
  await db.clasificaciones.add(fila);
  return fila;
}

export async function editarClasificacion(id, campos, { userId = null } = {}) {
  const esPrueba = esModoPrueba();
  const prev = await db.clasificaciones.get(id);
  if (!prev) return null;
  await db.clasificaciones.update(id, parcheDeUpdate(campos, prev, esPrueba, userId));
  return { ...prev, ...campos };
}

/**
 * Baja lógica. NO se borra físicamente ni se tocan las filas del catálogo que
 * la usaban: si se reasignaran solas, una desactivación por error movería de
 * clasificación a decenas de insumos sin que nadie lo pida. Quedan apuntando a
 * un código inactivo, que la pantalla muestra igual y deja corregir a mano.
 */
export async function desactivarClasificacion(id, { userId = null } = {}) {
  return editarClasificacion(id, { activo: false }, { userId });
}

// ── 2. EL DICCIONARIO ──────────────────────────────────────────────

/**
 * Agrega un término al diccionario de una clasificación.
 * Devuelve `{ ok: false, motivo }` si el término ya estaba —en esta capa o en
 * la oficial—, para que la pantalla lo diga en vez de crear un duplicado que
 * después pelea consigo mismo al clasificar.
 */
export async function agregarTermino({ termino, clasificacionCodigo, companyId = null }, { userId = null, yaEnBase = null } = {}) {
  const esPrueba = esModoPrueba();
  const txt = String(termino || '').trim();
  if (!txt) return { ok: false, motivo: 'Escribí el término.' };
  const norm = normIUPC(txt);
  if (!norm) return { ok: false, motivo: 'Ese término no tiene letras ni números.' };

  if (typeof yaEnBase === 'function') {
    const donde = yaEnBase(norm);
    if (donde) return { ok: false, motivo: `«${txt}» ya está en el diccionario de ${donde}.` };
  }

  const repetido = await db.clasificacion_terminos
    .filter(r => !r.deleted_at && r.norm === norm && filaDelModo(r, esPrueba)).first();
  if (repetido) {
    return { ok: false, motivo: `«${txt}» ya apunta a ${repetido.clasificacion_codigo}.` };
  }

  const fila = filaNueva({
    termino: txt,
    norm,
    clasificacion_codigo: String(clasificacionCodigo),
    // Escrito a mano desde el panel: es la única capa propia que le gana al
    // Anexo 2 y que desclasificar NO borra (mig 212). Ver `indexarCustom`.
    origen: 'manual',
    company_id: companyId || null,
    deleted_at: null,
  }, 'clasificacion_terminos', esPrueba, userId);
  await db.clasificacion_terminos.add(fila);
  return { ok: true, fila };
}

/** Saca un término del diccionario (baja lógica, como todo acá). */
export async function quitarTermino(id, { userId = null } = {}) {
  const esPrueba = esModoPrueba();
  const prev = await db.clasificacion_terminos.get(id);
  if (!prev) return false;
  await db.clasificacion_terminos.update(id,
    parcheDeUpdate({ deleted_at: ahora() }, prev, esPrueba, userId));
  return true;
}

/** Mueve un término de una clasificación a otra. */
export async function moverTermino(id, clasificacionCodigo, { userId = null } = {}) {
  const esPrueba = esModoPrueba();
  const prev = await db.clasificacion_terminos.get(id);
  if (!prev) return false;
  await db.clasificacion_terminos.update(id,
    parcheDeUpdate({ clasificacion_codigo: String(clasificacionCodigo) }, prev, esPrueba, userId));
  return true;
}

/**
 * Enseña al diccionario lo que UNA DECISIÓN de clasificación decidió — pedido
 * de Gabriel, 14-sep-2026: «quiero que aprenda del descarte y de la
 * aceptación de las propuestas [...] agregar o quitar del diccionario».
 *
 * Es una sola operación para las dos cosas que pidió, porque a nivel de datos
 * son la misma: "aceptar" una propuesta y "descartarla para elegir otra cosa"
 * ambas terminan en UNA decisión final, y lo que hay que enseñar es SIEMPRE
 * esa decisión final — nunca la propuesta que no se usó.
 *   · Si la descripción no tenía término → lo CREA apuntando al código final.
 *   · Si ya tenía uno apuntando a OTRO código (la propuesta que se descartó)
 *     → lo MUEVE al código correcto (mismo mecanismo que el botón "↺ Cambiar"
 *     del panel de Clasificaciones) en vez de dejar dos entradas peleando.
 *   · Si ya apuntaba al mismo código → no hace nada (ya estaba enseñado).
 *
 * El término es la descripción CRUDA completa, no palabras sueltas:
 * clasificarConIUPC() matchea por EXACTO (0.99) y por PARECIDO de tokens
 * (hasta 0.97, umbral 0.55 — ver `mejorDe()`), así que una frase entera
 * generaliza sola a las que compartan varias palabras, no solo a la repetida.
 *
 * Nunca lanza: enseñar es un efecto de lado de la decisión, jamás debe
 * bloquearla ni mostrarle un error a quien solo quería clasificar una fila.
 * Devuelve null si no hizo nada.
 */
export async function enseñarDiccionario({ descripcion, clasificacionCodigo, companyId = null, origen = 'decision' }, { userId = null } = {}) {
  try {
    const txt = String(descripcion || '').trim();
    const cod = String(clasificacionCodigo || '').trim();
    // 'sin_clasificar' es la ausencia de clasificación (regla 8 del
    // CLAUDE.md) — enseñarla sería entrenar al diccionario a decir «no sé».
    if (!txt || !cod || cod === 'sin_clasificar') return null;
    const norm = normIUPC(txt);
    if (!norm) return null;
    const esPrueba = esModoPrueba();
    const existente = await db.clasificacion_terminos
      .filter(r => !r.deleted_at && r.norm === norm && filaDelModo(r, esPrueba)).first();
    if (existente) {
      if (String(existente.clasificacion_codigo) === cod) return null; // ya enseñado
      await moverTermino(existente.id, cod, { userId });
      return { accion: 'movido', termino: txt, desde: existente.clasificacion_codigo, hacia: cod };
    }
    const fila = filaNueva({
      termino: txt, norm, clasificacion_codigo: cod,
      // Provisional por definición (mig 212): vale DESPUÉS de la norma y se
      // borra si alguien desclasifica esa fila. 'manual' solo lo escribe el
      // panel de Clasificaciones.
      origen: origen === 'manual' ? 'manual' : (origen === 'ia' ? 'ia' : 'decision'),
      company_id: companyId || null, deleted_at: null,
    }, 'clasificacion_terminos', esPrueba, userId);
    await db.clasificacion_terminos.add(fila);
    return { accion: 'creado', termino: txt, hacia: cod };
  } catch (e) {
    console.warn('[enseñarDiccionario] no se pudo enseñar (no bloquea la decisión):', e?.message || e);
    return null;
  }
}

/**
 * DESCLASIFICAR TIENE QUE DESENSEÑAR (tanda 1, 15-set-2026).
 *
 * EL DEFECTO: `reabrir`/`reabrirEnLote` borraban la decisión y dejaban vivo el
 * término que esa decisión había enseñado. El cartel decía «lo que le enseñaron
 * al diccionario NO se borra», que era describir el bug, no una decisión de
 * producto. Medido en producción: Gabriel deshizo 649 decisiones y quedaron 365
 * términos huérfanos, muchos mal, pisando el Anexo 2 con score 0,99. Cada tanda
 * nueva arrancaba envenenada por la anterior.
 *
 * QUÉ NO BORRA: los `origen: 'manual'` — los que alguien escribió a mano en el
 * panel de Clasificaciones. Esos no los puso una decisión de la bandeja, así
 * que deshacer una decisión no tiene por qué llevárselos puestos. Se sacan con
 * el ✕ de su propio panel.
 *
 * Nunca lanza: igual que enseñar, es un efecto de lado del deshacer y no puede
 * dejar la decisión a medio borrar. Devuelve cuántos términos se olvidaron.
 */
export async function olvidarDiccionario(normsOTextos, { userId = null } = {}) {
  try {
    const buscados = new Set(
      (normsOTextos || [])
        .map(x => normIUPC(String(x || '')))
        .filter(Boolean),
    );
    if (!buscados.size) return 0;
    const esPrueba = esModoPrueba();
    const candidatos = await db.clasificacion_terminos
      .filter(r => !r.deleted_at && buscados.has(r.norm)
        && r.origen !== 'manual' && filaDelModo(r, esPrueba)).toArray();
    let n = 0;
    for (const prev of candidatos) {
      // Un término que nunca llegó al server se borra de verdad; el resto va
      // por baja lógica para que el borrado viaje a los otros equipos.
      if (prev.sync_status === SYNC_STATUS.PENDING_CREATE || esPrueba) {
        await db.clasificacion_terminos.delete(prev.id);
      } else {
        await db.clasificacion_terminos.update(prev.id,
          parcheDeUpdate({ deleted_at: ahora() }, prev, esPrueba, userId));
      }
      n++;
    }
    return n;
  } catch (e) {
    console.warn('[olvidarDiccionario] no se pudo olvidar (no bloquea el deshacer):', e?.message || e);
    return 0;
  }
}
