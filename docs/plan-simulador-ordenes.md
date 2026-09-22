# Simulador de órdenes por presupuesto de obra

> Diseño acordado con Gabriel el 22-set-2026. Este documento es el INPUT de
> las tandas de implementación (tabla al final) — cada tanda se abre en una
> **sesión nueva** y arranca leyendo esto, no el historial del chat de diseño.

---

## 1. El problema que resuelve

Un trabajo (obra/supervisión) trae un expediente técnico con un presupuesto:
insumos (materiales, mano de obra, equipo) repartidos en partidas, cada una
con su propio tramo del cronograma. Hoy JARVEX sabe decir **cuánto falta** de
cada insumo en total (`src/lib/abastecimiento.js`), pero no dice **cuándo**
conviene emitir cada orden de compra o de servicio para cubrir ese faltante
sin comprar antes de tiempo ni quedarse corto.

El simulador arma, mes a mes o semana a semana, **propuestas de órdenes
agrupadas** (ej. "EPPs — primera dotación", "Alquiler de maquinaria —
octubre") a partir del presupuesto del trabajo, editables antes de convertirse
en una orden real. Es un **simulador de escenarios**, no un plan único: cada
corrida se guarda con sus parámetros, se acepta o rechaza por tramo, y se
puede volver a pedir solo para lo que falta.

**No es una herramienta de empresa — es de trabajo.** Vive en el desglose de
un trabajo (grupo "Logística" de `src/lib/desglose-obra.js`, junto a
`solicitud-residente / requisiciones / ordenes-compra`), no en el menú
general.

## 2. Caso de referencia: obra de Miraflores

Medido en producción el 22-set-2026 (`obra_id = 984bacda-97ae-4744-bf5f-a8ab03f48d8d`):

| Dato | Valor |
|---|---|
| Partidas | 1.718 — las 1.718 ya tienen fecha de inicio/fin planificada |
| Insumos del presupuesto | 6.722 líneas, S/ 9.590.291 |
| Plazo | 30-abr-2026 → 30-dic-2026 |
| Órdenes emitidas hoy | 14, **todas retroactivas** (respaldan facturas ya pagadas) |
| Ejecutora | CONSORCIO EL INCA (`ejecutora_tipo='consorcio'`) — única empresa que emite hoy |

Por tipo de insumo:

| Tipo | Monto | ¿Entra al simulador? |
|---|---|---|
| Mano de obra | S/ 4.474.595 (47%) | Sí, pero como referencia de dotación — ver §5 |
| Material | S/ 4.039.903 | Sí, orden de compra |
| Equipo (mezcla herramienta/servicio) | S/ 1.075.793 | Sí, separado en dos por el clasificador — ver §4 |

**El universo comprable real (materiales+herramientas+servicios) es ~S/
4,98 M**, no los 9,59 M del presupuesto total — la mano de obra no se compra.
Esto importa para la barra de cobertura de la pantalla: no debe apuntar a
9,59 M o nunca va a llegar al 100%.

94% de los insumos (6.325/6.722) vive en partidas de menos de 30 días —el
cronograma los fecha con precisión de semana. Solo 92 insumos (S/ 552k) están
en partidas que abarcan casi toda la obra (EPPs, herramientas, alquileres
largos) — esos son los que necesitan una estrategia de reparto (§3.3), no
pueden leerse directo del Gantt.

## 3. Los tres parámetros de cada corrida (+ el filtro de categoría)

Cada simulación se define por 4 ejes independientes. Guardar una corrida con
sus 4 valores como **escenario nombrado** es lo que permite comparar "con
Gantt" vs "regularizando desde hoy" sin recalcular a mano, y volver a pedir
solo los meses que no gustaron sin perder los que sí.

### 3.1 — Fecha de anclaje
- **Desde hoy** (mes o semana actual) — caso "estamos regularizando": ya se
  compró material fuera de proceso y hay que ordenar lo que falta desde ahora.
- **Desde los meses que faltan**, ignorando lo ya cubierto.
- **Asumiendo cero órdenes previas** — reconstruye qué debió comprarse desde
  el inicio del expediente. Sirve para auditar, no para emitir.

### 3.2 — Fuente del cronograma
- **Gantt del expediente** (`partidas.fecha_inicio_planificada` /
  `fecha_fin_planificada`, ya cargado para el 100% de las partidas).
- **Reprogramado manual** — Gabriel mueve cuándo arranca cada partida, porque
  en campo se avanza por conveniencia/estrategia, no por el Gantt firmado.
- **Sin cronograma** — reparto por reglas (parejo, etc.), para insumos sin
  fecha propia o cuando no se confía en el Gantt de esa obra.

### 3.3 — Estrategia de reparto (para insumos "de tramo largo": EPPs, alquileres)
- Todo al inicio del tramo.
- Por cuadrilla que entra (necesita cargar cuántas personas ingresan y
  cuándo — dato que hoy no existe en ningún lado; la pantalla lo pide).
- Parejo mes a mes.
- Manual — Gabriel lo fija partida por partida.

### 3.4 — Filtro de categoría (multi-select: uno, varios o todos)
- Materiales
- Herramientas
- Servicios (alquileres, fletes, etc.)
- Mano de obra (ver §5 — sale como referencia aparte, no como orden)

## 4. Regla: clasificar `equipo` en herramienta vs servicio

El esquema (`insumos_partida.tipo_insumo`) solo distingue `material` /
`equipo` / `mano_obra`. Adentro de `equipo` conviven cosas que NO son la
misma orden: compresora neumática (alquiler, unidad `hm`, S/ 366.759) y
zapatos punta de acero (compra, unidad `par`, S/ 13.210).

El motor pasa cada fila de `equipo` por `src/lib/insumo-clasificador.js`
(regex ya existente que distingue alquiler/servicio por texto y por unidad
`hm`/`%mo`) para separarla en **herramienta-comprable** o
**servicio-de-alquiler** antes de ofrecerla al filtro de categoría (§3.4).

### 4.1 — Partidas-sobre ("HERRAMIENTAS MANUALES" y similares)

Corrección sobre un error de análisis previo: **"HERRAMIENTAS MANUALES"
(`%mo`, 1.115 filas, S/ 132.493) SÍ es comprable** — es una partida-sobre: el
expediente reserva un monto sin especificar qué herramienta, igual que
"servicios" en la taxonomía de dos árboles del catálogo (el cajón "no sé
cuál"). El mismo patrón aplica a los `glb` sueltos (movilización, tijeral
metálico).

**Tratamiento:** el simulador arma órdenes de **descripción libre** contra el
monto del sobre como techo (ej. "3 comba, 5 pico, 10 pala" contra los
S/ 132.493), mostrando cuánto del sobre ya se llevó gastado — igual que una
caja chica con presupuesto. No se lee como lista de insumos porque no la
tiene.

## 5. Mano de obra: simulación aparte, de doble sentido, SOLO REFERENCIA

Decisión de Gabriel (22-set-2026): **la simulación de mano de obra al
aceptarse NO genera ningún registro** — ni alta en `personal`, ni pedido a
RRHH, ni orden. Es puramente un número de referencia para comparar contra la
dotación real mes a mes. (Si esto cambia más adelante, es una tanda aparte —
no tocar el resto del diseño.)

Datos de Miraflores (`tipo_insumo='mano_obra'`, unidad `hh`):

| Cargo | HH presupuestadas | Monto |
|---|---|---|
| PEÓN | 142.892 | S/ 2.867.839 |
| OPERARIO | 37.419 | S/ 1.058.571 |
| OFICIAL | 15.747 | S/ 348.961 |
| Operador equipo liviano | 6.138 | S/ 173.657 |
| Topógrafo | 873 | S/ 25.566 |

El reparto por mes/semana usa el mismo motor que materiales (mismas HH por
partida, mismo cronograma). Lo que cambia es la conversión final, que es
**bidireccional**:

- **Cronograma → dotación necesaria**: HH de las partidas que arrancan ese
  mes ÷ horas por persona al mes (jornada configurable) = cuántos
  peones/oficiales/operarios hacen falta.
- **Dotación disponible → avance posible**: con el personal real ya cargado
  en `personal` (categoría `obrero` — ver `src/lib/personal-categoria.js`),
  cuántas HH cubre esa gente y qué partidas alcanza ese mes.

## 6. Proveedores: matching por rubro

`companies.rubro` ya existe en el esquema — no hace falta agregar nada. El
motor cruza la clasificación del insumo/servicio contra el `rubro` de las
empresas candidatas (propias del grupo y externas), y dentro de eso prioriza
por historial real de precios (`src/lib/analisis-insumos.js` +
`precio-historial.js`: quién vendió ese insumo antes y a cuánto). Evita el
caso "orden de librería a una ferretería".

El precio por defecto de cada línea es `precio_presupuestado` (ya está en
cada fila de `insumos_partida`), con el último precio real pagado al costado
como referencia — Gabriel puede editar descripción y precio libremente, pero
el punto de partida es el expediente, no el mercado, para poder comparar
contra el presupuesto.

## 7. El puente a orden real — reusar lo que ya existe

**No crear una tabla nueva de "modelos de orden".** Ya existen
`requisiciones` + `requisicion_items`, con `obra_id`, `partida_id`,
`fecha_necesidad`, `prioridad`, `estado`, y el puente ya construido en los dos
sentidos: `requisiciones.oc_id`/`oc_codigo` y
`oc_items.requisicion_item_id`. Hoy tienen 5 y 12 filas — están sin usar, no
mal diseñadas.

El simulador escribe sus propuestas como requisiciones (con un origen
marcado, ej. columna `origen='simulador'` si hace falta distinguirlas), y
convertirlas en orden real reusa el flujo de `src/lib/ordenes.js` que ya
existe. **Restricción dura (Gabriel, confirmada):** las órdenes solo las emite
la **entidad ejecutora del trabajo** (`obras.ejecutora_company_id` /
`ejecutora_tipo`) — en Miraflores, únicamente CONSORCIO EL INCA.

Invariante que hay que proteger en todas las tandas: **nada se pide dos
veces**. Cuando una línea del plan se convierte en OC real, los meses
siguientes tienen que restarla — y también restar las 14 órdenes ya emitidas
hoy fuera del plan, que hoy son el 100% de lo emitido. Mismo principio que el
"cero silencioso" de `abastecimiento.js`: si no se sabe cuánto hay, se separa
aparte, nunca se asume 0 ni se inventa un número.

## 8. Quién usa esto

Gabriel y la contadora en jefe, nadie más por ahora. No hace falta partir el
plan por frente/ingeniero en esta primera versión.

## 9. Fuera de alcance (a propósito)

- Modalidad "obra por impuestos" vs tradicional: no existe hoy como campo en
  `obras` (solo aparece como texto libre en extracción de bases de
  licitación). No bloquea nada — el simulador funciona igual sin ese dato,
  solo no avisa del riesgo de calce de caja (pago trimestral en OxI vs salida
  de órdenes). Sumarlo es la tanda 5, opcional, solo si Gabriel la pide.
- Cubrir el 100% del presupuesto total como meta: no aplica, el 47% es
  planilla y no se "cubre" con órdenes.

## 10. Plan de tandas

| Tanda | Qué hace | Alcance / archivos | Modelo | Effort | Sesión |
|---|---|---|---|---|---|
| 1 | Motor puro de reparto: insumos de materiales/herramientas/servicios por mes o semana según §3.1-§3.4, clasificación `equipo`→herramienta/servicio (§4), partidas-sobre (§4.1). Sin UI. Con tests. | `src/lib/simulador-ordenes.js` (nuevo) + ajustes en `insumo-clasificador.js` | Opus 5 | Alto | Nueva |
| 2 | Motor de mano de obra: conversión HH↔dotación en los dos sentidos (§5), cruce contra `personal` real. Genera SOLO referencia — sin escritura de altas/pedidos. | `src/lib/simulador-dotacion.js` (nuevo) | Opus 5 | Alto | Nueva |
| 3 | Pantalla del simulador: escenarios nombrados, filtro de categorías (§3.4), aceptar/rechazar por orden o tramo, edición de descripción/precio/proveedor, indicador de cobertura del presupuesto comprable (§2). | `jx-simulador-ordenes.jsx` (nuevo) + registro en sidebar/PAGE_REGISTRY/`desglose-obra.js` (grupo Logística) | Opus 5 | Alto | Nueva |
| 4 | Puente a documento real (§7): líneas aceptadas → `requisiciones`/`requisicion_items` → `ordenes_compra`, restringido a la entidad ejecutora. Matching proveedor↔rubro (§6) con historial de precios. | `src/lib/ordenes.js` (extender) + migración chica si hace falta marcar origen en requisiciones | Opus 5 | Alto | Nueva |
| 5 (opcional) | Columna de modalidad OxI/tradicional en `obras` + aviso de calce de caja. Solo si Gabriel la pide explícitamente. | Migración SQL + `jx-obra.jsx`/desglose | Sonnet 5 | Medio | Nueva |

**Por qué Opus 5 / alto en las tandas 1-4:** todas tocan plata (montos
presupuestados, evitar doble conteo de lo ya comprado, correlativos por
empresa) — el tipo de lógica donde un error no se nota hasta que ya duplicó
un gasto.

**Por qué sesión nueva en cada tanda:** arrastrar el historial largo de la
conversación de diseño no ayuda al modelo que va a escribir código. Cada
tanda entra con alcance acotado y el handoff es este documento, no el chat.

---

*Para retomar en una sesión nueva: leer este documento completo antes de
tocar código. El estado de avance de cada tanda (qué se hizo, qué falta) se
va anotando acá abajo a medida que se completan.*

## 11. Avance

- [x] **Tanda 1 — motor de reparto** (22-set-2026). `src/lib/simulador-ordenes.js`
      (nuevo, 52 tests en `__tests__/simulador-ordenes.test.js`) +
      `clasificarInsumoDePresupuesto()` en `insumo-clasificador.js`.
      Exporta `simularOrdenes({...})` → `{ propuestas, sobres, manoObra,
      pendientes, resumen }` y los helpers de período (`periodoDe`,
      `periodosEntre`, `semanaISO`, `etiquetaPeriodo`). Sin UI, sin Dexie.
- [ ] Tanda 2 — motor de dotación
- [ ] Tanda 3 — pantalla
- [ ] Tanda 4 — puente a orden real
- [ ] Tanda 5 — OxI / calce de caja (opcional)

### Lo que la tanda 1 corrigió del diseño (medido el 22-set-2026)

- **El tramo largo no es un caso de borde.** El §2 decía «92 insumos
  (S/ 552k)», y eso es cierto para las partidas que abarcan casi toda la obra
  (239 días). Pero con el umbral que usa el motor —**30 días**, el que deja
  6.325 de las 6.722 líneas del lado simple— el tramo largo son **397 líneas
  por S/ 5,6 M**, de las cuales **S/ 3,16 M son comprables**: la tubería PVC de
  una partida de 73 días son S/ 450.839 en UNA línea. La estrategia de reparto
  (§3.3) decide la mayor parte de la plata, no solo los EPPs — por eso el
  default del motor es `parejo` y no `inicio`.
- **Las 14 órdenes emitidas no se pueden descontar.** Sus 62 líneas tienen
  `insumo_codigo` NULL en el **100%** (son retroactivas: respaldan facturas ya
  pagadas). El motor NO asume cero: las cuenta en `resumen.ocSinImputar`
  (líneas y monto) para que la pantalla lo diga. Si algún día se les imputa
  código, el descuento empieza a funcionar solo.
- **Dos estrategias pueden no tener con qué contestar.** `cuadrilla` sin la
  dotación cargada y `manual` sin el reparto fijado devuelven la línea por
  `pendientes` con su motivo — nunca un `parejo` de consuelo. Mismo criterio
  que el cero silencioso de `abastecimiento.js`.
- **`consumido` de un sobre es `null` mientras nadie lo informe**, no el techo
  entero. Creer un sobre intacto cuando ya se gastó la mitad es el mismo doble
  gasto que el §7 viene a evitar. Lo va a llenar la tanda 4.
- **Ajustes al clasificador** (`insumo-clasificador.js`): `SERVICIO_RE` ahora
  reconoce `acarreo`, `movilización`/`desmovilización` y `arriendo`, y se le
  sacó el lookahead `alquiler(?!.*?(de|equipo|maquinari))` que hacía que
  «ALQUILER DE MAQUINARIA» NO fuera servicio — justo al revés de lo que dice
  el §4. Además `compresor` nunca matcheaba «COMPRESORA» (la `\b` la rompía
  la `a` final). Esto también mejora Captura Mágica: un alquiler ya no se
  ofrece para crear como activo de inventario.
