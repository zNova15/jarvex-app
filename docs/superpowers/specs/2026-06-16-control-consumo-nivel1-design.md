# Control de Consumo — Nivel 1 (Insumos directos + alerta de sobreconsumo)

**Fecha:** 2026-06-16
**Estado:** Diseño aprobado (pendiente de plan de implementación)
**Alcance:** Nivel 1 de una estrategia de 3 niveles de control real-vs-presupuesto.

## Problema

JARVEX ya tiene el esqueleto para imputar salidas de material a partidas
(`Vinculación de Salidas` → `aplicarConsumoPartida` acumula `cantidad_real_usada`
en `insumos_partida` y `costo_real_acumulado` en `partidas`). Pero NO hay una
vista que **compare el consumo real contra el presupuesto del expediente y avise
de sobreconsumo**. El caso testigo: rollos de alambre que se gastan más rápido de
lo que corresponde al avance físico, sin que nadie lo note a tiempo.

El control de consumo completo es en realidad tres problemas según qué tan
atribuible es el insumo a una partida:

- **Nivel 1 (este spec)** — insumos DIRECTOS atribuibles a una partida
  (cemento, fierro, alambre, tubería).
- **Nivel 2 (futuro)** — insumos COMPARTIDOS/indirectos (combustible,
  herramientas, EPP): prorrateo por driver o bolsa de gastos generales.
- **Nivel 3 (futuro)** — MANO DE OBRA: rendimiento real (jornales/HH) vs
  presupuestado por avance.

Este spec cubre SOLO el Nivel 1.

## Objetivo

Una vista nueva **"Control de Consumo"** (menú Ingeniería / Gestión de Obra,
visible para ingeniero y gerente) que, por cada partida y por cada insumo de la
partida, muestre presupuesto vs real y dispare una **alerta de sobreconsumo**
con un baseline HÍBRIDO (vs presupuesto total + vs avance físico).

## Decisiones de diseño tomadas

1. **Empezar por Nivel 1** (insumos directos): reusa lo existente, da la alerta
   más útil, y es base de los otros niveles.
2. **Baseline HÍBRIDO**: comparar el consumo real contra DOS referencias y
   alertar con la más exigente:
   - vs **presupuesto total** del insumo (siempre disponible).
   - vs **avance físico** de la partida (cuando el ingeniero lo reportó).
3. **Ubicación**: vista NUEVA "Control de Consumo" (sección propia en el menú),
   no una pestaña embebida.

## Datos (sin tablas nuevas — vista de lectura + cálculo)

Toda la data ya existe:

| Dato | Fuente |
|---|---|
| Presupuestado (cantidad) | `insumos_partida.cantidad` (× `precio_unitario` / `precio_presupuestado`) |
| Real consumido (cantidad) | `insumos_partida.cantidad_real_usada` |
| Costo real de la partida | `partidas.costo_real_acumulado` |
| Costo presupuestado de la partida | `partidas.costo_total_presupuestado` |
| % Avance físico de la partida | `avance_obra.porcentaje_avance` (último/acumulado por partida) |

Derivados (calculados en el cliente, NO persistidos):

- `pctConsumo = cantidad_real_usada / cantidad` (por insumo); a nivel partida,
  `costo_real_acumulado / costo_total_presupuestado`.
- `pctAvance` = `porcentaje_avance` de la fila de `avance_obra` MÁS RECIENTE (por
  `fecha`, desempate por `created_at`) de la partida. Si no hay ninguna fila de
  avance para la partida → el componente "vs avance" se omite (solo vs presupuesto).
- `esperadoPorAvance = presupuesto × pctAvance`.
- `indiceSobreconsumo = real / esperadoPorAvance` (solo si hay avance y
  esperado > 0).

## Lógica del semáforo (el más exigente de los dos)

Por insumo (y agregado por partida):

- 🟢 **En línea**: `pctConsumo ≤ 0.85` Y (`indiceSobreconsumo ≤ 1.10` o sin avance).
- 🟡 **Atención**: `0.85 < pctConsumo ≤ 1.00` O `1.10 < indiceSobreconsumo ≤ 1.25`.
- 🔴 **Sobreconsumo**: `pctConsumo > 1.00` O (`indiceSobreconsumo > 1.25` con avance reportado).

Umbrales (0.85 / 1.10 / 1.25) como constantes nombradas, fáciles de ajustar.

Caso alambre: presupuesto consumido 80% (🟡 por consumo) pero partida al 50% de
avance → `indice = 0.80/0.50 = 1.6 > 1.25` → 🔴. Se detecta.

## Componentes (unidades con una responsabilidad clara)

- **`src/lib/control-consumo.js`** (puro, testeable): dada la lista de partidas,
  insumos_partida y los % de avance, calcula por partida e insumo los derivados +
  el estado del semáforo. Una función `calcularControlConsumo({ partidas,
  insumosPartida, avancePorPartida })` → estructura lista para render. Sin Dexie,
  sin React → unit-testeable.
- **`src/components/jx-control-consumo.jsx`** (vista): carga de Dexie
  (`partidas`, `insumos_partida`, `avance_obra` de la obra activa), llama al
  helper, y renderiza la tabla por partida (semáforo + barra real/presupuesto +
  índice vs avance), expandible a insumos, ordenable "peor primero". Reactiva a
  `jx_data_changed` (movimientos_materiales/insumos_partida/avance_obra).
- **Registro de página**: `main.jsx` PAGE_CHUNKS + `jx-app.jsx` PAGE_REGISTRY +
  `jx-sidebar.jsx` NAV + `jx-admin.jsx` __moduleIdMap (gating por rol:
  ingeniero/ingeniero_residente/gerente/admin).
- **Alertas**: el ENTREGABLE central es la propia vista (lista ordenable
  peor-primero, donde los 🔴 quedan arriba). Publicar además los 🔴 al Centro de
  Alertas es un paso SECUNDARIO dentro del Nivel 1; el plan de implementación
  define el mecanismo exacto reusando el patrón de alertas ya existente. Si
  complica, se deja para un segundo PR sin bloquear la vista.

## Cómo se determina el % de avance por partida

`avance_obra` tiene filas por partida con `porcentaje_avance` / `metrado_ejecutado`
/ `metrado_total`. El % de avance vigente de una partida = el `porcentaje_avance`
de su fila de avance MÁS RECIENTE (por `fecha`). Si una partida no tiene filas de
avance → se trata como "sin avance reportado" y solo se evalúa vs presupuesto.

## Manejo de errores / bordes

- Insumo con `cantidad` (presupuesto) 0 o nulo → no se calcula pctConsumo (se
  muestra "sin presupuesto"); no alerta por consumo (evita división por 0).
- Partida sin avance reportado → solo baseline vs presupuesto.
- `cantidad_real_usada` nula → 0.
- El match insumo presupuestado ↔ consumo real ya lo hace `aplicarConsumoPartida`
  por nombre dentro de la partida; esta vista LEE `cantidad_real_usada` ya
  acumulada (no re-matchea).

## Testing

- Unit tests del helper `control-consumo.js`: casos verde/ámbar/rojo, sin avance,
  presupuesto 0, índice exacto (caso alambre 0.80/0.50 → 🔴), agregación por
  partida.
- Build + smoke de la vista.

## Fuera de alcance (explícito)

- Nivel 2 (combustible/indirectos) y Nivel 3 (mano de obra) — etapas futuras.
- Cambiar cómo se imputan las salidas (Vinculación de Salidas se mantiene igual).
- Persistir derivados o crear tablas nuevas.
- Re-cálculo histórico / valorizaciones (esta vista es de control operativo).

## Criterio de éxito

El ingeniero/gerente abre "Control de Consumo", ve las partidas ordenadas peor-
primero con su semáforo, identifica de un vistazo qué insumos van en sobreconsumo
(vs presupuesto y/o vs avance), y recibe el 🔴 del alambre en el Centro de Alertas
antes de que el insumo se agote sin avance que lo justifique.
