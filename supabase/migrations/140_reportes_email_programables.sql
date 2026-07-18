-- 140: REPORTES POR EMAIL programables (pedido de Gabriel, jul 2026).
-- El reporte por email deja de ser solo el diario de 18:00: ahora hay TRES
-- reportes independientes (diario / semanal / mensual), cada uno con su hora,
-- su día (de semana o de mes), sus destinatarios y su on/off — configurables
-- desde la app (Reportes → Envío por email).
--
-- Arquitectura nueva: un builder en el repo (scripts/reporte-email, corre por
-- GitHub Actions cada hora) arma el HTML rico y responsive y lo deja en
-- reportes_email_outbox; n8n solo toma lo pendiente y lo envía por Gmail.
-- Así el contenido y la programación viven en el código (deployables), y n8n
-- no se vuelve a tocar.

-- (1) Config por TIPO de reporte (la fila existente pasa a ser el 'diario').
ALTER TABLE public.reportes_email_config ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'diario';
ALTER TABLE public.reportes_email_config ADD COLUMN IF NOT EXISTS dia_mes integer DEFAULT 1;
ALTER TABLE public.reportes_email_config DROP CONSTRAINT IF EXISTS reportes_email_config_tipo_check;
ALTER TABLE public.reportes_email_config ADD CONSTRAINT reportes_email_config_tipo_check
  CHECK (tipo = ANY (ARRAY['diario','semanal','mensual']::text[]));
CREATE UNIQUE INDEX IF NOT EXISTS uq_reportes_email_config_tipo ON public.reportes_email_config (tipo);

-- Sembrar las filas semanal y mensual si no existen (apagadas; heredan los
-- destinatarios del diario para que configurar sea un click).
INSERT INTO public.reportes_email_config (id, tipo, activo, frecuencia, dia_semana, dia_mes, hora_envio, destinatarios, incluir)
SELECT gen_random_uuid(), t.tipo, false, 'semanal', 1, 1,
       CASE t.tipo WHEN 'semanal' THEN '08:00' ELSE '08:00' END,
       coalesce((SELECT d.destinatarios FROM public.reportes_email_config d WHERE d.tipo = 'diario' LIMIT 1), '{}'),
       '{movimientos,contable,ingenieros,especialidades}'
FROM (VALUES ('semanal'), ('mensual')) AS t(tipo)
WHERE NOT EXISTS (SELECT 1 FROM public.reportes_email_config c WHERE c.tipo = t.tipo);

-- (2) OUTBOX: los correos listos para enviar. El builder inserta; n8n toma lo
-- 'pendiente', envía y marca 'enviado' (o 'error' con el detalle).
CREATE TABLE IF NOT EXISTS public.reportes_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  destinatarios text[] NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT reportes_email_outbox_estado_check CHECK (estado = ANY (ARRAY['pendiente','enviado','error']::text[]))
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_pendientes ON public.reportes_email_outbox (created_at) WHERE estado = 'pendiente';

ALTER TABLE public.reportes_email_outbox ENABLE ROW LEVEL SECURITY;
-- Solo lectura para admin/contador desde la app (el builder y n8n usan
-- service_role, que bypassa RLS). Nadie escribe desde el cliente.
DROP POLICY IF EXISTS "email_outbox: lee admin" ON public.reportes_email_outbox;
CREATE POLICY "email_outbox: lee admin" ON public.reportes_email_outbox
  FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'contador'::text]));

NOTIFY pgrst, 'reload schema';
