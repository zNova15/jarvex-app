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
    ],
  },
  presentacion: {
    label: 'Estructura de la oferta',
    claves: [
      'CONTENIDO DE LAS OFERTAS', 'DOCUMENTOS DE PRESENTACION OBLIGATORIA',
      'DOCUMENTACION DE PRESENTACION', 'FOLIADO', 'SOBRE N',
      'ANEXO N', 'FORMATO N',
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
      'OBRAS POR IMPUESTOS', 'LEY N° 29230', 'LEY N 29230', 'NOMBRE DE LA INVERSION',
      'PROCESO DE SELECCION N', 'MONTO DE INVERSION',
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
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
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
export function indiceDeSecciones(markdown, { maxPorFamilia = 12 } = {}) {
  const fragmentos = fragmentosPorPagina(markdown);
  const indice = {};
  for (const fam of Object.keys(SECCIONES)) indice[fam] = [];

  for (const frag of fragmentos) {
    const lineas = frag.texto.split(/\n+/);
    for (const linea of lineas) {
      const n = normalizar(linea);
      if (!n) continue;
      for (const [fam, def] of Object.entries(SECCIONES)) {
        if (indice[fam].length >= maxPorFamilia) continue;
        const clave = def.claves.find(k => n.includes(k));
        if (!clave) continue;
        // El renglón se recorta: al Pase 1 le alcanza para reconocer la
        // sección, y mandar párrafos enteros devolvería el problema de origen.
        indice[fam].push({
          pagina: frag.pagina,
          clave,
          linea: linea.trim().slice(0, 220),
        });
      }
    }
  }
  return indice;
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
 * El texto de un rango de páginas, para el Pase 2.
 * `desde`/`hasta` son inclusivos. Sin páginas (un .docx) devuelve todo.
 */
export function textoDeRango(markdown, desde, hasta) {
  const fragmentos = fragmentosPorPagina(markdown);
  const sinPagina = fragmentos.every(f => f.pagina == null);
  if (sinPagina) return fragmentos.map(f => f.texto).join('\n\n');
  return fragmentos
    .filter(f => f.pagina != null && f.pagina >= desde && f.pagina <= hasta)
    .map(f => `<!-- página ${f.pagina} -->\n${f.texto}`)
    .join('\n\n');
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
export function verificarCita(markdown, cita, pagina = null) {
  const texto = String(cita || '').trim();
  if (texto.length < 12) {
    return { verificada: false, motivo: 'sin cita (o demasiado corta para comprobarla)', paginaReal: null };
  }
  const fragmentos = fragmentosPorPagina(markdown);
  if (!fragmentos.length) return { verificada: false, motivo: 'documento vacío', paginaReal: null };

  const donde = fragmentos.filter(f => contiene(f.texto, texto));
  if (!donde.length) {
    return { verificada: false, motivo: 'la cita no aparece en el documento', paginaReal: null };
  }
  const paginaReal = donde[0].pagina;
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
  const consorcio = r.consorcio && typeof r.consorcio === 'object' && r.consorcio.fuente_cita
    ? marcar(r.consorcio, 'reglas de consorcio')
    : (r.consorcio || null);
  return { ...r, requisitos, requisitos_empresa, cronograma, consorcio, alertas };
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
    descripcion: req.descripcion ? String(req.descripcion).trim().slice(0, 600) : null,
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

// ── El costo, medido y no estimado ─────────────────────────────────

/** USD por página de OCR — el snapshot fijo `mistral-ocr-2512` (lib/mistral-ocr.js). */
export const USD_POR_PAGINA_OCR = 0.002;

/**
 * Lo que costó un análisis. Se guarda y se MUESTRA: sin esto, «¿cuánto me
 * cuesta analizar una base?» se contesta con una estimación, y las
 * estimaciones de IA de esta app ya fallaron una vez (el alias de Mistral que
 * se movió solo y duplicó el precio sin que nadie se enterara).
 */
export function costoDelAnalisis({ paginasOcr = 0, usdPasadas = 0 } = {}) {
  const ocr = num(paginasOcr) * USD_POR_PAGINA_OCR;
  const total = ocr + num(usdPasadas);
  return {
    ocr: Number(ocr.toFixed(4)),
    pasadas: Number(num(usdPasadas).toFixed(4)),
    total: Number(total.toFixed(4)),
  };
}

export default {
  SECCIONES, normalizar, fragmentosPorPagina, indiceDeSecciones, resumenIndice,
  textoDeRango, verificarCita, verificarResultado,
  aFilaRequisito, aFilasRequisitos, aFilaRequisitoEmpresa, aFilasEmpresa,
  aCabeceraLicitacion, aCronograma, fechaPresentacionDe, fechaISO, sugerenciasDe,
  TIPO_REQ_EMPRESA_LBL, costoDelAnalisis, USD_POR_PAGINA_OCR,
};
