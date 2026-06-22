-- 093: alerta de SOBRE-REPORTE. Cuando un ingeniero reporta avance en una partida que
-- ya estaba al/sobre 100% (terminada), el reporte se marca sobre_reporte=true y guarda el
-- motivo, para que gerentes/admins revisen (puede que la partida no estuviera realmente lista).
ALTER TABLE public.avance_obra ADD COLUMN IF NOT EXISTS sobre_reporte boolean DEFAULT false;
ALTER TABLE public.avance_obra ADD COLUMN IF NOT EXISTS motivo_sobrereporte text;
COMMENT ON COLUMN public.avance_obra.sobre_reporte IS 'true = reporte sobre una partida ya terminada (avance > 100% acumulado); requiere motivo y dispara alerta a gerentes/admins';
