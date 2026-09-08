# Tanda 15 — Licitaciones

> Contexto original de Gabriel (8-set-2026) + el análisis medido contra el
> repo y el orden de entregas que salió de ahí.

---

## 0. Lo que ya estaba construido (y el documento no sabía)

El bloque **Licitaciones** existe desde la tanda 2 y su propia descripción
prometía *«el plantel profesional y los trabajos a los que nos presentamos»*.
La primera mitad estaba hecha; la segunda no existía.

Ya en producción antes de esta tanda:

- `src/components/jx-profesionales.jsx` — ficha del profesional y pestaña
  **Buscar plantel**, que es el verificador de requisitos mínimos.
- `src/lib/experiencia-profesional.js` — `buscarPlantel()` /
  `evaluarRequisito()`, con las dos reglas duras: los periodos solapados no se
  suman dos veces y la experiencia sustentada se cuenta aparte.
- Migración 171 — ficha 1:1 contra `personal`, experiencia como periodos,
  rubros como catálogo.
- Rol `licitaciones` con allowlist, visibilidad de evidencias propia, área de
  navegación y bloque de primer nivel.

**Por eso la prioridad #1 del documento no era construir el verificador: era
darle un expediente.** Los requisitos se tipeaban de cero cada vez y se perdían
al cerrar la pestaña. Servía para una consulta suelta, no para trabajar.

## 1. Correcciones al documento de contexto

| Punto | Qué decía | Qué se midió |
|---|---|---|
| Vínculo con costos | «usa el mismo motor de estimación que ya existe para expediente técnico/reajuste» | **Ese motor no existe.** Hay `pdfBudgetParser.js` + `jx-importar.jsx` (importan presupuestos S10/Delphin de una obra ya ganada), valorizaciones y análisis de insumos — todo mirando hacia atrás. No es conectar, es construir. Fuera del alcance inicial. |
| Triage de OCR por página | correcto, pero no dice dónde corre | Tiene que correr **en el cliente**. `captura-magica.js` manda el PDF entero en base64 a una serverless: unas bases de 150–300 páginas no pasan por ahí. `pdfjs-dist` ya es dependencia y `pdfBudgetParser.js` ya extrae texto página por página. |
| Elección de modelo | primer punto a resolver | No bloquea nada. Cuando llegue, entra por `docs/ia-postproceso-openrouter.md` (ZDR) y **con snapshot fijo, nunca alias móvil** — `mistral-ocr-latest` se movió solo y duplicó el precio (por eso existe `lib/mistral-ocr.js`). |
| — | no figuraba | **El banco de profesionales está vacío.** El verificador contra un padrón vacío no sirve: todos los puestos salen en ⛔. La extracción de CVs sube al segundo lugar. |

## 2. Orden de entregas

| # | Entrega | Estado |
|---|---|---|
| 1 | **La postulación existe como dato** — tablas, pantalla, requisitos guardados por proceso, veredicto y paso a Trabajos | ✅ hecha |
| 2 | **El requisito como lo piden las bases** + **motor de triage** (mig 198) | ✅ hecha |
| 3 | **Herramienta de análisis de documentos** — pasadas de extracción sobre el markdown híbrido | ✅ hecha |
| 4 | **CV → ficha con IA** + **la postulación nace del documento** + el proceso entero (montos, CUI, calendario, consorcio, requisitos de empresa) | ✅ hecha |
| 5 | **Requisitos de empresa** — *evaluar* a las empresas del grupo contra lo que ya se extrae (falta cargar su experiencia) | pendiente |
| 6 | Calendario del proceso + kanban con documentos por etapa | pendiente |
| 7 | Oferta económica | módulo propio, no un vínculo |

> La herramienta de análisis es **separada de Captura Mágica**, por decisión de
> Gabriel (8-set-2026) y porque son problemas distintos: Captura Mágica lee un
> comprobante por vez; ésta lee 300 páginas y hace dos o tres pasadas.
> Comparten el motor de OCR y nada más.

---

## Entrega 1 — La postulación existe como dato

### Migración 197

Dos tablas. **`licitaciones`** (el proceso) y **`licitacion_requisitos`** (lo
que piden sus bases).

**Por qué tabla aparte y no una `obras` con `estado='postulando'`** — el mismo
criterio que la mig 174 usó para bienes y servicios:

- Una postulación no tiene partidas, cronograma de ejecución, almacén, personal
  asignado, valorizaciones ni un solo asiento contable.
- La mayoría **nunca** va a ser obra: se pierden. Meterlas en `obras` ensucia
  todos los selectores de obra y todos los filtros de contabilidad con procesos
  que no existieron.
- `obras` es titular de imputación de media app. Una fila que no puede recibir
  ningún movimiento no debe vivir ahí.

El enganche es `licitaciones.obra_id`, **nullable**, y se llena solo al ganar y
apretar el botón.

**Por qué `licitacion_requisitos` tiene la forma que tiene** — es, campo por
campo, el objeto que come `evaluarRequisito()`. No hay capa de traducción que
se pueda desincronizar: la fila que se guarda ES el requisito que se evalúa.

Campos que nacen vacíos a propósito: `fuente`, `fuente_pagina` y `fuente_cita`
los llena el escáner de bases (entrega 4), que tiene la regla de citar la
página de origen. `clase` acepta `'empresa'` desde ahora aunque solo se use
`'personal'`: los requisitos de empresa son la entrega 3 y no vale mover un
CHECK por eso.

**Etapas** — el kanban del documento más `desistido`. Ese estado no es un
adorno: *«no calificamos, no gastamos una semana en esto»* es la decisión que
todo el módulo existe para poder tomar, y hoy no queda registrada en ningún lado.

**RLS** — admin, gerencia y el rol `licitaciones`. RR.HH. queda afuera: ve la
ficha profesional (es dato de personal) pero a qué procesos se postula el grupo
es información comercial. El gate del sidebar (`__canSeeSidebarItem`) es espejo
exacto de esa lista, como ya se hace con `pagos` y `activos-fijos`.

### `src/lib/licitaciones.js`

No vuelve a evaluar a nadie — toda la evaluación sigue en
`experiencia-profesional.js`. Acá pasan dos cosas:

1. La traducción fila → requisito (mapeo tonto a propósito).
2. **El veredicto**: convertir la lista larga de `buscarPlantel()` en la única
   frase que hace falta antes de invertir una semana.

**La regla que define el veredicto:** un puesto con un candidato **ya elegido**
que no cumple es *peor* que un puesto todavía sin elegir. El segundo es trabajo
pendiente; el primero es el nombre que ya está escrito en el expediente y es
una observación segura en la evaluación. Por eso hay `califica` **y** `limpio`.

**Sin requisitos cargados no se califica.** `califica` es `false` con la lista
vacía: no saber no es lo mismo que estar bien, y ese matiz es la diferencia
entre desistir a tiempo y perder la semana.

29 tests en `src/lib/__tests__/licitaciones.test.js`.

### `src/components/jx-licitaciones.jsx`

La pantalla contesta una pregunta, no muestra una tabla. El veredicto va en la
tarjeta de la lista, **antes de abrir nada**.

- ✅ califica y los elegidos cumplen · ⚠️ hay a quién presentar pero un elegido
  está en falta · ⛔ falta gente para un puesto · ❓ sin requisitos cargados.
- En cada puesto: cuántos califican, **a quién le falta poco** (y cuántos meses)
  y el selector de a quién presentamos.

### El paso a Trabajos

Manual, con botón, como pedía el documento. Se habilita solo con la etapa en
*Buena pro*. **No se duplicó la creación de obras**: `jx-obra.jsx` ya la tiene
con su consorcio, su seed de ubicaciones y su auditoría. Postulaciones deja el
borrador en `window.__prefillObraDesdeLicitacion` y navega; `jx-obra.jsx` lo
consume (se borra al leerlo, para que volver a Obras mañana no reabra el
formulario solo), abre su form ya lleno y, al guardar, escribe de vuelta
`licitaciones.obra_id` — sin eso el botón quedaría disponible para siempre y se
podría crear la misma obra dos veces.

`ejecutora_tipo` **no** viaja en el borrador: empresa o consorcio no se deduce
de con qué RUC se postuló, y errarlo desarma la contabilidad de la obra entera.

---

## Entrega 2 — El requisito real, y el triage medido

### Lo que se midió en las bases de Chilete (8-set-2026)

Cuatro archivos reales: los Anexos 12 (ejecución) y 13 (supervisión) del
proceso del Gobierno Regional de Cajamarca, más dos publicaciones de El Peruano.

| | Texto nativo | Imágenes | Páginas a OCR |
|---|---|---|---|
| Anexo 12 — bases EP (ejecución) | 194.052 chars | 16 | **15** |
| Anexo 13 — bases EPS (supervisión) | 120.515 chars | 18 | **17** |
| El Peruano 021-2026 | 8.620 chars alfabéticos | — | **0** |
| El Peruano 022-2026 | 9.549 chars alfabéticos | — | **0** |

Las 32 imágenes son **páginas completas escaneadas: los Términos de Referencia**,
pegadas como bloque dentro de un Word que por lo demás es texto nativo. Decidir
el OCR a nivel de documento manda a OCR 314.000 caracteres perfectos (y les mete
errores) o deja sin leer los TDR, que es donde están los requisitos.

Costo: 32 páginas por proceso ≈ **USD 0,06**. Mandar los documentos enteros a un
modelo de visión cuesta 20–50× más y lee peor.

**El calendario con fechas reales es NATIVO** (Anexo N° 2, las 10 etapas del
17/08/2026 al 15/10/2026): se extrae sin OCR y sin IA.

**Los PDFs de El Peruano no necesitan OCR en absoluto.** Pero la convocatoria es
una nota entre resoluciones de COFOPRI, notificaciones de SUNAT y disoluciones
de empresas: ahí el problema no es leer, es **encontrar**. Es otro trabajo.

### El hallazgo que evita una heurística

Las páginas escaneadas están **rotadas 90°**, y el Word **declara la rotación**
en su propio XML (`<a:xfrm rot="...">`): `rot=270°` en 15 de 16 imágenes del
Anexo 12 y 17 de 18 del Anexo 13.

Y en el Anexo 12 **no todas van para el mismo lado**: 12 a 270° y 3 a 90°.
Rotar todo 90° "a ojo" corrompe esas 3. El atributo del documento es la única
fuente confiable, y por eso `bases-triage.js` lo lee en vez de estimarlo.

El tamaño de la caja separa la página del adorno: las del TDR miden 22–27 cm; el
logo de la carátula, 7,7 cm.

### La asimetría entre los dos documentos del mismo proceso

En las bases de **supervisión** los requisitos de personal están en texto
nativo (66 líneas con "experiencia", 15 con "personal clave"). En las de
**ejecución** no — están en el TDR escaneado. Mismo proceso, dos documentos, dos
caminos. Eso hace que el triage no sea una optimización sino la condición para
que el extractor funcione en los dos casos.

### El falso ✅ que cerró la mig 198

El requisito real, literal del Anexo 13:

> **Jefe de Supervisión del Proyecto** — Experiencia no menor de **03 años**,
> sustentada con copia de diploma de incorporación al Colegio respectivo.
> Sustentar como mínimo **02 participaciones** como Residente de obra y/o
> Supervisor de obra y/o Inspector de obra y/o [7 cargos más] en obras iguales o
> similares al objeto de la convocatoria, por un plazo **no menor a 02 meses
> cada participación**, en los **últimos 10 años**.

Son **cinco criterios** y la mig 197 guardaba uno (`meses_minimos` + `rubro`).
Consecuencia concreta: **alguien con cinco años seguidos en UNA sola obra pasaba
el filtro y el verificador lo daba por calificado.** No califica — le falta la
segunda participación. Un verificador que dice "sí" cuando la respuesta es "no"
es peor que no tener verificador.

La mig 198 agrega, todo con defaults que APAGAN los criterios (una fila vieja se
evalúa igual que antes):

- `participaciones_minimas` · `meses_por_participacion` · `ventana_anios`
- `cargos_equivalentes` (jsonb) — los diez sinónimos por puesto
- `meses_generales_minimos` — la experiencia general, otro número
- `licitaciones.definicion_obras_similares` — se define una vez por proceso, y
  **no** es un rubro del catálogo: es el texto que escribió esa entidad
- `personal_profesional.colegiatura_fecha` — sin ella los "03 años" no se pueden
  medir; `colegiatura_habil_hasta` dice si puede presentarse hoy, no la antigüedad

**Las participaciones no se fusionan**, y es lo contrario de los meses: dos obras
simultáneas son UN año pero son DOS participaciones. Son dos reglas opuestas
sobre los mismos datos y cada una está donde corresponde
(`totalizarExperiencia` fusiona, `contarParticipaciones` no).

Cuando falta la fecha de colegiatura se **avisa y no se bloquea**: descartar a
alguien por un campo vacío es el error caro de este módulo.

### Archivos

- `src/lib/bases-triage.js` — decisión pura + lector de `.docx`. Sin IA.
- `src/lib/__tests__/bases-triage.test.js` — 21 tests; los que abren los .docx
  reales se **saltan** si `Modelos/` no está (gitignoreado: el repo es público).
- `src/lib/__tests__/requisitos-reales-bases.test.js` — 26 tests que transcriben
  el requisito del Jefe de Supervisión palabra por palabra.

### Dos bugs que los archivos reales destaparon

1. En `bloquesDeDocx`, esparcir `clasificarImagenDocx()` sobre el bloque pisaba
   `tipo: 'imagen'` con su propio `tipo: 'pagina'` — y todo el módulo filtra por
   ese campo, así que las 15 páginas del TDR quedaban **invisibles**.
2. `<w:t[^>]*>` también matchea `<w:tbl>`, `<w:tc>` y `<w:tr>`; como no cierran
   con `</w:t>`, la captura se comía párrafos enteros de tabla e inflaba el texto
   de 194k a 327k caracteres.

Ninguno de los dos aparece con datos inventados. Los dos tienen test de regresión.

---

## Entrega 3 — La herramienta de análisis de bases

### Lo que trajeron los archivos nuevos (medido el 8-set-2026)

| Documento | Páginas | Nativas | A OCR |
|---|---|---|---|
| Chilete Anexo 12 (.docx) | — | 200.962 chars | 15 imágenes |
| Chilete Anexo 13 (.docx) | — | 125.064 chars | 17 imágenes |
| **BASES INTEGRADAS 009 (.pdf)** | **96** | **2** | **94** |
| CV Jaime Ayay (.pdf) | 39 | 8 | 31 |

Las bases 009 son **el espejo exacto de Chilete**: allá 326.000 caracteres
nativos con 32 imágenes pegadas; acá un PDF escaneado casi entero. El mismo
triage sirve para los dos justamente porque nunca decidió a nivel de documento.
Hay un test que lo verifica contra el PDF real.

### Los cinco pasos, y cuál cuesta

    0    triage      qué es texto y qué es imagen        USD 0
    0.5  índice      dónde aparece cada familia          USD 0
    1    OCR         solo las páginas que hacen falta    USD 0,002 c/u
    2    localizar   la IA ELIGE entre lo que ya hay     ~USD 0
    3    extraer     la IA lee solo los rangos elegidos  ~USD 0
    4    verificar   ¿la cita existe en el documento?    USD 0

**El paso 0.5 es la pieza que abarata todo.** Un documento leído entero son
70–90 mil tokens; el problema no es el precio, es que ningún modelo gratuito
con ZDR tiene esa ventana, y uno que recibe 90.000 tokens para sacar 8 datos se
distrae. El índice se arma con `grep` sobre los rótulos reales de unas bases
peruanas y baja el Pase 1 a ~4.000 tokens. **La IA no busca: elige entre
candidatos que ya encontró el código.**

### Las dos pasadas son un embudo, no una repetición

Confirmado el diseño del documento original, con una corrección: las dos
pasadas **no aumentan la confiabilidad por redundancia**. El Pase 1 devuelve
rangos de páginas, nunca datos; el Pase 2 lee 8 páginas en vez de 96.

Contra la alucinación **no hay una tercera pasada de IA**, y es a propósito:
repetir la extracción y comparar cuesta el doble y sigue sin responder si el
dato existe, porque dos alucinaciones coherentes se confirman entre sí. En su
lugar hay una **verificación determinista**: cada dato trae su cita literal y
el código comprueba que aparezca en el documento, normalizando tildes,
mayúsculas y espacios —así devuelve el OCR—. Cuesta USD 0 y responde justo esa
pregunta. Lo que no verifica **no se descarta: se marca**, y en la pantalla
arranca destildado.

### El precio se dice ANTES de cobrarlo

El triage corre en el navegador y es gratis, así que se puede contar
exactamente cuántas páginas van a OCR **antes de gastar un centavo**. La
pantalla muestra «94 páginas escaneadas · USD 0,19 · ¿analizo?» y recién ahí se
paga. Al terminar muestra lo que costó de verdad, sumando lo que informó
OpenRouter por las pasadas.

### Por qué el OCR está duplicado y no importado

`mistralOcr()` vive dentro de `api/captura-magica.js` como función privada.
Sacarla a `/lib` sería lo prolijo, pero obliga a editar el archivo del que
depende **todo el ingreso de comprobantes del grupo**. Duplicar 40 líneas
estables cuesta una tarde; romper Captura Mágica cuesta que nadie facture. Lo
que sí se comparte es `lib/mistral-ocr.js`: la regla del snapshot fijo es una
sola para toda la app.

### Dos cosas que encontraron los tests

1. **El mismo requisito se proponía dos veces.** El párrafo del Residente dice
   «…en obras similares», así que cae en el índice de `personal` **y** en el de
   `empresa`; los dos rangos se leen y el puesto volvía duplicado. Se
   deduplica por el texto de origen, que es lo único que no cambia entre una
   pasada y la otra.
2. **El guardado en lote no podía reusar `guardarRequisito`.** Esa función
   tiene un guard síncrono anti-duplicado (`enCursoRef`) que corta la segunda
   llamada mientras la primera está en vuelo: un `for` habría guardado el
   primer puesto y descartado los otros ocho **en silencio**.

### Archivos

- `src/lib/bases-triage.js` — se le agregó el camino PDF (`bloquesDePdf`,
  `renglonesDeItems`) y el ancla `<!-- página N -->`, que es lo que después
  permite citar una página y comprobarla. Un `.docx` no tiene páginas y no se
  le inventan.
- `src/lib/bases-extraccion.js` — índice sin IA, verificación de citas y la
  traducción a la fila de `licitacion_requisitos`. 36 tests.
- `src/lib/bases-analisis.js` — la cadena completa, en el cliente. 11 tests con
  un API de mentira.
- `api/bases-analizar.js` — endpoint propio: `ocr` (de a 6 páginas), `localizar`
  y `extraer`.
- `src/components/jx-licitaciones.jsx` — el botón **«🔎 Leer las bases»** y el
  modal de revisión.
- `docs/prompt-extraccion-bases.md` — el prompt y sus reglas, que es lo que se
  revisa cuando una extracción sale mal.

### Lo que NO hace, y por qué

- **No guarda nada solo.** Propone; la persona tilda. Un requisito inventado
  que entra solo descalifica gente que sí calificaba.
- **No pisa lo que ya cargaste**: de los datos del proceso solo propone los
  campos vacíos.
- **No propone `rubro_id` ni con qué empresa postulamos.** Eso no se lee de
  las bases y errarlo desarma la postulación. El `tipo_trabajo` (ejecución vs
  supervisión) sí se lee del documento desde la entrega 4, pero viaja como
  **sugerencia** que se prellena en el formulario y una persona confirma.
- **No corre desde el servidor.** Un PDF de 96 páginas no entra en una
  serverless, ni por tamaño ni por tiempo.

---

## Entrega 4 — El CV se vuelve ficha, y la postulación nace del documento

> 8-set-2026. Migración **199** aplicada. Tres pedidos de Gabriel en una tanda:
> el lector de CVs (el padrón seguía en 0 fichas), la aclaración de que
> **el lector de bases debe CREAR la postulación, no vivir dentro de una**, y
> «sé más abierto con cómo empezar a participar: usualmente se hacen
> consorcios». Más el borrado de órdenes anuladas, que es de otra pantalla.

### La aclaración que reordenó la pantalla

En la entrega 3 el botón «Leer las bases» estaba dentro de una postulación que
había que crear a mano primero. Gabriel lo entendió al revés, y tenía razón:
la convocatoria de El Peruano trae **todo lo necesario para crear** la
postulación (nombre, CUI, monto, calendario) y las bases traen el resto.

Ahora la lista tiene dos botones: **«🔎 Leer bases o convocatoria»** (el
principal) y «+ A mano». El modal es el mismo que antes con una diferencia:
sin `lic` muestra la **cabecera editable** —lo leído ya puesto, el tipo de
proceso *sugerido* por el documento y marcado como tal, y el selector de con
qué empresa postulamos— y al confirmar crea la postulación con su calendario,
sus puestos y sus requisitos de empresa en **una sola escritura**
(`crearDesdeAnalisis`). Con `lic` sigue *complementando*: propone solo lo
vacío, agrega el calendario si no había, suma lo que se tilde. El flujo real
es **primero la convocatoria, después las bases** desde adentro.

### Lo que el documento dice del proceso (mig 199 sobre `licitaciones`)

Medido sobre PUBLICADO_PERUANO 021 y 022-2026 (Obras por Impuestos, Chilete):

| Dato | Ejemplo real | Columna |
|---|---|---|
| Nombre textual de la inversión | «MEJORAMIENTO Y AMPLIACION DEL SERVICIO DE ACCESIBILIDAD… DE CHILETE…» | `nombre_inversion` |
| CUI | 2611946 | `cui` |
| Mecanismo | Ley 29230 | `mecanismo = 'oxi'` |
| Monto referencial | S/ 15,804,472.36 | `valor_referencial` |
| Desglose | ejecución 15,051,878.44 · supervisión 735,343.92 | `monto_ejecucion`, `monto_supervision` |
| Calendario | 10 etapas del 08/09 al 12/10/2026 | `cronograma` (jsonb) |
| Consorcio | «Empresa Privada o Consorcio», promesa formal | `consorcio_permitido`, `consorcio_reglas` |

**La fecha que manda** (`fecha_presentacion`) sale de la etapa *Presentación
de Propuestas* del calendario cuando el proceso no la dice suelto — y es el
**último** día del rango, no la expresión de interés.

**El índice de secciones (`SECCIONES`) daba 0 aciertos en `proceso` con la
convocatoria**: las bases de OxI dicen «monto referencial del convenio», «CUI
N°», «entidad pública que convoca», «calendario del proceso» y «presentación
de propuestas», no «valor referencial» ni «cronograma del procedimiento». Se
agregaron los rótulos reales; hay un test con los renglones literales del PDF.

**La familia `proceso` es ahora una pasada propia** con su prompt
(`SYSTEM_PROCESO` en `api/bases-analizar.js`), y absorbe los rangos de
`cronograma` (en una convocatoria están en el mismo texto). El proceso se arma
**campo a campo**: la primera pasada que trae un dato lo fija; las siguientes
solo llenan lo vacío. Así la convocatoria de una página y las bases de 96 se
complementan en vez de pisarse.

### Cómo participar: la empresa y el consorcio

La tarjeta nueva del detalle junta tres cosas:

1. **Requisitos del postor** (clase `'empresa'` en `licitacion_requisitos`,
   con `descripcion`, `monto_minimo`, `multiplo_valor_referencial` de la mig
   199): experiencia en obras similares —«X veces el valor referencial», y la
   pantalla calcula el monto—, facturación, capacidad de contratación, RNP.
   Los extrae `SYSTEM_PROCESO` y pasan por la misma verificación de cita.
2. **Consorcio según las bases**: permitido / no permitido / no lo dicen, con
   las reglas textuales (porcentajes, promesa formal, representante común).
3. **El plan nuestro** (`licitaciones.consorcio`, jsonb): con quién vamos
   (empresa del grupo o tercero por RUC), qué % y qué **aporta** cada uno
   (experiencia, capital, personal, RNP, equipos), más notas. Sin socios =
   postula la empresa sola.

**Lo que NO hace todavía:** evaluar si las empresas del grupo cumplen. No hay
dato de experiencia de empresa cargado (obras similares por monto, facturación
anual): eso es la entrega 5 y ahora ya tiene contra qué medirse.

### El CV → la ficha (mig 199 sobre `personal*`)

Medido sobre el CV real (39 páginas: 8 nativas, 31 constancias escaneadas):

- **«El CV» son dos documentos.** Las páginas nativas *declaran*; las
  escaneadas *certifican*. La cadena (`src/lib/cv-analisis.js`) hace OCR solo
  de las escaneadas (31 × USD 0,002 = **USD 0,062**), lee la ficha en una
  pasada (`SYSTEM_CV_FICHA`) y qué certifica cada página en otra
  (`SYSTEM_CV_CONSTANCIAS`, de a 8 páginas), y **el código cruza**
  (`emparejarConstancias`): cada constancia sustenta a lo sumo una experiencia
  —la de fechas más cercanas, misma entidad por RUC o por nombre tolerante,
  45 días de tolerancia— y le pone la **página**. Una declarada sin constancia
  se guarda sin `evidencia_id` (no cuenta como sustentada); una constancia sin
  declaración entra como experiencia nueva.
- **`personal.obra_id` pasó a nullable.** Un profesional del banco de
  propuestas no está en ninguna obra. Los cercos RLS (migs 177/178) ya
  trataban `obra_id IS NULL` como fila global; se agregó un índice único
  parcial por DNI para el caso sin obra (el de `(dni, obra_id)` no dedupe con
  NULL).
- **`personal_experiencia.sustento_pagina`** + `fuente`/`fuente_pagina`/
  `fuente_cita`: la constancia es la página N del mismo PDF, no 31 archivos.
- **La ficha gana `ruc`, `capacitaciones` (jsonb), `fuente`, `cv_analisis`.**
  El diploma de colegiatura llena `colegiatura_fecha` (la experiencia general
  de la mig 198); el certificado de habilidad, `colegiatura_habil_hasta`.
- **El rubro se PROPONE por palabras clave del nombre de la obra** (nunca de
  la entidad: «Municipalidad» no dice nada del rubro) y la persona confirma.
- **Fechas como las escribe la gente:** «09/04/2026» es día/mes/año,
  «abril de 2013» es aproximada, «26/07!2011» es un tipeo real que se lee.
  Lo que no parsea **no se inventa**: queda vacío y se avisa.
- **El triage del CV tiene otro piso** (`MIN_ALFA_CV = 250`): el CV imprime un
  encabezado nativo de 69 letras sobre cada constancia escaneada y el piso de
  las bases (80) estaba a 11 letras de darlas por nativas y no leerlas.
- **El tope de evidencias subió a 30 MB para PDF** (cliente y `api/r2.js`):
  el CV real pesa 18 MB. Los bytes van navegador → R2, no tocan a Vercel.

La pantalla (`jx-profesionales.jsx`): «🤖 Cargar CV con IA» arriba y «Leer el
CV con IA» dentro de la ficha. Busca por DNI para no duplicar; sin DNI legible
no crea. El guardado es una sola escritura (`aplicarCv`) por la misma razón
que en las bases: los guards síncronos cortarían un bucle en silencio.

### Órdenes anuladas

`jx-ordenes.jsx`: con «ver anuladas» prendido, cada anulada trae un tacho que
la elimina (borrado lógico) junto con sus ítems, con confirmación y auditoría.
Solo se elimina lo ya anulado.

### Archivos

- `supabase/migrations/199_cv_a_ficha_y_proceso_completo.sql`
- `api/bases-analizar.js` — `SYSTEM_PROCESO`, `SYSTEM_CV_FICHA`,
  `SYSTEM_CV_CONSTANCIAS`; acción `extraer_cv`; RR.HH. puede leer CVs.
- `src/lib/bases-extraccion.js` — rótulos de OxI, `aFilaRequisitoEmpresa`,
  `aCronograma`, `fechaPresentacionDe`, cabecera extendida, `sugerenciasDe`.
- `src/lib/bases-analisis.js` — `ocrDeBloques` y `crearPedidor` compartidos,
  familia `proceso`, fusión campo a campo.
- `src/lib/cv-extraccion.js` (puro, 44 tests) y `src/lib/cv-analisis.js`.
- `src/components/jx-licitaciones.jsx`, `jx-profesionales.jsx`, `jx-ordenes.jsx`.
- `src/sync/EvidenceUploader.js`, `api/r2.js` — tope de 30 MB para PDF.

---

## Anexo — contexto original de Gabriel (8-set-2026)

Se conserva tal como se recibió, salvo los puntos ya corregidos arriba.

### Estructura del bloque

- Bloque de herramientas IA: escaneo/extracción de bases, análisis de CVs,
  análisis de empresas del grupo/terceras.
- Bloque de trabajos a postular: múltiples postulaciones en paralelo, creadas
  preferentemente desde el escaneo de bases.
- Calendario por postulación: hitos del cronograma (registro, consultas,
  absolución, integración de bases, presentación de ofertas, buena pro), con
  notificaciones por rol.
- Kanban por postulación, con documentos vinculados a cada etapa.
- Transición a Trabajos: manual, con botón, prellenando lo disponible.

### Banco de profesionales y empresas

Ficha estructurada por profesional (experiencia general, específica por tipo de
obra, cargo máximo, colegiatura y vigencia, capacitaciones) y por empresa
(obras similares, facturación acumulada, capacidad libre de contratación
CDC/RNP). La extracción de CVs se hace **una vez**, no re-parseando el CV en
cada postulación.

### Escáner de bases — triage de OCR por página

Un documento de bases casi nunca es 100% nativo ni 100% escaneado. Decidir
«esta base necesita OCR» a nivel de documento completo es incorrecto en ambas
direcciones: gasta dinero y mete errores de OCR en páginas que ya eran texto
perfecto, o deja sin OCR páginas escaneadas dentro de un documento que «en
general» parecía nativo.

**Paso 0 — triage por página, antes de cualquier OCR:**

1. Extraer texto nativo de cada página. Si devuelve cantidad significativa con
   proporción razonable de caracteres alfabéticos → página nativa, usar ese
   texto, **no mandarla a OCR**.
2. Si devuelve vacío, muy poco o basura → esa página específica va a OCR.
3. En `.docx` el texto casi siempre es nativo; el principio aplica solo a las
   imágenes incrustadas (firmas, cuadros pegados como imagen).
4. El resultado es un documento híbrido: texto nativo tal cual + OCR solo donde
   hacía falta, combinado en el mismo markdown antes del Pase 1.

### Arquitectura de extracción (dos pasadas)

- **Pase 1 — localización**: llamado barato que ubica en qué sección/rango de
  páginas están los requisitos de personal, los de empresa, el cronograma, la
  estructura de presentación y los factores de evaluación. Marca qué no encontró.
- **Pase 2 — extracción detallada**: solo sobre las secciones localizadas, con
  reglas estrictas de no inventar datos, distinguir requisito obligatorio de
  factor de evaluación con puntaje, y **citar la página/subsección de origen**
  de cada dato.
- El schema cubre datos del proceso, requisitos de personal, requisitos de
  empresa, cronograma, estructura de presentación, factores de evaluación y un
  array de **alertas** para todo lo que necesita revisión humana.

> El `prompt-extraccion-bases-jarvex.md` que el contexto original referencia
> nunca existió en el repo. Lo reemplaza `docs/prompt-extraccion-bases.md`,
> escrito en la entrega 3 contra los documentos reales.

### Estructura de presentación: dinámica, no plantilla fija

El orden de anexos, formularios y foliado **no es el mismo entre
postulaciones** — no se puede reutilizar un expediente anterior completo. Por
eso se separa el banco de contenido reutilizable (declaraciones juradas,
formularios estándar) del índice de estructura generado por cada postulación a
partir de sus propias bases.

### Documentos de referencia compartidos

- Boletín El Peruano (dos ediciones, 8-set-2026) con modelos de convocatoria de
  Entidad Privada Supervisora y Empresa Privada para Chilete (Obras por
  Impuestos, Ley 29230) — ejemplo de estructura de convocatoria y calendario,
  no de OCR mixto.
- Anexos 12 y 13 — Modelo de Bases EP/EPS Chilete (.docx).
- **BASES INTEGRADAS del proceso 009** (.pdf, 8-set-2026) — las bases reales con
  partes escaneadas que faltaban: 96 páginas, 94 de ellas escaneadas. Validaron
  el triage en la dirección contraria a Chilete.
- **CV de un profesional** (.pdf, 39 páginas) — 8 de currículum nativo y 31 de
  constancias escaneadas. Reordena la entrega 4: extraer «el CV» es, en
  realidad, leer las constancias.
