# Plan de prueba — las 7 tandas del 15-set-2026

> Para **Gabriel**, antes de promover `staging` → `main`.
> Preview: https://jarvex-app-git-staging-znova15s-projects.vercel.app
> Commits: `d7f2e63` (tandas 1 y 2) · `a8f4b3e` (3) · `8f6b092` (4) · `e852291` (5, mig 214)
> · `cbe1c34` (6) · `687733e` (7, mig 216).

---

## ⚠️ Antes de empezar — leer esto

1. **El preview escribe en la base REAL.** No hay branch de Supabase: lo que
   guardes en staging queda en producción. Probar lecturas y navegación, sin
   miedo; **lo que cree datos** (unir insumos, marcar destino, registrar una
   transformación) queda — y donde se pueda deshacer, está dicho en cada paso.
2. **Ctrl+Shift+R al abrir el preview** (o cerrar y reabrir la app instalada).
   La PWA queda cacheada y media prueba se pierde mirando la versión vieja.
3. **Si algo no cuadra, anotá el número que viste.** Todos los pasos de abajo
   traen el número que tiene que salir, medido contra producción el 15-set.
4. Las 7 tandas se prueban en **~40 minutos**. El orden de abajo es el que menos
   te hace saltar de pantalla.

---

## Tanda 1 — La factura anulada sale del inventario

**Qué cambió:** una factura cubierta al 100% por su nota de crédito ya no aporta
mercadería al inventario. Hasta ahora sí lo hacía: el único flag que sacaba una
línea era `payment_status='cancelled'`, y en toda la base hay **cero** movimientos
con ese flag.

**Dónde:** Empresas → **GASOMI** → Abrir desglose → **Compras e inventario**.

**Pasos y qué tiene que pasar:**

| # | Qué hacer | Qué tiene que salir |
|---|---|---|
| 1.1 | Mirar el cartel ámbar arriba de la lista | Dice cuántas facturas quedaron anuladas y cuántas líneas salieron. **En toda la base son 21 facturas / 86 líneas**: 32 líneas en GASOMI, 20 en JARVEX, 17 en NAMORA, 11 en SALAZAR CERQUIN |
| 1.2 | Botón **«N con NC parcial»** en la barra de filtros | Filtra los insumos de una factura rebajada en parte. **En toda la base hay UNA sola**: GASOMI **E001-275** (venta de S/ 38.500 a CONSORCIO CHUSAAC, con nota de S/ 690) y sus **5 ítems** — las brochas TEKNO y el rodillo EPOXY |
| 1.3 | Mirar la fila de esos 5 ítems | Llevan la chapita ámbar **«NC parcial»** |

**Sería un fallo:** que el cartel no aparezca en GASOMI, que el botón de NC parcial
devuelva 0, o que una factura anulada siga sumando cantidades.

**Ojo que NO es un fallo:** que la factura siga apareciendo en Movimientos
Contables. Anular no es borrar — sigue ahí y sigue sumando en los reportes
contables; lo que dejó de hacer es aportar mercadería.

---

## Tanda 2 — La unidad entra a decidir

**Qué cambió:** correlacionar insumos comparaba solo el texto. Las 3.517 líneas de
factura traen unidad (ninguna vacía, escrita de 37 formas distintas) y esa señal
no se miraba. Medido sobre los 160 pares ya decididos a mano: **trece** «mismo
insumo» se facturan en unidades incompatibles.

**Dónde:** Análisis de insumos → **Correlaciones**.

| # | Qué hacer | Qué tiene que salir |
|---|---|---|
| 2.1 | Mirar cualquier sugerencia | La **unidad** aparece al lado de cada nombre |
| 2.2 | Buscar un par con unidades distintas (ej. **ALAMBRE DE AMARRE 16** en *und* vs **ALAMBRE NEGRO 16** en *kg*; el tubo HDPE 110mm en *m* y en *und*; botas por *par* y por *und*; tarugos por *docena* y por *und*) | Aviso **en ámbar** diciendo que las unidades no coinciden |
| 2.3 | Ver en qué banda cayó ese par | **NO** puede estar en la banda «obvio» (la que no se pregunta), aunque el texto coincida al 100% |
| 2.4 | Pedirle la sugerencia a la **IA** | En el razonamiento tiene que mencionar la diferencia de unidades. Ese aviso **lo arma el servidor**, no el modelo: va siempre |

**Sería un fallo:** que un par con unidades incompatibles se proponga solo, sin
preguntar.

---

## Tanda 3 — El arbitraje deja de ser un insumo

**Qué cambió:** hay descripciones que no son ni un insumo ni un servicio de
construcción — arbitrajes, seguros, SCTR, detracciones, penalidades, intereses,
gastos administrativos. Ahora hay una tercera pestaña y una tercera respuesta.

**El caso con nombre propio:** «GASTOS ADMINISTRATIVOS DEL CENTRO DEL PROCESO
ARBITRAL SEGUIDO ENTRE EL CONSORCIO SANTA Y LA MUNICIPALIDAD DISTRITAL DE NUEVO
CHIMBOTE…», en **GASOMI**, facturas **E001-209 y E001-210** (7-feb-2024,
S/ 8.260 cada una, ítem de S/ 7.000).

| # | Qué hacer | Qué tiene que salir |
|---|---|---|
| 3.1 | Análisis de insumos → buscar **«arbitral»** | Aparece, y en la pestaña **«❔ Ni uno ni otro»** — no mezclado entre los insumos |
| 3.2 | Usar **«🚫 No va al inventario»** sobre esa descripción | Desaparece de las sugerencias de los dos lados |
| 3.3 | Volver a GASOMI → Compras e inventario | Sale el cartel gris de **«No va al inventario»** con cuántas descripciones y líneas quedaron afuera, y el arbitraje ya no ocupa fila |
| 3.4 | **Deshacer**: en ese mismo cartel, «Ver y deshacer» → ↺ Devolver | Vuelve a contar. *(Hacelo si no querés dejarlo marcado: escribe en la base real.)* |
| 3.5 | Verificar que no se pasó de listo: buscar **«BOTAS DE SEGURIDAD»** | Siguen siendo un insumo. La palabra «seguridad» no las convierte en un seguro |

**Sería un fallo:** que un EPP, un kit de mantenimiento o un alquiler de equipo
caigan en «ni uno ni otro».

---

## Tanda 4 — Una sola lista de candidatos

**Qué cambió:** había dos listas que salían de la misma función, y ninguna
excluía a la otra: un par A-B que era parte del grupo {A,B,C} aparecía **arriba**
dentro del grupo y **abajo** otra vez suelto. Peor: el recorrido con IA preguntaba
dos veces por el mismo par y lo pagaba dos veces.

**Dónde:** Análisis de insumos → Correlaciones.

| # | Qué hacer | Qué tiene que salir |
|---|---|---|
| 4.1 | Abrir un grupo propuesto de 3 o más nombres y buscar sus pares abajo | **No** tienen que estar repetidos sueltos |
| 4.2 | Un par donde uno de los dos está en un grupo y el otro quedó suelto | **SÍ** se sigue listando: es una pregunta que nadie contestó, y esconderla perdería esa variante |
| 4.3 | Correr el **recorrido con IA** y mirar cuántas preguntas hace | Una por candidato, no dos |

**Sería un fallo:** ver el mismo par dos veces en la pantalla.

---

## Tanda 5 — Los guantes en par y en und, en una sola fila (mig 214)

**Qué cambió:** tu caso — «encontré un par de guantes en unidades y el otro en
par, que resulta que sí son lo mismo». Unirlos era correcto; lo que faltaba era
poder **sumarlos**. Sin factor, el inventario deja «20 par» y «15 und» en dos
filas que nadie puede restar, y el comparador de precios de ese insumo se apaga.

| # | Qué hacer | Qué tiene que salir |
|---|---|---|
| 5.1 | Correlaciones → unir dos presentaciones del mismo insumo | Al unir, aparece el pedido del **factor**: cuántas unidades base entran en 1 de la otra |
| 5.2 | Probar un factor **aritmético** (docena → und) | Lo propone solo: 12 |
| 5.3 | Probar uno que **depende del insumo** (par → und, kg por rollo de alambre) | Lo deja **VACÍO** a propósito. Un número inventado ahí se aceptaría sin mirar |
| 5.4 | Elegir **«unir sin factor»** | Es una salida legítima, no un castigo: se comporta como siempre (dos filas) |
| 5.5 | Pestaña **«Decisiones tomadas»** → buscar los pares con unidades que no coinciden | Traen el botón **«📏 Poner factor»**. Son **13** los pares así sobre los 160 ya decididos — se unieron antes de que el factor existiera |
| 5.6 | Poner el factor y volver al inventario de la empresa | **UNA sola fila** con las cantidades sumadas y la chapita **«📏 convertido»** |

**Sería un fallo:** que una línea en una unidad que no es la declarada se
convierta igual (multiplicar por doce algo que ya venía en unidades es fabricar
stock), o que aparezca un factor propuesto para algo que depende del insumo.

---

## Tanda 6 — Qué va a pasar con cada insumo (el hecho y la decisión)

**Qué cambió:** el inventario por empresa trataba todo como mercadería. Un
generador KAILI y una bolsa de cemento salían en la misma tabla, con la misma
columna «Saldo», como si los dos estuvieran esperando comprador.

**Dónde:** Empresas → **JARVEX** → Compras e inventario (ahí están los 3
generadores KAILI y los 2 martillos demoledores; en **GASOMI** están la amoladora
DEWALT, el nivel láser, la sierra circular y el vibrador de concreto).

| # | Qué hacer | Qué tiene que salir |
|---|---|---|
| 6.1 | Buscar **GENERADOR** en JARVEX | La fila lleva la chapita azul **«🏗 activo fijo (1)»**. Es un **hecho**: hay una fila en el registro 7.1 apuntando a esa línea de esa factura |
| 6.2 | Filtro **«Todo destino»** → «🏗 En el registro 7.1» | Muestra de un tirón los insumos que ya están cargados como activo fijo. En toda la base hay **12 activos** y los 12 tienen su factura |
| 6.3 | En una fila, usar el desplegable **«— destino —»** | Cuatro opciones: 🧱 Se consume · 🏗 Uso de la empresa · 🏷 Para revender · 🔁 Se transforma |
| 6.4 | Marcar un insumo como **🏗 Uso de la empresa** | Su columna Saldo deja de significar «lo que queda por colocar» y **sale del botón rojo** de stock negativo |
| 6.5 | Marcarlo en **una** de sus variantes de nombre y mirar las otras | La decisión vale para **todo el grupo**: es una política sobre el insumo, no sobre una factura |
| 6.6 | Volver a poner **«— destino —»** (vacío) | Se deshace. *(Conviene dejarlo como estaba si solo estabas probando.)* |

**Sería un fallo:** que el badge 🏗 aparezca sobre un insumo que no está en el
7.1, o que marcar el destino en una fila no se vea en sus variantes.

---

## Tanda 7 — Lo que entra de una forma y sale de otra (mig 216)

**Qué cambió:** el cajón «🔁 Se transforma» ya significa algo. Se puede registrar
que entraron 6 planchas y salieron 24 láminas, y el saldo vuelve a cerrar.

**El caso real para probar** (compra de verdad, medida en producción):
GASOMI compró **21 planchas LAF 1/16** por **S/ 2.485,35** (factura F004-33864,
24-jun) y pagó **S/ 133,47** de **CORTE GUILLOTINA** (factura FE01-1006, 15-jul).

**Dónde:** Empresas → **GASOMI** → Compras e inventario.

| # | Qué hacer | Qué tiene que salir |
|---|---|---|
| 7.1 | Buscar **PLANCHA LAF** y tocar **«🔁 Transformar»** en esa fila | El modal abre con la plancha ya puesta como entrada, y debajo «hay N und · costo ≈ S/ 118,35/und» |
| 7.2 | Poner cantidad **6** | El valor se completa solo: **S/ 710,10** (6 × 118,35). Si lo escribís a mano, no se pisa |
| 7.3 | Agregar un **costo de transformar**: «CORTE GUILLOTINA», **133,47** | La franja de abajo pasa a **S/ 843,57** |
| 7.4 | Poner la salida: **LAMINA 30X30**, cantidad **24**, und | La franja se pone **verde**: «710,10 + 133,47 = 843,57 → sale 843,57 ✓ cierra», y el botón se habilita |
| 7.5 | **Probar que no se puede mentir**: cambiar el reparto a «A mano» y poner 4.000 | Se pone **roja** y dice **«sobran S/ 3.156,43»**. El botón queda **apagado** |
| 7.6 | Probar dos salidas en **unidades distintas** (24 und + 3 kg) con reparto «Por cantidad» | Lo **rechaza** y explica por qué: repartir entre kg y und sería sumar dos magnitudes distintas. Ofrece «A mano» o «Por valor de venta» |
| 7.7 | Poner una entrada que **no existe** en el inventario, o una cantidad **mayor** a la que hay | Sale un aviso **ámbar** que **NO bloquea** (un saldo corto tiene tres causas reales: la compra está en otra empresa, escrita con otro nombre, o sin cargar) |
| 7.8 | Volver al caso bueno y **Registrar transformación** | Se abre la lista de transformaciones con la fila nueva |
| 7.9 | Mirar la fila de **PLANCHA LAF** | Saldo **15 und** (21 − 6), chapita **«🔁 transformado (1)»**, y debajo del saldo «−6 und transf.» |
| 7.10 | Buscar **LAMINA 30X30** | Aparece como **fila propia** aunque no tenga ninguna factura: chapita **«sin factura propia»**, saldo 24 und, chapita **«✨ producido (1)»**, y su costo es **S/ 843,57** — la plancha **más** el corte |
| 7.11 | **Anular** la transformación desde la lista | La plancha vuelve a **21 und**, la lámina desaparece del inventario, y la transformación se sigue viendo **tachada** |
| 7.12 | **Restablecerla** (si era una transformación real) o **dejarla anulada** (si era solo la prueba) | — |

**⚠️ Este paso escribe en la base real.** Si el corte de esas 6 planchas no pasó
de verdad, dejá la transformación **anulada** al final: deja de mover el saldo y
queda como rastro de la prueba.

**Sería un fallo:** que el botón deje guardar algo que no cierra, que la lámina
aparezca dos veces en el inventario, o que al anular el saldo no vuelva a 21.

---

## Lo que queda por decidir (no es una prueba)

**El doble alta del registro 7.1.** Dos bienes están cargados dos veces:
MARTILLO DEMOLEDOR SDS HEXAGONAL (FE01-617, S/ 584,75) y MARTILLO DEMOLEDOR TOTAL
1700KW (E001-1044, S/ 508,47) — cargados por Ruth el 7-set y otra vez por Miguel
el 9-set, apuntando a la misma línea de la misma factura. Son **S/ 1.093,22** de
adquisiciones que no existen y **S/ 218,64** de depreciación inflada en 2026.

El SQL está en `supabase/migrations/215_activos_fijos_sin_doble_alta.sql` y
**no se aplicó**: da de baja filas de un registro contable. Incluye el índice
UNIQUE que impide que vuelva a pasar — y ese índice **no se puede crear mientras
los duplicados sigan vivos**, así que mientras no se decida, el registro queda sin
protección.

Para verlo vos mismo: Contabilidad → **Activos Fijos (formato 7.1)** → empresa
JARVEX. Los dos martillos aparecen repetidos.

---

## Cuando todo esté probado

```bash
git checkout main && git merge --ff-only staging && git push origin main
git checkout staging
```

Migraciones: la **214** y la **216** ya están aplicadas en Supabase. La **215**
espera tu decisión. Después del deploy, **cerrar y reabrir la app** (o
Ctrl+Shift+R): la PWA queda cacheada y si no, vas a estar mirando la versión
vieja.
