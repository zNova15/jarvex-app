// ═══════════════════════════════════════════════════════════════════
// JARVEX — SUBFAMILIAS Y RECOMENDACIONES DE MOVIDA (tanda 14, entrega 2.1).
//
// Gabriel, 7-set-2026, después de importar el catálogo:
//   «me decepcionó un poco que en la parte de catálogo solo se subiera todo tal
//    cual, esperaba que agregues recomendaciones incluso del tipo de categorías
//    para movilizar algunos insumos a otros grupos de familia. Actualmente me
//    parece que incluso las familias son muy generales.»
//
// Tenía razón en las dos cosas, y las dos se arreglan acá.
//
// ── 1. LAS FAMILIAS SON MUY GENERALES ──────────────────────────────
// Medido sobre su archivo: «IMPLEMENTOS DE SEGURIDAD» son 64 cosas en una sola
// bolsa —cascos, camillas, conos, arneses y un balón de oxígeno—; «EQUIPOS Y
// HERRAMIENTAS» son 66 donde conviven una retroexcavadora y una brocha. Diez
// familias no alcanzan para trabajar. Este archivo agrega un SEGUNDO NIVEL de
// ~30 subfamilias.
//
// El nivel fino NO se inventa desde cero: para lo civil reusa las familias
// técnicas que `mapeo-insumos.js` ya tiene medidas contra producción (tubería
// PVC, accesorio PVC, HDPE, válvula, cemento, agregado, acero corrugado, acero
// estructural, eléctrico, sanitario, madera, ferretería, pintura, combustible).
// Lo que ese motor NO cubría —EPP, herramientas, administrativos y servicios,
// que eran 212 de 478 sin clasificar— se agrega acá.
//
// ── 2. LAS RECOMENDACIONES DE MOVIDA, SIN CRIAR RUIDO ──────────────
// La regla que las hace confiables: **primero se busca la subfamilia dentro del
// vocabulario de su PROPIA familia. Solo si ahí no pegó nada y sí pegó en otra
// familia, se propone moverlo.**
//
// Sin esa regla, un «PANTALÓN DE TELA DRILL CON CINTA REFLECTIVA» se iba a
// ferretería por la palabra «cinta», un «CILINDRO CON ARENA» a agregados por
// «arena» y un «CABLE DE ACERO TIPO BOA» a eléctrico por «cable». Los tres
// están bien donde están. Esa es la lección del 4% de detracción de
// construcción: una herramienta que propone mal le hace perder el tiempo a
// quien la usa, y se deja de abrir.
//
// Y lo que se descarta NO vuelve a proponerse (`revisado`): decir «está bien
// así» es una respuesta y se recuerda, igual que en `insumo_mapeo`.
//
// Puro: sin React, sin Dexie, sin fetch.
// ═══════════════════════════════════════════════════════════════════

import { normMapeo, familiaDe, FAMILIAS } from './mapeo-insumos.js';

// ── LAS SUBFAMILIAS ────────────────────────────────────────────────
// `familias` dice a qué familia(s) comercial(es) pertenece naturalmente cada
// subfamilia. Es lo que permite decir «esto está en la familia equivocada».
// El ORDEN importa: lo más específico primero (un examen médico es salud antes
// que personal; una camilla es emergencia antes que herramienta).
export const SUBFAMILIAS = [
  // ── Servicios ────────────────────────────────────────────────────
  { slug: 'servicio_salud', label: 'Exámenes y salud ocupacional', familias: ['servicios'],
    re: /\b(examen(es)? medicos?|medicos? ocupacional(es)?|preocupacional(es)?|primeros auxilios)\b/ },
  { slug: 'servicio_capacitacion', label: 'Capacitación y simulacros', familias: ['servicios'],
    re: /\b(capacitaci(on|ones)|charlas?|simulacros?|induccion|entrenamiento|manuales|publicaciones)\b/ },
  { slug: 'servicio_monitoreo', label: 'Monitoreos, ensayos y planes', familias: ['servicios'],
    re: /\b(monitoreos?|muestreos?|ensayos?|certificad|plan de (monitoreo|seguridad|manejo)|estudios?)\b/ },
  { slug: 'servicio_alquiler', label: 'Alquileres', familias: ['servicios'],
    re: /\b(alquiler(es)?|arrendamiento)\b/ },
  { slug: 'servicio_transporte', label: 'Transporte y fletes', familias: ['servicios'],
    re: /\b(transportes?|fletes?|acarreos?|pasajes?)\b/ },
  { slug: 'servicio_personal', label: 'Personal y honorarios', familias: ['servicios'],
    re: /\b(chofer(es)?|operarios?|peon(es)?|capataz|topografos?|arqueolog|especialistas?|honorarios?|jornal(es)?|licenciado|gastos operativos)\b/ },
  { slug: 'servicio_mantenimiento', label: 'Mantenimiento y limpieza', familias: ['servicios'],
    re: /\b(mantenimientos?|reparacion(es)?|limpieza|acondicionamiento)\b/ },
  { slug: 'servicio_alimentacion', label: 'Alimentación del personal', familias: ['servicios', 'administrativos'],
    re: /\b(alimentacion|refrigerios?|almuerzos?|desayunos?)\b/ },

  // ── Seguridad: primero lo médico/emergencia, después el EPP ──────
  { slug: 'seguridad_emergencia', label: 'Emergencia y primeros auxilios', familias: ['seguridad'],
    re: /\b(extintor(es)?|botiquin(es)?|camillas?|megafonos?|alarmas?|kits? antiderrame|estacion(es)? de emergencia|cilindros? con arena|collarin(es)?|ferulas?|cabestrillos?|inmo(b|v)ilizador(es)?|lavaojos|resucitador(es)?|ambu|balon(es)? .*oxigeno|quirurgic|pulsometros?|termometros?|medidor(es)? de presion|tachos?|cilindros? .*provision)\b/ },
  { slug: 'seguridad_senalizacion', label: 'Señalización y cerco', familias: ['seguridad'],
    re: /\b(se(n|ñ)al(es|izacion)?|letreros?|carteles?|gigantografias?|paletas?|tranqueras?|balizas?|caballetes?|cachacos?|conos? (de se(n|ñ)alizacion|naranja|de seguridad)|mallas? (cercadora|de seguridad|naranja)|cintas? de (se(n|ñ)alizacion|seguridad)|tapas? de madera)\b/ },
  { slug: 'epp_cabeza', label: 'EPP · cabeza', familias: ['seguridad'],
    re: /\b(cascos?|barbiquejos?|gorros?|capuchon(es)?|cortavientos?)\b/ },
  { slug: 'epp_vision', label: 'EPP · ojos y cara', familias: ['seguridad'],
    re: /\b(lentes?|caretas?|gafas|goggles|monogafas|visor(es)? facial(es)?)\b/ },
  { slug: 'epp_auditivo', label: 'EPP · oídos', familias: ['seguridad'],
    re: /\b(protector(es)? de oidos?|tapon(es)? auditivos?|orejeras?)\b/ },
  { slug: 'epp_respiratorio', label: 'EPP · respiratorio', familias: ['seguridad'],
    re: /\b(respirador(es)?|mascarillas?|filtros? (de|para) (gas|polvo|vapor)|ty(v|b)ek)\b/ },
  { slug: 'epp_manos', label: 'EPP · manos', familias: ['seguridad'],
    re: /\b(guantes?|mangas de cuero|manoplas?)\b/ },
  { slug: 'epp_pies', label: 'EPP · pies', familias: ['seguridad'],
    re: /\b(botines?|botas?|zapatos?|zapatillas?|punta de acero)\b/ },
  { slug: 'epp_altura', label: 'EPP · trabajo en altura', familias: ['seguridad'],
    re: /\b(arn(es|eses)|linea de (vida|enganche)|eslingas?|mosqueton(es)?|puntos? de anclaje)\b/ },
  { slug: 'epp_ropa', label: 'EPP · ropa de trabajo', familias: ['seguridad'],
    re: /\b(chalecos?|pantalon(es)?|camisas?|polos?|ponchos?|trajes?|mamelucos?|uniformes?|mandil(es)?|bloqueador(es)? solar(es)?|trapos? industrial)\b/ },

  // ── Equipos y herramientas ───────────────────────────────────────
  { slug: 'equipo_pesado', label: 'Equipo pesado', familias: ['equipos_herramientas'],
    re: /\b(cargador(es)?|retroexcavadoras?|excavadoras?|volquetes?|camion(es)?|motoniveladoras?|rodillos? (liso|compactador)|tractor(es)?|gruas?|mezcladoras?|trompos?|compactador(es)?|planchas? vibratoria|vibradoras?|apisonadoras?|winches?|montacargas)\b/ },
  { slug: 'equipo_electrico', label: 'Equipo eléctrico y bombas', familias: ['equipos_herramientas'],
    re: /\b(taladros?|amoladoras?|moladoras?|esmeril(es)?|sierras? circular(es)?|soldadoras?|compresoras?|generador(es)?|grupos? electrogeno|motobombas?|electrobombas?|bombas?|vibrador(es)?|cortadoras?|linternas?)\b/ },
  { slug: 'herramienta_medicion', label: 'Medición y topografía', familias: ['equipos_herramientas'],
    re: /\b(winchas?|wichas?|niveles?|nivel|teodolitos?|estacion(es)? total|miras?|jalon(es)?|escuadras?|plomadas?|flexometros?|manometros?|balanzas?|multimetros?)\b/ },
  { slug: 'consumible_herramienta', label: 'Consumibles de herramienta', familias: ['equipos_herramientas'],
    re: /\b(discos? de|brocas?|hojas? de sierra|electrodos?|lijas?|carbones?|cintas? aislante|exten(c|s)ion(es)?)\b/ },
  { slug: 'herramienta_manual', label: 'Herramienta manual', familias: ['equipos_herramientas'],
    re: /\b(picos?|palanas?|palas?|lampas?|barretas?|rastrillos?|carretillas?|martillos?|combas?|cincel(es)?|badilejos?|frotachos?|reglas? de aluminio|serruchos?|cierras?|alicates?|llaves?|dados?|destornillador(es)?|tenazas?|brochas?|rodillos?|escaleras?|baldes?|valdes?|cilindros? vacios?|buguis?|prensas?|espatulas?|cizallas?|andamios?)\b/ },

  // ── Administrativos ──────────────────────────────────────────────
  { slug: 'admin_computo', label: 'Cómputo e impresión', familias: ['administrativos'],
    re: /\b(impresoras?|laptops?|computadoras?|monitor(es)?|teclados?|mouse|usb|discos? duros?|estabilizador(es)?|router(s)?|tintas?|toner)\b/ },
  { slug: 'admin_mobiliario', label: 'Mobiliario de oficina', familias: ['administrativos'],
    re: /\b(mesas?|sillas?|estantes?|escritorios?|pizarras?|armarios?|casilleros?)\b/ },
  { slug: 'admin_documentos', label: 'Documentos y trámites', familias: ['administrativos'],
    re: /\b(copias?|expedientes?|impresion(es)?|empastados?|anillados?|fotochecks?|caja chica)\b/ },
  { slug: 'admin_consumo', label: 'Consumo de oficina', familias: ['administrativos'],
    re: /\b(agua mineral|bidon(es)?|cafe|azucar)\b/ },
  { slug: 'admin_papeleria', label: 'Papelería y útiles', familias: ['administrativos'],
    re: /\b(papel(es)?|lapiceros?|resaltador(es)?|corrector(es)?|folder(es)?|archivador(es)?|micas?|clips|plumon(es)?|cuadernos?|sobres?|engrapador(es)?|grapadoras?|perforador(es)?|cutter|borrador(es)?|post|goma|mota)\b/ },
];

// Las familias TÉCNICAS de `mapeo-insumos.js` también son subfamilias — las de
// lo civil, que es lo que ese motor ya sabe leer. Se declara a qué familia
// comercial pertenece cada una para poder detectar las movidas.
export const SUBFAMILIAS_TECNICAS = {
  tuberia_pvc:      { label: 'Tubería PVC',              familias: ['tuberia_accesorios'] },
  tuberia_hdpe:     { label: 'Tubería HDPE',             familias: ['tuberia_accesorios'] },
  tuberia_metalica: { label: 'Tubería metálica',         familias: ['tuberia_accesorios', 'perfiles_metalicos'] },
  accesorio_pvc:    { label: 'Accesorios',               familias: ['tuberia_accesorios', 'perfiles_metalicos'] },
  valvula:          { label: 'Válvulas y grifería',      familias: ['valvulas'] },
  sanitario:        { label: 'Aparatos sanitarios',      familias: ['valvulas', 'ferreteria', 'tuberia_accesorios'] },
  cemento:          { label: 'Cemento',                  familias: ['agregados'] },
  agregado:         { label: 'Agregados',                familias: ['agregados'] },
  acero_corrugado:  { label: 'Acero corrugado',          familias: ['perfiles_metalicos'] },
  acero_estructural:{ label: 'Acero estructural',        familias: ['perfiles_metalicos'] },
  madera:           { label: 'Madera',                   familias: ['madera'] },
  electrico:        { label: 'Material eléctrico',       familias: ['ferreteria', 'tuberia_accesorios'] },
  pintura:          { label: 'Pinturas y solventes',     familias: ['ferreteria'] },
  combustible:      { label: 'Combustibles y lubricantes', familias: ['otros', 'equipos_herramientas'] },
  ferreteria:       { label: 'Ferretería general',       familias: ['ferreteria'] },
};

export const SUBFAMILIA_LBL = {
  ...Object.fromEntries(SUBFAMILIAS.map(s => [s.slug, s.label])),
  ...Object.fromEntries(Object.entries(SUBFAMILIAS_TECNICAS).map(([k, v]) => [k, v.label])),
};

export const etiquetaSubfamilia = (slug) => SUBFAMILIA_LBL[slug] || slug || '—';

/** Las familias comerciales donde una subfamilia vive naturalmente. */
export function familiasDeSubfamilia(slug) {
  const s = SUBFAMILIAS.find(x => x.slug === slug);
  if (s) return s.familias;
  return SUBFAMILIAS_TECNICAS[slug]?.familias || [];
}

/** Todas las subfamilias que pertenecen a una familia comercial. */
export function subfamiliasDe(familia) {
  const propias = SUBFAMILIAS.filter(s => s.familias.includes(familia)).map(s => s.slug);
  const tecnicas = Object.entries(SUBFAMILIAS_TECNICAS)
    .filter(([, v]) => v.familias.includes(familia)).map(([k]) => k);
  return [...propias, ...tecnicas];
}

/** La primera familia TÉCNICA (mapeo-insumos) que pega y está permitida. */
function tecnicaEntre(norm, permitidas) {
  const s = ` ${norm} `;
  for (const [nombre, re] of FAMILIAS) {
    if (!permitidas.has(nombre)) continue;
    if (re.test(s)) return nombre;
  }
  return null;
}

/** ¿La evidencia de esa subfamilia está en las dos primeras palabras? */
function enLaCabeza(norm, slug) {
  const cabeza = ` ${norm.split(' ').slice(0, 2).join(' ')} `;
  const sub = SUBFAMILIAS.find(x => x.slug === slug);
  if (sub) return sub.re.test(cabeza);
  const tec = FAMILIAS.find(([n]) => n === slug);
  return tec ? tec[1].test(cabeza) : false;
}

/** La primera subfamilia del vocabulario nuevo que pega con el nombre. */
function subfamiliaPorTexto(norm, permitidas = null) {
  const s = ` ${norm} `;
  for (const sub of SUBFAMILIAS) {
    if (permitidas && !permitidas.has(sub.slug)) continue;
    if (sub.re.test(s)) return sub.slug;
  }
  return null;
}

/**
 * Propone la subfamilia de un insumo y, si corresponde, moverlo de familia.
 *
 * 🔴 EL ORDEN ES LA REGLA QUE EVITA EL RUIDO:
 *   1. Se busca SOLO entre las subfamilias de su propia familia. Si pega, listo:
 *      queda donde está, con su nivel fino. Nada que recomendar.
 *   2. Si no pegó ninguna, recién ahí se busca en TODAS. Si el ganador vive en
 *      otra familia, ESO es la recomendación de movida, y viene con el motivo.
 *   3. Si tampoco pega nada, se devuelve `null` y no se inventa.
 *
 * Al revés —puntuar todo contra todo— «PANTALÓN CON CINTA REFLECTIVA» se iba a
 * ferretería por «cinta» y «CILINDRO CON ARENA» a agregados por «arena». Los
 * dos están bien donde están.
 *
 * @returns {{ subfamilia, label, familiaSugerida, motivo }|null}
 */
export function sugerirSubfamilia(nombre, familia) {
  const norm = normMapeo(nombre);
  if (!norm) return null;
  const permitidas = new Set(subfamiliasDe(familia));

  // 1. Dentro de su propia familia — el vocabulario nuevo primero, después el
  //    técnico (que es el que sabe leer «TUBERIA PVC UF S25 DE 8"»).
  const propia = subfamiliaPorTexto(norm, permitidas);
  if (propia) return { subfamilia: propia, label: etiquetaSubfamilia(propia), familiaSugerida: null, motivo: null };
  // La familia técnica se busca ENTRE LAS PERMITIDAS, no con familiaDe() a
  // secas: «VALVULA COMPUERTA ACERROJADA 4" PARA HDPE» daba `tuberia_hdpe`
  // porque esa regla va antes en la lista global, y la mandaba a mudarse
  // estando perfectamente en Válvulas.
  const tecnicaPropia = tecnicaEntre(norm, permitidas);
  if (tecnicaPropia) return { subfamilia: tecnicaPropia, label: etiquetaSubfamilia(tecnicaPropia), familiaSugerida: null, motivo: null };

  // 2. Fuera de su familia: acá nace la recomendación de movida.
  const tecnica = familiaDe(norm);
  const ajena = subfamiliaPorTexto(norm) || (tecnica !== 'otro' ? tecnica : null);
  if (!ajena) return null;
  const destinos = familiasDeSubfamilia(ajena);
  const destino = destinos[0] || null;
  // 🔴 LA REGLA QUE MATA EL RUIDO: para MUDAR algo de familia, la evidencia
  // tiene que estar en la CABEZA del nombre, no en un adjetivo del final.
  // Medido sobre el archivo de Gabriel, sin esto se proponía mandar un
  // «TANQUE DE AGUA COLOR ARENA» a Agregados, un «ADHESIVO EPÓXICO DE ANCLAJE»
  // a EPP de altura y un «MALETÍN QUIRÚRGICO (PINZAS, TIJERAS)» a Papelería.
  // Nombrar el objeto es lo primero que hace una descripción; lo que viene
  // después lo describe.
  if (!destino || destino === familia || !enLaCabeza(norm, ajena)) {
    return { subfamilia: ajena, label: etiquetaSubfamilia(ajena), familiaSugerida: null, motivo: null };
  }
  return {
    subfamilia: ajena,
    label: etiquetaSubfamilia(ajena),
    familiaSugerida: destino,
    motivo: `parece «${etiquetaSubfamilia(ajena)}», y eso no está en esta familia`,
  };
}

/**
 * Repasa el catálogo entero: qué subfamilia le toca a cada fila y cuáles
 * parecen estar en la familia equivocada.
 *
 * Lo ya decidido no se toca: una fila con `subfamilia` grabada se respeta, y
 * una marcada `revisado` no vuelve a aparecer entre las recomendaciones —
 * decir «está bien así» es una respuesta y se recuerda.
 *
 * @returns {{ propuestas, recomendaciones, sinSubfamilia, porSubfamilia }}
 */
export function revisarCatalogo(filas) {
  const propuestas = [];        // fila sin subfamilia grabada, con una propuesta
  const recomendaciones = [];   // además, parece de otra familia
  const porSubfamilia = new Map();
  let sinSubfamilia = 0;
  for (const r of filas || []) {
    if (!r || r.deleted_at || r.activo === false) continue;
    const sug = r.subfamilia ? null : sugerirSubfamilia(r.nombre, r.familia);
    const efectiva = r.subfamilia || sug?.subfamilia || null;
    if (efectiva) porSubfamilia.set(efectiva, (porSubfamilia.get(efectiva) || 0) + 1);
    else sinSubfamilia++;
    if (!sug) continue;
    propuestas.push({ id: r.id, nombre: r.nombre, familia: r.familia, ...sug });
    if (sug.familiaSugerida && !r.revisado) {
      recomendaciones.push({ id: r.id, nombre: r.nombre, familia: r.familia, unidad: r.unidad, ...sug });
    }
  }
  recomendaciones.sort((a, b) =>
    String(a.familiaSugerida).localeCompare(String(b.familiaSugerida))
    || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  return { propuestas, recomendaciones, sinSubfamilia, porSubfamilia };
}
