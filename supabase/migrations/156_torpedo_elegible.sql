-- 156 — Torpedo de RUCs ELEGIBLE (pedido de Gabriel, 31-ago-2026): el admin
-- decide qué empresas del grupo aparecen en la tabla "¿A qué RUC pido la
-- factura?" del portal de captura de campo. Checkbox en Empresas (form de
-- jx-contabilidad); el portal filtra mostrar_torpedo !== false.
-- DEFAULT true: al aplicar, el torpedo sigue mostrando lo mismo que hoy y
-- Gabriel apaga las que no quiera. Aditiva e inocua para todo lo demás.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS mostrar_torpedo boolean NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
