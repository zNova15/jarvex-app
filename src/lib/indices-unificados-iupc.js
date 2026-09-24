// ═══════════════════════════════════════════════════════════════════
// JARVEX — ÍNDICES UNIFICADOS DE PRECIOS DE LA CONSTRUCCIÓN (IUPC)
// Base oficial del Estado Peruano: R.J. Nº 016-2026-INEI (20-ene-2026).
// Anexo 1: Relación de Índices Unificados de Precios de la Construcción.
// Anexo 2: Diccionario Oficial de Elementos de la Construcción.
//
// Regla rectora del sistema:
// SOLO UNA CLASIFICACIÓN EN TODA LA APP (sin familias y subfamilias).
// Insumos y recursos que no pertenecen a construcción civil entran en
// categorías complementarias: 'servicios' (Servicios en general),
// 'administrativos' (Consumos administrativos) o categorías especiales.
// ═══════════════════════════════════════════════════════════════════

import {
  SERVICIOS_CODIGOS, SERVICIO_POR_CODIGO, esCodigoServicio, DICCIONARIO_SERVICIOS,
} from './clasificacion-servicios.js';
import { desempateDe } from './desempates-iupc.js';

export { SERVICIOS_CODIGOS, SERVICIO_POR_CODIGO, esCodigoServicio, DICCIONARIO_SERVICIOS };
export { DESEMPATES, desempateDe, reglasDesempateParaIA } from './desempates-iupc.js';

export const IUPC_CODIGOS = [
  { codigo: '01', nombre: 'Aceite y lubricante', tipo: 'material' },
  { codigo: '02', nombre: 'Acero de construcción liso', tipo: 'material' },
  { codigo: '03', nombre: 'Acero de construcción corrugado', tipo: 'material' },
  { codigo: '04', nombre: 'Agregado fino', tipo: 'material' },
  { codigo: '05', nombre: 'Agregado grueso', tipo: 'material' },
  { codigo: '06', nombre: 'Alambre y cable de cobre desnudo', tipo: 'material' },
  { codigo: '07', nombre: 'Alambre y cable tipo TW, THW, LSOH', tipo: 'material' },
  { codigo: '08', nombre: 'Alambre y cable tipo WP, CPI', tipo: 'material' },
  { codigo: '09', nombre: 'Alcantarilla metálica y guardavías', tipo: 'material' },
  { codigo: '10', nombre: 'Aparato sanitario con grifería', tipo: 'material' },
  { codigo: '11', nombre: 'Artefacto de alumbrado exterior', tipo: 'material' },
  { codigo: '12', nombre: 'Artefacto de alumbrado interior', tipo: 'material' },
  { codigo: '13', nombre: 'Asfalto', tipo: 'material' },
  { codigo: '14', nombre: 'Baldosa acústica', tipo: 'material' },
  { codigo: '16', nombre: 'Baldosa vinílica y PVC', tipo: 'material' },
  { codigo: '17', nombre: 'Bloque y ladrillo', tipo: 'material' },
  { codigo: '18', nombre: 'Cable telefónico y de red', tipo: 'material' },
  { codigo: '19', nombre: 'Cable NYY, N2XY, NPT, N2XOH, N2XSY', tipo: 'material' },
  { codigo: '20', nombre: 'Cemento asfáltico', tipo: 'material' },
  { codigo: '21', nombre: 'Cemento Portland e hidráulico', tipo: 'material', reagrupa: ['22', '23'] },
  { codigo: '24', nombre: 'Cerámica y porcelanato', tipo: 'material' },
  { codigo: '26', nombre: 'Cerrajería', tipo: 'material' },
  { codigo: '27', nombre: 'Detonante', tipo: 'material' },
  { codigo: '28', nombre: 'Dinamita', tipo: 'material' },
  { codigo: '30', nombre: 'Dólar más inflación mercado USA', tipo: 'financiero' },
  { codigo: '31', nombre: 'Prefabricado de concreto', tipo: 'material', reagrupa: ['69', '70'] },
  { codigo: '32', nombre: 'Flete terrestre', tipo: 'servicio' },
  { codigo: '33', nombre: 'Flete aéreo', tipo: 'servicio' },
  { codigo: '34', nombre: 'Gasohol y gasolina', tipo: 'material' },
  { codigo: '37', nombre: 'Herramienta manual', tipo: 'herramienta' },
  { codigo: '38', nombre: 'Hormigón y afirmado', tipo: 'material' },
  { codigo: '39', nombre: 'Índice de Precios al Consumidor (INEI)', tipo: 'financiero' },
  { codigo: '40', nombre: 'Loseta y terrazo', tipo: 'material', reagrupa: ['64'] },
  { codigo: '41', nombre: 'Madera nacional en tiras para piso', tipo: 'material' },
  { codigo: '42', nombre: 'Madera importada para encofrado y carpintería', tipo: 'material' },
  { codigo: '43', nombre: 'Madera nacional para encofrado y carpintería', tipo: 'material' },
  { codigo: '44', nombre: 'Madera terciada nacional', tipo: 'material', reagrupa: ['45'] },
  { codigo: '46', nombre: 'Malla de acero', tipo: 'material' },
  { codigo: '47', nombre: 'Mano de obra (incluye leyes sociales)', tipo: 'mano_obra' },
  { codigo: '47-1', nombre: 'Mano de obra de alta especialización (incluye leyes sociales)', tipo: 'mano_obra' },
  { codigo: '48', nombre: 'Maquinaria y equipo de construcción liviano', tipo: 'maquinaria' },
  { codigo: '49', nombre: 'Maquinaria y equipo de construcción pesado', tipo: 'maquinaria' },
  { codigo: '50', nombre: 'Marco y tapa de fierro', tipo: 'material' },
  { codigo: '51', nombre: 'Perfil de acero al carbono', tipo: 'material' },
  { codigo: '52', nombre: 'Perfil de aluminio', tipo: 'material' },
  { codigo: '53', nombre: 'Petróleo diésel', tipo: 'material' },
  { codigo: '54', nombre: 'Pintura látex', tipo: 'material' },
  { codigo: '55', nombre: 'Pintura temple', tipo: 'material' },
  { codigo: '56', nombre: 'Plancha de acero LAC', tipo: 'material' },
  { codigo: '57', nombre: 'Plancha de acero LAF', tipo: 'material' },
  { codigo: '59', nombre: 'Plancha de fibrocemento y yeso', tipo: 'material' },
  { codigo: '60', nombre: 'Plancha de poliuretano, poliestireno y termoaislante', tipo: 'material' },
  { codigo: '61', nombre: 'Plancha galvanizada', tipo: 'material' },
  { codigo: '62', nombre: 'Poste de concreto', tipo: 'material' },
  { codigo: '65', nombre: 'Tubería de acero negro y/o galvanizado', tipo: 'material' },
  { codigo: '66', nombre: 'Tubería de PVC para la red de agua potable y alcantarillado', tipo: 'material' },
  { codigo: '68', nombre: 'Tubería de cobre', tipo: 'material' },
  { codigo: '71', nombre: 'Tubería de hierro fundido y dúctil', tipo: 'material' },
  { codigo: '72', nombre: 'Tubería de PVC para redes interiores', tipo: 'material', reagrupa: ['73'] },
  { codigo: '77', nombre: 'Válvula de bronce y latón', tipo: 'material' },
  { codigo: '78', nombre: 'Válvula de hierro y acero', tipo: 'material' },
  { codigo: '79', nombre: 'Vidrio', tipo: 'material' },
  { codigo: '80', nombre: 'Concreto premezclado', tipo: 'material' },
  { codigo: '81', nombre: 'Aditivo de concreto y similar', tipo: 'material' },
  { codigo: '82', nombre: 'Alambre y cable de aluminio', tipo: 'material' },
  { codigo: '83', nombre: 'Implemento y accesorio de seguridad', tipo: 'epp' },
  { codigo: '84', nombre: 'Madera terciada importada', tipo: 'material' },
  { codigo: '85', nombre: 'Perfil de acero galvanizado', tipo: 'material' },
  { codigo: '86', nombre: 'Pintura esmalte y epóxica', tipo: 'material' },
  { codigo: '87', nombre: 'Plancha con cubierta aluzinc', tipo: 'material' },
  { codigo: '88', nombre: 'Plancha y cobertura plástica', tipo: 'material' },
  { codigo: '89', nombre: 'Poste y tubería de fibra de vidrio', tipo: 'material' },
  { codigo: '90', nombre: 'Tubería de polietileno', tipo: 'material' },
  { codigo: '91', nombre: 'Geomembrana y geotextil', tipo: 'material' },
  { codigo: '92', nombre: 'Flete fluvial', tipo: 'servicio' },
  { codigo: '93', nombre: 'Bienes y servicios auxiliares', tipo: 'servicio' },
  { codigo: '94', nombre: 'Encofrado y andamio prefabricado', tipo: 'material' },
  { codigo: '95', nombre: 'Equipamiento permanente de obra', tipo: 'maquinaria' },
];

/** Mapa de códigos IUPC por código string */
export const IUPC_POR_CODIGO = new Map(IUPC_CODIGOS.map(c => [c.codigo, c]));

/** Reagrupaciones según Nota (a) de la R.J. 016-2026-INEI */
export const REAGRUPACIONES_IUPC = {
  '22': '21', // Cemento Portland tipo II -> Cemento Portland e hidráulico
  '23': '21', // Cemento Portland tipo V -> Cemento Portland e hidráulico
  '45': '44', // Madera terciada para encofrado -> Madera terciada nacional
  '64': '40', // Terrazo -> Loseta y terrazo
  '69': '31', // Tubería de concreto simple -> Prefabricado de concreto
  '70': '31', // Tubería de concreto reforzado -> Prefabricado de concreto
  '73': '72', // Ducto telefónico de PVC -> Tubería de PVC para redes interiores
};

/**
 * Categorías complementarias: lo que la norma NO contempla y la obra sí usa.
 * Es el escape previsto en la decisión del 13-set — «para insumos o servicios
 * que no se contemplen dentro de los índices se creará su propia categoría».
 *
 * `sin_clasificar` es deliberada: cuando el clasificador no reconoce nada,
 * decirlo es mejor que inventar un código IUPC plausible. Antes el residual
 * caía en el 93 («Bienes y servicios auxiliares»), que además es de tipo
 * SERVICIO — o sea que todo lo desconocido entraba al catálogo como servicio.
 * Una fila en `sin_clasificar` se ve, se filtra y se resuelve; una fila con un
 * 93 inventado se pierde entre las buenas.
 */
export const CATEGORIAS_COMPLEMENTARIAS = [
  { codigo: 'servicios', nombre: 'Servicios en general', tipo: 'servicio', complementaria: true },
  { codigo: 'administrativos', nombre: 'Consumos administrativos / Oficina', tipo: 'material', complementaria: true },
  { codigo: 'sin_clasificar', nombre: 'Sin clasificar — revisar a mano', tipo: 'material', complementaria: true },
];

/** Diccionario Oficial de Elementos de Construcción (Anexo 2 de la R.J. 016-2026-INEI) */
export const ELEMENTOS_DICCIONARIO_INEI = [
  // A
  { nombre: 'Abrazadera de acero', iupc: '02' },
  { nombre: 'Abrazadera de hierro', iupc: '71' },
  { nombre: 'Abrazadera de hierro dúctil', iupc: '71' },
  { nombre: 'Abrazadera de polipropileno', iupc: '72' },
  { nombre: 'Abrazadera de PVC', iupc: '72' },
  { nombre: 'Acabadora de concreto', iupc: '48' },
  { nombre: 'Accesorio CPVC', iupc: '72' },
  { nombre: 'Accesorio de tubería de acero', iupc: '65' },
  { nombre: 'Accesorio para tubería de cobre', iupc: '68' },
  { nombre: 'Accesorio para tubería de hierro dúctil', iupc: '71' },
  { nombre: 'Accesorio para tubería de hierro fundido', iupc: '71' },
  { nombre: 'Accesorio PVC sanitaria', iupc: '72' },
  { nombre: 'Accesorio PVC SAP eléctrica', iupc: '72' },
  { nombre: 'Accesorio PVC SEL eléctrica', iupc: '72' },
  { nombre: 'Accesorio PVC telefónico', iupc: '72' },
  { nombre: 'Accesorio PVC-O para redes de agua', iupc: '66' },
  { nombre: 'Accesorio PVC-U CR para agua fría', iupc: '72' },
  { nombre: 'Accesorio PVC-U para drenaje y alcantarillado', iupc: '66' },
  { nombre: 'Accesorio PVC-U para redes de agua', iupc: '66' },
  { nombre: 'Accesorio PVC-U SP para agua fría', iupc: '72' },
  { nombre: 'Accesorios de continuidad de pantalla', iupc: '11' },
  { nombre: 'Accesorios de tubería de PRFV', iupc: '89' },
  { nombre: 'Accesorios telefónicos de PVC', iupc: '72' },
  { nombre: 'Accesorios tubería HDPE', iupc: '90' },
  { nombre: 'Accesorios tubería PP-R', iupc: '90' },
  { nombre: 'Access point', iupc: '95' },
  { nombre: 'Aceite', iupc: '01' },
  { nombre: 'Aceite aislante', iupc: '01' },
  { nombre: 'Aceite dieléctrico', iupc: '01' },
  { nombre: 'Aceite linaza', iupc: '93' },
  { nombre: 'Aceite lubricante', iupc: '01' },
  { nombre: 'Aceite para transformadores', iupc: '01' },
  { nombre: 'Acelerógrafo', iupc: '95' },
  { nombre: 'Acero corrugado ASTM A496', iupc: '03' },
  { nombre: 'Acero corrugado ASTM A615', iupc: '03' },
  { nombre: 'Acero corrugado ASTM A706', iupc: '03' },
  { nombre: 'Acero corrugado dimensionado', iupc: '03' },
  { nombre: 'Acero de construcción corrugado', iupc: '03' },
  { nombre: 'Acero liso redondo', iupc: '02' },
  { nombre: 'Acero para pretensado', iupc: '30' },
  { nombre: 'Acero roscado acero galvanizado', iupc: '02' },
  { nombre: 'Acero roscado acero negro', iupc: '02' },
  { nombre: 'Acero roscado zincado', iupc: '02' },
  { nombre: 'Acetileno', iupc: '93' },
  { nombre: 'Ácido muriático', iupc: '93' },
  { nombre: 'Acople de acero', iupc: '65' },
  { nombre: 'Acrílico', iupc: '88' },
  { nombre: 'Adaptador brida campana de hierro dúctil', iupc: '71' },
  { nombre: 'Adaptador de acero', iupc: '65' },
  { nombre: 'Adaptador integral para barra helicoidal', iupc: '02' },
  { nombre: 'Adhesivo epóxico multipropósito', iupc: '81' },
  { nombre: 'Aditivo acelerante de fragua', iupc: '81' },
  { nombre: 'Aditivo curador', iupc: '81' },
  { nombre: 'Aditivo endurecedor de superficies', iupc: '81' },
  { nombre: 'Aditivo impermeabilizante', iupc: '81' },
  { nombre: 'Aditivo incorporador de aire', iupc: '81' },
  { nombre: 'Aditivo inhibidor de corrosión', iupc: '81' },
  { nombre: 'Aditivo para concreto', iupc: '81' },
  { nombre: 'Aditivo plastificante', iupc: '81' },
  { nombre: 'Aditivo retardante', iupc: '81' },
  { nombre: 'Aditivo superplastificante', iupc: '81' },
  { nombre: 'Adobe', iupc: '04' },
  { nombre: 'Adoquín de concreto', iupc: '17' },
  { nombre: 'Afirmado', iupc: '38' },
  { nombre: 'Afirmado para subbase', iupc: '38' },
  { nombre: 'Agitador hiperbólico', iupc: '95' },
  { nombre: 'Agitador sumergible', iupc: '95' },
  { nombre: 'Agregado fino', iupc: '04' },
  { nombre: 'Agregado grueso', iupc: '05' },
  { nombre: 'Agua', iupc: '93' },
  { nombre: 'Aire acondicionado', iupc: '95' },
  { nombre: 'Aislador carrete', iupc: '11' },
  { nombre: 'Aislador de porcelana vidriada', iupc: '11' },
  { nombre: 'Aislador eléctrico', iupc: '11' },
  { nombre: 'Aislador eléctrico de pin', iupc: '11' },
  { nombre: 'Aislador polimérico', iupc: '11' },
  { nombre: 'Aislador sísmico', iupc: '30' },
  { nombre: 'Aislador tipo pin', iupc: '11' },
  { nombre: 'Aislamiento elastómero', iupc: '60' },
  { nombre: 'Alambre', iupc: '02' },
  { nombre: 'Alambre de acero', iupc: '02' },
  { nombre: 'Alambre de aluminio', iupc: '82' },
  { nombre: 'Alambre de cobre', iupc: '06' },
  { nombre: 'Alambre de cobre desnudo', iupc: '06' },
  { nombre: 'Alambre de púas', iupc: '02' },
  { nombre: 'Alambre de púas zincado', iupc: '02' },
  { nombre: 'Alambre galvanizado', iupc: '02' },
  { nombre: 'Alambre negro', iupc: '02' },
  { nombre: 'Alambre negro recocido', iupc: '02' },
  { nombre: 'Alambre para devanado de cobre', iupc: '06' },
  { nombre: 'Alambre pretensor', iupc: '30' },
  { nombre: 'Alambre y cable CAAI de aluminio', iupc: '82' },
  { nombre: 'Alambre y cable CAI de aluminio', iupc: '82' },
  { nombre: 'Alambre y cable CPI', iupc: '08' },
  { nombre: 'Alambre y cable CPI (WP)', iupc: '08' },
  { nombre: 'Alambre y cable GPT', iupc: '07' },
  { nombre: 'Alambre y cable LSOH', iupc: '07' },
  { nombre: 'Alambre y cable LSOHX', iupc: '07' },
  { nombre: 'Alambre y cable NH', iupc: '07' },
  { nombre: 'Alambre y cable NHX', iupc: '07' },
  { nombre: 'Alambre y cable THW', iupc: '07' },
  { nombre: 'Alambre y cable tipo TW', iupc: '07' },
  { nombre: 'Alambre y cable tipo TW y THW', iupc: '07' },
  { nombre: 'Alambre y cable tipo WP', iupc: '08' },
  { nombre: 'Alambrón', iupc: '02' },
  { nombre: 'Alambrón para trefilado', iupc: '02' },
  { nombre: 'Alarma audible', iupc: '95' },
  { nombre: 'Alcantarilla metálica', iupc: '09' },
  { nombre: 'Alcantarilla TMC', iupc: '09' },
  { nombre: 'Alcantarilla TMC circular', iupc: '09' },
  { nombre: 'Alcantarilla TMC media caña', iupc: '09' },
  { nombre: 'Alcayata', iupc: '02' },
  { nombre: 'Alcohol', iupc: '93' },
  { nombre: 'Aldaba', iupc: '26' },
  { nombre: 'Alfombra', iupc: '93' },
  { nombre: 'Alicate', iupc: '37' },
  { nombre: 'Alisadora de concreto', iupc: '48' },
  { nombre: 'Alquiler de baños portátiles', iupc: '93' },
  { nombre: 'Alquiler de oficina', iupc: '93' },
  { nombre: 'Alquitrán', iupc: '13' },
  { nombre: 'Altavoz', iupc: '95' },
  { nombre: 'Amasadora de asfalto', iupc: '49' },
  { nombre: 'Amolador', iupc: '48' },
  { nombre: 'Amortiguador sísmico', iupc: '30' },
  { nombre: 'Amperímetro', iupc: '95' },
  { nombre: 'Anclaje de acero', iupc: '02' },
  { nombre: 'Anclaje de acero tipo J', iupc: '02' },
  { nombre: 'Anclaje de acero tipo L', iupc: '02' },
  { nombre: 'Anclaje para pretensado', iupc: '30' },
  { nombre: 'Andamio metálico', iupc: '94' },
  { nombre: 'Andamio prefabricado', iupc: '94' },
  { nombre: 'Anemómetro', iupc: '95' },
  { nombre: 'Anfo', iupc: '28' },
  { nombre: 'Anfo pesado', iupc: '28' },
  { nombre: 'Angulo de acero al carbono', iupc: '51' },
  { nombre: 'Ángulo de aluminio', iupc: '52' },
  { nombre: 'Angulo perimetral', iupc: '85' },
  { nombre: 'Anillo de cera para inodoro', iupc: '10' },
  { nombre: 'Anillo de jebe', iupc: '66' },
  { nombre: 'Anillo de jebe para tubería', iupc: '66' },
  { nombre: 'Anillo de jebe presión para agua potable', iupc: '66' },
  { nombre: 'Anillo de jebe presión para alcantarillado', iupc: '66' },
  { nombre: 'Antena de telemetría', iupc: '95' },
  { nombre: 'Anticorrosivo', iupc: '86' },
  { nombre: 'Aparato sanitario', iupc: '10' },
  { nombre: 'Apisonadora', iupc: '48' },
  { nombre: 'Apoyos neopreno', iupc: '30' },
  { nombre: 'Arandela', iupc: '02' },
  { nombre: 'Arandela de cuero', iupc: '93' },
  { nombre: 'Arandela de fierro', iupc: '02' },
  { nombre: 'Arandela de presión', iupc: '02' },
  { nombre: 'Árbol', iupc: '93' },
  { nombre: 'Arcilla', iupc: '04' },
  { nombre: 'Arco de sierra', iupc: '37' },
  { nombre: 'Arena fina', iupc: '04' },
  { nombre: 'Arena fina de rio', iupc: '04' },
  { nombre: 'Arena gruesa', iupc: '04' },
  { nombre: 'Arena gruesa de rio', iupc: '04' },
  { nombre: 'Armella', iupc: '02' },
  { nombre: 'Arnés de seguridad', iupc: '83' },
  { nombre: 'Arrancador para Lámpara de vapor de mercurio', iupc: '11' },
  { nombre: 'Arrancador para Lámpara de vapor de sodio', iupc: '11' },
  { nombre: 'Artefacto de alumbrado exterior', iupc: '11' },
  { nombre: 'Artefacto de alumbrado interior', iupc: '12' },
  { nombre: 'Artefacto fluorescente', iupc: '12' },
  { nombre: 'Artefacto LED', iupc: '12' },
  { nombre: 'Artefacto tipo farol', iupc: '11' },
  { nombre: 'Ascensor', iupc: '95' },
  { nombre: 'Asfalto', iupc: '13' },
  { nombre: 'Asfalto industrial sólido', iupc: '13' },
  { nombre: 'Asfalto liquido', iupc: '13' },
  { nombre: 'Asfalto liquido MC', iupc: '13' },
  { nombre: 'Asfalto liquido RC', iupc: '13' },
  { nombre: 'Asfalto liquido SC', iupc: '13' },
  { nombre: 'Asiendo de ducha de acero', iupc: '10' },
  { nombre: 'Asiento para inodoro', iupc: '10' },
  { nombre: 'Asignación excepcional', iupc: '47' },
  { nombre: 'Aspersor de PVC', iupc: '72' },
  { nombre: 'Aspirador', iupc: '48' },
  { nombre: 'Atornillador eléctrico', iupc: '48' },
  { nombre: 'Autohormiguera', iupc: '49' },
  { nombre: 'Automóvil', iupc: '49' },
  { nombre: 'Ayudante', iupc: '47' },
  { nombre: 'Azulejo', iupc: '24' },

  // B
  { nombre: 'Badilejo', iupc: '37' },
  { nombre: 'Balanza', iupc: '95' },
  { nombre: 'Balde', iupc: '37' },
  { nombre: 'Balde de pruebas hidráulicas', iupc: '37' },
  { nombre: 'Baldosa acústica', iupc: '14' },
  { nombre: 'Baldosa acústica de fibra mineral', iupc: '14' },
  { nombre: 'Baldosa de PVC', iupc: '16' },
  { nombre: 'Baldosa de vidrio', iupc: '79' },
  { nombre: 'Baldosa de yeso multiplaca', iupc: '14' },
  { nombre: 'Baldosa vinílica', iupc: '16' },
  { nombre: 'Baldosín semigres', iupc: '40' },
  { nombre: 'Baliza', iupc: '83' },
  { nombre: 'Bambú', iupc: '43' },
  { nombre: 'Banco de baterías', iupc: '95' },
  { nombre: 'Banco de ducto de concreto', iupc: '31' },
  { nombre: 'Banda elástica elastomérica', iupc: '60' },
  { nombre: 'Bandeja de fibra de vidrio', iupc: '89' },
  { nombre: 'Bandeja de fibra óptica', iupc: '18' },
  { nombre: 'Bandeja portacable de acero galvanizado', iupc: '85' },
  { nombre: 'Baranda modular', iupc: '94' },
  { nombre: 'Baritina', iupc: '30' },
  { nombre: 'Barniz', iupc: '86' },
  { nombre: 'Barniz marino', iupc: '86' },
  { nombre: 'Barniz poliuretano', iupc: '86' },
  { nombre: 'Barra angular abatible de acero para SSHH', iupc: '10' },
  { nombre: 'Barra angular de acero para SSHH', iupc: '10' },
  { nombre: 'Barra antipánico', iupc: '26' },
  { nombre: 'Barra cuadrada de acero al carbono', iupc: '51' },
  { nombre: 'Barra de acero liso', iupc: '02' },
  { nombre: 'Barra equipotencial de cobre', iupc: '06' },
  { nombre: 'Barra helicoidal', iupc: '03' },
  { nombre: 'Barra recta de acero para SSHH', iupc: '10' },
  { nombre: 'Barra retráctil', iupc: '37' },
  { nombre: 'Barredora mecánica', iupc: '49' },
  { nombre: 'Barreno', iupc: '37' },
  { nombre: 'Barrera de concreto', iupc: '31' },
  { nombre: 'Barrera de contención metálico', iupc: '09' },
  { nombre: 'Barrera de tráfico', iupc: '83' },
  { nombre: 'Barro', iupc: '04' },
  { nombre: 'Bastón desnivelador topográfico', iupc: '48' },
  { nombre: 'Batea', iupc: '37' },
  { nombre: 'Batería', iupc: '95' },
  { nombre: 'Bentonita', iupc: '04' },
  { nombre: 'Berbiquí', iupc: '37' },
  { nombre: 'Bidet', iupc: '10' },
  { nombre: 'Biodepurador de polietileno', iupc: '90' },
  { nombre: 'Biodiesel', iupc: '53' },
  { nombre: 'Biodigestor de polietileno', iupc: '90' },
  { nombre: 'Bisagra de acero', iupc: '26' },
  { nombre: 'Bisagra de acero tipo capuchina', iupc: '26' },
  { nombre: 'Bisagra de extensión', iupc: '26' },
  { nombre: 'Bisagra importada', iupc: '26' },
  { nombre: 'Bisagra nacional', iupc: '26' },
  { nombre: 'Bisagra roller', iupc: '26' },
  { nombre: 'Bisagra vaivén', iupc: '26' },
  { nombre: 'Bita', iupc: '65' },
  { nombre: 'Bloque de 50 pares para armario', iupc: '18' },
  { nombre: 'Bloque de concreto', iupc: '17' },
  { nombre: 'Bloque de concreto para muros', iupc: '17' },
  { nombre: 'Bloque de concreto para techos', iupc: '17' },
  { nombre: 'Bloque de poliestireno expandido', iupc: '60' },
  { nombre: 'Bloque de vidrio', iupc: '79' },
  { nombre: 'Bloqueador solar', iupc: '93' },
  { nombre: 'Bobina', iupc: '06' },
  { nombre: 'Bobina de acero LAF', iupc: '57' },
  { nombre: 'Bolardo', iupc: '83' },
  { nombre: 'Bomba centrífuga', iupc: '95' },
  { nombre: 'Bomba contraincendios', iupc: '95' },
  { nombre: 'Bomba de agua Diesel', iupc: '48' },
  { nombre: 'Bomba de agua solar', iupc: '95' },
  { nombre: 'Bomba de agua tipo turbina', iupc: '95' },
  { nombre: 'Bomba de cavidad progresiva', iupc: '95' },
  { nombre: 'Bomba de concentrado', iupc: '95' },
  { nombre: 'Bomba de concreto', iupc: '49' },
  { nombre: 'Bomba de inyección de cemento', iupc: '49' },
  { nombre: 'Bomba de lodos', iupc: '95' },
  { nombre: 'Bomba dosificadora', iupc: '95' },
  { nombre: 'Bomba neumática para vaciado de concreto', iupc: '49' },
  { nombre: 'Bomba para sistema contraincendios', iupc: '95' },
  { nombre: 'Bomba sumergible', iupc: '95' },
  { nombre: 'Bonificaciones mano de obra', iupc: '47' },
  { nombre: 'Borne', iupc: '06' },
  { nombre: 'Borne de cobre', iupc: '06' },
  { nombre: 'Botas de jebe', iupc: '83' },
  { nombre: 'Bote', iupc: '49' },
  { nombre: 'Botín de seguridad', iupc: '83' },
  { nombre: 'Botiquín', iupc: '83' },
  { nombre: 'Botón con campanilla', iupc: '12' },
  { nombre: 'Boya', iupc: '83' },
  { nombre: 'Braquete', iupc: '12' },
  { nombre: 'Brea', iupc: '13' },
  { nombre: 'Brea industrial', iupc: '13' },
  { nombre: 'Brea liquida', iupc: '13' },
  { nombre: 'Brick cerámico', iupc: '24' },
  { nombre: 'Brida de acero', iupc: '56' },
  { nombre: 'Brida de acero LAC', iupc: '56' },
  { nombre: 'Brida de hierro dúctil', iupc: '56' },
  { nombre: 'Brida rompe aguas de acero LAC', iupc: '56' },
  { nombre: 'Brida rompe aguas de hierro dúctil', iupc: '71' },
  { nombre: 'Broca', iupc: '37' },
  { nombre: 'Brocha', iupc: '37' },
  { nombre: 'Bronce', iupc: '68' },
  { nombre: 'Buje CPVC', iupc: '72' },
  { nombre: 'Bujía', iupc: '48' },
  { nombre: 'Bureta', iupc: '95' },
  { nombre: 'Bushing de acero', iupc: '65' },
  { nombre: 'Bushing de fierro galvanizado', iupc: '65' },
  { nombre: 'Bushing de PVC', iupc: '72' },
  { nombre: 'Bushing PVC-U CR para agua fría', iupc: '72' },
  { nombre: 'Buzón de concreto prefabricado', iupc: '31' },
  { nombre: 'Buzón eléctrico', iupc: '31' },
  { nombre: 'Buzón para ducto de basura', iupc: '56' },
  { nombre: 'Buzone termoplástico', iupc: '95' },

  // C
  { nombre: 'Caballete de madera', iupc: '43' },
  { nombre: 'Cable CCT-B', iupc: '18' },
  { nombre: 'Cable coaxial', iupc: '18' },
  { nombre: 'Cable de acero', iupc: '30' },
  { nombre: 'Cable de acero con recubrimiento de cobre', iupc: '06' },
  { nombre: 'Cable de acero para concreto pretensado', iupc: '30' },
  { nombre: 'Cable de cobre desnudo', iupc: '06' },
  { nombre: 'Cable de control multipar', iupc: '18' },
  { nombre: 'Cable de fibra óptica', iupc: '18' },
  { nombre: 'Cable de guarda', iupc: '82' },
  { nombre: 'Cable de red', iupc: '18' },
  { nombre: 'Cable ethernet', iupc: '18' },
  { nombre: 'Cable FPLR', iupc: '18' },
  { nombre: 'Cable HDMI', iupc: '18' },
  { nombre: 'Cable mensajero', iupc: '18' },
  { nombre: 'Cable multiconductor para control y señalización', iupc: '18' },
  { nombre: 'Cable multipar', iupc: '18' },
  { nombre: 'Cable N2XOH', iupc: '19' },
  { nombre: 'Cable N2XSY', iupc: '19' },
  { nombre: 'Cable N2XY', iupc: '19' },
  { nombre: 'Cable NKBA', iupc: '19' },
  { nombre: 'Cable NKY', iupc: '19' },
  { nombre: 'Cable NPT', iupc: '19' },
  { nombre: 'Cable NYY', iupc: '19' },
  { nombre: 'Cable para control y señalización', iupc: '18' },
  { nombre: 'Cable para seguridad y alarma', iupc: '18' },
  { nombre: 'Cable para teléfono', iupc: '18' },
  { nombre: 'Cable patch cord', iupc: '18' },
  { nombre: 'Cable PEAT', iupc: '18' },
  { nombre: 'Cable PECSAT', iupc: '18' },
  { nombre: 'Cable PROFIBUS', iupc: '18' },
  { nombre: 'Cable SFTP', iupc: '18' },
  { nombre: 'Cable telefónico', iupc: '18' },
  { nombre: 'Cable telefónico armado', iupc: '18' },
  { nombre: 'Cable telefónico con aislamiento de papel', iupc: '18' },
  { nombre: 'Cable telefónico con aislamiento de polietileno', iupc: '18' },
  { nombre: 'Cable tipo boa', iupc: '30' },
  { nombre: 'Cable TW y THW', iupc: '07' },
  { nombre: 'Cable UTP', iupc: '18' },
  { nombre: 'Cable WP', iupc: '08' },
  { nombre: 'Cable XPT', iupc: '18' },
  { nombre: 'Cabo', iupc: '93' },
  { nombre: 'Cabría', iupc: '94' },
  { nombre: 'Cachaco de concreto', iupc: '83' },
  { nombre: 'Cachaco de PVC', iupc: '83' },
  { nombre: 'Cadena', iupc: '02' },
  { nombre: 'Cadena de acero', iupc: '02' },
  { nombre: 'Caja cabina eléctrica', iupc: '12' },
  { nombre: 'Caja condulet', iupc: '12' },
  { nombre: 'Caja cuadrada eléctrica', iupc: '12' },
  { nombre: 'Caja de conexión de agua y desagüe', iupc: '31' },
  { nombre: 'Caja de conexiones de fierro fundido', iupc: '50' },
  { nombre: 'Caja de fierro galvanizado eléctrica', iupc: '12' },
  { nombre: 'Caja de herramientas', iupc: '37' },
  { nombre: 'Caja de madera para tablero eléctrico', iupc: '12' },
  { nombre: 'Caja de pase galvanizada', iupc: '61' },
  { nombre: 'Caja de pase PVC', iupc: '72' },
  { nombre: 'Caja de pozo a tierra de concreto', iupc: '31' },
  { nombre: 'Caja de registro de agua', iupc: '31' },
  { nombre: 'Caja de registro de desagüe', iupc: '31' },
  { nombre: 'Caja eléctrica', iupc: '12' },
  { nombre: 'Caja galvanizada', iupc: '61' },
  { nombre: 'Caja metálica para tablero eléctrico', iupc: '12' },
  { nombre: 'Caja octogonal liviana eléctrica', iupc: '12' },
  { nombre: 'Caja para medidor de agua de fierro fundido', iupc: '50' },
  { nombre: 'Caja para medidor de fierro', iupc: '50' },
  { nombre: 'Caja portafusibles', iupc: '12' },
  { nombre: 'Caja portamedidor polimérico', iupc: '12' },
  { nombre: 'Caja prefabricada', iupc: '31' },
  { nombre: 'Caja prefabricada grifo', iupc: '31' },
  { nombre: 'Caja protección concreto prefabricada', iupc: '31' },
  { nombre: 'Caja rectangular liviana eléctrica', iupc: '12' },
  { nombre: 'Caja sumidero', iupc: '31' },
  { nombre: 'Caja sumidero de concreto', iupc: '31' },
  { nombre: 'Caja termoplástica', iupc: '88' },
  { nombre: 'Cal', iupc: '21' },
  { nombre: 'Calamina de aluminio', iupc: '52' },
  { nombre: 'Calamina de Zinc', iupc: '56' },
  { nombre: 'Caldera', iupc: '49' },
  { nombre: 'Calentador de aceite', iupc: '49' },
  { nombre: 'Calentador de agua', iupc: '95' },
  { nombre: 'Calentador eléctrico', iupc: '95' },
  { nombre: 'Calibrador Pie de Rey', iupc: '37' },
  { nombre: 'Cámara bullet IP', iupc: '95' },
  { nombre: 'Cámara de seguridad', iupc: '95' },
  { nombre: 'Cámara domo IP', iupc: '95' },
  { nombre: 'Cámara neumática', iupc: '93' },
  { nombre: 'Cámara PTZ IP', iupc: '95' },
  { nombre: 'Camilla de seguridad', iupc: '83' },
  { nombre: 'Camión', iupc: '49' },
  { nombre: 'Camión baranda', iupc: '49' },
  { nombre: 'Camión cisterna', iupc: '49' },
  { nombre: 'Camión concretero', iupc: '49' },
  { nombre: 'Camión hidrojet', iupc: '49' },
  { nombre: 'Camión imprimador', iupc: '49' },
  { nombre: 'Camión plataforma', iupc: '49' },
  { nombre: 'Camión tractor', iupc: '49' },
  { nombre: 'Camión volquete', iupc: '49' },
  { nombre: 'Camioneta', iupc: '49' },
  { nombre: 'Campana extractora', iupc: '95' },
  { nombre: 'Campana timbre eléctrico', iupc: '12' },
  { nombre: 'Canal C de acero al carbono', iupc: '51' },
  { nombre: 'Canal de aluminio', iupc: '52' },
  { nombre: 'Canal de concreto', iupc: '31' },
  { nombre: 'Canal U de acero al carbono', iupc: '51' },
  { nombre: 'Canaleta de aluminio', iupc: '52' },
  { nombre: 'Canaleta de PVC', iupc: '72' },
  { nombre: 'Canaleta fibro-cemento', iupc: '59' },
  { nombre: 'Canaleta galvanizada', iupc: '61' },
  { nombre: 'Canaleta zinc', iupc: '56' },
  { nombre: 'Canalón fibro-cemento', iupc: '59' },
  { nombre: 'Canastilla de bronce', iupc: '77' },
  { nombre: 'Canastilla de latón', iupc: '77' },
  { nombre: 'Canastilla de PVC', iupc: '72' },
  { nombre: 'Candado', iupc: '26' },
  { nombre: 'Canopla', iupc: '10' },
  { nombre: 'Canto rodado', iupc: '05' },
  { nombre: 'Cantonera de acero', iupc: '51' },
  { nombre: 'Cantonera de aluminio', iupc: '52' },
  { nombre: 'Cantonera de PVC', iupc: '72' },
  { nombre: 'Caña Guayaquil', iupc: '43' },
  { nombre: 'Capataz', iupc: '47' },
  { nombre: 'Captafaro', iupc: '83' },
  { nombre: 'Carbón mineral', iupc: '05' },
  { nombre: 'Carbón vegetal', iupc: '43' },
  { nombre: 'Cargador frontal', iupc: '49' },
  { nombre: 'Cargador retroexcavador', iupc: '49' },
  { nombre: 'Cargador sobre llantas', iupc: '49' },
  { nombre: 'Cargador sobre orugas', iupc: '49' },
  { nombre: 'Carretilla', iupc: '37' },
  { nombre: 'Cartón', iupc: '93' },
  { nombre: 'Casco de seguridad', iupc: '83' },
  { nombre: 'Casco minero', iupc: '83' },
  { nombre: 'Cascote', iupc: '17' },
  { nombre: 'Cascote de arcilla', iupc: '17' },
  { nombre: 'Casquete Spot Light', iupc: '12' },
  { nombre: 'Catalizador epóxico', iupc: '86' },
  { nombre: 'Cautín eléctrico', iupc: '48' },
  { nombre: 'Cemento asfáltico', iupc: '20' },
  { nombre: 'Cemento blanco', iupc: '21' },
  { nombre: 'Cemento con aditivo', iupc: '81' },
  { nombre: 'Cemento conductivo', iupc: '81' },
  { nombre: 'Cemento hidráulico', iupc: '21' },
  { nombre: 'Cemento hidráulico tipo GU', iupc: '21' },
  { nombre: 'Cemento hidráulico tipo HE', iupc: '21' },
  { nombre: 'Cemento hidráulico tipo HS', iupc: '21' },
  { nombre: 'Cemento hidráulico tipo IP', iupc: '21' },
  { nombre: 'Cemento hidráulico tipo MS', iupc: '21' },
  { nombre: 'Cemento portland', iupc: '21' },
  { nombre: 'Cemento Portland tipo I', iupc: '21' },
  { nombre: 'Cemento Portland tipo II', iupc: '21' },
  { nombre: 'Cemento Portland tipo V', iupc: '21' },
  { nombre: 'Cepilladora de madera', iupc: '48' },
  { nombre: 'Cepillo', iupc: '37' },
  { nombre: 'Cera', iupc: '93' },
  { nombre: 'Cerámica esmaltada y sin esmaltar', iupc: '24' },
  { nombre: 'Cerámico', iupc: '24' },
  { nombre: 'Cerámico para piso', iupc: '24' },
  { nombre: 'Cerámico piscina', iupc: '24' },
  { nombre: 'Cerámico piso pared', iupc: '24' },
  { nombre: 'Cerradura de embutir', iupc: '26' },
  { nombre: 'Cerradura de manija', iupc: '26' },
  { nombre: 'Cerradura de perilla', iupc: '26' },
  { nombre: 'Cerradura de sobreponer', iupc: '26' },
  { nombre: 'Cerradura digital', iupc: '26' },
  { nombre: 'Cerradura eléctrica', iupc: '26' },
  { nombre: 'Cerradura inteligente', iupc: '95' },
  { nombre: 'Cerrajería', iupc: '26' },
  { nombre: 'Cerrojo', iupc: '26' },
  { nombre: 'Césped', iupc: '93' },
  { nombre: 'Chaleco de seguridad', iupc: '83' },
  { nombre: 'Chancadora', iupc: '49' },
  { nombre: 'Chapa', iupc: '26' },
  { nombre: 'Cierrapuertas', iupc: '26' },
  { nombre: 'Cilindro', iupc: '37' },
  { nombre: 'Cilindro de concreto', iupc: '31' },
  { nombre: 'Cincel', iupc: '37' },
  { nombre: 'Cinta aislante', iupc: '37' },
  { nombre: 'Cinta aislante eléctrica', iupc: '37' },
  { nombre: 'Cinta antideslizante', iupc: '83' },
  { nombre: 'Cinta autoadhesiva para drywall', iupc: '59' },
  { nombre: 'Cinta de papel para drywall', iupc: '59' },
  { nombre: 'Cinta plástica de seguridad', iupc: '83' },
  { nombre: 'Cinta teflón', iupc: '72' },
  { nombre: 'Cisterna de polietileno', iupc: '90' },
  { nombre: 'Cizalla manual', iupc: '37' },
  { nombre: 'Clavo', iupc: '02' },
  { nombre: 'Clavo de acero con cabeza', iupc: '02' },
  { nombre: 'Clavo de acero galvanizado', iupc: '02' },
  { nombre: 'Clavo de acero para calamina', iupc: '02' },
  { nombre: 'Clavo de acero sin cabeza', iupc: '02' },
  { nombre: 'Cloro', iupc: '93' },
  { nombre: 'Cobre', iupc: '06' },
  { nombre: 'Codo CPVC', iupc: '72' },
  { nombre: 'Codo de acero', iupc: '65' },
  { nombre: 'Codo de cobre', iupc: '68' },
  { nombre: 'Codo de fierro fundido', iupc: '71' },
  { nombre: 'Codo de hierro dúctil', iupc: '71' },
  { nombre: 'Codo HDPE', iupc: '90' },
  { nombre: 'Codo PVC agua', iupc: '72' },
  { nombre: 'Codo PVC SAL desagüe', iupc: '72' },
  { nombre: 'Codo PVC sanitaria', iupc: '72' },
  { nombre: 'Codo PVC SAP eléctrica', iupc: '72' },
  { nombre: 'Codo PVC-U CR para agua fría', iupc: '72' },
  { nombre: 'Codo PVC-U para drenaje y alcantarillado', iupc: '66' },
  { nombre: 'Codo PVC-U SP para agua fría', iupc: '72' },
  { nombre: 'Cola', iupc: '93' },
  { nombre: 'Cola sintética', iupc: '93' },
  { nombre: 'Comba', iupc: '37' },
  { nombre: 'Compactador manual', iupc: '37' },
  { nombre: 'Compactadora de rodillos', iupc: '49' },
  { nombre: 'Compactadora vibratoria', iupc: '49' },
  { nombre: 'Compresora de aire eléctrica', iupc: '48' },
  { nombre: 'Compresora Diesel', iupc: '49' },
  { nombre: 'Compresora neumática', iupc: '49' },
  { nombre: 'Concreto en bolsa', iupc: '80' },
  { nombre: 'Concreto premezclado', iupc: '80' },
  { nombre: 'Conductor aéreo', iupc: '82' },
  { nombre: 'Conductor autoportante de aluminio', iupc: '82' },
  { nombre: 'Conductor de cobre desnudo', iupc: '06' },
  { nombre: 'Conector de cobre', iupc: '06' },
  { nombre: 'Conector eléctrico', iupc: '06' },
  { nombre: 'Conector PVC SAP eléctrica', iupc: '72' },
  { nombre: 'Conector PVC SEL eléctrica', iupc: '72' },
  { nombre: 'Conector RJ', iupc: '18' },
  { nombre: 'Conexión PVC', iupc: '72' },
  { nombre: 'Confitillo', iupc: '05' },
  { nombre: 'Cono de seguridad', iupc: '83' },
  { nombre: 'Contactor', iupc: '12' },
  { nombre: 'Contrazócalo de aluminio', iupc: '52' },
  { nombre: 'Contrazócalo de madera', iupc: '41' },
  { nombre: 'Contrazócalo de PVC', iupc: '16' },
  { nombre: 'Contrazócalo de vinílico', iupc: '16' },
  { nombre: 'Contrazócalo loseta', iupc: '40' },
  { nombre: 'Contrazócalo terrazo', iupc: '40' },
  { nombre: 'Cordel', iupc: '37' },
  { nombre: 'Cordón detonante', iupc: '27' },
  { nombre: 'Correa de acero al carbono', iupc: '51' },
  { nombre: 'Cortadora de concreto', iupc: '48' },
  { nombre: 'Cortadora de fierro de construcción', iupc: '37' },
  { nombre: 'Cortadora de mayólica', iupc: '37' },
  { nombre: 'Cortadora de pavimento', iupc: '48' },
  { nombre: 'Crawler Drill', iupc: '49' },
  { nombre: 'Cristal templado', iupc: '79' },
  { nombre: 'Cruceta de concreto', iupc: '62' },
  { nombre: 'Cruceta de madera', iupc: '41' },
  { nombre: 'Cruz de PVC', iupc: '72' },
  { nombre: 'Cuña de madera', iupc: '43' },
  { nombre: 'Curva de PVC eléctrica', iupc: '72' },
  { nombre: 'Curva HDPE', iupc: '90' },
  { nombre: 'Curva PVC SAP eléctrica', iupc: '72' },
  { nombre: 'Curva PVC-U para redes de agua', iupc: '66' },

  // D
  { nombre: 'Destornillador', iupc: '37' },
  { nombre: 'Detonador eléctrico', iupc: '27' },
  { nombre: 'Detonador no eléctrico', iupc: '27' },
  { nombre: 'Detonante', iupc: '27' },
  { nombre: 'Diesel', iupc: '53' },
  { nombre: 'Dinamita', iupc: '28' },
  { nombre: 'Dinamita gelatina', iupc: '28' },
  { nombre: 'Dinamita pulverulenta', iupc: '28' },
  { nombre: 'Dinamita semigelatina', iupc: '28' },
  { nombre: 'Dintel prefabricado de concreto', iupc: '31' },
  { nombre: 'Disco de corte', iupc: '37' },
  { nombre: 'Disco de desbaste', iupc: '37' },
  { nombre: 'Disipador sísmico', iupc: '30' },
  { nombre: 'Disolvente de pintura', iupc: '86' },
  { nombre: 'Disolvente epóxico', iupc: '86' },
  { nombre: 'Dispensador de jabón', iupc: '10' },
  { nombre: 'Dispensador de papel', iupc: '10' },
  { nombre: 'Dobladora de fierro', iupc: '48' },
  { nombre: 'Dobladora de tubos', iupc: '48' },
  { nombre: 'Dosificadora de concreto', iupc: '49' },
  { nombre: 'Dowel de acero corrugado', iupc: '03' },
  { nombre: 'Ducha', iupc: '10' },
  { nombre: 'Ducto de concreto', iupc: '31' },
  { nombre: 'Ducto de plancha de acero galvanizado', iupc: '61' },
  { nombre: 'Durmiente de concreto', iupc: '31' },
  { nombre: 'Durmiente de madera', iupc: '43' },

  // E
  { nombre: 'Electrobomba', iupc: '95' },
  { nombre: 'Electrodo', iupc: '06' },
  { nombre: 'Electrodo de acero recubierto de cobre', iupc: '06' },
  { nombre: 'Electrodo de cobre', iupc: '06' },
  { nombre: 'Elevador eléctrico', iupc: '49' },
  { nombre: 'Empaquetadura', iupc: '86' },
  { nombre: 'Empaquetadura de jebe', iupc: '66' },
  { nombre: 'Emulsión asfáltica', iupc: '13' },
  { nombre: 'Emulsión explosiva', iupc: '28' },
  { nombre: 'Enchape cerámico', iupc: '24' },
  { nombre: 'Enchufe', iupc: '12' },
  { nombre: 'Encofrado metálico', iupc: '94' },
  { nombre: 'Encofrado prefabricado', iupc: '94' },
  { nombre: 'Endurecedor de pisos', iupc: '81' },
  { nombre: 'Energía eléctrica', iupc: '93' },
  { nombre: 'Ensayo de laboratorio', iupc: '93' },
  { nombre: 'Epóxico', iupc: '86' },
  { nombre: 'Equipo de cloración', iupc: '95' },
  { nombre: 'Equipo de oxicorte', iupc: '48' },
  { nombre: 'Equipo de protección colectiva', iupc: '83' },
  { nombre: 'Equipo de protección personal', iupc: '83' },
  { nombre: 'Equipo de termofusión', iupc: '48' },
  { nombre: 'Escalera', iupc: '37' },
  { nombre: 'Escalera modular', iupc: '94' },
  { nombre: 'Escalera telescópica', iupc: '37' },
  { nombre: 'Escoba', iupc: '37' },
  { nombre: 'Esmalte', iupc: '86' },
  { nombre: 'Esmeril', iupc: '48' },
  { nombre: 'Esparcidora de agregados', iupc: '49' },
  { nombre: 'Esparcidora de asfalto', iupc: '49' },
  { nombre: 'Esparcidora de concreto', iupc: '49' },
  { nombre: 'Espátula', iupc: '37' },
  { nombre: 'Espejo', iupc: '79' },
  { nombre: 'Espiga de acero', iupc: '02' },
  { nombre: 'Espuma expansiva', iupc: '60' },
  { nombre: 'Estabilizadora de suelos', iupc: '49' },
  { nombre: 'Estaca de madera', iupc: '43' },
  { nombre: 'Estación total', iupc: '48' },
  { nombre: 'Estrobo', iupc: '02' },
  { nombre: 'Eucalipto', iupc: '43' },
  { nombre: 'Excavadora sobre llantas', iupc: '49' },
  { nombre: 'Excavadora sobre orugas', iupc: '49' },
  { nombre: 'Extintor', iupc: '83' },

  // F & G
  { nombre: 'Faja lumbar', iupc: '83' },
  { nombre: 'Faja transportadora', iupc: '49' },
  { nombre: 'Farol', iupc: '11' },
  { nombre: 'Fibra de acero', iupc: '02' },
  { nombre: 'Fibra de vidrio', iupc: '89' },
  { nombre: 'Fibra óptica', iupc: '18' },
  { nombre: 'Fierro corrugado', iupc: '03' },
  { nombre: 'Fierro liso', iupc: '02' },
  { nombre: 'Flete aéreo', iupc: '33' },
  { nombre: 'Flete fluvial', iupc: '92' },
  { nombre: 'Flete terrestre', iupc: '32' },
  { nombre: 'Flexómetro', iupc: '37' },
  { nombre: 'Fluxómetro mecánico para inodoro', iupc: '10' },
  { nombre: 'Fluxómetro mecánico para urinario', iupc: '10' },
  { nombre: 'Formador de empaquetadura', iupc: '86' },
  { nombre: 'Formica', iupc: '84' },
  { nombre: 'Formón', iupc: '37' },
  { nombre: 'Fragua para rellenar juntas', iupc: '81' },
  { nombre: 'Fresadora', iupc: '49' },
  { nombre: 'Frotacho', iupc: '37' },
  { nombre: 'Fulminante', iupc: '27' },
  { nombre: 'Fusible eléctrico', iupc: '11' },
  { nombre: 'Gabinete metálico', iupc: '56' },
  { nombre: 'Gas', iupc: '53' },
  { nombre: 'Gas licuado de petróleo (GLP)', iupc: '53' },
  { nombre: 'Gas natural', iupc: '93' },
  { nombre: 'Gasohol', iupc: '34' },
  { nombre: 'Gasolina', iupc: '34' },
  { nombre: 'Gel Conductivo', iupc: '81' },
  { nombre: 'Generador', iupc: '49' },
  { nombre: 'Generador eléctrico portátil', iupc: '48' },
  { nombre: 'Geobolsa', iupc: '91' },
  { nombre: 'Geocompuesto', iupc: '91' },
  { nombre: 'Geomalla', iupc: '91' },
  { nombre: 'Geomembrana', iupc: '91' },
  { nombre: 'Geotextil', iupc: '91' },
  { nombre: 'Gotero HDPE', iupc: '90' },
  { nombre: 'GPS diferencial', iupc: '48' },
  { nombre: 'Granito', iupc: '05' },
  { nombre: 'Grapa', iupc: '02' },
  { nombre: 'Grasa lubricante', iupc: '01' },
  { nombre: 'Grass', iupc: '93' },
  { nombre: 'Grava', iupc: '05' },
  { nombre: 'Gravilla', iupc: '05' },
  { nombre: 'Gres cerámico', iupc: '24' },
  { nombre: 'Grifería', iupc: '10' },
  { nombre: 'Grifería nacional aparatos sanitarios', iupc: '10' },
  { nombre: 'Grifo contra incendio', iupc: '78' },
  { nombre: 'Grifo jardín', iupc: '10' },
  { nombre: 'Grifo jardín de bronce', iupc: '77' },
  { nombre: 'Grillete de sujeción', iupc: '02' },
  { nombre: 'Grouting', iupc: '81' },
  { nombre: 'Grúa', iupc: '49' },
  { nombre: 'Grupo electrógeno', iupc: '95' },
  { nombre: 'Grupo electrógeno de obra', iupc: '49' },
  { nombre: 'Guantes', iupc: '83' },
  { nombre: 'Guardacabo', iupc: '02' },
  { nombre: 'Guardavía metálico', iupc: '09' },

  // H & I & J & L
  { nombre: 'Hacha', iupc: '37' },
  { nombre: 'Herramienta de construcción', iupc: '37' },
  { nombre: 'Herramienta manual', iupc: '37' },
  { nombre: 'Hidrante contraincendios', iupc: '78' },
  { nombre: 'Hidrogel', iupc: '28' },
  { nombre: 'Hidrolavadora', iupc: '48' },
  { nombre: 'Hormigón', iupc: '38' },
  { nombre: 'Hormigón de rio', iupc: '38' },
  { nombre: 'Humus', iupc: '93' },
  { nombre: 'Impermeabilizante', iupc: '81' },
  { nombre: 'Imprimante (pintura)', iupc: '54' },
  { nombre: 'Inodoro', iupc: '10' },
  { nombre: 'Inodoro two piece', iupc: '10' },
  { nombre: 'Inodoro one piece', iupc: '10' },
  { nombre: 'Interruptor', iupc: '12' },
  { nombre: 'Interruptor diferencial', iupc: '12' },
  { nombre: 'Interruptor termomagnético', iupc: '12' },
  { nombre: 'Inversor', iupc: '95' },
  { nombre: 'Jabón', iupc: '93' },
  { nombre: 'Junta de PVC', iupc: '72' },
  { nombre: 'Junta water stop cobre', iupc: '06' },
  { nombre: 'Junta water stop PVC', iupc: '72' },
  { nombre: 'Laca', iupc: '86' },
  { nombre: 'Ladrillo caravista', iupc: '17' },
  { nombre: 'Ladrillo de arcilla', iupc: '17' },
  { nombre: 'Ladrillo de concreto', iupc: '17' },
  { nombre: 'Ladrillo hueco para techo', iupc: '17' },
  { nombre: 'Ladrillo king kong', iupc: '17' },
  { nombre: 'Ladrillo pandereta', iupc: '17' },
  { nombre: 'Ladrillo pastelero', iupc: '17' },
  { nombre: 'Ladrillo refractario', iupc: '17' },
  { nombre: 'Lampa', iupc: '37' },
  { nombre: 'Lámpara LED', iupc: '12' },
  { nombre: 'Lavadero', iupc: '10' },
  { nombre: 'Lavatorio', iupc: '10' },
  { nombre: 'Lejía', iupc: '93' },
  { nombre: 'Lentes de seguridad', iupc: '83' },
  { nombre: 'Lija', iupc: '37' },
  { nombre: 'Lijadora eléctrica', iupc: '48' },
  { nombre: 'Lima', iupc: '37' },
  { nombre: 'Línea de vida', iupc: '83' },
  { nombre: 'Linterna', iupc: '37' },
  { nombre: 'Listón de madera', iupc: '43' },
  { nombre: 'Llana', iupc: '37' },
  { nombre: 'Llave de ajuste', iupc: '37' },
  { nombre: 'Llave para ducha', iupc: '10' },
  { nombre: 'Llave para lavatorio', iupc: '10' },
  { nombre: 'Lona', iupc: '91' },
  { nombre: 'Loseta', iupc: '40' },
  { nombre: 'Loseta de concreto', iupc: '40' },
  { nombre: 'Loseta veneciana', iupc: '40' },
  { nombre: 'Lubricante', iupc: '01' },
  { nombre: 'Luminaria de alumbrado público', iupc: '11' },
  { nombre: 'Luminaria downlight', iupc: '12' },
  { nombre: 'Luminaria LED', iupc: '12' },

  // M
  { nombre: 'Madera tornillo', iupc: '43' },
  { nombre: 'Madera eucalipto', iupc: '43' },
  { nombre: 'Madera pino importada', iupc: '42' },
  { nombre: 'Madera pino oregón', iupc: '42' },
  { nombre: 'Madera pino radiata', iupc: '42' },
  { nombre: 'Madera nacional para encofrado y carpintería', iupc: '43' },
  { nombre: 'Madera terciada nacional', iupc: '44' },
  { nombre: 'Madera terciada para encofrado', iupc: '44' },
  { nombre: 'Malla de acero', iupc: '46' },
  { nombre: 'Malla de seguridad', iupc: '83' },
  { nombre: 'Malla electrosoldada', iupc: '46' },
  { nombre: 'Malla gavión de acero', iupc: '46' },
  { nombre: 'Malla raschel', iupc: '83' },
  { nombre: 'Manguera', iupc: '37' },
  { nombre: 'Mano de obra', iupc: '47' },
  { nombre: 'Manta geotextil', iupc: '91' },
  { nombre: 'Marco de fierro', iupc: '50' },
  { nombre: 'Marco y tapa de concreto', iupc: '31' },
  { nombre: 'Marco y tapa de fierro fundido', iupc: '50' },
  { nombre: 'Martillo', iupc: '37' },
  { nombre: 'Martillo eléctrico demoledor', iupc: '48' },
  { nombre: 'Martillo neumático', iupc: '49' },
  { nombre: 'Máscara protectora', iupc: '83' },
  { nombre: 'Mascarilla', iupc: '83' },
  { nombre: 'Masilla para drywall', iupc: '59' },
  { nombre: 'Mayólica', iupc: '24' },
  { nombre: 'Mecha de seguridad', iupc: '27' },
  { nombre: 'Medidor de agua', iupc: '95' },
  { nombre: 'Medidor de energía', iupc: '95' },
  { nombre: 'Mezcladora de concreto', iupc: '48' },
  { nombre: 'Mezcladora para ducha', iupc: '10' },
  { nombre: 'Microcemento', iupc: '81' },
  { nombre: 'Minicargador', iupc: '49' },
  { nombre: 'Mortero en bolsa', iupc: '80' },
  { nombre: 'Motobomba', iupc: '48' },
  { nombre: 'Motoniveladora', iupc: '49' },
  { nombre: 'Motosierra', iupc: '48' },

  // N & O & P
  { nombre: 'Neopreno', iupc: '30' },
  { nombre: 'Niple de acero', iupc: '65' },
  { nombre: 'Niple de bronce', iupc: '68' },
  { nombre: 'Niple de PVC', iupc: '72' },
  { nombre: 'Nivel óptico', iupc: '48' },
  { nombre: 'Nivel topográfico', iupc: '48' },
  { nombre: 'Ocre', iupc: '81' },
  { nombre: 'Oficial', iupc: '47' },
  { nombre: 'Operario', iupc: '47' },
  { nombre: 'Operador de equipo pesado', iupc: '47-1' },
  { nombre: 'Overol', iupc: '83' },
  { nombre: 'Oxígeno', iupc: '93' },
  { nombre: 'Pala', iupc: '37' },
  { nombre: 'Pala hidráulica', iupc: '49' },
  { nombre: 'Pala mecánica', iupc: '49' },
  { nombre: 'Panel de concreto prefabricado', iupc: '31' },
  { nombre: 'Panel de poliestireno', iupc: '60' },
  { nombre: 'Panel solar', iupc: '95' },
  { nombre: 'Parante de acero galvanizado', iupc: '85' },
  { nombre: 'Parquet', iupc: '41' },
  { nombre: 'Pegamento para PVC', iupc: '86' },
  { nombre: 'Peón', iupc: '47' },
  { nombre: 'Perfil de acero al carbono', iupc: '51' },
  { nombre: 'Perfil de acero galvanizado', iupc: '85' },
  { nombre: 'Perfil de aluminio', iupc: '52' },
  { nombre: 'Perno', iupc: '02' },
  { nombre: 'Perno de expansión', iupc: '02' },
  { nombre: 'Perno hexagonal', iupc: '02' },
  { nombre: 'Petróleo diésel', iupc: '53' },
  { nombre: 'Picaporte', iupc: '26' },
  { nombre: 'Pico', iupc: '37' },
  { nombre: 'Piedra chancada', iupc: '05' },
  { nombre: 'Piedra grande', iupc: '05' },
  { nombre: 'Pintura anticorrosiva', iupc: '86' },
  { nombre: 'Pintura epóxica', iupc: '86' },
  { nombre: 'Pintura esmalte', iupc: '86' },
  { nombre: 'Pintura látex', iupc: '54' },
  { nombre: 'Pintura para tráfico', iupc: '86' },
  { nombre: 'Pintura temple', iupc: '55' },
  { nombre: 'Piso cerámico', iupc: '24' },
  { nombre: 'Piso laminado HDF', iupc: '84' },
  { nombre: 'Piso PVC', iupc: '16' },
  { nombre: 'Piso vinílico', iupc: '16' },
  { nombre: 'Pisón manual', iupc: '37' },
  { nombre: 'Pistola de silicona', iupc: '48' },
  { nombre: 'Placa colaborante de acero galvanizado', iupc: '61' },
  { nombre: 'Placa de fibrocemento', iupc: '59' },
  { nombre: 'Placa de yeso (drywall)', iupc: '59' },
  { nombre: 'Placa para tomacorriente', iupc: '12' },
  { nombre: 'Plancha curva de aluzinc', iupc: '87' },
  { nombre: 'Plancha de acero LAC', iupc: '56' },
  { nombre: 'Plancha de acero LAC lisa', iupc: '56' },
  { nombre: 'Plancha de acero LAC estriada', iupc: '56' },
  { nombre: 'Plancha negra lisa', iupc: '56' },
  { nombre: 'Plancha negra', iupc: '56' },
  { nombre: 'Plancha de acero LAF', iupc: '57' },
  { nombre: 'Plancha de aluzinc para techos', iupc: '87' },
  { nombre: 'Plancha de fibrocemento', iupc: '59' },
  { nombre: 'Plancha de policarbonato', iupc: '88' },
  { nombre: 'Plancha galvanizada', iupc: '61' },
  { nombre: 'Plancha ondulada de fibrocemento', iupc: '59' },
  { nombre: 'Platina de acero al carbono', iupc: '51' },
  { nombre: 'Platina de cobre', iupc: '06' },
  { nombre: 'Plomada', iupc: '37' },
  { nombre: 'Poliestireno expandido', iupc: '60' },
  { nombre: 'Porcelanato', iupc: '24' },
  { nombre: 'Poste de concreto', iupc: '62' },
  { nombre: 'Protector auditivo', iupc: '83' },
  { nombre: 'Puntal metálico telescópico', iupc: '94' },

  // R & S & T & U & V & Z
  { nombre: 'Reducción de PVC', iupc: '72' },
  { nombre: 'Reflector', iupc: '11' },
  { nombre: 'Regla de aluminio', iupc: '37' },
  { nombre: 'Rejilla de acero negro', iupc: '51' },
  { nombre: 'Resina epóxica', iupc: '86' },
  { nombre: 'Respirador', iupc: '83' },
  { nombre: 'Retroexcavadora', iupc: '49' },
  { nombre: 'Riel de acero galvanizado', iupc: '85' },
  { nombre: 'Rodillo compactador vibratorio', iupc: '49' },
  { nombre: 'Rodillo para pintar', iupc: '37' },
  { nombre: 'Rotomartillo', iupc: '48' },
  { nombre: 'Sellador para juntas de expansión', iupc: '60' },
  { nombre: 'Semáforo', iupc: '95' },
  { nombre: 'Señal de seguridad', iupc: '83' },
  { nombre: 'Señal de tránsito', iupc: '83' },
  { nombre: 'Serrucho', iupc: '37' },
  { nombre: 'Sierra circular', iupc: '48' },
  { nombre: 'Silicona', iupc: '60' },
  { nombre: 'Soldadora eléctrica', iupc: '48' },
  { nombre: 'Soldadura por electrodo', iupc: '51' },
  { nombre: 'Solvente xilol', iupc: '86' },
  { nombre: 'Sumidero de bronce', iupc: '68' },
  { nombre: 'Sumidero de PVC', iupc: '10' },
  { nombre: 'Tablero de melamina', iupc: '84' },
  { nombre: 'Tablero eléctrico', iupc: '12' },
  { nombre: 'Tablero MDF', iupc: '84' },
  { nombre: 'Tablero OSB', iupc: '84' },
  { nombre: 'Taladro', iupc: '48' },
  { nombre: 'Tanque de polietileno', iupc: '90' },
  { nombre: 'Tapón de PVC', iupc: '72' },
  { nombre: 'Tee de PVC', iupc: '72' },
  { nombre: 'Teja de arcilla', iupc: '17' },
  { nombre: 'Teja de fibrocemento', iupc: '59' },
  { nombre: 'Temple', iupc: '55' },
  { nombre: 'Teodolito', iupc: '48' },
  { nombre: 'Terma eléctrica', iupc: '95' },
  { nombre: 'Thinner', iupc: '86' },
  { nombre: 'Thinner acrílico', iupc: '86' },
  { nombre: 'Tierra de chacra', iupc: '04' },
  { nombre: 'Tirafondo de acero', iupc: '02' },
  { nombre: 'Tomacorriente', iupc: '12' },
  { nombre: 'Tornillo autoperforante', iupc: '02' },
  { nombre: 'Tornillo autorroscante', iupc: '02' },
  { nombre: 'Tornillo para drywall', iupc: '02' },
  { nombre: 'Tornillo para madera', iupc: '02' },
  { nombre: 'Tractor sobre orugas', iupc: '49' },
  { nombre: 'Trampa de PVC para desagüe', iupc: '72' },
  { nombre: 'Transformador eléctrico', iupc: '95' },
  { nombre: 'Triplay fenólico importado', iupc: '84' },
  { nombre: 'Triplay lupuna', iupc: '44' },
  { nombre: 'Triplay para encofrado', iupc: '44' },
  { nombre: 'Tronzadora', iupc: '48' },
  { nombre: 'Tubería CPVC para agua caliente', iupc: '72' },
  { nombre: 'Tubería de acero electrosoldado', iupc: '65' },
  { nombre: 'Tubería de acero galvanizado', iupc: '65' },
  { nombre: 'Tubería de acero negro', iupc: '65' },
  { nombre: 'Tubería de cobre', iupc: '68' },
  { nombre: 'Tubería de fierro fundido', iupc: '71' },
  { nombre: 'Tubería de polietileno', iupc: '90' },
  { nombre: 'Tubería de PVC para agua', iupc: '72' },
  { nombre: 'Tubería de PVC para desagüe', iupc: '72' },
  { nombre: 'Tubería de PVC para red de agua potable', iupc: '66' },
  { nombre: 'Tubería de PVC para red de alcantarillado', iupc: '66' },
  { nombre: 'Tubería HDPE', iupc: '90' },
  { nombre: 'Tubería HDPE a presión', iupc: '90' },
  { nombre: 'Tubería PP-R', iupc: '90' },
  { nombre: 'Tubo de abasto', iupc: '10' },
  { nombre: 'Tubo fluorescente', iupc: '12' },
  { nombre: 'Tubo LED', iupc: '12' },
  { nombre: 'Tuerca hexagonal', iupc: '02' },
  { nombre: 'Unión de PVC agua', iupc: '72' },
  { nombre: 'Unión universal de PVC', iupc: '72' },
  { nombre: 'Urinario', iupc: '10' },
  { nombre: 'Válvula angular de bronce', iupc: '77' },
  { nombre: 'Válvula check de acero', iupc: '78' },
  { nombre: 'Válvula check de bronce', iupc: '77' },
  { nombre: 'Válvula compuerta de bronce', iupc: '77' },
  { nombre: 'Válvula compuerta de hierro fundido', iupc: '78' },
  { nombre: 'Válvula de aire de hierro dúctil', iupc: '78' },
  { nombre: 'Válvula esférica de bronce', iupc: '77' },
  { nombre: 'Varilla de acero corrugado', iupc: '03' },
  { nombre: 'Varilla para tierra de cobre', iupc: '06' },
  { nombre: 'Vibrador de concreto', iupc: '48' },
  { nombre: 'Vidrio crudo incoloro', iupc: '79' },
  { nombre: 'Vidrio laminado', iupc: '79' },
  { nombre: 'Vidrio templado', iupc: '79' },
  { nombre: 'Viga de acero al carbono', iupc: '51' },
  { nombre: 'Vigueta prefabricada de concreto', iupc: '31' },
  { nombre: 'Volquete', iupc: '49' },
  { nombre: 'Water stop de PVC', iupc: '72' },
  { nombre: 'Waype', iupc: '37' },
  { nombre: 'Wincha', iupc: '37' },
  { nombre: 'Yee PVC desagüe', iupc: '72' },
  { nombre: 'Yeso', iupc: '04' },
  { nombre: 'Zapatos de seguridad', iupc: '83' },
  { nombre: 'Zaranda vibratoria', iupc: '49' },
  { nombre: 'Zócalo de madera', iupc: '43' },
  { nombre: 'Zócalo de PVC', iupc: '16' },
  { nombre: 'Zumbador', iupc: '12' },
];

/** Normalización estándar para comparación de texto */
export const normIUPC = (s) => String(s || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'en', 'y', 'a', 'un', 'una', 'x',
  'al', 'su', 'o', 'e', 'tipo', 'clase', 'marca', 'medida', 'diametro', 'd', 'n', 'no',
  // «servicio» y «alquiler» los dice TODO el árbol de servicios: no distinguen
  // nada adentro y, contándolos, inflaban por igual a todas las entradas.
  // Medido: «SERVICIO DE ALGO RARO» pegaba con «Servicio técnico» al 80% y
  // salía clasificado como Mantenimiento. Sin ellos manda el sustantivo —
  // almacén → S01, retroexcavadora → S02— que es lo que de verdad decide.
  // Que ALGO sea un servicio ya lo resuelve `detectarServicio` con regex sobre
  // el texto entero, no con estos tokens.
  'servicio', 'servicios', 'alquiler',
]);

const tokensDeTexto = (norm) => norm.split(' ').filter(t => t && !STOPWORDS.has(t));

/** Pre-indexado del diccionario oficial para búsqueda instantánea */
const DICCIONARIO_INDEXADO = ELEMENTOS_DICCIONARIO_INEI.map(item => {
  const norm = normIUPC(item.nombre);
  return {
    ...item,
    norm,
    tokens: tokensDeTexto(norm),
  };
});

/** Lo mismo para el árbol de servicios (ver `clasificacion-servicios.js`). */
const DICCIONARIO_SERVICIOS_INDEXADO = DICCIONARIO_SERVICIOS.map(item => {
  const norm = normIUPC(item.nombre);
  return { nombre: item.nombre, cod: item.cod, norm, tokens: tokensDeTexto(norm) };
});

/**
 * El diccionario COMPLETO de una clasificación: los términos que la disparan.
 * Junta la base que viaja en el bundle (Anexo 2 del INEI para los insumos, el
 * de `clasificacion-servicios.js` para los servicios) con los que se hayan
 * agregado desde la pantalla y llegan por `terminosCustom`.
 * Es lo que dibuja el Catálogo cuando te parás sobre una clasificación.
 */
export function terminosDeClasificacion(codigo, terminosCustom = []) {
  const c = String(codigo || '').trim();
  if (!c) return [];
  const real = REAGRUPACIONES_IUPC[c] || c;
  const oficiales = esCodigoServicio(c)
    ? DICCIONARIO_SERVICIOS.filter(x => x.cod === c).map(x => ({ termino: x.nombre, origen: 'base' }))
    : ELEMENTOS_DICCIONARIO_INEI
      .filter(x => (REAGRUPACIONES_IUPC[x.iupc] || x.iupc) === real)
      .map(x => ({ termino: x.nombre, origen: 'inei' }));
  // `origen` real de cada término propio (mig 212): la pantalla necesita poder
  // distinguir lo que alguien escribió a mano de lo que dejó una decisión o un
  // recorrido con IA. Las filas viejas, sin columna, se leen como 'decision'.
  const propios = (terminosCustom || [])
    .filter(t => t && !t.deleted_at && String(t.clasificacion_codigo) === c)
    .map(t => ({
      termino: t.termino,
      origen: t.origen === 'manual' ? 'manual' : (t.origen === 'ia' ? 'ia' : 'decision'),
      id: t.id,
    }));
  return [...oficiales, ...propios]
    .sort((a, b) => String(a.termino).localeCompare(String(b.termino), 'es'));
}

/** Devuelve la lista completa de todas las categorías disponibles */
export function listarCategoriasDisponibles(categoriasPersonalizadas = []) {
  const iupc = IUPC_CODIGOS.map(c => ({
    codigo: c.codigo,
    label: `[${c.codigo}] ${c.nombre}`,
    nombre: c.nombre,
    tipo: c.tipo,
    arbol: 'insumo',
    grupo: 'Insumos · IUPC del Estado Peruano',
  }));

  const servicios = SERVICIOS_CODIGOS.map(c => ({
    codigo: c.codigo,
    label: `[${c.codigo}] ${c.nombre}`,
    nombre: c.nombre,
    tipo: 'servicio',
    arbol: 'servicio',
    grupo: 'Servicios',
  }));

  const complementarias = CATEGORIAS_COMPLEMENTARIAS.map(c => ({
    codigo: c.codigo,
    label: c.nombre,
    nombre: c.nombre,
    tipo: c.tipo,
    arbol: 'complementaria',
    grupo: 'Complementarias',
  }));

  // Las que Gabriel crea desde la pantalla. Viven en la tabla
  // `clasificaciones` (mig 205) y se mezclan acá con la base del bundle.
  const customs = (categoriasPersonalizadas || [])
    .filter(c => c && !c.deleted_at && c.activo !== false)
    .map(c => {
      const cod = c.codigo || c.id || `custom:${normIUPC(c.nombre || c)}`;
      const nom = c.nombre || c.label || c;
      const arbol = c.arbol === 'servicio' ? 'servicio' : 'insumo';
      return {
        codigo: cod,
        label: `[${cod}] ${nom}`,
        nombre: nom,
        tipo: c.tipo || (arbol === 'servicio' ? 'servicio' : 'material'),
        arbol,
        propia: true,
        gasto: c.gasto || null,
        grupo: arbol === 'servicio' ? 'Servicios · tuyas' : 'Insumos · tuyas',
      };
    });

  // Para que `etiquetaCategoria()` las sepa nombrar en las otras 35 llamadas
  // de la app sin que ninguna tenga que recibir la lista — ver el registro.
  if (customs.length) registrarClasificacionesPropias(customs);

  return [...iupc, ...servicios, ...complementarias, ...customs];
}

/**
 * Las categorías que se OFRECEN para ELEGIR en un desplegable — la lista
 * completa MENOS `sin_clasificar` (pedido de Gabriel, 14-sep-2026: «que no
 * exista ninguna opción sin propuesta»). Elegirla a mano de una lista, mezclada
 * entre las 95 categorías reales como si fuera una más, es lo mismo que no
 * clasificar nada — la misma razón por la que ya no se ofrece como SUGERENCIA
 * (ver `BANDA_SIN_PROPUESTA` en bandeja-categorizacion.js).
 *
 * NO se toca `listarCategoriasDisponibles()`: sigue siendo la base completa
 * que usan `FAMILIAS_CATALOGO` / `esFamiliaCanonica()` en catalogo-canonico.js
 * para RESOLVER filas que YA tienen `familia:'sin_clasificar'` (filas viejas,
 * o las que el clasificador dejó así). Sacarla de ahí las volvería "no
 * canónicas" y las mandaría por caminos pensados para categorías propias de
 * una entidad, que es un bug distinto. Esta función es solo para pintar
 * desplegables de elección.
 */
export function categoriasParaElegir(categoriasPersonalizadas = []) {
  return listarCategoriasDisponibles(categoriasPersonalizadas)
    .filter(c => c.codigo !== 'sin_clasificar');
}

/**
 * EL PISO DEL RELLENO cuando la empresa todavía no decidió lo suficiente como
 * para tener «lo que usa de verdad» (ver `candidatosParaIA`, paso 4).
 *
 * NO es una preferencia inventada: es el ranking MEDIDO de `catalogo_insumos`
 * en producción el 15-set-2026 — 484 filas ya clasificadas —, de mayor a menor:
 *   [72] tubería 98 · [37] herramienta manual 68 · administrativos 44 ·
 *   [83] EPP 37 · [65] productos metálicos 36 · [48] maquinaria liviana 29 ·
 *   [02] alambre 29 · [26] clavos 19 · [51] pinturas 18 · [10] agregados 14 ·
 *   [05] aditivos 14 · [43] madera 12 · [21] cemento y [03] acero, que no
 *   lideran el catálogo por FILAS pero sí por plata en las facturas.
 * Se usa solo para completar; nunca desplaza a la evidencia ni a la propuesta
 * local, que van antes.
 */
export const FRECUENTES_POR_DEFECTO = [
  '72', '37', '83', '65', '21', '03', '02', '48', '26', '51', '10', '43', '05', '07',
];

/**
 * LAS POCAS OPCIONES PLAUSIBLES PARA PREGUNTARLE A LA IA (tanda 2, 15-set-2026).
 *
 * EL PROBLEMA: al modelo se le mandaban las 95 clasificaciones enteras en cada
 * pregunta. Eso es ~1.900 tokens de lista por llamada —el grueso del prompt— y,
 * peor que el costo, son 83 formas de irse por las ramas: cuantas más opciones
 * implausibles hay delante, más fácil es que elija una.
 *
 * NO ES UN ALGORITMO NUEVO: el ranking ya se calcula. `evidenciaDiccionario()`
 * recorre el diccionario indexado y le da un puntaje a cada código según cuánto
 * comparte con la descripción. Hasta ahora ese orden se usaba para armar la
 * evidencia y se tiraba. Acá se reusa para armar la lista.
 *
 * QUÉ ENTRA, EN ESTE ORDEN:
 *   1. La propuesta del motor local — si el sistema ya cree algo, esa opción
 *      tiene que estar sí o sí (si no, la IA no puede confirmarla).
 *   2. Los códigos con evidencia, de mayor a menor parecido.
 *   3. Las dos salidas de escape: `servicios` y `administrativos`. Sin ellas el
 *      modelo fuerza un código IUPC sobre algo que no es un insumo de obra —el
 *      error de «LA INMOBILIARIA BCP», que es el interés de un préstamo.
 *   4. Si todavía falta para el mínimo, las más usadas por la empresa
 *      (`frecuentes`), que es lo más probable a falta de toda otra señal.
 *
 * `sin_clasificar` NO entra nunca: no se ofrece como opción (regla 8) y además
 * la validación anti-alucinación del server usa esta misma lista, así que
 * ofrecerla sería habilitar «no sé» con un botón verde al lado.
 */
export function candidatosParaIA(texto, {
  opciones = null, terminosCustom = null, propuestaLocal = null, frecuentes = [],
  categoriasPersonalizadas = [], min = 10, max = 12,
} = {}) {
  // `opciones` es el universo del que se puede elegir — el MISMO que ofrece el
  // desplegable de esa pantalla, con sus clasificaciones propias incluidas. Si
  // no viene, la lista canónica.
  const todas = Array.isArray(opciones) && opciones.length
    ? opciones.filter(c => c && String(c.codigo) !== 'sin_clasificar')
    : categoriasParaElegir(categoriasPersonalizadas);
  const porCodigo = new Map(todas.map(c => [String(c.codigo), c]));
  const elegidos = [];
  const vistos = new Set();
  const sumar = (codigo) => {
    const cod = String(codigo || '').trim();
    if (!cod || vistos.has(cod) || elegidos.length >= max) return;
    const c = porCodigo.get(cod);
    if (!c) return;   // un código que el desplegable no tiene no se ofrece
    vistos.add(cod);
    elegidos.push(c);
  };

  // 1. Lo que ya propuso el motor local.
  if (propuestaLocal?.codigo) sumar(propuestaLocal.codigo);
  // 2. Lo que dice el diccionario, por parecido. Un `maxCodigos` holgado: el
  //    tope real lo pone `max`, y pedir de más acá no cuesta nada (es local).
  for (const g of evidenciaDiccionario(texto, { terminosCustom, maxCodigos: max, maxPorCodigo: 1 })) {
    sumar(g.codigo);
  }
  // 3. Las salidas de escape, siempre — aunque haya que hacerles lugar.
  //    🔴 EL LUGAR SE HACE DE UNA VEZ, ANTES DE AGREGAR NINGUNO. Sacar uno y
  //    agregar uno dentro del mismo bucle hacía que el segundo escape se
  //    llevara puesto al primero (lo último agregado es lo primero que sale),
  //    así que con la lista llena entraba «administrativos» y desaparecía
  //    «servicios» — justo la salida que más se usa.
  const escapes = ['servicios', 'administrativos'].filter(e => !vistos.has(e) && porCodigo.has(e));
  if (escapes.length) {
    const sobran = elegidos.length + escapes.length - max;
    if (sobran > 0) elegidos.splice(elegidos.length - sobran, sobran);  // salen los de menor parecido
    for (const e of escapes) sumar(e);
  }
  // 4. Relleno hasta el mínimo: lo que esta empresa usa de verdad, y si eso no
  //    alcanza, el piso medido del catálogo.
  //
  //    🔴 EL RELLENO NO ES DECORACIÓN, ES LO QUE HACE SEGURO AL RECORTE.
  //    Medido el 15-set-2026 sobre los 32 casos del set de piloto: SIN relleno,
  //    la respuesta correcta se quedaba afuera de la lista en 8 de 32 (25%) —
  //    o sea que el recorte habría fabricado errores nuevos en vez de ahorrar.
  //    Con relleno, sobrevive en 31 de 32.
  for (const cod of [...frecuentes, ...FRECUENTES_POR_DEFECTO]) {
    if (elegidos.length >= min) break;
    sumar(cod);
  }
  return elegidos;
}

const LEGACY_LABELS = {
  tuberia_accesorios: 'Tubería y accesorios',
  ferreteria: 'Material de ferretería',
  valvulas: 'Válvulas',
  seguridad: 'Implementos de seguridad',
  agregados: 'Agregados',
  madera: 'Madera',
  equipos_herramientas: 'Equipos y herramientas',
  perfiles_metalicos: 'Perfiles y estructuras metálicas',
  otros: 'Otros',
  servicios: 'Servicios en general',
  administrativos: 'Consumos administrativos / Oficina',
};

// ── EL NOMBRE DE LAS CLASIFICACIONES PROPIAS (tanda 8, 15-set-2026) ─
//
// EL DEFECTO. `etiquetaCategoria()` se llama en 35 lugares —la bandeja, el
// catálogo, la auditoría, el mapeo— y solo conocía la base oficial: una
// clasificación creada por Gabriel se mostraba como su código pelado
// («PI-PINT-BARN») en todas ellas. Pasarle la lista de propias a las 35
// llamadas sería propagar el mismo argumento por media app.
//
// LA SOLUCIÓN. Un registro chico que `listarCategoriasDisponibles()` llena
// cada vez que se la llama CON las propias — que es lo que hacen las pantallas
// que las tienen a mano. Es una memo idempotente de nombres, no estado de
// React: volver a registrar la misma lista no cambia nada, y una clasificación
// que se borra deja de venir en la lista y deja de registrarse en el próximo
// render. Lo que NO hace es inventar: un código que nadie registró sigue
// devolviéndose tal cual, como antes.
const ETIQUETAS_PROPIAS = new Map();

/** Deja que `etiquetaCategoria()` sepa nombrar las clasificaciones propias. */
export function registrarClasificacionesPropias(lista) {
  for (const c of (lista || [])) {
    if (!c || c.deleted_at || c.activo === false) continue;
    const cod = String(c.codigo || '').trim();
    const nom = String(c.nombre || c.label || '').trim();
    if (!cod || !nom || esCodigoOficial(cod)) continue;
    ETIQUETAS_PROPIAS.set(cod, nom.startsWith('[') ? nom : `[${cod}] ${nom}`);
  }
}

/** Devuelve la etiqueta legible de una categoría cualquiera */
export function etiquetaCategoria(codigo) {
  if (!codigo) return 'Sin categoría';
  const c = String(codigo).trim();
  if (LEGACY_LABELS[c]) return LEGACY_LABELS[c];
  const propia = ETIQUETAS_PROPIAS.get(c);
  if (propia) return propia;
  const serv = SERVICIO_POR_CODIGO.get(c);
  if (serv) return `[${serv.codigo}] ${serv.nombre}`;
  const real = REAGRUPACIONES_IUPC[c] || c;
  const encontradoIupc = IUPC_POR_CODIGO.get(real);
  if (encontradoIupc) {
    return `[${encontradoIupc.codigo}] ${encontradoIupc.nombre}`;
  }
  const compl = CATEGORIAS_COMPLEMENTARIAS.find(k => k.codigo === c);
  if (compl) return compl.nombre;
  if (c.startsWith('custom:')) {
    return c.replace(/^custom:/, '').toUpperCase();
  }
  return c;
}

/**
 * Determina la banda de confianza.
 * Devuelve el objeto completo; `clasificarConIUPC` expone el `.slug` en su
 * campo `banda` (string) y este objeto en `bandaInfo`. Esa separación existe
 * porque mezclar las dos cosas bajo el mismo nombre dejó dos badges pintando
 * el color equivocado: `BADGE[objeto]` es siempre `undefined`.
 */
export function bandaConfianza(score) {
  const s = Number(score) || 0;
  if (s >= 0.70) return { slug: 'alta', label: 'Coincidencia alta', color: 'b-green' };
  if (s >= 0.40) return { slug: 'media', label: 'Coincidencia media', color: 'b-blue' };
  if (s >= 0.25) return { slug: 'baja', label: 'Coincidencia baja', color: 'b-amber' };
  if (s >= 0.10) return { slug: 'rara', label: 'Coincidencia rara', color: 'b-purple' };
  return { slug: 'extrema_baja', label: 'Coincidencia extremadamente baja', color: 'b-red' };
}

/**
 * Detecta si el texto corresponde a un servicio y su inclinación temática.
 * Ejemplo: "Alquiler de retroexcavadora" -> Servicio inclinado a maquinaria pesada [49].
 *
 * ── POR QUÉ LAS REGLAS ESTÁN ANCLADAS ────────────────────────────────
 * La primera versión buscaba las palabras sueltas `instalacion`, `limpieza`,
 * `estudios?` y `servicios?` en cualquier parte del texto. Medido contra
 * descripciones reales de factura, eso convertía MATERIALES en servicios:
 *   «TUBERIA PVC-U 160MM PARA INSTALACION DE ALCANTARILLADO» → servicio
 *   «ESCOBA DE LIMPIEZA INDUSTRIAL»                          → servicio
 *   «KIT DE INSTALACION SANITARIA»                           → servicio
 * En una descripción de factura peruana el sustantivo que manda va al
 * PRINCIPIO. Por eso las palabras ambiguas solo cuentan si encabezan la
 * descripción o si vienen enmarcadas por «servicio de …». Las inequívocas
 * (flete, honorarios, alquiler) siguen valiendo en cualquier posición.
 *
 * ── POR QUÉ CADA RAMA TIENE SU PROPIO SCORE ──────────────────────────
 * Antes todas devolvían 0,85 —banda «alta»— incluida la genérica de último
 * recurso. Con eso la regla MENOS confiable era la que más seguridad
 * aparentaba, y la banda dejaba de servir para lo único que sirve: decirle a
 * la contadora dónde mirar con cuidado. Ahora el score refleja la fuerza de
 * la evidencia y la banda vuelve a significar algo.
 */
/**
 * Normalización que CONSERVA los dos puntos. `normIUPC` los tira, y en
 * «OBRA: REHABILITACION DEL LOCAL ESCOLAR…» los dos puntos son justamente la
 * prueba de que lo que se factura es la obra y no un material «para obra».
 */
const normConDosPuntos = (s) => String(s || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * ¿Lo que se factura ES LA OBRA? (13-set-2026, pedido de Gabriel)
 *
 * Las dos líneas más caras que quedaban en «sin clasificar» en la bandeja de
 * GASOMI eran ésta familia: «OBRA: REHABILITACION DEL LOCAL ESCOLAR N 88389…»
 * (S/ 59.501) y «POR EL SALDO DE TARRAJEO DE LA OBRA: I.E. 040 NUEVA
 * ESPERANZA…» (S/ 44.068). No son un material ni un servicio auxiliar: son la
 * ejecución de una obra contratada, y por eso tienen clasificación propia
 * (S14) en vez de caer en el cajón de «servicios en general».
 *
 * Las reglas están ANCLADAS, por la misma razón que en `detectarServicio`:
 * `\bobra\b` suelto convertiría en «ejecución de obra» a cualquier
 * «CEMENTO PARA OBRA». Hace falta los dos puntos, o el sustantivo pegado a
 * «de (la) obra».
 *
 * @returns {{score:number, motivo:string}|null}
 */
export function detectarEjecucionObra(texto) {
  const n = normConDosPuntos(texto);
  if (!n) return null;

  // «OBRA: …» — el encabezado con el que se factura una obra entera.
  if (/(^|\s)obra\s*:/.test(n)) {
    return { score: 0.92, motivo: 'La descripción encabeza con «OBRA:» — lo que se factura es la obra' };
  }
  // Una valorización es, por definición, avance de obra facturado.
  if (/\bvalorizacion(es)?\b/.test(n)) {
    return { score: 0.90, motivo: 'Es una valorización: avance de obra facturado' };
  }
  // «ejecución / avance / adelanto / liquidación / contrato / saldo DE (LA) OBRA».
  if (/\b(ejecucion|avance|adelanto|liquidacion|contrato|saldo|valorizado) de (la |las |los )?obra/.test(n)) {
    return { score: 0.90, motivo: 'Lo facturado es la ejecución de una obra, no un insumo' };
  }
  // «POR EL SALDO DE … DE LA OBRA» — la forma en que las contratistas del
  // grupo facturan un saldo pendiente de una partida ejecutada.
  if (/^por el saldo de\b/.test(n) && /\bobra\b/.test(n)) {
    return { score: 0.85, motivo: 'Saldo de una partida ejecutada de la obra' };
  }
  if (/\bmetrados? ejecutados?\b/.test(n)) {
    return { score: 0.85, motivo: 'Metrado ejecutado: avance de obra' };
  }
  return null;
}

export function detectarServicio(texto) {
  const n = normIUPC(texto);

  // Enmarcado explícito: «servicio de …» / «servicios de …» / empieza con el verbo.
  const enmarcado = /\bservicios? de\b/.test(n);
  const encabeza = (re) => new RegExp(`^(${re})\\b`).test(n);

  // Inequívocas: valen en cualquier posición del texto.
  const esAlquiler = /\b(alquiler|arrendamiento|alquila)\b/.test(n);
  const esFlete = /\b(flete|acarreo|peaje)\b/.test(n)
    || /\b(transporte|traslado|movilidad) de\b/.test(n)
    || encabeza('transporte|traslado|movilidad');
  const esProfesional = /\b(honorarios?|consultoria|asesoria|supervision|laboratorio|monitoreo|capacitacion)\b/.test(n)
    // 🔴 `topograf` y `arqueolog` son PREFIJOS, no palabras. Estaban adentro
    // de la alternancia de arriba, entre `\b…\b`, así que el `\b` final exigía
    // que la palabra terminara ahí: «topografo» y «arqueologo» —que es como se
    // escriben de verdad en el presupuesto— nunca matcheaban. Medido sobre los
    // 70 insumos más caros de la obra de agua: «TOPOGRAFO» caía en «sin
    // clasificar» por esto.
    || /\b(topograf|arqueolog)/.test(n)
    || /\b(estudios?|ensayos?) de\b/.test(n);

  // Ambiguas: solo si encabezan o vienen enmarcadas por «servicio de».
  const esMantenimiento = /\b(mantenimiento|reparacion|acondicionamiento)\b/.test(n)
    || /\bservicio tecnico\b/.test(n)
    || encabeza('limpieza') || /\bservicios? de limpieza\b/.test(n);
  const esSubcontrato = /\b(subcontrato|sub contrato|mano de obra)\b/.test(n)
    || encabeza('instalacion|montaje|habilitacion')
    || /\bservicios? de (instalacion|montaje|habilitacion)\b/.test(n);
  // «SERVICIOS VARIOS», «SERVICIO DE …» sin más precisión: es un servicio,
  // pero NO es un subcontrato. Va solo al catch-all débil del final.
  const esServicioGenerico = encabeza('servicios?') || enmarcado;

  if (!esAlquiler && !esFlete && !esMantenimiento && !esProfesional
      && !esSubcontrato && !esServicioGenerico) {
    return null;
  }

  // Inclinación a maquinaria pesada o liviana (solo tiene sentido si se alquila).
  if (esAlquiler) {
    if (/\b(retroexcavadora|excavadora|volquete|camion|tractor|cargador|motoniveladora|grua|rodillo)\b/.test(n)) {
      return {
        esServicio: true, categoriaRecomendada: 'servicios', iupcRelacionado: '49',
        score: 0.80,
        inclinacion: 'Alquiler de maquinaria pesada [49]',
        motivo: 'Servicio de alquiler con inclinación a maquinaria pesada (IUPC 49)',
      };
    }
    if (/\b(mezcladora|trompo|vibrador|cortadora|motobomba|generador|soldadora|compresor|andamio)\b/.test(n)) {
      return {
        esServicio: true, categoriaRecomendada: 'servicios', iupcRelacionado: '48',
        score: 0.80,
        inclinacion: 'Alquiler de equipo liviano [48]',
        motivo: 'Servicio de alquiler con inclinación a equipo liviano (IUPC 48)',
      };
    }
    return {
      esServicio: true, categoriaRecomendada: 'servicios', iupcRelacionado: null,
      score: 0.62,
      inclinacion: 'Alquiler (equipo sin identificar)',
      motivo: 'Servicio de alquiler, sin equipo reconocido en el texto',
    };
  }

  if (esFlete) {
    return {
      esServicio: true, categoriaRecomendada: 'servicios', iupcRelacionado: '32',
      score: 0.78,
      inclinacion: 'Flete / Transporte [32]',
      motivo: 'Servicio de transporte o flete',
    };
  }

  if (esProfesional) {
    return {
      esServicio: true, categoriaRecomendada: 'servicios', iupcRelacionado: null,
      score: 0.75,
      inclinacion: 'Servicio profesional',
      motivo: 'Honorarios, consultoría, supervisión o ensayo',
    };
  }

  if (esSubcontrato) {
    return {
      esServicio: true, categoriaRecomendada: 'servicios', iupcRelacionado: null,
      score: 0.70,
      inclinacion: 'Subcontrato / mano de obra',
      motivo: 'Subcontrato, instalación o mano de obra',
    };
  }

  if (esMantenimiento) {
    return {
      esServicio: true, categoriaRecomendada: 'servicios', iupcRelacionado: null,
      score: 0.66,
      inclinacion: 'Mantenimiento / reparación',
      motivo: 'Servicio de mantenimiento o reparación',
    };
  }

  // Último recurso: dice «servicio de …» y nada más lo precisa. Es una pista
  // débil y el score lo dice — cae en banda «media/baja», no en «alta».
  return {
    esServicio: true, categoriaRecomendada: 'servicios', iupcRelacionado: null,
    score: 0.38,
    inclinacion: 'Servicio general',
    motivo: 'Enmarcado como «servicio de …», sin más precisión en el texto',
  };
}

/** Arma la respuesta del clasificador con la banda SIEMPRE coherente. */
function recIUPC({ codigo, nombre, score, motivos, inclinacion = null, iupcRelacionado = null, capa = null }) {
  const info = bandaConfianza(score);
  return {
    categoria: codigo,
    codigo,
    nombre,
    score,
    banda: info.slug,   // string — es lo que indexan los badges y los filtros
    bandaInfo: info,    // objeto {slug,label,color} para quien necesite el detalle
    motivos,
    inclinacion,
    iupcRelacionado,
    // DE QUÉ CAPA SALIÓ ESTA RESPUESTA (tanda 3). Las dos intocables —lo que
    // alguien escribió a mano y la coincidencia exacta con el Anexo 2— se
    // marcan acá para que las reglas de desempate no las pisen. Ver el
    // encabezado de `desempates-iupc.js`.
    capa,
  };
}

/**
 * Similitud por tokens entre una descripción y una entrada de diccionario.
 * El prefijo compartido tiene que ser la MAYOR PARTE de la palabra larga: sin
 * esa condición «conocida» pegaba con «cono» (cono de seguridad, IUPC 83) y una
 * descripción sin ninguna relación terminaba clasificada como EPP. 0,6 deja
 * pasar plurales y variantes («tuberia»/«tuberias») y corta el resto.
 */
function prefijoEquivalente(t, u) {
  const [corto, largo] = t.length <= u.length ? [t, u] : [u, t];
  return corto.length >= 4 && largo.startsWith(corto)
    && (corto.length / largo.length) >= 0.6;
}

/** ¿Son la misma palabra para el clasificador? (igual, plural o variante). */
function tokensEquivalentes(t, u) {
  return t === u || prefijoEquivalente(t, u);
}

function simTokens(toks, itoks) {
  if (!itoks.length || !toks.length) return 0;
  let comun = 0;
  for (const t of toks) {
    if (itoks.includes(t)) {
      comun += (t === toks[0] && t === itoks[0]) ? 2 : 1;
    } else {
      const pref = itoks.some(u => prefijoEquivalente(t, u));
      if (pref) comun += 0.8;
    }
  }
  return (2 * comun) / (toks.length + itoks.length);
}

/** El mejor candidato de un diccionario indexado, con su score. */
function mejorDe(toks, indexado) {
  let mejor = null, max = 0;
  for (const item of indexado) {
    const sim = simTokens(toks, item.tokens);
    if (sim > max) { max = sim; mejor = item; }
  }
  return { item: mejor, score: max };
}

/** Índice O(1) de coincidencias exactas del diccionario oficial. */
const DICCIONARIO_EXACTO = new Map();
for (const item of DICCIONARIO_INDEXADO) {
  if (!DICCIONARIO_EXACTO.has(item.norm)) DICCIONARIO_EXACTO.set(item.norm, item);
}

const DICCIONARIO_SERVICIOS_EXACTO = new Map();
for (const item of DICCIONARIO_SERVICIOS_INDEXADO) {
  if (!DICCIONARIO_SERVICIOS_EXACTO.has(item.norm)) DICCIONARIO_SERVICIOS_EXACTO.set(item.norm, item);
}

/**
 * LO QUE EL DICCIONARIO OFICIAL DICE SOBRE ESTE TEXTO (15-sep-2026).
 *
 * EL DEFECTO, CONTADO POR GABRIEL: «veo una barbaridad de errores en las
 * recomendaciones de la IA, y creo que hace las recomendaciones sin base en
 * los índices unificados y el diccionario que propone el Estado peruano».
 * Tenía razón y era literal: al modelo se le mandaban los 95 códigos con su
 * NOMBRE y nada más. Sin el Anexo 2 a la vista, "ALAMBRE DE AMARRE #8" le
 * salía [48] Maquinaria liviana, cuando el diccionario tiene los alambres
 * bajo acero; y el motor local —que sí lee el Anexo 2— acertaba.
 *
 * Esto arma la EVIDENCIA que hay que ponerle delante: los términos del
 * diccionario que comparten palabras con la descripción, agrupados por el
 * código al que apuntan y ordenados por qué tanto se parecen. Es el mismo
 * índice con el que decide `clasificarConIUPC`, así que la IA discute contra
 * la norma en vez de contra su memoria.
 *
 * 🔴 DOS BOLSAS SEPARADAS (tanda 1, 15-set-2026), porque no tienen la misma
 * autoridad y el prompt las presenta distinto:
 *   · `terminos` — la LEY: Anexo 2 del INEI y el árbol de servicios.
 *   · `propios`  — el diccionario de la empresa, aprendido de decisiones.
 *     Puede tener errores; es una pista, no la norma. Los de origen 'ia' se
 *     excluyen: devolvérselos al modelo es pedirle que discuta consigo mismo.
 *
 * Exige compartir una palabra de 4 letras o más: con tokens de 2-3 letras
 * ("de", "x", "8") matchearía medio diccionario y la evidencia sería ruido.
 */
export function evidenciaDiccionario(texto, { terminosCustom = null, maxCodigos = 10, maxPorCodigo = 6 } = {}) {
  const toks = tokensDeTexto(normIUPC(texto));
  if (!toks.length) return [];
  const fuertes = new Set(toks.filter(t => t.length >= 4));
  if (!fuertes.size) return [];

  const porCodigo = new Map();
  const mirar = (item, codigo, capa) => {
    if (!codigo) return;
    // Al menos una palabra larga en común: si no, no es evidencia de nada.
    if (!item.tokens.some(t => fuertes.has(t))) return;
    // Un término propio, además, tiene que compartir SU palabra distintiva
    // (ver `compartePalabraDistintiva`): «MATERIAL SARANDEADO» no es
    // evidencia de nada para «MATERIAL DE OFICINA».
    if (capa === 'propio' && !compartePalabraDistintiva(toks, item)) return;
    const score = simTokens(toks, item.tokens);
    if (score <= 0) return;
    const prev = porCodigo.get(codigo) || { codigo, score: 0, norma: [], propios: [] };
    prev.score = Math.max(prev.score, score);
    (capa === 'norma' ? prev.norma : prev.propios).push({ termino: item.nombre, score });
    porCodigo.set(codigo, prev);
  };

  for (const it of DICCIONARIO_INDEXADO) mirar(it, REAGRUPACIONES_IUPC[it.iupc] || it.iupc, 'norma');
  for (const it of DICCIONARIO_SERVICIOS_INDEXADO) mirar(it, it.cod, 'norma');
  // 🔴 Los términos de la empresa van en SU PROPIA bolsa (tanda 1). Antes se
  //    mezclaban con los del Anexo 2 y el prompt los presentaba a todos como
  //    «EVIDENCIA DEL DICCIONARIO OFICIAL» — la IA leía lo que ella misma
  //    había propuesto ayer como si fuera la R.J. 016-2026.
  //    Los de origen 'ia' no entran ni acá: mandárselos de vuelta a la IA es
  //    pedirle que discuta contra su propia respuesta vieja.
  for (const it of indexarCustom(terminosCustom).lista) {
    if (it.origen === 'ia') continue;
    mirar(it, it.cod, 'propio');
  }

  const primeros = (arr) => arr
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPorCodigo)
    .map(t => t.termino);

  return [...porCodigo.values()]
    .sort((a, b) => b.score - a.score
      || (b.norma.length + b.propios.length) - (a.norma.length + a.propios.length))
    .slice(0, maxCodigos)
    .map(g => ({
      codigo: g.codigo,
      score: g.score,
      terminos: primeros(g.norma),
      propios: primeros(g.propios),
    }));
}

/**
 * ¿El código pertenece a la base oficial que viaja en el bundle?
 * Es lo que una clasificación propia NO puede pisar: si lo hiciera, una fila
 * del catálogo apuntaría a dos clasificaciones distintas según qué capa gane.
 */
export function esCodigoOficial(codigo) {
  const c = String(codigo || '').trim();
  if (!c) return false;
  return IUPC_POR_CODIGO.has(c)
    || Object.prototype.hasOwnProperty.call(REAGRUPACIONES_IUPC, c)
    || esCodigoServicio(c)
    || CATEGORIAS_COMPLEMENTARIAS.some(k => k.codigo === c);
}

/**
 * El código que se le propone a una clasificación nueva, a partir del nombre.
 * Va prefijado con la letra del árbol para que NUNCA choque con el espacio de
 * la base oficial: el IUPC usa '01'..'95' y los servicios 'S01'..'S13'. Si un
 * código propio pisara uno de esos, la fila del catálogo quedaría apuntando a
 * dos cosas distintas según qué capa gane al resolver.
 */
export function codigoSugerido(nombre, arbol = 'insumo') {
  const base = normIUPC(nombre).split(' ').filter(Boolean).slice(0, 2)
    .map(w => w.slice(0, 4)).join('-').toUpperCase();
  const pre = arbol === 'servicio' ? 'PS' : 'PI';   // Propia-Insumo / Propia-Servicio
  return `${pre}-${base || 'NUEVA'}`;
}

/** Qué está mal en una clasificación nueva, o null si está bien. */
export function validarClasificacion({ codigo, nombre }, existentes = []) {
  const cod = String(codigo || '').trim();
  const nom = String(nombre || '').trim();
  if (!nom) return 'Ponele un nombre.';
  if (!cod) return 'Ponele un código.';
  if (/\s/.test(cod)) return 'El código no puede llevar espacios.';
  // No pisar la base oficial: si el código ya existe ahí, la fila del catálogo
  // quedaría apuntando a dos clasificaciones distintas.
  if (esCodigoOficial(cod)) return `El código «${cod}» ya es de la base oficial. Elegí otro.`;
  if ((existentes || []).some(c => !c.deleted_at && c.codigo === cod)) {
    return `Ya existe una clasificación con el código «${cod}».`;
  }
  return null;
}

/** La respuesta para un código del árbol de servicios. */
function recServicio({ cod, score, motivos, inclinacion = null, capa = null }) {
  const info = SERVICIO_POR_CODIGO.get(cod);
  return recIUPC({
    codigo: cod,
    nombre: info?.nombre || 'Servicio',
    score,
    motivos,
    inclinacion,
    iupcRelacionado: info?.iupcRelacionado || null,
    capa,
  });
}

// El diccionario propio (tabla `clasificacion_terminos`) se indexa una vez por
// array: `filasDeBandeja` clasifica cientos de descripciones seguidas con la
// MISMA lista, y re-tokenizarla en cada una sería tirar el trabajo a la basura.
// WeakMap para que se libere sola cuando el hook devuelve un array nuevo.
//
// 🔴 DOS BOLSAS, NO UNA (tanda 1, 15-set-2026). Hasta acá todos los términos
// propios se trataban igual y le ganaban al Anexo 2 con score 0,99. Medido en
// producción: de 368 términos vivos, 365 eran HUÉRFANOS —quedaron de
// decisiones que Gabriel después deshizo— y ~70 estaban mal («CUSQUEÑA» →
// [21] Cemento). O sea que el error de ayer pisaba la R.J. 016-2026 hoy.
//   · `manual`    — lo escribió una persona en el panel de Clasificaciones. Es
//                   una corrección deliberada sobre la norma y sigue ganándole.
//   · `aprendido` — lo dejó una decisión de la bandeja o un recorrido con IA.
//                   Vale, pero DESPUÉS de la ley (ver `clasificarConIUPC`).
// `origen` puede faltar (filas anteriores a la mig 212): se leen como
// aprendidas, que es el lado conservador.
// Cuánto tiene que sacarle un término aprendido a la norma para pisarla
// (paso 5b de `clasificarConIUPC`). 0,15 de similitud de tokens es, en la
// práctica, una palabra más en común sobre una descripción corta.
const VENTAJA_APRENDIDO = 0.15;

const _cacheCustom = new WeakMap();
const CUSTOM_VACIO = {
  manual: { exacto: new Map(), lista: [] },
  aprendido: { exacto: new Map(), lista: [] },
  lista: [],
};
function indexarCustom(terminos) {
  if (!Array.isArray(terminos) || !terminos.length) return CUSTOM_VACIO;
  const hit = _cacheCustom.get(terminos);
  if (hit) return hit;
  const idx = {
    manual: { exacto: new Map(), lista: [] },
    aprendido: { exacto: new Map(), lista: [] },
    lista: [],
  };
  for (const t of terminos) {
    if (!t || t.deleted_at || !t.termino || !t.clasificacion_codigo) continue;
    const norm = t.norm || normIUPC(t.termino);
    if (!norm) continue;
    const origen = t.origen === 'manual' ? 'manual' : (t.origen === 'ia' ? 'ia' : 'decision');
    const item = { nombre: t.termino, cod: String(t.clasificacion_codigo), norm, tokens: tokensDeTexto(norm), origen };
    const bolsa = origen === 'manual' ? idx.manual : idx.aprendido;
    bolsa.lista.push(item);
    if (!bolsa.exacto.has(norm)) bolsa.exacto.set(norm, item);
    idx.lista.push(item);
  }
  marcarDistintivas(idx.lista);
  _cacheCustom.set(terminos, idx);
  return idx;
}

// ── UNA PALABRA GENÉRICA NO DECIDE SOLA (ronda 2 del simulador, tanda 2.1) ──
//
// EL DEFECTO, MEDIDO EL 24-SET-2026: Gabriel cargó a mano «MATERIAL SARANDEADO
// → [04] Agregado fino», que es correcto. Pero `simTokens` le daba a la
// palabra «material» —la primera del término y la primera de cientos de
// descripciones— el doble de peso, y con eso sola alcanzaba: «MATERIAL DE
// OFICINA Y CAMPO» salía [04] con 80 % y «MATERIAL ELÉCTRICO» también. El
// término está bien; lo que estaba mal es que se pudiera ganar un parecido
// sin tocar la palabra que lo hace ser ese término.
//
// LA REGLA: un parecido (no exacto) con un término PROPIO —manual o
// aprendido— solo cuenta si la descripción comparte la palabra MÁS
// DISTINTIVA del término. «Distintiva» no es una lista a mano: es la de menor
// frecuencia en todo el vocabulario (Anexo 2 + árbol de servicios + el propio
// diccionario de la empresa), contando plurales y variantes como la misma
// palabra. «sarandeado» aparece una vez; «material» aparece en el Anexo 2, en
// los servicios y en el diccionario propio. Si hay empate en la mínima, vale
// cualquiera de las empatadas.
//
// Los números y las palabras de menos de 4 letras no pueden ser la
// distintiva («ALAMBRE NEGRO # 16»: un calibre distinto sigue siendo alambre).
// Un término que no tiene otra cosa solo vale como coincidencia exacta.
//
// Lo que NO cambia: los exactos (manual, Anexo 2, aprendido) y la búsqueda
// contra el Anexo 2, que no pasa por acá. Es una restricción solo sobre el
// diccionario de la empresa.

/** Frecuencia de cada palabra en el vocabulario oficial (se calcula una vez). */
let _dfOficial = null;
function dfOficial() {
  if (_dfOficial) return _dfOficial;
  _dfOficial = new Map();
  for (const it of [...DICCIONARIO_INDEXADO, ...DICCIONARIO_SERVICIOS_INDEXADO]) {
    for (const t of new Set(it.tokens)) _dfOficial.set(t, (_dfOficial.get(t) || 0) + 1);
  }
  return _dfOficial;
}

/** En cuántas entradas aparece la palabra (o una variante suya). */
function frecuenciaEn(df, t) {
  let n = df.get(t) || 0;
  if (t.length < 4) return n;
  for (const [u, c] of df) if (u !== t && prefijoEquivalente(t, u)) n += c;
  return n;
}

const puedeSerDistintiva = (t) => t.length >= 4 && !/\d/.test(t);

/** Le pone a cada término propio sus palabras distintivas (`item.distintivas`). */
function marcarDistintivas(lista) {
  const dfPropio = new Map();
  for (const it of lista) for (const t of new Set(it.tokens)) dfPropio.set(t, (dfPropio.get(t) || 0) + 1);
  const oficial = dfOficial();
  const memo = new Map();
  const frecuencia = (t) => {
    if (!memo.has(t)) memo.set(t, frecuenciaEn(oficial, t) + frecuenciaEn(dfPropio, t));
    return memo.get(t);
  };
  for (const it of lista) {
    const candidatas = it.tokens.filter(puedeSerDistintiva);
    // Sin ninguna palabra («2 x 6 x 3», «TIPO 1») el término no tiene nada
    // que lo distinga: vale solo como coincidencia exacta. Medido: «2 x 6 x 3»
    // → [51] se llevaba «BISAGRA HECHIZA 3/8 X 2' X 2 ALAS» por el «2».
    if (!candidatas.length) { it.distintivas = []; continue; }
    const min = Math.min(...candidatas.map(frecuencia));
    it.distintivas = candidatas.filter(t => frecuencia(t) === min);
  }
}

/** ¿La descripción comparte la palabra que hace ser a este término ese término? */
function compartePalabraDistintiva(toks, item) {
  if (!item.distintivas) return true;
  return item.distintivas.some(d => toks.some(t => tokensEquivalentes(t, d)));
}

/** `mejorDe` para el diccionario propio: descarta los parecidos por palabra genérica. */
function mejorDePropio(toks, lista) {
  let mejor = null, max = 0;
  for (const item of lista) {
    if (!compartePalabraDistintiva(toks, item)) continue;
    const sim = simTokens(toks, item.tokens);
    if (sim > max) { max = sim; mejor = item; }
  }
  return { item: mejor, score: max };
}

/**
 * Clasificador universal con 100% de cobertura predictiva.
 * Siempre retorna una recomendación con categoría, código IUPC/complementario,
 * score numérico, banda de probabilidad (slug) y motivos explicativos.
 *
 * ORDEN DE PRECEDENCIA (importa): el Diccionario Oficial va PRIMERO. Antes la
 * detección de servicios corría antes que todo y le ganaba a una coincidencia
 * exacta del Anexo 2 de la norma — o sea, la heurística de la casa le ganaba
 * al texto de la R.J. 016-2026-INEI. Al revés es lo correcto.
 */
function clasificarBaseIUPC(texto, { terminosCustom = null } = {}) {
  const norm = normIUPC(texto);
  if (!norm) {
    return recIUPC({
      codigo: 'servicios', nombre: 'Servicios en general', score: 0.05,
      motivos: ['Sin texto suficiente, asignado preventivo a servicios'],
    });
  }

  // 0. EL TÉRMINO QUE UNA PERSONA ESCRIBIÓ A MANO MANDA SOBRE TODO LO DEMÁS.
  //    Si alguien se tomó el trabajo de decir «‹cemento cabezón› es el IUPC
  //    21» desde el panel de Clasificaciones, esa decisión no la puede pisar
  //    una heurística. Va antes incluso que el Anexo 2, porque es una
  //    corrección deliberada sobre él.
  //    🔴 SOLO los `origen: 'manual'` (tanda 1). Los que dejó una decisión de
  //    la bandeja o un recorrido con IA son PROVISIONALES y entran más abajo,
  //    después de la ley — ver el encabezado de `indexarCustom`.
  const custom = indexarCustom(terminosCustom);
  const exactoManual = custom.manual.exacto.get(norm);
  if (exactoManual) {
    return recIUPC({
      codigo: exactoManual.cod,
      nombre: etiquetaCategoria(exactoManual.cod),
      score: 0.99,
      motivos: [`«${exactoManual.nombre}» está en el diccionario que agregaste a mano`],
      capa: 'manual',
    });
  }

  // 1. Coincidencia EXACTA con el Diccionario Oficial INEI (Anexo 2). Manda.
  const exacto = DICCIONARIO_EXACTO.get(norm);
  if (exacto) {
    const real = REAGRUPACIONES_IUPC[exacto.iupc] || exacto.iupc;
    const info = IUPC_POR_CODIGO.get(real);
    return recIUPC({
      codigo: real,
      nombre: info?.nombre || exacto.nombre,
      score: 0.98,
      motivos: [`Coincidencia exacta con «${exacto.nombre}» en Diccionario Oficial INEI (IUPC ${real})`],
      capa: 'oficial-exacto',
    });
  }

  // 2. Exacto en el diccionario del árbol de SERVICIOS
  const exactoServ = DICCIONARIO_SERVICIOS_EXACTO.get(norm);
  if (exactoServ) {
    return recServicio({
      cod: exactoServ.cod,
      score: 0.98,
      motivos: [`Coincidencia exacta con «${exactoServ.nombre}» en el diccionario de servicios`],
      capa: 'oficial-exacto',
    });
  }

  // 2-bis. EXACTO EN EL DICCIONARIO APRENDIDO — la misma descripción, palabra
  //     por palabra, ya la decidió alguien en la bandeja. Vale, y por eso está
  //     alto; pero va DESPUÉS de los exactos de la norma (0,98) a propósito:
  //     si el Anexo 2 tiene esa misma frase, manda el Anexo 2. Es toda la
  //     diferencia entre «aprende» y «se envenena».
  const exactoAprendido = custom.aprendido.exacto.get(norm);
  if (exactoAprendido) {
    return recIUPC({
      codigo: exactoAprendido.cod,
      nombre: etiquetaCategoria(exactoAprendido.cod),
      score: 0.96,
      motivos: [`Ya se decidió «${exactoAprendido.nombre}» así antes (diccionario de la empresa, no es la norma)`],
    });
  }

  // 2a. ¿LO QUE SE FACTURA ES LA OBRA? Va antes de los parecidos porque es una
  //     regla dura: «OBRA: REHABILITACION…» no se parece a un material, ES
  //     otra cosa. Después del diccionario propio y de los exactos, para que
  //     una corrección deliberada de Gabriel siga pisando.
  const ejecObra = detectarEjecucionObra(texto);
  if (ejecObra) {
    return recServicio({ cod: 'S14', score: ejecObra.score, motivos: [ejecObra.motivo] });
  }

  const toks = tokensDeTexto(norm);

  // 2b. Parecido fuerte a un término escrito A MANO: también gana, con el
  //     mismo criterio — es vocabulario que alguien cargó deliberadamente.
  //     El parecido a un término APRENDIDO no entra acá: compite contra la
  //     norma más abajo (paso 5b), no antes que ella.
  if (custom.manual.lista.length) {
    const mc = mejorDePropio(toks, custom.manual.lista);
    if (mc.item && mc.score >= 0.55) {
      return recIUPC({
        codigo: mc.item.cod,
        nombre: etiquetaCategoria(mc.item.cod),
        score: Math.min(0.97, Math.round(mc.score * 100) / 100),
        motivos: [`Similar a «${mc.item.nombre}», del diccionario que agregaste a mano`],
        capa: 'manual',
      });
    }
  }

  // 3. ¿Tiene FORMA de servicio? Si sí, se refina con el diccionario de
  //    servicios para decir CUÁL, en vez de tirarlo al cajón «Servicios en
  //    general» — que es lo que hacía antes y perdía justo lo que la contadora
  //    necesita distinguir.
  const servicio = detectarServicio(norm);
  if (servicio) {
    const m = mejorDe(toks, DICCIONARIO_SERVICIOS_INDEXADO);
    if (m.item && m.score >= 0.30) {
      return recServicio({
        cod: m.item.cod,
        score: Math.min(0.95, Math.max(servicio.score, Math.round(m.score * 100) / 100)),
        motivos: [`${servicio.motivo}; similar a «${m.item.nombre}»`],
        inclinacion: servicio.inclinacion,
      });
    }
    // Es un servicio pero no se sabe de qué tipo: se dice así.
    return recIUPC({
      codigo: 'servicios',
      nombre: 'Servicios en general',
      score: servicio.score,
      motivos: [servicio.motivo],
      inclinacion: servicio.inclinacion,
      iupcRelacionado: servicio.iupcRelacionado,
    });
  }

  // 4. Un servicio que NO tiene forma de tal pero está en el diccionario.
  //    «EXAMENES MEDICOS OCUPACIONALES» no dice «servicio» ni «alquiler» en
  //    ninguna parte: sin este paso caía en el diccionario de materiales.
  const mServ = mejorDe(toks, DICCIONARIO_SERVICIOS_INDEXADO);
  if (mServ.item && mServ.score >= 0.55) {
    return recServicio({
      cod: mServ.item.cod,
      score: Math.min(0.95, Math.round(mServ.score * 100) / 100),
      motivos: [`Similar a «${mServ.item.nombre}» en el diccionario de servicios`],
    });
  }

  // 5. Búsqueda por tokens en el Diccionario Oficial INEI
  let mejorMatch = null;
  let maxScore = 0;
  let mejorMotivo = '';

  const mIupc = mejorDe(toks, DICCIONARIO_INDEXADO);
  if (mIupc.item) {
    maxScore = mIupc.score;
    mejorMatch = { ...mIupc.item, iupc: REAGRUPACIONES_IUPC[mIupc.item.iupc] || mIupc.item.iupc };
    mejorMotivo = `Similar a «${mIupc.item.nombre}» en Diccionario Oficial INEI`;
  }

  // 5b. PARECIDO A ALGO YA DECIDIDO (diccionario aprendido) — acá, no antes.
  //     Tiene que ganarle a la norma para pisarla, y por eso hay handicap:
  //     entra solo si el Anexo 2 no llegó a su propio umbral (0,35) o si le
  //     saca una ventaja clara. Sin el handicap volvemos al circuito de
  //     realimentación que dejó «PL. GALV. 0.80» en petróleo diésel: un
  //     parecido flojo con un término mal aprendido tapaba una coincidencia
  //     buena de la R.J. 016-2026.
  if (custom.aprendido.lista.length) {
    const ma = mejorDePropio(toks, custom.aprendido.lista);
    if (ma.item && ma.score >= 0.55 && (maxScore < 0.35 || ma.score >= maxScore + VENTAJA_APRENDIDO)) {
      return recIUPC({
        codigo: ma.item.cod,
        nombre: etiquetaCategoria(ma.item.cod),
        score: Math.min(0.85, Math.round(ma.score * 100) / 100),
        motivos: [`Similar a «${ma.item.nombre}», que ya se decidió así (diccionario de la empresa, no es la norma)`],
      });
    }
  }

  // 6. Si hubo buen match en Diccionario INEI
  if (mejorMatch && maxScore >= 0.35) {
    const info = IUPC_POR_CODIGO.get(mejorMatch.iupc);
    const scoreAjustado = Math.min(0.95, Math.round(maxScore * 100) / 100);
    return recIUPC({
      codigo: mejorMatch.iupc,
      nombre: info?.nombre || mejorMatch.nombre,
      score: scoreAjustado,
      motivos: [mejorMotivo],
    });
  }

  // 7. Búsqueda contra los nombres directos de los Códigos IUPC
  for (const c of IUPC_CODIGOS) {
    const cNorm = normIUPC(c.nombre);
    const cToks = tokensDeTexto(cNorm);
    let comun = 0;
    for (const t of toks) {
      if (cToks.includes(t)) comun++;
    }
    if (comun > 0) {
      const sim = (2 * comun) / (toks.length + cToks.length);
      if (sim > maxScore) {
        maxScore = sim;
        mejorMatch = { nombre: c.nombre, iupc: c.codigo };
        mejorMotivo = `Coincide con concepto de IUPC [${c.codigo}] ${c.nombre}`;
      }
    }
  }

  // Piso de evidencia: por debajo de 0,15 el «parecido» es ruido de un token
  // suelto. Antes se devolvía igual con el score inflado a 0,12 por un
  // `Math.max`, o sea que una coincidencia de 0,02 se presentaba como banda
  // «rara» en vez de admitir que no hay nada.
  if (mejorMatch && maxScore >= 0.15) {
    const info = IUPC_POR_CODIGO.get(mejorMatch.iupc);
    const scoreFinal = Math.min(0.85, Math.round(maxScore * 100) / 100);
    return recIUPC({
      codigo: mejorMatch.iupc,
      nombre: info?.nombre || mejorMatch.nombre,
      score: scoreFinal,
      motivos: [mejorMotivo],
    });
  }

  // 6. Fallback con cobertura 100%: ningún insumo queda sin recomendación,
  //    pero con un score que dice honestamente que es una pista débil.
  if (/\b(papel|lapiz|cuaderno|archivador|toner|tinta|impresion|folder|escritorio|silla)\b/.test(norm)) {
    return recIUPC({
      codigo: 'administrativos',
      nombre: 'Consumos administrativos / Oficina',
      score: 0.32,
      motivos: ['Vocabulario típico de suministros administrativos y de oficina'],
    });
  }

  if (/\b(seguro|poliza|almuerzo|comida|refrigerio|hospedaje|alojamiento|pasaje)\b/.test(norm)) {
    return recIUPC({
      codigo: 'servicios',
      nombre: 'Servicios en general',
      score: 0.28,
      motivos: ['Gasto operacional / servicio auxiliar'],
    });
  }

  // Última pista por familia de material, cuando el texto la deja ver.
  const fallbackIupc = /\b(acero|fierro|metal)\b/.test(norm) ? '03'
    : /\b(tubo|tuberia|pvc)\b/.test(norm) ? '72'
    : /\b(madera|tabla)\b/.test(norm) ? '43'
    : /\b(pintura|color)\b/.test(norm) ? '54'
    : null;

  if (fallbackIupc) {
    return recIUPC({
      codigo: fallbackIupc,
      nombre: IUPC_POR_CODIGO.get(fallbackIupc)?.nombre || 'Sin clasificar',
      score: 0.12, // banda «rara»: es una pista de una palabra, nada más
      motivos: ['Asociación tentativa por familia de material, sin coincidencia léxica directa'],
    });
  }

  // Cobertura 100%, sin inventar: la recomendación es «no sé, mirala».
  return recIUPC({
    codigo: 'sin_clasificar',
    nombre: 'Sin clasificar — revisar a mano',
    score: 0.05,
    motivos: ['Sin coincidencia en el Diccionario Oficial ni en los conceptos IUPC'],
  });
}

/**
 * EL CLASIFICADOR, con las reglas de desempate encima (tanda 3, 15-set-2026).
 *
 * `clasificarBaseIUPC` hace el trabajo de siempre —manual, Anexo 2, servicios,
 * aprendido, parecidos— y acá se le da una última pasada por los SEIS PARES
 * DIFÍCILES: los pares donde el parecido de palabras se equivoca siempre en la
 * misma dirección porque la descripción nombra el material y no la cosa.
 *
 * Medido el 15-set-2026 contra los 32 casos reales de
 * `scripts/piloto/set-clasificacion.json`: el motor local pasa de **19 a 30**
 * respuestas aceptables. Las reglas y su evidencia están en
 * `desempates-iupc.js`; no se tocan desde acá.
 *
 * Lo que NO pisan: un término escrito a mano en el panel y una coincidencia
 * exacta del Anexo 2 (`capa: 'manual' | 'oficial-exacto'`). Esa es la misma
 * jerarquía de tres capas de la tanda 1 — la ley primero, la corrección
 * deliberada por encima de todo.
 */
export function clasificarConIUPC(texto, { terminosCustom = null } = {}) {
  const rec = clasificarBaseIUPC(texto, { terminosCustom });
  const d = desempateDe(texto, { codigoActual: rec.codigo, capa: rec.capa });
  if (!d) return rec;
  // El score no es el de la regla sino el que tenía la respuesta que se
  // corrige, con un piso: una regla de desempate es evidencia dura (la
  // descripción dice «HDPE»), así que no puede quedar en banda «rara» y pasar
  // desapercibida. Tope en 0,90: sigue sin ser una coincidencia exacta.
  const score = Math.min(0.9, Math.max(0.6, rec.score || 0));
  const info = IUPC_POR_CODIGO.get(REAGRUPACIONES_IUPC[d.codigo] || d.codigo);
  return recIUPC({
    codigo: d.codigo,
    nombre: info?.nombre || etiquetaCategoria(d.codigo).replace(/^\[[^\]]+\]\s*/, ''),
    score,
    motivos: [d.motivo, `Regla de desempate: ${d.par}`],
    capa: 'desempate',
  });
}

// ── EL PUENTE AL VOCABULARIO DE GASTO DE LA CONTADORA ───────────────
//
// `CATEGORIAS_ITEM` (src/lib/clasificar-items.js) es el vocabulario con el que
// la contadora agrupa el gasto. Los `tipo` del IUPC no son los mismos, y el
// mapeo tiene que ser explícito: sin esto, los fletes (32/33/92/93), la
// maquinaria (48/49/95), la mano de obra (47) y los índices financieros
// (30/39) caían todos en «materiales» por defecto — que es exactamente el
// error que la contadora vería en su reporte de costos.
const GASTO_POR_TIPO = {
  material: 'materiales',
  herramienta: 'herramientas',
  epp: 'epp',
  maquinaria: 'maquinaria',
  servicio: 'servicios',
  mano_obra: 'gastos_generales',
  financiero: 'gastos_generales',
};

/** El `tipo` de una categoría cualquiera (IUPC, complementaria o personalizada). */
export function tipoDeCategoria(codigo) {
  if (!codigo) return 'material';
  const c = String(codigo).trim();
  if (esCodigoServicio(c)) return 'servicio';
  const real = REAGRUPACIONES_IUPC[c] || c;
  const iupc = IUPC_POR_CODIGO.get(real);
  if (iupc) return iupc.tipo || 'material';
  const compl = CATEGORIAS_COMPLEMENTARIAS.find(k => k.codigo === c);
  if (compl) return compl.tipo || 'material';
  return 'material';
}

/** La categoría de GASTO (vocabulario de la contadora) de una categoría IUPC. */
export function gastoDeCategoria(codigo) {
  const c = String(codigo || '').trim();
  // Las complementarias tienen destino propio: «administrativos» es gasto
  // general aunque su `tipo` sea material (papel, tóner, sillas).
  const serv = SERVICIO_POR_CODIGO.get(c);
  if (serv) return serv.gasto || 'servicios';
  if (c === 'administrativos') return 'gastos_generales';
  if (c === 'servicios') return 'servicios';
  // Sin clasificar no es «materiales»: es «otros», que es la verdad y además
  // lo deja visible en el reporte de la contadora en vez de disolverlo.
  if (c === 'sin_clasificar') return 'otros';
  return GASTO_POR_TIPO[tipoDeCategoria(c)] || 'otros';
}

// ── EL TERCER PUENTE: A QUÉ PROVEEDOR SE LE COMPRA ──────────────────
//
// Gabriel, 22-set-2026, mirando una orden del simulador con 58 líneas que
// mezclaban exámenes médicos, monitoreos, gigantografías y cemento: «si no,
// vamos a generar una orden con cosas súper mezcladas, que es ilógico. Lo
// ideal sería tener agrupado cosas que se relacionan, por ejemplo órdenes de
// compra de cemento con sus aditivos, o [malla cercadora, señales, cachacos]
// pues esto va como artículos de seguridad».
//
// POR QUÉ NO ALCANZABA NINGUNO DE LOS DOS PUENTES QUE YA HABÍA. `tipo` dice a
// qué tabla de inventario va, y `gasto` cómo lo agrupa la contadora: los dos
// son demasiado gruesos para armar UNA orden. Y el IUPC solo es demasiado
// FINO en la otra dirección — el cemento [21], los agregados [04]/[05] y el
// aditivo [81] son cuatro códigos y una sola visita a la misma ferretería.
// Éste es el corte del medio: **qué clase de proveedor vende esto**.
//
// No es una taxonomía nueva: es una reagrupación de los códigos oficiales, y
// por eso vive acá y no en otro archivo (misma razón que `tipoDeCategoria`).
const RUBRO_POR_CODIGO = new Map();
const defRubro = (rubro, codigos) => codigos.forEach(c => RUBRO_POR_CODIGO.set(c, rubro));

defRubro('concreto',      ['21', '22', '23', '04', '05', '38', '80', '81', '31', '62', '69', '70']);
defRubro('acero',         ['02', '03', '46', '50', '51', '52', '56', '57', '61', '85', '09']);
defRubro('tuberia',       ['65', '66', '68', '71', '72', '73', '77', '78', '89', '90', '10']);
defRubro('electrico',     ['06', '07', '08', '18', '19', '82', '11', '12']);
defRubro('madera',        ['41', '42', '43', '44', '84', '94']);
defRubro('pintura',       ['54', '55', '86']);
defRubro('seguridad',     ['83']);
defRubro('acabados',      ['17', '24', '26', '40', '64', '14', '16', '59', '60', '79', '87', '88', '91']);
defRubro('combustible',   ['01', '34', '53']);
defRubro('herramienta',   ['37']);
defRubro('maquinaria',    ['48', '49', '95']);
defRubro('explosivos',    ['27', '28']);
defRubro('asfalto',       ['13', '20']);
defRubro('flete',         ['32', '33', '92', 'S03']);
defRubro('ambiental',     ['S05']);
defRubro('salud',         ['S04', 'S06']);
defRubro('consultoria',   ['S07']);
defRubro('imprenta',      ['S12']);
defRubro('subcontrato',   ['S09', 'S14']);
defRubro('alquiler',      ['S01', 'S02']);
defRubro('servicios',     ['93', 'servicios', 'S08', 'S10', 'S11', 'S13']);
defRubro('administrativos', ['administrativos', '30', '39']);
defRubro('mano_obra',     ['47', '47-1']);

/** Cómo se llama cada rubro en la pantalla, y en qué orden se muestran. */
export const RUBROS_COMPRA = [
  { rubro: 'concreto',       nombre: 'Concreto, agregados y aditivos', icono: '🧱' },
  { rubro: 'acero',          nombre: 'Acero y metalmecánica',          icono: '🏗' },
  { rubro: 'tuberia',        nombre: 'Tubería, válvulas y accesorios', icono: '🚰' },
  { rubro: 'madera',         nombre: 'Madera y encofrado',             icono: '🪵' },
  { rubro: 'acabados',       nombre: 'Acabados y albañilería',         icono: '🧰' },
  { rubro: 'electrico',      nombre: 'Material eléctrico',             icono: '💡' },
  { rubro: 'pintura',        nombre: 'Pintura y pegamentos',           icono: '🎨' },
  { rubro: 'seguridad',      nombre: 'Seguridad y señalización',       icono: '🦺' },
  { rubro: 'herramienta',    nombre: 'Herramientas',                   icono: '🔨' },
  { rubro: 'maquinaria',     nombre: 'Maquinaria y equipos',           icono: '🚜' },
  { rubro: 'combustible',    nombre: 'Combustible y lubricantes',      icono: '⛽' },
  { rubro: 'asfalto',        nombre: 'Asfalto',                        icono: '🛣' },
  { rubro: 'explosivos',     nombre: 'Explosivos',                     icono: '🧨' },
  { rubro: 'flete',          nombre: 'Flete y transporte',             icono: '🚚' },
  { rubro: 'alquiler',       nombre: 'Alquileres',                     icono: '🔑' },
  { rubro: 'subcontrato',    nombre: 'Subcontratos de obra',           icono: '📐' },
  { rubro: 'ambiental',      nombre: 'Servicios ambientales',          icono: '🧪' },
  { rubro: 'salud',          nombre: 'Salud ocupacional y capacitación', icono: '🩺' },
  { rubro: 'consultoria',    nombre: 'Estudios y consultoría',         icono: '📋' },
  { rubro: 'imprenta',       nombre: 'Imprenta y publicaciones',       icono: '🖨' },
  { rubro: 'servicios',      nombre: 'Otros servicios',                icono: '🛠' },
  { rubro: 'administrativos', nombre: 'Gastos administrativos',        icono: '📎' },
  { rubro: 'mano_obra',      nombre: 'Mano de obra',                   icono: '👷' },
  { rubro: 'sin_clasificar', nombre: 'Sin clasificar',                 icono: '❓' },
];

export const RUBRO_COMPRA_POR_ID = new Map(RUBROS_COMPRA.map(r => [r.rubro, r]));
const ORDEN_RUBRO = new Map(RUBROS_COMPRA.map((r, i) => [r.rubro, i]));

/**
 * El rubro de compra de una categoría cualquiera: **a qué clase de proveedor
 * se le compra esto**. Es lo que arma una orden que una persona puede mandar.
 *
 * Una clasificación propia (`custom:…`) no tiene rubro asignado y cae en
 * `sin_clasificar` a propósito: inventarle uno la mezclaría con insumos que no
 * tienen nada que ver, que es justo el problema que este puente viene a
 * resolver. Se resuelve eligiéndole un código oficial en el Catálogo.
 */
export function rubroDeCompra(codigo) {
  const c = String(codigo || '').trim();
  if (!c) return 'sin_clasificar';
  const directo = RUBRO_POR_CODIGO.get(c);
  if (directo) return directo;
  // Un código reagrupado (22/23 → 21) hereda el rubro de su cabecera.
  const real = REAGRUPACIONES_IUPC[c];
  if (real && RUBRO_POR_CODIGO.has(real)) return RUBRO_POR_CODIGO.get(real);
  return 'sin_clasificar';
}

/** El orden en que se muestran los rubros (los de obra antes que los de gasto). */
export function ordenDeRubro(rubro) {
  const i = ORDEN_RUBRO.get(rubro);
  return i == null ? RUBROS_COMPRA.length : i;
}
