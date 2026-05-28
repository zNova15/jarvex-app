-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — movimientos_epp: destino (personal o subcontratista)
--
-- Los EPP se entregan al personal directo de obra O a un subcontratista (que
-- los reparte a su propia gente). movimientos_epp solo tenía personal_id; se
-- agrega subcontratista_id + destino_tipo para registrar a quién se entregó.
-- Aditivo y nullable.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.movimientos_epp
  ADD COLUMN IF NOT EXISTS subcontratista_id UUID,
  ADD COLUMN IF NOT EXISTS destino_tipo      TEXT;  -- 'personal' | 'subcontratista'

NOTIFY pgrst, 'reload schema';
