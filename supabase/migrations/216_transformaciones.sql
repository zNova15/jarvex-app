-- ═══════════════════════════════════════════════════════════════════
-- 216 — LO QUE ENTRA DE UNA FORMA Y SALE DE OTRA (tanda 7, 15-set-2026).
--
-- ── EL PEDIDO, TEXTUAL ────────────────────────────────────────────
-- Gabriel definió el cajón «se transforma» con estas palabras (6-set-2026):
-- «podría o bien revenderse, o ser parte de uso de la empresa para
-- transformarla en otro insumo (planchas metálicas por ejemplo a láminas más
-- pequeñas)».
--
-- Ese cajón existe desde la tanda 6 y hasta hoy no significaba nada: marcarlo
-- apagaba el saldo del insumo —con razón, porque «comprado − vendido» no cierra
-- cuando la mercadería salió convertida en otra cosa— pero no había forma de
-- decir EN QUÉ se convirtió. Un insumo marcado así quedaba en un limbo: ni
-- cuadra ni se puede explicar por qué no cuadra. Esta tabla es lo que faltaba.
--
-- ── LO MEDIDO ANTES DE ESCRIBIR (15-set-2026, contra producción) ──
-- Materia prima que se corta, se dobla o se habilita, en líneas de factura con
-- cantidad y precio:
--     PLANCHA .................  20 líneas · 18 descripciones · S/ 100.813
--     PERFIL/ÁNGULO/PLATINA ...  42 líneas · 39 descripciones · S/ 195.180
--     MADERA/TRIPLAY ..........  37 líneas · 37 descripciones · S/ 113.174
--     FIERRO/VARILLA ..........  30 líneas · 27 descripciones · S/ 166.421
--
-- Y —el dato que CAMBIÓ el diseño— el trabajo de transformar **ya está
-- facturado como un ítem más**:
--     GASOMI, FE01-1006 (15-jul): «CORTE GUILLOTINA EN PLANCHA 1/16" (1.50MM)»
--                                 105 und × S/ 1,2712 = S/ 133,47
--     GASOMI, FE01-1123 (06-ago): el mismo corte, 4 und = S/ 6,78
--     JULCA SALAZAR CLAUDIA SOFIA: «SERVICIO DE CORTE» en 4 facturas
--                                 (E001-1353/1354/1365/1382) = S/ 344,92
--
-- Por eso una transformación NO es «el valor de las entradas se reparte entre
-- las salidas» a secas: las láminas valen la plancha MÁS lo que costó cortarla.
-- Sin los `costos`, el corte guillotina se perdería y el margen de la venta de
-- las láminas saldría inflado en exactamente ese monto.
--
-- ── LA INVARIANTE: LA PLATA NO SE CREA NI SE DESTRUYE ─────────────
--     valor_salidas = valor_entradas + valor_costos
-- Es la única razón por la que este registro sirve. Sin ella se podría meter
-- una plancha de S/ 118 y sacar láminas por S/ 400, y el inventario diría que
-- la empresa fabricó S/ 282 de la nada. El CHECK de abajo lo prohíbe con una
-- tolerancia de S/ 0,05 (redondeo), y del lado del cliente hay UN SOLO camino
-- de escritura —`construirTransformacion()` en src/lib/transformacion.js— que
-- calcula los tres totales y reparte el residuo de redondeo.
--
-- 🔴 REGLA 9 DEL CLAUDE.md, TOMADA EN SERIO. Dexie no valida CHECKs: una fila
-- que no cierre se guarda local y rebota en el push con 23514, dejando el sync
-- en reintento eterno. Por eso: (a) los valores se redondean a 2 decimales en
-- la lib, (b) el residuo se asigna a la línea más grande, de modo que la
-- diferencia sea exactamente 0, y (c) hay un test que corre los casos difíciles
-- (repartir 100 entre 3, una sola salida, salidas en unidades distintas) y
-- verifica que el cierre sea exacto. La tolerancia de 0,05 es el colchón, no
-- el mecanismo.
--
-- ── POR QUÉ LAS LÍNEAS VAN EN jsonb Y NO EN UNA TABLA HIJA ────────
-- Una transformación es un documento ATÓMICO: sus entradas, sus costos y sus
-- salidas se escriben juntos, se leen juntos y nunca se editan por separado —
-- editar media transformación es romper la invariante de arriba. Una tabla
-- hija habilitaría exactamente eso, y además sumaría una tabla más al
-- SyncEngine con su FK_DEPS y su ventana de «cabecera sincronizada, líneas
-- todavía no» en la que el inventario leería una transformación vacía.
-- Es el mismo criterio que `accounting_movements.items_factura`, que lleva
-- 2.440 líneas de factura viviendo así sin un solo problema.
--
-- ── LO QUE ESTA TABLA NO ES ──────────────────────────────────────
-- · NO es un movimiento de almacén. El inventario por empresa se arma de
--   facturas (qué compró y qué vendió esta empresa); los consumos de obra
--   viven en `movimientos_materiales`, por obra. Esto se suma a lo primero.
-- · NO toca la contabilidad. No genera asiento ni comprobante: es el registro
--   de que una mercadería se convirtió en otra, para que el saldo del
--   inventario pueda explicarse. La factura del servicio de corte ya está
--   cargada por su lado, y acá solo se la REFERENCIA (`movimiento_id` dentro
--   de `costos`) para poder ir hasta ella.
-- · NO es el formato 7.1. Transformar no activa nada: si de la plancha sale
--   un bien de uso duradero, eso se carga como activo fijo por su camino, y
--   el aviso de la tanda 6 (activar descuenta el costo de obra) sigue siendo
--   el que manda.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS transformaciones (
  id uuid PRIMARY KEY,

  -- La empresa del grupo que transformó. NOT NULL: el inventario es POR
  -- empresa, y una transformación sin dueño no se podría restar de ningún
  -- saldo.
  company_id uuid NOT NULL REFERENCES companies(id),

  fecha date NOT NULL,
  -- «Corte de planchas a láminas de 30×30». Lo que pasó, en una línea.
  descripcion text,

  -- UNA sola moneda por transformación, declarada. Regla 11 del CLAUDE.md: no
  -- se suman monedas distintas para «poder totalizar». Si las entradas se
  -- compraron en dólares y el corte se pagó en soles, son dos transformaciones
  -- o el valor lo escribe una persona: convertir a escondidas es cómo se
  -- fabrican los números que nadie puede rehacer.
  moneda text NOT NULL DEFAULT 'PEN',

  -- ── LOS TRES LADOS ──────────────────────────────────────────────
  -- entradas: [{ nombre, nombre_norm, cantidad, unidad, valor }]
  --   `nombre_norm` es la misma normalización del inventario (normInsumo), y
  --   es la llave por la que el saldo encuentra al insumo. Se guarda junto al
  --   nombre crudo para que la fila siga leyéndose si mañana cambia la norma.
  -- costos:   [{ concepto, monto, movimiento_id }]
  --   el servicio de corte, la mano de obra, el flete de ida y vuelta al
  --   taller. `movimiento_id` apunta a la factura que ya está cargada.
  -- salidas:  [{ nombre, nombre_norm, cantidad, unidad, valor }]
  entradas jsonb NOT NULL DEFAULT '[]'::jsonb,
  costos   jsonb NOT NULL DEFAULT '[]'::jsonb,
  salidas  jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Los tres totales, materializados: el inventario los suma por empresa sin
  -- tener que abrir el jsonb de cada fila.
  valor_entradas numeric NOT NULL DEFAULT 0,
  valor_costos   numeric NOT NULL DEFAULT 0,
  valor_salidas  numeric NOT NULL DEFAULT 0,

  -- Cómo se repartió el valor entre las salidas: 'cantidad' (proporcional),
  -- 'manual' (lo escribió una persona) o 'mercado' (proporcional al valor de
  -- venta estimado). Se guarda para poder auditar el número, no para
  -- recalcularlo: los valores ya están en `salidas`.
  reparto text NOT NULL DEFAULT 'cantidad' CHECK (reparto IN ('cantidad','manual','mercado')),

  -- Informativo: para qué obra se hizo. La transformación es de la EMPRESA
  -- (igual que el activo fijo de la mig 180), así que esto no la imputa a
  -- ningún costo — es trazabilidad, que es justo lo que el modelo B dice que
  -- significa vincular una compra a una obra.
  obra_id uuid REFERENCES obras(id),

  -- 'anulada' es una transformación que no pasó: deja de afectar el saldo pero
  -- se sigue viendo. Soft delete de verdad (`deleted_at`) queda para el error
  -- de tipeo del mismo día.
  estado text NOT NULL DEFAULT 'registrada' CHECK (estado IN ('registrada','anulada')),
  notas text,

  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  last_synced_at timestamptz,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,

  -- Una transformación sin entradas o sin salidas no es media transformación:
  -- es una fila que le restaría (o le sumaría) cantidades al inventario sin
  -- contrapartida. La lib no las deja construir; esto lo hace imposible.
  CONSTRAINT transformaciones_dos_lados CHECK (
    jsonb_typeof(entradas) = 'array' AND jsonb_typeof(salidas) = 'array'
    AND jsonb_array_length(entradas) > 0 AND jsonb_array_length(salidas) > 0
  ),

  -- LA INVARIANTE. Ver la nota de arriba sobre la regla 9: la lib cierra en 0
  -- exacto y esta tolerancia es solo el colchón del redondeo.
  CONSTRAINT transformaciones_valor_conservado CHECK (
    abs(coalesce(valor_salidas,0) - (coalesce(valor_entradas,0) + coalesce(valor_costos,0))) <= 0.05
  )
);

COMMENT ON TABLE transformaciones IS
  'Lo que entra de una forma y sale de otra: n insumos se consumen y salen m insumos nuevos, conservando el valor (mas los costos de conversion ya facturados). Tanda 7. No es un movimiento de almacen ni un asiento contable.';
COMMENT ON COLUMN transformaciones.costos IS
  'Lo que costo transformar y ya esta facturado aparte (el CORTE GUILLOTINA de GASOMI, el SERVICIO DE CORTE). Sin esto las salidas valdrian menos de lo que costaron y el margen de su venta saldria inflado.';
COMMENT ON COLUMN transformaciones.estado IS
  'anulada = no paso; deja de afectar el saldo pero se sigue viendo. El soft delete (deleted_at) es para el error de tipeo del mismo dia.';

-- La pantalla pregunta siempre lo mismo: «las transformaciones de esta empresa,
-- de la más nueva a la más vieja».
CREATE INDEX IF NOT EXISTS idx_transformaciones_empresa
  ON transformaciones (company_id, fecha DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transformaciones_obra
  ON transformaciones (obra_id) WHERE deleted_at IS NULL AND obra_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_transformaciones_updated_at ON transformaciones;
CREATE TRIGGER trg_transformaciones_updated_at BEFORE UPDATE ON transformaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────
-- ESPEJO EXACTO de `activos_fijos` (mig 180), y por el mismo motivo: esto es
-- inventario y valor de la EMPRESA, no de una obra, así que no lleva el cerco
-- de obra de la mig 177 —`obra_id` es informativo— pero sí el cerco de MÓDULO
-- de la mig 178: los roles de campo y de especialidad no tienen nada que hacer
-- decidiendo cuánto vale una lámina.
ALTER TABLE transformaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transformaciones: ve" ON transformaciones;
DROP POLICY IF EXISTS "transformaciones: crea" ON transformaciones;
DROP POLICY IF EXISTS "transformaciones: actualiza" ON transformaciones;
DROP POLICY IF EXISTS "transformaciones: elimina" ON transformaciones;

CREATE POLICY "transformaciones: ve"        ON transformaciones FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "transformaciones: crea"      ON transformaciones FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "transformaciones: actualiza" ON transformaciones FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "transformaciones: elimina"   ON transformaciones FOR DELETE USING (is_admin());

-- Mismo nombre de policy que la mig 178 para que un revert masivo de aquélla
-- también limpie ésta.
DROP POLICY IF EXISTS modulo_cerco_select ON transformaciones;
CREATE POLICY modulo_cerco_select ON transformaciones
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (COALESCE((SELECT public.current_user_rol()) <> ALL
    (ARRAY['ing_ambiental','ing_calidad','ing_social','ingeniero','prevencionista','campo']::text[]), true));

NOTIFY pgrst, 'reload schema';

-- ── COMPROBACIÓN (las dos tienen que devolver 0 filas) ────────────
-- select id from transformaciones
--  where abs(valor_salidas - (valor_entradas + valor_costos)) > 0.05;
-- select id from transformaciones
--  where jsonb_array_length(entradas) = 0 or jsonb_array_length(salidas) = 0;
