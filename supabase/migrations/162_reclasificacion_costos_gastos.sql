-- ════════════════════════════════════════════════════════════════════════
-- 162 · RECLASIFICACIÓN COSTO vs GASTO + desglose real de IGV en los espejos
--       (pedido de las contadoras, 31-ago-2026; autorizado por Gabriel)
--
-- ⚠ TOCA DINERO HISTÓRICO. Cambia el Estado de Resultados, el Dashboard
--   Contable y el Libro Diario de meses ya cerrados. NO cambia ningún total:
--   mueve plata de la línea "Costos" a la línea "Gastos".
--
-- ── PARTE 1 · 276 filas de Gastos Generales: 'cost' → 'expense' ─────────
--
-- El tipo contable (income|cost|expense) se elegía a mano en un select y nadie
-- elegía 'expense': Captura Mágica forzaba 'cost' y el formulario manual lo
-- dejaba en 'cost'. Resultado: 0 filas 'expense' en producción y S/264,290.76
-- de gastos generales escondidos dentro de "Costos".
--
-- Desde este deploy el tipo se DERIVA de la vinculación
-- (src/lib/clasificacion-contable.js): obra → cost · gastos_generales →
-- expense. Esta migración alinea el dato viejo con esa regla.
--
-- ⚠ REGLA DURA: los intercompany quedan FUERA (siguen 'cost'). El Consolidado
--   elimina las operaciones internas sumando income+cost del lado
--   is_intercompany; una interna marcada 'expense' no se eliminaría y tampoco
--   entraría en los externos → se evaporaría de los dos lados.
--   Verificado antes de correr: 0 filas de gastos_generales son intercompany.
--
-- Alcance verificado en producción (31-ago-2026):
--   276 filas · S/264,290.76 · todas PEN · ninguna anulada · 03-ene→27-ago
--   0 de las 276 tiene cuenta_pcge propia → su asiento pasa de la cuenta 60
--   (Compras) a la 65 (Otros gastos de gestión). Si las contadoras quieren
--   otra cuenta, se fija por movimiento en el campo "Cuenta PCGE".
--
-- BEFORE / AFTER por empresa (PEN, sin anuladas):
--   GASOMI INGENIEROS         costos 733,906.84 → 656,239.81 · gastos 0 →  77,667.03 (180 filas)
--   SALAZAR CERQUIN RUTH      costos 126,193.12 →  13,571.39 · gastos 0 → 112,621.73 ( 87 filas)
--   CONSORCIO EL INCA         costos 229,319.39 → 228,826.39 · gastos 0 →     493.00 (  6 filas)
--   JHEENSEG INGENIEROS       costos 1,119,204.75 → 1,045,895.75 · gastos 0 → 73,309.00 ( 2 filas)
--   JADE CONSULTORIA          costos 216,798.25 → 216,598.25 · gastos 0 →     200.00 (  1 fila)
--   Utilidad y margen de cada empresa: SIN CAMBIO (costos + gastos es igual).
-- ════════════════════════════════════════════════════════════════════════

UPDATE public.accounting_movements
SET type = 'expense'
WHERE deleted_at IS NULL
  AND destino_contable = 'gastos_generales'
  AND COALESCE(clase, 'compra') = 'compra'
  AND is_intercompany IS NOT TRUE
  AND type = 'cost';
-- updated_at y version los sella el trigger trg_acc_mov_updated_at → los
-- dispositivos se enteran en su próximo pull incremental.

-- ── PARTE 2 · el espejo intercompany hereda el desglose real del comprobante ──
--
-- Cuando se confirma una VENTA interna, Captura Mágica crea sola la COMPRA
-- espejo en la empresa compradora, pero nacía SIN el { subtotal, igv } que sí
-- guarda la venta. Con el fix del IGV real (src/lib/igv-desglose.js) eso deja
-- una contradicción visible: la MISMA factura se asentaría con el IGV del
-- comprobante en la vendedora y con un 18 % estimado en la compradora.
--
-- Alcance: 80 espejos, todos con puntero intercompany_mirror_of vivo, mismo
-- monto que su original y original con desglose. Solo se toca el JSON de
-- `notas` (no cambia ningún monto). Idempotente: exige que el espejo AÚN no
-- tenga 'subtotal'.
UPDATE public.accounting_movements e
SET notas = (e.notas::jsonb || jsonb_build_object(
      'subtotal', o.notas::jsonb -> 'subtotal',
      'igv',      o.notas::jsonb -> 'igv',
      'desglose_heredado_de', o.id
    ))::text
FROM public.accounting_movements o
WHERE e.deleted_at IS NULL
  AND left(btrim(e.notas), 1) = '{'
  AND jsonb_exists(e.notas::jsonb, 'intercompany_mirror_of')
  AND NOT jsonb_exists(e.notas::jsonb, 'subtotal')
  AND (e.notas::jsonb ->> 'intercompany_mirror_of')
      ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND o.id = (e.notas::jsonb ->> 'intercompany_mirror_of')::uuid
  AND o.deleted_at IS NULL
  AND left(btrim(o.notas), 1) = '{'
  AND jsonb_exists(o.notas::jsonb, 'subtotal')
  AND jsonb_exists(o.notas::jsonb, 'igv')
  -- Solo si es literalmente el mismo comprobante (mismo importe): si alguien
  -- editó el monto de un lado, no se le encaja un desglose que no le cuadra.
  AND round(abs(o.amount), 2) = round(abs(e.amount), 2);

NOTIFY pgrst, 'reload schema';
