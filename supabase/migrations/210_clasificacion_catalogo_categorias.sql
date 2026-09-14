-- 210 · clasificacion_catalogo: el CHECK se quedó atrás del vocabulario real
--
-- SÍNTOMA (Gabriel, 13-set-2026, "Estado de sincronización"): 2 movimientos
-- con error de push, los dos con el mismo mensaje:
--   [23514] new row for relation "clasificacion_catalogo" violates check
--   constraint "clasificacion_catalogo_categoria_check"
-- El campo con el problema: categoria = 'servicios'.
--
-- CAUSA: la mig 113 (clasificador de ítems de factura) fijó el CHECK con 7
-- categorías: materiales, herramientas, maquinaria, epp, insumos_emergencia,
-- gastos_generales, otros. Cuando se agregó la clasificación de servicios y
-- de anticipos (`CATEGORIAS_ITEM` en src/lib/clasificar-items.js pasó a tener
-- 9: sumó 'servicios' y 'anticipo'), nadie actualizó este CHECK del lado del
-- server. Dexie no valida CHECKs — la fila se guarda local sin problema y
-- recién revienta al hacer push, con el sync en reintento eterno (exactamente
-- el patrón que ya describe la regla 9 del CLAUDE.md para otras tablas).
--
-- `gastoDeCategoria()` (src/lib/indices-unificados-iupc.js) devuelve
-- 'servicios' para el árbol de servicios (S01-S13) y para la categoría
-- complementaria del mismo nombre; `clasificarLineaPorTexto()`
-- (inventario-empresa.js) y `CATEGORIAS_ITEM` usan 'anticipo'. Las dos ya son
-- vocabulario real y activo — no un valor de prueba — así que el CHECK se
-- amplía a juego con el cliente en vez de angostar el cliente al server viejo.
--
-- Las filas YA GUARDADAS localmente (las 2 del aviso) no se tocan acá: en
-- cuanto el CHECK acepta 'servicios', su próximo reintento de push (automático
-- en ≤30s, o "Reintentar todos" en el modal) entra solo.

ALTER TABLE clasificacion_catalogo DROP CONSTRAINT clasificacion_catalogo_categoria_check;

ALTER TABLE clasificacion_catalogo ADD CONSTRAINT clasificacion_catalogo_categoria_check
  CHECK (categoria = ANY (ARRAY[
    'materiales', 'herramientas', 'maquinaria', 'epp',
    'insumos_emergencia', 'gastos_generales', 'servicios', 'anticipo', 'otros'
  ]::text[]));
