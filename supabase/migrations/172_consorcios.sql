-- ═══════════════════════════════════════════════════════════════════
-- 172 — CONSORCIO como entidad propia + saneamiento del catálogo de empresas
--
-- Tanda 1 de 3 (docs/tanda-1-modelo-de-datos.md). Pedido de Gabriel: el
-- consorcio hoy está modelado mal, guardado dentro de `companies` como si
-- fuera una empresa más del grupo.
--
-- LO QUE MOSTRÓ LA INSPECCIÓN DE PRODUCCIÓN (2-sep-2026)
--
--   • Los consorcios reales del grupo son DOS, y cada uno ejecuta UNA obra
--     — el 1:1 del documento está confirmado por el dato:
--       CONSORCIO CHUSAAC  (RUC 20613408011,  42 movs) → "Obras San Marcos"
--       CONSORCIO EL INCA  (RUC 20615346081, 125 movs) → obra Los Baños del Inca
--
--   • Hay DOS companies que se llaman "CONSORCIO …" y NO son consorcios del
--     grupo: CONSORCIO ESPERANZA y CONSORCIO SAMADAY son proveedores que
--     Captura Mágica creó sola (rol_grupo='origen'). Reclasificar por nombre
--     los rompería. Por eso esta migración NO RECLASIFICA NADA: solo agrega
--     estructura, y la reclasificación pasa por una pantalla de revisión con
--     la evidencia a la vista (nº de movimientos, si es ejecutora de una obra).
--
--   • `obras.consorcio_miembros` (jsonb, mig 035) está NULL en las dos obras:
--     el modelo JSONB nunca se usó. No hay socios que migrar — se capturan de
--     cero. Esa columna queda DEPRECADA: se lee como fallback, no se escribe.
--
-- DECISIONES DE DISEÑO
--
-- 1. SUPERPONER, NO MOVER. No existe ninguna tabla de libros contables en
--    JARVEX: registro de ventas, registro de compras, libro diario, EE.FF. y
--    PLE son todos derivados en memoria de `accounting_movements` filtrada por
--    company_id (src/lib/sunat-ple.js, src/lib/asientos.js, jx-plan-cuentas,
--    jx-asientos, jx-libros-electronicos). "Contabilidad independiente del
--    consorcio" no es construir libros — es decidir quién es titular de esos
--    movimientos.
--    Por eso `consorcios` conserva un puntero a su fila en `companies` como
--    TITULAR CONTABLE INTERNO: los 167 movimientos no se mueven, y PLE, EE.FF.
--    y comprobantes siguen funcionando sin tocar una línea. Lo que cambia es
--    la semántica: esa company se marca tipo_entidad='consorcio' y desaparece
--    del catálogo de empresas del grupo.
--    INVARIANTE: obras.ejecutora_company_id sigue apuntando a esa company.
--    Toda la lectura contable existente depende de eso.
--
-- 2. El consorcio CUELGA DE LA OBRA (obra_id UNIQUE), no es hermano de
--    `companies`. Nace con la buena pro, se disuelve al terminar la obra.
--
-- 3. SOCIO ≠ SUBCONTRATISTA (doc §2, confirmado: no fusionar). El socio aporta
--    capital o experiencia y solo tiene su % — sin contabilidad propia y sin
--    personal de ejecución. El subcontratista aporta mano de obra y sigue
--    exactamente como está (subcontratistas → subcontratos → personal /
--    asistencia / epp_entregas / subcontrato_valorizaciones). Esta migración
--    NO TOCA nada de esa cadena.
--
-- 4. tipo_entidad ordena de una sola vez las dos suciedades del catálogo: los
--    2 consorcios y los 13 proveedores autocreados por Captura Mágica. De 17
--    companies activas, solo 2 son empresas propias del grupo.
--
-- Todo aditivo y reversible.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Eje de clasificación del catálogo de empresas ───────────────
-- default 'propia' A PROPÓSITO: aplicar esta migración no debe hacer
-- desaparecer nada de la pantalla Empresas. La reclasificación es un acto
-- explícito y revisado, no un efecto secundario del deploy.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS tipo_entidad text NOT NULL DEFAULT 'propia';

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_tipo_entidad_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_tipo_entidad_check
  CHECK (tipo_entidad = ANY (ARRAY['propia'::text, 'consorcio'::text, 'tercero'::text]));

CREATE INDEX IF NOT EXISTS idx_companies_tipo_entidad
  ON public.companies (tipo_entidad) WHERE deleted_at IS NULL;

-- ── 2. Consorcio (1:1 con la obra que ejecuta) ─────────────────────
CREATE TABLE IF NOT EXISTS public.consorcios (
  id uuid PRIMARY KEY,
  obra_id uuid NOT NULL REFERENCES public.obras(id),
  -- Titular contable interno: la fila de `companies` que lleva el RUC del
  -- consorcio y a la que ya apuntan sus accounting_movements. Nullable porque
  -- un consorcio recién ganado puede no tener RUC todavía.
  company_id uuid REFERENCES public.companies(id),
  nombre text NOT NULL,
  ruc text,
  estado text NOT NULL DEFAULT 'activo',
  fecha_constitucion date,
  fecha_disolucion date,          -- se disuelve al terminar la obra
  observaciones text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

ALTER TABLE public.consorcios DROP CONSTRAINT IF EXISTS consorcios_estado_check;
ALTER TABLE public.consorcios ADD CONSTRAINT consorcios_estado_check
  CHECK (estado = ANY (ARRAY['activo'::text, 'disuelto'::text]));

-- 1:1 con la obra, y una company no puede ser el titular de dos consorcios.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consorcios_obra
  ON public.consorcios (obra_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_consorcios_company
  ON public.consorcios (company_id) WHERE deleted_at IS NULL AND company_id IS NOT NULL;

-- ── 3. Socios del consorcio (N por consorcio) ──────────────────────
-- El socio es una `companies` — propia del grupo o tercera. Si es tercera se
-- registra con tipo_entidad='tercero' y aparece acá igual: lo que la hace
-- socia es esta fila, no su tipo.
CREATE TABLE IF NOT EXISTS public.consorcio_socios (
  id uuid PRIMARY KEY,
  consorcio_id uuid NOT NULL REFERENCES public.consorcios(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  participacion_pct numeric(5,2) NOT NULL,
  es_lider boolean NOT NULL DEFAULT false,
  aporte text,                    -- 'capital' | 'experiencia' | libre
  observaciones text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

ALTER TABLE public.consorcio_socios DROP CONSTRAINT IF EXISTS consorcio_socios_pct_check;
ALTER TABLE public.consorcio_socios ADD CONSTRAINT consorcio_socios_pct_check
  CHECK (participacion_pct > 0 AND participacion_pct <= 100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_consorcio_socios_par
  ON public.consorcio_socios (consorcio_id, company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_consorcio_socios_consorcio
  ON public.consorcio_socios (consorcio_id) WHERE deleted_at IS NULL;

-- Las reglas que NO se pueden expresar en un CHECK de fila (la suma de los %
-- debe dar 100, mínimo 2 socios, a lo sumo un líder, y el socio no puede ser
-- el titular contable del propio consorcio) viven en src/lib/consorcio.js
-- `validarSocios`, con tests. Un CHECK por fila no puede ver a sus hermanas.

-- ── 4. Triggers de updated_at ──────────────────────────────────────
DROP TRIGGER IF EXISTS trg_consorcios_updated ON public.consorcios;
CREATE TRIGGER trg_consorcios_updated BEFORE UPDATE ON public.consorcios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_consorcio_socios_updated ON public.consorcio_socios;
CREATE TRIGGER trg_consorcio_socios_updated BEFORE UPDATE ON public.consorcio_socios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 5. RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.consorcios       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consorcio_socios ENABLE ROW LEVEL SECURITY;

-- LECTURA: authenticated, igual que `obras` y `companies`.
-- Deliberado. "Quién ejecuta esta obra" ya es legible hoy en obras
-- (ejecutora_company_id) y en companies. Restringir SOLO esta tabla sería
-- teatro: no ocultaría el dato y en cambio dejaría a los roles de obra viendo
-- una obra sin socios, con el fallback al jsonb dando distinto según el rol.
-- El endurecimiento de lectura corresponde a obras/companies, no acá.
DROP POLICY IF EXISTS "consorcios: autenticado lee" ON public.consorcios;
CREATE POLICY "consorcios: autenticado lee" ON public.consorcios
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "socios: autenticado lee" ON public.consorcio_socios;
CREATE POLICY "socios: autenticado lee" ON public.consorcio_socios
  FOR SELECT TO authenticated USING (true);

-- ESCRITURA: acotada. Constituir un consorcio y fijar los % de participación
-- es un acto societario, no una edición de obra. Este set debe mantenerse en
-- espejo con el gate del cliente (jx-obra.jsx: puedeEditarConsorcio) — si el
-- cliente deja editar a un rol que acá no puede escribir, el push falla en
-- silencio y el usuario pierde el trabajo sin entender por qué.
DROP POLICY IF EXISTS "consorcios: conduccion escribe" ON public.consorcios;
CREATE POLICY "consorcios: conduccion escribe" ON public.consorcios
  FOR ALL TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'contador'::text]))
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'contador'::text]));

DROP POLICY IF EXISTS "socios: conduccion escribe" ON public.consorcio_socios;
CREATE POLICY "socios: conduccion escribe" ON public.consorcio_socios
  FOR ALL TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'contador'::text]))
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'contador'::text]));

-- ── 6. Cerco del rol campo (lección de las migs 167 y 171) ─────────
-- TODA tabla nueva nace con su cerco: la cuenta compartida del portal de campo
-- no toca nada fuera de sus fotos.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consorcios', 'consorcio_socios'] LOOP
    EXECUTE format($f$
      CREATE POLICY campo_cerco_select ON public.%I AS RESTRICTIVE
        FOR SELECT TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text);
      CREATE POLICY campo_cerco_insert ON public.%I AS RESTRICTIVE
        FOR INSERT TO authenticated WITH CHECK (current_user_rol() IS DISTINCT FROM 'campo'::text);
      CREATE POLICY campo_cerco_update ON public.%I AS RESTRICTIVE
        FOR UPDATE TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text)
        WITH CHECK (current_user_rol() IS DISTINCT FROM 'campo'::text);
      CREATE POLICY campo_cerco_delete ON public.%I AS RESTRICTIVE
        FOR DELETE TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text);
    $f$, t, t, t, t);
  END LOOP;
END $$;

-- ── 7. Documentación en el esquema ─────────────────────────────────
COMMENT ON TABLE public.consorcios IS
  'Consorcio 1:1 con la obra que ejecuta (mig 172). company_id es su TITULAR CONTABLE: la fila de companies con el RUC del consorcio a la que ya apuntan sus accounting_movements. obras.ejecutora_company_id debe seguir apuntando a esa misma company — de eso depende toda la lectura contable existente.';
COMMENT ON COLUMN public.companies.tipo_entidad IS
  'propia = empresa del grupo (única que sale en el catálogo Empresas) | consorcio = titular contable de un consorcio, se ve desde su obra | tercero = proveedor/cliente, la mayoría autocreados por Captura Mágica.';
COMMENT ON COLUMN public.obras.consorcio_miembros IS
  'DEPRECADA (mig 172). Nunca se usó en producción: NULL en todas las obras. Los socios viven en consorcio_socios. Se lee como fallback en src/lib/consorcio.js; no escribir más.';

NOTIFY pgrst, 'reload schema';
