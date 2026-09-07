-- ═══════════════════════════════════════════════════════════════════
-- 186 — A QUIÉN SE LE EMITIÓ, Y EL BUZÓN DE LA QUE RECIBE. Tanda 8.
--
-- EL PEDIDO (Gabriel, 6-set-2026):
--   «en el caso de que la orden de compra y servicio se le está haciendo a una
--    empresa de nuestro grupo que ya está introducida en el programa, tenemos
--    que tener una sección de órdenes de compra y servicio donde diga ORDEN
--    RECIBIDA, y podamos ver las órdenes recibidas para cada una de nuestras
--    empresas, como si fuera su propio buzón».
--
-- ── EL HUECO: LA ORDEN NO SABÍA A QUIÉN SE LA EMITIÓ ──────────────
-- Desde la mig 179 el destinatario se guarda como SNAPSHOT de texto —
-- `proveedor_nombre` / `proveedor_ruc` / `proveedor_direccion`— y eso está
-- bien para un tercero: es lo que dice el papel el día que se firmó, y tiene
-- que quedar congelado aunque el proveedor después cambie de razón social.
--
-- Pero cuando el destinatario es UNA DE NUESTRAS OCHO EMPRESAS, el snapshot no
-- alcanza: un buzón que se arme comparando `proveedor_nombre` contra
-- `companies.name` falla con «GASOMI» vs «GASOMI E.I.R.L.» vs «Gasomi EIRL», y
-- una orden que no le llega a su destinataria es peor que no tener buzón. Por
-- RUC funcionaría casi siempre, pero «casi» acá significa que una empresa no
-- ve una orden que le emitieron — y no tiene forma de enterarse de que existe.
--
-- `proveedor_company_id` es el vínculo duro. NULLABLE y aditiva: una orden a un
-- tercero la deja en NULL y se comporta igual que antes. El snapshot de texto
-- NO se toca ni se deriva de acá: siguen siendo dos cosas distintas —lo que
-- dice el papel y a quién apunta el sistema.
--
-- ── LO QUE LA DESTINATARIA HACE CON ELLA ──────────────────────────
-- Gabriel: «tengamos la opción de revisar, cruzar con nuestro inventario […]
-- tal vez no con el mismo nombre, pero podemos enlazarlos […] y facilitarles la
-- opción de generar la factura».
--
-- Eso es un ESTADO DE LA RECEPTORA, y no puede vivir en `estado`: `estado` es
-- del emisor (borrador → firmada → recibida) y las dos partes lo escribirían
-- pisándose. `respuesta_estado` es el carril de la que recibe:
--
--    pendiente  — llegó y nadie la miró (lo que ve al abrir el buzón)
--    en_revision— la contadora la está cruzando contra su inventario
--    aceptada   — dice que puede atenderla
--    facturada  — ya emitió el comprobante (queda el id en `respuesta_movimiento_id`)
--    rechazada  — no la puede atender; `respuesta_nota` dice por qué
--
-- NULL = «todavía nadie del otro lado la tocó», que no es lo mismo que
-- 'pendiente' escrito a mano. Por eso no hay DEFAULT: la app lee NULL como
-- pendiente y así las 0 órdenes que ya existen no aparecen como si alguien las
-- hubiera clasificado.
--
-- `respuesta_movimiento_id` SIN foreign key, igual que el resto de las
-- referencias que la app crea offline (ver el comentario de la mig 185): la
-- factura y la marca se escriben en la misma pasada y una FK dura convertiría
-- un orden de llegada distinto en un 23503 que el SyncEngine manda a
-- conflictos manuales.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS proveedor_company_id uuid REFERENCES companies(id),
  ADD COLUMN IF NOT EXISTS respuesta_estado text,
  ADD COLUMN IF NOT EXISTS respuesta_nota text,
  ADD COLUMN IF NOT EXISTS respuesta_movimiento_id uuid,
  ADD COLUMN IF NOT EXISTS respuesta_at timestamptz,
  ADD COLUMN IF NOT EXISTS respuesta_por uuid;

ALTER TABLE ordenes_compra DROP CONSTRAINT IF EXISTS ordenes_compra_respuesta_estado_check;
ALTER TABLE ordenes_compra ADD CONSTRAINT ordenes_compra_respuesta_estado_check
  CHECK (respuesta_estado IS NULL OR respuesta_estado = ANY
    (ARRAY['pendiente','en_revision','aceptada','facturada','rechazada']));

COMMENT ON COLUMN ordenes_compra.proveedor_company_id IS
  'La empresa DEL GRUPO a la que se le emitió esta orden. NULL si el destinatario es un tercero. Es lo que hace que la orden aparezca en el buzón de esa empresa: el snapshot de texto no alcanza porque el mismo RUC se escribe de tres formas.';
COMMENT ON COLUMN ordenes_compra.respuesta_estado IS
  'Carril de la empresa que RECIBE la orden (pendiente/en_revision/aceptada/facturada/rechazada). Separado de `estado`, que es del emisor. NULL = nadie del otro lado la tocó.';
COMMENT ON COLUMN ordenes_compra.respuesta_movimiento_id IS
  'El accounting_movements de la factura que la receptora emitió contra esta orden. Sin FK a propósito: se escribe junto con la factura, offline.';

-- El índice del buzón: «las órdenes que me llegaron a MÍ». Sin él, abrir el
-- buzón es un full scan de ordenes_compra por cada empresa.
CREATE INDEX IF NOT EXISTS idx_oc_destinatario
  ON ordenes_compra (proveedor_company_id) WHERE deleted_at IS NULL;

-- Una orden, una factura de respuesta. Si dos pestañas de la contadora
-- facturan la misma orden, la segunda choca acá en vez de duplicar el ingreso
-- — el mismo cerco que uq_oc_por_movimiento puso del lado de la compra.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oc_respuesta_movimiento
  ON ordenes_compra (respuesta_movimiento_id)
  WHERE respuesta_movimiento_id IS NOT NULL AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
