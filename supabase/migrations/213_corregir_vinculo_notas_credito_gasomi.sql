-- ═══════════════════════════════════════════════════════════════════
-- 213 — DOS NOTAS DE CRÉDITO APUNTAN A LA FACTURA EQUIVOCADA.
--
-- Encontrado el 15-set-2026 midiendo para la tanda 1 (la factura anulada
-- sale del inventario). NO es un UPDATE de importes: solo corrige a qué
-- factura apunta cada nota. Ninguna fila cambia de monto, fecha ni empresa.
--
-- ── EL PROBLEMA ───────────────────────────────────────────────────
-- El número «E001-138» existe TRES veces en la base, en tres empresas
-- distintas y con tres años de diferencia:
--
--   ec71de10…  GASOMI            2023-12-12  S/ 508.745,84  ← la de verdad
--   511f7195…  SALAZAR CERQUIN   2026-04-19  S/   8.968,00
--   c6ea98e8…  CONSORCIO CHUSAAC 2026-04-19  S/   8.968,00  (espejo interco)
--
-- La nota E001-57 de GASOMI (S/ 508.745,84, mismo RUC de la Municipalidad
-- Distrital de Nuevo Chimbote, seis días después de la factura) quedó
-- apuntando a la de SALAZAR CERQUIN: otra empresa, otro tercero, otro
-- importe, y tres años más tarde. Idéntico con E001-58 → E001-139.
--
-- ── POR QUÉ IMPORTA AHORA Y ANTES NO ──────────────────────────────
-- Hasta la tanda 1 un vínculo errado no hacía nada: el inventario ni
-- miraba las notas. Desde ahora una nota que CUBRE el importe de la
-- factura la saca del inventario — y S/ 508.745 cubren de sobra S/ 8.968.
-- O sea: sin esta corrección, las 6 líneas de la factura de SALAZAR
-- CERQUIN desaparecen de su inventario sin motivo, y la factura de GASOMI
-- que sí está anulada sigue contando entera.
--
-- ── EL CRITERIO DE LA CORRECCIÓN ──────────────────────────────────
-- Cada nota pasa a apuntar a la factura que cumple las CUATRO: misma
-- empresa, mismo RUC del tercero, importe exacto y fecha anterior. Es el
-- mismo criterio que `candidatasDeNota()` usa en la app para proponer, y
-- en los dos casos deja UNA sola candidata posible.
--
-- Se escriben los IDs literales a propósito: un UPDATE con un JOIN por
-- document_number es exactamente el error que se está corrigiendo.
-- ═══════════════════════════════════════════════════════════════════

-- E001-57 (NC, GASOMI, S/ 508.745,84, 2023-12-28)
--   de: E001-138 de SALAZAR CERQUIN (S/ 8.968, 2026-04-19)   ❌
--   a:  E001-138 de GASOMI          (S/ 508.745,84, 2023-12-12) ✅
update accounting_movements
   set related_movement_id = 'ec71de10-e35f-4a66-bf4d-3ff467db6fe1',
       updated_at = now(),
       version = coalesce(version, 0) + 1
 where id = 'bb1fb12c-8b76-4cad-9d63-12a69d140070'
   and related_movement_id = '511f7195-1e9d-4448-b623-bb9b8bd9a96b';

-- E001-58 (NC, GASOMI, S/ 36.748,52, 2023-12-28)
--   de: E001-139 de CONSORCIO CHUSAAC (S/ 3.081, 2026-04-22)   ❌
--   a:  E001-139 de GASOMI            (S/ 36.748,52, 2023-12-12) ✅
update accounting_movements
   set related_movement_id = '1a0efb52-728b-4542-81c8-bcdcb7576b59',
       updated_at = now(),
       version = coalesce(version, 0) + 1
 where id = 'f951ca30-06a8-4d3d-bed6-3ad89a0fb204'
   and related_movement_id = '0101070e-4e64-4c6d-a8b3-9d0c35d092b8';

-- ── COMPROBACIÓN (correr después; tiene que devolver las dos filas
--    con empresa_nota = empresa_factura y resto = 0.00) ─────────────
-- select n.document_number nota, cn.name empresa_nota, abs(n.amount) monto_nota,
--        f.document_number factura, cf.name empresa_factura, abs(f.amount) monto_factura,
--        abs(f.amount) - abs(n.amount) resto
--   from accounting_movements n
--   join accounting_movements f on f.id = n.related_movement_id
--   left join companies cn on cn.id = n.company_id
--   left join companies cf on cf.id = f.company_id
--  where n.id in ('bb1fb12c-8b76-4cad-9d63-12a69d140070',
--                 'f951ca30-06a8-4d3d-bed6-3ad89a0fb204');
