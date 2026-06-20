-- 085: ingeniero a cargo = usuario del sistema (rol Ingeniero, incremento 1 / F2).
-- frentes_obra.ingeniero_user_id apunta a profiles.id (el usuario que loguea),
-- a diferencia del viejo ingeniero_id que apunta a un registro de personal.
-- Es el vínculo que permite scopear el dashboard del ingeniero a su(s) frente(s).
-- Aditivo, sin FK estricta (como el resto), no indexado en Dexie.

ALTER TABLE public.frentes_obra ADD COLUMN IF NOT EXISTS ingeniero_user_id uuid;
CREATE INDEX IF NOT EXISTS idx_frentes_ing_user ON public.frentes_obra(obra_id, ingeniero_user_id) WHERE ingeniero_user_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
