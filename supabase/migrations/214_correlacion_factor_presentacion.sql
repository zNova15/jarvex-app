-- ═══════════════════════════════════════════════════════════════════
-- 214 — EL FACTOR DE CONVERSIÓN ENTRE PRESENTACIONES (tanda 5, 15-set-2026).
--
-- ── EL PROBLEMA, MEDIDO ───────────────────────────────────────────
-- De los 160 pares de correlación ya decididos a mano, TRECE «mismo insumo»
-- se facturan en unidades incompatibles:
--   «ALAMBRE DE AMARRE 16» (und)  =  «ALAMBRE NEGRO 16» (kg)
--   «TUBO HDPE … 110 mm» (und)    =  «TUBO HDPE … 110 mm» (m)
--   «BOTAS DE SEGURIDAD…» (und)   =  «BOTAS DE SEGURIDAD…» (par)
--   «TARUGO PVC 3/8» (und)        =  «TARUGOS 3/8» (docena)
--
-- Gabriel, 15-set, probando la tanda 2: «encontré un caso sobre un par de
-- guantes en unidades y el otro en par, que resulta que sí son lo mismo».
-- Exacto: SON lo mismo, y unirlos es la decisión correcta. Lo que falta es
-- poder SUMARLOS. Hoy el inventario los deja en dos filas que nadie puede
-- restar («20 par» y «15 und») y el comparador de precios se apaga para ese
-- insumo, porque `proveedorMasBarato` devuelve null en cuanto ve dos unidades.
--
-- ── POR QUÉ NO HAY UN `relacion = 'presentacion'` ─────────────────
-- Era la idea original y se descartó a propósito. `relacion` tiene un CHECK
-- de dos valores y lo leen CUATRO pantallas (el comparador, el inventario por
-- empresa, Abastecimiento y la bandeja de clasificación), todas preguntando
-- «¿es 'mismo'?». Un valor nuevo obligaría a que las cuatro lo aprendieran el
-- mismo día, y la que se olvidara partiría el grupo EN SILENCIO — el insumo
-- volvería a contarse dos veces sin que nadie vea un error.
--
-- Una presentación distinta ES el mismo insumo: para clasificar, para mapear
-- al presupuesto y para comparar proveedores no cambia nada. Lo único que
-- cambia es que sus cantidades necesitan un factor. Así que `relacion` se
-- queda como está y el factor entra como columnas OPCIONALES: quien no las
-- mira se comporta exactamente como hoy.
--
-- ── EL MODELO: CADA LADO CON SU UNIDAD DE ORIGEN ──────────────────
-- No alcanza con «el factor del par»: hay nombres que aparecen facturados en
-- dos unidades distintas según el proveedor, y un factor suelto se aplicaría
-- a la línea equivocada. Por eso cada lado guarda DESDE QUÉ unidad convierte:
--
--   1 [unidad_a] de nombre_a  =  factor_a [unidad_base]
--   1 [unidad_b] de nombre_b  =  factor_b [unidad_base]
--
-- El lado que ya está en la unidad base lleva factor 1. Ejemplo real:
--   nombre_a = 'tarugos naranja 3 8'      unidad_a = 'docena'  factor_a = 12
--   nombre_b = 'tarugo plastico pvc 3 8'  unidad_b = 'und'     factor_b = 1
--   unidad_base = 'und'
-- Y una línea de `nombre_a` facturada en 'und' (no en 'docena') NO se
-- convierte: su unidad no es la que el factor declara.
--
-- Las unidades se guardan YA CANONIZADAS por `normUnidad()`
-- (inventario-empresa.js), que es la que unifica "und"/"unidad"/"each".
--
-- 🔴 EL CHECK Y LA REGLA 9 DEL CLAUDE.md. Dexie NO valida CHECKs: una fila
-- mal formada se guarda local y REBOTA en el push con 23514, dejando el sync
-- en reintento eterno. Por eso el CHECK es «todo o nada» y la app tiene un
-- solo camino para escribir estos campos: `camposDeFactor()` en
-- insumo-correlacion.js, que arma los cinco juntos o los cinco en NULL.
-- No escribir estas columnas a mano desde ningún otro lado.
-- ═══════════════════════════════════════════════════════════════════

alter table insumo_correlaciones
  add column if not exists unidad_base text,
  add column if not exists unidad_a    text,
  add column if not exists factor_a    numeric,
  add column if not exists unidad_b    text,
  add column if not exists factor_b    numeric;

comment on column insumo_correlaciones.unidad_base is
  'Unidad canónica a la que se convierten las cantidades del par (normUnidad). NULL = sin factor, se comporta como antes.';
comment on column insumo_correlaciones.unidad_a is
  'Unidad de factura DESDE la que convierte factor_a. Una línea de nombre_a en otra unidad no se convierte.';
comment on column insumo_correlaciones.factor_a is
  'Cuántas unidad_base hay en 1 unidad_a. El lado que ya está en la base lleva 1.';

-- Todo o nada: o están los cinco campos, o ninguno. Ver la nota de la regla 9
-- arriba — este CHECK es la última línea de defensa, no la primera.
alter table insumo_correlaciones
  drop constraint if exists insumo_correlaciones_factor_check;
alter table insumo_correlaciones
  add constraint insumo_correlaciones_factor_check check (
    (unidad_base is null and unidad_a is null and factor_a is null
       and unidad_b is null and factor_b is null)
    or (unidad_base is not null and unidad_a is not null and unidad_b is not null
       and factor_a is not null and factor_a > 0
       and factor_b is not null and factor_b > 0)
  );

-- Un factor solo tiene sentido sobre un par que ES el mismo insumo: sobre un
-- 'distinto' no habría nada que convertir. Se valida acá y no en la app por
-- el mismo motivo que el anterior: la app puede tener un bug, la base no.
alter table insumo_correlaciones
  drop constraint if exists insumo_correlaciones_factor_solo_mismo;
alter table insumo_correlaciones
  add constraint insumo_correlaciones_factor_solo_mismo check (
    unidad_base is null or relacion = 'mismo'
  );
