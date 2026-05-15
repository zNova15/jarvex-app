-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Branding personalizable por empresa
--
-- Las plantillas imprimibles (asistencia, ingresos/salidas, entrega de
-- EPPs, etc.) mostraban "JARVEX" hardcodeado en el header. Para clientes
-- que son contratistas/consorcios distintos, ahora cada `company` puede
-- subir su propio logo (base64 dataURL) y su nombre comercial corto.
-- Cuando la obra tiene `ejecutora_company_id`, las plantillas usan la
-- marca de esa empresa.
--
-- logo_dataurl: dataURL (PNG/JPG ya comprimido por el cliente a ≤200KB).
--   Lo guardamos inline en la tabla en vez de Storage para que funcione
--   offline (las plantillas se generan offline en obra).
-- nombre_corto: nombre comercial para el header (la columna `name` ya
--   existe — `nombre_corto` se usa solo para el branding si el `name`
--   es demasiado largo. Es opcional.)
-- codigo_doc_prefix: prefijo de código de formato (ej. "F-SSO-05" para
--   la plantilla EPP). Opcional. Si está, aparece en la esquina del
--   header de las plantillas.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_dataurl TEXT,
  ADD COLUMN IF NOT EXISTS nombre_corto TEXT,
  ADD COLUMN IF NOT EXISTS codigo_doc_prefix TEXT;

COMMENT ON COLUMN public.companies.logo_dataurl IS
  'Logo de la empresa como dataURL (base64). Comprimido a ≤200KB del lado cliente. Se usa en plantillas imprimibles cuando esta company es la ejecutora de la obra.';
COMMENT ON COLUMN public.companies.nombre_corto IS
  'Nombre comercial corto para el header de plantillas. Si null, se usa `name`.';
COMMENT ON COLUMN public.companies.codigo_doc_prefix IS
  'Prefijo de código de formato (ej. F-SSO-05) mostrado en plantillas EPP.';

NOTIFY pgrst, 'reload schema';
