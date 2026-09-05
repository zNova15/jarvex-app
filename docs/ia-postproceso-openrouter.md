# Postprocesamiento del OCR en OpenRouter + versiones de Mistral OCR

Medido e implementado el **5-sep-2026**. Léelo antes de tocar `lib/openrouter.js`,
`api/captura-magica.js` o de cambiar el modelo de OCR en Vercel.

---

## 1. Qué cambió y por qué

Captura Mágica lee un comprobante en dos pasos:

| Paso | Quién lo hace | Costo por comprobante |
|---|---|---|
| **OCR** — PDF/foto → texto markdown | Mistral | USD 0,002 – 0,004 |
| **Postprocesamiento** — texto → JSON | ~~Claude Haiku 4.5~~ → **OpenRouter (gratis)** | USD 0,012 → **0** |

El paso caro no era leer el papel: era **estructurar** el texto. Y ese paso es el
más fácil de los dos — texto limpio, llenar un formulario — así que no necesitaba
el mejor modelo del mundo, necesitaba uno que siga instrucciones y devuelva JSON.

Además arregla un incidente que ya se repitió dos veces (22-jul y 4-sep-2026):
**la app dejaba de leer facturas cuando se agotaba el saldo de Anthropic.** Con
OpenRouter de titular, el camino común deja de depender de ese saldo.

**Lo que NO cambió:** certificados de calidad, SCTR y el fallback de visión
siguen en Claude Sonnet — ahí hace falta criterio, no transcripción.

---

## 2. La medición (no es una opinión)

Banco de pruebas: el `SYSTEM_PROMPT` **real** de producción contra 4 documentos
peruanos sintéticos — factura con detracción SPOT (15 campos), recibo por
honorarios con retención de 4ta (9 campos), guía de remisión (8 campos) y una
factura de **60 líneas de detalle** (el modo de falla real del caso F001-4446).

| Modelo | Exactitud | Latencia p50 | Fiabilidad | Política de datos |
|---|---|---|---|---|
| **`inclusionai/ling-3.0-flash-fin:free`** (Novita) | **32/32** | **3,3 s** | 8/8 | ✅ **ZDR** |
| `minimax/minimax-m3:free` (GMICloud) | 32/32 | 3,1 s | 10/10 | ✅ no-entrena |
| `anthropic/claude-haiku-4.5` *(la base)* | 32/32 | 3,9 s | — | paga |
| `openrouter/free` (enrutador) | 32/32 | 5,4 s | — | ✅ no-entrena |
| `minimax/minimax-m2.7:free` | 32/32 | 8,3 s | — | ✅ no-entrena |
| `z-ai/glm-5.2:free` | 15/15 | 3,0 s | **1/3** (429) | ✅ no-entrena |
| `dots-studio/dots-3-note-preview:free` | 17/32 | 22,8 s | — | ✅ no-entrena |
| `google/gemma-4-*:free` | — | — | **0/3** (429) | ✅ no-entrena |
| `nvidia/nemotron-3*:free`, `liquid/lfm-2.5:free` | — | — | — | ❌ **entrenan** |
| `thinkingmachines/inkling*:free` | — | — | — | solo en harness agénticos |

Los tres candidatos que empataron con Haiku también resolvieron la factura de 60
líneas al 100 % (60/60 ítems, total exacto).

---

## 3. Privacidad: cómo está garantizada

Acá viajan **RUC, razón social, montos y a veces DNI**. La garantía no es una
promesa, son dos mecanismos:

1. **Cada llamada exige una política de datos** (`provider.zdr` o
   `provider.data_collection:'deny'`). Si ningún proveedor la cumple, OpenRouter
   responde **404 y no manda nada**. Falla cerrado, no se filtra. Lo comprobamos:
   los modelos de NVIDIA y Liquid quedaron afuera solos por este filtro.
2. **`zdr` (el default) es más fuerte que `deny`:** el proveedor ni siquiera
   guarda el prompt. `deny` solo promete no entrenar con él.

`inclusionai/ling-3.0-flash-fin:free` es **el único gratuito medido que pasa
`zdr`**. Por eso es el titular, aunque MiniMax sea marginalmente más rápido.

### ⚠️ La pregunta de jurisdicción que ya contestaste una vez

El 4-sep decidiste **no usar GLM** porque la matriz de Zhipu está en Beijing.
Los dos ganadores acá son **pesos abiertos de origen chino** (Ling es de Ant
Group; MiniMax es de Shanghái) — pero **la API de esas empresas no interviene**:

- Los pesos son abiertos y los ejecuta un tercero.
- Los datos van a **Novita (San Francisco)** o **GMICloud (Mountain View)**.
- Con `zdr`, ese tercero no los guarda.

Es distinto de llamar a la API de Zhipu, donde los datos sí llegaban a la
empresa china. **Aun así es tu decisión, no técnica.** Si prefieres que ni los
pesos sean de origen chino, la alternativa gratuita que pasa el filtro es
`openrouter/free` (enrutador, 32/32 pero 5,4 s y modelo variable); la alternativa
paga barata sigue siendo GPT-5.6 Luna (~USD 0,0027/factura).

---

## 4. Mistral OCR: qué versión conviene

**No hay nada que "actualizar": el alias ya se movió solo.**

| Modelo | Qué es | Precio /1000 págs | Cuándo |
|---|---|---|---|
| `mistral-ocr-2512` | OCR 3 (dic-2025) | **USD 2** | Facturas y guías digitales |
| `mistral-ocr-latest` = `mistral-ocr-4` | **OCR 4.1** (16-jul-2026) | **USD 4** | Certificados de calidad, escaneos |
| `mistral-ocr-2505` | OCR 2 | — | ❌ deprecado el 27-feb-2026 |

El **16-jul-2026 Mistral repuntó `mistral-ocr-latest` de OCR 3 a OCR 4.1 y el
precio se duplicó**, sin que nadie lo eligiera. Si `MISTRAL_OCR_MODEL` no está
seteada en Vercel, JARVEX está pagando USD 4.

OCR 4.1 sí es mejor: 93,07 en OmniDocBench (OCR 3 ≈ 85,66), 72 % de preferencia
humana sobre sus rivales, 170 idiomas, y suma **cajas delimitadoras por párrafo,
etiquetas de bloque y puntaje de confianza por bloque**. Eso importa en tablas
de laboratorio y escaneos — o sea, en **certificados de calidad**, no en una
factura electrónica nítida.

**Decisión de Gabriel (5-sep-2026): volver a OCR 3 y que se quede ahí.**
El default del código está **fijo en `mistral-ocr-2512`** y `lib/mistral-ocr.js`
**ignora un alias móvil** aunque alguien lo ponga en Vercel — avisa en el log y
usa el snapshot. Escape explícito: `MISTRAL_OCR_PERMITIR_ALIAS=1`.
Hay un test que falla si alguien reintroduce `mistral-ocr-latest` en el endpoint.

Certificados de calidad usan hoy el mismo snapshot barato: el módulo **no tiene
ni un certificado cargado** (0 filas en `calidad_certificados`, medido el
5-sep-2026). Cuando se use y OCR 3 se quede corto con las tablas de laboratorio,
se sube con `MISTRAL_OCR_MODEL_CERT=mistral-ocr-4-1` — un snapshot, no un alias.

A 134 comprobantes/mes la diferencia es de centavos (USD 0,54 → 0,27). El punto
no es el ahorro: es **dejar de que un alias decida la compra por vos**.

---

## 4 bis. Ningún modelo gratuito es permanente

Es el riesgo estructural de esta arquitectura y hay que mirarlo de frente:

- Los `:free` de **DeepSeek** fueron los más usados de 2025 → a mediados de 2026
  estaban **todos en pago**.
- Los tiers gratuitos de **Llama y Qwen** desaparecieron antes de agosto de 2026.
- El total de gratuitos se movió entre ~14 y ~29 en pocos meses.

**Antigüedad de los gratuitos que nos importan** (fecha de listado, medido el
5-sep-2026):

| Modelo | Listado hace | Rol |
|---|---|---|
| `openrouter/free` | **217 días** | auto-router — el único diseñado para sobrevivir la rotación |
| `minimax/minimax-m3:free` | 97 días | respaldo asentado |
| `inclusionai/ling-3.0-flash-fin:free` | **9 días** | el mejor medido… y un recién llegado |

Por eso la cadena por defecto va **del mejor al que va a seguir estando**, y
termina fuera de OpenRouter:

```
ling-3.0-flash-fin:free → minimax-m3:free → openrouter/free → Claude Haiku (pago)
```

`openrouter/free` es el auto-router de OpenRouter: elige solo entre los
gratuitos **vivos**, así que sigue funcionando después de una rotación.

**La cadena degrada sola, no rompe.** Verificado: con `zdr` puesto y un modelo
sin endpoint ZDR primero en la lista, OpenRouter **saltea** y sirve el
siguiente que sí cumple. Ojo con esto: bajo `zdr`, `minimax-m3:free` queda
afuera y el pool del auto-router es **variable** (a veces tiene un gratuito ZDR,
a veces no). Ése es el costo real de exigir ZDR — con `deny` entran los tres.

**Cómo enterarse de que rotó, sin esperar la factura:**

```bash
node --env-file=.env.local scripts/revisar-modelos-openrouter.mjs --probar
```

Dice si cada modelo de la cadena sigue listado, sigue gratis y sigue
respondiendo con la política puesta, y lista las alternativas ordenadas por
antigüedad. Sale con código 2 si algo se cayó.

La otra señal, la que no hay que ir a buscar: **filas en ámbar con "(respaldo)"
en la bandeja de Captura Mágica.**

---

## 5. 🔴 Trampas — no rompas esto

1. **OpenRouter devuelve HTTP 200 con el error adentro.** Cuando el proveedor de
   abajo tira 429, la respuesta llega con status **200** y un objeto `error` en
   el body. Un `if (!res.ok)` a secas da la request por buena y el fallo aparece
   después disfrazado de "la IA no devolvió JSON". Hay que mirar **siempre**
   `data.error` (`errorDelCuerpo()`). Verificado el 5-sep-2026.
2. **El techo de salida de Claude corta a los que razonan.** La fórmula vieja
   (`900 + ítems×55`) está calibrada sobre Haiku, que escupe el JSON y nada más.
   Los gratuitos buenos **piensan en voz alta** y ese pensamiento cuenta contra
   el techo: la factura de 60 ítems gastó 6.811 tokens (Haiku: 2.914) y con
   4.200 se **truncaba**. Por eso existe `presupuestoSalida()`. Pedir de más
   cuesta USD 0; cortar una factura por 500 tokens cuesta una fila en Error.
3. **El respaldo a Claude no es opcional.** Los modelos gratuitos tienen tope de
   **20 requests/minuto** (y 1.000/día con créditos comprados). Un lote grande de
   facturas se topa. Sin el respaldo, esas filas salen en Error.
4. **El presupuesto de tiempo se reparte.** OpenRouter recibe ~55 % de lo que
   queda del deadline; el resto se guarda para el respaldo. Si le das todo, el
   respaldo nunca corre y la asistente espera 55 s para el mismo error.
5. **Un `AbortError` de OpenRouter NO significa "se acabó el tiempo"** — significa
   que se acabó la mitad que le tocaba. El único guard válido para el respaldo es
   el reloj real (`deadline - Date.now() > 12000`).
6. **`<think>` hay que borrarlo.** `extractJson` va de la primera `{` a la última
   `}`; una llave suelta en el razonamiento se lleva puesto el parseo.
7. **La etiqueta de la fila no puede mentir.** Si la lectura la terminó el
   respaldo, la fila lo dice en ámbar. Es la única señal visible de que el motor
   titular está fallando.

---

## 6. Cómo se prende, se revierte y se mide

**Prender** (Vercel → Settings → Environment Variables, Production + Preview):

```
OPENROUTER_API_KEY=sk-or-v1-…
```

Nada más. Los defaults ya son los ganadores de la medición. **Sin esa variable
el deploy no cambia absolutamente nada**: todo sigue corriendo en Claude.

**Revertir** sin borrar la key ni tocar código: `IA_POSTPROCESO=anthropic` +
redeploy.

**Medir:** cada lectura deja una línea `[ia-uso]` en los logs de Vercel con
`engine`, `model`, `proveedor`, tokens y —si hubo— `respaldo`. Y en la pantalla,
cada fila de la bandeja dice con qué motor se leyó y en cuánto.

**Señal de alarma:** filas en ámbar con "(respaldo)". Significa que el titular
está fallando y se está gastando saldo de Anthropic sin que nadie se entere.

---

## 7. Pendiente

1. **Gabriel prueba con facturas reales.** El banco usa documentos sintéticos;
   los reales traen ruido de escaneo, sellos y formatos raros de facturador.
2. **La key de OpenRouter viajó por un chat** — conviene rotarla en
   openrouter.ai → Keys una vez que esté cargada en Vercel.
3. **Decidir el modelo de OCR por modo** (sección 4) — son dos variables en
   Vercel, sin código.
4. **`categorize`, `validar-comprobante-ai` y `sugerir-cuenta-pcge` siguen en
   Haiku.** Son 3 llamadas más chicas que las de Captura Mágica y el adaptador
   ya está escrito: mudarlas es repetir el patrón, no inventarlo.
