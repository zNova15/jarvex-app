// ═══════════════════════════════════════════════════════════════════
// JARVEX — SUGERIDOR DE CÓDIGO DE DETRACCIÓN (SPOT) — tanda 7, entrega 3.
//
// Gabriel, 6-sep-2026: «yo pensaba que analizabas la descripción del servicio o
// el insumo y ayudabas a colocar el código. Me gustaría que puedas colocar el
// código en base a eso, buscando algo muy certero, y que la contadora lo
// acepte como una recomendación.»
//
// ── LO QUE SE MIDIÓ ANTES DE ESCRIBIR UNA SOLA REGLA ───────────────
// Se leyeron los 29 comprobantes con detracción real de producción. Tres
// códigos aparecen una y otra vez, siempre para el mismo tipo de servicio:
//
//   019  ALQUILER DE RETROEXCAVADORA / DE CAMIONETA…      3+2 casos
//   027  SERVICIO DE TRANSPORTE (de tubo, de bulto…)         5 casos
//   022  supervisión de compra, alimentación de personal,
//        monitoreo ambiental, liquidación de obra…            3 casos, TODOS al 12%
//
// Esos tres son SEGUROS: no los inventé, son los que la contadora ya usa una
// y otra vez para lo mismo. El resto del Anexo 3 (028, 029, 030, 037…) NO
// entra en este archivo: no hay un solo caso real que los valide, y luego de
// haberme equivocado una vez con la tasa del 019, prefiero un catálogo chico
// y cierto a uno completo y adivinado.
//
// ── 🔴 EL HALLAZGO QUE CAMBIÓ EL DISEÑO: LA TASA DE 019 NO SE PUEDE DERIVAR ──
// Antes de escribir esto, medí si "¿el comprobante tiene obra_id?" explicaba
// la diferencia entre el 10% y el 4%. NO la explica: las tres facturas de
// alquiler de retroexcavadora están en el MISMO libro (CONSORCIO EL INCA) y la
// MISMA obra (Miraflores) — y aun así CRUZADO CHILON SANTOS factura al 4% y
// MULTISERVICIOS Y CORPORACION HH al 10%. La diferencia está en cómo CADA
// PROVEEDOR clasificó su propio servicio, un dato que JARVEX no tiene.
//
// Por eso este archivo NO decide la tasa de un alquiler. Devuelve las DOS
// tasas posibles con su porqué, y que decida quien tiene la factura del
// proveedor en la mano — la contadora, no un patrón de texto.
//
// ── EL FALLBACK (022) SOLO DISPARA CON SEÑAL REAL ──────────────────
// No alcanza con que el texto diga "servicio": "ESTUDIO DE SUELOS" y "DISEÑO
// DE MEZCLAS", dos de los casos reales sin código, no llevan esa palabra. La
// señal que sí los explica a los tres: alguien YA decidió que llevan
// detracción y la tasa que cargó es 12% — que es la única tasa que este
// catálogo asocia a 022. Sin esa tasa (un comprobante nuevo, sin nada
// decidido todavía) hace falta la palabra "servicio" en el texto, y si no
// aparece ninguna de las dos señales, NO SE PROPONE NADA. Un material mal
// marcado con detracción (el generador, el cemento) no recibe un código
// inventado.
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

export const CODIGOS_VALIDADOS = {
  '019': { label: 'Arrendamiento de bienes' },
  '020': { label: 'Mantenimiento y reparación de bienes muebles' },
  '021': { label: 'Movimiento de carga' },
  '022': { label: 'Otros servicios / servicio profesional o técnico' },
  '025': { label: 'Fabricación de bienes por encargo' },
  '027': { label: 'Transporte de bienes por vía terrestre' },
  '037': { label: 'Contratos de construcción' },
};

const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const rx = (palabras) => new RegExp(
  '\\b(?:' + palabras.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');

const RX_ALQUILER = rx(['alquiler', 'arrendamiento']);
const RX_TRANSPORTE = rx(['transporte', 'traslado', 'flete']);
const RX_MANTENIMIENTO = rx(['mantenimiento', 'reparacion', 'reparaciones']);
const RX_MOV_CARGA = rx(['estiba', 'desestiba', 'movimiento de carga']);
const RX_CONSTRUCCION_EXPLICITA = rx([
  'contrato de construccion', 'contratos de construccion',
  'ejecucion de obra', 'ejecución de obra',
  'tarrajeo', 'encofrado', 'desencofrado', 'demolicion', 'demolición',
  'pavimentacion', 'pavimentación', 'asfaltado', 'pistas y veredas',
  'alcantarillado', 'instalaciones sanitarias', 'instalaciones electricas',
  'movimiento de tierras', 'partida de obra', 'partidas de obra',
  'valorizacion de obra', 'valorización de obra', 'subcontrato de obra',
  'avance de obra', 'mano de obra'
]);
const RX_SERVICIO_TXT = rx(['servicio']);

/**
 * Sugiere el código SPOT de UNA línea o comprobante.
 *
 * @param descripcion   texto del ítem o del comprobante
 * @param opts.tipoInsumo  'servicio' | 'material' | … si se conoce
 * @param opts.tasaActual  el `detraccion_pct` ya cargado, si existe. Sirve
 *                         para reforzar el código correspondiente y avisar
 *                         cuando la tasa no corresponde a la reglamentaria.
 * @returns { codigo, confianza: 'alta'|'media', motivo,
 *            tasaUnica: number|null,           // la única tasa conocida, o null si es ambigua
 *            tasasPosibles: [{tasa,cuando}]|null,
 *            avisoTasa: string|null,
 *            avisoTasaInusual: string|null }   // cuando tasaActual no cuadra con ninguna conocida
 *          o null si no hay señal suficiente para proponer algo.
 */
export function sugerirCodigoSpot(descripcion, { tipoInsumo, tasaActual } = {}) {
  const d = norm(descripcion);
  if (!d) return null;

  // 1) Alquiler / Arrendamiento -> 019
  if (RX_ALQUILER.test(d)) {
    const tasasPosibles = [
      { tasa: 10, cuando: 'alquiler de un bien mueble común' },
      { tasa: 4, cuando: 'cuando el proveedor lo trata como parte de un contrato de construcción' },
    ];
    const avisoTasaInusual = (tasaActual != null && ![10, 4].includes(Number(tasaActual)))
      ? `La tasa cargada (${tasaActual}%) no es ninguna de las que se usan para alquiler (10% o 4%). Revisá el código o la tasa con la contadora.`
      : null;
    return {
      codigo: '019', confianza: 'alta',
      motivo: 'Es un alquiler: es el código que ya usás para eso.',
      tasaUnica: null, tasasPosibles,
      avisoTasa: 'La tasa de un alquiler NO se puede derivar del sistema: en tus propios datos, la misma obra tiene alquileres de retroexcavadora al 10% y al 4% de proveedores distintos. Lo decide cómo el proveedor clasificó su servicio, no la obra a la que se imputa.',
      avisoTasaInusual,
    };
  }

  // 2) Transporte de bienes -> 027 (4%)
  if (RX_TRANSPORTE.test(d)) {
    const avisoTasaInusual = (tasaActual != null && Number(tasaActual) !== 4)
      ? `La tasa cargada (${tasaActual}%) no es el 4% que usás para transporte. Revisá el código o la tasa con la contadora.`
      : null;
    return {
      codigo: '027', confianza: 'alta',
      motivo: 'Es transporte de bienes: código y tasa que ya usás para eso.',
      tasaUnica: 4, tasasPosibles: null, avisoTasa: null, avisoTasaInusual,
    };
  }

  // 3) Contratos de construcción -> 037 (4%)
  // Casos de obra, partidas, tarrajeo, valorizaciones, etc. (Gabriel, 11-sep-2026).
  // La tasa de 12% descarta 037 (indica servicio profesional/técnico como liquidación o supervisión).
  const tasaEs12 = tasaActual != null && Number(tasaActual) === 12;
  const esConsultoriaTecnica = d.includes('liquidacion') || d.includes('supervis')
    || d.includes('monitoreo') || d.includes('elaboracion') || d.includes('estudio') || d.includes('diseno');

  const esConstruccion = !tasaEs12 && (
    RX_CONSTRUCCION_EXPLICITA.test(d)
    || (/\b(obra|obras|construccion|rehabilitacion)\b/i.test(d) && !esConsultoriaTecnica)
    || (Number(tasaActual) === 4 && /\b(obra|obras|partida|trabajo|servicio)\b/i.test(d))
  );

  if (esConstruccion) {
    const avisoTasaInusual = (tasaActual != null && Number(tasaActual) !== 4)
      ? `La tasa cargada (${tasaActual}%) no es el 4% reglamentario de contratos de construcción (Anexo 3 SUNAT, código 037). Confirmalo con la contadora.`
      : null;
    return {
      codigo: '037',
      confianza: 'alta',
      motivo: 'Es un contrato o servicio de construcción en obra: corresponde al código 037 (Contratos de construcción) al 4% según el Anexo 3 de SUNAT.',
      tasaUnica: 4,
      tasasPosibles: null,
      avisoTasa: null,
      avisoTasaInusual,
    };
  }

  // 4) Mantenimiento y reparación de bienes muebles -> 020 (12%)
  if (RX_MANTENIMIENTO.test(d) && !d.includes('via') && !d.includes('vial')) {
    const avisoTasaInusual = (tasaActual != null && Number(tasaActual) !== 12)
      ? `La tasa cargada (${tasaActual}%) no es el 12% reglamentario de mantenimiento y reparación (Anexo 3 SUNAT, código 020).`
      : null;
    return {
      codigo: '020',
      confianza: 'alta',
      motivo: 'Es mantenimiento y reparación de bienes: corresponde al código 020 al 12% según el Anexo 3 de SUNAT.',
      tasaUnica: 12,
      tasasPosibles: null,
      avisoTasa: null,
      avisoTasaInusual,
    };
  }

  // 5) Movimiento de carga -> 021 (10%)
  if (RX_MOV_CARGA.test(d)) {
    const avisoTasaInusual = (tasaActual != null && Number(tasaActual) !== 10)
      ? `La tasa cargada (${tasaActual}%) no es el 10% reglamentario de movimiento de carga (Anexo 3 SUNAT, código 021).`
      : null;
    return {
      codigo: '021',
      confianza: 'alta',
      motivo: 'Es movimiento de carga / estiba: corresponde al código 021 al 10% según el Anexo 3 de SUNAT.',
      tasaUnica: 10,
      tasasPosibles: null,
      avisoTasa: null,
      avisoTasaInusual,
    };
  }

  // 6) Fallback a 022 (Otros servicios profesionales o técnicos al 12%)
  const esBienConocido = ['material', 'herramienta', 'maquinaria', 'epp']
    .includes(String(tipoInsumo || '').toLowerCase());
  const tasaEs12Valida = !esBienConocido && tasaEs12;
  const diceServicio = RX_SERVICIO_TXT.test(d) || String(tipoInsumo || '').toLowerCase() === 'servicio';
  if (tasaEs12Valida || diceServicio) {
    return {
      codigo: '022',
      confianza: tasaEs12Valida ? 'alta' : 'media',
      motivo: tasaEs12Valida
        ? 'No es alquiler, transporte ni obra, y la tasa ya cargada (12%) es la que usás para otros servicios profesionales o técnicos.'
        : 'No es alquiler ni transporte, pero es un servicio. Proponemos el código que usás para otros servicios profesionales o técnicos — confirmalo con la contadora.',
      tasaUnica: 12, tasasPosibles: null, avisoTasa: null, avisoTasaInusual: null,
    };
  }

  return null;
}
