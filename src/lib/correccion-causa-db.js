// ═══════════════════════════════════════════════════════════════════
// JARVEX — CORREGIR LA CAUSA, NO SOLO LA FILA (tanda 3 del destino).
//
// Cuando la contadora corrige la cuenta de un asiento y marca «corregir
// también la clasificación», esto escribe la familia correcta donde vive:
//
//   · alcance 'insumo'      → la familia del insumo del catálogo. Se mueven
//                             todas las descripciones que apuntan a él.
//   · alcance 'descripcion' → la descripción pasa a ser un insumo propio con
//                             esa familia (`agregarAlCatalogoYDecidir`, el
//                             mismo camino de la bandeja).
//
// La decisión de CUÁL de las dos se toma en `consecuencias-correccion.js`
// (`alcanceDeCorreccion`), que es pura y está testeada; acá solo se aterriza.
//
// ── EL INVARIANTE DE `insumo_categoria` ───────────────────────────
// decision='catalogo' exige `catalogo_insumo_id` (CHECK de la mig 195, regla 9
// del CLAUDE.md). Por eso la descripción suelta NO se escribe como una decisión
// con familia y sin insumo: se da de alta el insumo primero. Una fila mal
// formada se guardaría en Dexie y rebotaría en el push para siempre.
// ═══════════════════════════════════════════════════════════════════
import { db } from '../db/jarvex.db';
import { corregirEntrada } from './catalogo-canonico-db.js';
import { agregarAlCatalogoYDecidir } from './bandeja-categorizacion-db.js';

const auditar = async (datos) => {
  try { await window.__logAudit?.(datos); } catch { /* la auditoría no frena la corrección */ }
};

/**
 * Escribe las correcciones de clasificación.
 *
 * NO aborta al primer error: devuelve cuáles se hicieron y cuáles fallaron.
 * Quien llama decide si sigue — lo razonable es no fijar la cuenta a mano como
 * «sale sola» si la clasificación que la iba a hacer salir sola no se grabó.
 *
 * @param {Array} correcciones  las de `correccionesElegidas()`
 * @param {object} ctx          { companyId, userId, documento }
 * @returns {Promise<{hechas:Array, fallaron:Array}>}
 */
export async function corregirClasificaciones(correcciones = [], { companyId = null, userId = null, documento = '' } = {}) {
  const out = { hechas: [], fallaron: [] };
  const origen = `Libro Diario · al corregir la cuenta de ${documento || 'un comprobante'}`;

  for (const c of correcciones) {
    try {
      if (c.alcance === 'insumo' && c.catalogoId) {
        // eslint-disable-next-line no-await-in-loop
        const prev = await db.catalogo_insumos.get(c.catalogoId);
        if (!prev) throw new Error(`El insumo «${c.catalogoNombre || c.descripcion}» no está en este dispositivo — sincronizá.`);
        // `revisado`: la eligió una persona mirando la factura, así que la
        // revisión del catálogo no tiene que volver a preguntar por ella.
        // eslint-disable-next-line no-await-in-loop
        await corregirEntrada(c.catalogoId, { familia: c.familia, revisado: true }, { userId });
        // eslint-disable-next-line no-await-in-loop
        await auditar({
          action: 'update', table: 'catalogo_insumos', recordId: c.catalogoId,
          oldData: { familia: prev.familia ?? null }, newData: { familia: c.familia },
          reason: `${origen}: «${prev.nombre}» pasa de ${prev.familia || 'sin familia'} a ${c.familia}`,
        });
      } else {
        // eslint-disable-next-line no-await-in-loop
        const creado = await agregarAlCatalogoYDecidir(
          { norm: c.norm, muestra: c.descripcion, unidades: c.unidad ? [c.unidad] : [] },
          { companyId, familia: c.familia, userId, nota: 'Corregido desde el Libro Diario' },
        );
        // Si ya existía un insumo con ese nombre, `agregarAlCatalogoYDecidir`
        // lo REUSA tal cual, con su familia vieja — y la decisión nueva quedaría
        // apuntando a la clasificación que se quería corregir. Se corrige acá.
        if (creado?.id && creado.familia !== c.familia) {
          // eslint-disable-next-line no-await-in-loop
          await corregirEntrada(creado.id, { familia: c.familia, revisado: true }, { userId });
        }
        // eslint-disable-next-line no-await-in-loop
        await auditar({
          action: 'update', table: 'insumo_categoria', recordId: creado?.id || null,
          oldData: { familia: c.familiaAntes ?? null }, newData: { familia: c.familia },
          reason: `${origen}: «${c.descripcion}» se clasifica como ${c.familia}`
            + (c.catalogoNombre ? ` (antes contaba como «${c.catalogoNombre}»)` : ''),
        });
      }
      out.hechas.push(c);
    } catch (e) {
      out.fallaron.push({ ...c, error: e?.message || String(e) });
    }
  }
  // 🔴 SIN ESTO EL LIBRO DIARIO NO SE ENTERA. Las escrituras del catálogo no
  // avisan (sus pantallas releen por su cuenta), y los hooks del Libro Diario
  // solo se refrescan con `jx_data_changed`. Resultado sin el aviso: la cuenta
  // del comprobante se guardaba como «sale sola», el resolvedor seguía con la
  // familia vieja en memoria, y el asiento mostraba la cuenta de ANTES — peor
  // que no haber corregido nada — hasta recargar la página.
  if (out.hechas.length) {
    for (const tabla of ['catalogo_insumos', 'insumo_categoria']) {
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } })); } catch { /* SSR / tests */ }
    }
  }
  return out;
}

export default { corregirClasificaciones };
