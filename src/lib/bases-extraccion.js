// ═══════════════════════════════════════════════════════════════════
// JARVEX — EXTRACCIÓN DE BASES DE LICITACIÓN (tanda 15, entrega 3).
//
// Convierte el markdown híbrido que deja `bases-triage.js` en los datos que
// la app ya sabe usar: los requisitos que come `evaluarRequisito()`, los datos
// del proceso y el cronograma.
//
// NO ES CAPTURA MÁGICA, y no la toca. Son dos problemas distintos:
// Captura Mágica lee UN comprobante nítido de una página y llena un formulario
// de 12 campos. Acá entran 96 páginas escaneadas de las que 8 sirven, y el
// error caro no es equivocarse en un monto: es INVENTAR un requisito que las
// bases no piden (descalifica a gente que sí calificaba) o perderse uno que sí
// piden (se presenta un expediente observado). Por eso todo dato trae su cita
// textual y el código la verifica contra el documento antes de mostrarla.
//
// ── LAS PASADAS, Y POR QUÉ SON ASÍ ────────────────────────────────
// Medido sobre las bases reales (8-set-2026):
//   Chilete Anexo 12 (.docx) : 200.962 chars nativos + 15 páginas a OCR
//   Chilete Anexo 13 (.docx) : 125.064 chars nativos + 17 páginas a OCR
//   BASES INTEGRADAS 009 (pdf): 96 páginas, 94 a OCR — casi todo escaneado
//
// Un documento leído entero son 70–90 mil tokens. Mandarlo así tiene dos
// problemas y ninguno es el precio: los modelos gratuitos con ZDR que usa la
// app tienen ventanas más chicas que eso, y un modelo que recibe 90 mil tokens
// para sacar 8 datos se distrae — es el mismo motivo por el que la Bandeja
// mide contra el catálogo canónico y no contra todo el presupuesto.
//
//   PASE 0 — TRIAGE      (bases-triage.js)  sin IA, gratis
//   PASE 0.5 — ÍNDICE    (este archivo)     sin IA, gratis: dónde está cada cosa
//   PASE 1 — LOCALIZAR   (IA, ~4k tokens)   confirma y elige los rangos
//   PASE 2 — EXTRAER     (IA, ~10k tokens)  solo sobre lo elegido
//   PASE 3 — VERIFICAR   (este archivo)     sin IA: la cita, ¿existe?
//
// El índice del Pase 0.5 es la pieza que hace barata a toda la cadena: se arma
// con `grep`, no con IA, y baja el Pase 1 de 90.000 tokens a 4.000. La IA no
// busca en el documento — elige entre candidatos que ya encontró el código.
//
// EL PASE 3 NO ES UNA TERCERA PASADA DE IA, y es a propósito. Repetir la
// extracción y comparar cuesta el doble y sigue sin saber si el dato existe:
// dos alucinaciones coherentes se confirman entre sí. Verificar que la cita
// aparezca LITERAL en el documento cuesta USD 0 y responde justo esa pregunta.
// Lo que no se verifica no se descarta: se marca y lo revisa una persona.
// ═══════════════════════════════════════════════════════════════════

// ── Familias de sección que se buscan en unas bases peruanas ───────
//
// Los rótulos salen de los documentos reales, no de la imaginación: son los
// que usan las bases del Gobierno Regional de Cajamarca y los modelos de la
// OSCE. Se buscan SIN tildes y en mayúsculas (el OCR se come tildes y cambia
// mayúsculas por minúsculas según la fuente del escaneo).
export const SECCIONES = {
  personal: {
    label: 'Requisitos del plantel profesional',
    claves: [
      'PERSONAL CLAVE', 'PLANTEL PROFESIONAL', 'PERSONAL PROPUESTO',
      'EXPERIENCIA DEL PERSONAL', 'REQUISITOS DE CALIFICACION',
      'RESIDENTE DE OBRA', 'JEFE DE SUPERVISION', 'ESPECIALISTA EN',
      'INGENIERO RESIDENTE', 'SUPERVISOR DE OBRA', 'CALIFICACIONES DEL PLANTEL',
      // Ley 32069: el plantel se llama PERSONAL CLAVE y se parte en dos
      // rótulos —lo que el profesional ES y lo que HIZO— que en las bases
      // estándar son dos secciones distintas y consecutivas.
      'CALIFICACIONES DEL PERSONAL CLAVE', 'EXPERIENCIA DEL PERSONAL CLAVE',
      'PLANTEL PROFESIONAL CLAVE', 'CAPACIDAD TECNICA Y PROFESIONAL',
      'PERSONAL PERMANENTE EN OBRA',
    ],
  },
  empresa: {
    label: 'Requisitos de la empresa',
    claves: [
      'EXPERIENCIA DEL POSTOR', 'EXPERIENCIA EN LA ESPECIALIDAD',
      'FACTURACION', 'OBRAS SIMILARES', 'MONTO FACTURADO ACUMULADO',
      'CAPACIDAD LIBRE DE CONTRATACION', 'REGISTRO NACIONAL DE PROVEEDORES',
      'RNP', 'HABILITACION', 'CAPACIDAD DE CONTRATACION',
      // Los rótulos de las bases de Obras por Impuestos (Anexo 12 de Chilete,
      // medido el 8-set-2026): el postor es «la Empresa Privada o Consorcio».
      'REQUISITOS DE LA EMPRESA PRIVADA', 'PROMESA FORMAL DE CONSORCIO',
      'EMPRESA PRIVADA O CONSORCIO', 'PATRIMONIO NETO',
      'REQUISITOS DEL POSTOR', 'CONSORCIO',
      // Ley 32069 (vigente desde abril de 2025): cambió la terminología
      // entera. Ya no se dice «valor referencial» sino CUANTÍA DE LA
      // CONTRATACIÓN, ni «obras similares» sino ESPECIALIDAD Y SUBESPECIALIDAD,
      // y la experiencia se mide sobre 25 años, no 10.
      'CUANTIA DE LA CONTRATACION', 'REQUISITOS DE CALIFICACION OBLIGATORIOS',
      'REQUISITOS DE CALIFICACION ADICIONALES', 'CAPACIDAD TECNICA Y PROFESIONAL',
      'EQUIPAMIENTO ESTRATEGICO', 'PARTICIPACION EN CONSORCIO',
      'SOLVENCIA ECONOMICA', 'EXPERIENCIA DEL POSTOR EN LA ACTIVIDAD',
      'EXPERIENCIA DEL POSTOR EN LA ESPECIALIDAD', 'ESPECIALIDAD Y SUBESPECIALIDAD',
      // `CAPACIDAD LEGAL` es el primer subtítulo de los requisitos de
      // calificación en las bases estándar y en las de la supervisora, y hoy
      // no estaba: la sección entera empezaba una página después de donde el
      // índice la ubicaba.
      'CAPACIDAD LEGAL', 'REPRESENTACION', 'EQUIPAMIENTO', 'INFRAESTRUCTURA',
      'CONSTANCIA DE PRESTACION', 'REDAM',
    ],
  },
  cronograma: {
    label: 'Calendario del proceso',
    claves: [
      'CRONOGRAMA', 'CALENDARIO DEL PROCEDIMIENTO', 'ETAPAS DEL PROCEDIMIENTO',
      'PRESENTACION DE OFERTAS', 'ABSOLUCION DE CONSULTAS',
      'INTEGRACION DE BASES', 'BUENA PRO', 'REGISTRO DE PARTICIPANTES',
      // La convocatoria de El Peruano (OxI) habla de «proceso de selección»,
      // «propuestas» y «expresiones de interés», no de «procedimiento» ni
      // «ofertas» (medido: PUBLICADO_PERUANO 021 y 022-2026).
      'CALENDARIO DEL PROCESO', 'PRESENTACION DE PROPUESTAS',
      'EXPRESION DE INTERES', 'EXPRESIONES DE INTERES',
      'CONSENTIMIENTO DE LA BUENA PRO', 'SUSCRIPCION DEL CONVENIO',
      'CONVOCATORIA Y PUBLICACION DE BASES',
    ],
  },
  evaluacion: {
    label: 'Factores de evaluación',
    claves: [
      'FACTORES DE EVALUACION', 'CRITERIOS DE EVALUACION', 'PUNTAJE',
      'EVALUACION DE LAS OFERTAS', 'PUNTAJE TOTAL',
      // Ley 32069 y bases estándar del MEF.
      'EVALUACION DE OFERTAS', 'EVALUACION TECNICA', 'EVALUACION ECONOMICA',
      'CUADRO RESUMEN FACTORES DE EVALUACION', 'GUIA DE PUNTUACION',
      // Obras por Impuestos: la técnica se evalúa DESPUÉS de la económica, y
      // solo la del ganador. El rótulo lleva el número de sobre pegado.
      'EVALUACION DE LA PROPUESTA TECNICA',
      'OTORGAMIENTO DE LA BUENA PRO', 'CONSENTIMIENTO DE LA BUENA PRO',
    ],
  },
  presentacion: {
    label: 'Estructura de la oferta',
    claves: [
      'CONTENIDO DE LAS OFERTAS', 'DOCUMENTOS DE PRESENTACION OBLIGATORIA',
      'DOCUMENTACION DE PRESENTACION', 'FOLIADO', 'SOBRE N',
      'ANEXO N', 'FORMATO N',
      // Los sobres de Obras por Impuestos. El sobre 1 se llama CREDENCIALES y
      // es el mejor detector de unas bases de Empresa Privada: aparece 3 veces
      // ahí y CERO en las de la supervisora y en las de la Ley de
      // Contrataciones.
      'CREDENCIALES', 'CONTENIDO DE LOS SOBRES', 'CONTENIDO DEL SOBRE',
      'PRESENTACION DE LOS SOBRES', 'APERTURA DEL SOBRE',
      'FORMA DE PRESENTACION DE PROPUESTAS',
      // Ley 32069: no hay sobres, hay oferta técnica y económica.
      'OFERTA TECNICA', 'OFERTA ECONOMICA',
      'DOCUMENTOS PARA LA ADMISION DE LA OFERTA',
      'CONTENIDO DE LOS SOBRES A SER PRESENTADOS POR EL POSTOR',
      'DOCUMENTACION DE PRESENTACION OBLIGATORIA',
      'DOCUMENTACION DE PRESENTACION FACULTATIVA',
      'DOCUMENTOS PARA ACREDITAR LOS REQUISITOS DE CALIFICACION',
      'PROPUESTA ECONOMICA', 'PROPUESTA TECNICA',
    ],
  },
  proceso: {
    label: 'Datos del proceso',
    claves: [
      'VALOR REFERENCIAL', 'VALOR ESTIMADO', 'OBJETO DE LA CONVOCATORIA',
      'ENTIDAD CONVOCANTE', 'NOMENCLATURA', 'SISTEMA DE CONTRATACION',
      'PLAZO DE EJECUCION',
      // Obras por Impuestos (Ley 29230): el dinero se llama «monto referencial
      // del convenio de inversión», el proyecto lleva CUI y la entidad es la
      // «que convoca». Sin estos rótulos, la convocatoria de El Peruano daba
      // 0 aciertos en esta familia.
      'MONTO REFERENCIAL', 'CONVOCATORIA DEL PROCESO DE SELECCION',
      'ENTIDAD PUBLICA QUE CONVOCA', 'CUI N', 'CODIGO UNICO DE INVERSION',
      'OBRAS POR IMPUESTOS', 'LEY N 29230', 'NOMBRE DE LA INVERSION',
      'PROCESO DE SELECCION N', 'MONTO DE INVERSION',
      'CONVENIO DE INVERSION', 'COMITE ESPECIAL',
      // Ley 32069 y su plataforma.
      'CUANTIA DE LA CONTRATACION', 'SISTEMA DE ENTREGA', 'MODALIDAD DE PAGO',
      'LEY N 32069', 'PLADICOP', 'ENTIDAD CONTRATANTE',
      'SECCION GENERAL', 'SECCION ESPECIFICA',
    ],
  },

  // ── El contrato o convenio: garantías, penalidades y adelantos ────
  //
  // Familia NUEVA, y estaba faltando de verdad. Estos rótulos viven en el
  // proyecto de contrato —el final del documento—, lejísimos de los
  // requisitos de calificación, así que ninguna ventana de las otras familias
  // llegaba hasta ahí: las garantías y las penalidades salían solo cuando
  // caían de casualidad dentro de un anexo leído por otro motivo.
  //
  // Y el dato importa: la garantía de fiel cumplimiento es 4% en Obras por
  // Impuestos con Empresa Privada y 10% en todo lo demás, y en OxI NO hay
  // adelantos. Ese número entra en la oferta económica.
  contrato: {
    label: 'Garantías, penalidades y adelantos',
    claves: [
      'GARANTIAS DE FIEL CUMPLIMIENTO', 'GARANTIA DE FIEL CUMPLIMIENTO',
      'GARANTIA DE APELACION', 'GARANTIA DE SERIEDAD',
      'REQUISITOS DE LAS GARANTIAS', 'GARANTIA POR ADELANTO',
      'CONSIDERACIONES PARA LAS GARANTIAS FINANCIERAS',
      'CLAUSULA OCTAVA', 'CLAUSULA SETIMA',
      // Las bases oficiales escriben las dos, con y sin tilde, en el mismo
      // documento; `clave()` las junta igual, pero se dejan las dos escritas
      // para que se vea que es a propósito.
      'CLAUSULA DECIMOTERCERA', 'CLAUSULA DECIMO TERCERA', 'CLAUSULA DECIMA QUINTA',
      'PENALIDADES POR MORA', 'PENALIDAD POR MORA', 'OTRAS PENALIDADES',
      'PENALIDAD DIARIA', 'PENALIDADES',
      'ADELANTO DIRECTO', 'ADELANTO PARA MATERIALES', 'ADELANTO POR AVANCE',
      'ADELANTO DE MATERIALES',
      'CONFORMIDAD DE RECEPCION', 'LIQUIDACION DEL CONVENIO DE INVERSION',
      // El «cuaderno» cambia de nombre con el régimen y es un detector fino:
      // OxI lleva CUADERNO DE INCIDENCIAS, la Ley 30225 CUADERNO DE OBRA.
      'CUADERNO DE INCIDENCIAS', 'CUADERNO DE OBRA',
      'JUNTA DE PREVENCION Y RESOLUCION DE DISPUTAS', 'SUBCONTRATACION',
    ],
  },
};

/** Sin tildes, en mayúsculas y con los espacios colapsados. El OCR de un
 *  escaneo pierde tildes con frecuencia; comparar así evita falsos negativos.
 *  La `ñ` también cae a `N` —es una tilde más para NFD— y está bien que caiga:
 *  «DISEÑO» escaneado sale «DISENO» tan seguido como sale bien, y las dos
 *  puntas de la comparación pasan por acá. */
export function normalizar(texto) {
  return String(texto || '')
    // 🔴 `N°` (U+00B0, signo de grado) y `Nº` (U+00BA, ordinal masculino) se
    // ven IGUAL y conviven en el mismo documento oficial: en unas bases de
    // Obras por Impuestos hay 1.132 del primero y 61 del segundo, y en las
    // bases del MEF «ANEXO Nº» aparece 23 veces contra 7 de «ANEXO N°».
    // Buscar con uno solo pierde la mitad de los rótulos.
    .replace(/[°º]/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    // Ceros a la izquierda: «SOBRE N 01», «SOBRE N 1» y «SOBRE N01» son el
    // mismo sobre, y los tres aparecen en el mismo juego de bases.
    .replace(/\bN\s*0+(\d)/g, 'N $1')
    .trim();
}

/**
 * La MISMA cadena, reducida a lo único que el OCR no puede cambiar: letras y
 * dígitos. Es `normalizar()` llevado hasta el final, y existe por una trampa
 * medida que `normalizar()` no puede cubrir.
 *
 * 🔴 EL KERNING METE ESPACIOS ADENTRO DE LAS PALABRAS. En el CUERPO de las
 * bases —no en el índice, que sale limpio— el extractor de texto parte
 * palabras donde el PDF separó las letras para justificar el renglón:
 *   «MODELO DE CA RTA DE EXPRESIÓN DE INTERES»
 *   «CONTENIDO DE LO S SOBRES»
 *   «ANEXO N° 4- B:»
 * `normalizar()` colapsa RUNS de espacios, pero deja UNO, así que
 * `'CONTENIDO DE LOS SOBRES'` no cae dentro de `'CONTENIDO DE LO S SOBRES'` y
 * el rótulo se pierde justo en la página donde la sección de verdad empieza.
 * Sacando TODO lo que no es letra ni dígito, las dos puntas se juntan.
 *
 * Se usa para BUSCAR RÓTULOS (el índice, el régimen, los anexos), nunca para
 * mostrar: lo que devuelve no es texto legible. Para comparar una cita con el
 * documento sigue mandando `normalizar()`, y esto entra solo como segunda
 * oportunidad — ver `verificarCita`.
 *
 * El orden importa: los ceros a la izquierda se arreglan AL FINAL, cuando
 * «SOBRE N° 01» ya es «SOBREN01» y el `N0` quedó pegado.
 */
export function clave(texto) {
  return String(texto || '')
    .replace(/[°º]/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .replace(/N0+(\d)/g, 'N$1');
}

/** ¿El rótulo `aguja` aparece en `heno`, mirándolos como los miraría una
 *  persona que no ve los espacios que metió el kerning? */
export const contieneClave = (heno, aguja) => clave(heno).includes(clave(aguja));

/** Cuántas veces aparece el rótulo. `clasificarRegimen` cuenta, no solo mira:
 *  los contadores del corpus real son tajantes y una mención suelta no es lo
 *  mismo que un rótulo repetido 21 veces. */
export function contarClave(claveTexto, rotulo) {
  const k = clave(rotulo);
  if (!k) return 0;
  let n = 0, i = claveTexto.indexOf(k);
  while (i !== -1) { n++; i = claveTexto.indexOf(k, i + k.length); }
  return n;
}

/**
 * Bajo qué norma se rige este proceso. Lo dice el documento, y cambia todo:
 * cuántos sobres hay y en qué orden, cuánto es la garantía de fiel
 * cumplimiento, qué porcentaje admite la oferta económica y hasta cómo se
 * llama el dinero.
 *
 * Medido sobre cinco juegos de bases reales (8-set-2026). Los contadores son
 * tajantes y no se pisan entre sí:
 *   «CREDENCIALES» + «SOBRE N 3»   → Obras por Impuestos, EMPRESA PRIVADA
 *   «SOBRE N 2» sin «SOBRE N 3»
 *     + «REQUISITOS DE CALIFICACION» → Obras por Impuestos, SUPERVISORA
 *   «CUANTIA DE LA CONTRATACION»    → Ley 32069 (vigente desde abril de 2025)
 *   «VALOR REFERENCIAL» + «OBRAS SIMILARES» → Ley 30225 (régimen anterior)
 *
 * `VALOR REFERENCIAL` y `CUANTIA DE LA CONTRATACION` son **mutuamente
 * excluyentes** en todo el corpus revisado: son el mejor discriminador entre
 * los dos regímenes de contratación.
 */
export const REGIMENES = {
  oxi_empresa: { label: 'Obras por Impuestos · Empresa Privada', sobres: 3, fielCumplimiento: 4, rangoEconomico: [90, 110] },
  oxi_supervisora: { label: 'Obras por Impuestos · Entidad Privada Supervisora', sobres: 2, fielCumplimiento: 10, rangoEconomico: [90, 110] },
  ley32069: { label: 'Ley 32069 · Contrataciones Públicas', sobres: 0, fielCumplimiento: 10, rangoEconomico: [95, 110] },
  ley30225: { label: 'Ley 30225 · régimen anterior', sobres: 0, fielCumplimiento: 10, rangoEconomico: null },
};

/**
 * Los rótulos que se cuentan para decidir el régimen, con lo que dieron sobre
 * el corpus real (medido el 8-set-2026 sobre cinco juegos de bases):
 *
 *   rótulo                      Pira(EP) Jesús(EP) Pangoa(EPS) 32069  30225
 *   SOBRE N° 3                     10        6          0         0      0
 *   CREDENCIALES                    3        3          0         0      0
 *   REQUISITOS DE CALIFICACIÓN      0        0          6         ✓      ✓
 *   MONTO REFERENCIAL              21       23          3         0      0
 *   VALOR REFERENCIAL               3        2         24         0     16
 *   CUANTÍA DE LA CONTRATACIÓN      0        0          0        14      0
 *
 * Se cuenta con `clave()` y no con `normalizar()` porque «SOBRE N° 3», «SOBRE
 * Nº 03» y «SOBRE N°3» son el mismo rótulo y los tres están en el corpus.
 */
export const ROTULOS_REGIMEN = {
  sobre3: 'SOBRE N 3',
  sobre2: 'SOBRE N 2',
  credenciales: 'CREDENCIALES',
  requisitosCalificacion: 'REQUISITOS DE CALIFICACION',
  montoReferencial: 'MONTO REFERENCIAL',
  valorReferencial: 'VALOR REFERENCIAL',
  cuantia: 'CUANTIA DE LA CONTRATACION',
  pladicop: 'PLADICOP',
  ley32069: 'LEY N 32069',
  ley29230: 'LEY N 29230',
  convenioInversion: 'CONVENIO DE INVERSION',
  obrasPorImpuestos: 'OBRAS POR IMPUESTOS',
  comiteEspecial: 'COMITE ESPECIAL',
  ciprl: 'CIPRL',
  // 🔴 QUIÉN ES EL POSTOR: el discriminador que faltaba entre las dos bases de
  // Obras por Impuestos, y el que hizo fallar la lectura del 9-set. Unas bases
  // de EMPRESA PRIVADA lo dicen en el título («Contratación de la Empresa
  // Privada para la IOARR…») y lo repiten en cada página; las de la
  // supervisora dicen «Entidad Privada Supervisora» con la misma insistencia.
  empresaPrivada: 'EMPRESA PRIVADA',
  entidadSupervisora: 'ENTIDAD PRIVADA SUPERVISORA',
  obrasSimilares: 'OBRAS SIMILARES',
  plantelProfesional: 'PLANTEL PROFESIONAL',
  cuadernoObra: 'CUADERNO DE OBRA',
  cuadernoIncidencias: 'CUADERNO DE INCIDENCIAS',
  polizaCaucion: 'POLIZA DE CAUCION',
};

/**
 * El régimen, con la cuenta que lo justifica.
 *
 * 🔴 `VALOR REFERENCIAL` y `CUANTIA DE LA CONTRATACION` son **mutuamente
 * excluyentes** en todo el corpus revisado: son el mejor discriminador entre
 * los dos regímenes de contratación. Si aparecen los DOS, el archivo trae dos
 * procesos mezclados o una plantilla mal editada, y eso se AVISA en vez de
 * elegir uno en silencio: el régimen manda sobre cuántos sobres hay, en qué
 * orden y de cuánto es la garantía.
 *
 * 🔴 LOS ARTÍCULOS CITADOS NO SIRVEN PARA DECIDIR EL RÉGIMEN, y por eso no
 * están en la lista. Hay bases nuevas que citan artículos del reglamento viejo
 * por copiar la plantilla, y la numeración se movió: el art. 114 era
 * «conformidad» en el DS 210-2022-EF y es «Garantías para el caso de
 * Consorcio» en el DS 038-2026-EF. Se decide por el VOCABULARIO, que sí cambió
 * de verdad entre un régimen y otro.
 *
 * @returns { regimen, confianza: 'alta'|'media'|null, senales, conflicto }
 */
export function clasificarRegimen(markdown) {
  const k = clave(markdown);
  const senales = {};
  for (const [nombre, rotulo] of Object.entries(ROTULOS_REGIMEN)) {
    senales[nombre] = contarClave(k, rotulo);
  }
  const conflicto = senales.valorReferencial > 0 && senales.cuantia > 0
    ? 'El documento usa «valor referencial» y «cuantía de la contratación» a la vez, y en las bases reales son excluyentes: puede traer dos procesos mezclados o ser una plantilla a medio editar. Confirma bajo qué norma se rige antes de armar la oferta.'
    : null;

  const oxi = senales.ley29230 + senales.convenioInversion + senales.obrasPorImpuestos
    + senales.comiteEspecial + senales.ciprl + senales.montoReferencial;

  // 1. Obras por Impuestos con Empresa Privada: TRES sobres, y el sobre 1 se
  //    llama CREDENCIALES. Es el detector más limpio del corpus — cero
  //    apariciones en los otros cuatro juegos de bases.
  if (senales.credenciales > 0 && senales.sobre3 > 0) {
    return { regimen: 'oxi_empresa', confianza: 'alta', senales, conflicto };
  }
  // 2. Ley 32069: la plataforma y la palabra nueva para el dinero.
  if (senales.cuantia > 0 || senales.pladicop > 0 || senales.ley32069 > 0) {
    const confianza = (senales.cuantia > 0 && (senales.pladicop > 0 || senales.ley32069 > 0)) ? 'alta' : 'media';
    return { regimen: 'ley32069', confianza, senales, conflicto };
  }
  // 3. Obras por Impuestos. Cuál de las dos bases es, lo dice QUIÉN ES EL
  //    POSTOR, no la ausencia de un sobre.
  //
  // 🔴 ESTO ESTABA AL REVÉS Y COSTÓ CARO (9-set-2026). La regla era «sin
  // SOBRE N° 3 es la supervisora», y en un escaneo degradado ese rótulo
  // sencillamente no se lee: unas bases que dicen «Contratación de la EMPRESA
  // PRIVADA» en el título salieron clasificadas como Entidad Privada
  // Supervisora, con confianza ALTA. La ausencia de una señal no es evidencia
  // de lo contrario, y menos sobre un OCR malo.
  if (oxi > 0) {
    const dice = senales.empresaPrivada - senales.entidadSupervisora;
    let regimen, confianza;
    if (senales.sobre3 > 0 || dice > 2) { regimen = 'oxi_empresa'; confianza = senales.sobre3 > 0 && dice > 0 ? 'alta' : 'media'; }
    else if (senales.entidadSupervisora > 0 && dice < 0) { regimen = 'oxi_supervisora'; confianza = senales.entidadSupervisora > 2 ? 'alta' : 'media'; }
    else {
      // Es de Obras por Impuestos, pero no se sabe de cuál de las dos. Se dice
      // así, en vez de elegir una: la que se elija cambia el orden de los
      // sobres y el porcentaje de la garantía, y equivocarse es peor que no
      // saber. Con `confianza: 'baja'` la pista NO se le manda al modelo.
      regimen = senales.sobre2 > 0 ? 'oxi_supervisora' : 'oxi_empresa';
      confianza = 'baja';
    }
    return { regimen, confianza, senales, conflicto };
  }
  // 4. Ley 30225: el vocabulario viejo, y ninguno de los de arriba.
  if (senales.valorReferencial > 0
    && (senales.obrasSimilares > 0 || senales.plantelProfesional > 0
      || senales.cuadernoObra > 0 || senales.polizaCaucion > 0)) {
    return { regimen: 'ley30225', confianza: 'media', senales, conflicto };
  }
  // 5. Dos sobres sin un tercero, y requisitos de calificación: la forma de
  //    las bases de la Entidad Privada Supervisora aunque no se nombre la ley.
  if (senales.sobre2 > 0 && senales.sobre3 === 0 && senales.requisitosCalificacion > 0) {
    return { regimen: 'oxi_supervisora', confianza: 'media', senales, conflicto };
  }
  return { regimen: null, confianza: null, senales, conflicto };
}

/** Solo el régimen. Lo que ya usaban el separador de anexos y los tests. */
export function detectarRegimen(markdown) {
  return clasificarRegimen(markdown).regimen;
}

// ── PASE 0.5 — el índice, sin IA ───────────────────────────────────

/**
 * Parte el markdown en fragmentos con su página, respetando los marcadores
 * `<!-- página N -->` que deja `bloquesAMarkdown`.
 *
 * @returns [{ pagina, texto }]
 */
export function fragmentosPorPagina(markdown) {
  const md = String(markdown || '');
  if (!md.trim()) return [];
  const re = /<!--\s*p[áa]gina\s+(\d+)\s*-->/gi;
  const fragmentos = [];
  let ultimo = 0, paginaActual = null;
  for (const m of md.matchAll(re)) {
    const previo = md.slice(ultimo, m.index).trim();
    if (previo) fragmentos.push({ pagina: paginaActual, texto: previo });
    paginaActual = Number(m[1]);
    ultimo = m.index + m[0].length;
  }
  const cola = md.slice(ultimo).trim();
  if (cola) fragmentos.push({ pagina: paginaActual, texto: cola });
  return fragmentos;
}

/**
 * Dónde aparece cada familia de sección. Es `grep` con contexto, no IA.
 *
 * Devuelve, por familia, los aciertos con su página y el renglón donde cayeron
 * — que es lo que después se le muestra a la IA en el Pase 1 para que ELIJA,
 * en vez de buscar. Un acierto es barato de generar y barato de descartar.
 *
 * @returns { personal: [{ pagina, clave, linea }], empresa: [...], ... }
 */
export function indiceDeSecciones(markdown, { maxPorFamilia = 0 } = {}) {
  const fragmentos = fragmentosPorPagina(markdown);
  const crudo = {};
  for (const fam of Object.keys(SECCIONES)) crudo[fam] = [];

  for (const frag of fragmentos) {
    const lineas = frag.texto.split(/\n+/);
    for (const linea of lineas) {
      // 🔴 SE BUSCA CON `clave()`, NO CON `normalizar()`. El renglón viene del
      // cuerpo del documento, que es justo donde el kerning mete espacios
      // adentro de las palabras: «CONTENIDO DE LO S SOBRES» y «ANEXO N° 4- B»
      // son renglones reales del corpus y con `normalizar()` no caían.
      const k = clave(linea);
      if (!k) continue;
      const esIndice = esRenglonDeIndice(linea);
      for (const [fam, def] of Object.entries(SECCIONES)) {
        const rotulo = def.claves.find(c => k.includes(clave(c)));
        if (!rotulo) continue;
        // El renglón se recorta: al Pase 1 le alcanza para reconocer la
        // sección, y mandar párrafos enteros devolvería el problema de origen.
        crudo[fam].push({
          pagina: frag.pagina,
          clave: rotulo,
          linea: linea.trim().slice(0, 220),
          // Un renglón del índice de contenidos NO es la sección: es su
          // referencia. Se marca en vez de descartarse, porque a veces el
          // índice es lo único legible de un escaneo malo.
          ...(esIndice ? { deIndice: true } : {}),
        });
      }
    }
  }

  // 🔴 EL ÍNDICE DE CONTENIDOS SE COMÍA EL PRESUPUESTO ENTERO.
  //
  // Medido el 9-set-2026 sobre BASES_INTEGRADAS_PROCESO_SELECCION_009: 94
  // páginas escaneadas, y la lectura devolvió CERO requisitos. El motivo no
  // era el OCR: el tope era `maxPorFamilia = 12` y se aplicaba MIENTRAS se
  // recorría, en orden de documento. Las doce primeras coincidencias de cada
  // familia caían todas en la tabla de contenidos de las páginas 1 a 3 —donde
  // están TODOS los rótulos juntos, uno por renglón— y el recorrido se cortaba
  // ahí. Las secciones de verdad, en las páginas 30 a 90, no entraban nunca al
  // índice, así que `rangosDeFamilia` nunca proponía esas páginas y el modelo
  // leyó tres páginas de un documento de noventa y cuatro.
  //
  // Ahora se junta TODO y se elige después, con dos reglas:
  //   1. los renglones que NO son del índice de contenidos van primero;
  //   2. entre esos, se reparte a lo largo del documento en vez de tomar los
  //      primeros — una sección puede empezar en la página 80.
  const tope = maxPorFamilia > 0 ? maxPorFamilia : topeDelIndice(fragmentos);
  const indice = {};
  for (const [fam, hits] of Object.entries(crudo)) indice[fam] = elegirAciertos(hits, tope);
  return indice;
}

/** Cuántas coincidencias por familia se guardan. Escala con el documento: en
 *  una convocatoria de una página doce sobran, y en unas bases integradas de
 *  noventa y cuatro se quedaban cortísimas. */
export function topeDelIndice(fragmentos) {
  const paginas = (fragmentos || []).filter(f => f.pagina != null).length;
  return Math.max(12, Math.min(40, Math.ceil(paginas / 3)));
}

/**
 * Elige qué coincidencias entran al índice: primero las que NO son del índice
 * de contenidos, y repartidas a lo largo del documento.
 */
export function elegirAciertos(hits, tope) {
  if (hits.length <= tope) return hits;
  const reales = hits.filter(h => !h.deIndice);
  const delIndice = hits.filter(h => h.deIndice);
  // Del índice de contenidos alcanza con unos pocos: dicen DÓNDE está la
  // sección, y esa pista la aprovecha el Pase 1. Guardan a lo sumo un cuarto
  // del cupo para no volver a tapar a las secciones de verdad.
  // Este cupo es un TECHO, no una cuota a llenar: si las secciones de verdad
  // no gastan todo el presupuesto, lo que sobra se deja vacío. Rellenar con
  // renglones del índice de contenidos es justo lo que había arruinado la
  // lectura del documento de 94 páginas.
  const cupoIndice = Math.min(delIndice.length, Math.floor(tope / 4));
  const elegidos = [
    ...repartir(reales, tope - cupoIndice),
    ...repartir(delIndice, cupoIndice),
  ];
  // De vuelta al orden del documento, que es como lo lee el Pase 1.
  return elegidos.sort((a, b) => (a.pagina ?? 0) - (b.pagina ?? 0));
}

/** `n` elementos repartidos parejo a lo largo de la lista, no los primeros. */
function repartir(lista, n) {
  if (n <= 0) return [];
  if (lista.length <= n) return [...lista];
  const paso = lista.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(lista[Math.floor(i * paso)]);
  return out;
}

/**
 * ¿Este renglón es una línea del ÍNDICE DE CONTENIDOS y no la sección?
 *
 * Se reconoce por la forma, que es la misma en todas las bases: el rótulo, una
 * fila de puntos (o de espacios) y el número de página al final. Distinguirlo
 * importa porque el rótulo aparece DOS veces en el documento —una en el índice
 * y otra donde la sección de verdad empieza— y leer la página del índice
 * devuelve una lista de títulos, no requisitos.
 *
 * El brief lo dice al revés y también es cierto: el índice sale LIMPIO (sin
 * los espacios espurios del kerning), así que sirve para el mapa de secciones
 * aunque no sirva para extraer.
 */
export function esRenglonDeIndice(linea) {
  const t = String(linea || '').trim();
  if (!t) return false;
  return /\.{3,}\s*\d{1,3}$/.test(t) || /\s{4,}\d{1,3}$/.test(t);
}

/** Cuántas páginas distintas tocó cada familia — para decidir si hace falta IA. */
export function resumenIndice(indice) {
  const out = {};
  for (const [fam, hits] of Object.entries(indice || {})) {
    const paginas = [...new Set(hits.map(h => h.pagina).filter(p => p != null))];
    out[fam] = { aciertos: hits.length, paginas };
  }
  return out;
}

/**
 * Tope duro de lo que sale de `textoDeRango`, en caracteres.
 *
 * 🔴 ESTO ES UNA RED, NO EL MECANISMO. El troceo de verdad son las páginas (o
 * los tramos, en un Word: ver CHARS_POR_TRAMO). Pero el 8-set-2026 un
 * documento sin anclas devolvió 236.669 caracteres contra un tope de 120.000
 * del servidor, y las tres familias fallaron con «El rango es demasiado
 * grande». Un rango que se pasa se RECORTA y se avisa: media lectura sirve,
 * un error no sirve para nada. Queda por debajo del tope del endpoint a
 * propósito, para que el margen absorba el prompt.
 */
export const MAX_CHARS_RANGO = 90_000;

/**
 * El texto de un rango de páginas (o de tramos), para el Pase 2.
 * `desde`/`hasta` son inclusivos. Nunca devuelve más de MAX_CHARS_RANGO.
 */
export function textoDeRango(markdown, desde, hasta, { maxChars = MAX_CHARS_RANGO } = {}) {
  const fragmentos = fragmentosPorPagina(markdown);
  const sinPagina = fragmentos.every(f => f.pagina == null);
  const texto = sinPagina
    ? fragmentos.map(f => f.texto).join('\n\n')
    : fragmentos
      .filter(f => f.pagina != null && f.pagina >= desde && f.pagina <= hasta)
      .map(f => `<!-- página ${f.pagina} -->\n${f.texto}`)
      .join('\n\n');
  if (texto.length <= maxChars) return texto;
  // Se corta en un salto de línea para no partir una frase por la mitad: una
  // cita cortada no se puede verificar y el dato se perdería igual.
  const corte = texto.lastIndexOf('\n', maxChars);
  return texto.slice(0, corte > maxChars * 0.6 ? corte : maxChars);
}

// ── PASE 3 — la verificación, sin IA ───────────────────────────────

/** Compara dos textos como los compararía una persona: sin tildes, sin
 *  mayúsculas y sin importar cómo cayeron los espacios del OCR. */
const contiene = (heno, aguja) => normalizar(heno).includes(normalizar(aguja));

/**
 * ¿La cita que devolvió el modelo existe de verdad en el documento?
 *
 * Se exige que la cita aparezca literal (normalizada). Si el modelo dice la
 * página, se busca PRIMERO en esa página: una cita real en la página que no
 * es sigue siendo un error, porque el expediente se arma citando la página.
 *
 * @returns { verificada, motivo, paginaReal }
 */
/**
 * El marcador de campo a llenar de las bases estándar del MEF: `[CONSIGNAR EL
 * MONTO]`, `[CONSIGNAR LA FECHA]`, `[……]`.
 *
 * 🔴 ES EL MEJOR ANCLA DEL DOCUMENTO Y TAMBIÉN LA PEOR TRAMPA. Las bases se
 * publican a partir de una plantilla y la entidad reemplaza estos corchetes
 * por el dato real; cuando se le pasa uno, el documento sale a la calle con el
 * marcador puesto. Una cita que ES el marcador se verifica perfecto —está
 * literal en el documento— y el dato que la acompaña vale cero: no es que el
 * modelo lo inventó, es que LA ENTIDAD no lo escribió.
 *
 * Sin esto, un «valor referencial» sacado de «[CONSIGNAR EL MONTO]» entraría a
 * la postulación con su ✅ verde.
 */
export const RX_CAMPO_SIN_LLENAR = /\[\s*(CONSIGNAR|INDICAR|COMPLETAR|SEÑALAR|SENALAR|PRECISAR|INCLUIR|DE SER EL CASO|\.{2,}|…)/i;

/** ¿La cita es un campo que la entidad dejó sin llenar? */
export function citaEsPlantilla(cita) {
  return RX_CAMPO_SIN_LLENAR.test(String(cita || ''));
}

/**
 * Cuántos campos sin llenar quedaron en el documento. Se cuenta y se avisa:
 * unas bases con marcadores adentro son unas bases a medio publicar, y eso
 * cambia si conviene presentarse o pedir una consulta a la entidad.
 */
export function camposSinLlenar(markdown) {
  const m = String(markdown || '').match(/\[\s*(?:CONSIGNAR|INDICAR|COMPLETAR|SEÑALAR|SENALAR|PRECISAR)[^\]]{0,120}\]/gi);
  if (!m) return [];
  const vistos = new Set();
  const out = [];
  for (const x of m) {
    const k = normalizar(x).slice(0, 80);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(x.trim().replace(/\s+/g, ' ').slice(0, 120));
  }
  return out;
}

export function verificarCita(markdown, cita, pagina = null) {
  const texto = String(cita || '').trim();
  if (texto.length < 12) {
    return { verificada: false, motivo: 'sin cita (o demasiado corta para comprobarla)', paginaReal: null };
  }
  const fragmentos = fragmentosPorPagina(markdown);
  if (!fragmentos.length) return { verificada: false, motivo: 'documento vacío', paginaReal: null };

  // PRIMERA VUELTA: la cita, literal. Es la exigente y la que da el ✅ limpio.
  let donde = fragmentos.filter(f => contiene(f.texto, texto));
  let porKerning = false;
  if (!donde.length) {
    // SEGUNDA VUELTA: sin los espacios que metió el kerning.
    //
    // 🔴 Un modelo que copia «CONTENIDO DE LO S SOBRES» casi siempre lo
    // escribe bien —arregla la palabra rota sin darse cuenta—, y la primera
    // vuelta lo tomaba por una cita inventada. Era un falso ⚠ sobre un dato
    // BUENO, que es peor que no verificar: manda a revisar a mano justo lo que
    // estaba bien. Se acepta, pero se dice de dónde salió.
    donde = fragmentos.filter(f => contieneClave(f.texto, texto));
    porKerning = donde.length > 0;
  }
  if (!donde.length) {
    return { verificada: false, motivo: 'la cita no aparece en el documento', paginaReal: null };
  }
  // La cita existe, pero lo que dice es un campo que la entidad dejó vacío.
  if (citaEsPlantilla(texto)) {
    return {
      verificada: false,
      paginaReal: donde[0].pagina,
      motivo: 'la cita es un campo que la entidad dejó SIN LLENAR en la plantilla ([CONSIGNAR …]): el documento no trae ese dato',
    };
  }
  const paginaReal = donde[0].pagina;
  if (porKerning) {
    if (pagina != null && paginaReal != null && !donde.some(f => f.pagina === pagina)) {
      return { verificada: false, paginaReal,
        motivo: `la cita existe, pero en la página ${paginaReal}, no en la ${pagina}` };
    }
    return { verificada: true, paginaReal,
      motivo: 'cita verificada (el documento la trae con espacios partidos por el kerning)' };
  }
  if (pagina != null && paginaReal != null && !donde.some(f => f.pagina === pagina)) {
    return { verificada: false, paginaReal,
      motivo: `la cita existe, pero en la página ${paginaReal}, no en la ${pagina}` };
  }
  return { verificada: true, motivo: 'cita verificada contra el documento', paginaReal };
}

/**
 * Pasa la verificación por todo lo que devolvió el Pase 2 y deja cada dato
 * marcado. NO borra lo no verificado: lo manda a revisión humana con el
 * motivo. Descartar en silencio es cómo se pierde un requisito real.
 *
 * @returns { ...resultado, requisitos: [...con .verificacion], alertas: [...] }
 */
export function verificarResultado(resultado, markdown) {
  const r = resultado && typeof resultado === 'object' ? resultado : {};
  const alertas = Array.isArray(r.alertas) ? [...r.alertas] : [];
  const marcar = (item, rotulo) => {
    const v = verificarCita(markdown, item.fuente_cita, item.fuente_pagina);
    if (!v.verificada) alertas.push(`«${rotulo}»: ${v.motivo}. Revisar en las bases antes de usarlo.`);
    return {
      ...item,
      fuente_pagina: v.paginaReal != null ? v.paginaReal : (item.fuente_pagina ?? null),
      verificada: v.verificada,
      verificacion_motivo: v.motivo,
    };
  };
  const requisitos = (Array.isArray(r.requisitos) ? r.requisitos : [])
    .map(req => marcar(req, req.cargo || 'requisito sin cargo'));
  // Lo de la entrega 4 pasa por la misma aduana: un requisito de empresa, una
  // etapa del calendario o una regla de consorcio inventados cuestan lo mismo
  // que un puesto inventado.
  const requisitos_empresa = (Array.isArray(r.requisitos_empresa) ? r.requisitos_empresa : [])
    .map(req => marcar(req, req.descripcion || req.tipo || 'requisito de empresa'));
  const cronograma = (Array.isArray(r.cronograma) ? r.cronograma : [])
    .map(et => marcar(et, et.etapa || 'etapa del calendario'));
  // Lo de la mig 200 pasa por la misma aduana: una garantía del 10% que las
  // bases no piden cambia la oferta económica entera.
  const listas = {};
  for (const [clave, rotulo] of [
    ['factores_evaluacion', 'factor de evaluación'], ['garantias', 'garantía'],
    ['penalidades', 'penalidad'], ['documentos_presentacion', 'documento a presentar'],
    ['condiciones', 'condición'],
  ]) {
    listas[clave] = (Array.isArray(r[clave]) ? r[clave] : [])
      .map(x => marcar(x, x.factor || x.titulo || x.documento || x.detalle || rotulo));
  }
  const consorcio = r.consorcio && typeof r.consorcio === 'object' && r.consorcio.fuente_cita
    ? marcar(r.consorcio, 'reglas de consorcio')
    : (r.consorcio || null);
  return { ...r, ...listas, requisitos, requisitos_empresa, cronograma, consorcio, alertas };
}

// ── Del resultado a las filas que la app ya sabe evaluar ───────────

const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

/**
 * Traduce un requisito extraído a la fila de `licitacion_requisitos`.
 *
 * La fila que se guarda ES el objeto que come `evaluarRequisito()` (mig 197,
 * sin adaptador en el medio). Acá solo se limpian tipos y se pone la fuente.
 *
 * `rubro_id` queda SIEMPRE en null: el rubro es una fila del catálogo interno
 * del grupo y el modelo no puede inventarlo. La definición de obra similar que
 * escribió la entidad va aparte, en `licitaciones.definicion_obras_similares`
 * (mig 198), que es texto y no una llave foránea. Elegir el rubro es de la
 * persona que arma la postulación.
 */
export function aFilaRequisito(req = {}, { orden = 100 } = {}) {
  return {
    clase: req.clase === 'empresa' ? 'empresa' : 'personal',
    orden,
    cargo: req.cargo ? String(req.cargo).trim().slice(0, 160) : null,
    profesion: req.profesion ? String(req.profesion).trim().slice(0, 160) : null,
    meses_minimos: num(req.meses_minimos),
    meses_generales_minimos: num(req.meses_generales_minimos),
    participaciones_minimas: Math.round(num(req.participaciones_minimas)),
    meses_por_participacion: num(req.meses_por_participacion),
    ventana_anios: req.ventana_anios != null ? Math.round(num(req.ventana_anios)) || null : null,
    cargos_equivalentes: Array.isArray(req.cargos_equivalentes)
      ? req.cargos_equivalentes.map(c => String(c).trim()).filter(Boolean).slice(0, 20)
      : [],
    exige_colegiatura: req.exige_colegiatura !== false,
    exige_sustento: req.exige_sustento !== false,
    rubro_id: null,
    candidato_personal_id: null,
    fuente: 'extraccion',
    fuente_pagina: req.fuente_pagina != null ? Math.round(num(req.fuente_pagina)) || null : null,
    fuente_cita: req.fuente_cita ? String(req.fuente_cita).trim().slice(0, 1200) : null,
    notas: req.notas ? String(req.notas).trim().slice(0, 600) : null,
  };
}

/** Todas las filas, numeradas en el orden en que aparecen en las bases. */
export function aFilasRequisitos(resultado) {
  const reqs = Array.isArray(resultado?.requisitos) ? resultado.requisitos : [];
  return reqs.map((r, i) => ({
    ...aFilaRequisito(r, { orden: (i + 1) * 10 }),
    verificada: r.verificada !== false,
    verificacion_motivo: r.verificacion_motivo || null,
  }));
}

/**
 * Palabras que delatan que un supuesto «puesto del plantel» es en realidad un
 * requisito de la EMPRESA.
 *
 * 🔴 CASO REAL (8-set-2026): las bases de ejecución devolvieron «Ejecutor del
 * Proyecto» como cuarto puesto del plantel, con la cita «el Postor deberá
 * acreditar MONTO FACTURADO ACUMULADO EQUIVALENTE A DOS (2) VECES EL MONTO
 * TOTAL DE INVERSIÓN REFERENCIAL». Eso no es una persona: es la experiencia
 * del postor. Gabriel lo vio de una: «ejecutor de obra es la entidad que se
 * encarga de ejecutar, eso no es un profesional».
 *
 * Y no es un detalle cosmético: un puesto falso deja el veredicto en ⛔ para
 * siempre, porque ninguna persona del padrón va a «calificar» como empresa.
 */
export const CARGOS_QUE_SON_LA_EMPRESA = [
  'POSTOR', 'EJECUTOR DEL PROYECTO', 'EJECUTOR DE LA INVERSION', 'EJECUTOR DE OBRA',
  'EMPRESA PRIVADA', 'ENTIDAD PRIVADA SUPERVISORA', 'CONSORCIO', 'CONTRATISTA',
  'PERSONA JURIDICA', 'EL PROVEEDOR', 'LA EMPRESA', 'CONSULTOR EJECUTOR',
];

/** Señales de que la exigencia se mide en DINERO o en papeles de la empresa,
 *  no en meses de una persona. */
const RX_PLATA_DE_EMPRESA = /(MONTO FACTURADO|FACTURACION|VALOR REFERENCIAL|CAPACIDAD LIBRE DE CONTRATACION|PATRIMONIO NETO|VECES EL MONTO|VOLUMEN DE VENTAS)/;

/**
 * ¿Este «puesto» es en realidad la empresa? Mira el cargo y, si el cargo no lo
 * delata, la exigencia: nadie le pide a un ingeniero un monto facturado.
 */
export function pareceRequisitoDeEmpresa(req = {}) {
  const cargo = normalizar(req.cargo);
  if (!cargo) return false;
  if (CARGOS_QUE_SON_LA_EMPRESA.some(c => cargo === c || cargo.startsWith(c + ' ') || cargo.endsWith(' ' + c) || cargo === `EL ${c}` || cargo === `LA ${c}`)) return true;
  const texto = normalizar(`${req.fuente_cita || ''} ${req.notas || ''} ${req.descripcion || ''}`);
  // Un cargo que además exige plata de empresa: es del postor.
  if (RX_PLATA_DE_EMPRESA.test(texto) && !/COLEGIAD|TITULAD|PROFESIONAL TITULADO/.test(texto)) return true;
  return false;
}

/** Un puesto mal clasificado, convertido a requisito de empresa. */
export function comoRequisitoDeEmpresa(req = {}) {
  const texto = normalizar(`${req.fuente_cita || ''} ${req.descripcion || ''}`);
  const tipo = /MONTO FACTURADO|VECES EL MONTO|EXPERIENCIA/.test(texto) ? 'experiencia_postor'
    : (/FACTURACION|VOLUMEN DE VENTAS/.test(texto) ? 'facturacion'
      : (/CAPACIDAD LIBRE/.test(texto) ? 'capacidad_contratacion'
        : (/PATRIMONIO/.test(texto) ? 'patrimonio' : 'otro')));
  return {
    tipo,
    descripcion: req.descripcion || req.cargo || null,
    monto_minimo: null,
    multiplo_valor_referencial: null,
    ventana_anios: req.ventana_anios ?? null,
    fuente_pagina: req.fuente_pagina ?? null,
    fuente_cita: req.fuente_cita || null,
    verificada: req.verificada,
    verificacion_motivo: req.verificacion_motivo,
    _reclasificado: req.cargo || null,
  };
}

/**
 * Un requisito de la EMPRESA (clase 'empresa', mig 199): no se mide en meses
 * de un cargo sino en montos, múltiplos del valor referencial y papeles (RNP,
 * capacidad de contratación). `cargo` guarda el rótulo corto del tipo para que
 * la lista lo muestre igual que a un puesto.
 */
export const TIPO_REQ_EMPRESA_LBL = {
  experiencia_postor: 'Experiencia del postor',
  facturacion: 'Facturación',
  capacidad_contratacion: 'Capacidad de contratación',
  rnp: 'RNP vigente',
  patrimonio: 'Patrimonio neto',
  habilitacion: 'Habilitación',
  otro: 'Otro requisito de la empresa',
};

export function aFilaRequisitoEmpresa(req = {}, { orden = 100 } = {}) {
  const tipo = TIPO_REQ_EMPRESA_LBL[req.tipo] ? req.tipo : 'otro';
  const monto = Number(req.monto_minimo);
  const mult = Number(req.multiplo_valor_referencial);
  return {
    clase: 'empresa',
    orden,
    cargo: TIPO_REQ_EMPRESA_LBL[tipo],
    profesion: null,
    descripcion: [req.descripcion, req.obras_similares ? `Obras similares según estas bases: ${req.obras_similares}` : null]
      .filter(Boolean).join(' — ').trim().slice(0, 900) || null,
    monto_minimo: Number.isFinite(monto) && monto > 0 ? monto : null,
    multiplo_valor_referencial: Number.isFinite(mult) && mult > 0 ? mult : null,
    ventana_anios: req.ventana_anios != null ? Math.round(num(req.ventana_anios)) || null : null,
    meses_minimos: 0, meses_generales_minimos: 0, participaciones_minimas: 0, meses_por_participacion: 0,
    cargos_equivalentes: [],
    exige_colegiatura: false, exige_sustento: true,
    rubro_id: null, candidato_personal_id: null,
    fuente: 'extraccion',
    fuente_pagina: req.fuente_pagina != null ? Math.round(num(req.fuente_pagina)) || null : null,
    fuente_cita: req.fuente_cita ? String(req.fuente_cita).trim().slice(0, 1200) : null,
    notas: null,
  };
}

/** Las filas de empresa, numeradas después de las de personal. */
export function aFilasEmpresa(resultado, { desde = 0 } = {}) {
  const reqs = Array.isArray(resultado?.requisitos_empresa) ? resultado.requisitos_empresa : [];
  return reqs.map((r, i) => ({
    ...aFilaRequisitoEmpresa(r, { orden: (desde + i + 1) * 10 }),
    verificada: r.verificada !== false,
    verificacion_motivo: r.verificacion_motivo || null,
  }));
}

/** 'YYYY-MM-DD' si lo es; también acepta 'DD/MM/YYYY' (como escribe la
 *  entidad) y lo da vuelta. Cualquier otra cosa → null. */
export function fechaISO(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const MECANISMOS = new Set(['oxi', 'ley_contrataciones', 'privado', 'otro']);
const TIPOS_SUGERIBLES = new Set(['obra_ejecucion', 'obra_expediente', 'supervision', 'supervision_expediente', 'bienes_servicios']);

/**
 * El calendario del proceso como se guarda en `licitaciones.cronograma`:
 * [{ etapa, desde, hasta, fuente_pagina }]. Sin fecha válida no hay etapa.
 */
export function aCronograma(resultado = {}) {
  const etapas = Array.isArray(resultado.cronograma) ? resultado.cronograma : [];
  const vistas = new Set();
  const out = [];
  for (const e of etapas) {
    const desde = fechaISO(e?.desde) || fechaISO(e?.fecha);
    if (!desde) continue;
    const etapa = String(e?.etapa || '').trim().slice(0, 160);
    if (!etapa) continue;
    const k = normalizar(etapa) + '|' + desde;
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push({
      etapa, desde,
      hasta: fechaISO(e?.hasta),
      fuente_pagina: e?.fuente_pagina != null ? Math.round(num(e.fuente_pagina)) || null : null,
      verificada: e?.verificada !== false,
    });
  }
  return out.sort((a, b) => a.desde.localeCompare(b.desde));
}

/** La etapa del calendario que manda: la presentación de propuestas/ofertas. */
export function fechaPresentacionDe(cronograma) {
  const et = (cronograma || []).find(e => /PRESENTACION DE (PROPUESTAS|OFERTAS)/.test(normalizar(e.etapa)));
  return et ? (et.hasta || et.desde) : null;
}

/**
 * Los datos de cabecera que se pueden proponer para `licitaciones`.
 * Solo lo que el modelo puede saber leyendo: nada de tipo_trabajo ni de con
 * qué empresa postulamos — eso lo decide una persona y errarlo desarma la
 * postulación entera (mismo criterio que `ejecutora_tipo` en la entrega 1).
 * Lo que el documento SÍ dice del tipo (ejecución vs supervisión) viaja
 * aparte, en `sugerenciasDe()`, y la pantalla lo muestra como sugerencia.
 */
export function aCabeceraLicitacion(resultado = {}) {
  const p = resultado.proceso || {};
  const limpio = (v, max = 300) => (v ? String(v).trim().slice(0, max) : null);
  const monto = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const cronograma = aCronograma(resultado);
  const cons = resultado.consorcio && typeof resultado.consorcio === 'object' ? resultado.consorcio : {};
  return {
    nomenclatura: limpio(p.nomenclatura, 160),
    objeto: limpio(p.objeto, 400),
    nombre_inversion: limpio(p.nombre_inversion, 600),
    cui: /^\d{6,8}$/.test(String(p.cui || '').trim()) ? String(p.cui).trim() : null,
    entidad_convocante: limpio(p.entidad_convocante, 200),
    entidad_ruc: /^\d{11}$/.test(String(p.entidad_ruc || '').trim())
      ? String(p.entidad_ruc).trim() : null,
    mecanismo: MECANISMOS.has(p.mecanismo) ? p.mecanismo : null,
    valor_referencial: monto(p.valor_referencial),
    monto_ejecucion: monto(p.monto_ejecucion),
    monto_supervision: monto(p.monto_supervision),
    moneda: p.moneda === 'USD' ? 'USD' : 'PEN',
    plazo_ejecucion_dias: Number.isInteger(Number(p.plazo_ejecucion_dias)) && Number(p.plazo_ejecucion_dias) > 0
      ? Number(p.plazo_ejecucion_dias) : null,
    lugar: limpio(p.lugar, 200),
    sistema_contratacion: limpio(p.sistema_contratacion, 120),
    // La fecha que manda: la del proceso, o la etapa de presentación del calendario.
    fecha_presentacion: fechaISO(p.fecha_presentacion) || fechaPresentacionDe(cronograma),
    definicion_obras_similares: limpio(p.definicion_obras_similares, 2000),
    consorcio_permitido: typeof cons.permitido === 'boolean' ? cons.permitido : null,
    consorcio_reglas: limpio(cons.reglas, 1500),
  };
}

/**
 * Lo que el documento sugiere pero una persona decide. Va aparte de la
 * cabecera a propósito: se PRELLENA en el formulario, no se guarda solo.
 */
export function sugerenciasDe(resultado = {}) {
  const p = resultado.proceso || {};
  return {
    tipo_trabajo: TIPOS_SUGERIBLES.has(p.tipo_objeto_sugerido) ? p.tipo_objeto_sugerido : null,
  };
}

// ── Lo demás que dicen unas bases (mig 200) ────────────────────────
//
// Gabriel, 8-set-2026: «hay mucha data por extraer de allí y organizarla».
// Estas cinco listas son esa data. Todas pasan por la MISMA aduana de citas
// que los requisitos: un adelanto inventado o una penalidad que no existe
// cuestan tanto como un puesto inventado.

const textoCorto = (v, max = 400) => (v ? String(v).trim().slice(0, max) : null);
const fuenteDe = (x = {}) => ({
  fuente_pagina: x.fuente_pagina != null ? Math.round(num(x.fuente_pagina)) || null : null,
  fuente_cita: textoCorto(x.fuente_cita, 1200),
  verificada: x.verificada !== false,
});
const montoDe = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/** Los factores que dan PUNTAJE. No descalifican: por eso van aparte. */
export function aFactoresEvaluacion(resultado = {}) {
  return (Array.isArray(resultado.factores_evaluacion) ? resultado.factores_evaluacion : [])
    .map(f => ({
      factor: textoCorto(f?.factor, 200),
      puntaje_maximo: montoDe(f?.puntaje_maximo),
      criterio: textoCorto(f?.criterio, 600),
      ...fuenteDe(f),
    }))
    .filter(f => f.factor);
}

export const TIPO_GARANTIA_LBL = {
  fiel_cumplimiento: 'Fiel cumplimiento',
  adelanto_directo: 'Adelanto directo',
  adelanto_materiales: 'Adelanto de materiales',
  seriedad_oferta: 'Seriedad de oferta',
  otra: 'Otra garantía',
};

export function aGarantias(resultado = {}) {
  return (Array.isArray(resultado.garantias) ? resultado.garantias : [])
    .map(g => ({
      tipo: TIPO_GARANTIA_LBL[g?.tipo] ? g.tipo : 'otra',
      porcentaje: montoDe(g?.porcentaje),
      monto: montoDe(g?.monto),
      detalle: textoCorto(g?.detalle, 600),
      ...fuenteDe(g),
    }))
    .filter(g => g.detalle || g.porcentaje || g.monto);
}

export function aPenalidades(resultado = {}) {
  return (Array.isArray(resultado.penalidades) ? resultado.penalidades : [])
    .map(p => ({
      tipo: p?.tipo === 'mora' ? 'mora' : 'otra',
      formula: textoCorto(p?.formula, 300),
      tope: textoCorto(p?.tope, 200),
      detalle: textoCorto(p?.detalle, 600),
      ...fuenteDe(p),
    }))
    .filter(p => p.detalle || p.formula);
}

/** El índice del expediente: qué va en cada sobre y qué es obligatorio. */
export function aDocumentosPresentacion(resultado = {}) {
  const vistos = new Set();
  const out = [];
  for (const d of (Array.isArray(resultado.documentos_presentacion) ? resultado.documentos_presentacion : [])) {
    const documento = textoCorto(d?.documento, 300);
    if (!documento) continue;
    const k = normalizar(documento).slice(0, 80);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push({
      sobre: textoCorto(d?.sobre, 60),
      documento,
      obligatorio: d?.obligatorio !== false,
      ...fuenteDe(d),
    });
  }
  return out;
}

export const TIPO_CONDICION_LBL = {
  adelanto: 'Adelantos',
  forma_pago: 'Forma de pago',
  visita_obra: 'Visita de obra',
  plazo_firma: 'Plazo para firmar',
  subcontratacion: 'Subcontratación',
  seguros: 'Seguros',
  personal_obligatorio: 'Personal obligatorio en obra',
  otra: 'Otra condición',
};

/** «Las cosas a considerar»: lo que cambia la decisión y hoy alguien tiene
 *  que leer a mano en 96 páginas. */
export function aCondiciones(resultado = {}) {
  return (Array.isArray(resultado.condiciones) ? resultado.condiciones : [])
    .map(c => ({
      tipo: TIPO_CONDICION_LBL[c?.tipo] ? c.tipo : 'otra',
      titulo: textoCorto(c?.titulo, 200),
      detalle: textoCorto(c?.detalle, 800),
      ...fuenteDe(c),
    }))
    .filter(c => c.titulo || c.detalle);
}

/**
 * Quita repetidos de una lista de extras.
 *
 * 🔴 En la prueba del 8-set salieron «Sistema de contratación de Tarifas»,
 * «Costo de reproducción de las Bases» y «Plazo de prestación del servicio»
 * DOS VECES cada uno: dos pasadas sobre zonas que se pisan devuelven lo mismo,
 * y las listas de extras no tenían dedup (los requisitos sí). La identidad es
 * la cita, que es lo único que no cambia entre una pasada y la otra; si no hay
 * cita, el título.
 */
export function sinRepetidos(lista) {
  const vistos = new Set();
  const out = [];
  for (const x of (lista || [])) {
    const k = normalizar(x.fuente_cita || x.titulo || x.factor || x.documento || x.detalle).slice(0, 140);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    out.push(x);
  }
  return out;
}

/**
 * Todo lo de la mig 200 junto, para guardarlo en la postulación.
 *
 * 🔴 ACÁ SÍ SE DESCARTA LO NO VERIFICADO, y es la única lista donde se hace.
 * La regla general de este archivo es que lo que no se verifica se marca y lo
 * mira una persona, porque perder un REQUISITO cuesta la postulación. Con los
 * extras el balance es al revés: son datos de conveniencia, y uno inventado se
 * lee como un hallazgo. El 9-set-2026 la lectura de unas bases de 94 páginas
 * devolvió UN solo resultado —«Fiel cumplimiento · 10% … (contexto conocido
 * del documento)»— que el modelo había copiado de la pista del sistema, no del
 * documento. El verificador lo marcó y la pantalla lo mostró igual, como si
 * fuera lo único que decían esas bases.
 *
 * Lo descartado no se pierde: `extrasNoVerificados()` lo devuelve para que la
 * pantalla pueda avisar cuántos y por qué.
 */
export function aExtrasProceso(resultado = {}) {
  const vale = (x) => x.verificada !== false;
  return {
    factores_evaluacion: sinRepetidos(aFactoresEvaluacion(resultado)).filter(vale),
    garantias: sinRepetidos(aGarantias(resultado)).filter(vale),
    penalidades: sinRepetidos(aPenalidades(resultado)).filter(vale),
    documentos_presentacion: sinRepetidos(aDocumentosPresentacion(resultado)).filter(vale),
    condiciones: sinRepetidos(aCondiciones(resultado)).filter(vale),
  };
}

/** Los extras que NO pudieron comprobarse contra el documento. No se guardan,
 *  pero se cuentan: si son muchos, la lectura salió mal y hay que mirarla. */
export function extrasNoVerificados(resultado = {}) {
  const todos = [
    ...aFactoresEvaluacion(resultado), ...aGarantias(resultado), ...aPenalidades(resultado),
    ...aDocumentosPresentacion(resultado), ...aCondiciones(resultado),
  ];
  return todos.filter(x => x.verificada === false);
}

/**
 * El RUIDO de las alertas: lo que una pasada dice sobre lo que NO le tocó leer.
 *
 * 🔴 En la prueba del 8-set salieron 55 alertas y la mayoría eran la misma
 * queja escrita de ocho maneras: «el ANEXO C no fue proporcionado», «se
 * requiere el texto de las páginas 30 en adelante», «no es posible determinar
 * el objeto porque el contenido no fue incluido». Son ciertas para ESA pasada
 * —cada una recibe un tramo, no el documento— y falsas para la lectura
 * completa, porque otra pasada sí leyó esa parte. Gabriel: «55 para revisar a
 * mano es una barbaridad».
 *
 * No se borran a ciegas: se apartan. Lo accionable queda arriba y el ruido se
 * puede ver aparte, porque a veces el anexo de verdad no vino en el archivo.
 */
const RX_ALERTA_DE_TRAMO = new RegExp([
  'NO (FUE|FUERON|ESTA|ESTAN|SE) (PROPORCIONAD|INCLUID|SUMINISTRAD|ENCONTR)',
  'NO (APARECE|APARECEN|SE ENCUENTRA|SE ENCUENTRAN|SE INDICA|SE ESPECIFICA|SE MENCIONA|SE PUDO EXTRAER|ESTA DISPONIBLE|ESTAN DISPONIBLES)',
  'NO (ES POSIBLE|SE PUDIERON|PUDIERON) (DETERMINAR|EXTRAER)',
  'SE REQUIERE (EL TEXTO|REVISAR|LAS PAGINAS)',
  'EN EL TEXTO PROPORCIONADO',
  'PAGINAS PROPORCIONADAS',
  'EL TEXTO PROPORCIONADO (CONTIENE|CORRESPONDE)',
  'NO INCLUIDO',
].join('|'));

/**
 * Parte las alertas en las que hay que atender y el ruido de tramo.
 * @returns { accionables, deTramo }
 */
export function clasificarAlertas(alertas) {
  const accionables = [], deTramo = [];
  for (const a of (alertas || [])) {
    const t = String(a || '');
    // Las que arma `verificarResultado` NUNCA son ruido: son datos que el
    // modelo afirmó y el documento no respalda. Empiezan con la cosa entre
    // comillas angulares y dicen que la cita no aparece — que es exactamente
    // lo que el filtro de abajo buscaría, y acá significa lo contrario.
    if (t.trimStart().startsWith('«')) { accionables.push(t); continue; }
    (RX_ALERTA_DE_TRAMO.test(normalizar(t)) ? deTramo : accionables).push(t);
  }
  return { accionables, deTramo };
}

// ── EL ORDEN EN QUE HAY QUE MIRARLOS (9-set-2026) ─────────────────
//
// Gabriel: «sigo viendo todo muy desordenado, tal vez por ejemplo los
// requisitos los podamos ordenar por categorías y prioridades».
//
// La lista salía en el orden en que el modelo los fue encontrando, que es el
// orden del documento: mezclados, y con el RNP —que si falta impide presentarse
// siquiera— abajo de un topógrafo. El orden acá es el de la pregunta que se
// hace quien arma la postulación, de la más cara a la más barata:
//
//   1. ¿PODEMOS presentarnos?      RNP, habilitación, capacidad de contratación.
//      Si falta uno, no hay nada más que revisar.
//   2. ¿ACREDITAMOS lo que piden?  experiencia del postor, facturación, patrimonio.
//      Se resuelve con papeles de la empresa, o con un consorcio.
//   3. ¿TENEMOS a la gente?        primero quien conduce la obra, después los
//      especialistas, después el apoyo — que es el orden en que cuesta
//      conseguirlos y el orden en que las bases los puntúan.

/** Los tipos de requisito de empresa que IMPIDEN presentarse si faltan. */
const TIPOS_HABILITANTES = new Set(['rnp', 'habilitacion', 'capacidad_contratacion']);

/** Quien conduce la obra: es el puesto que las bases miran primero y el más
 *  difícil de reemplazar. */
const RX_JEFATURA = /(RESIDENTE|JEFE DE (SUPERVISION|PROYECTO|OBRA)|GERENTE|DIRECTOR|SUPERVISOR DE OBRA|INSPECTOR)/;
/** El apoyo: hace falta, pero no define si calificamos. */
const RX_APOYO = /(ASISTENTE|MAESTRO DE OBRA|TOPOGRAFO|ALMACENERO|AUXILIAR|PRACTICANTE|DIBUJANTE|ADMINISTRADOR)/;

/**
 * Los requisitos agrupados y ordenados para mostrarlos.
 *
 * Cada item conserva su índice original (`i`) porque la pantalla marca y
 * desmarca por índice: reordenar sin llevarse el índice guardaría el requisito
 * equivocado.
 *
 * @returns [{ clave, titulo, nota, clase, items: [{ f, i }] }]
 */
export function agruparRequisitos({ filas = [], filasEmpresa = [] } = {}) {
  const grupo = (clave, titulo, nota, clase, items) => ({ clave, titulo, nota, clase, items });
  const emp = filasEmpresa.map((f, i) => ({ f, i }));
  const per = filas.map((f, i) => ({ f, i }));

  const habilitantes = emp.filter(x => TIPOS_HABILITANTES.has(tipoDeFilaEmpresa(x.f)));
  const acreditables = emp.filter(x => !TIPOS_HABILITANTES.has(tipoDeFilaEmpresa(x.f)));
  const jefatura = per.filter(x => RX_JEFATURA.test(normalizar(x.f.cargo)));
  const apoyo = per.filter(x => !RX_JEFATURA.test(normalizar(x.f.cargo)) && RX_APOYO.test(normalizar(x.f.cargo)));
  const especialistas = per.filter(x => !jefatura.includes(x) && !apoyo.includes(x));

  return [
    grupo('habilitantes', 'Sin esto no nos podemos presentar',
      'Papeles de la empresa. Si falta uno, la oferta no entra: revísalo antes que nada.', 'empresa', habilitantes),
    grupo('acreditables', 'Lo que hay que acreditar con papeles',
      'Experiencia, facturación y patrimonio del postor. Es lo que se resuelve con un consorcio si no llegamos solos.', 'empresa', acreditables),
    grupo('jefatura', 'Quien conduce la obra',
      'Los puestos que las bases miran primero y los más difíciles de reemplazar.', 'personal', jefatura),
    grupo('especialistas', 'Especialistas', null, 'personal', especialistas),
    grupo('apoyo', 'Apoyo', 'Hacen falta, pero no son los que definen si calificamos.', 'personal', apoyo),
  ].filter(g => g.items.length);
}

/** El `tipo` original de una fila de empresa. La fila guarda el RÓTULO (mig
 *  199), así que se vuelve del rótulo al tipo. */
export function tipoDeFilaEmpresa(fila = {}) {
  if (fila.tipo && TIPO_REQ_EMPRESA_LBL[fila.tipo]) return fila.tipo;
  const entrada = Object.entries(TIPO_REQ_EMPRESA_LBL).find(([, lbl]) => lbl === fila.cargo);
  return entrada ? entrada[0] : 'otro';
}

// ── El costo, medido y no estimado ─────────────────────────────────

/** USD por página de OCR con el default histórico, `mistral-ocr-2512` = OCR 3
 *  (lib/mistral-ocr.js). Desde la tanda 19 el modelo se elige en Administración
 *  → Modelos de IA y OCR 4.1 vale el doble, así que el precio VIAJA con la
 *  llamada: esta constante es solo el piso para cuando nadie eligió nada. */
export const USD_POR_PAGINA_OCR = 0.002;

/**
 * Lo que costó un análisis. Se guarda y se MUESTRA: sin esto, «¿cuánto me
 * cuesta analizar una base?» se contesta con una estimación, y las
 * estimaciones de IA de esta app ya fallaron una vez (el alias de Mistral que
 * se movió solo y duplicó el precio sin que nadie se enterara).
 */
export function costoDelAnalisis({ paginasOcr = 0, usdPasadas = 0, usdPorPagina = USD_POR_PAGINA_OCR } = {}) {
  const precio = num(usdPorPagina) > 0 ? num(usdPorPagina) : USD_POR_PAGINA_OCR;
  const ocr = num(paginasOcr) * precio;
  const total = ocr + num(usdPasadas);
  return {
    ocr: Number(ocr.toFixed(4)),
    pasadas: Number(num(usdPasadas).toFixed(4)),
    total: Number(total.toFixed(4)),
  };
}

export default {
  SECCIONES, REGIMENES, detectarRegimen, clasificarRegimen, ROTULOS_REGIMEN,
  normalizar, clave, contieneClave, contarClave, esRenglonDeIndice,
  citaEsPlantilla, camposSinLlenar, RX_CAMPO_SIN_LLENAR,
  fragmentosPorPagina, indiceDeSecciones, resumenIndice,
  textoDeRango, verificarCita, verificarResultado,
  aFilaRequisito, aFilasRequisitos, aFilaRequisitoEmpresa, aFilasEmpresa,
  aCabeceraLicitacion, aCronograma, fechaPresentacionDe, fechaISO, sugerenciasDe,
  aFactoresEvaluacion, aGarantias, aPenalidades, aDocumentosPresentacion,
  aCondiciones, aExtrasProceso, extrasNoVerificados, sinRepetidos, clasificarAlertas,
  topeDelIndice, elegirAciertos, agruparRequisitos, tipoDeFilaEmpresa,
  pareceRequisitoDeEmpresa, comoRequisitoDeEmpresa, CARGOS_QUE_SON_LA_EMPRESA,
  TIPO_GARANTIA_LBL, TIPO_CONDICION_LBL,
  TIPO_REQ_EMPRESA_LBL, MAX_CHARS_RANGO, costoDelAnalisis, USD_POR_PAGINA_OCR,
};
