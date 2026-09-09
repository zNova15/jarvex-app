// ═══════════════════════════════════════════════════════════════════
// JARVEX — ANÁLISIS DE BASES DE LICITACIÓN (tanda 15, entrega 3).
//
// Endpoint PROPIO, separado de /api/captura-magica por decisión de Gabriel
// (8-set-2026) y porque son problemas distintos:
//
//   Captura Mágica : 1 comprobante nítido, 1 llamada, 1 formulario de 12 campos.
//   Análisis de bases: 96 páginas de las que 8 sirven, en tandas, con un índice
//                      armado por código y dos pasadas cortas encima.
//
// POR QUÉ EL OCR ESTÁ DUPLICADO Y NO IMPORTADO
// `mistralOcr()` vive dentro de api/captura-magica.js como función privada.
// Sacarla a /lib para compartirla sería lo prolijo, pero obliga a editar el
// archivo del que depende TODO el ingreso de comprobantes del grupo — la
// herramienta que más se usa. El costo de duplicar 40 líneas estables es una
// tarde; el de romper Captura Mágica es que nadie factura. Se duplica a
// propósito, y si algún día hay que tocar las dos, este comentario lo dice.
// Lo que sí se comparte es `lib/mistral-ocr.js`: la REGLA del snapshot fijo
// (nunca un alias móvil) es una sola para toda la app.
//
// ACCIONES (una sola función, los pasos del mismo trabajo):
//   'ocr'        → { paginas:[{n, imagen}] }        → texto por página
//   'localizar'  → { indice }                       → en qué páginas está cada cosa
//   'extraer'    → { texto, seccion }               → los requisitos, con su cita
//                  seccion 'personal' → el plantel (SYSTEM_EXTRAER)
//                  seccion 'proceso' | 'empresa' | 'cronograma' → el proceso
//                  entero: montos, CUI, plazo, calendario, consorcio y los
//                  requisitos de la EMPRESA (SYSTEM_PROCESO). Entrega 4.
//   'extraer_cv' → { texto, parte }                 → la ficha de un profesional
//                  parte 'ficha' (las páginas de currículum) o 'constancias'
//                  (las escaneadas: qué certifica cada una). Entrega 4.
//
// EL CV ENTRA POR ACÁ Y NO POR UN ENDPOINT PROPIO porque es el mismo trabajo
// —triage, OCR de lo escaneado, extracción con cita, verificación— sobre otro
// documento. Comparten el OCR, el cliente de OpenRouter y la regla de la cita.
//
// El cliente manda las páginas de a poco: 96 páginas rasterizadas no entran en
// un request (Vercel corta ~4,5 MB) ni en 60 segundos de función.
// ═══════════════════════════════════════════════════════════════════

import { requireAuth, rateLimit, sanitizeError } from '../lib/api-helpers.js';
import { modeloOcr } from '../lib/mistral-ocr.js';
import { leerConfig, construirCuerpo, openrouterChat, normalizarRespuesta } from '../lib/openrouter.js';

export const maxDuration = 60;

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr';
// Mismo criterio que Captura Mágica: snapshot fijo. Un alias móvil ya duplicó
// el precio una vez sin que nadie lo decidiera (16-jul-2026).
const OCR = modeloOcr(process.env);

/** Quién puede analizar unas bases: el mismo trío que ve el módulo (mig 197). */
const ROLES = ['admin', 'gerente', 'licitaciones'];
/** Quién puede leer un CV: los que escriben la ficha profesional (mig 171):
 *  el trío de arriba más RR.HH. El OCR se comparte, así que también lo usan. */
const ROLES_CV = [...ROLES, 'rrhh'];

// Tope por tanda. 6 páginas a 150 dpi en JPEG rondan 1,8 MB en base64 — bien
// por debajo del corte de la plataforma, y entran en el minuto de la función.
const MAX_PAGINAS_TANDA = 6;
const MAX_BASE64_PAGINA = 3 * 1024 * 1024;
const MAX_TEXTO_PASADA = 120_000;   // ~30k tokens: un rango de páginas, no el documento

// ── Los prompts. Su versión larga y comentada vive en
//    docs/prompt-extraccion-bases.md, que es el documento que se revisa
//    cuando una extracción sale mal. ──────────────────────────────────

const SYSTEM_LOCALIZAR = `Eres un analista de licitaciones públicas peruanas (Ley de Contrataciones del Estado y obras por impuestos).

Te doy un ÍNDICE de coincidencias que ya encontró un programa dentro de un documento de bases. Cada línea trae la página y el renglón donde cayó.

Tu ÚNICA tarea es decidir, para cada familia, QUÉ RANGO DE PÁGINAS hay que leer en detalle. No extraes datos todavía.

REGLAS:
- Elige rangos CORTOS y contiguos (de 1 a 12 páginas). Un rango de 40 páginas no sirve: significa que no lo encontraste.
- Si una familia no está en el índice, devuélvela con "encontrada": false y rango null. NO inventes páginas.
- Un rótulo en el índice de contenidos (una línea suelta con puntos y un número) NO es la sección: es su referencia. Prefiere la página donde el rótulo aparece con texto alrededor.
- Puedes devolver hasta 2 rangos por familia si la sección está partida.

Responde SOLO con este JSON, sin markdown:
{
  "personal":     { "encontrada": true, "rangos": [{"desde": 41, "hasta": 47}], "por_que": "..." },
  "empresa":      { "encontrada": true, "rangos": [{"desde": 48, "hasta": 50}], "por_que": "..." },
  "cronograma":   { "encontrada": true, "rangos": [{"desde": 12, "hasta": 13}], "por_que": "..." },
  "evaluacion":   { "encontrada": false, "rangos": [], "por_que": "no aparece en el índice" },
  "presentacion": { "encontrada": true, "rangos": [{"desde": 30, "hasta": 36}], "por_que": "..." },
  "proceso":      { "encontrada": true, "rangos": [{"desde": 1, "hasta": 4}], "por_que": "..." }
}`;

const SYSTEM_EXTRAER = `Eres un analista de licitaciones públicas peruanas. Te doy el TEXTO de unas páginas de las bases (con marcadores "<!-- página N -->") y extraes los requisitos EXACTAMENTE como están escritos.

LA REGLA QUE MANDA SOBRE TODAS: cada dato que devuelvas debe venir con "fuente_cita", que es una frase COPIADA LITERAL del texto que te di —palabra por palabra, sin corregir, sin resumir y sin traducir— y con "fuente_pagina", el número del marcador de página donde está esa frase. Un programa va a buscar esa frase en el documento: si no aparece tal cual, el dato se descarta y alguien tiene que revisarlo a mano. NO inventes una cita para acompañar un dato que dedujiste.

QUÉ ES CADA CAMPO (son cinco criterios distintos y se confunden entre sí):
- "meses_minimos": experiencia ESPECÍFICA mínima en el cargo, en MESES. "03 años" = 36.
- "meses_generales_minimos": experiencia GENERAL (desde la colegiatura), en MESES. Es otro número; si las bases solo piden uno, deja el otro en 0.
- "participaciones_minimas": cuántas obras/servicios distintos exige. "mínimo 02 participaciones" = 2. Ojo: DOS obras simultáneas son UNA suma de meses pero DOS participaciones.
- "meses_por_participacion": duración mínima de CADA participación. "no menor a 02 meses cada participación" = 2.
- "ventana_anios": "en los últimos 10 años" = 10. Sin ventana, null.
- "cargos_equivalentes": la lista de cargos que las bases aceptan como equivalentes ("Residente de obra y/o Supervisor de obra y/o Inspector..."). Cópialos todos.

🔴 UN PUESTO ES UNA PERSONA, NO LA EMPRESA. Solo van en "requisitos" los CARGOS QUE OCUPA UN PROFESIONAL: Residente de Obra, Jefe de Supervisión, Especialista en …, Asistente de Residente, Maestro de Obra, Ingeniero de Seguridad, Arqueólogo, Ingeniero Ambiental, Ingeniero de Calidad, Administrador de Obra, Topógrafo.
NO son puestos y NO van en esa lista: «el Postor», «el Ejecutor del Proyecto», «la Empresa Privada», «la Entidad Privada Supervisora», «el Consorcio», «el Contratista». Esas son LA EMPRESA. Lo que se les exige —monto facturado acumulado, X veces el valor referencial, facturación, capacidad libre de contratación, patrimonio— va en "requisitos_empresa", nunca en el plantel. La prueba fácil: si la exigencia se mide en DINERO, es de la empresa; si se mide en MESES o PARTICIPACIONES de una persona colegiada, es del plantel.

BUSCA TODOS LOS PUESTOS DEL TRAMO, no solo el primero. Unas bases piden entre tres y ocho profesionales y cada uno tiene su propio párrafo con sus propios números. Si el texto nombra cinco cargos, devuelve cinco entradas.

DISTINGUE REQUISITO DE FACTOR DE EVALUACIÓN. Un REQUISITO DE CALIFICACIÓN es obligatorio: no cumplirlo descalifica. Un FACTOR DE EVALUACIÓN da puntaje: no cumplirlo solo resta puntos. Van a listas distintas y confundirlos es el error más caro de este trabajo.

NO INVENTES:
- Si las bases no dicen un número, el campo va en 0 o null. Nunca en un valor "típico".
- Si un puesto se nombra pero sus requisitos están en otra página que no te di, ponlo en "alertas" y no lo inventes.
- Si el texto viene de un OCR y una cifra es ilegible, dilo en "alertas".

Si en el mismo tramo encuentras una exigencia para LA EMPRESA (experiencia del postor por monto acumulado, facturación, capacidad de contratación, RNP), ponla en "requisitos_empresa" con su "tipo": experiencia_postor · facturacion · capacidad_contratacion · rnp · patrimonio · habilitacion · otro. Es muy común que estén en la misma sección de «REQUISITOS DE CALIFICACIÓN» que el plantel.

Responde SOLO con este JSON, sin markdown:
{
  "proceso": { "nomenclatura": null, "objeto": null, "entidad_convocante": null, "entidad_ruc": null, "valor_referencial": null, "moneda": "PEN", "fecha_presentacion": null, "definicion_obras_similares": null },
  "requisitos_empresa": [ { "tipo": "experiencia_postor", "descripcion": "...", "monto_minimo": null, "multiplo_valor_referencial": null, "ventana_anios": null, "fuente_pagina": 47, "fuente_cita": "..." } ],
  "requisitos": [
    { "clase": "personal", "cargo": "Jefe de Supervisión del Proyecto", "profesion": "Ingeniero Civil",
      "meses_minimos": 36, "meses_generales_minimos": 0, "participaciones_minimas": 2,
      "meses_por_participacion": 2, "ventana_anios": 10,
      "cargos_equivalentes": ["Residente de obra", "Supervisor de obra"],
      "exige_colegiatura": true, "exige_sustento": true,
      "fuente_pagina": 47, "fuente_cita": "Experiencia no menor de 03 años, sustentada con...", "notas": null }
  ],
  "factores_evaluacion": [ { "factor": "...", "puntaje_maximo": 20, "fuente_pagina": 51, "fuente_cita": "..." } ],
  "cronograma": [ { "etapa": "Presentación de ofertas", "fecha": "2026-10-15", "fuente_pagina": 12, "fuente_cita": "..." } ],
  "alertas": ["lo que una persona tiene que revisar"]
}`;

// ── El proceso entero: lo que la convocatoria y las bases dicen del
//    trabajo, del dinero, del calendario y de CÓMO se puede participar. ──
//
// Gabriel (8-set-2026): «las bases tienen mucha información… el costo
// estimado, el nombre que ellos agarran y te piden… y sé más abierto con cómo
// empezar a participar: usualmente se hacen consorcios». Este prompt es esa
// apertura: además del plantel, saca los requisitos de la EMPRESA y las reglas
// de consorcio, que son la forma real de llegar a la experiencia o al capital.
// ── Lo que la NORMA dice, para que el modelo no lo adivine ─────────
//
// Investigado el 8-set-2026 contra los documentos oficiales: DS 038-2026-EF
// (reglamento vigente de la Ley 29230, publicado el 13-mar-2026), Ley 32069 y
// su DS 009-2025-EF, las bases estándar del MEF (Directiva 0005-2025-EF/54.01)
// y cinco juegos de bases reales. Tres cosas que el modelo se inventaba y
// ahora tiene escritas:
//
//   · En Obras por Impuestos con Empresa Privada, el SOBRE 2 ES LA ECONÓMICA y
//     el 3 la TÉCNICA. Se abre primero la económica, se elige la más favorable
//     y recién ahí se evalúa la técnica de ESE postor. En las bases de la
//     Entidad Privada Supervisora es al revés: 1 técnica, 2 económica.
//   · La garantía de fiel cumplimiento en OxI-Empresa Privada es 4%, NO 10%.
//     Y en OxI no existen los adelantos.
//   · La Ley 32069 cambió el vocabulario entero: «cuantía de la contratación»
//     en vez de valor referencial, «especialidad y subespecialidad» en vez de
//     obras similares, y la experiencia se mide sobre 25 años, no 10.
const CONTEXTO_NORMATIVO = `
CONTEXTO NORMATIVO PERUANO (verificado contra las normas vigentes; úsalo para
reconocer, NUNCA para rellenar un dato que el texto no diga):

A) OBRAS POR IMPUESTOS — Ley N° 29230, Reglamento DS N° 038-2026-EF.
   Vocabulario propio: «Empresa Privada» (la que financia) NO es lo mismo que
   «Ejecutor» o «Empresa Ejecutora» (la que construye, y es la que necesita
   RNP) ni que «Entidad Privada Supervisora». Se firma un CONVENIO DE
   INVERSIÓN, no un contrato. El dinero se llama MONTO REFERENCIAL DEL
   CONVENIO DE INVERSIÓN. Convoca un COMITÉ ESPECIAL. El proyecto lleva CUI.
   Se paga con CIPRL o CIPGN.
   · Bases de EMPRESA PRIVADA: TRES sobres. Sobre 1 CREDENCIALES (requisitos
     legales, información financiera, patrimonio neto), Sobre 2 PROPUESTA
     ECONÓMICA, Sobre 3 PROPUESTA TÉCNICA. En ese orden: la económica se abre
     ANTES que la técnica.
   · Bases de ENTIDAD PRIVADA SUPERVISORA: DOS sobres. Sobre 1 PROPUESTA
     TÉCNICA, Sobre 2 PROPUESTA ECONÓMICA. Se ponderan 80% técnica y 20%
     económica como mínimo y máximo respectivamente.
   · Se admiten ofertas entre el 90% y el 110% del monto referencial.
   · Garantía de fiel cumplimiento: 4% para la Empresa Privada (solo carta
     fianza), 10% para la Entidad Privada Supervisora.
   · Garantía de apelación: 3% del monto referencial.
   · NO HAY ADELANTOS en este régimen. Si el texto no menciona adelantos, no
     los inventes.

B) LEY N° 32069 (contrataciones públicas, vigente desde abril de 2025).
   NO HAY SOBRES: la oferta se sube como archivo digitalizado a la plataforma
   (Pladicop). El dinero se llama CUANTÍA DE LA CONTRATACIÓN. La experiencia
   del postor se acredita en la ESPECIALIDAD Y SUBESPECIALIDAD (no «obras
   similares») sobre los ÚLTIMOS 25 AÑOS, por un monto que no puede superar
   UNA VEZ la cuantía. Los rótulos son «Documentación de presentación
   obligatoria», «Documentos para la admisión de la oferta», «Requisitos de
   calificación obligatorios» y «adicionales». Fiel cumplimiento 10%, y admite
   fideicomiso, carta fianza, contrato de seguro o retención de pago. Ofertas
   admitidas entre 95% y 110%. La suma de la penalidad por mora y las otras
   penalidades no puede pasar el 10%.

C) LEY N° 30225 (régimen anterior, todavía aparece en bases viejas).
   VALOR REFERENCIAL, OBRAS SIMILARES, últimos 10 años, PLANTEL PROFESIONAL
   CLAVE, carta fianza o póliza de caución, cuaderno de obra.

D) PENALIDAD POR MORA, fórmula estándar en los tres regímenes:
   penalidad diaria = (0.10 x monto) / (F x plazo en días)
   F = 0.40 si el plazo es de 60 días o menos; F = 0.15 si es mayor. En la Ley
   32069 hay una franja intermedia con F = 0.25 entre 61 y 120 días.
`;

const SYSTEM_PROCESO = `Eres un analista de licitaciones públicas peruanas (Ley de Contrataciones del Estado, Obras por Impuestos Ley 29230 y procesos privados).
${CONTEXTO_NORMATIVO} Te doy el TEXTO de unas páginas de una convocatoria o de unas bases (con marcadores "<!-- página N -->") y extraes los DATOS DEL PROCESO, el CALENDARIO, las REGLAS DE CONSORCIO y los REQUISITOS DE LA EMPRESA postora. NO extraes el plantel profesional: eso lo hace otra pasada.

LA REGLA QUE MANDA: cada dato con número o fecha viene con "fuente_cita" —una frase COPIADA LITERAL del texto, palabra por palabra— y "fuente_pagina", que es el número del marcador «<!-- página N -->» donde está esa frase. Un programa la busca en el documento; si no aparece tal cual, el dato se marca para revisión. NO inventes citas.

SOBRE LO QUE TE DIERON: recibes UN TRAMO del documento, no el documento entero. Si el índice de contenidos menciona un anexo cuyo contenido no está en el texto, NO lo reportes como faltante más de una vez y NO inventes su contenido: otras pasadas cubren esas partes. Extrae lo que SÍ está en el texto que tienes.

QUÉ ES CADA COSA:
- "nombre_inversion": el nombre LARGO del proyecto tal como lo escribe la entidad, entre comillas en el documento («MEJORAMIENTO Y AMPLIACION DEL SERVICIO DE…»). Cópialo completo: las cartas del expediente lo citan textual.
- "objeto": qué se contrata, en una línea corta (ej. «Ejecución y financiamiento del proyecto…» o «Supervisión de la ejecución hasta la liquidación…»).
- "cui": Código Único de Inversión, 7 dígitos («CUI N° 2611946»).
- "nomenclatura": el número del proceso («PROCESO DE SELECCIÓN N° 021-2026-CEPIP-GRDE-OXI-GORECAJ-PRIMERA CONVOCATORIA», «LP-SM-1-2026-MDCH-1»).
- "mecanismo": "oxi" si es Obras por Impuestos / Ley 29230 / convenio de inversión / CIPRL / CIPGN / Comité Especial; "ley_contrataciones" si es licitación o adjudicación bajo la Ley 32069 o la 30225 (Pladicop, SEACE, OECE, OSCE); "privado" si convoca una empresa privada; si no se sabe, null.
- "valor_referencial" se llama distinto en cada régimen y todos valen: «monto referencial del convenio de inversión» (Obras por Impuestos), «cuantía de la contratación» (Ley 32069), «valor referencial» (Ley 30225).
- "valor_referencial": el monto TOTAL del proceso (en OxI: «monto referencial del convenio de inversión»). Número sin separadores: «S/ 1,234,567.89» = 1234567.89.
- "monto_ejecucion" y "monto_supervision": el DESGLOSE cuando existe («contempla el financiamiento de la ejecución S/ …, la supervisión S/ … y la liquidación S/ …»). Si la convocatoria es de SUPERVISIÓN, el valor_referencial es el costo de la supervisión. Toma SIEMPRE las cifras del texto que te di; los números de este instructivo son ejemplos de formato, no datos del proceso.
- "plazo_ejecucion_dias": en días calendario. Si dice meses, conviértelo (1 mes = 30 días) y dilo en alertas.
- "tipo_objeto_sugerido": "obra_ejecucion" (empresa que ejecuta/financia la obra) · "supervision" (entidad privada supervisora, supervisión de obra) · "obra_expediente" (solo elaborar el expediente técnico) · "bienes_servicios" · null si no está claro. Es una SUGERENCIA: una persona la confirma.
- "fecha_presentacion": la fecha de PRESENTACIÓN DE PROPUESTAS u OFERTAS (no la de expresión de interés ni la de consultas). Formato YYYY-MM-DD.
- "definicion_obras_similares": el texto con el que ESTA entidad define qué cuenta como obra igual o similar, si está.

CALENDARIO: cada etapa con "desde" y "hasta" (YYYY-MM-DD; si es un solo día, hasta = null). Copia el nombre de la etapa como está («Presentación de Expresiones de interés», «Absolución de consultas», «Integración de bases», «Presentación de Propuestas», «Otorgamiento de la Buena Pro», «Suscripción del Convenio»). Un rango «09/09/2026 – 17/09/2026» es desde=2026-09-09, hasta=2026-09-17.

CONSORCIO: si el documento dice que puede participar «Empresa Privada o Consorcio», «persona natural o jurídica o consorcio», o describe la promesa formal de consorcio, "permitido" es true. Copia en "reglas" lo que exija: porcentaje mínimo de participación, máximo de integrantes, que la experiencia se acredite por el consorciado que la aporta, que el representante común firme, etc. Si no dice nada, "permitido": null (no inventes que está prohibido).

REQUISITOS DE LA EMPRESA (lo que descalifica al POSTOR, no a su personal). El campo "tipo" es OBLIGATORIO y solo puede ser uno de estos siete, exactamente así escrito:
  "experiencia_postor"      — experiencia en obras/servicios similares o en la especialidad, por monto acumulado
  "facturacion"             — facturación o ventas mínimas
  "capacidad_contratacion"  — capacidad libre de contratación (CLC)
  "rnp"                     — inscripción vigente en el Registro Nacional de Proveedores
  "patrimonio"              — patrimonio neto mínimo
  "habilitacion"            — habilitación, autorización o registro sectorial para prestar el servicio
  "otro"                    — SOLO si de verdad no encaja en ninguno de los seis anteriores
Elegir "otro" cuando el requisito habla del RNP, de facturación o de experiencia es un ERROR: mira la lista antes de responder.
Cada uno con "descripcion" (la exigencia en una línea), "monto_minimo" (número o null), "multiplo_valor_referencial" (el X de «X veces el valor referencial», o null), "ventana_anios" (o null) y su cita.

NO ES UN REQUISITO DE CALIFICACIÓN y NO va en esta lista: un artículo del Reglamento copiado (impedimentos para contratar, prohibiciones generales, definiciones), una regla de procedimiento, ni un FACTOR DE EVALUACIÓN (ése da puntaje y va a su propia lista). Un requisito de calificación es algo que el postor ACREDITA con un documento suyo y que, si no cumple, lo descalifica.

LA EXPERIENCIA DEL POSTOR ES EL REQUISITO MÁS IMPORTANTE Y EL QUE MÁS SE PIERDE. Se escribe de dos maneras según el régimen y las DOS cuentan:
  · «monto facturado acumulado equivalente a X veces el VALOR REFERENCIAL en la ejecución de OBRAS SIMILARES durante los últimos 10 años» (Ley 30225 y la mayoría de las bases de Obras por Impuestos);
  · «monto facturado acumulado equivalente a … la CUANTÍA DE LA CONTRATACIÓN, en la ejecución de obras en la ESPECIALIDAD Y LAS SUBESPECIALIDADES correspondientes durante los 25 años anteriores» (Ley 32069).
Guarda el múltiplo en "multiplo_valor_referencial", los años en "ventana_anios", y en "obras_similares" el texto con el que ESAS bases definen qué obra cuenta (suele ser una lista larga: «edificaciones en general y/o mercados y/o colegios y/o…», o la especialidad y subespecialidad). Ese texto decide si nuestra experiencia sirve, así que cópialo entero.
Para la Entidad Privada Supervisora la exigencia suele ser en cantidad y no en dinero: «experiencia mínima como supervisora en dos (2) proyectos similares durante los últimos diez (10) años». Eso también es "experiencia_postor".

FACTORES DE EVALUACIÓN: los que dan PUNTAJE («Experiencia del postor: 40 puntos», «Mejoras a las condiciones: 20 puntos»). Cada uno con su puntaje máximo y el criterio con que se asigna.

GARANTÍAS: fiel cumplimiento, adelanto directo, adelanto de materiales, seriedad de oferta, garantía de apelación. Con su porcentaje (10 = 10%) o su monto, y el detalle («carta fianza solidaria, incondicional, irrevocable y de realización automática»). "tipo": fiel_cumplimiento · adelanto_directo · adelanto_materiales · seriedad_oferta · otra.
TOMA EL PORCENTAJE DEL TEXTO, no de lo que suele ser: en Obras por Impuestos el fiel cumplimiento de la Empresa Privada es 4% y el de la Supervisora 10%, mientras que en la Ley de Contrataciones es 10%. Y en Obras por Impuestos NO existen los adelantos: si el texto no los menciona, la lista va sin ellos.

PENALIDADES: la de MORA (con su fórmula, por ejemplo «0.10 × monto / (F × plazo)») y las OTRAS penalidades que la entidad liste, con su tope («hasta el 10% del monto del contrato»).

DOCUMENTOS DE PRESENTACIÓN: qué hay que meter en cada sobre. Un renglón por documento, con el sobre al que va y si es obligatorio. Copia el nombre del documento como lo escriben («Anexo N° 1 - Declaración jurada de datos del postor», «Formato N° 6: Promesa formal de consorcio»).
COPIA EL SOBRE TAL COMO LO DICE EL DOCUMENTO y no lo deduzcas del contenido: en Obras por Impuestos con Empresa Privada el Sobre 2 es la ECONÓMICA y el 3 la TÉCNICA, mientras que en las bases de la Supervisora el 1 es la técnica. Poner «Sobre 2» porque «ahí suele ir la técnica» es un error.
Si el proceso es de la Ley 32069 no hay sobres: usa «Oferta técnica» y «Oferta económica» como valor del campo "sobre".

CONDICIONES A CONSIDERAR: lo que cambia la decisión de presentarse y no es un requisito ni un factor. El campo "tipo" solo puede ser uno de estos ocho, exactamente así: "adelanto" (¿la entidad da adelantos y de cuánto?) · "forma_pago" (valorizaciones, plazos de pago, límites de la oferta económica) · "visita_obra" (si hay visita y si es obligatoria, con fecha) · "plazo_firma" (cuántos días para firmar el contrato o convenio) · "subcontratacion" (si se permite y hasta qué porcentaje) · "seguros" (SCTR, CAR, responsabilidad civil) · "personal_obligatorio" (personal que debe estar permanentemente en obra) · "otra". Usa "otra" solo si de verdad no encaja. Cada una con "titulo" corto y "detalle".

NO INVENTES: si un dato no está en el texto que te di, va en null y la lista va vacía. No pongas una penalidad «típica» ni una garantía «estándar» del 10% si el texto no la dice. Si un monto es ilegible por el OCR, dilo en "alertas". Si el texto es una publicación con varias convocatorias, quédate con la que corresponde al proceso principal del texto y avísalo.

Responde SOLO con este JSON, sin markdown:
{
  "proceso": {
    "nomenclatura": null, "objeto": null, "nombre_inversion": null, "cui": null,
    "entidad_convocante": null, "entidad_ruc": null, "mecanismo": null, "tipo_objeto_sugerido": null,
    "valor_referencial": null, "moneda": "PEN", "monto_ejecucion": null, "monto_supervision": null,
    "plazo_ejecucion_dias": null, "lugar": null, "sistema_contratacion": null,
    "fecha_presentacion": null, "definicion_obras_similares": null,
    "fuente_pagina": 1, "fuente_cita": "la frase donde está el monto referencial"
  },
  "cronograma": [ { "etapa": "Presentación de Propuestas", "desde": "2026-09-23", "hasta": "2026-09-24", "fuente_pagina": 1, "fuente_cita": "..." } ],
  "consorcio": { "permitido": true, "max_integrantes": null, "porcentaje_minimo": null, "reglas": "...", "fuente_pagina": 1, "fuente_cita": "..." },
  "requisitos_empresa": [ { "tipo": "experiencia_postor", "descripcion": "...", "monto_minimo": null, "multiplo_valor_referencial": null, "ventana_anios": null, "obras_similares": null, "fuente_pagina": 48, "fuente_cita": "..." } ],
  "factores_evaluacion": [ { "factor": "...", "puntaje_maximo": null, "criterio": "...", "fuente_pagina": 51, "fuente_cita": "..." } ],
  "garantias": [ { "tipo": "fiel_cumplimiento", "porcentaje": null, "monto": null, "detalle": "...", "fuente_pagina": 60, "fuente_cita": "..." } ],
  "penalidades": [ { "tipo": "mora", "formula": "...", "tope": "...", "detalle": "...", "fuente_pagina": 62, "fuente_cita": "..." } ],
  "documentos_presentacion": [ { "sobre": "Sobre N° 1", "documento": "Anexo N° 1 - Declaracion jurada de datos del postor", "obligatorio": true, "fuente_pagina": 30, "fuente_cita": "..." } ],
  "condiciones": [ { "tipo": "adelanto", "titulo": "Adelanto directo del 10%", "detalle": "...", "fuente_pagina": 58, "fuente_cita": "..." } ],
  "alertas": ["lo que una persona tiene que revisar"]
}`;

// ── El CV de un profesional → su ficha. ────────────────────────────
//
// Medido sobre el CV real (8-set-2026): 8 páginas de currículum nativo y 31 de
// constancias escaneadas. Son dos lecturas distintas: la primera saca la
// ficha y la lista de experiencias DECLARADAS; la segunda lee cada constancia
// y dice qué certifica. El código las cruza: una experiencia con constancia
// es SUSTENTADA (evidencia_id + página), y en un proceso solo vale lo
// sustentado. Sin este cruce el padrón se llenaría de meses que nadie puede
// presentar.
const SYSTEM_CV_FICHA = `Eres un analista de RR.HH. de una constructora peruana. Te doy el TEXTO de un currículum (con marcadores "<!-- página N -->") y extraes la FICHA PROFESIONAL y la lista de EXPERIENCIAS LABORALES, cada una como un periodo con fechas.

LA REGLA QUE MANDA: cada experiencia trae "fuente_cita", una frase COPIADA LITERAL del texto (por ejemplo la línea del cargo o del periodo, tal como está escrita) y "fuente_pagina". Un programa la busca en el documento; si no aparece, se marca para revisión. NO inventes citas ni fechas.

FECHAS: siempre YYYY-MM-DD. «09/04/2026» es 2026-04-09 (día/mes/año, formato peruano). «abril de 2013» es 2013-04-01. «a la fecha», «actualidad» o sin fecha de fin = null. Si solo hay año, usa 01-01 y dilo en "alertas".

PERSONA: nombres y apellidos por separado (en Perú van dos apellidos; «Jaime Nelson Ayay Valdez» = nombres «Jaime Nelson», apellidos «Ayay Valdez»). DNI de 8 dígitos, RUC de 11 (10 + DNI + dígito, si es persona natural), celular y correo.

FICHA: "profesion" tal como se presenta («Ingeniero de Sistemas», «Ingeniero Civil», «Arquitecto»); "titulo" (título profesional, si lo dice), "universidad", "anio_egreso"; "colegio": "CIP" (ingenieros), "CAP" (arquitectos), "OTRO" o null; "colegiatura_numero" (el número CIP/CAP); "colegiatura_fecha" (fecha de incorporación al colegio, si aparece; si no, null) y "colegiatura_habil_hasta" (vigencia de la habilidad, si aparece). "especialidades": lista corta de áreas que domina. "capacitaciones": diplomados, cursos y especializaciones, cada uno con nombre, institución, horas (número o null), desde y hasta.

RNP: si el CV adjunta la constancia del Registro Nacional de Proveedores (suele venir como una impresión de la web del RNP, con el RUC arriba), toma "rnp_numero" (normalmente el mismo RUC) y "rnp_vigente_desde" (la fecha de «Vigencia: Desde …»). Si no está, van en null.

EXPERIENCIAS: una por periodo. "entidad" es quién contrató (institución o empresa) con su "entidad_ruc" si figura; "obra_nombre" el proyecto u obra si se nombra (si no, null); "cargo" tal como está escrito; "monto" y "moneda" si el CV lo dice (casi nunca). Periodos repetidos con la misma entidad y cargo son experiencias DISTINTAS: no las fusiones, el programa sabe sumarlas.

NO INVENTES: lo que no esté en el texto va en null. No completes un apellido, un DNI ni una fecha «probable».

Responde SOLO con este JSON, sin markdown:
{
  "persona": { "nombres": null, "apellidos": null, "dni": null, "ruc": null, "celular": null, "email": null, "direccion": null, "fecha_nacimiento": null },
  "ficha": { "profesion": null, "titulo": null, "universidad": null, "anio_egreso": null, "colegio": null, "colegiatura_numero": null, "colegiatura_fecha": null, "colegiatura_habil_hasta": null, "rnp_numero": null, "rnp_vigente_desde": null, "resumen": null, "especialidades": [], "capacitaciones": [ { "nombre": "...", "institucion": "...", "horas": 384, "desde": "2024-01-20", "hasta": "2024-03-27" } ] },
  "experiencias": [ { "entidad": "...", "entidad_ruc": null, "obra_nombre": null, "cargo": "...", "fecha_inicio": "2026-04-09", "fecha_fin": "2026-07-09", "monto": null, "moneda": "PEN", "fuente_pagina": 2, "fuente_cita": "Periodo: 09/04/2026 hasta el 09/07/2026" } ],
  "alertas": []
}`;

const SYSTEM_CV_CONSTANCIAS = `Eres un analista de RR.HH. de una constructora peruana. Te doy el TEXTO (leído por OCR) de las páginas escaneadas que acompañan un currículum: constancias y certificados de trabajo, contratos, órdenes de servicio, conformidades, diplomas, certificados de cursos, DNI, ficha RUC, constancia del RNP. Cada página empieza con "<!-- página N -->".

Tu tarea: decir QUÉ ES cada documento y QUÉ CERTIFICA, para que un programa lo cruce con la experiencia declarada en el currículum. Un documento puede ocupar más de una página ("pagina_desde"/"pagina_hasta").

LA REGLA QUE MANDA: cada documento trae "fuente_cita", una frase COPIADA LITERAL del texto OCR (aunque tenga errores de OCR, cópiala tal cual). NO inventes.

TIPOS: "constancia_trabajo" (constancia o certificado de trabajo/servicios/prestación), "contrato" (contrato de trabajo o de locación de servicios), "conformidad" (conformidad de servicio, acta), "orden_servicio", "diploma_colegiatura" (diploma de incorporación al colegio profesional), "habilidad_colegio" (certificado de habilidad vigente), "titulo" (título profesional o diploma universitario), "grado" (bachiller, maestría), "certificado_curso" (diplomado, curso, capacitación), "dni", "rnp" (constancia del Registro Nacional de Proveedores), "ruc" (ficha RUC / CIR de SUNAT), "otro".

Para los de trabajo (constancia_trabajo, contrato, conformidad, orden_servicio): "emisor" (quién lo firma o emite, la entidad o empresa), "emisor_ruc", "persona_nombre" (a quién certifica), "cargo", "obra_nombre" (el proyecto u obra, si se nombra), "fecha_inicio" y "fecha_fin" del periodo certificado (YYYY-MM-DD; «09/04/2026» = 2026-04-09), "monto" si el documento lo dice.
Para diploma_colegiatura / habilidad_colegio: "colegiatura_numero", "colegiatura_fecha" (incorporación) o "habil_hasta".
Para certificado_curso: "curso_nombre", "curso_institucion", "curso_horas", "fecha_inicio", "fecha_fin".
Para dni: "dni". Para ruc/rnp: "ruc".
"fecha_emision": cuándo se emitió el documento, si está.

Responde SOLO con este JSON, sin markdown:
{
  "documentos": [
    { "tipo": "constancia_trabajo", "pagina_desde": 12, "pagina_hasta": 12, "emisor": "...", "emisor_ruc": null, "persona_nombre": "...", "cargo": "...", "obra_nombre": null, "fecha_inicio": "2025-05-01", "fecha_fin": "2025-07-29", "monto": null, "moneda": "PEN", "fecha_emision": null, "colegiatura_numero": null, "colegiatura_fecha": null, "habil_hasta": null, "curso_nombre": null, "curso_institucion": null, "curso_horas": null, "dni": null, "ruc": null, "fuente_cita": "..." }
  ],
  "alertas": []
}`;

// ── Mistral OCR de UNA página (imagen). Ver el comentario de arriba sobre
//    por qué está duplicado y no importado. ──────────────────────────
async function ocrDeImagen(base64, mimeType, apiKey, deadline) {
  const dataUri = `data:${mimeType};base64,${base64}`;
  const body = { model: OCR.modelo, document: { type: 'image_url', image_url: dataUri }, include_image_base64: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(30000, Math.max(deadline - Date.now(), 1000)));
  // Sin `= null`: si el fetch lanza, el error sube y nadie lee la variable.
  let upstream;
  try {
    upstream = await fetch(MISTRAL_OCR_URL, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } finally { clearTimeout(timer); }
  if (!upstream || !upstream.ok) {
    const err = new Error(`mistral ocr ${upstream ? upstream.status : 'sin respuesta'}`);
    if (upstream) err.upstreamStatus = upstream.status;
    throw err;
  }
  const data = await upstream.json();
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  return pages.map(p => (typeof p?.markdown === 'string' ? p.markdown : ''))
    .join('\n\n').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
}

/** El JSON de la respuesta, venga pelado o envuelto en ```json. */
function jsonDeTexto(txt) {
  const s = String(txt || '').trim();
  const sinCerca = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(sinCerca); } catch { /* sigue abajo */ }
  const i = sinCerca.indexOf('{'), j = sinCerca.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try { return JSON.parse(sinCerca.slice(i, j + 1)); } catch { /* nada */ }
  }
  return null;
}

async function pasadaDeTexto({ system, user, deadline, maxTokens, razonamiento = 'bajo' }) {
  const cfg = leerConfig(process.env);
  if (!cfg.activo) {
    const err = new Error('El motor de texto no está configurado (falta OPENROUTER_API_KEY)');
    err.status = 503; err.code = 'ia_no_configurada';
    throw err;
  }
  const body = construirCuerpo({
    modelo: cfg.modelo, respaldos: cfg.respaldos, politica: cfg.politica,
    system, user, maxTokens, razonamiento,
  });
  const data = await openrouterChat(cfg.apiKey, body, deadline);
  const r = normalizarRespuesta(data);
  // `normalizarRespuesta` devuelve la forma de Anthropic (content[]), no un
  // texto pelado: es la misma que ya consume Captura Mágica.
  const texto = r.content?.[0]?.text || '';
  return {
    json: jsonDeTexto(texto),
    texto,
    // El modelo REALMENTE servido, que con una cadena de respaldos puede no ser
    // el titular. Se devuelve al cliente y se guarda: cuando una extracción
    // salga mal hay que saber quién la hizo.
    model: r.model || cfg.modelo,
    usage: r.usage || null,
    // OpenRouter informa el costo real de la llamada. Con un gratuito es 0, y
    // ese 0 es un dato medido, no un supuesto.
    costo: r.costo,
    cortado: r.stop_reason === 'max_tokens',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const { profile } = await requireAuth(req);
    const body = req.body || {};
    const accion = String(body.accion || '').trim();
    // El OCR y la lectura de CV los usa también RR.HH. (escribe la ficha
    // profesional, mig 171); las bases siguen siendo del equipo de propuestas.
    const rolesDeAccion = (accion === 'ocr' || accion === 'extraer_cv') ? ROLES_CV : ROLES;
    if (!rolesDeAccion.includes(profile?.rol)) {
      return res.status(403).json({ error: accion === 'extraer_cv'
        ? 'Solo RR.HH., licitaciones, gerencia o administración pueden leer un CV'
        : 'Solo licitaciones, gerencia o administración pueden analizar bases' });
    }
    // Una base de 96 páginas son ~16 tandas de OCR más 2 pasadas: el tope deja
    // pasar dos documentos completos por minuto y corta el abuso.
    rateLimit(req, { windowMs: 60_000, max: 40, key: `bases:${profile?.id || 'anon'}` });

    const deadline = Date.now() + 52_000;

    // ── OCR de una tanda de páginas ────────────────────────────────
    if (accion === 'ocr') {
      const apiKey = process.env.MISTRAL_API_KEY;
      if (!apiKey) return res.status(503).json({ error: 'El OCR no está configurado (falta MISTRAL_API_KEY)', code: 'ia_no_configurada' });

      const paginas = Array.isArray(body.paginas) ? body.paginas : [];
      if (!paginas.length) return res.status(422).json({ error: 'No mandaste páginas' });
      if (paginas.length > MAX_PAGINAS_TANDA) {
        return res.status(422).json({ error: `Máximo ${MAX_PAGINAS_TANDA} páginas por tanda` });
      }

      const textos = {};
      const fallidas = [];
      for (const p of paginas) {
        const clave = String(p?.clave || `pdf:p${p?.n}`);
        const mime = String(p?.mimeType || 'image/jpeg');
        if (!/^image\/(jpeg|png|webp)$/.test(mime)) { fallidas.push({ clave, motivo: 'tipo no permitido' }); continue; }
        const b64 = String(p?.imagen || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
        if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) { fallidas.push({ clave, motivo: 'imagen inválida' }); continue; }
        if (b64.length > MAX_BASE64_PAGINA) { fallidas.push({ clave, motivo: 'página demasiado pesada' }); continue; }
        // Si se acabó el tiempo, se devuelve lo hecho y el cliente reintenta el
        // resto: una tanda a medias es recuperable, un 504 no dice qué se leyó.
        if (Date.now() > deadline - 6000) { fallidas.push({ clave, motivo: 'sin tiempo en esta tanda' }); continue; }
        try {
          textos[clave] = await ocrDeImagen(b64, mime, apiKey, deadline);
        } catch (e) {
          fallidas.push({ clave, motivo: e?.upstreamStatus ? `OCR ${e.upstreamStatus}` : 'OCR falló' });
        }
      }
      return res.status(200).json({
        textos, fallidas, model: OCR.modelo,
        paginasLeidas: Object.keys(textos).length,
      });
    }

    // ── Pase 1: dónde está cada cosa ───────────────────────────────
    if (accion === 'localizar') {
      const indice = body.indice && typeof body.indice === 'object' ? body.indice : null;
      if (!indice) return res.status(422).json({ error: 'Falta el índice' });
      const comoTexto = JSON.stringify(indice).slice(0, 60_000);
      const r = await pasadaDeTexto({
        system: SYSTEM_LOCALIZAR,
        user: `ÍNDICE DE COINCIDENCIAS (página → renglón encontrado):\n${comoTexto}\n\nDevuelve el JSON de rangos.`,
        // 🔴 ESTE TECHO ERA 1.200 Y POR ESO EL PASO 1 FALLABA SIEMPRE.
        // Medido el 8-set-2026: falló en las dos pruebas reales de Gabriel,
        // con el mensaje «el modelo no devolvió un JSON de rangos legible».
        // La causa no era el modelo: los gratuitos con ZDR son modelos de
        // RAZONAMIENTO y piensan en voz alta ANTES del JSON, y ese
        // pensamiento cuenta contra el techo. lib/openrouter.js ya lo tenía
        // medido para Captura Mágica —1.571 tokens de salida donde Haiku
        // usaba 493— y este paso pedía menos que eso. Nunca llegaba a
        // escribir la primera llave.
        deadline, maxTokens: 8000,
      });
      if (r.cortado) {
        return res.status(502).json({
          error: 'El modelo se quedó sin espacio antes de terminar el JSON de rangos',
          code: 'respuesta_cortada',
        });
      }
      if (!r.json) return res.status(502).json({ error: 'El modelo no devolvió un JSON de rangos legible', code: 'respuesta_ilegible' });
      return res.status(200).json({ rangos: r.json, model: r.model, usage: r.usage, costo: r.costo });
    }

    // ── Pase 2: los requisitos, con su cita ────────────────────────
    if (accion === 'extraer') {
      const texto = String(body.texto || '');
      if (!texto.trim()) return res.status(422).json({ error: 'No mandaste texto para extraer' });
      if (texto.length > MAX_TEXTO_PASADA) {
        return res.status(422).json({ error: `El rango es demasiado grande (${texto.length} caracteres). Achica el rango de páginas.` });
      }
      // La familia elige el prompt: el plantel tiene sus cinco criterios; el
      // proceso, la empresa y el calendario van juntos porque en una
      // convocatoria de una página están en el mismo texto.
      const seccion = String(body.seccion || 'personal');
      const esProceso = seccion === 'proceso' || seccion === 'empresa' || seccion === 'cronograma';
      const r = await pasadaDeTexto({
        system: esProceso ? SYSTEM_PROCESO : SYSTEM_EXTRAER,
        user: `TEXTO DE LAS BASES:\n\n${texto}\n\nExtrae el JSON. Recuerda: cada dato con su cita literal y su página.`,
        // Los gratuitos razonan en voz alta antes del JSON y eso también
        // cuenta contra el techo (ver presupuestoSalida en lib/openrouter.js).
        // 🔴 EL CORTE FUE EL DEFECTO DOMINANTE del 8-set: «no se pudo extraer
        // personal (páginas 21–23): la respuesta se cortó por tamaño» salió en
        // las tres lecturas de bases. El techo de personal era 5.000 y el
        // modelo lo gastaba razonando. Ahora el máximo, y con razonamiento
        // bajo para que el espacio se use en el JSON. Con un gratuito, pedir
        // de más cuesta USD 0; cortar cuesta la sección entera.
        deadline, maxTokens: 16000,
      });
      if (r.cortado) {
        // El cliente parte el rango en dos y reintenta solo: decirle al
        // usuario «analiza un rango más corto» era pedirle que hiciera a mano
        // lo que el programa puede hacer.
        return res.status(422).json({
          error: 'La respuesta se cortó por tamaño.',
          code: 'respuesta_cortada', chars: texto.length,
        });
      }
      if (!r.json) return res.status(502).json({ error: 'El modelo no devolvió un JSON legible', code: 'respuesta_ilegible' });
      return res.status(200).json({ resultado: r.json, model: r.model, usage: r.usage, costo: r.costo });
    }

    // ── El CV: la ficha declarada, o lo que certifica cada constancia ──
    if (accion === 'extraer_cv') {
      const texto = String(body.texto || '');
      if (!texto.trim()) return res.status(422).json({ error: 'No mandaste texto para extraer' });
      if (texto.length > MAX_TEXTO_PASADA) {
        return res.status(422).json({ error: `El tramo es demasiado grande (${texto.length} caracteres). Manda menos páginas por tanda.` });
      }
      const parte = body.parte === 'constancias' ? 'constancias' : 'ficha';
      const r = await pasadaDeTexto({
        system: parte === 'constancias' ? SYSTEM_CV_CONSTANCIAS : SYSTEM_CV_FICHA,
        user: parte === 'constancias'
          ? `PÁGINAS ESCANEADAS DEL CV (texto OCR):\n\n${texto}\n\nDi qué es cada documento. Recuerda: cada uno con su cita literal.`
          : `TEXTO DEL CURRÍCULUM:\n\n${texto}\n\nExtrae el JSON. Recuerda: cada experiencia con su cita literal y su página; fechas YYYY-MM-DD.`,
        // Un CV con 12 periodos y 10 cursos son ~3.000 tokens de JSON, más el
        // razonamiento. Con 8.000 se cortaba (prueba real del 8-set: «no se
        // pudo leer el currículum»). Al máximo, y razonando poco.
        deadline, maxTokens: 16000,
      });
      if (r.cortado) {
        return res.status(422).json({
          error: 'La respuesta se cortó por tamaño.',
          code: 'respuesta_cortada', chars: texto.length,
        });
      }
      if (!r.json) return res.status(502).json({ error: 'El modelo no devolvió un JSON legible', code: 'respuesta_ilegible' });
      return res.status(200).json({ resultado: r.json, model: r.model, usage: r.usage, costo: r.costo, parte });
    }

    return res.status(422).json({ error: `Acción desconocida: "${accion}"` });
  } catch (err) {
    // sanitizeError ya trae el {status, body} correcto y no filtra detalles
    // upstream en producción. Los errores propios (401/403/429) viajan por acá
    // con su mensaje intacto porque llevan la marca _httpError.
    const { status, body } = sanitizeError(err, 'No se pudo analizar las bases');
    if (err?.code) body.code = err.code;
    return res.status(status).json(body);
  }
}
