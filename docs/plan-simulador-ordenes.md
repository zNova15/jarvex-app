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
