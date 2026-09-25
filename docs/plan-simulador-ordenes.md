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
| 3 ✅ | Pantalla del simulador: escenarios nombrados, filtro de categorías (§3.4), aceptar/rechazar por orden o tramo, edición de descripción/precio/proveedor, indicador de cobertura del presupuesto comprable (§2). | `jx-simulador-ordenes.jsx` + `simulador-escenarios.js` (nuevos) + registro en sidebar/PAGE_REGISTRY/`desglose-obra.js` (grupo Logística) | Opus 5 | Alto | Nueva |
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
- [x] **Tanda 2 — motor de dotación** (22-set-2026).
      `src/lib/simulador-dotacion.js` (nuevo, 44 tests en
      `__tests__/simulador-dotacion.test.js`) + `porPartida` aditivo en las
      líneas de `manoObra` de `simulador-ordenes.js`.
      Exporta `simularDotacion({ manoObra, personal, partidas, jornada,
      feriados, dotacionManual })` → `{ periodos, cargos, sinCargo, padron,
      resumen }`, más `planDeContratacion()`, `cargoCanonico()`,
      `clasificarPadron()`, `capacidadDePeriodo()` y `rangoDePeriodo()`.
      Sin UI, sin Dexie, sin escritura — §5 al pie de la letra.
- [x] **Tanda 3 — la pantalla** (22-set-2026).
      `src/components/jx-simulador-ordenes.jsx` (nueva) +
      `src/lib/simulador-escenarios.js` (nueva, 52 tests) +
      `src/lib/__tests__/simulador-ordenes-pantalla.test.jsx` (12 tests) +
      `clave` aditiva en las líneas de `propuestas` de `simulador-ordenes.js`.
      Registrada como `simulador-ordenes` en `main.jsx` (PAGE_CHUNKS),
      `jx-app.jsx` (título + PAGE_REGISTRY), `jx-sidebar.jsx` (LOGÍSTICA,
      plano obra), `jx-admin.jsx` (`__moduleIdMap` + `__canSeeSidebarItem`,
      heredando los roles de `abastecimiento`), `desglose-obra.js` (grupo
      Logística) y `ayuda-contenido.js`.
      Cuatro pestañas: órdenes propuestas · sobres · mano de obra
      (referencia) · sin planificar. **No escribe nada**: las decisiones
      viven en el localStorage del navegador.
- [x] **Tanda 4 — el puente al documento real** (22-set-2026).
      `src/lib/simulador-puente.js` (nueva, 53 tests) +
      `src/lib/simulador-proveedor.js` (nueva, 23 tests) +
      `requisiciones`/`requisicionItems` aditivos en `coberturaPrevia()` y
      `simularOrdenes()` (`resumen.reqSinImputar`) +
      **migración 226**, aplicada y verificada en producción el 22-set:
      `requisiciones.origen` / `origen_ref`,
      `requisicion_items.insumo_codigo` y el CHECK de `tipo_insumo` abierto
      a `'servicio'`.
      La pantalla gana el botón «Convertir en requisiciones», la pestaña
      **Ya pedido** (emitir la orden de a una) y la fila de proveedores
      sugeridos dentro de cada orden abierta.
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

### Lo que la tanda 2 corrigió del diseño (medido el 22-set-2026)

- **La brecha de dotación no es un ajuste fino: es de un orden de magnitud.**
  El padrón de Miraflores tiene **15 peones, 2 operarios y 1 oficial**. El
  Gantt pide 171,7 peones en octubre y **201,1 en noviembre**. La pantalla
  (tanda 3) no puede presentar esto como un semáforo verde/amarillo: el
  número cabecera es «faltan 186 peones en noviembre».
- **No existe un «208 h/mes».** La capacidad se cuenta por días laborables
  reales (8 h, lun-sáb, menos feriados). Noviembre pide MÁS gente que
  octubre con menos HH, porque tiene dos días útiles menos (25 vs 27). Un
  divisor fijo se habría comido esa diferencia entera.
- **29 de las 86 personas son de subcontrato y su cargo no dice el oficio**
  («Subcontrato MOSHCO», «Subcontrato JR»). Sumarlas a los peones daría 44
  peones que no existen. Salen por `padron.sinEncajar` con su motivo, junto
  con los cargos que no ejecutan HH (ingeniero, almacenero) y los inactivos.
- **`asistencia` tiene 0 filas.** No hay horas realmente trabajadas contra
  las cuales medir: la oferta sale del PADRÓN (cuánta gente hay), y
  `resumen.fuenteOferta = 'padron'` lo declara para que la pantalla no lo
  presente como ejecución real.
- **El 64% del padrón no tiene `fecha_ingreso`** (55 de 86). Filtrar por esa
  fecha dejaría la oferta casi en cero, así que quien no la tiene cuenta
  igual — está activa hoy — y `padron.sinFechaIngreso` lo informa.
- **Dos cargos del presupuesto no tienen a nadie en el padrón** (TOPOGRAFO,
  OPERADOR DE EQUIPO LIVIANO). Y «OPERADOR DE EQUIPO LIVIANO» no puede caer
  en `operario`: le sumaría 6.138 HH al cargo equivocado. El mismo
  `cargoCanonico()` normaliza los dos lados (nombre del insumo y cargo de la
  persona), así que no hay tabla de mapeo que se desincronice.
- **El sentido inverso necesita el detalle por partida.** «Qué partidas
  alcanza ese mes» no se puede contestar con el agregado por insumo: por eso
  la tanda 1 ahora devuelve `porPartida` en cada línea de `manoObra`. Si no
  viene, `alcanceDisponible` sale en `false` y no se arma ningún ranking
  inventado. Una partida solo está completa si **todos** sus cargos
  alcanzaron: una cuadrilla sin operario no levanta un muro aunque sobren
  peones.
- **Lo que no se reconoce nunca se reparte.** Una línea de `hh` de cargo
  desconocido sale por `sinCargo` con sus HH y su plata, no repartida entre
  los cargos conocidos: eso distorsionaría justo la brecha del peón, que es
  la que decide la contratación.

### Lo que la tanda 3 corrigió del diseño (medido el 22-set-2026)

- **La mano de obra necesita su PROPIA corrida, no una sola.** El §3.4 pone
  la mano de obra como una opción más del filtro de categorías, y el §5 dice
  que sale aparte — las dos cosas no se pueden a la vez con una llamada: con
  el filtro puesto en materiales/herramientas/servicios, el `manoObra` que
  devuelve `simularOrdenes()` viene **vacío**, porque el filtro corta la línea
  antes de clasificarla. La pantalla hace **dos corridas** con los mismos
  ejes: una para las órdenes y otra con `categorias:['mano_obra']` que
  alimenta a `simulador-dotacion.js`. Y la segunda solo se calcula al abrir
  esa pestaña.
- **El proveedor es de la ORDEN, no de la línea.** El §6 habla de cruzar el
  insumo contra el rubro, y eso invita a poner un selector por línea. Es
  inviable y además está mal: una orden se le emite a un proveedor. Se elige
  arriba, una vez, y se puede pisar una línea suelta al corregirla.
- **577 candidatos, y `proveedores` NO tiene columna `rubro`.** Medido: 549
  proveedores en el catálogo + 28 empresas del grupo. Las 28 traen rubro; los
  549 no —la columna no existe en esa tabla—. Ordenar el desplegable por
  rubro habría funcionado para 28 de 577 y se habría leído como una
  recomendación. **Pendiente real para la tanda 4:** el matching del §6 o
  necesita esa columna en `proveedores`, o tiene que salir del historial de
  precios (`precio-historial.js`), que es el único dato que hoy existe para
  los 549.
  Aparte, un `<select>` de 577 opciones por fila son ~96.000 nodos de DOM con
  una orden grande abierta: va un `<datalist>` único para toda la pantalla,
  que además se filtra escribiendo (que es como se busca entre 549).
- **El plan de Miraflores son ~30 tarjetas, no cientos.** 4.435 líneas
  comprables con fecha, repartidas en **9 meses**. La peor tarjeta
  —materiales de diciembre— son 763 líneas de presupuesto que se juntan en
  **167 insumos distintos**; el resto está entre 17 y 120. Por eso las
  órdenes se dibujan colapsadas y cada una muestra 40 líneas con «ver más»:
  abrir una y pintar 167 filas está bien, pintar las 900 de una vez no.
- **Una decisión tiene que sobrevivir a volver a correr el motor.** Es el
  punto entero del §3 —comparar «con Gantt» contra «regularizando desde hoy»—
  y se rompe solo si las decisiones se guardan contra el objeto que devolvió
  la corrida. Se guardan contra claves estables: `período|subcategoría` para
  la orden y el código de insumo (o nombre+unidad) para la línea. Por eso la
  tanda 1 ahora devuelve `clave` en cada línea: derivarla dos veces, en el
  motor y en la pantalla, se desincroniza el día que alguien toque
  `normUnidad` y una decisión aceptada se pierde sin aviso.
- **Los escenarios viven en el localStorage, y eso tiene un costo que hay que
  decir.** Un escenario es un borrador de una persona, no un hecho de la obra:
  no justifica una tabla sincronizada (y la lección del corte por egress del
  9-set está fresca). Pero entonces **no viaja entre computadoras** ni lo ve
  nadie más, y Gabriel trabaja en dos máquinas. Lo que convierte un plan en
  algo compartido es la tanda 4, cuando lo aceptado se escriba como
  requisición. Mientras tanto la pantalla lo dice y ofrece bajarse el plan
  aceptado en CSV.
- **`lineasAceptadas()` no entrega una línea sin precio.** Sale aparte, por
  `sinPrecio`, y la pantalla la reclama. Una requisición con un monto
  inventado no la vuelve a mirar nadie; una línea que falta, sí.

### Lo que la tanda 4 corrigió del diseño (medido el 22-set-2026)

- **El historial de precios sirve para el QUIÉN, no para el CUÁNTO.** El §6
  pide «priorizar por historial real de precios» y mostrar «el último precio
  real pagado al costado». Medido: `insumo_precios_historial` tiene **0
  filas**, `material_precios_historial` 17, e `insumo_mapeo` —la tabla que
  uniría descripción de factura con código del presupuesto— tiene **3**. Lo
  único que existe son 1.814 líneas de factura con ítems, todas con
  proveedor identificado, y para cruzarlas con el presupuesto hay que
  emparejar textos. De los 427 insumos comprables de Miraflores, **12 (2,8%)**
  coinciden exacto con alguna descripción de factura; con «2 palabras de 4
  letras o más en común» el alcance sube a **174 de 419 (42%)**, que ya sirve.
  Pero los pares que produce son:

  | Pedís | Te vendió | A |
  |---|---|---|
  | VALVULA COMPUERTA DE BRONCE DE 2" | VALVULA ESFERICA DE 4" BRONCE | S/ 338,98 |
  | TAPON HEMBRA PVC SP DE 1" | TAPON 2" HEMBRA | S/ 5,93 |
  | BALDE HERMÉTICO PARA AGUA 10L | ALQUILER DE CAMIONETA … AGUA POTABLE … | S/ 10.423,73 |

  El **proveedor** está bien en todos: quien vende válvulas vende válvulas.
  El **precio** es de otro diámetro, de otro producto o de una camioneta.
  Poner «último precio: S/ 10.423,73» al lado de un balde de S/ 25 no es un
  dato flojo — es un número que alguien copia. Así que `sugerirProveedores()`
  devuelve `precioSugerido: null` siempre, con la evidencia del par a la
  vista, y el precio sigue siendo el del expediente (que es lo que el propio
  §6 pide en su última frase). Hay un test que falla si alguien le agrega un
  campo de precio.

- **El rubro no se agrega como columna: se deduce de lo facturado.** La
  tanda 3 dejó como pendiente «o `proveedores` necesita la columna `rubro`, o
  sale del historial». Agregarla la habría dejado vacía en las 549 filas
  esperando que alguien la llene a mano. `perfilarProveedores()` deduce el
  rubro de lo que cada uno facturó de verdad (344 proveedores tienen al menos
  una línea; 119 tienen 5 o más) y lo declara con `fuenteRubro:'facturas'`
  para que nadie lo confunda con `companies.rubro`, que sí es una etiqueta
  declarada.

- **El CHECK de `requisicion_items.tipo_insumo` no admitía `'servicio'`**, y
  eso es el **23% de la plata comprable**: S/ 843.850 de alquileres por `hm`
  + S/ 304.365 de servicios cargados como `material` + S/ 5.000, sobre
  ~S/ 4,98 M. Dexie no valida CHECKs, así que sin el ALTER esas filas se
  guardaban local y rebotaban en el push con un 23514 — el sync en reintento
  eterno de la regla 9 de CLAUDE.md. Por eso la mig 226 va antes que
  cualquier escritura.

- **Escribir la requisición y emitir la orden son DOS pasos, no uno.** El §7
  los nombra juntos («líneas aceptadas → requisiciones → ordenes_compra») y
  eso invita a un botón. Pero el plan de Miraflores son ~30 tarjetas: un
  «convertir todo» emitiría 30 órdenes y quemaría 30 correlativos de la
  ejecutora de un click, y un correlativo gastado no se recupera aunque la
  orden se anule (encabezado de `ordenes.js`). La requisición se edita, se
  borra y se rehace; la orden no. El primer paso es en lote, el segundo es de
  a una, con el proveedor puesto a mano.

- **La orden del plan nace en `borrador`, no en `recibida`.** Las órdenes de
  `jx-ordenes` nacen `recibida` porque respaldan algo que YA pasó; ésta pide
  algo que todavía no llegó. Y sus totales van por `totalesDesdeItems` (valor
  de venta + IGV hacia arriba), no por `totalesDesdeTotal`, que es para el
  caso retroactivo.

- **La fecha de necesidad es la del período, no la de hoy.** Una requisición
  de diciembre creada en septiembre con `fecha_necesidad` de septiembre nace
  atrasada y aparece en rojo en todas las bandejas. Sale de
  `rangoDePeriodo()` —el día 1 del mes, el lunes de la semana—, que ya existía
  desde la tanda 2 y no se volvió a derivar acá.

- **El descuento de lo requisado vive en `coberturaPrevia()`, no en el
  puente.** Es la misma pregunta que el de las órdenes («qué parte de esta
  línea ya está reservada») con las mismas dos reglas: la muerta no reserva,
  y la que ya tiene `oc_id` no se cuenta dos veces porque ya la cuenta su
  orden. Tenerlas en dos archivos es cómo se desincronizan. Se agregó
  `resumen.reqSinImputar` como espejo de `ocSinImputar`: una requisición sin
  código de insumo (las que carga el residente a mano) no se descuenta a ojo,
  se cuenta aparte y la pantalla lo dice.

- **`partida_id` solo se anota si toda la requisición es de la misma
  partida.** La columna es una sola y «Materiales — diciembre» junta 167
  insumos de decenas de partidas; poner la de la primera línea es una media
  verdad que después alguien lee como la verdad entera.

- **`requisicion_items` y `oc_items` NO tienen `created_by`/`updated_by`.**
  Mandárselas hace que el push rechace la fila entera. El autor se marca solo
  en las cabeceras, y va `null` —no el literal `'offline'`— cuando no hay
  sesión, porque la columna es `uuid`.

---

## 12. Ronda 2 — primer uso real, qué corregir (24-set-2026)

Gabriel usó la pantalla contra Miraflores (§2) y encontró tres problemas de
fondo, más lo que salió de auditar el diccionario propio contra el motor.
**Este bloque (§12-§14) es el INPUT de la ronda 2 de tandas, igual que §1-§11
lo fueron de la ronda 1** — leer esto entero antes de tocar código.

### 12.1 — Lo que está mal, medido

1. **Las cantidades salen con decimales que nadie pide así**
   («CEMENTO PORTLAND: 3,37 bol»). Dos causas, no una:
   - El reparto `parejo` divide la cantidad del tramo entre sus períodos sin
     redondear — es correcto en plata, ilegible en unidades.
   - El presupuesto está en la **unidad del expediente**, no en la de
     compra: `m` de tubería (se compra por tubo de 5-6 m), `kg` de acero (por
     varilla según diámetro), `m³` de agregado, `p²` de madera (por pieza),
     `gal`/`rll` (por balde/rollo). Medido en Miraflores (sin mano de obra):

     | Unidad | Monto | Se compra por |
     |---|---|---|
     | `m` | S/ 1,10 M | tubo |
     | `p²` | S/ 498 k | pieza |
     | `m³` | S/ 408 k | nadie pide 0,39 m³ |
     | `kg` | S/ 141 k | varilla según diámetro |
     | `gal`, `rll` | S/ 111 k | balde / rollo |

2. **La clasificación del diccionario propio se equivoca por palabras
   genéricas.** No es un bug del simulador: es del clasificador que usa toda
   la app (`clasificarConIUPC`, `indices-unificados-iupc.js`). Medido contra
   los 348 términos reales de `clasificacion_terminos`: el término
   `MATERIAL SARANDEADO → [04] Agregado fino` (agregado el 23-set, origen
   `manual`) le da a la palabra **«material»** —genérica, aparece en cientos
   de nombres— el mismo peso que a una palabra distintiva. Resultado:
   `MATERIAL DE OFICINA Y CAMPO` → **04, confianza alta (80%)** y
   `MATERIAL ELÉCTRICO` → **04, confianza alta (85%)**. Sin ese término,
   `clasificarConIUPC` sola (capa oficial, sin diccionario propio) clasifica
   bien: `MATERIAL DE OFICINA Y CAMPO` → `93` (complementaria/administrativo)
   y `MATERIAL PARA CAPACITACIÓN A PERSONAL` → `S04` (Capacitación y
   simulacros). **Decisión de Gabriel: el término se queda (es una decisión
   suya, válida), se corrige el algoritmo** — que una palabra genérica no
   pueda cargar sola la coincidencia de un término propio.

3. **La unidad `mes` no es un insumo, es un sobre.** 3 líneas, S/ 30.800,
   `tipo_insumo='material'`, unidad `mes` — el expediente reserva una plata
   mensual (impresiones, cintas, insumos de oficina) sin decir qué se compra.
   Hoy `UNIDADES_SOBRE` en `insumo-clasificador.js` solo reconoce `%mo` y
   `glb` (§4.1) — `mes` le falta.

4. **175 órdenes propuestas es demasiado.** Hay tarjetas de S/ 787 con 5
   líneas fraccionadas por el reparto parejo. El diseño original (§10, tanda
   1) ya resolvió el agrupamiento «por rubro de proveedor» en vez de
   «por subcategoría» — el problema de ahora es otro: falta consolidar por
   **frecuencia** (no todo insumo necesita una orden nueva cada mes) y por
   **monto mínimo** (una orden chica se suma a la próxima del mismo rubro).

5. **Las 62 líneas ya ordenadas siguen sin `insumo_codigo`** (§11, nota de
   la tanda 1) — sin imputarlas, el modo «desde hoy» puede volver a proponer
   algo ya comprado. Sigue pendiente, ahora con más prioridad porque es lo
   que de verdad protege contra duplicar un gasto.

6. **No hay forma de ir directo a un mes.** La pantalla es un scroll largo;
   ver noviembre implica bajar por todos los meses anteriores.

### 12.2 — Decisiones de Gabriel (24-set-2026)

- **Colchón por robo/rotura/merma: 0% por defecto, SIN una tabla de
  porcentajes por rubro inventada por el motor.** Gabriel va a decidir él
  mismo, insumo por insumo, cuáles necesitan colchón (dijo «cemento,
  agregados, etc.» como ejemplo, pero son pocos) y en cuánto. El motor debe
  ofrecer el campo **por insumo, editable, vacío/0% por defecto** — no una
  perilla global ni una tabla de valores sugeridos por categoría. Nada de
  proponer un 5%/10% de oficio.
- **El término `MATERIAL SARANDEADO` se queda tal cual está en la base.** Se
  corrige el algoritmo de coincidencia, no el diccionario.
- **Orden de tandas: priorizar terminar bien y barato, no seguir el orden
  que se me ocurrió primero en el análisis.** Ver §13 — reordenado para que
  cada tanda deje una base sólida a la siguiente y la tanda más cara en
  tokens/IA (la de escenarios con IA) vaya al final, opcional como fue la
  tanda 5 de la ronda 1.

### 12.3 — Qué corregir en cada punto (para que la tanda no lo tenga que redescubrir)

- **Corrección del clasificador (punto 2):** en `evidenciaDiccionario()` /
  `indexarCustom()` (`indices-unificados-iupc.js`), el score de un término
  propio no puede depender de una sola palabra si esa palabra aparece en
  muchos otros términos/insumos del vocabulario (alta frecuencia = poco
  distintiva, como ya se trata en TF-IDF). Palabras como «material»,
  «suministro», «servicio de» deben pesar menos que «sarandeado»,
  «capacitación», «oficina». No es una lista negra a mano: es un cálculo de
  frecuencia sobre el propio vocabulario oficial + el diccionario propio.
- **Unidad de compra (punto 1):** nueva tabla `UNIDAD_COMPRA_POR_INSUMO` o
  columna calculada — de unidad de expediente (`m`, `kg`, `m³`, `p²`, `gal`,
  `rll`) a unidad de pedido (tubo, varilla, saco/lote, pieza, balde, rollo)
  con un factor de conversión. Por defecto 1:1 donde no aplica (`und`, `pza`,
  `bol`, `kg` de insumos que sí se compran por kg). Editable por insumo,
  recordado (localStorage, como el resto del escenario — no justifica tabla
  sincronizada, mismo criterio que §11 de la ronda 1).
- **Redondeo acumulado (punto 1):** en vez de redondear cada período
  suelto, acumular el real y pedir lo que falta para llegar al entero de
  arriba — así el total nunca se pasa por más de una unidad del presupuesto
  y los períodos alternan (4, 3, 4, 3…) en vez de redondear siempre hacia
  arriba y sobrepedir sistemáticamente.
- **Lote mínimo:** si un período no llega al lote de compra del insumo
  (0,39 m³ de arena), se junta con el período vecino — mismo mecanismo que
  ya existe para el tramo largo, aplicado también a tramos cortos que caen
  bajo el lote.
- **`mes` como sobre (punto 3):** agregar `'mes'` a `UNIDADES_SOBRE` en
  `insumo-clasificador.js` — una línea, con test.
- **Consolidación de órdenes (punto 4):** frecuencia por rubro (cada cuánto
  se emite una orden de ese rubro — no siempre mensual) y monto mínimo de
  orden (una orden por debajo de un umbral se acumula a la siguiente del
  mismo rubro). Separar cuándo se EMITE una orden de cuándo se ENTREGA lo
  pedido: una orden mensual con una tabla de entregas semanales adentro
  resuelve el caso semanal sin proponer 36 órdenes.
- **Navegación por meses (punto 6):** una tira de chips fija (mes → monto →
  n° de órdenes → avance de decisión) que hace scroll horizontal y saltа al
  bloque del mes al click. En modo semanal, las semanas van como sub-chips
  dentro de su mes.

## 13. Plan de tandas — ronda 2 (orden pensado para no rehacer trabajo)

Cada corrección de abajo se apoya en la anterior: clasificar mal contamina
el agrupamiento por rubro; cantidades en decimales contaminan cualquier
consolidación que se arme sobre ellas; y la navegación es una capa de UI que
conviene construir sobre datos ya estables, no antes. La tanda de IA queda
última y **opcional** — es la más cara en tokens y la que menos protege
contra un error de plata; las tandas 1-4 son las que de verdad arreglan lo
que Gabriel usó y no le sirvió.

| Tanda | Qué hace | Alcance / archivos | Modelo | Effort | Sesión |
|---|---|---|---|---|---|
| 2.1 | Clasificador: el score de un término propio no depende de una palabra genérica de alta frecuencia en el vocabulario. `mes` entra a `UNIDADES_SOBRE`. Con tests contra los 348 términos reales (o un fixture representativo) para no repetir el falso positivo de «material». | `src/lib/indices-unificados-iupc.js`, `src/lib/insumo-clasificador.js` | Opus 5.5 | Medio-alto (toca el clasificador que usa toda la app, no solo el simulador) | Nueva |
| 2.2 | Cantidades comprables: unidad de compra por insumo (editable, con default sensato por unidad de expediente), redondeo acumulado en vez de por período, lote mínimo que junta períodos cortos, colchón por insumo (campo editable, 0% por defecto, SIN tabla de sugeridos). | `src/lib/simulador-ordenes.js` (motor) + `jx-simulador-ordenes.jsx` (campos editables) + `simulador-escenarios.js` (persistir unidad de compra y colchón por insumo) | Opus 5.5 | Alto (toca montos y cantidades pedidas) | Nueva |
| 2.3 | Consolidación de órdenes: frecuencia configurable por rubro, monto mínimo de orden, separar emisión de entrega (tabla de entregas dentro de una orden). | `src/lib/simulador-ordenes.js` + `jx-simulador-ordenes.jsx` | Opus 5.5 | Alto (cambia qué es una «orden», afecta el puente a requisición de la tanda 4 original) | Nueva |
| 2.4 | Navegación: tira de chips por período (mes, y semanas como sub-chips), scroll al bloque, resumen por chip (monto, n° órdenes, % decidido). | `jx-simulador-ordenes.jsx` | Sonnet 5 | Medio (es UI sobre datos ya estables) | Nueva |
| 2.5 | Imputar las 62 líneas sin `insumo_codigo` + restar stock del almacén de la obra (reusar el match de `86bce80`, hoy solo en staging). Cierra el hueco real de doble pedido. | `src/lib/simulador-ordenes.js` (`coberturaPrevia`) + bandeja de imputación (puede reusar patrón de `jx-catalogo-canonico.jsx`) | Opus 5.5 | Alto (toca la regla de «nada se pide dos veces») | Nueva |
| 2.6 (opcional) | Escenarios con IA: 3 enfoques sorteados (caja ajustada / cero desabastecimiento / pocas órdenes / etc.) sobre las perillas ya existentes (reparto, anticipación, colchón, frecuencia, monto mínimo) — la IA elige combinaciones de parámetros y explica el «por qué», NUNCA inventa cantidades. Motor determinístico de sorteo primero (sin IA, gratis, siempre disponible); la llamada a OpenRouter (`lib/openrouter.js`, familia `ling-3.0-flash-*:free`, política ZDR) se suma encima solo para elegir enfoques según contexto de la obra. Solo si Gabriel lo pide explícitamente después de ver 2.1-2.5 en uso. | `api/asistente-solicitud.js` (nuevo modo por `body.tipo`, no crear endpoint) + `jx-simulador-ordenes.jsx` | Opus 5.5 (el sorteo determinístico puede ir en Sonnet 5 si se separa) | Alto | Nueva, y solo si Gabriel la pide |

**Por qué 2.1 antes que todo:** una clasificación mal hecha decide en qué
orden cae cada línea (agrupamiento por rubro, §10 de la ronda 1) — arreglar
cantidades o consolidar órdenes sobre rubros mal armados es trabajo que hay
que rehacer después.

**Por qué 2.5 antes que 2.6:** imputar las 62 líneas es lo único de esta
ronda que evita un doble gasto real medible hoy; la IA de escenarios es una
comodidad. Se prioriza lo que protege plata sobre lo que ahorra clics.

**Por qué 2.6 es la única con IA y la única opcional:** el resto de la ronda
2 son correcciones determinísticas sobre un motor que ya existe — no
necesitan modelo de lenguaje, y meter IA donde no hace falta es plata y
superficie de falla de más. La IA entra solo donde agrega algo que un cálculo
no puede: explicar un enfoque y variarlo con criterio.

## 14. Avance — ronda 2

- [x] Tanda 2.1 — clasificador: palabra genérica no decide sola (24-set).
      **Lo que cambió respecto de §12.3:** la frecuencia sobre el vocabulario
      NO alcanzaba como peso — «material» aparece en solo 2 entradas del
      Anexo 2 + servicios y en 2 del diccionario propio, así que un TF-IDF
      apenas lo castigaba. La regla que sí funciona es binaria: un parecido
      con un término propio (manual o aprendido) solo cuenta si comparte la
      palabra MÁS distintiva del término (mínima frecuencia en Anexo 2 +
      servicios + diccionario propio; números y palabras <4 letras no
      califican; un término sin palabras, «2 x 6 x 3», vale solo exacto). Se
      aplica en `mejorDePropio` (pasos 2b y 5b) y en la bolsa `propios` de
      `evidenciaDiccionario`. Medido contra los 348 términos reales y 1.055
      nombres (catálogo + presupuestos + muestras de la bandeja): cambian 11
      respuestas. 9 son correcciones (oficina → 93, capacitación → S04,
      brochas → 37, bisagra → 26, unión galvanizada → 65…). Hay dos para
      mirar: «ADAPTADOR UPR PVC 1 1/2"» antes acertaba de casualidad (72, por
      «pvc 1/2» de una abrazadera) y ahora cae en el Anexo 2 como 65 con 36 %
      (banda baja); «S. PUNTO AZUL…» (electrodo) ya no hereda el 51 de
      «S. FACILITO» y queda `sin_clasificar`. `mes` entró a `UNIDADES_SOBRE`
      (3 líneas en toda la base, todas Miraflores, S/ 30.800). Tests en
      `palabra-generica.test.js` y `simulador-ordenes.test.js`.
- [x] Tanda 2.2 — cantidades comprables (24-set). `src/lib/simulador-compra.js`
      (nueva, con tests) + pasos 1b (colchón) y 3b (unidades de compra) en
      `simularOrdenes()` + `leerCompras`/`guardarCompra` en
      `simulador-escenarios.js` + **migración 228, aplicada y verificada**
      (`requisicion_items.factor_presupuesto` y `oc_items.factor_presupuesto`).
      **Lo que cambió respecto de §12.3:**
      · **La unidad de compra NO sale de una tabla por unidad de expediente:
        sale del NOMBRE.** El expediente ya dice la presentación
        («TUBERIA PVC UF S25 DE 8" x 6m», «MADERA TORNILLO 1"x 8"x8'»). En
        Miraflores eso resuelve 17 insumos (15 tuberías + 2 maderas). Lo que
        el nombre no dice («MADERA TORNILLO PARA ENCOFRADO» —S/ 478k—, «ACERO
        CORRUGADO fy=4200» sin diámetro, la HDPE) queda en la unidad del
        expediente, en enteros. La varilla por diámetro (NTP 341.031, 9 m) está
        soportada pero en Miraflores no aplica: el acero no trae diámetro.
      · **Se guarda por OBRA, no por escenario** (`jx_sim_ordenes_v1:compras:<obra>`):
        que el tubo sea de 6 m no es una hipótesis que se compare entre
        escenarios.
      · **El lote mínimo no es un mecanismo aparte:** es el paso del redondeo
        acumulado (default 1). Un mes que no llega se junta con el ANTERIOR
        —no con el siguiente, que dejaría la obra corta— y la línea que lo
        absorbió dice «alcanza hasta noviembre».
      · **El factor tiene que viajar a la base (mig 228).** Sin él, la corrida
        siguiente restaba «28 tubos» de los metros del presupuesto: el doble
        pedido del §7. Solo se escribe cuando no es 1.
      · **Una corrección de cantidad/precio guarda en qué unidad se hizo**; si
        la unidad de compra cambia después, no se aplica y la línea lo avisa.
      · El colchón va ANTES del descuento (lo ya pedido con colchón no se
        vuelve a pedir); colchón y redondeo se informan aparte y NO cuentan
        para la cobertura.
      Medido en Miraflores (anclaje cero): 0 líneas con decimales (antes casi
      todas), 1.612 → 1.370 líneas, 158 → 149 órdenes; el redondeo acumulado
      cuesta S/ 3.525 en toda la obra (redondear mes por mes costaba ~S/ 150k).
- [x] Tanda 2.3 — consolidación de órdenes (24-set).
      `src/lib/simulador-consolidacion.js` (nueva, pura, sin imports) +
      paso 4 de `simularOrdenes()` reescrito en átomos → órdenes → líneas con
      `entregas` + decisiones por átomo en `simulador-escenarios.js` +
      cronograma de entregas en el puente. Tests en
      `simulador-consolidacion.test.js`. **Sin migración.**
      **Lo que cambió respecto de §12.3:**
      · **Emitir ≠ entregar se resolvió con ÁTOMOS.** Lo que hasta la 2.2 era
        la orden (período × rubro, id `2026-10|concreto`) ahora es un átomo;
        una orden junta átomos de un rubro y cada línea trae
        `entregas: [{periodo, cantidad, monto, propuestaId}]`. El id de la
        orden es el de su primer átomo, así que con los defaults el plan mes a
        mes sale idéntico al de antes (mismos ids, misma cantidad de órdenes).
      · **Las decisiones se guardan por átomo**, no por orden: juntar o separar
        cambiando una perilla no borra nada, y los escenarios de antes se leen
        tal cual (sus ids ya eran átomos). Si las entregas de una línea se
        decidieron distinto cuando eran órdenes sueltas, la línea queda
        `decisionMixta` y NO se entrega hasta volver a decidirla — pedir la
        mitad porque dos decisiones viejas se juntaron es inventar cantidad.
        Una cantidad corregida guarda `periodos_edicion` y no se aplica si la
        orden se reagrupa (mismo patrón que `unidad_edicion` de la 2.2);
        nombre, precio y proveedor sí sobreviven.
      · **Frecuencia:** `periodo | mensual | bimestral | trimestral | unica`,
        general y por rubro (por ESCENARIO: es una hipótesis que se compara).
        La ventana se abre con la primera necesidad del rubro y cubre N meses
        calendario; una semana es del mes de su jueves (`mesDePeriodo`).
        Default `mensual`: mes a mes no cambia nada; semana a semana da una
        orden mensual con entregas semanales (el caso del §12.3).
      · **Monto mínimo: la chica se junta con la SIGUIENTE y se emite en la
        fecha de la PRIMERA** (nada llega tarde); la última chica del rubro se
        suma a la anterior. Nunca cruza rubros. **Default 0** — el umbral lo
        fija Gabriel, mismo criterio que el colchón.
      · **Sin columna nueva para las entregas.** `requisicion_items` no tiene
        fecha por línea: el cronograma va en `observacion`
        («Entregas — octubre 2026: 100; noviembre 2026: 20 (bol)») y la orden
        lo resume en `ordenes_compra.fecha_entrega_ref`, que ya existía (mig
        179). Escritor y lector viven juntos en `simulador-puente.js`.
      · **El freno contra escribir dos veces pasó a ser por línea.** El de la
        tanda 4 miraba solo `origen_ref`, y con la consolidación se comía
        entregas NUEVAS (octubre escrito a medias + noviembre juntado con
        octubre = mismo `origen_ref`, noviembre salteado como «ya escrito»).
        Ahora una línea con código es duplicada solo si ya hay un ítem con el
        mismo código y la misma cantidad bajo ese `origen_ref`; la que no
        tiene código (2 de 6.722 en Miraflores) conserva el freno de antes.
      · `rangoDePeriodo` se mudó a `simulador-ordenes.js` (dotación lo
        re-exporta): la consolidación lo necesita y desde dotación se armaba
        un import circular.
      Medido en Miraflores (desde hoy / auditoría):

      | Parámetros | Mes a mes | Semana a semana |
      |---|---|---|
      | antes de la 2.3 | 71 / 149 | 223 / 501 |
      | default (mensual, sin mínimo) | 71 / 149 | 71 / 149 |
      | mínimo S/ 3.000 | 57 / 94 | 58 / 95 |
      | mínimo S/ 5.000 | 51 / 82 | 51 / 81 |
      | bimestral + mínimo S/ 3.000 | 33 / 63 | 34 / 64 |
      | una sola por rubro | 20 / 20 | 20 / 20 |

      La plata propuesta es la misma con cualquier combinación (±S/ 0,05 de
      redondeo) y las entregas de cada línea suman la línea.
- [x] Tanda 2.4 — navegación por meses (chips) (24-set). Solo
      `jx-simulador-ordenes.jsx` — sin motor, sin migración. Tira de chips
      sticky arriba de la lista de órdenes (pestaña «Órdenes propuestas»,
      solo si hay más de un período): un chip por mes con monto, n° de
      órdenes y % decidido (`propuestas.filter(estado !== 'pendiente')`), que
      hace `scrollIntoView` al bloque del mes (`id="jx-sim-periodo-<periodo>"`,
      con `scrollMarginTop` para no quedar tapado por la tira sticky ni por el
      header). En semana a semana las semanas se agrupan por mes con
      `mesDePeriodo` (la misma función que ya usa la 2.3 para la consolidación,
      re-exportada de `simulador-ordenes.js`) y cuelgan como sub-chips chicos
      dentro del chip de su mes — la tira sigue teniendo ~9 paradas en vez de
      36. No hay resaltado del chip activo por scroll-spy: no lo pidió
      Gabriel y sumaba un IntersectionObserver para un dato que el propio
      click ya deja claro.
- [x] Tanda 2.5 — imputar lo ya comprado: órdenes + almacén (24-set).
      `src/lib/simulador-imputacion.js` (nueva, pura, 33 tests) + almacén en
      `coberturaPrevia()` (`aporteDelAlmacen`, 14 tests nuevos en
      `simulador-ordenes.test.js`) + pestaña «🧾 Imputar lo ya comprado» +
      perilla «Del almacén, restar» en el escenario + **migración 229,
      aplicada y verificada** (`imputacion` en oc_items; `imputacion`,
      `insumo_codigo`, `factor_presupuesto` en materiales/herramientas/epps,
      con CHECK de coherencia).
      **Lo que cambió respecto de §13:**
      · **El almacén no era un detalle: es donde está lo comprado.** Medido en
        Miraflores: 3.140 bolsas de cemento entradas contra 2.250 en órdenes;
        467 ítems con entradas, sin código del presupuesto. Solo 21 de 716
        entradas están atadas a una factura, así que orden y entrada NO se
        pueden emparejar una por una.
      · **Qué resta el almacén lo eligió Gabriel como perilla del escenario:**
        todo lo que entró (default) / solo lo que hay / nada / personalizado
        por insumo (entradas, stock, nada o cantidad fija). «Lo que entró» es
        lo coherente con este motor (necesidad desde el inicio de la obra):
        restar solo las 62 bolsas que quedan volvería a pedir las 3.078 ya
        gastadas; la pantalla lo advierte en el modo «stock».
      · **Manda el almacén** (Gabriel): en un insumo que el almacén cubre, la
        orden RECIBIDA no se suma (ya está en las entradas); la no recibida sí;
        la recibida parcial suma `cantidad − cantidad_recibida`.
      · **Tres destinos, no uno:** insumo (con factor), SOBRE (solo órdenes:
        las ~43 herramientas de OC-002 gastan «HERRAMIENTAS MANUALES»; el
        consumo del sobre ahora suma órdenes + requisiciones) y FUERA del
        presupuesto (estudios del documento de trabajo) — ya no cuenta como
        «no se sabe». El almacén no puede ir a un sobre: no tiene precio.
      · **La sugerencia reusa `match-solicitud.js` y NO decide:** 156 de 467
        ítems del almacén salen sugeridos (137 con factor), y hay errores
        («VÁLVULA DE 1/2" PARA MEDIDOR» → «VÁLVULA CHECK»). Sin «aceptar
        todas». El factor sale de `resolverCompra` (tubo de 5/6 m leído del
        nombre del presupuesto, o la corrección de la obra) o de la misma
        unidad escrita distinto (`bol` = Bolsas, agregado a la familia de
        unidades); si no se sabe, se pide.
      · `match-solicitud.js` quedó como chunk compartido (hoja de 9,7 KB,
        cero imports) entre Solicitud de Insumos y el simulador: el caso
        inocuo, igual que `stock-comprometido`.
      · Permisos: escribir la imputación requiere UPDATE en oc_items y en el
        almacén (rls033: admin, gerente, jefe_compras, …). El SyncEngine no
        sube `stock_actual` ni totales (TRIGGER_MANAGED_FIELDS), así que
        imputar un material no pisa su stock.
- [x] Tanda 2.6 (opcional) — escenarios con IA (24-set). Pedida por Gabriel
      después de usar 2.1-2.5. `src/lib/simulador-sorteo.js` (nuevo, puro,
      14 tests) + `src/lib/simulador-sorteo-ai.js` (cliente) + acción
      `recomendar_enfoque_simulador` multiplexada en
      `api/asistente-solicitud.js` (10 tests nuevos) + pestaña
      «💡 Escenarios sugeridos» en `jx-simulador-ordenes.jsx`.
      **Lo que cambió respecto de §13:**
      · **El colchón se sacó de la lista de perillas que un enfoque toca.**
        El texto original de esta tabla lo incluía junto a reparto,
        anticipación, frecuencia y monto mínimo — pero CLAUDE.md §8 (decisión
        de Gabriel, tanda 2.2) prohíbe explícitamente una tabla de colchones
        sugerida por el motor. Un enfoque que le subiera el colchón a
        «cemento, agregados, etc.» sería exactamente esa tabla. Cada enfoque
        toca solo reparto, anticipación, frecuencia y monto mínimo — las
        cuatro perillas que la persona ya puede tocar a mano.
      · **El motor determinístico corre PRIMERO y es autosuficiente**, tal
        como pedía el diseño: `sortearEnfoques()` corre `simularOrdenes()`
        tres veces (una por enfoque) con el motor REAL, sin IA, gratis. La
        pestaña muestra los tres con sus números reales aunque la IA nunca
        se llame.
      · **«Pocas órdenes» no usa un monto mínimo de oficio.** Se mide contra
        la propia obra: se corre primero un baseline (mensual, sin mínimo) y
        se toma 1,5× la mediana de sus montos, redondeada a la centena — si
        hay menos de 4 propuestas para medir, el mínimo queda en 0 (no
        inventa un umbral sin datos).
      · **Ningún enfoque elige `reparto:'cuadrilla'` ni `'manual'`**, herede
        lo que herede la base: la tanda 1 ya dejó escrito que esas dos
        estrategias pueden quedar sin datos con qué contestar, y un enfoque
        automático no puede caer ahí.
      · **Respeta el anclaje, el cronograma, las categorías, `almacenModo` y
        `frecuenciaPorRubro` de la base** — son la PREGUNTA que la persona ya
        eligió, no algo que un enfoque decida por ella.
      · **La IA ve solo los TRES resúmenes ya calculados** (id, cobertura,
        n° de órdenes, plata), nunca el presupuesto ni el cronograma: no hay
        con qué inventar una cantidad. Devuelve cuál de los tres `id`
        recomienda + una explicación corta; un id fuera de la lista cerrada
        se descarta entero (misma regla que el `insumo_id` inventado del
        asistente de solicitudes). Es un botón aparte («🤖 Pedir
        recomendación a la IA»): nunca se llama sola al abrir la pestaña.
      · Distinta allowlist de roles que el resto del endpoint: admin,
        gerente, contador, ayudante_contador — los mismos que ven el
        simulador (§8 del plan), no el personal de almacén/obra que usa
        Solicitud de Insumos.
      · Sin migración, sin tabla nueva. `simulador-sorteo.js` no se separó en
        un chunk aparte del build: solo lo importa `jx-simulador-ordenes.jsx`,
        así que Rollup lo deja adentro de ese mismo chunk lazy.

## 15. Ronda 3 — la pantalla contesta dos preguntas mezcladas (24-set-2026, noche)

Gabriel probó la ronda 2 en el preview de staging (Miraflores) y la frenó antes
de pasar a main. Sus observaciones, y lo que hay detrás de cada una en el código:

### 15.1 — Diagnóstico

1. **Dos preguntas distintas en una sola pantalla.** «¿Cómo compraría esta obra
   si arrancara / si pasara X?» (SIMULACIÓN, sale solo del presupuesto y del
   cronograma) y «¿qué me falta pedir según lo que YA pasó?» (SEGÚN LO REAL:
   resta órdenes, requisiciones, almacén y avance). Hoy las separa solo el
   selector de anclaje (`hoy | restante | cero`), y los avisos de lo comprado
   y del almacén salen SIEMPRE — también cuando la pregunta es hipotética,
   donde no tienen nada que ver.
2. **Los avisos ocupan media pantalla.** Tres tarjetas grandes (62 líneas de
   OC sin imputar, 466 ítems del almacén, 2 requisiciones) y hasta cuatro
   párrafos, antes de la primera orden.
3. **Once perillas al mismo nivel** (anclaje, cronograma, reparto, período,
   anticipación, umbral de tramo largo, categorías, frecuencia, monto mínimo,
   frecuencia por rubro, almacén). Nada separa lo básico de lo fino.
4. **«Reprogramado a mano» y «Manual, partida por partida» piden un dato que
   nadie va a cargar** (fijar a mano las fechas o el reparto de 1.718
   partidas). Hoy terminan en «Sin planificar». Gabriel pide que esas dos
   opciones sean **ALEATORIO POR ESCENARIO**: no al azar incoherente, sino
   un cronograma plausible armado sobre una historia de la obra (ej. «arranca
   con buena caja, en los meses intermedios no pagan y se baja la marcha,
   después pagan y se acelera al final»), y que diga qué historia tomó.
   Observó además que con el Gantt del expediente **la carga de órdenes se
   amontona en los últimos meses** (sep S/ 454k → oct 1,06 M → nov 1,2 M → dic
   1,08 M, contra abr S/ 41k).
5. **El filtro de categorías existe pero el resultado sale mezclado.** El
   motor ya clasifica en Materiales / Herramientas y EPPs / Servicios y
   alquileres (`CATEGORIA_DE_SUBCATEGORIA` en `insumo-clasificador.js`); la
   lista de órdenes igual va por mes con todos los rubros juntos, y las
   herramientas no se ven como bloque.
6. **Siete pestañas, dos que no son del simulador.** «Imputar lo ya comprado»
   es la correlación comprado-real ↔ presupuesto: es otra pregunta y merece su
   propia sección. «Escenarios sugeridos» es CONFIGURACIÓN (tres combinaciones
   de perillas), no un resultado.
7. **Bug visual (arreglado en 55fcd28):** la tira sticky de meses tenía
   `top: var(--header-h)` dentro de `.page-wrap`, que es el que scrollea; las
   tarjetas pasaban por la franja de 58 px de arriba.

Lo que ya existe y se reusa: el motor acepta `reprogramacion`
(partida_id → {inicio, fin}) y `repartoManual`. **El «aleatorio» no necesita
tocar el motor: es un GENERADOR de esos dos datos.** Y hay avance real para el
modo «según lo real»: en Miraflores 96 partidas con `porcentaje_avance > 0`,
20 terminadas, 392 reportes en `avance_obra` (ninguna con `fecha_inicio_real`).

### 15.2 — Propuesta

**A. Dos modos, el primer selector de la pantalla.**
- 🧪 **Simulación** — presupuesto + cronograma elegido. No resta nada real, no
  muestra avisos de compras ni de almacén. Reemplaza al anclaje `cero`
  (deja de llamarse «auditoría»).
- 📍 **Según lo real** — desde hoy; resta órdenes, requisiciones y almacén; en
  avanzado, quita lo ya ejecutado (avance). Reemplaza a `hoy`. `restante` se
  retira (nadie lo usa y confunde).

**B. Configuración en dos niveles.** En la pantalla: modo, cronograma, qué se
incluye, período, cada cuánto se emite. Detrás de ⚙: anticipación, umbral de
tramo largo, reparto, monto mínimo, frecuencia por rubro, qué resta el almacén
y el avance (solo modo real), y los tres enfoques de la 2.6 como «puntos de
partida».

**C. Cronograma «aleatorio por escenario»** (motor puro nuevo, con semilla):
- Catálogo CERRADO de historias, cada una una curva de ritmo por tramo de la
  obra (ej. 100 % → 50 % → 140 %).
- Reprograma respetando el orden del Gantt (lo que empezaba antes sigue antes
  — no hay precedencias cargadas y este es el mejor proxy) y, cuando la caja
  aprieta, sigue con las partidas de menor costo por día y posterga las caras.
- La semilla hace que el mismo escenario dé el mismo cronograma; «🎲 Otro»
  sortea otra historia o varía la intensidad dentro de rangos.
- **La IA elige la historia y la cuenta; nunca pone una fecha.** Ve el perfil
  de carga del Gantt, el plazo y los montos, y devuelve un id del catálogo +
  parámetros dentro de rangos + la explicación. Mismo principio que la 2.6: un
  id fuera de la lista se descarta.
- La pantalla muestra la **curva de carga por mes** (Gantt vs escenario): es lo
  que hace legible el escenario.

**D. Reparto de tramo largo:** Parejo / Todo al inicio / **Según el escenario**
(reemplaza «Manual»; se esconde «Por cuadrilla» hasta que exista el dato).

**E. Resultados por categoría:** un bloque por cada categoría incluida, con sus
propios chips de mes y totales. Los sobres entran en el bloque de su
categoría. Herramientas y EPP, en modo real, se comparan contra el stock del
almacén («ya hay 12 carretillas»).

**F. Pestañas finales:** Materiales · Herramientas y EPP · Servicios y
alquileres · Mano de obra (referencia) · Sin planificar · Ya pedido.
«⚠ Avisos (N)» pasa a ser un botón del encabezado, con los avisos que aplican
al modo elegido. «Imputar lo ya comprado» se muda a su propia sección de
Logística.

### 15.3 — Decisiones de Gabriel (24-set-2026, noche)

- **Fin de obra: se RESPETA.** Lo que un escenario frena se recupera
  acelerando al final; el plazo contractual no se mueve. Solo una historia
  explícita del catálogo («pagos atrasados todo el plazo») lo estira, y la
  pantalla lo dice.
- **Arranque en modo Simulación: selector, Gantt por defecto.** Además de las
  fechas del expediente se puede elegir «como si empezara hoy» o una fecha;
  se corre el cronograma entero.
- **Promover a main lo de staging ya** (almacén + registros + ronda 2 tal
  cual); la ronda 3 lo reordena después.

Preguntas originales:

1. En el escenario aleatorio, ¿se respeta la fecha de fin de obra (lo que se
   frena se recupera acelerando) o se permite que se estire?
2. En modo Simulación, ¿la obra arranca en la fecha del Gantt o «como si
   empezara hoy» (se corre todo el cronograma)?
3. ¿Se promueve a main lo que ya está en staging (almacén + ronda 2 tal
   cual) o se espera a la ronda 3?

### 15.4 — Tandas (orden pensado para no rehacer trabajo)

| # | Qué | Toca | Modelo |
|---|---|---|---|
| 3.1 | Modos + avisos a botón + config básica/⚙ + pestañas por categoría + enfoques a ⚙ | `jx-simulador-ordenes.jsx`, `simulador-escenarios.js` (migrar params guardados) | Opus / alto / sesión nueva |
| 3.2 | «Imputar lo ya comprado» a sección propia | página nueva (main, jx-app, sidebar, allowlists de jx-admin) | Sonnet / medio / misma sesión que 3.1 |
| 3.3 | Motor de cronograma por escenario + reparto «según escenario» + curva de carga | lib pura nueva + tests | Opus / extra alto / sesión nueva |
| 3.4 | La IA elige y narra el escenario | acción en `api/asistente-solicitud.js` | Opus / alto / misma sesión que 3.3 |
| 3.5 | Modo real completo: quitar lo ejecutado (avance) + herramientas contra stock | motor + pantalla | Opus / alto / sesión nueva |

### 15.5 — Avance — ronda 3

**Tanda 3.1 HECHA el 24-set** (en staging). Lo que se hizo y lo que la tanda
tuvo que decidir:

- **Modo en vez de anclaje.** `params.modo` (`real` | `simulacion`) reemplaza
  a `params.anclaje`; `paramsDeMotor` lo traduce (`simulacion` → `cero`,
  `real` → `hoy`), así que el motor no cambió. Los escenarios guardados se
  migran solos en `normalizarParams`: `cero` → simulación, `hoy` y
  `restante` → real. También se abren con el default los que tenían
  `cronograma: 'reprogramado'` o `reparto: 'cuadrilla' | 'manual'`
  (`CRONOGRAMAS_PANTALLA`, `REPARTOS_PANTALLA`): el motor los sigue
  aceptando para la 3.3.
- **En Simulación el motor NO recibe nada real** (órdenes, requisiciones,
  almacén, lo gastado de los sobres). Por eso no hay avisos de compras ni de
  almacén en ese modo, y el aviso de «nadie informó lo gastado» de los sobres
  no sale (el sobre está entero por definición).
- **Arranque** (§15.3): `arranque` (`gantt` | `hoy` | `fecha`) +
  `arranqueFecha`. Lo resuelve `desplazarCronograma` en la lib nueva
  `simulador-cronograma.js`: corrimiento rígido de todas las partidas y del
  plazo, que el motor recibe como `cronograma: 'reprogramado'` +
  `reprogramacion`. La 3.3 suma ahí el cronograma aleatorio.
- **Decisión tomada en la tanda, a revisar con Gabriel:** en Simulación el
  botón «Convertir en requisiciones» queda APAGADO. El plan no restó lo ya
  comprado, así que convertirlo pediría dos veces. Lo aceptado se guarda y
  se vuelve a aplicar al pasar a «Según lo real». (Antes, el anclaje `cero`
  avisaba «sirve para revisar, no para emitir» pero dejaba convertir.)
- **Pestañas por categoría:** una orden va ENTERA a la categoría que más
  plata pesa adentro (`categoriaDePropuesta`); si trae líneas de otra, la
  tarjeta lo dice. «Aceptar el tramo» decide solo las órdenes de la pestaña
  abierta (con la lista entera aceptaba también lo de las otras pestañas sin
  que se viera).
- **Sobres por categoría:** cada sobre va a la pestaña de su `categoria`. El
  costo: el resumen por grupo IUPC ahora es por pestaña. En el caso de
  prueba, «PUBLICACIONES» (IUPC S12, un servicio) cae en Materiales porque su
  subcategoría del simulador sale `material` — es un desacuerdo previo entre
  el clasificador del simulador y el IUPC, no de esta tanda.
- **Avisos a un botón** del encabezado («⚠ Avisos (N)»), solo en modo real.
  «Imputar lo ya comprado» ya no es pestaña: se abre desde los avisos (y
  desde «Personalizado por insumo» del almacén), con «← Volver al plan»,
  hasta que la 3.2 le dé su sección.
- **Puntos de partida** (los enfoques de la 2.6) dentro de ⚙. Se calculan
  solo con ⚙ abierto. `sortearEnfoques` ahora respeta el `anclaje` y el
  `cronograma` que recibe (antes los re-normalizaba y perdía el corrimiento
  del arranque).
- El primer render lee el escenario guardado sin esperar al efecto: antes se
  pintaba un instante con los defaults (modo real, con sus avisos).

**Tanda 3.2 HECHA el 25-set** (commit c83f647, en staging). «Imputar lo ya
comprado» es su propia página de Logística (`jx-simulador-imputar.jsx`, page
id `imputar-compras`, mismo módulo/permiso que el simulador). Imputar una
fila no depende del escenario; qué resta el almacén sí, y se quedó en ⚙.

**Tanda 3.3 HECHA el 25-set** (en staging). `simulador-cronograma.js` suma el
cronograma «aleatorio por escenario», el reparto «según el escenario» y la
curva de carga; la pantalla gana el selector de historia con «🎲 Otro» y la
tarjeta que la cuenta. Tests en `simulador-cronograma.test.js` (40 nuevos),
`simulador-escenarios`, `simulador-sorteo`, `simulador-ordenes` y la pantalla.
Sin migración. Lo que se hizo y lo que la tanda tuvo que decidir:

- **El modelo es un FRENTE DE OBRA.** Una historia es una curva de ritmo por
  tramos (100 % = el Gantt). El frente dice, para cada día del escenario,
  hasta qué día del Gantt llegó la obra; cada partida arranca cuando el
  frente llega a su inicio y termina cuando llega a su fin. Como todas se
  leen contra el mismo frente, el orden del Gantt se respeta sin mirarlo
  partida por partida, y la última partida termina el día que el frente
  llega al fin.
- **Las predecesoras NO sirven (medido).** `partidas.predecesoras` trae 1.158
  textos estilo MS Project en Miraflores, pero los números no resuelven:
  219 de 881 referencias no existen y, de las que resuelven por `orden`, 262
  «fin-comienzo» contradicen las fechas del propio Gantt. El orden del Gantt
  sigue siendo el proxy, como decía el §15.2.
- **El fin se respeta por construcción** (§15.3): el ritmo del cierre no es
  un dato de la historia, se calcula para que el frente llegue al fin el
  último día. Solo `atraso_todo` («Pagos atrasados todo el plazo») estira
  el fin, y la pantalla dice cuántos días.
- **Catálogo cerrado de seis historias:** frenazo a mitad de obra (el
  ejemplo de Gabriel), arranque lento, pagos a los tirones, obra adelantada,
  todo para el final y pagos atrasados todo el plazo. Cada una con rangos
  por perilla y un paso; hay un test que barre TODAS las esquinas de los
  rangos: el cierre calculado queda siempre entre 50 % y 160 %.
- **Las caras esperan con su propio frente:** quieto durante un tramo de caja
  apretada que tenga plata después, y que alcanza al general al final del
  tramo siguiente. Nunca arrancan antes que en el frente general. «Cara» se
  mide contra la obra: las de más costo por día (costo de TODOS sus
  insumos, la planilla también es caja) que suman la cuota del sorteo (30 a
  50 % de la plata). En Miraflores: 30 % = 13 partidas (> S/ 6.893/día),
  40 % = 30 (> S/ 3.540), 50 % = 47 (> S/ 3.025).
- **La semilla** (FNV-1a + mulberry32, sin dependencias) va en los params del
  escenario (`historia`, `semilla`, `historiaAjustes`). «Al azar» con la
  semilla N da exactamente lo mismo que elegir a mano la historia que salió
  con N. «🎲 Otro» cambia la semilla y suelta los ajustes.
- **`historiaAjustes` ya existe para la 3.4:** perillas fijadas dentro de los
  rangos, recortadas y pegadas al paso; con «al azar» no se aplican. La IA
  va a elegir id + ajustes; las fechas las pone siempre la lib.
- **Reparto «según el escenario»:** lo que avanza la obra en cada período
  (por días con el Gantt; con una historia, un mes de frenazo lleva la
  mitad por día). Lo arma `repartoSegunEscenario()` para TODAS las
  partidas fechadas, en los mismos períodos que va a mirar el motor
  (anticipación incluida). **El motor sí se tocó, mínimo:** `REPARTOS` suma
  `'escenario'`, que lee el mismo `repartoManual` que `'manual'` pero con su
  propio motivo de pendiente. Sin eso no había ida y vuelta con los puntos
  de partida (que ahora lo heredan, solo si viene el dato). Con «sin
  cronograma» cae a parejo y la pantalla lo dice.
- **La curva de carga** es una segunda corrida del motor —el mismo escenario
  sin la historia, con el mismo arranque— y solo se hace con una historia
  activa (~110 ms en Miraflores). Suma por ENTREGA (lo que cada mes
  necesita) más los sobres, no por fecha de emisión: la frecuencia es otra
  perilla. Gráfico de énfasis (historia en `--amber-d`, Gantt en `--tm`,
  validados con el script de dataviz en los dos temas), leyenda, pico
  rotulado, valor al pasar o con teclado y tabla mes por mes.
- **Una historia mueve la plata, no la crea:** en Miraflores, las seis
  historias con los dos repartos dan el mismo neto planificado que el Gantt
  (diferencia ≤ S/ 0,07, redondeo). Hay test.

Medido en Miraflores (modo Simulación, reparto según el escenario, semilla 1;
miles de soles por mes):

| | abr | may | jun | jul | ago | set | oct | nov | dic |
|---|---|---|---|---|---|---|---|---|---|
| Gantt | 26 | 221 | 143 | 197 | 310 | 604 | 1.063 | 1.413 | 1.142 |
| 🛑 Frenazo (25-jul→11-set al 50 %, cierre 122 %) | 26 | 220 | 143 | 176 | 101 | 261 | 836 | 1.780 | 1.576 |
| 🐢 Arranque lento (hasta 12-jul al 60 %, cierre 117 %) | 26 | 49 | 133 | 185 | 265 | 333 | 984 | 1.657 | 1.489 |
| 📶 Tirones (3 cortes al 50 %, cierre 126 %) | 26 | 221 | 110 | 197 | 205 | 502 | 758 | 1.485 | 1.614 |
| 🚀 Adelantada (hasta 24-jul al 130 %, cierre 84 %) | 27 | 280 | 236 | 218 | 498 | 683 | 942 | 1.231 | 1.004 |
| ⏰ Todo para el final (80 %, cierre 124 %) | 26 | 155 | 154 | 154 | 147 | 416 | 1.044 | 1.604 | 1.419 |

«Pagos atrasados todo el plazo» al 75 % estira el fin al 22-mar-2027 y sigue
con ene 940 · feb 1.121 · mar 559. La «adelantada» es la única que achata el
amontonamiento del final que Gabriel vio en el Gantt (§15.1 punto 4).

**Decisiones tomadas en la tanda, a revisar con Gabriel:**

1. **En «📍 Según lo real» la historia corre desde HOY**, no desde el inicio
   del plazo: lo que ya pasó, pasó como pasó (el Gantt). En Miraflores, con
   el frenazo, eso deja 1 partida cara esperando (S/ 233 k) y 7 en marcha
   que se paran (S/ 2,65 M).
2. **Elegir una historia no cambia el reparto solo.** Con reparto parejo, la
   tarjeta avisa que adentro de un tramo largo no se ve el ritmo y ofrece
   un botón «Repartir según el escenario».
3. **En modo real con una historia se puede convertir en requisiciones:**
   la historia cambia CUÁNDO se pide, no cuánto (la plata total es la
   misma). En Simulación sigue apagado, como decidió la 3.1.
4. **En Miraflores (simulación) el frenazo casi no toca caras:** el dinero
   está amontonado al final y en el tramo del frenazo (jul-set) cae una
   sola partida cara (el tijeral, S/ 39.460). El frenazo se nota por el
   ritmo, no por las caras; en modo real, desde hoy, sí se notan.

**Tanda 3.4 HECHA el 25-set** (en staging). La IA elige y cuenta la historia;
nunca pone una fecha. Tests en `simulador-historias.test.js` (19, con la red
simulada) y en la pantalla. Sin migración. Lo que se hizo y lo que la tanda
tuvo que decidir:

- **El catálogo se mudó a una lib hoja**, `simulador-historias.js` (cero
  imports; `simulador-cronograma.js` lo re-exporta). El endpoint la importa
  para validar contra el catálogo REAL y no contra una copia del cliente, sin
  arrastrar el motor ni el diccionario del IUPC a la función de Vercel —
  mismo caso que `match-solicitud.js`. Un test verifica que siga sin imports.
- **Acción `elegir_historia_simulador`** multiplexada en
  `api/asistente-solicitud.js`, misma allowlist que la 2.6 y mismo OpenRouter
  gratis. El prompt se arma del catálogo (ids, resúmenes, rangos con su paso).
- **Lo que la IA ve** (`contextoParaHistoria`): nombre, plazo, desde cuándo
  corre la historia, lo comprable y la plata por mes CON EL GANTT (la curva
  de base de la 3.3), en miles. Ninguna partida ni insumo.
- **Una entrada nueva, opcional:** «¿Qué te preocupa de esta obra?». Sin
  ella, la IA solo tiene la forma de la curva para elegir y casi siempre
  elegiría lo mismo; con ella («la entidad paga tarde a fin de año») la
  elección tiene contra qué razonar. Manda sobre la lectura propia de la IA.
- **Tres frenos, en servidor Y cliente** (`sanearHistoriaIA`): id fuera del
  catálogo → se descarta todo; perilla fuera de rango → se recorta y se pega
  al paso; oración con una fecha puntual (día, dd/mm o año) → se tira.
  Nombrar un mes se permite: es leer la curva que se le dio.
- **Lo que la IA no fijó se completa con el sorteo** y TODAS las perillas
  pasan a `historiaAjustes`: el relato describe exactamente lo que se
  simula. El relato se guarda en el escenario (`relatoIA`, no en params: no
  es una perilla) y solo se muestra mientras la historia y las perillas
  sigan siendo ésas (`relatoIAVigente`); «🎲 Otro» lo apaga. «Guardar
  como…» lo copia.
- En la tarjeta, el relato de la IA va arriba y dice lo que es («la IA eligió
  la historia y sus perillas; las fechas, los ritmos y la plata de abajo los
  calculó el sistema»); el relato determinístico, con las fechas, sigue
  abajo. Nunca se llama sola: es un botón, con anti doble-click por ref.

**Sin probar contra el modelo real:** los tests simulan la respuesta de
OpenRouter. La primera prueba en el preview dice si el modelo gratuito
respeta el formato; si no, el botón responde «no se consiguió una historia»
y queda la del sorteo.

**Tanda 3.5 HECHA el 24-set** (en staging; las «25-set» de arriba son la
misma noche en hora UTC: los commits de la 3.2 a la 3.4 son del 24-set hora
de Lima). «📍 Según lo real» completo: lo ya ejecutado y las herramientas
contra el stock. Tests en `simulador-ordenes.test.js` (12 nuevos),
`simulador-stock.test.js` (8, lib nueva), `simulador-escenarios` (3) y la
pantalla (4). Sin migración. Lo que se hizo y lo que la tanda tuvo que decidir:

- **Lo ejecutado sale de los períodos MÁS VIEJOS de cada partida**
  (`quitarEjecutado`), no parejo: en una partida de cuatro meses al 50%,
  proporcional dejaría la mitad de los dos primeros meses —ya hechos—
  arrastrada al mes actual. Así lo hecho deja de volver como «atrasado», y lo
  adelantado sale de meses que todavía no llegaron. El dato es
  `partidas.porcentaje_avance` (0–100), el mismo que usan Mi frente y control
  de consumo. `avance_obra` (128 reportes) no se lee: su resultado ya vive en
  la partida.
- **Nada se resta dos veces** (`coberturaConAvance`). Sin avance, el plan
  restaba de la necesidad total lo cubierto K (entradas del almacén, órdenes,
  requisiciones). Con avance, sale lo ejecutado E por partida, y de lo
  cubierto se resta solo `max(A, K − E)`, donde A es lo que sigue sin usarse
  (stock de hoy, lo ordenado que no llegó, lo requisado). Es lo mismo que
  decir «lo cubierto de verdad es max(E + A, K)»: o lo ejecutado se hizo con
  lo que entró (y K ya lo incluye), o con algo que nadie registró (y lo
  disponible igual está). Sumar E y K contaría dos veces el cemento que entró
  y ya está en la losa. Con E = 0 da K: el que no prende la perilla no ve
  ningún cambio (hay test). El colchón de un insumo también se aplica a su
  parte ejecutada.
- **Viene APAGADA** (`params.restarAvance`, en ⚙, solo modo real). El §15.2
  la ponía «en avanzado», y el avance lo reporta el frente y puede venir
  atrasado. Para que no quede escondida: con avance reportado y la perilla
  apagada, «⚠ Avisos» lo dice con un botón que abre ⚙. **A confirmar con
  Gabriel si la quiere prendida por defecto.**
- **Se mide aunque no se reste** (`resumen.avance`): partidas y plata
  ejecutada, líneas hechas enteras, partidas adelantadas, lo que lo ejecutado
  «absorbió» de lo comprado, y las partidas que el cronograma ya da por
  terminadas SIN avance reportado. Con la perilla prendida estas últimas son
  un aviso ámbar: lo suyo se sigue pidiendo en el mes actual, y si ya se
  hicieron lo que falta es reportarlas. En Simulación (`anclaje 'cero'`)
  nada de esto existe: ni se resta ni se mide.
- **Sobres:** lo ejecutado es un PISO de lo gastado. Si nadie informó nada, o
  informó menos, «queda» se mide contra lo ejecutado y la tarjeta dice que es
  una estimación (`consumoPorAvance`); si informaron más, manda lo informado.
  La parte ejecutada sale de lo planificado del sobre.
- **La mano de obra de lo ejecutado tampoco pide gente**: la corrida de
  dotación hereda la perilla.
- **Herramientas y EPP contra el stock** (lib nueva `simulador-stock.js`,
  §15.2 E). Tres cajones y solo uno resta: lo IMPUTADO (ya lo restaba el
  motor; acá se muestra en verde), lo PARECIDO por nombre (azul, NO resta:
  «ZAPATOS 41 (2 par)» junto a «ZAPATOS PUNTA DE ACERO», con el camino a
  imputarlo) y lo SUELTO (herramientas del almacén sin línea propia, que se
  listan dentro del sobre «HERRAMIENTAS MANUALES» como «En el almacén ya
  hay…»; los EPPs sueltos van en un resumen arriba de la pestaña). Cuenta el
  STOCK de hoy, no las entradas: «ya hay» es lo que se puede usar.
- **El parecido reusa `match-solicitud.js`** con el piso de sus alternativas
  (0,30) más una condición: la PRIMERA palabra tiene que coincidir (se
  exportó `coincide`). Sin ella, «PUNTA» (de barreta) salía a 0,80 contra
  «ZAPATOS PUNTA DE ACERO». El piso de sugerir (0,60) o uno de 0,40 no
  servían: la talla es una medida que la línea genérica no tiene y baja el
  puntaje (0,37 a 0,43 según el catálogo). Con empate no elige: el ítem sale
  en todas las líneas que empatan («GUANTES» en las tres de guantes).

Medido en Miraflores (24-set, modo real, «todo lo que entró», sin nada
imputado todavía):

| | Sin restar lo ejecutado | Restando lo ejecutado |
|---|---|---|
| Propuesto en órdenes | S/ 4,60 M | S/ 4,21 M |
| Sobres | S/ 525 k | S/ 367 k |
| Arrastrado al mes actual | S/ 786 k | S/ 565 k |
| Setiembre (mes actual) | S/ 1,25 M | S/ 1,01 M |
| «HERRAMIENTAS MANUALES»: queda | sin dato (nadie informó) | S/ 122.140 (ejecutado S/ 10.353) |

93 partidas con avance y líneas de presupuesto (S/ 548 k del comprable
ejecutado), 63 líneas hechas enteras, 25 partidas adelantadas, y **321
partidas que el Gantt da por terminadas sin avance reportado (S/ 293 k)**.
Stock: de 135 herramientas y EPPs, 57 con stock; 9 líneas del plan con algo
parecido (14 ítems), 43 sueltos. `absorbido` no se pudo medir con datos
reales: nada del almacén está imputado todavía. Lo cubren los tests.

**Decisiones tomadas en la tanda, a revisar con Gabriel:**

1. La perilla viene apagada (ver arriba). Prenderla por defecto es un cambio
   de una línea (`PARAMS_DEFAULT.restarAvance`).
2. Lo parecido por nombre NO resta, ni con un clic. Si Gabriel quiere que
   «ya hay 16 guantes» baje la línea, el camino es imputar esos ítems (la
   página de la 3.2), no un atajo desde acá: una imputación por parecido es
   el error que la bandeja evita.
3. El stock de herramientas no descuenta plata del sobre: el almacén no tiene
   precio de esas herramientas (valor de inventario S/ 0), así que se muestra
   como lista, no como monto.
