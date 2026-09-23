// ═══════════════════════════════════════════════════════════════════
// JARVEX — LAS REGLAS DE DESEMPATE DE LOS PARES DIFÍCILES (tanda 3, 15-set-2026).
//
// QUÉ ES UN «PAR DIFÍCIL». Dos clasificaciones que el parecido de palabras
// confunde SIEMPRE en la misma dirección, porque la descripción nombra el
// material del que está hecha la cosa en vez de decir qué es. «GUANTE DE ACERO
// ANTICORTE DE MALLA METÁLICA» dice ACERO y METÁLICA tres veces y es un EPP;
// «ROLLO INDECO 14MM» no dice cable en ninguna parte y es cable.
//
// ── LO QUE SE MIDIÓ ANTES DE ESCRIBIR ESTO (no es una lista de ocurrencias) ──
// El motor local corrido contra los 32 casos reales de
// `scripts/piloto/set-clasificacion.json` el 15-set-2026: **19 bien, 13 mal**.
// Las 13 fallas caen en seis pares, y son los mismos seis con los que tropiezan
// los modelos de IA en el piloto de la tanda 2:
//
//   1. [07]/[19] cable ↔ acero y planchas   ROLLO INDECO 14MM → sin_clasificar
//                                           (los TRES modelos también fallan)
//   2. [83] EPP ↔ el material de la prenda  GUANTE DE ACERO → [46] malla de acero
//                                           PANTALON … OBRERO → [37] herramienta
//   3. tubería ↔ [10] aparato sanitario     TUBO HDPE PE100 → [10]
//      (el Anexo 2 tiene «Tubo de abasto»   tubo rectangular 4 x 8 → [10]
//       bajo [10]: el token «tubo» solo      TUBO E. CUAD. 3/4 ×1.2 y ×1.5 → [10]
//       arrastra media tubería del mundo)
//   4. administrativos ↔ material           MESA DE MELAMINE → sin_clasificar
//      (oficina, mobiliario, bebida,        PERFORADOR FABER CASTELL → [13] asfalto
//       gasto financiero)                   CUSQUEÑA → sin_clasificar
//                                           ANTICIPO DE CLIENTE, INMOBILIARIA BCP
//   5. servicios ↔ material                 SEGURO DE CONSTRUCCION → [37]
//   6. [48] maquinaria liviana ↔ [37]       hoy sale bien; es el par que la IA
//      herramienta manual                    confunde y el que se rompe solo
//
// ── DÓNDE MANDAN Y DÓNDE NO ───────────────────────────────────────
// Estas reglas son LECTURA DE LA NORMA, no vocabulario aprendido. Por eso:
//   · Le ganan a un parecido de tokens, al diccionario APRENDIDO y a
//     `sin_clasificar` (ahí está el valor: «CUSQUEÑA → [21] cemento» era un
//     término aprendido).
//   · NO le ganan a una coincidencia EXACTA del Anexo 2 ni a un término que
//     alguien escribió A MANO en el panel. Si la R.J. 016-2026 dice esa frase
//     con todas las letras, manda la R.J.; si Gabriel la corrigió a mano, manda
//     Gabriel. Es la misma jerarquía de tres capas de la tanda 1.
//   · NO pisan un código de SERVICIO ya elegido (`S…`, `servicios`), salvo la
//     regla 5, que justamente lleva hacia allá. Un «SERVICIO DE LAVADO DE
//     UNIFORMES» no es un EPP porque diga uniformes.
//
// ── Y TAMBIÉN VIAJAN A LA IA ──────────────────────────────────────
// `reglasDesempateParaIA()` devuelve el texto corto de las reglas que dispara
// ESTA descripción —no las seis, las que aplican— y el prompt las inyecta.
// Escribir la regla dos veces (una en regex y otra en prosa dentro del prompt)
// es la receta para que se contradigan a la primera corrección.
//
// Lib PURA y sin dependencias: `indices-unificados-iupc.js` la importa, así que
// no puede importar nada de allá (ciclo).
// ═══════════════════════════════════════════════════════════════════

/** La misma normalización de `normIUPC`, replicada acá para no crear un ciclo. */
export const normDesempate = (s) => String(s || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** ¿Es un código del árbol de servicios o el cajón genérico? */
const esServicio = (cod) => /^S\d/i.test(String(cod || '')) || String(cod) === 'servicios';

// ── 1. CABLE ELÉCTRICO ↔ ACERO Y PLANCHAS ─────────────────────────
// INDECO y CEPER son fabricantes peruanos de conductores eléctricos. Una
// factura dice «ROLLO INDECO 14MM» y no menciona la palabra cable en ningún
// lado: el motor no tiene de dónde agarrarse y los tres modelos del piloto lo
// mandaron a acero o a plancha aluzinc.
const MARCA_CABLE = /\b(indeco|ceper|nexans)\b/;
const NORMA_CABLE = /\b(thw|tw|lsoh|nh\s?80|nh80|awg|libre de halogeno|vulcanizado|mellizo|gpt)\b/;
const CABLE_NO_ELECTRICO = /\b(cable de acero|cable acerado|guaya|eslinga|winche)\b/;

// ── 2. EPP ↔ EL MATERIAL DE LA PRENDA ─────────────────────────────
// El sustantivo manda sobre el adjetivo: un guante de acero es un guante.
const PRENDA_EPP = /\b(guante|guantes|casco|cascos|botin|botines|bota|botas|zapato|zapatos|zapatilla|zapatillas|chaleco|chalecos|arnes|arneses|lente|lentes|gafa|gafas|goggle|goggles|mascarilla|mascarillas|respirador|respiradores|orejera|orejeras|barbiquejo|mameluco|mamelucos|overol|overoles|uniforme|uniformes|pantalon|camisa|camisaco|poncho|careta|caretas|mandil|escarpin|escarpines|tafilete)\b/;
const EPP_COMPUESTO = /\b(linea de vida|tapon(?:es)? (?:de oido|auditivos?)|punta de acero|cinta reflectiva|anticorte|antideslizante|dielectric\w+)\b/;
// «SERVICIO DE LAVADO DE UNIFORMES» no es un EPP; «ALQUILER DE ARNESES» tampoco.
const PRENDA_EN_SERVICIO = /\b(lavado|lavanderia|confeccion|bordado|estampado|reparacion)\b/;

// ── 3. TUBERÍA: EL MATERIAL DEL TUBO MANDA ────────────────────────
// El Anexo 2 tiene «Tubo de abasto» bajo [10] Aparato sanitario con grifería.
// Como «tubo» es un token cortísimo y frecuentísimo, arrastra hacia el [10]
// media tubería del catálogo. La salida no es sacar el término de la norma
// —está bien puesto— sino mirar DE QUÉ es el tubo antes de decidir.
const ES_TUBO = /\b(tubo|tubos|tuberia|tuberias|caneria|canerias)\b/;
// Dos vecindarios donde «tubo» no es tubería de conducción y la regla se
// abstiene: el sanitario (donde el [10] del Anexo 2 SÍ corresponde) y la
// iluminación — un «TUBO FLUORESCENTE 36W» es un artefacto de alumbrado.
const TUBO_SANITARIO = /\b(abasto|inodoro|lavatorio|urinario|griferia|ducha|sifon|trampa|flexible|fluorescente|led|ahorrador|luminaria)\b/;
const MATERIAL_TUBO = [
  [/\b(hdpe|pead|pe\s?100|pe\s?80|polietileno)\b/, '90', 'polietileno'],
  [/\b(pvc|sap|sal)\b/, null, 'PVC'],                    // el destino lo decide el uso
  [/\b(cobre)\b/, '68', 'cobre'],
  [/\b(hierro fundido|ductil|fundicion)\b/, '71', 'hierro fundido o dúctil'],
  [/\b(fibra de vidrio|frp|prfv)\b/, '89', 'fibra de vidrio'],
  [/\b(concreto|hormigon)\b/, '31', 'concreto'],
  // Sin material explícito pero con forma de perfil estructural: es tubo de
  // acero. «TUBO E. CUAD. 3/4IN» (electrosoldado cuadrado) y «tubo rectangular
  // 4 x 8 x 3mm» son las dos gemelas que originaron la tanda.
  [/\b(cuad|cuadrado|rectangular|estructural|lac|laf|negro|galvanizado|electrosoldado|astm a500|sch\s?40|schedule)\b/, '65', 'acero negro o galvanizado'],
];
// PVC de red (agua potable, desagüe, alcantarillado) → [66]; PVC de redes
// interiores y eléctrico → [72]. La norma los separa y la contadora también.
const PVC_DE_RED = /\b(agua potable|alcantarillado|desague|desagues|matriz|uf|ntp iso 4435|s\s?25|s\s?20|c\s?10|c\s?7 5)\b/;

// ── 4. ADMINISTRATIVOS ↔ MATERIAL DE OBRA ─────────────────────────
// «Si la evidencia oficial está vacía, el objeto NO está en el diccionario de
// construcción» ya lo dice el prompt. Acá está la otra mitad: reconocer los
// cuatro vocabularios que aparecen de verdad en las facturas del grupo.
// Marcas de librería, no de obra. «Atlas» quedó AFUERA a propósito: es marca
// de librería y también de otras cosas, y un falso positivo acá manda un
// material de obra a «administrativos», que es peor que no reconocer la marca.
const MARCA_LIBRERIA = /\b(faber castell|faber|artesco|standford|stanford|vinifan|layconsa|pioner)\b/;
const UTIL_OFICINA = /\b(perforador|perforadora de papel|engrapador|engrampador|grapas|clips|resaltador|plumon|lapicero|lapiceros|lapiz|corrector|tampon|archivador|archivadores|folder|folders|micas|papel bond|cuaderno|cuadernos|toner|cartucho de tinta|sobre manila|post it)\b/;
const MOBILIARIO = /^(?:\w+\s+)?(mesa|mesas|silla|sillas|escritorio|escritorios|estante|estantes|repisa|repisas|mueble|muebles|mobiliario|armario|closet|anaquel|casillero|locker|sofa|sillon|vitrina|pizarra)\b/;
const MOBILIARIO_NO = /\b(vibrador\w*|vibratoria|mezcladora|compactador\w*|de trabajo metalica para taller)\b/;
const CONSUMO_PERSONAL = /\b(cusquena|pilsen|cerveza|cervezas|gaseosa|gaseosas|inca kola|coca cola|agua mineral|almuerzo|almuerzos|refrigerio|refrigerios|menu|snack|galleta|galletas)\b/;
const GASTO_FINANCIERO = /\b(anticipo de cliente|interes|intereses|inmobiliaria|portes|itf|mantenimiento de cuenta|comision bancaria|prestamo|leasing|amortizacion|sobregiro)\b/;

// ── 5. SERVICIOS ↔ MATERIAL ───────────────────────────────────────
// «CT CANCELACION RECIBO 172949319. SEGURO DE CONSTRUCCION» salía [37]
// Herramienta manual. Una póliza no es un material, y el árbol de servicios ya
// existe para decir cuál.
const ES_POLIZA = /\b(seguros?|polizas?)\s+(de|contra|vehicular|complementari\w+|multiriesgo|todo riesgo)\b|\b(sctr|soat)\b/;

// ── 6. MAQUINARIA LIVIANA ↔ HERRAMIENTA MANUAL ────────────────────
// El motor decide: es la única línea divisoria que la norma da entre [37] y
// [48], y es la que los modelos se saltan («MARTILLO DEMOLEDOR» → herramienta
// manual, «CARRETILLA» → maquinaria).
const CON_MOTOR = /\b(electric\w*|inalambric\w*|bateria|motor|motorizad\w*|neumatic\w*|hidraulic\w*|gasolinero|rotomartillo|demoledor|combustion)\b/;
const SIN_MOTOR = /\b(carretilla|buggy|pala|palana|pico|lampa|barreta|combo|comba|cincel|llave|alicate|destornillador|serrucho|escuadra|wincha|plomada|badilejo|frotacho|bugui|tijera|arco de sierra)\b/;

// ── 7. SEÑALIZACIÓN DE OBRA ↔ EL MATERIAL DEL CARTEL ──────────────
// Gabriel, 22-set-2026, mirando el simulador: «MALLA CERCADORA NARANJA, SEÑAL
// INFORMATIVA DE MADERA (INCLUYE POSTE DE MADERA), CACHACOS DE SEGURIDAD DE
// C° 1.20m … esto va como artículos de seguridad».
//
// Es el mismo par que el [83] de la regla 2 pero por el otro lado: aquélla
// mira la PRENDA que se pone una persona; ésta, lo que se planta en el piso
// para que nadie se caiga. Y falla igual de feo porque la descripción nombra
// el material: la señal DE MADERA caía en [43] Madera para encofrado, la
// malla cercadora NARANJA (que es plástico) en [46] Malla de acero, y la
// cinta de señalización en [37] Herramienta manual. Las tres se le compran al
// mismo proveedor de seguridad y ninguna es lo que decía.
const SENIALIZACION = /\b(senalizacion|senaletica|senalizar|tranquera|tranqueras|baliza|balizas|cachaco|cachacos|delineador|delineadores|malla cercadora|malla naranja|malla de seguridad|cinta de seguridad|barrera de seguridad)\b/;
// «SEÑAL», «CARTEL» y «LETRERO» son señalización salvo que sean otra cosa.
const CARTEL = /\b(senal|senales|cartel|carteles|letrero|letreros|gigantografia)\b/;
// Dos trampas medidas en el presupuesto de Miraflores: «CONO DE REBOSE 4"-3"»
// es una pieza de tanque, no un cono vial; y «PALETA» puede ser de albañil.
// Por eso esas dos palabras solo cuentan con el contexto de seguridad al lado.
const ES_CONO_VIAL = /\b(cono|conos)\b(?!\s+de\s+rebose)/;
const CONTEXTO_SEGURIDAD = /\b(seguridad|senalizacion|vial|naranja|pare y siga|reflectiv\w*|obra)\b/;
const PALETA_SEGURIDAD = /\b(paleta|paletas)\b/;
// Un cartel IMPRESO se le compra a la imprenta, no al proveedor de seguridad:
// «GIGANTOGRAFÍA DE 3.60X2.40» es el cartel de obra y sale de una gráfica.
//
// OJO CON «MANUAL»: estuvo acá media hora y se llevó puesto a «HERRAMIENTAS
// MANUALES», que pasó de [37] a la imprenta. El adjetivo «manual» es de la
// herramienta; el sustantivo «manual» es el librito. No se pueden distinguir
// por regex, y el clasificador base ya manda «MANUALES Y SU RESPECTIVA
// ENTREGA» a [S12] por su cuenta — así que acá no hace falta.
const IMPRESO = /\b(gigantografia|gigantografias|banner|banners|impresion|impresiones|afiche|afiches|folleto|folletos|volante|volantes)\b/;

// ── 8. LO QUE NO ES UN INSUMO NI UN SERVICIO CONCRETO ──────────────
// «SUB-CONTRATOS» salía [78] Válvula de hierro y acero —el parecido de tokens
// pegándole a cualquier cosa— y «GASTOS OPERATIVOS» quedaba sin clasificar.
// Ninguno de los dos es un material que alguien compre en una ferretería.
const ES_SUBCONTRATO = /\b(sub\s?contrato|sub\s?contratos|subcontrato|subcontratos|subcontracion|subcontratacion)\b/;
const GASTO_OPERATIVO = /\b(gastos? operativos?|gastos? generales|gastos? administrativos?|gastos? de gestion)\b/;

// Y la trampa por el otro lado: el Anexo 2 tiene «Cono de seguridad» bajo
// [83], y «cono» es un token tan corto que se lleva puesto al CONO DE REBOSE
// —la pieza que va en el tanque de agua—. Medido en Miraflores: tres filas
// que aterrizaban entre los cachacos y los conos viales.
const PIEZA_DE_TUBERIA = /\b(cono de rebose|cono de tanque|cono de reboce)\b/;

/**
 * LAS SEIS REGLAS. Cada una:
 *   · `cuando(n)`  — si esta descripción entra en el par difícil.
 *   · `gana(n)`    — el código correcto, o null si con este texto no alcanza
 *                    para decidir (entonces la regla no hace nada).
 *   · `pisa`       — 'material' (cualquier código que no sea de servicio) o
 *                    una lista de códigos concretos.
 *   · `motivo(cod)`— lo que va a leer la persona que decide, en la fila.
 *   · `prompt`     — la misma regla en una línea, para cuando se le pregunta
 *                    a la IA. Corta a propósito: el prompt paga por token.
 */
export const DESEMPATES = [
  {
    id: 'cable-vs-acero',
    par: '[07] cable eléctrico ↔ [02]/[03]/[87] acero y planchas',
    cuando: (n) => !CABLE_NO_ELECTRICO.test(n)
      && (MARCA_CABLE.test(n) || (/\b(cable|conductor|cordon)\b/.test(n) && NORMA_CABLE.test(n))),
    gana: (n) => (/\b(nyy|n2xy|n2xoh|n2xsy|npt)\b/.test(n) ? '19'
      : /\bdesnudo\b/.test(n) ? '06'
        : /\baluminio\b/.test(n) ? '82'
          : '07'),
    pisa: 'material',
    motivo: () => 'Es conductor eléctrico (marca o norma de cable), no acero ni plancha',
    prompt: 'INDECO, CEPER y NEXANS son marcas de CABLE ELÉCTRICO: un «rollo» de esas marcas es cable [07] (o [19] si dice NYY/N2XY), nunca acero ni plancha, aunque la descripción no diga la palabra cable.',
  },
  {
    id: 'epp-vs-material',
    par: '[83] implemento de seguridad ↔ el material del que está hecho',
    cuando: (n) => !PRENDA_EN_SERVICIO.test(n) && (PRENDA_EPP.test(n) || EPP_COMPUESTO.test(n)),
    gana: () => '83',
    pisa: 'material',
    motivo: () => 'Es ropa o implemento de protección: manda la prenda, no el material que la nombra',
    prompt: 'Guantes, cascos, botas, zapatos, chalecos, arneses, lentes, mamelucos, uniformes y líneas de vida son [83] Implemento de seguridad AUNQUE la descripción diga acero, malla metálica, cuero, drill u «obrero»: el material es un adjetivo, la prenda es el objeto.',
  },
  {
    id: 'tuberia-por-material',
    par: 'tubería ([66]/[72]/[90]/[65]…) ↔ [10] aparato sanitario',
    cuando: (n) => ES_TUBO.test(n) && !TUBO_SANITARIO.test(n),
    gana: (n) => {
      for (const [re, cod] of MATERIAL_TUBO) {
        if (!re.test(n)) continue;
        if (cod) return cod;
        return PVC_DE_RED.test(n) ? '66' : '72';   // la fila del PVC
      }
      return null;
    },
    pisa: 'material',
    motivo: (cod, n) => {
      const hit = MATERIAL_TUBO.find(([re]) => re.test(n));
      const de = hit ? hit[2] : 'su material';
      return `Tubería de ${de === 'PVC' ? (cod === '66' ? 'PVC de red' : 'PVC de redes interiores') : de}: el material del tubo lo dice la descripción`;
    },
    prompt: 'En una tubería decide el MATERIAL, no la palabra «tubo»: HDPE/PE100/polietileno → [90]; PVC de agua potable o alcantarillado → [66]; PVC de redes interiores → [72]; cuadrado, rectangular, negro, galvanizado o electrosoldado → [65]. [10] Aparato sanitario es solo para tubos de abasto y grifería.',
  },
  {
    id: 'administrativo-vs-material',
    par: 'administrativos ↔ el material o la herramienta que parece',
    cuando: (n) => MARCA_LIBRERIA.test(n) || UTIL_OFICINA.test(n)
      || (MOBILIARIO.test(n) && !MOBILIARIO_NO.test(n))
      || CONSUMO_PERSONAL.test(n) || GASTO_FINANCIERO.test(n),
    gana: () => 'administrativos',
    pisa: 'material',
    motivo: (_cod, n) => (GASTO_FINANCIERO.test(n) ? 'Es un gasto financiero o administrativo, no un insumo de obra'
      : CONSUMO_PERSONAL.test(n) ? 'Es consumo de personas (comida o bebida), no un insumo de obra'
        : MOBILIARIO.test(n) ? 'Es mobiliario, no el material del que está hecho'
          : 'Es útil de escritorio o de oficina, no una herramienta de obra'),
    prompt: 'Útiles de escritorio (y marcas de librería como Faber Castell o Artesco), mobiliario, comida y bebida, e intereses o cargos de banco van a «administrativos», NO al material ni a la herramienta que parecen: un PERFORADOR Faber Castell perfora papel, una MESA DE MELAMINE es un mueble.',
  },
  {
    id: 'poliza-vs-material',
    par: 'servicios ↔ el material que nombra la póliza',
    cuando: (n) => ES_POLIZA.test(n),
    gana: () => 'servicios',
    pisa: 'material',
    motivo: () => 'Es una póliza o un seguro: un servicio, no un material',
    prompt: 'Un seguro, una póliza, el SCTR o el SOAT son SERVICIOS, aunque la descripción nombre la obra o un material.',
  },
  {
    id: 'maquinaria-vs-herramienta',
    par: '[48] maquinaria liviana ↔ [37] herramienta manual',
    cuando: (n) => CON_MOTOR.test(n) || SIN_MOTOR.test(n),
    gana: (n) => (CON_MOTOR.test(n) ? '48' : '37'),
    pisa: ['37', '48'],
    motivo: (cod) => (cod === '48'
      ? 'Tiene motor (eléctrico, neumático o hidráulico): maquinaria liviana, no herramienta manual'
      : 'Se opera a mano, sin motor: herramienta manual, no maquinaria'),
    prompt: 'Entre [37] Herramienta manual y [48] Maquinaria liviana decide el MOTOR: eléctrico, a batería, neumático o hidráulico → [48]; lo que se opera a pulso (carretilla, pala, combo, llave) → [37].',
  },
  {
    id: 'senalizacion-vs-material',
    par: '[83] señalización de obra ↔ el material del que está hecho el cartel',
    cuando: (n) => !IMPRESO.test(n) && (
      SENIALIZACION.test(n)
      || CARTEL.test(n)
      || (ES_CONO_VIAL.test(n) && CONTEXTO_SEGURIDAD.test(n))
      || (PALETA_SEGURIDAD.test(n) && CONTEXTO_SEGURIDAD.test(n))
    ),
    gana: () => '83',
    pisa: 'material',
    motivo: () => 'Es señalización de obra: manda para qué sirve, no la madera, el plástico o el concreto con que está hecha',
    prompt: 'Señales, carteles, conos y paletas viales, mallas cercadoras, tranqueras, balizas y cachacos son [83] Implemento y accesorio de seguridad AUNQUE la descripción diga madera, concreto o malla: el material es un adjetivo, la señalización es el objeto.',
  },
  {
    id: 'pieza-vs-senalizacion',
    par: 'pieza de tubería ↔ [83], por el parecido con «Cono de seguridad»',
    cuando: (n) => PIEZA_DE_TUBERIA.test(n),
    gana: () => '72',
    pisa: ['83'],
    motivo: () => 'Es una pieza del tanque: el «cono» del Diccionario Oficial es el cono de seguridad, no el de rebose',
    prompt: 'Un CONO DE REBOSE es una pieza de tubería [72], no un cono de señalización [83].',
  },
  {
    id: 'impreso-vs-material',
    par: '[S12] impresos y publicaciones ↔ el material del cartel',
    cuando: (n) => IMPRESO.test(n),
    gana: () => 'S12',
    pisa: 'material',
    motivo: () => 'Es material impreso: se le compra a una gráfica, no al proveedor de seguridad ni a la ferretería',
    prompt: 'Gigantografías, banners, afiches, folletos y manuales son [S12] Gestión documental y publicaciones: salen de una imprenta.',
  },
  {
    id: 'subcontrato-y-gasto-vs-material',
    par: 'subcontrato / gasto operativo ↔ el material que el parecido le encontró',
    cuando: (n) => ES_SUBCONTRATO.test(n) || GASTO_OPERATIVO.test(n),
    gana: (n) => (ES_SUBCONTRATO.test(n) ? 'S09' : 'administrativos'),
    pisa: 'material',
    motivo: (cod) => (cod === 'S09'
      ? 'Es obra ejecutada por un tercero, no un insumo que se compra'
      : 'Es un gasto operativo de la obra, no un insumo que se compra'),
    prompt: '«SUB-CONTRATOS» es [S09] Subcontrato de obra y «GASTOS OPERATIVOS» va a «administrativos»: ninguno de los dos es un material, por más que el parecido de palabras le encuentre uno.',
  },
];

const POR_ID = new Map(DESEMPATES.map(r => [r.id, r]));

/** ¿Esta regla puede pisar el código que ya hay? */
function puedePisar(regla, codigoActual, codigoGanador) {
  const actual = String(codigoActual || '');
  if (!actual || actual === codigoGanador) return false;
  if (Array.isArray(regla.pisa)) return regla.pisa.includes(actual);
  // 'material': cualquier cosa que no sea un servicio ya elegido. Un S07 que
  // el árbol de servicios encontró se respeta — salvo que la regla lleve ahí.
  if (esServicio(actual) && !esServicio(codigoGanador)) return false;
  return true;
}

/**
 * El desempate que corresponde a esta descripción, si hay alguno.
 *
 * @param texto          la descripción de la factura, cruda.
 * @param codigoActual   lo que viene diciendo el motor (o la IA).
 * @param capa           de dónde salió ese código: 'manual' y 'oficial-exacto'
 *                       son intocables (ver el encabezado). Cualquier otra
 *                       cosa —parecido, aprendido, sin_clasificar— se puede
 *                       corregir.
 * @returns {null | {codigo, motivo, regla, par}}
 */
export function desempateDe(texto, { codigoActual = null, capa = null } = {}) {
  if (capa === 'manual' || capa === 'oficial-exacto') return null;
  const n = normDesempate(texto);
  if (!n) return null;
  for (const regla of DESEMPATES) {
    if (!regla.cuando(n)) continue;
    const codigo = regla.gana(n);
    if (!codigo) continue;
    if (!puedePisar(regla, codigoActual, codigo)) continue;
    return { codigo, motivo: regla.motivo(codigo, n), regla: regla.id, par: regla.par };
  }
  return null;
}

/**
 * Las reglas que dispara esta descripción, en una línea cada una, para
 * inyectarlas en el prompt. Se filtran contra los candidatos que de verdad se
 * le van a ofrecer al modelo: una regla que empuja hacia un código que no está
 * en la lista es ruido pagado.
 *
 * @param codigosValidos  Set|Array con los códigos candidatos. Si no viene, no
 *                        se filtra (el piloto llama así para medir el texto).
 */
export function reglasDesempateParaIA(texto, codigosValidos = null, { max = 3 } = {}) {
  const n = normDesempate(texto);
  if (!n) return [];
  const validos = codigosValidos
    ? new Set([...codigosValidos].map(String))
    : null;
  const salida = [];
  for (const regla of DESEMPATES) {
    if (salida.length >= max) break;
    if (!regla.cuando(n)) continue;
    const codigo = regla.gana(n);
    if (validos && codigo && !validos.has(String(codigo))) continue;
    salida.push({ id: regla.id, texto: regla.prompt });
  }
  return salida;
}

/** Para los tests y para el panel: la regla por su id. */
export const desempatePorId = (id) => POR_ID.get(String(id)) || null;
