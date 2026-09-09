-- ═══════════════════════════════════════════════════════════════════
-- 201 — LO QUE PIDIÓ LA OBRA: almacén, órdenes y firmas (8-set-2026)
--
-- Tres pedidos distintos que caen en tres tablas distintas. Van juntos
-- porque son de la misma tanda y todos son ADITIVOS y NULLABLE: nada de
-- lo que ya está cargado cambia de significado, y la app vieja sigue
-- funcionando contra este esquema.
--
--   1. `evidencias`  — el respaldo de un movimiento de CAJA CHICA.
--   2. `accounting_movements` — sacar un comprobante de «Sin respaldo».
--   3. `companies` + `ordenes_compra` — quién firma cada orden.
--
-- ⚠ ORDEN DE APLICACIÓN: esta migración va ANTES del deploy del código.
-- El push del SyncEngine manda el registro entero (stripLocalFields solo
-- saca los `_*`), así que un cliente nuevo contra un server sin estas
-- columnas devuelve PGRST204 en cada escritura de esas tablas.
-- ═══════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
-- 1. EL RESPALDO DE UN GASTO DE CAJA CHICA
--
-- Gabriel, con el feedback de la almacenera: «caja chica con descarga de
-- Excel y también para agregar foto de movimientos (puede ser facturas,
-- PDF, foto de evidencia)». Hasta hoy el gasto se anotaba con un número de
-- boleta escrito a mano y el papel no estaba en ningún lado: al cerrar la
-- caja no había con qué cotejar.
--
-- No hace falta columna nueva —se guarda como una `evidencias` más, con
-- `modulo_relacionado = 'caja_chica_movimientos'`— pero SÍ hace falta
-- tocar la policy: `evidencias: ver segun tipo` termina en `ELSE true`, así
-- que un tipo nuevo lo vería CUALQUIER usuario autenticado, incluidos el
-- maestro de obra y el personal de campo.
--
-- Quién lo ve: quien lleva la caja (almacén), quien la controla
-- (contabilidad, admin, tesorería) y la conducción. Ni ingenieros ni campo.
--
-- ⚠ Regla crítica 5 del repo: esta policy y `src/lib/evidencias-visibilidad.js`
-- se mantienen en ESPEJO. El cliente ya tiene la misma lista
-- (TIPOS_CAJA_CHICA_VIS / ROLES_CAJA_CHICA).
--
-- El INSERT no cambia: la policy vigente ya exige un rol de la allowlist
-- rls033_insert, donde el almacenero está.
-- ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "evidencias: ver segun tipo" ON public.evidencias;

CREATE POLICY "evidencias: ver segun tipo" ON public.evidencias
FOR SELECT USING (
  (subido_por = auth.uid()) OR (created_by = auth.uid()) OR
  CASE
    WHEN (tipo_evidencia = ANY (ARRAY[
      'bancarizacion','comprobante_captura','factura','recibo_honorarios',
      'pago_evidencia','guia_remision','sctr_cotizacion','sctr_pago',
      'sctr_factura','sctr_otro','constancia_detraccion','factura_campo'
    ])) THEN has_role(ARRAY['admin','contador','ayudante_contador'])
    WHEN (tipo_evidencia = ANY (ARRAY['cv_profesional','constancia_experiencia']))
      THEN has_role(ARRAY['admin','gerente','rrhh','licitaciones'])
    -- Papeles societarios de la empresa (tanda 10)
    WHEN (tipo_evidencia = ANY (ARRAY[
      'doc_empresa_ficha_ruc','doc_empresa_vigencia_poder',
      'doc_empresa_testimonio','doc_empresa_rnp','doc_empresa_otro'
    ])) THEN has_role(ARRAY['admin','gerente','contador','ayudante_contador','tesorero','licitaciones','asistente_admin'])
    -- Respaldo de caja chica (esta migración): el almacenero SÍ, campo NO.
    WHEN (tipo_evidencia = 'caja_chica_respaldo')
      THEN has_role(ARRAY['admin','gerente','contador','ayudante_contador','tesorero','almacenero','asistente_admin'])
    ELSE true
  END
);

-- ──────────────────────────────────────────────────────────────────
-- 2. EL COMPROBANTE QUE NO LLEVA ORDEN DE RESPALDO
--
-- Gabriel: «con el tema de facturas a respaldar, permite que se pueda
-- eliminar las que no consideremos que se deban respaldar».
--
-- El umbral (S/ 2.000) y el tipo de operación aciertan casi siempre, pero
-- no siempre: un reembolso interno, una compra ya cubierta por un contrato
-- marco, un error de carga. Esas filas se quedaban en «Sin respaldo» para
-- siempre y el «% respaldado» nunca cerraba — así que la lista dejaba de
-- mirarse, que es peor que no tenerla.
--
-- Es un DESCARTE, NO UN BORRADO. El movimiento contable no se toca: sigue
-- en el libro con su importe, su fecha y su comprobante. Borrarlo para
-- limpiar una lista de tareas sería falsear la contabilidad.
--
-- Se guarda el MOTIVO, QUIÉN y CUÁNDO porque dentro de un año nadie va a
-- acordarse de por qué una factura de S/ 40.000 no tiene papel — y esa es
-- exactamente la pregunta que hace una auditoría. Es reversible desde la
-- pantalla («Devolver a la lista»).
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS respaldo_no_requerido boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS respaldo_no_requerido_motivo text,
  ADD COLUMN IF NOT EXISTS respaldo_no_requerido_por uuid,
  ADD COLUMN IF NOT EXISTS respaldo_no_requerido_at timestamptz;

-- Un descarte sin motivo es un descarte que nadie va a poder explicar.
ALTER TABLE public.accounting_movements
  DROP CONSTRAINT IF EXISTS accounting_movements_respaldo_no_req_motivo_check;
ALTER TABLE public.accounting_movements
  ADD CONSTRAINT accounting_movements_respaldo_no_req_motivo_check
  CHECK (
    respaldo_no_requerido = false
    OR (respaldo_no_requerido_motivo IS NOT NULL AND length(btrim(respaldo_no_requerido_motivo)) >= 5)
  );

COMMENT ON COLUMN public.accounting_movements.respaldo_no_requerido IS
  'true = alguien decidió que esta compra NO lleva orden de respaldo. Sale de la pestaña «Sin respaldo» y del denominador del % (no cuenta como respaldada: cuenta como no exigible). Reversible. El movimiento NO se borra.';
COMMENT ON COLUMN public.accounting_movements.respaldo_no_requerido_motivo IS
  'Por qué no lleva orden. Obligatorio cuando respaldo_no_requerido = true (CHECK, mín. 5 caracteres).';

-- Índice parcial: la pantalla pide «los descartados de esta empresa/obra» y
-- son POCOS. Sin él, esa consulta recorre las ~1.400 filas de la tabla.
CREATE INDEX IF NOT EXISTS idx_accmov_respaldo_no_requerido
  ON public.accounting_movements (company_id, obra_id)
  WHERE respaldo_no_requerido = true AND deleted_at IS NULL;

-- ──────────────────────────────────────────────────────────────────
-- 3. QUIÉN FIRMA UNA ORDEN
--
-- La contadora jefe, 8-set-2026, mirando el PDF de la OC-008-2026: la firma
-- del medio dice «Aprobado por / Rep. Legal — CONSORCIO DEL INCA» y debería
-- decir «Representante Común». En un CONSORCIO esa figura existe y la del
-- representante legal no, así que el rótulo fijo decía algo falso en el
-- documento que se presenta ante el contratante.
--
-- Gabriel: «asumo que para otras obras sería bueno tener eso personalizable».
--
-- Dos niveles, del más general al más específico:
--   · `companies.doc_firma_*` — el criterio de la empresa, escrito una vez,
--     al lado de doc_color y doc_pie (mig 187). Es lo que se usa siempre.
--   · `ordenes_compra.firma_*` — el override de UN documento puntual.
-- Vacío en los dos ⇒ el rótulo del modelo, como hasta hoy.
--
-- Sigue valiendo la decisión de la mig 187: se personaliza la MARCA y los
-- RÓTULOS, no la ESTRUCTURA. Los bloques obligatorios (RUC, numeración,
-- desglose de IGV, las tres firmas) no se mueven ni se quitan.
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS doc_firma_elaborado text,
  ADD COLUMN IF NOT EXISTS doc_firma_aprobado text,
  ADD COLUMN IF NOT EXISTS doc_firma_receptor text;

COMMENT ON COLUMN public.companies.doc_firma_aprobado IS
  'Rótulo de la firma del medio en sus órdenes. En un consorcio: «Representante Común — CONSORCIO EL INCA». NULL = «Aprobado por / Rep. Legal — <empresa>».';

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS firma_elaborado_por text,
  ADD COLUMN IF NOT EXISTS firma_aprobado_por text,
  ADD COLUMN IF NOT EXISTS firma_receptor text;

COMMENT ON COLUMN public.ordenes_compra.firma_aprobado_por IS
  'Override del rótulo de la firma del medio SOLO para esta orden. NULL = el de la empresa (companies.doc_firma_aprobado), y si tampoco hay, el del modelo.';

NOTIFY pgrst, 'reload schema';
