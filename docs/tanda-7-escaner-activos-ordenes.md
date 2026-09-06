# Tanda 7 — Escáner de incoherencias, recomendador de activos y el rediseño de órdenes

> Escrito el 6-sep-2026 sobre el pedido de Gabriel, con **todo medido contra
> producción** antes de proponer nada. Las tres cosas se pueden. La tercera
> tiene un hallazgo que hay que resolver **antes** de escribir una línea, o la
> obra paga dos veces el mismo cemento.

---

## 0. Lo que se midió (y que manda sobre todo lo de abajo)

| Dato | Valor |
|---|---:|
| Líneas de ítem en facturas de compra | **2.440** |
| …con cantidad, unidad y `tipo_insumo` | **2.440 (100%)** |
| …ya enlazadas a un `material_id` | 466 (19%) |
| Líneas **sin obra** (stock libre, vendible) | **1.684 (69%)** |
| Líneas **ya imputadas a una obra** | 756 (31%) |
| Insumos canónicos del presupuesto (`insumo_codigo`) | **434** (382 materiales) |
| `insumos_partida` de Miraflores | **6.722** filas |
| Empresas que compraron | 23 |

**La buena noticia grande:** el lado de «cuánto necesita la obra» **ya existe y
está cargado**. No hay que inventarlo.

---

## 1. Los códigos SPOT — sí, se puede sugerir desde la descripción

Gabriel: *«Yo pensaba que analizabas la descripción del servicio o el insumo y
ayudabas a colocar el código. Me gustaría que puedas colocar el código en base a
eso, buscando algo muy certero, y que la contadora lo acepte como una
recomendación.»*

**Aclaración de lo que yo estaba haciendo:** solo leía el campo
`detraccion_codigo` de cada comprobante y comparaba. No analizaba la
descripción. Por eso los seis salieron como «código vacío» y nada más.

**Se puede hacer, y sin IA para la mayoría de los casos.** El Anexo 3 es una
lista corta y los servicios se reconocen por palabras muy estables:

| Si la descripción dice… | Código | Tasa |
|---|---|---|
| alquiler / arrendamiento de (maquinaria, equipo, volquete, retroexcavadora…) | 019 | 10% · **4% si es para obra de construcción** |
| transporte de bienes por vía terrestre | 027 | 4% |
| transporte de pasajeros | 028 | 10% |
| movimiento de carga | 029 | 10% |
| contrato de construcción | 030 | 4% |
| fabricación de bienes por encargo | 022 | 10% |
| mantenimiento / reparación de bienes muebles | 023 | 10% |
| «demás servicios gravados» (el cajón de sastre) | 037 | 12% |

⚠️ **La regla del 4% que me enseñó tu contadora entra acá como CONTEXTO, no como
excepción.** Un alquiler cuyo cliente es la ejecutora de una obra va al 4%. El
sugeridor tiene que mirar dos cosas —la descripción **y** si el comprobante está
imputado a una obra— y proponer en consecuencia. Sin eso, sugeriría 10% en las
tres facturas de la retroexcavadora y estaría mal en dos.

**Dónde va la IA y dónde no:** las ocho familias de arriba se resuelven con
palabras clave y salen bien o no salen (y si no salen, no se sugiere nada). La
IA solo hace falta para el cajón del **037**, que es «todo lo demás gravado» y
no se puede reconocer por palabras. Propuesta: reglas primero, y la IA solo
cuando las reglas no deciden — enganchada a la llamada que **ya se dispara sola**
en Captura Mágica, nunca en un botón.

---

## 2. Escáner de incoherencias de facturas

### La lección que ordena el diseño

Mi primera pasada produjo **falsos positivos**: reporté como error el 019 con dos
tasas, y era correcto. **Una regla que grita cuando no debe se vuelve ruido y
nadie la mira otra vez.** Por eso el escáner se parte en dos niveles y solo el
primero puede decir «esto está mal».

### Nivel 1 — CONTRADICCIONES (la fila se desmiente a sí misma)

No hace falta criterio contable: es aritmética o una lista cerrada. Estas ya
están validadas contra producción.

| Regla | Casos hoy |
|---|---|
| `detraccion_monto ≠ amount × pct` | 3 (E001-347, E001-43, F001-000818) |
| Código que no matchea `^[0-9]{3}$` | 1 (E001-347, código `'03'`) |
| Detracción cargada en operación ≤ S/ 700 | 1 (F001-000818, S/ 54) |
| `pct` y `monto` presentes, código vacío | 6 |
| Suma de ítems ≠ total del comprobante | *(por medir)* |
| IGV declarado ≠ 18% del subtotal, sin ser exonerado | *(por medir)* |
| Comprobante > S/ 2.000 en soles sin bancarización | *(el dato ya existe)* |
| Fecha del comprobante posterior a hoy | *(por medir)* |
| Duplicado exacto: mismo RUC + serie + número | ya existe `dedupe-movs-contables.js` |

### Nivel 2 — REVISAR (puede estar bien, decide la contadora)

Nunca dice «error». Dice «mirá esto». Ejemplos: código y tasa que no son la
pareja típica del Anexo 3; detracción faltante en un servicio que suele
llevarla; un proveedor cuyo mismo servicio se cargó con dos códigos distintos.

**Cada hallazgo de nivel 2 tiene que poder marcarse «revisado y está bien», y no
volver a aparecer.** Sin eso, la lista se llena de cosas correctas y muere.

### La pantalla

Va **dentro de Movimientos Contables**, como una pestaña «Revisión», no como
pantalla nueva: es donde la contadora ya trabaja y donde se corrige. Cada
hallazgo lleva el enlace a su comprobante, y ahora que editar funciona
(commit `60a817f`) se arregla en el acto.

**Migración:** una sola, la **181**, para la tabla de descartes:
`revision_descartes(movimiento_id, regla, motivo, quien, cuando)`.

**Entrega mínima:** las 4 reglas ya validadas + la pestaña + descartar. Sin IA,
sin endpoint nuevo. Se entrega sola y ya sirve.

---

## 3. Recomendador de activos fijos

### El criterio es tuyo, y es mejor que el umbral

> «Podría o bien revenderse, o ser parte de uso de la empresa para transformarla
> en otro insumo (planchas metálicas por ejemplo a láminas más pequeñas). Las
> máquinas suelen ser activos sí.»

Eso no es una regla de monto: es una clasificación **por destino del bien**.
Cuatro cajones, y el umbral de 1/4 UIT (S/ 1.375 con UIT 2026 a S/ 5.500,
**a confirmar con la contadora**) es solo un dato más, no el criterio:

1. **Activo de uso** — la empresa lo usa y dura más de un ejercicio (máquinas).
2. **Mercadería para reventa** — se compró para vender (el cemento de GASOMI).
3. **Insumo que se transforma** — entra de una forma y sale de otra (tus planchas).
4. **Gasto general** — se consume (thinner, copias, alojamiento).

### Por qué el umbral solo no sirve, medido

De las 2.440 líneas, **27 pasan el umbral**. Pero **once no son bienes**:
arriba de todo salen dos anticipos de cliente (S/ 127 mil entre los dos) y una
«limpieza y acondicionamiento de local». Y del otro lado, **JARVEX no tiene ni
una línea sobre el umbral** — o sea que tus generadores KAILI, que es el caso
que pediste, no aparecerían.

La regla que sí funciona (corrida contra producción, filtrando JARVEX):
`precio unitario ≥ S/ 300` **y** (`tipo_insumo` ∈ {maquinaria, herramienta,
equipo} **o** la descripción pega en el mapa de palabras) → **devuelve 5 filas:
los 3 KAILI y los 2 martillos. Cero ruido.**

### Cómo se ve

Panel dentro de **Activos Fijos (formato 7.1)**, que ya existe. Lista de
candidatos con: qué es, qué factura lo trajo, cuánto costó por unidad, y el
cajón sugerido. La contadora acepta, cambia de cajón, o descarta.

🔴 **Nada se consolida sin que ella lo acepte** — condición explícita tuya.

**Dos avisos que la pantalla debe dar y que hoy nadie da:**
- **Doble conteo:** si el bien ya está cargado como costo de una obra y se
  activa, los mismos soles se cuentan dos veces. Es el caso de los KAILI:
  S/ 5.497 ya imputados a Miraflores.
- **No duplicar contra Equipos Pesados:** enlazar por nombre normalizado y
  escribir `activo_pesado_id`, o el botón «Traer de Equipos Pesados» los ofrece
  otra vez.

**Migración 182:** `activos_fijos.accounting_item_idx` + índice (una factura
puede traer dos activos), y `revision_descartes` se reusa para los descartados.

**IA:** no en la primera entrega. El cajón se propone con `tipo_insumo` (que
está en las 2.440 líneas) + palabras clave + el umbral. La IA entra después,
solo para los casos que las reglas no deciden, y colgada de la llamada que ya
corre sola.

---

## 4. 🔴 El rediseño de órdenes — y el problema que hay que resolver antes

### Lo que pidió la jefa de contabilidad, y tiene razón

> «Solamente se puede generar una orden de compra y servicio en base a su
> respaldo, lo cual está mal.»

Correcto. Hoy la única puerta es la pestaña «Sin respaldo»: se parte de una
factura que ya existe y se le fabrica la orden hacia atrás. Eso sirve para
regularizar el pasado y **no sirve para trabajar**. Una orden real nace **antes**
del comprobante.

### El mecanismo que describió Gabriel, contra los datos reales

Su ejemplo: la obra necesita ~1.200 bolsas de cemento; GASOMI acumuló 700; se
emite la orden por esas 700 y a GASOMI se le descuentan del inventario.

**Lo medí, y el mecanismo existe — pero los números son otros:**

| | |
|---|---:|
| **Miraflores NECESITA** (CEMENTO PORTLAND TIPO I 42.5 kg, código `210020001`, en **191 partidas**) | **11.269 bolsas** |
| Ya comprado por la ejecutora (CONSORCIO EL INCA) | 2.250 |
| En manos de GASOMI | 318 |
| En manos de JHEENSEG | 42 |

Tu ejemplo se quedó corto por un factor de diez. Y el acero: la obra necesita
**29.856 kg** de ACERO CORRUGADO fy=4200 (código `30020002`) en 33 partidas.

### ~~🔴 EL HALLAZGO QUE BLOQUEA~~ — RESUELTO el 6-sep: **modelo B**

> ⚠️ Lo que sigue se escribió antes de que Gabriel decidiera. **Ya no bloquea**:
> vincular una compra a una obra es trazabilidad, no imputación de costo — el
> costo entra recién con la venta a la ejecutora. Se deja el análisis porque la
> consecuencia sigue viva: **todo reporte que hoy sume costo de obra a partir de
> `obra_id` está sumando compras que todavía no son costo**, y eso hay que
> revisarlo en la entrega 6. Ver el apartado 7.

### El planteo original: las 318 bolsas de GASOMI y el doble conteo

Las tres compras de cemento de GASOMI están cargadas con `obra_id = Miraflores`.
O sea que **el costo ya entró a la obra en el momento de la compra**.

Si ahora GASOMI le factura esas mismas 318 bolsas al CONSORCIO EL INCA, **la obra
las paga dos veces**: una como costo de la compra de GASOMI imputada a la obra, y
otra como la factura de venta de GASOMI a la ejecutora. Es exactamente el mismo
problema que los generadores KAILI.

**Esto no es un bug: son dos modelos contables distintos que hoy conviven sin
que nadie los haya separado.**

| Modelo | Qué significa | Cómo se ve hoy |
|---|---|---|
| **A — compra por cuenta de la obra** | La empresa del grupo compra YA imputado a la obra. No hay inventario propio ni venta posterior. | 756 líneas (31%) |
| **B — compra a stock, después vende** | La empresa compra para sí, acumula, y después le vende a la obra. Es el modelo de tu ejemplo. | 1.684 líneas (69%) |

**El 69% de las compras está en el modelo B y sirve para lo que quieres.** El
cemento de GASOMI, justo, cayó en el A.

**Primera decisión, y es tuya con la contadora:** cuando una empresa del grupo
compra para una obra, ¿imputa al comprar (A) o compra a stock y factura después
(B)? El rediseño puede soportar los dos, pero **cada compra tiene que declarar en
cuál está**, y las que ya están en A **no pueden venderse otra vez**.

### El otro obstáculo: casar oferta con demanda

El presupuesto y las facturas no hablan el mismo idioma:

- **Unidad:** el presupuesto pide acero en **kg**; GASOMI compró **varillas** de
  3/8, 1/2 y 5/8 en unidades. Convertir exige una tabla de peso por calibre y
  largo (una varilla de 1/2" × 9 m ≈ 8,9 kg). Para cemento sí casa directo,
  aunque escrito «und», «BOLSA» y «bol» según la factura.
- **Nombre:** el fierro de 1/2 aparece con **cuatro descripciones distintas** en
  GASOMI («VARILLA DE ACERO CORRUGADO DE 1/2», «FIERRO CORRUGADO 1/2' NTP
  341.031 SIDERPERU», «VARILLA DE FIERRO DE 1/2"», «FIERRO 1/2" X 9MTS ACEROS
  AREQUIPA»). Suman 1.148 varillas y ningún agrupamiento por texto las une.

**La solución ya está en la base:** los **434 `insumo_codigo`** del presupuesto
son el catálogo canónico. Cada línea de factura se mapea a uno de esos códigos
(con su factor de conversión), y ahí recién se puede sumar. Ese mapeo —434
insumos, 382 materiales— es el trabajo de verdad de esta tanda, y es **donde la
IA sí rinde**: proponer «esta línea es el insumo `210020001`» sobre un catálogo
cerrado es una tarea acotada y verificable, muy distinta de inventar.

### Cómo quedaría

**Pantalla nueva: «Abastecimiento de la obra»**, dentro del trabajo. Una tabla
por insumo canónico:

```
Insumo                         Necesita   Ya comprado   Disponible en el grupo   Falta
CEMENTO PORTLAND TIPO I         11.269       2.250       318 GASOMI · 42 JHEENSEG   8.659
ACERO CORRUGADO fy=4200 (kg)    29.856           0       10.708 GASOMI (≈1.148 var) 19.148
```

Desde ahí se selecciona qué se le compra a quién y se genera **la orden**, que
nace antes del comprobante y después se va completando: comprobante →
bancarización si pasa S/ 2.000 → detracción → guía de remisión. **Progresivo, no
un requisito de golpe** — como aclaraste.

Y del lado de la empresa vendedora, esas unidades salen de su stock disponible.

---

## 5. El orden que propongo

| # | Entrega | Estado | Por qué en ese orden |
|---|---|---|---|
| 1 | **Escáner, nivel 1** | ✅ staging (`f0c987b`) | 4 reglas ya validadas, cero criterio contable, valor inmediato |
| 2 | **Recomendador de activos** | ✅ staging (`f27a6c0`) | Responde tu pedido con nombre propio; nada de lo que escribe es irreversible |
| 3 | **Sugeridor de código SPOT** | ✅ staging (`5f95250`) | Se cuelga del escáner; las 8 familias por reglas |
| 4 | **Decisión modelo A vs B** | ✅ **modelo B**, decidido por Gabriel el 6-sep | No era código. Ver apartado 7 |
| 5 | **Mapeo insumo → código canónico** | ✅ staging, mig 183 | El trabajo de fondo. Ver apartado 8 |
| 5b | **Los 3 bloqueantes de la tanda 5** | ⏳ pendiente | Ver apartado 9. Bloquean la 6 |
| 6 | **Abastecimiento + órdenes que nacen antes** | ⏳ pendiente | El rediseño de verdad |

**Arrancaría por la 1 y la 2 en paralelo**: son las dos que no dependen de
ninguna decisión y las dos que ya tienen los datos.

---

## 6. Modelo, effort y sesión

| Entrega | Modelo | Effort | Sesión nueva |
|---|---|---|---|
| **1 — Escáner nivel 1** (mig 181, lib pura + tests, pestaña, descartar) | **Opus 5** | medio | No. Cabe con la 2 |
| **2 — Recomendador de activos** (mig 182, lib + tests, panel, enlace con Equipos Pesados) | **Opus 5** | medio-alto | **Sí.** Hay que tener a la vista `jx-activos-fijos.jsx`, `activos-fijos.js` y el patrón de escritura sobre `items_factura[idx]` |
| **3 — Sugeridor SPOT** (reglas + contexto de obra) | Sonnet 5 | medio | No. Va con la 1 |
| **4 — Decisión A vs B** | — | — | **No es de un modelo.** Tuya con la contadora |
| ~~5 — Mapeo al catálogo canónico~~ **HECHO** (Opus 5, effort alto) | — | — | Salió sin IA: medido, hoy no rinde (apartado 8) |
| **5b — Los 3 bloqueantes de la tanda 5** | Sonnet 5 | medio | **No.** Tanda chica: están localizados y medidos (apartado 9) |
| **6 — Abastecimiento y órdenes** | **Opus 5** | **alto** | **Sí, y sola.** Produce correlativos irreversibles y toca contabilidad viva |

**Nota sobre la 6:** antes de emitir un solo número hay que cerrar los tres
bloqueantes de la tanda 5, que ahora están **especificados y medidos** en el
apartado 9, y destrabar el permiso de la contadora, que hoy **no puede subir
órdenes** porque «Órdenes de Compra» no está en su matriz.

---

## 7. Lo que no sabía — RESUELTO el 6-sep con Gabriel

**1. La UIT 2026 = S/ 5.500.** Decreto Supremo 301-2025-EF; subió S/ 150 desde
los 5.350 de 2025. El valor que estaba puesto como supuesto era el correcto, así
que **ninguna propuesta del recomendador cambia**.

Y hay que decir algo más, porque Gabriel preguntó por qué esto importaba tanto:
**para su caso, importa poco.** El umbral de 1/4 de UIT (S/ 1.375) solo decide si
un bien barato **puede** mandarse a gasto en vez de activarse; es una facultad,
no una obligación, y no dice qué es la cosa. Ya estaba medido que por sí solo no
sirve: de las 2.440 líneas, 27 pasan el umbral y once no son bienes, y JARVEX no
tiene ni una línea por encima —los generadores KAILI, que es el caso que él
pidió con nombre propio, no aparecerían nunca. Por eso el recomendador clasifica
**por destino del bien** y el monto es un dato más. Lo único que el umbral
cambia de verdad es el aviso «este bien es tan barato que podés mandarlo a gasto
directo». Nada más. Gabriel tenía razón en no verlo importante.

**2. Modelo B**, decidido por Gabriel:

> «Nosotros registramos y vinculamos algunas compras con la empresa; eso no
> quiere decir que directamente se le cargue a la obra. Para que pase eso tiene
> que haber una venta de la empresa que compra hacia el Consorcio.»

O sea: **vincular una compra a una obra no la carga a la contabilidad de la
obra.** El costo entra a la obra recién con la venta de la empresa del grupo a
la ejecutora. Eso ordena todo lo que sigue y **desactiva el bloqueante rojo**
del apartado 4: las 318 bolsas de cemento de GASOMI **no se pagan dos veces**,
porque estar marcadas con `obra_id = Miraflores` es un vínculo de trazabilidad,
no una imputación de costo.

⚠️ **Pero deja una consecuencia que hay que mirar**: si el vínculo a obra no es
costo, entonces las 756 líneas «ya imputadas a una obra» tampoco lo son, y todo
reporte que hoy sume costo de obra a partir de `obra_id` está sumando compras
que todavía no son costo. Es lo primero que hay que revisar en la entrega 6.

**3. La tabla de conversión del acero** — Gabriel: *«esto se va a encargar de
completarlo la contadora, ella lo adecuará»*. Hecho así: la app propone el valor
de la norma (NTP 341.031 / ASTM A615) y **el factor es editable en cada fila**,
guardando de dónde salió. Ver el apartado 8.

**4. El presupuesto de Miraflores puede cambiar** — Gabriel: *«al inicio yo
coloqué un presupuesto, luego fue variando hasta el que ahora se tiene, y
entiendo que es el último. Pero tenga en cuenta que puede llegar a cambiar.»*
El diseño lo aguanta: el mapeo se guarda contra el **código** del insumo, no
contra la cantidad. Si mañana el presupuesto pide 15.000 bolsas en vez de
11.269, el mapeo sigue valiendo y solo se mueve el lado de la demanda. Lo que sí
rompe un cambio de presupuesto es que **desaparezca un código**: esos mapeos
quedarían apuntando a la nada y hay que revisarlos.

---

## 8. Entrega 5 — el mapeo al catálogo canónico: HECHO

**Está en staging**: pestaña **🎯 Mapeo al presupuesto** dentro de Análisis de
Insumos (Contabilidad → Análisis de Insumos), migración **183**, lib pura
`src/lib/mapeo-insumos.js` con 44 tests y la pestaña con 12 más.

### Lo primero que se midió, y que descartó el plan obvio

**No hay Pareto.** Las 2.440 líneas de compra son **1.852 descripciones
distintas** ya normalizadas, y las 100 más caras son apenas el **70%** del valor;
las 200, el 84%. No alcanza con mapear a mano las de arriba, y 1.852 a mano no
las mapea nadie. Tenía que haber motor.

Y el motor se topó con tres cosas que obligaron el diseño:

| Trampa | Qué pasa | Ejemplo real |
|---|---|---|
| **`unidad` no sirve** | Dice `UNIDAD` para bolsas, metros y kilos por igual | El cemento y el acero vienen los dos en «und» |
| **`tipo_insumo` miente** | Viene de la captura, no de la verdad | «LIMPIEZA Y ACONDICIONAMIENTO DE LOCAL» está tipada `material` |
| **El scorer que ya existía no alcanza** | `scoreNombres()` anula si los números difieren, y compara nombres de factura entre sí | El par correcto más caro de la base daba **0** |

Ese par correcto más caro es el que ordenó todo el diseño:

```
factura   «TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO»          2.470 und
catálogo  «TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435»  14.088,7 m
```

Comparten 200 y S25, difieren en 8, 6 y 4435, y «tubo» ni siquiera es prefijo de
«tuberia». Por eso el motor lee los números como **magnitudes con unidad** (no
como tokens), aplica sinónimos de obra, y sabe que **8" ≡ 200 mm en tubería
pero 8 mm ≠ 8" en acero corrugado** — la tabla de diámetro nominal es por
familia, porque una sola tabla se equivocaría siempre en una de las dos.

### Las dos decisiones que le dieron precisión

**La compuerta de familia.** Antes de puntuar se decide de qué familia es cada
lado y solo se compara dentro. Sin eso, «GUANTE DE ACERO ANTICORTE» y «PERFIL DE
ACERO ASTM A992» competían por el código del acero corrugado, y «POR EL SERVICIO
DE TRANSPORTE DE … CEMENTO DISOLVENTE» competía por el del cemento. Las tres
están en producción. Un servicio nunca mapea a un material.

**El puntaje es Dice ponderado por IDF**, no cobertura del catálogo. La primera
versión miraba el máximo de las dos coberturas y **se llevaba plata de verdad**:

| Descripción de la factura | Se llevaba | Importe |
|---|---|---:|
| CAJA Y MARCO Y TAPA PARA AGUA PVC | «AGUA» (código de una sola palabra), 77% | S/ 20.648 |
| ESCRITORIO DE MADERA 1.80 × 0.80 | «MADERA ROLLIZA … EUCALIPTO», 70% | S/ 10.169 |
| PNATON EN BOLSA X 900 GR | «YESO BOLSA 10 kg», 63% | S/ 6.864 |
| TINAS DE PLASTICO MEDIANAS | «PLASTICO DOBLE ANCHO», 73% | S/ 2.390 |

Los cuatro salieron del tramo confiable con tres correcciones medidas: puntaje
simétrico, el sustantivo cabeza vale doble **solo si es cabeza de los dos
lados**, y las palabras que el catálogo no conoce («pnaton», «escritorio»,
«tinas») pesan el **promedio** del catálogo en vez del mínimo — antes eran
gratis, y por eso una línea llena de palabras ajenas al presupuesto no pagaba
nada por serlo.

También se sacaron del juego los **47 códigos `equipo` (en hm) y los 5 de
`mano_obra` (en hh)**: comprar un vibrador no abastece horas de vibrador, y
proponerlo hacía que S/ 14.110 de una MAKITA se ofrecieran como si cubrieran el
alquiler presupuestado.

### Cómo queda, medido sobre las 1.852 descripciones

| | Descripciones | Importe | % |
|---|---:|---:|---:|
| **Con propuesta confiable** | 118 | S/ 232.982 | 12,9% |
| **Dudosas (decide la persona)** | 233 | S/ 319.125 | 17,6% |
| **Servicios** (no consumen insumos) | 130 | S/ 337.896 | 18,6% |
| **Sin candidato** | 1.371 | S/ 921.960 | 50,9% |

**Ese 50,9% no es una falla: es la respuesta correcta.** Se revisaron las 22 más
caras y son perfiles de acero ASTM A992, planchas, tubos inoxidables, laptops
LENOVO, niveles láser DEWALT y carretillas — el rubro metalmecánico propio de
GASOMI y herramientas de empresa, que el presupuesto de Miraflores no contempla.
Y hay un hallazgo dentro: se compraron **S/ 12.288 de tubería PVC de 12" (315
mm)** y **el presupuesto no tiene ningún código de 12"** — solo 6" y 8".

El motor tarda **0,6 s** para las 1.852 × 433 comparaciones, así que corre entero
en el navegador sin endpoint ni IA.

### Lo que sale del otro lado — oferta contra demanda, en unidades del presupuesto

Aceptando lo propuesto y lo dudoso (que es lo que haría alguien revisando de
arriba hacia abajo):

| Insumo del presupuesto | Necesita | Comprado | Cubre |
|---|---:|---:|---:|
| TUBERIA PVC UF S25 8" (200 mm) | 14.089 m | 14.820 m | 105% |
| ACERO CORRUGADO fy=4200 | 29.856 kg | 23.923 kg | 80% |
| CEMENTO PORTLAND TIPO I | 11.269 bol | 2.620 bol | 23% |
| MEDIDOR DE AGUA | 443 und | 449 und | 101% |

Las **2.620 bolsas** salen por un camino distinto al de la primera medición de
esta tanda (2.250 + 318 + 42 = 2.610) y dan lo mismo: el motor se valida solo.
Y el medidor de agua da 449 contra 443 necesarios, que es casi exacto.

Las filas absurdas —una válvula al 2.500%— son justamente las que caen en
«dudosas» y que una persona corrige. Para eso está la pantalla.

### Lo que la pantalla hace

- Se decide **por descripción, no por factura**: el mismo texto aparece en
  facturas de varias empresas y se decide una vez para todas, las de ayer y las
  que entren mañana.
- Ordenado **por plata**: decidir las primeras veinte filas ya mueve la aguja.
- **«No está en el presupuesto» también se guarda.** Es la respuesta correcta
  para la mitad del gasto, y sin recordarla esas 1.371 descripciones volverían a
  preguntarse en cada visita. Es la lección del escáner de facturas.
- **El factor de conversión es editable siempre**, y muestra de dónde salió:
  `norma` (NTP 341.031: 1/2" = 0,994 kg/m × 9 m = **8,946 kg**), `de la factura`
  (cuando la propia factura dice el largo), o `supuesto` en ámbar. Ningún
  `supuesto` se consolida solo.
- **Hereda de las correlaciones que Gabriel ya confirmó**: si en la pestaña 🤝 ya
  dijo que «VARILLA DE ACERO CORRUGADO DE 1/2» y «FIERRO CORRUGADO 1/2' NTP
  341.031 SIDERPERU» son el mismo insumo, mapear una mapea las dos.
- Y arriba, **el avance en plata**: qué % del gasto ya está traducido.

### Por qué NO se enganchó la IA todavía

El plan decía que la IA entraba acá. Medido, hoy no rinde: la IA solo puede
elegir entre los 381 códigos de material, y la cola sin candidato está dominada
por cosas que **no tienen código**. Serían ~1.371 llamadas para que conteste
«no está en el presupuesto» 1.300 veces, con el saldo de Anthropic que ya se
agotó una vez y no tiene recarga automática. El enganche está listo —
`insumo_mapeo.fuente` ya acepta `'ia'` y pisa a la regla — y conviene prenderlo
**cuando entre una segunda obra con su propio presupuesto**, porque ahí la cola
se achica y la IA sí tendría dónde acertar.

### Un bug que apareció escribiendo los tests

`cantidadCanonica(10, null)` devolvía **0** en vez de `null`, porque
`Number(null)` es 0. Una línea sin factor habría dicho «de este insumo no hay
nada» cuando la verdad es «no sabemos cuánto hay» — y eso hace comprar de más.
Corregido y con test.

---

## 9. Los tres bloqueantes de la tanda 5, especificados y medidos

Son los que hay que cerrar **antes** de la entrega 6, porque la 6 emite
correlativos irreversibles y toca contabilidad viva.

### 🔴 B-1 — El tipo de orden se decide por el TEXTO, y el texto suele ser el proveedor

`tipoSugerido()` en `src/lib/ordenes.js:308` arma su decisión con
`clase + category + description` y busca palabras como *transporte*, *servicio*,
*alquiler*. Pero `description` muy seguido **es el nombre del proveedor**, así
que una compra de materiales a «TRANSPORTES … S.A.C.» sale como Orden de
**Servicio**.

**Medido sobre los 204 comprobantes en soles por encima de S/ 2.000:** 50
saldrían tipados como servicio, y **11 de esos traen bienes de verdad en sus
ítems** (`tipo_insumo` material / herramienta / EPP / maquinaria). Son 11
documentos formales emitidos con el rótulo equivocado, en la serie equivocada.

**Cómo se arregla:** mirar los ÍTEMS, que ya están y son la verdad —si el
comprobante trae bienes es compra— y usar el texto solo cuando no hay ítems.
Chico y con test.

### 🔴 B-2 — El IGV se asume 18% siempre, salvo recibo por honorarios

`borradorDesdeMovimiento()` (`ordenes.js:322`) pone `igvPct = 0` únicamente si
`document_type === 'recibo_honorarios'`. **Y no hay ni uno solo sobre S/ 2.000**,
o sea que la única salida implementada nunca se usa.

**Medido sobre los 123 comprobantes con ítems por encima de S/ 2.000:**

- **117** son coherentes con IGV 18% — la suposición funciona.
- **3** tienen los ítems iguales al total: son **operaciones sin IGV**
  (exoneradas o inafectas). La orden les inventa un IGV que no existe y
  **subvalúa el valor de venta en 15,25%**.
- **3** no cierran con ninguna de las dos hipótesis: hay otra cosa mal ahí y
  conviene mirarlas de a una antes de emitir.

**Cómo se arregla:** cuando el comprobante trae ítems, la suma de los ítems
manda sobre la suposición, y el IGV sale de la diferencia. Cuando no los trae,
que la contadora pueda poner el % en la grilla (el campo ya existe).

### 🔴 B-3 — El correlativo se reparte por MONTO, no por fecha

`comprobantesSinOrden()` (`ordenes.js:235`) devuelve la lista ordenada
`por amount descendente`, y el lote de emisión (`jx-ordenes.jsx:232`) va pidiendo
`proximoCodigo()` en ese mismo orden. **Resultado: la OC-001 se la lleva el
comprobante más caro, no el más antiguo**, y el libro de órdenes queda con la
numeración saltando en el tiempo. No es «al revés del tiempo»: es que no tiene
ninguna relación con el tiempo.

El correlativo en sí está bien resuelto —toma el máximo, así que una orden
anulada no libera su número, que es lo correcto—; lo que está mal es **el orden
en que se recorre el lote**.

**Cómo se arregla:** ordenar por `fecha` ascendente al momento de emitir
(y dejar el orden por monto solo para MIRAR la lista, que es donde sirve).
Una línea, más su test.

**Los tres juntos:** Sonnet 5, effort medio, una tanda chica. No hace falta
sesión nueva ni Opus: están localizados, medidos y las tres correcciones son de
pocas líneas en una lib que ya tiene 43 tests.

**Y falta uno que no es código:** la contadora **no puede subir órdenes** porque
«Órdenes de Compra» no está en su matriz de permisos. Eso lo destraba Gabriel en
Admin → Permisos, y sin eso la entrega 6 no la puede usar quien tiene que usarla.
