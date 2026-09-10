// ── CURSOR COMPUESTO (updated_at, id) ──────────────────────────────────────
//
// El pull incremental filtraba .gte('updated_at', watermark) y avanzaba el
// watermark a MAX(updated_at) de lo traído. El .gte (en vez de .gt) es
// deliberado: con .gt, una fila que empata EXACTO con el watermark queda fuera
// para siempre. El comentario original decía "el re-pull del borde es barato"
// — y lo es, mientras el borde sean unas pocas filas.
//
// Deja de serlo cuando la tabla entró de un import masivo y TODAS sus filas
// comparten un único updated_at: entonces el borde ES la tabla entera y cada
// ciclo la vuelve a bajar completa, aunque nada haya cambiado. El 9-sep-2026
// eso agotó la cuota de egress y Supabase cortó el proyecto con 402 en
// /auth/v1/token — nadie podía entrar. Medido en producción, por dispositivo y
// por ciclo (uno cada 30 s): 7,07 MB entre insumos_partida_versionadas (6.722
// de 6.722 filas), partidas_versionadas (1.158 de 1.158), insumos_partida
// (1.115 de 6.722) y oc_items (46 de 92).
//
// El cursor compuesto pide "lo posterior al sello, MÁS lo del mismo sello que
// todavía no vi", en vez de "todo lo del sello para arriba":
//     updated_at > TS  OR  (updated_at = TS AND id > ID)
// Conserva la garantía del .gte (no se pierde el borde) sin re-descargarlo.
//
// Viven aparte de SyncEngine porque son funciones puras: así se testean sin
// arrastrar el cliente de supabase (que toca window.localStorage al importarse).

export function filtroIncremental(q, ts, id) {
  if (!ts) return q;
  // Sin id guardado (watermark escrito por una versión anterior de la app)
  // caemos al .gte de siempre: esa sync se paga el re-pull del borde una vez y
  // deja ya el cursor completo grabado para la siguiente.
  if (!id) return q.gte('updated_at', ts);
  return q.or(`updated_at.gt.${ts},and(updated_at.eq.${ts},id.gt.${id})`);
}

// Segunda mitad del cursor: el id más alto ENTRE LAS FILAS QUE COMPARTEN el
// sello máximo. Es lo que permite retomar dentro de un bloque de sellos iguales
// en vez de volver a pedirlo entero.
export function idDelBorde(filas, maxUpd) {
  let maxId = null;
  for (const r of filas) {
    if (r?.updated_at === maxUpd && r.id != null && (maxId === null || r.id > maxId)) maxId = r.id;
  }
  return maxId;
}
