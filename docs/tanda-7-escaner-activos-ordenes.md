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

### 🔴 EL HALLAZGO QUE BLOQUEA: las 318 bolsas de GASOMI **ya son costo de Miraflores**

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

| # | Entrega | Depende de | Por qué en ese orden |
|---|---|---|---|
| 1 | **Escáner, nivel 1** | nada | 4 reglas ya validadas, cero criterio contable, valor inmediato |
| 2 | **Recomendador de activos** | nada | Responde tu pedido con nombre propio; nada de lo que escribe es irreversible |
| 3 | **Sugeridor de código SPOT** | 1 | Se cuelga del escáner; las 8 familias por reglas |
| 4 | **Decisión modelo A vs B** | — | **No es código.** Tuya con la contadora. Bloquea la 5 |
| 5 | **Mapeo insumo → código canónico** | 4 | El trabajo de fondo. Sin esto no hay abastecimiento |
| 6 | **Abastecimiento + órdenes que nacen antes** | 5 | El rediseño de verdad |

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
| **5 — Mapeo al catálogo canónico** (434 insumos, conversión de unidades) | **Opus 5** | **alto** | **Sí, y sola.** Es donde se decide si todo lo demás funciona. Incluye la IA de mapeo con revisión humana |
| **6 — Abastecimiento y órdenes** | **Opus 5** | **alto** | **Sí, y sola.** Produce correlativos irreversibles y toca contabilidad viva |

**Nota sobre la 6:** antes de emitir un solo número hay que cerrar los tres
bloqueantes de la tanda 5 que ya están identificados (el tipo se clasifica por
el nombre del proveedor, el IGV 0 no se detecta, y el correlativo corre al revés
del tiempo), y el permiso de la contadora, que hoy **no puede subir órdenes**
porque «Órdenes de Compra» no está en su matriz.

---

## 7. Lo que no sé

1. **La UIT 2026.** Todo el umbral cuelga de eso.
2. **Modelo A o B**, o cuál en qué caso.
3. **La tabla de conversión del acero** (kg por varilla y calibre): hay valores
   estándar, pero los confirma la obra.
4. **Si el presupuesto de Miraflores está vigente.** `cantidad_real_usada` está
   en **0,00 en las 6.722 filas**: nadie registró consumo contra las partidas,
   así que «lo que falta» hoy es presupuesto, no presupuesto menos consumido.
