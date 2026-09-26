-- ═══════════════════════════════════════════════════════════════════
-- 232 — LO QUE QUEDABA DE LA 176 (espejo JARVEX → CONSORCIO EL INCA)
--
-- La 176 (3-set) nunca se aplicó, y cuando Gabriel pidió completarla
-- (25-set) los datos ya no eran los que ella suponía:
--
--   · E001-2 · S/ 19.028,68 — EL INCA YA TIENE su compra espejo
--     (8c86b3ab…, creada por la app con intercompany_mirror_of → la venta).
--     Lo único que falta es el vínculo de vuelta: la venta 8cb4ec13… tiene
--     related_movement_id NULL. Sus hermanas E001-3/E001-4 lo tienen mutuo.
--     Eso es lo que hace esta migración.
--
--   · E001-1 · S/ 12.920,00 — JARVEX la ANULÓ con una nota de crédito de
--     −12.920 el mismo 06-jul (b5b974b3…). Correr la 176 tal cual le habría
--     cargado a EL INCA S/ 12.920 de costo por una factura anulada. NO se
--     espeja acá: depende de si EL INCA registró la factura y la NC en su
--     RCE (pregunta abierta para la contadora). Con la regla de Gabriel del
--     25-set (factura y NC vivas, la NC en negativo), si las registró van
--     las DOS (neto 0); si no, ninguna.
--
-- Por eso la 176 quedó marcada «NO CORRER».
-- Idempotente: solo toca la venta si sigue sin vínculo y el espejo existe vivo.
-- ═══════════════════════════════════════════════════════════════════

UPDATE accounting_movements v
   SET related_movement_id = '8c86b3ab-ae70-4f6e-bb7e-33afb5f4890b'   -- version y updated_at: trigger
 WHERE v.id = '8cb4ec13-a59c-4408-aaee-94a5a1476188'
   AND v.related_movement_id IS NULL
   AND v.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM accounting_movements m
                WHERE m.id = '8c86b3ab-ae70-4f6e-bb7e-33afb5f4890b'
                  AND m.deleted_at IS NULL
                  AND m.related_movement_id = v.id);
