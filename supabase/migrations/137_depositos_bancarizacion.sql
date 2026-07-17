-- 137: DEPÓSITOS de bancarización multi-factura (pedido de Gabriel, jul 2026).
-- Hasta ahora la bancarización era 1 factura ← N constancias (pagos_partes).
-- Esto agrega la dirección inversa: UNA transferencia/depósito que cubre
-- VARIAS facturas, consumiendo saldo. Ej: facturas de 3,000 + 7,000 + 10,000
-- al mismo proveedor → un depósito de 20,000; cada vínculo descuenta y el
-- server RECHAZA exceder el total (no puede cubrirse más de lo transferido).
-- Regla de identidad: el depósito solo cubre facturas del MISMO pagador →
-- cobrador (misma empresa del grupo + misma dirección compra/venta + mismo
-- tercero). La constancia (voucher) se adjunta como evidencia con
-- modulo_relacionado='depositos_bancarizacion'.
--
-- El cliente valida primero (src/lib/depositos-bancarizacion.js, con mensajes
-- claros); este trigger es la barrera de integridad (incluye concurrencia:
-- lock del depósito).

CREATE TABLE IF NOT EXISTS depositos_bancarizacion (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  company_id uuid REFERENCES companies(id),   -- empresa del grupo (pagador en compra, cobrador en venta)
  clase text NOT NULL DEFAULT 'compra',       -- compra: nosotros pagamos | venta: el tercero nos paga
  tercero_ruc text,
  tercero_nombre text,
  fecha date,
  monto_total numeric(14,2) NOT NULL,
  moneda text NOT NULL DEFAULT 'PEN',
  metodo text,                                -- transferencia | deposito | agente | cheque | otro
  referencia text,                            -- n° de operación
  evidencia_id uuid,                          -- FK-less a evidencias (misma técnica que registro_relacionado_id)
  observaciones text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,
  CONSTRAINT depositos_banc_clase_check CHECK (clase = ANY (ARRAY['compra','venta'])),
  CONSTRAINT depositos_banc_monto_check CHECK (monto_total > 0)
);
CREATE INDEX IF NOT EXISTS idx_dep_banc_company ON depositos_bancarizacion (company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dep_banc_obra ON depositos_bancarizacion (obra_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_dep_banc_updated ON depositos_bancarizacion;
CREATE TRIGGER trg_dep_banc_updated BEFORE UPDATE ON depositos_bancarizacion
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Vínculo: cada parte puede consumir saldo de un depósito.
ALTER TABLE pagos_partes ADD COLUMN IF NOT EXISTS deposito_id uuid REFERENCES depositos_bancarizacion(id);
CREATE INDEX IF NOT EXISTS idx_pagos_partes_deposito ON pagos_partes (deposito_id) WHERE deleted_at IS NULL;

-- Invariante financiero: Σ partes vivas de un depósito ≤ monto_total (+1 ctvo
-- de tolerancia), y el par pagador→cobrador debe coincidir con la factura.
CREATE OR REPLACE FUNCTION check_parte_deposito() RETURNS trigger AS $$
DECLARE
  dep depositos_bancarizacion%ROWTYPE;
  mov accounting_movements%ROWTYPE;
  usado numeric;
BEGIN
  IF NEW.deposito_id IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Lock del depósito: dos vínculos simultáneos no pueden pasarse del saldo.
  SELECT * INTO dep FROM depositos_bancarizacion WHERE id = NEW.deposito_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'depósito % no existe', NEW.deposito_id;
  END IF;
  IF dep.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'el depósito está eliminado';
  END IF;
  SELECT COALESCE(SUM(monto), 0) INTO usado FROM pagos_partes
    WHERE deposito_id = NEW.deposito_id AND deleted_at IS NULL AND id <> NEW.id;
  IF usado + COALESCE(NEW.monto, 0) > dep.monto_total + 0.01 THEN
    RAISE EXCEPTION 'saldo insuficiente del depósito: usado % + nuevo % excede el total %',
      usado, NEW.monto, dep.monto_total;
  END IF;
  IF NEW.accounting_movement_id IS NOT NULL THEN
    SELECT * INTO mov FROM accounting_movements WHERE id = NEW.accounting_movement_id;
    IF FOUND THEN
      IF dep.company_id IS NOT NULL AND mov.company_id IS NOT NULL
         AND dep.company_id <> mov.company_id THEN
        RAISE EXCEPTION 'el depósito pertenece a otra empresa del grupo';
      END IF;
      IF COALESCE(mov.clase, CASE WHEN mov.type = 'income' THEN 'venta' ELSE 'compra' END) <> dep.clase THEN
        RAISE EXCEPTION 'el depósito no coincide en dirección compra/venta con la factura';
      END IF;
      IF COALESCE(regexp_replace(dep.tercero_ruc, '\D', '', 'g'), '') <> ''
         AND COALESCE(regexp_replace(mov.third_party_ruc, '\D', '', 'g'), '') <> ''
         AND regexp_replace(dep.tercero_ruc, '\D', '', 'g') <> regexp_replace(mov.third_party_ruc, '\D', '', 'g') THEN
        RAISE EXCEPTION 'el depósito es de otro pagador→cobrador (tercero distinto)';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_parte_deposito ON pagos_partes;
CREATE TRIGGER trg_check_parte_deposito BEFORE INSERT OR UPDATE ON pagos_partes
  FOR EACH ROW EXECUTE FUNCTION check_parte_deposito();

-- RLS: mismos criterios que pagos_partes (mig 121) — los DATOS los leen los
-- roles contables + gerencia; escribir es de contabilidad. La CONSTANCIA
-- (archivo) queda igual gateada por la RLS de evidencias (mig 136: solo
-- contabilidad + admin).
ALTER TABLE depositos_bancarizacion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dep_banc: lee contable" ON depositos_bancarizacion;
CREATE POLICY "dep_banc: lee contable" ON depositos_bancarizacion
  FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'contador'::text, 'gerente'::text, 'ayudante_contador'::text, 'tesorero'::text]));
DROP POLICY IF EXISTS "dep_banc: escribe contable" ON depositos_bancarizacion;
CREATE POLICY "dep_banc: escribe contable" ON depositos_bancarizacion
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text]));
DROP POLICY IF EXISTS "dep_banc: actualiza contable" ON depositos_bancarizacion;
CREATE POLICY "dep_banc: actualiza contable" ON depositos_bancarizacion
  FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text]));
DROP POLICY IF EXISTS "dep_banc: admin borra" ON depositos_bancarizacion;
CREATE POLICY "dep_banc: admin borra" ON depositos_bancarizacion
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

NOTIFY pgrst, 'reload schema';
