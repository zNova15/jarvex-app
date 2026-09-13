// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL ÁRBOL DE CLASIFICACIÓN DE SERVICIOS.
//
// POR QUÉ EXISTE, SI YA ESTÁ EL IUPC
// El IUPC del INEI es un índice de precios de MATERIALES de construcción.
// Tiene cuatro códigos de servicio sueltos (32/33/92 fletes, 93 auxiliares)
// porque son insumos de una valorización, no porque pretenda clasificar lo que
// una empresa contrata. Metiendo todo lo demás en un solo cajón «Servicios en
// general» —que es como estaba— se pierde justo lo que la contadora necesita
// distinguir: un alquiler de retroexcavadora, un examen médico ocupacional y
// un monitoreo de calidad de agua no son la misma línea de gasto.
//
// DE DÓNDE SALEN ESTAS 13
// No están inventadas: salen de los 35 servicios que YA tiene el catálogo del
// grupo (medido el 13-set-2026), agrupados por lo que realmente se repite —
// alquileres de local y de vehículo, capacitaciones y simulacros de SSOMA,
// monitoreos ambientales, exámenes médicos, subcontratos de instalación. Cada
// código lleva abajo, en el diccionario, los términos con los que aparecen
// escritos en las facturas.
//
// SE PUEDEN AGREGAR MÁS. Esto es la base que viaja en el bundle (cuesta cero
// sincronización y funciona en un device recién instalado); las clasificaciones
// que Gabriel cree desde la pantalla viven en la tabla `clasificaciones` y se
// mezclan con éstas al listar.
// ═══════════════════════════════════════════════════════════════════

/**
 * El árbol de servicios. `gasto` es el vocabulario de `clasificar-items.js`
 * (CATEGORIAS_ITEM), o sea cómo lo agrupa la contadora.
 *
 * Los diez primeros son servicios DE LA OBRA: se contratan para ejecutar y son
 * costo del proyecto. Los tres últimos son de estructura y por eso van a
 * gastos generales — la distinción la pidió el propio plan de cuentas, no el
 * gusto de nadie.
 */
export const SERVICIOS_CODIGOS = [
  { codigo: 'S01', nombre: 'Alquiler de local y vehículo', gasto: 'servicios' },
  { codigo: 'S02', nombre: 'Alquiler de maquinaria y equipo', gasto: 'servicios', iupcRelacionado: '49' },
  { codigo: 'S03', nombre: 'Flete y transporte', gasto: 'servicios', iupcRelacionado: '32' },
  { codigo: 'S04', nombre: 'Capacitación y simulacros', gasto: 'servicios' },
  { codigo: 'S05', nombre: 'Monitoreo ambiental', gasto: 'servicios' },
  { codigo: 'S06', nombre: 'Salud ocupacional', gasto: 'servicios' },
  { codigo: 'S07', nombre: 'Estudios, consultoría y supervisión', gasto: 'servicios' },
  { codigo: 'S08', nombre: 'Mantenimiento y reparación', gasto: 'servicios' },
  { codigo: 'S09', nombre: 'Subcontrato de obra', gasto: 'servicios' },
  { codigo: 'S10', nombre: 'Personal contratado por servicio', gasto: 'servicios' },
  { codigo: 'S11', nombre: 'Alimentación y hospedaje', gasto: 'gastos_generales' },
  { codigo: 'S12', nombre: 'Gestión documental y publicaciones', gasto: 'gastos_generales' },
  { codigo: 'S13', nombre: 'Servicios básicos', gasto: 'gastos_generales' },
];

export const SERVICIO_POR_CODIGO = new Map(SERVICIOS_CODIGOS.map(s => [s.codigo, s]));

/** ¿Es un código del árbol de servicios? */
export const esCodigoServicio = (c) => SERVICIO_POR_CODIGO.has(String(c || '').trim());

/**
 * El diccionario base de servicios: los términos con los que cada cosa aparece
 * escrita en las facturas del grupo. Es el equivalente del Anexo 2 del INEI
 * para el árbol de servicios, y se usa igual — con el mismo motor de tokens.
 *
 * Varios salen literalmente del catálogo actual («SC LICENCIADO ARQUEOLOGO»,
 * «MONITOREO DE CALIDAD DE SUELO», «CAPACITACION EN EDUSA»); el resto es el
 * vocabulario que aparece alrededor en las compras de la obra.
 */
export const DICCIONARIO_SERVICIOS = [
  // S01 — Alquiler de local y vehículo
  { nombre: 'Alquiler de almacén', cod: 'S01' },
  { nombre: 'Alquiler de oficina', cod: 'S01' },
  { nombre: 'Alquiler de local', cod: 'S01' },
  { nombre: 'Alquiler de campamento', cod: 'S01' },
  { nombre: 'Alquiler de terreno', cod: 'S01' },
  { nombre: 'Alquiler de camioneta', cod: 'S01' },
  { nombre: 'Alquiler de vehículo', cod: 'S01' },
  { nombre: 'Arrendamiento de local', cod: 'S01' },

  // S02 — Alquiler de maquinaria y equipo
  { nombre: 'Alquiler de retroexcavadora', cod: 'S02' },
  { nombre: 'Alquiler de excavadora', cod: 'S02' },
  { nombre: 'Alquiler de volquete', cod: 'S02' },
  { nombre: 'Alquiler de cargador frontal', cod: 'S02' },
  { nombre: 'Alquiler de motoniveladora', cod: 'S02' },
  { nombre: 'Alquiler de rodillo compactador', cod: 'S02' },
  { nombre: 'Alquiler de mezcladora de concreto', cod: 'S02' },
  { nombre: 'Alquiler de vibrador de concreto', cod: 'S02' },
  { nombre: 'Alquiler de compresora', cod: 'S02' },
  { nombre: 'Alquiler de grupo electrógeno', cod: 'S02' },
  { nombre: 'Alquiler de motobomba', cod: 'S02' },
  { nombre: 'Alquiler de andamio', cod: 'S02' },
  { nombre: 'Alquiler de encofrado', cod: 'S02' },
  { nombre: 'Alquiler de maquinaria', cod: 'S02' },
  { nombre: 'Alquiler de equipo', cod: 'S02' },
  { nombre: 'Alquiler de grúa', cod: 'S02' },

  // S03 — Flete y transporte
  { nombre: 'Flete terrestre', cod: 'S03' },
  { nombre: 'Flete de materiales', cod: 'S03' },
  { nombre: 'Transporte de materiales', cod: 'S03' },
  { nombre: 'Transporte de residuos de obra', cod: 'S03' },
  { nombre: 'Transporte de personal', cod: 'S03' },
  { nombre: 'Eliminación de material excedente', cod: 'S03' },
  { nombre: 'Acarreo de material', cod: 'S03' },
  { nombre: 'Traslado de equipo', cod: 'S03' },

  // S04 — Capacitación y simulacros
  { nombre: 'Capacitación de primeros auxilios', cod: 'S04' },
  { nombre: 'Capacitación en el uso y manejo de extintores', cod: 'S04' },
  { nombre: 'Capacitación en AOM', cod: 'S04' },
  { nombre: 'Capacitación en EDUSA', cod: 'S04' },
  { nombre: 'Capacitación', cod: 'S04' },
  { nombre: 'Charla de seguridad', cod: 'S04' },
  { nombre: 'Inducción de seguridad', cod: 'S04' },
  { nombre: 'Simulacro contra incendios', cod: 'S04' },
  { nombre: 'Simulacro contra sismos', cod: 'S04' },
  { nombre: 'Simulacro de respuesta ante emergencias', cod: 'S04' },
  { nombre: 'Evacuación y rescate para brigadistas', cod: 'S04' },

  // S05 — Monitoreo ambiental
  { nombre: 'Monitoreo de calidad de agua', cod: 'S05' },
  { nombre: 'Monitoreo de calidad de aire', cod: 'S05' },
  { nombre: 'Monitoreo de calidad de suelo', cod: 'S05' },
  { nombre: 'Monitoreo de niveles de ruido', cod: 'S05' },
  { nombre: 'Monitoreo ambiental', cod: 'S05' },
  { nombre: 'Plan de monitoreo', cod: 'S05' },
  { nombre: 'Ensayo de laboratorio', cod: 'S05' },
  { nombre: 'Muestreo de agua', cod: 'S05' },

  // S06 — Salud ocupacional
  { nombre: 'Examen médico ocupacional', cod: 'S06' },
  { nombre: 'Examen médico preocupacional', cod: 'S06' },
  { nombre: 'Exámenes médicos', cod: 'S06' },
  { nombre: 'Aptitud médica', cod: 'S06' },
  { nombre: 'Salud ocupacional', cod: 'S06' },

  // S07 — Estudios, consultoría y supervisión
  { nombre: 'Consultoría', cod: 'S07' },
  { nombre: 'Asesoría técnica', cod: 'S07' },
  { nombre: 'Supervisión de obra', cod: 'S07' },
  { nombre: 'Honorarios profesionales', cod: 'S07' },
  { nombre: 'Estudio de suelos', cod: 'S07' },
  { nombre: 'Estudio de impacto ambiental', cod: 'S07' },
  { nombre: 'Expediente técnico', cod: 'S07' },
  { nombre: 'Licenciado arqueólogo', cod: 'S07' },
  { nombre: 'Monitoreo arqueológico', cod: 'S07' },
  { nombre: 'Levantamiento topográfico', cod: 'S07' },
  { nombre: 'Topografía', cod: 'S07' },
  { nombre: 'Plan de seguridad y salud en el trabajo', cod: 'S07' },

  // S08 — Mantenimiento y reparación
  { nombre: 'Mantenimiento de camionetas', cod: 'S08' },
  { nombre: 'Mantenimiento preventivo', cod: 'S08' },
  { nombre: 'Mantenimiento de equipo', cod: 'S08' },
  { nombre: 'Reparación de equipo', cod: 'S08' },
  { nombre: 'Servicio técnico', cod: 'S08' },
  { nombre: 'Calibración de equipo', cod: 'S08' },

  // S09 — Subcontrato de obra
  { nombre: 'Subcontrato de obra', cod: 'S09' },
  { nombre: 'Instalación de estructura metálica', cod: 'S09' },
  { nombre: 'Suministro e instalación', cod: 'S09' },
  { nombre: 'Montaje de estructura', cod: 'S09' },
  { nombre: 'Habilitación de acero', cod: 'S09' },
  { nombre: 'Encofrado y desencofrado', cod: 'S09' },
  { nombre: 'Mano de obra', cod: 'S09' },
  { nombre: 'Servicio de instalación', cod: 'S09' },

  // S10 — Personal contratado por servicio
  { nombre: 'Chofer', cod: 'S10' },
  { nombre: 'Operador de maquinaria', cod: 'S10' },
  { nombre: 'Vigilancia', cod: 'S10' },
  { nombre: 'Guardianía', cod: 'S10' },
  { nombre: 'Servicio de limpieza', cod: 'S10' },
  { nombre: 'Locación de servicios', cod: 'S10' },

  // S11 — Alimentación y hospedaje
  { nombre: 'Alimentación para personal', cod: 'S11' },
  { nombre: 'Almuerzo', cod: 'S11' },
  { nombre: 'Refrigerio', cod: 'S11' },
  { nombre: 'Catering', cod: 'S11' },
  { nombre: 'Hospedaje', cod: 'S11' },
  { nombre: 'Alojamiento', cod: 'S11' },
  { nombre: 'Viáticos', cod: 'S11' },
  { nombre: 'Pasajes', cod: 'S11' },

  // S12 — Gestión documental y publicaciones
  { nombre: 'Publicaciones', cod: 'S12' },
  { nombre: 'Aviso publicitario', cod: 'S12' },
  { nombre: 'Manuales y su entrega', cod: 'S12' },
  { nombre: 'Impresión de planos', cod: 'S12' },
  { nombre: 'Ploteo de planos', cod: 'S12' },
  { nombre: 'Servicio notarial', cod: 'S12' },
  { nombre: 'Legalización de documentos', cod: 'S12' },
  { nombre: 'Courier', cod: 'S12' },

  // S13 — Servicios básicos
  { nombre: 'Energía eléctrica', cod: 'S13' },
  { nombre: 'Servicio de agua potable', cod: 'S13' },
  { nombre: 'Internet', cod: 'S13' },
  { nombre: 'Telefonía', cod: 'S13' },
  { nombre: 'Recibo de luz', cod: 'S13' },
];
