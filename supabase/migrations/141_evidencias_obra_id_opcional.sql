-- 141: evidencias.obra_id deja de ser obligatorio (fix urgente 18-jul-2026).
--
-- Desde mig 139 las facturas pueden vincularse a Gastos Generales /
-- Contabilidad Neta / Sin clasificar (obra_id NULL en accounting_movements).
-- Sus PDFs (comprobante_captura) y constancias de bancarización llegaban con
-- obra_id NULL y el NOT NULL del server las rechazaba: decenas de evidencias
-- contables atascadas reintentando ("⏳ Subiendo bancarización" eterno, y
-- "Falta completar «obra»" en el modal de sincronización).
--
-- El blob SÍ subía a Storage (carpeta "null/…") porque la política de Storage
-- exime a admin/contador/ayudante_contador del chequeo por obra; solo la
-- metadata rebotaba. Las políticas de visibilidad de evidencias no dependen
-- de obra_id (van por tipo_evidencia + rol — mig 136), así que soltar el
-- NOT NULL no abre ningún acceso nuevo.
ALTER TABLE public.evidencias ALTER COLUMN obra_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
