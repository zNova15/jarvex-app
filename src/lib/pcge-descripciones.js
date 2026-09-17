// ⚠️ ARCHIVO GENERADO — NO EDITAR A MANO.
// Lo produce `node scripts/generar-pcge.mjs` leyendo el PDF oficial
// `VERSION_MODIFICADA_PCG_EMPRESARIAL.pdf` (Plan Contable General Empresarial,
// versión modificada, Consejo Normativo de Contabilidad — MEF).
// Si hay que corregir algo, se corrige el generador o el PDF, no esto.

// Descripción y dinámica de cada cuenta (Parte III del PCGE).
//   contenido   — qué acumula la cuenta.
//   subcuentas  — qué va en cada subcuenta, con los ejemplos del propio PDF.
//   dinamica    — por qué se debita y por qué se acredita.
//   comentarios — las precisiones del Consejo Normativo.
//   niif        — las normas referidas.
export const PCGE_DESCRIPCIONES = {
 "10": {
  "contenido": [
   "Agrupa las subcuentas que representan medios de pago como dinero en efectivo, cheques, giros, entre otros, así como los depósitos en instituciones financieras, y otros equivalentes de efectivo disponibles a requerimiento del titular. Por su naturaleza corresponden a partidas del activo disponible; sin embargo, algunas de ellas podrían estar sujetas a restricción en su disposición o uso.",
   "RECONOCIMIENTO Y MEDICIÓN Las transacciones se reconocen al valor nominal. Los saldos de moneda extranjera se expresarán en moneda nacional al tipo de cambio al que se liquidarían las transacciones a la fecha de los estados financieros que se preparan."
  ],
  "subcuentas": {
   "102": "Fondos fijos. Efectivo establecido sobre un monto fijo o determinado.",
   "103": "Efectivo en tránsito. Fondos en movimiento entre los distintos establecimientos de la empresa, así como los que se encuentren en poder de las empresas transportadoras de caudales.",
   "104": "Cuentas corrientes en instituciones financieras. Saldos de efectivo de la empresa en cuentas corrientes de disponibilidad inmediata.",
   "105": "Otros equivalentes de efectivo. Incluye instrumentos financieros equivalentes de efectivo, emitidos por instituciones financieras, y de naturaleza disponible a requerimiento del tenedor del instrumento, tales comocertificados bancarios.",
   "106": "Depósitos en instituciones financieras. Depósitos en ahorros y a plazo determinado.",
   "107": "Fondos sujetos a restricción. Efectivo que no puede utilizarse libremente, ya sea por disposición de alguna autoridad competente o por mandato judicial."
  },
  "dinamica": {
   "debe": [
    "Las entradas de efectivo a caja y • Las salidas de efectivo por pagos a por reembolsos de fondos fijos.",
    "Los depósitos de cheques en instituciones financieras, las entradas de efectivo por medios electrónicos y otras formas de ingreso de efectivo.",
    "La diferencia de cambio, si se incrementa el tipo de cambio de la moneda extranjera.",
    "Las notas de abono emitidas por instituciones financieras."
   ],
   "haber": [
    "través de caja y bancos y de fondos fijos.",
    "Los pagos por medio de cheques, medios electrónicos u otras formas de transferencia de efectivo.",
    "La diferencia de cambio, si disminuye el tipo de cambio de la moneda extranjera.",
    "Las notas de cargo emitidas por instituciones financieras."
   ]
  },
  "comentarios": [
   "Los fondos fijos son montos de cuantía determinada, que son reembolsables para mantener el saldo autorizado, mientras que los saldos en caja son variables.",
   "En las cuentas corrientes en instituciones financieras se incluyen aquéllas que tienen fines específicos, tales como las que corresponden a fideicomisos.",
   "Para propósitos del estado de flujos de efectivo, los saldos de efectivo y equivalentes de efectivo, contienen el saldo de esta cuenta, excepto los fondos sujetos a restricción, pero sin limitarse necesariamente a esta cuenta. Los equivalentes de efectivo también pueden encontrar contenidos en la cuenta 11 Inversiones financieras."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros",
   "NIC 7 Estado de flujos de efectivo",
   "NIC 21 Efecto de las variaciones de los tipos de cambio de monedas extranjeras",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar",
   "CINIIF 5 Derechos por la participación en fondos para el retiro del servicio, la restauración y la rehabilitación medioambiental"
  ]
 },
 "11": {
  "contenido": [
   "Incluye inversiones en instrumentos financieros cuya tenencia responde a la intención de obtener ganancias en el corto plazo (mantenidas para negociación), y las que han sido designadas específicamente como disponibles para la venta. Además, esta cuenta contiene los instrumentos financieros primarios acordados para su compra futura, cuando son reconocidos en la fecha de contratación del instrumento.",
   "RECONOCIMIENTO Y MEDICIÓN Las inversiones mantenidas para negociación y disponibles para la venta, y las transacciones relacionadas con compromisos de compra, se reconocen inicialmente al costo de adquisición.",
   "Con posterioridad a su reconocimiento inicial, las inversiones se medirán a su valor razonable, y las que no tengan un precio de mercado activo y cuyo valor razonable no pueda ser medido con fiabilidad, se medirán al costo. Cuando se trata de inversiones mantenidas para negociación, la pérdida o ganancia resultante se reconocerá en las subcuentas 677 y 777, respectivamente. Las mediciones por variación del valor razonable en las inversiones disponibles para la venta se reconocen en la subcuenta 563. En el caso de los cambios por medición a valor razonable de los activos financieros incorporados en la subcuenta 113, el reconocimiento se efectúa de manera consistente con el tipo de instrumento de que se trata.",
   "Se debe reconocer la inversión en instrumentos financieros bajo acuerdo de compra según:",
   "- La fecha de contratación, que es la fecha en la que se compromete a comprar o vender un activo; o, - La fecha de liquidación, que es aquella en la que se termina la transacción.",
   "Cuando el reconocimiento es en la fecha de liquidación, no se utiliza la subcuenta 113, sino las cuentas de orden."
  ],
  "subcuentas": {
   "111": "Inversiones mantenidas para negociación. Las que se compran con el objetivo de venderlas en el futuro cercano. Los cambios en el valor razonable se reconocen en el resultado del período.",
   "112": "Inversiones disponibles para la venta. Acumula los instrumentos financieros no derivados distintos de las inversiones mantenidas para negociación y de las mantenidas hasta el vencimiento.",
   "113": "Activos financieros – Acuerdo de compra. Incluye los activos financieros para los que existe un acuerdo de compra que se liquidará en el futuro, cuando se reconocen en la fecha de contratación."
  },
  "dinamica": {
   "debe": [
    "El costo de adquisición de las inversiones.",
    "Los dividendos en acciones.",
    "La diferencia de cambo si se incrementa el tipo de cambio.",
    "El incremento del valor por la aplicación del valor razonable."
   ],
   "haber": [
    "El costo de las inversiones vendidas o redimidas.",
    "La diferencia de cambio si disminuye el tipo de cambio.",
    "La reducción de valor por la aplicación del valor razonable."
   ]
  },
  "comentarios": [
   "Las inversiones mantenidas para negociación y las disponibles para la venta cuyo valor esté expresado en moneda extranjera se traducirán al tipo de cambio al que se liquidarían las transacciones a la fecha de los estados financieros.",
   "Para las inversiones a ser mantenidas hasta el vencimiento, véase la cuenta 30 Inversiones mobiliarias."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo referido a la compensación de cuentas)",
   "NIC 7 Estado de flujos de efectivo (en lo relacionado con los equivalentes de efectivo)",
   "NIC 21 Efecto de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "12": {
  "contenido": [
   "Agrupa las subcuentas que representan los derechos de cobro a terceros que se derivan de las ventas de bienes y/o servicios que realiza la empresa en razón de su objeto de negocio.",
   "RECONOCIMIENTO Y MEDICIÓN Las cuentas por cobrar se reconocerán inicialmente a su valor razonable, que es generalmente igual al costo. Después de su reconocimiento inicial se medirán al costo amortizado.",
   "Cuando exista evidencia de deterioro de la cuenta por cobrar, el importe de esa cuenta se reducirá mediante una cuenta de valuación, para efectos de su presentación en estados financieros.",
   "Las cuentas por cobrar en moneda extranjera pendientes de cobro a la fecha de los estados financieros, se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "121": "Facturas, boletas y otros comprobantes por cobrar. Créditos otorgados por venta de bienes o prestación de servicios. En caso no se haya emitido el documento, pero sí devengado el ingreso y la cuenta por cobrar correspondiente, se debe registrar el derecho exigible en esta subcuenta.",
   "122": "Anticipos de clientes. Montos anticipados por clientes a cuenta de ventas posteriores. Es de naturaleza acreedora.",
   "123": "Letras por cobrar. Créditos que se formalizan con letras aceptadas en canje de facturas, boletas u otros comprobantes por cobrar."
  },
  "dinamica": {
   "debe": [
    "Los derechos de cobro a que dan lugar la venta de bienes o la prestación de servicios inherentes al giro del negocio.",
    "El traslado entre cuentas internas, como es el caso del canje de facturas con letras, o el cambio de condición de letras emitidas, a cobranza o descuento.",
    "La disminución o aplicación de los anticipos recibidos.",
    "La diferencia de cambio, si se incrementa el tipo de cambio de la moneda extranjera."
   ],
   "haber": [
    "El cobro parcial o total de los derechos.",
    "El traslado entre cuentas internas, como es el caso del canje de facturas con letras, o el cambio de condición de letras emitidas a cobranza o descuento.",
    "Los anticipos recibidos por ventas futuras.",
    "La disminución del derecho de cobro por las devoluciones de mercaderías.",
    "Los descuentos, bonificaciones y rebajas concedidas, posteriores a la venta.",
    "La eliminación (castigo) de la contabilidad de las cuentas y documentos considerados incobrables.",
    "La diferencia de cambio, si disminuye el tipo de cambio de la moneda extranjera."
   ]
  },
  "comentarios": [
   "Los saldos que resulten acreedores deben ser presentados como parte del pasivo.",
   "La subcuenta 191 Cuentas por cobrar comerciales – Terceros acumula la estimación de los saldos de cobranza dudosa, actuando como cuenta de valuación para los componentes de esta cuenta."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo referido a la compensación de cuentas)",
   "NIC 18 Ingresos",
   "NIC 21 Efecto de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 32 Instrumentos financieros: Presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: Información a revelar"
  ]
 },
 "13": {
  "contenido": [
   "Agrupa las subcuentas que representan los derechos de cobro a empresas relacionadas, que se derivan de las ventas de bienes y/o servicios que realiza la empresa en razón de su actividad económica.",
   "RECONOCIMIENTO Y MEDICIÓN Las cuentas por cobrar se reconocerán inicialmente a su valor razonable, que es generalmente igual al costo. Después de su reconocimiento inicial, las cuentas por cobrar se medirán al costo amortizado.",
   "Cuando exista evidencia de deterioro de la cuenta por cobrar, el importe de esa cuenta se reducirá mediante una cuenta de valuación, para efectos de su presentación en estados financieros.",
   "Las cuentas por cobrar en moneda extranjera, pendientes de cobro a la fecha de los estados financieros, se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "131": "Facturas, boletas y otros comprobantes por cobrar. Créditos otorgados por venta de bienes o prestación de servicios. En caso no se haya emitido el documento pero se haya devengado el ingreso y la cuenta por cobrar, se debe registrar el derecho exigible en esta cuenta.",
   "132": "Anticipos recibidos. Montos anticipados a cuenta de ventas posteriores. Es de naturaleza acreedora.",
   "133": "Letras por cobrar. Créditos que se formalizan con letras aceptadas en canje de facturas, boletas u otros comprobantes por pagar."
  },
  "dinamica": {
   "debe": [
    "Los derechos de cobro a que da lugar la venta de bienes o la prestación de servicios, inherentes al giro del negocio.",
    "El traslado entre cuentas internas, como es el caso del canje de facturas con letras, o el cambio de condición de letras emitidas a cobranza o descuento.",
    "La disminución o aplicación de los anticipos recibidos.",
    "La diferencia de cambio, si se incrementa el tipo de cambio de la moneda extranjera."
   ],
   "haber": [
    "El cobro parcial o total de los derechos.",
    "El traslado entre cuentas internas, como es el caso del canje de facturas con letras, o el cambio de condición de letras emitidas, a cobranza o descuento.",
    "Los anticipos recibidos por ventas futuras.",
    "La disminución de los derechos de cobro por las devoluciones de mercaderías.",
    "Los descuentos, bonificaciones y rebajas concedidos, posteriores a la venta.",
    "La eliminación (castigo) de la contabilidad de las cuentas y documentos considerados incobrables.",
    "La diferencia de cambio, si disminuye el tipo de cambio de la moneda extranjera."
   ]
  },
  "comentarios": [
   "Los saldos que resulten acreedores deben ser presentados como parte del pasivo.",
   "La subcuenta 192 Cuentas por cobrar comerciales – Relacionadas, acumula la estimación de los saldos de cobranza dudosa, actuando como cuenta de valuación para los componentes de esta cuenta."
  ],
  "niif": [
   "NIC 18 Ingresos",
   "NIC 21 Efecto de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 24 Revelaciones sobre entes vinculados",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: Información a revelar"
  ]
 },
 "14": {
  "contenido": [
   "Agrupa las subcuentas que representan las sumas adeudadas por el personal, accionistas (o socios), directores y gerentes, diferentes de las cuentas por cobrar comerciales, así como las suscripciones de capital pendientes de pago.",
   "RECONOCIMIENTO Y MEDICIÓN Las cuentas por cobrar se reconocerán inicialmente a su valor razonable, que es generalmente igual al costo. Después de su reconocimiento inicial se medirán al costo amortizado.",
   "Cuando exista evidencia de deterioro de la cuenta por cobrar, el importe se reducirá mediante una cuenta de valuación para efectos de su presentación en estados financieros.",
   "Las cuentas en moneda extranjera pendientes de cobro a la fecha de los estados financieros, se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "141": "Personal. Cuentas por cobrar al personal por préstamos, adelantos o entregas a rendir cuenta, excepto al personal de gerencia.",
   "142": "Accionistas (o socios). Cuentas por cobrar por acciones suscritas y no pagadas, o préstamos que se les haya otorgado.",
   "143": "Directores. Cuentas por cobrar por préstamos, adelanto de dietas, o entregas a rendir cuenta.",
   "144": "Gerentes. Incluye las cuentas por cobrar al personal de gerencia.",
   "148": "Diversas. Cualquier otra cuenta por cobrar no señalada en las divisionarias anteriores."
  },
  "dinamica": {
   "debe": [
    "Los préstamos al personal, gerentes, directores y accionistas.",
    "Los aportes pendientes de cobro en la suscripción de acciones.",
    "La diferencia de cambio en caso se incremente el tipo de cambio."
   ],
   "haber": [
    "Los pagos recibidos del personal, gerentes, directores y accionistas.",
    "La diferencia de cambio si disminuye el tipo de cambio."
   ]
  },
  "comentarios": [
   "El saldo correspondiente a suscripciones por cobrar a socios o accionistas, se presentará en el balance general, deduciéndolo de la cuenta 52 Capital adicional.",
   "La subcuenta 193 Cuentas por cobrar al personal, a los accionistas (socios), directores y gerentes, acumula la estimación de los saldos de cobranza dudosa, actuando como cuenta de valuación para los componentes de esta cuenta."
  ],
  "niif": [
   "NIC 21 Efecto de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 24 Revelaciones sobre entes vinculados",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "16": {
  "contenido": [
   "Agrupa las subcuentas que representan derechos de cobro a terceros por transacciones distintas a las del objeto del negocio.",
   "RECONOCIMIENTO Y MEDICIÓN Las cuentas por cobrar se reconocerán por el valor razonable de la transacción, generalmente igual al costo. Después de su reconocimiento inicial se medirán al costo amortizado, excepto por los activos por instrumentos financieros que, se miden a su valor razonable; cuando esta medición es impracticable, tales activos se medirán al costo amortizado.",
   "Cuando exista evidencia de deterioro de la cuenta por cobrar medida al costo amortizado, el importe de esa cuenta se reducirá mediante una cuenta de valuación, para efectos de su presentación en estados financieros.",
   "Las cuentas en moneda extranjera pendientes de cobro a la fecha de los estados financieros, se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "161": "Préstamos. Comprende los créditos no comerciales entregados a terceros.",
   "162": "Reclamaciones a terceros. Incluye los efectos de las transacciones relacionadas con reclamos de actividades comerciales y no comerciales.",
   "163": "Intereses, regalías y dividendos. Incluye los derechos de cobro por intereses y regalías devengados, y por dividendos en efectivo declarados por las empresas donde se mantiene inversiones.",
   "164": "Depósitos otorgados en garantía. Comprende los montos entregados en garantía, tales como depósitos por arrendamiento de bienes muebles e inmuebles, depósitos por cartas fianza u otras garantías entregadas.",
   "165": "Venta de activo inmovilizado. Derechos de cobro por venta de inversión mobiliaria; inversión inmobiliaria; inmuebles, maquinaria y equipo; y otros activos de largo plazo.",
   "166": "Activos por instrumentos financieros. Incluye los efectos favorables relacionados con la medición a valor razonable de los instrumentos financieros primarios cuando se adquieren en una compra no convencional y se elige para su reconocimiento la fecha de liquidación, así como los efectos favorables en el caso de los instrumentos financieros derivados, tales como contratos a plazo, intercambios, entre otros.",
   "168": "Otras cuentas por cobrar diversas. Incluye las entregas a rendir cuenta efectuadas a terceros y cualquier cuenta por cobrar no incluida en las subcuentas anteriores."
  },
  "dinamica": {
   "debe": [
    "Los préstamos otorgados.",
    "Las reclamaciones.",
    "Los intereses, las regalías y los dividendos por cobrar.",
    "Los depósitos otorgados en garantía.",
    "La venta de activo inmovilizado.",
    "Los efectos favorables en la medición al valor razonable de los activos por instrumentos financieros.",
    "La diferencia de cambio, cuando el tipo de cambio se incrementa."
   ],
   "haber": [
    "Las cobranzas efectuadas.",
    "La eliminación (castigo) de las cuentas por cobrar diversas de las deudas incobrables.",
    "La disminución de los efectos favorables en la medición al valor razonable de los activos por instrumentos financieros.",
    "La diferencia de cambio, cuando disminuye el tipo de cambio."
   ]
  },
  "comentarios": [
   "La subcuenta Intereses, regalías y dividendos, registra los intereses sobre la base de tiempo, las regalías en concordancia con los términos del contrato que les dio origen, y los dividendos en la fecha que es reconocido el derecho del accionista a recibir el pago, respectivamente.",
   "La subcuenta 194 Cuentas por cobrar diversas – Terceros, acumula la estimación de los saldos de cobranza dudosa, actuando como cuenta de valuación para los componentes de esta cuenta."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo referido a la compensación de cuentas)",
   "NIC 21 Efecto de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "17": {
  "contenido": [
   "Agrupa las subcuentas que representan derechos de cobro a entidades relacionadas por transacciones distintas a las de ventas en razón de su actividad principal.",
   "RECONOCIMIENTO Y MEDICIÓN Las cuentas por cobrar se reconocerán por el valor razonable de la transacción, generalmente igual al costo. Después de su reconocimiento inicial se medirán al costo amortizado, excepto por los activos por instrumentos financieros, que se miden a su valor razonable; cuando esta medición es impracticable, tales activos se medirán al costo amortizado.",
   "Cuando exista evidencia de deterioro de la cuenta por cobrar medida al costo amortizado, el importe de esa cuenta se reducirá mediante una cuenta de valuación, para efectos de su presentación en estados financieros.",
   "Las cuentas en moneda extranjera pendientes de cobro a la fecha de los estados financieros, se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "171": "Préstamos. Comprende los créditos no comerciales entregados a entidades relacionadas.",
   "173": "Intereses, regalías y dividendos. Incluye los derechos de cobro por intereses y regalías devengados, y por dividendos en efectivo declarados por entidades relacionadas.",
   "174": "Depósitos otorgados en garantía. Comprende los montos entregados en garantía, tales como depósitos por arrendamiento de bienes muebles e inmuebles, depósitos por cartas fianza u otras garantías entregadas.",
   "175": "Venta de activo inmovilizado. Derechos de cobro por venta de inversión mobiliaria; inversión inmobiliaria; inmuebles, maquinaria y equipo; y otros activos a largo plazo.",
   "176": "Activos por instrumentos financieros. Incluye los efectos favorables relacionados con la medición a valor razonable de los instrumentos financieros primarios cuando se adquieren en una compra no convencional y se elige para su reconocimiento la fecha de liquidación, así como los efectos favorables en el caso de los instrumentos financieros derivados, en transacciones con relacionadas, tales como contratos a plazo, intercambios, entre otros.",
   "178": "Otras cuentas por cobrar diversas. Incluye las entregas a rendir cuenta a entidades relacionadas y cualquier cuenta por cobrar no incluida en las subcuentas anteriores."
  },
  "dinamica": {
   "debe": [
    "Los préstamos otorgados.",
    "Los intereses, regalías y los dividendos por cobrar.",
    "Los efectos favorables en la medición al valor razonable de los activos por instrumentos financieros.",
    "Los depósitos otorgados en garantía.",
    "La venta de activo inmovilizado.",
    "La diferencia de cambio si el tipo de cambio se incrementa."
   ],
   "haber": [
    "Las cobranzas efectuadas.",
    "La eliminación (castigo) de las cuentas por cobrar diversas de las deudas incobrables.",
    "La disminución de los efectos favorables en la medición al valor razonable de los activos por instrumentos financieros.",
    "La diferencia de cambio si disminuye el tipo de cambio."
   ]
  },
  "comentarios": [
   "La subcuenta Intereses, regalías y dividendos, registra los intereses sobre la base de tiempo; las regalías en concordancia con los términos del contrato que les dio origen; y los dividendos en la fecha que es reconocido el derecho del accionista a recibir el pago, respectivamente.",
   "La subcuenta 195 Cuentas por cobrar diversas - Relacionadas, acumula la estimación de los saldos de cobranza dudosa, actuando como cuenta de valuación para los componentes de esta cuenta."
  ],
  "niif": [
   "NIC 21 Efecto de las variaciones de los tipos de cambio de monedas extranjeras",
   "NIC 24 Revelaciones sobre entes vinculados",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "18": {
  "contenido": [
   "Agrupa las subcuentas que representan los servicios contratados a recibir en el futuro, o que habiendo sido recibidos, incluyen beneficios que se extienden más allá de un ejercicio económico, así como las primas pagadas por opciones financieras.",
   "RECONOCIMIENTO Y MEDICIÓN Estas transacciones se registran al costo menos el consumo de los beneficios económicos incorporados, excepto en el caso de las primas pagadas por opciones, que se miden al valor razonable con cambios en los resultados del período."
  ],
  "subcuentas": {
   "181": "Costos financieros. Incluye los costos financieros descontados por anticipado por los acreedores, en financiamientos recibidos. Los costos financieros incluyen intereses, comisiones, y cualquier otro costo en el que se incurre relacionado con el financiamiento recibido.",
   "182": "Seguros. Comprende el monto contratado con las compañías aseguradoras por las primas de seguros y otros costos marginales, por coberturas a recibir en el futuro.",
   "183": "Alquileres. Comprende el alquiler de bienes muebles e inmuebles, cuya utilización se efectuará en el futuro.",
   "184": "Primas pagadas por opciones. Corresponde al pago de primas en opciones de compra o venta futuras.",
   "185": "Mantenimiento de activos inmovilizados. Incluye todos los gastos de mantenimiento cuyo beneficio excede un período y que no reúnen las condiciones para ser incorporados en el valor del activo objeto de mantenimiento.",
   "189": "Otros gastos contratados por anticipado. Se contabilizará cualquier servicio a ser devengado luego de la fecha de los estados financieros, cuyo registro no corresponde incluirse en las subcuentas anteriores."
  },
  "dinamica": {
   "debe": [
    "Los intereses descontados por anticipado en operación de financiamiento recibido.",
    "Los montos por servicios contratados asociados a beneficios económicos futuros.",
    "Incremento en la medición a valor razonable de las primas pagadas."
   ],
   "haber": [
    "Devengamiento de intereses.",
    "Consumo de los servicios contratados.",
    "Liquidación de las opciones contratadas o disminución por medición al valor razonable."
   ]
  },
  "comentarios": [
   "Las primas pagadas por opciones reconocidas en la subcuenta 184, corresponden a los derechos pagados comprometidos, al contratar una opción de compra o venta. Las variaciones en el valor razonable del bien objeto de la opción subyacente se reconocen en las subcuentas 166 y 464, según las variaciones representen resultados favorables o desfavorables, respectivamente.",
   "La subcuenta 185 Mantenimiento de activos inmovilizados revierte incrementando la subcuenta 634 Mantenimiento y reparaciones, cuando se devenga."
  ],
  "niif": [
   "Marco Conceptual de las NIIF (en lo concerniente a concepto de beneficio económico futuro esperado y al postulado de Devengado)",
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 21 Efectos de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 38 Activos intangibles",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIC 40 Inversiones inmobiliarias",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "19": {
  "contenido": [
   "Agrupa las subcuentas que acumulan las estimaciones de cobro dudoso para cubrir el deterioro de las cuentas por cobrar.",
   "RECONOCIMIENTO Y MEDICIÓN Se reconoce la estimación de cobranza dudosa, discriminándola por la naturaleza de la cuenta por cobrar, y paralelamente la cuenta de gasto correspondiente.",
   "Las cuentas en moneda extranjera a la fecha de los estados financieros se expresarán al tipo de cambio aplicable a las cuentas por cobrar relacionadas."
  ],
  "subcuentas": {
   "191": "Cuentas por cobrar comerciales - Terceros. Incorpora la estimación de cobro dudoso de las cuentas por cobrar a clientes.",
   "192": "Cuentas por cobrar comerciales - Relacionadas. Comprende la estimación de cobro dudoso de las compañías relacionadas en transacciones comerciales.",
   "193": "Cuentas por Cobrar al personal, a los accionistas (socios) directores y gerentes. Incluye la estimación de cobro dudoso de las cuentas por cobrar al personal, accionistas, directores y gerentes.",
   "194": "Cuentas por cobrar diversas - Terceros. Comprende la estimación de cobro dudoso de las cuentas por cobrar diversas con terceros.",
   "195": "Cuentas por cobrar diversas – Relacionadas. Comprende la estimación de cobro dudoso de las cuentas por cobrar diversas a relacionadas."
  },
  "dinamica": {
   "debe": [
    "La recuperación total o parcial de los derechos de cobro.",
    "La eliminación (castigo) de las cuentas cuya incobrabilidad se confirma.",
    "La diferencia de cambio para igualar la estimación de cobranza dudosa a la cuenta por cobrar relacionada."
   ],
   "haber": [
    "El deterioro estimado según evaluación de la empresa.",
    "La diferencia de cambio para igualar la estimación de cobranza dudosa a la cuenta por cobrar relacionada."
   ]
  },
  "comentarios": [
   "Aquellas cuentas, cuya estimación de incobrabilidad se confirma, son retiradas de la contabilidad, eliminando las cuentas que acumulan el derecho de cobro y aquellas de valuación que acumulan la estimación de incobrabilidad.",
   "Esta cuenta se relaciona directamente con las cuentas 12, 13, 14, 16 y 17."
  ],
  "niif": [
   "NIC 21 Efectos de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar ELEMENTO 2: ACTIVO REALIZABLE Comprende las cuentas de la 20 hasta la 29. Éstas se refieren a los bienes y servicios acumulados de propiedad de la empresa, cuyo destino es la venta."
  ]
 },
 "20": {
  "contenido": [
   "Agrupa las subcuentas que representan los bienes adquiridos por la empresa para ser destinados a la venta, sin someterlos a proceso de transformación.",
   "RECONOCIMIENTO Y MEDICIÓN Las mercaderías se registrarán a su costo de adquisición, incluyendo todos los costos necesarios para que las mercaderías tengan su condición y ubicación actuales.",
   "Las salidas de existencias de mercaderías se reconocen de acuerdo con las fórmulas de costeo de PEPS, promedio ponderado o costo identificado.",
   "Para los efectos de la medición al cierre del período que se reporta, se aplica la regla de valuación de costo de adquisición o valor neto de realización, el menor. La excepción a esta regla corresponde a los productos agrícolas y forestales en la oportunidad de su cosecha o recolección, y a las materias primas que los intermediarios miden de acuerdo con su cotización internacional; mercaderías en ambos casos, que se miden a su valor razonable.",
   "Las diferencias de cambio originadas en pasivos en moneda extranjera serán aplicadas a resultados."
  ],
  "subcuentas": {
   "201": "Mercaderías manufacturadas. Productos adquiridos, ya elaborados y listos para su venta.",
   "202": "Mercaderías de extracción. Productos originados en recursos naturales extraídos, que han sido adquiridos para su venta sin haber sido transformados.",
   "203": "Mercaderías agropecuarias y piscícolas. Productos de origen animal y vegetal que se adquieren con el objetivo de venderlos sin transformarlos.",
   "204": "Mercaderías inmuebles. Activos inmobiliarios que se adquieren con el propósito de su venta.",
   "208": "Otras mercaderías. Mercaderías adquiridas para la venta que no se contemplan en las subcuentas anteriores."
  },
  "dinamica": {
   "debe": [
    "El costo de las mercaderías adquiridas con abono a la subcuenta 611 – Variación de existencias - mercaderías.",
    "El costo de las mercaderías devueltas por los clientes, con abono a la subcuenta 691 - Costo de ventas - Mercaderías.",
    "El incremento de valor de las mercaderías que se miden al valor razonable.",
    "Los sobrantes de mercaderías."
   ],
   "haber": [
    "El costo de las mercaderías vendidas, con cargo a la subcuenta 691 – Costo de ventas – Mercaderías.",
    "El costo de las mercaderías devueltas a proveedores con cargo a la subcuenta 611 – Variación de existencias – Mercaderías.",
    "La disminución de valor de las mercaderías que se miden al valor razonable.",
    "Los faltantes de mercaderías, determinados por referencia a inventarios físicos.",
    "El castigo de mercaderías."
   ]
  },
  "comentarios": [
   "Las mercaderías remitidas en consignación se deben considerar como existencias para el consignador, las que se controlarán en cuentas de orden deudoras.",
   "En el caso de las mercaderías recibidas en consignación, depósitos, demostración o exhibición que pertenecen a terceros, no se deben incluir en este rubro, debiendo ser registradas en cuentas de orden acreedoras.",
   "El castigo de existencias de mercaderías se reconoce eliminando el monto correspondiente de esta cuenta, conjuntamente con la subcuenta 291 que acumula las estimaciones de la desvalorización."
  ],
  "niif": [
   "NIC 2 Existencias",
   "NIC 41 Agricultura"
  ]
 },
 "21": {
  "contenido": [
   "Agrupa las subcuentas que representan los bienes fabricados o producidos por la empresa, destinados a la venta. Asimismo, se incluye el costo de los servicios prestados por la empresa, que se relacionan con ingresos que serán reconocidos en el futuro, y los costos de financiación incorporados al valor de estos activos.",
   "RECONOCIMIENTO Y MEDICIÓN El ingreso de productos terminados se mide al costo de fabricación y otros costos que fueran necesarios para tener las existencias de productos terminados en su condición y ubicación actuales. La salida de productos terminados se reconoce de acuerdo con las fórmulas de costeo de PEPS, promedio ponderado, o costo identificado.",
   "Cuando se produce conjuntamente más de un producto y los costos de transformación no puedan identificarse por separado (por cada tipo de producto) se distribuye el costo total entre los productos, utilizando bases uniformes y racionales.",
   "Los costos de financiación cuando son incorporados en el costo de existencias identificadas como calificadas (existencias calificadas), deben ser acumulados por separado en la subcuenta 218."
  ],
  "subcuentas": {
   "211": "Productos manufacturados. Productos que resultan de procesos de fabricación.",
   "212": "Productos de extracción terminados. Obtenidos a partir del procesamiento de recursos naturales.",
   "213": "Productos agropecuarios y piscícolas terminados. Productos de origen animal o vegetal que han sufrido algún proceso de cambio en la empresa.",
   "214": "Productos inmuebles. Edificaciones que la empresa ha construido o modificado para su venta. Incluye también terrenos sobre los que se construyen estas edificaciones y cuya propiedad se transferirá conjuntamente con la venta de la edificación.",
   "215": "Existencias de servicios terminados. Se compone principalmente de la mano de obra y otros costos incurridos en la prestación del servicio concluido.",
   "217": "Otros productos terminados. Productos terminados que la empresa ha procesado, que no se contemplan en las subcuentas anteriores.",
   "218": "Costos de financiación – Productos terminados. Costos de financiación incorporados en el valor de los activos de productos terminados, generados hasta el momento en que las existencias se encuentran listas para su comercialización."
  },
  "dinamica": {
   "debe": [
    "El costo de manufactura de los productos para la venta.",
    "El costo de los productos devueltos por los clientes.",
    "El costo de las existencias de servicios.",
    "La variación de productos terminados con abono a la subcuenta 711.",
    "Costos de financiación, cuando la existencia corresponde a un activo calificado, por transferencia de la subcuenta 238.",
    "Los sobrantes de productos terminados.",
    "La transferencia de productos y servicios recibidos de productos en proceso."
   ],
   "haber": [
    "El costo de los productos manufacturados, de los productos naturales extraídos y procesados; el de los agropecuarios y piscícolas procesados, vendidos.",
    "El costo de los servicios prestados y vendidos.",
    "Los faltantes de productos terminados.",
    "El castigo de productos terminados."
   ]
  },
  "comentarios": [
   "Las mermas originadas en los procesos de producción, en cuanto tengan valor de recuperación, se controlan en la cuenta 22 Subproductos, desechos y desperdicios.",
   "La existencia de servicios terminados está relacionada con ingresos aún no reconocidos por la prestación de dichos servicios. El ingreso y el costo de la prestación del servicio se reconocen conjuntamente en los resultados del periodo en que se devengan.",
   "El castigo de existencias de productos terminados se reconoce eliminando el monto correspondiente de la subcuenta, conjuntamente con la subcuenta 292 que acumula la estimación de desvalorización.",
   "La desvalorización de existencias de productos terminados, en tanto contengan costos de financiación, para su adecuado tratamiento contable, plantea la consideración de si tal desvalorización alcanza al costo de manufactura invertido en el producto, o al costo de financiación relacionado, o a una distribución entre ambos componentes, para efectos de la presentación en los estados financieros. Por razones prácticas, se conviene en que ante una desvalorización, el componente de costo de financiación activado es el primero que se afecta hasta agotarlo."
  ],
  "niif": [
   "NIC 2 Existencias",
   "NIC 23 Costos de financiamiento",
   "NIC 41 Agricultura"
  ]
 },
 "22": {
  "contenido": [
   "Agrupa las subcuentas que representan los productos accesorios obtenidos en la producción de los bienes del giro de la empresa. Asimismo, se incluye los residuos o mermas de producción de toda naturaleza, originadas en los procesos productivos, pero que mantienen algún valor en su realización.",
   "RECONOCIMIENTO Y MEDICIÓN Los subproductos, desechos y desperdicios se registran al costo, el que se compara periódicamente con el valor neto de realización, manteniéndose en libros al menor valor a través de una cuenta de valuación. La salida de este tipo de existencias se mide utilizando las fórmulas de costo PEPS, o promedio ponderado.",
   "Cuando su costo no puede ser medido confiablemente, se miden al valor neto de realización."
  ],
  "subcuentas": {
   "221": "Subproductos. Productos obtenidos accesoriamente en el proceso de producción. Resultan de la producción conjunta donde el subproducto tiene un valor reducido respecto del producto o de los productos principales.",
   "222": "Desechos y desperdicios. Materiales desechados por presentar defectos o que resultan no utilizables en el proceso de transformación."
  },
  "dinamica": {
   "debe": [
    "El costo o valor neto de realización de los subproductos, desechos y desperdicios, en la oportunidad de su reconocimiento inicial.",
    "La variación de subproductos, desechos y desperdicios con abono a la subcuenta 712.",
    "Los sobrantes de este tipo de existencias."
   ],
   "haber": [
    "El valor en libros de los subproductos, desechos y desperdicios vendidos.",
    "Los faltantes de este tipo de existencias.",
    "El castigo de este tipo de existencias."
   ]
  },
  "comentarios": [
   "El monto con el que se incorporan todas estas existencias, es acreditado al costo de producción que valoriza el proceso productivo en el cual se originan.",
   "El costo de producción puede ser acumulado en una cuenta del elemento 9, de acuerdo con la naturaleza de las operaciones de cada empresa."
  ],
  "niif": [
   "NIC 2 Existencias"
  ]
 },
 "23": {
  "contenido": [
   "Agrupa las subcuentas que representan aquellos bienes que se encuentran en proceso de producción, a la fecha de los estados financieros.",
   "RECONOCIMIENTO Y MEDICIÓN Los costos de producción o transformación de las existencias comprenden los costos directamente relacionados con las unidades en producción y los costos indirectos atribuibles.",
   "En el caso de productos agropecuarios, la medición es a valor razonable considerando el estado y condición actual de dichos productos. Cuando no existan referencias al valor de mercado, que permitan la medición a valor razonable, se medirán al costo.",
   "Los costos de financiación cuando son incorporados en el costo de existencias identificadas como calificadas (existencias calificadas), deben ser acumulados por separado en la subcuenta 238."
  ],
  "subcuentas": {
   "231": "Productos en proceso de manufactura. Productos que se encuentran en proceso de manufactura.",
   "232": "Productos extraídos en proceso de transformación. Productos que habiendo sido extraídos de la naturaleza, se encuentran en proceso de transformación.",
   "233": "Productos agropecuarios y piscícolas en proceso. Productos de origen animal o vegetal que se encuentran en proceso de producción.",
   "234": "Productos inmuebles en proceso. Inmuebles que se encuentran en proceso de construcción, cuando los inmuebles son destinados a la venta.",
   "235": "Existencias de servicios en proceso. Se compone de la mano de obra y otros costos involucrados en la prestación del servicio mientras éste no se ha concluido.",
   "237": "Otros productos en proceso. Productos en etapa de transformación o fabricación que no se contemplan en las subcuentas anteriores.",
   "238": "Costos de financiación – Productos en proceso. Costos de financiación incorporados en el valor de los activos de productos en proceso, generados hasta el momento en que tales productos se transfieren a producción terminada."
  },
  "dinamica": {
   "debe": [
    "El costo de los productos en proceso, calculado hasta la etapa en que se encuentran, con abono a la cuenta 71 Variación de la producción almacenada, subcuenta 713.",
    "El costo de las existencias de servicio en proceso.",
    "El incremento de valor de los productos en proceso que se miden al valor razonable.",
    "Costos de financiación, cuando la existencia corresponde a un activo calificado.",
    "Los sobrantes de productos en proceso."
   ],
   "haber": [
    "La transferencia de saldos al inicio del periodo con cargo a la cuenta 71 Variación de la producción almacenada, subcuenta 713.",
    "La transferencia a las subcuentas correspondientes de productos terminados y de existencias de servicios terminados.",
    "La disminución de valor de los productos en proceso que se miden al valor razonable.",
    "Los faltantes de productos en proceso.",
    "Los castigos de productos en proceso."
   ]
  },
  "comentarios": [
   "Los productos extraídos y los productos agropecuarios y piscícolas (medidos al costo) en proceso, agrupan los costos de los materiales directos, mano de obra, costos indirectos, contratos de servicios y demás costos que incurre la entidad en los procesos de extracción y proceso de refinación o cambio de estado (recursos naturales), y de la siembra, desarrollo y recolección de productos agropecuarios y/o piscícolas.",
   "La existencia de servicios en proceso está relacionada con los costos incurridos, los que están asociados a ingresos no devengados. Conforme se devenga el derecho a percibir el ingreso, el costo asociado se transfiere a existencias de servicios terminados, y luego al costo de servicios prestados en ganancias y pérdidas.",
   "La subcuenta productos inmuebles en proceso representa el costo de los materiales directos, mano de obra, costos indirectos, contratos de servicios y demás costos incurridos para el desarrollo de cada obra, hasta su culminación para ser vendida.",
   "La desvalorización de existencias de productos en proceso, en tanto contengan costos de financiación, para su adecuado tratamiento contable, plantea la consideración de si tal desvalorización alcanza al costo de manufactura invertido en el producto, o al costo de financiación relacionado, o a una distribución entre ambos componentes, para efectos de la presentación en los estados financieros. Por razones prácticas, se conviene en que ante una desvalorización, el componente de costo de financiación activado es el primero que se afecta hasta agotarlo."
  ],
  "niif": [
   "NIC 2 Existencias",
   "NIC 23 Costos de financiamiento",
   "NIC 41 Agricultura"
  ]
 },
 "24": {
  "contenido": [
   "Agrupa las subcuentas que representan los insumos que intervienen directamente en los procesos de fabricación, para la obtención de los productos terminados, y que quedan incorporados en estos últimos.",
   "RECONOCIMIENTO Y MEDICIÓN Las materias primas se registrarán al costo, el mismo que incluye todo costo atribuible a la adquisición, hasta que estén disponibles para ser utilizadas en el objeto del negocio relacionado. Los descuentos comerciales, las rebajas y otras partidas similares, distintas de las financieras, se deducirán para determinar el costo de adquisición.",
   "Para los efectos de la medición al cierre del ejercicio, se tomará en cuenta el costo de adquisición o valor neto de realización, el más bajo. Cuando una reducción en el costo de adquisición de las materias primas indique que el costo de los productos terminados excederá su valor neto realizable, el costo de reposición de las materias primas puede ser la medida adecuada de su valor neto realizable.",
   "La salida de materias primas se reconoce de acuerdo con las fórmulas de costeo de PEPS, o promedio ponderado, o costo identificado."
  ],
  "subcuentas": {
   "241": "Materias primas para productos manufacturados. Adquiridas para su posterior ingreso al proceso productivo.",
   "242": "Materias primas para productos de extracción. Incluye recursos extraídos que sirven de materia prima para su posterior transformación.",
   "243": "Materias primas para productos agropecuarios y piscícolas. Incluye los productos agropecuarios y piscícolas que luego van a ser transformados.",
   "244": "Materias primas para productos inmuebles. Incluye las materias primas necesarias para la construcción de inmuebles."
  },
  "dinamica": {
   "debe": [
    "El costo de las materias primas.",
    "El costo de las materias primas devueltas por el centro de producción.",
    "Los sobrantes de materias primas."
   ],
   "haber": [
    "El valor en libros de las materias primas utilizadas en la producción.",
    "El costo de las devoluciones de materias primas a proveedores.",
    "Los faltantes de materias primas.",
    "El castigo de materias primas."
   ]
  },
  "comentarios": [
   "Las subcuentas consideradas para materias primas siguen las mismas clasificaciones descritas para productos en proceso y productos terminados, en lo aplicable. La clasificación adecuada de las materias primas dependerá del propósito para el que sean adquiridos los bienes que finalmente se destinarán a la producción de bienes.",
   "El castigo de existencias de materias primas se reconoce conjuntamente con la subcuenta 295 que acumula la estimación de desvalorización."
  ],
  "niif": [
   "NIC 2 Existencias"
  ]
 },
 "25": {
  "contenido": [
   "Agrupa las cuentas divisionarias que representan los materiales diferentes de los insumos principales (materias primas) y los suministros que intervienen en el proceso de fabricación. Asimismo, incluye los repuestos que no califican como bienes inmovilizados.",
   "RECONOCIMIENTO Y MEDICIÓN Los materiales auxiliares, suministros y repuestos se registrarán a su costo de adquisición, el mismo que incluye todos los costos necesarios para darle su condición y ubicación actual.",
   "Para los efectos de la medición al cierre del ejercicio, se tomará en cuenta el costo de adquisición o producción o valor neto de realización, él mas bajo.",
   "Cuando una reducción en el costo de adquisición de los materiales auxiliares, suministros y repuestos indique que el costo de los productos terminados excederá su valor neto realizable, el costo de reposición de los materiales auxiliares, suministros y repuestos puede ser la medida adecuada de su valor neto realizable.",
   "Las salidas de materiales auxiliares, suministros y repuestos se reconocen de acuerdo con las fórmulas de costeo de PEPS, o promedio ponderado, o costo identificado."
  ],
  "subcuentas": {
   "251": "Materiales auxiliares. Materiales destinados para el proceso de fabricación, complementarios a las materias primas.",
   "252": "Suministros. Insumos que intervienen en los procesos de producción o comercialización, o procesos complementarios, como el de mantenimiento.",
   "253": "Repuestos. Partes y piezas a ser destinadas a su montaje en instalaciones, equipos o máquinas en sustitución de otras semejantes."
  },
  "dinamica": {
   "debe": [
    "El costo de los materiales y suministros adquiridos o fabricados.",
    "El costo de los materiales y suministros devueltos por el centro de producción.",
    "Los sobrantes de este tipo de existencias."
   ],
   "haber": [
    "El valor en libros de los materiales y suministros utilizados en la producción.",
    "El costo de las devoluciones de materiales y suministros a proveedores.",
    "Los faltantes de este tipo de existencias.",
    "El castigo de esta clase de existencias."
   ]
  },
  "comentarios": [
   "Las piezas de repuesto importantes que se sustituyen, en activos de Inmuebles, maquinaria y equipo (que se espera utilizar por más de un periodo) deben registrarse en la subcuenta 337 Herramientas y unidades de reemplazo."
  ],
  "niif": [
   "NIC 2 Existencias"
  ]
 },
 "26": {
  "contenido": [
   "Agrupa las subcuentas que representan los bienes complementarios para la presentación y comercialización del producto.",
   "RECONOCIMIENTO Y MEDICIÓN Los envases y embalajes se registrarán al costo de adquisición, el mismo que incluye los costos necesarios para darles su condición y ubicación actual.",
   "Para los efectos de la medición al cierre del ejercicio, se tomará en cuenta el costo de adquisición o valor neto de realización, el más bajo. Las salidas de envases y embalajes se reconocen de acuerdo con las fórmulas de costeo de PEPS, o promedio ponderado, o costo identificado.",
   "Cuando una reducción en el costo de adquisición de los envases y embalajes indique que el costo de los productos terminados excederá su valor neto realizable, el costo de reposición de los envases y embalajes puede ser la medida adecuada de su valor neto realizable."
  ],
  "subcuentas": {
   "261": "Envases. Recipientes o vasijas, destinados a contener el producto que se comercializa.",
   "262": "Embalajes. Cubiertas o envolturas, destinadas a guardar productos o mercaderías al momento de transportarlas o almacenarlas."
  },
  "dinamica": {
   "debe": [
    "El costo de los envases y embalajes adquiridos.",
    "El costo de envases y embalajes devueltos por los centros de producción.",
    "Los sobrantes de envases y embalajes."
   ],
   "haber": [
    "El valor en libros de los envases y embalajes utilizados.",
    "El costo de los envases y embalajes devueltos a los proveedores.",
    "Los faltantes de envases y embalajes.",
    "El castigo de esta clase de existencias."
   ]
  },
  "comentarios": [
   "El castigo de existencias de envases y embalajes se reconoce eliminando el monto correspondiente en esta cuenta, conjuntamente con la subcuenta 297 que acumula la estimación de desvalorización."
  ],
  "niif": [
   "NIC 2 Existencias"
  ]
 },
 "27": {
  "contenido": [
   "Agrupa los activos inmovilizados cuya recuperación se espera realizar, fundamentalmente, a través de su venta en lugar de su uso continuo. Las características que deben cumplir los activos son: que se encuentren disponibles en las condiciones actuales para su venta inmediata, sujeto a los términos usuales y habituales para la venta de estos activos, y su venta debe ser altamente probable.",
   "transferencia la depreciación acumulada de los activos biológicos cuando se siguió el método del costo en esa categoría de activo.",
   "RECONOCIMIENTO Y MEDICIÓN Los activos no corrientes mantenidos para la venta se medirán al importe en libros o a su valor razonable menos los costos de venta, el que sea menor."
  ],
  "subcuentas": {
   "271": "Inversiones inmobiliarias. Comprende los activos previamente registrados en la cuenta 31 que la entidad ha decidido realizar a través de su venta.",
   "272": "Inmuebles, maquinaria y equipo. Comprende los activos previamente registrados en la cuenta 33, o en la cuenta 32 cuando se adquiere la propiedad legal de los activos, y que la entidad ha decidido realizar a través de su venta.",
   "273": "Intangibles. Comprende los activos previamente registrados en la cuenta 34 que la entidad ha decidido realizar a través de su venta.",
   "274": "Activos biológicos. Incluye los activos previamente registrados en la cuenta 35 que la entidad ha decidido realizar a través de su venta.",
   "275": "Depreciación acumulada – Inversión inmobiliaria. Recibe por transferencia la depreciación acumulada de la inversión inmobiliaria cuando se siguió el método del costo en esa categoría de activo.",
   "276": "Depreciación acumulada – Inmuebles, maquinaria y equipo. Recibe por transferencia la depreciación acumulada de los bienes de inmuebles, maquinaria y equipo, tanto para el costo como para la revaluación.",
   "277": "Amortización acumulada – Intangibles. Recibe por transferencia la amortización acumulada de los bienes de intangibles, tanto para el costo como para la revaluación.",
   "279": "Desvalorización acumulada. Recibe la desvalorización acumulada para cada categoría de activo inmovilizado transferido a esta cuenta."
  },
  "dinamica": {
   "debe": [
    "La transferencia de la cuenta de activo de la que procede.",
    "Recuperación de la pérdida por deterioro."
   ],
   "haber": [
    "La venta del activo.",
    "Pérdida de valor por deterioro."
   ]
  },
  "comentarios": [
   "Si el activo se adquiere como parte de una combinación de negocios, se medirá por su valor razonable menos los costos de venta.",
   "La empresa no debe depreciar o amortizar los activos mientras se encuentren clasificados como mantenidos para la venta."
  ],
  "niif": [
   "NIIF 5 Activos no corrientes mantenidos para la venta y operaciones discontinuadas.",
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 36 Deterioro del valor de los activos",
   "NIC 38 Activos intangibles",
   "NIC 40 Inversiones inmobiliarias",
   "NIC 41 Agricultura"
  ]
 },
 "28": {
  "contenido": [
   "Agrupa las subcuentas que representan bienes aun no ingresados al lugar de almacenamiento de la empresa, y que serán destinados a la fabricación de productos, al consumo, mantenimiento de sus servicios, o a la venta cuando se encuentren disponibles.",
   "RECONOCIMIENTO Y MEDICIÓN Las existencias por recibir se reconocen cuando se produce la transferencia de propiedad de los bienes, de acuerdo con los términos del contrato o pedido.",
   "Las existencias por recibir se miden al costo de adquisición o valor neto de realización, el que sea menor. Cuando una reducción en el costo de adquisición de las existencias por recibir adquiridas, indique que excederá su valor neto realizable, el costo de reposición de tales existencias puede ser la medida adecuada de su valor neto realizable."
  ],
  "subcuentas": {
   "281": "Mercaderías. Comprende los bienes adquiridos para su venta, sin someterlos a procesos de transformación.",
   "284": "Materias primas. Comprende los insumos que luego ingresarán al proceso de transformación.",
   "285": "Materiales auxiliares, suministros y repuestos. Incluye los materiales, diferentes de las materias primas, que intervienen en el proceso productivo así como los repuestos y suministros que no se incorporan en aquel.",
   "286": "Envases y embalajes. Incluye los bienes complementarios para la presentación y comercialización de productos."
  },
  "dinamica": {
   "debe": [
    "El valor de las existencias por recibir y los otros desembolsos y compromisos de pago motivados por su adquisición, cuyo ingreso a los almacenes de la empresa no se ha efectuado."
   ],
   "haber": [
    "La transferencia de existencias recibidas a las cuentas correspondientes."
   ]
  },
  "comentarios": [
   "Los anticipos a proveedores se reconocen en las subcuentas 422 y 432.",
   "Cuando los anticipos están relacionados a compras de existencias ya pactados, tales anticipos se reclasifican para efectos de presentación a Existencias por recibir."
  ],
  "niif": [
   "NIC 2 Existencias"
  ]
 },
 "29": {
  "contenido": [
   "Agrupa las subcuentas que acumulan las estimaciones para cubrir la desvalorización de las existencias.",
   "RECONOCIMIENTO Y MEDICIÓN En esta cuenta se registra el efecto de la valuación de existencias, al considerar la base de costo o valor neto de realización, el menor."
  ],
  "subcuentas": {},
  "dinamica": {
   "debe": [
    "Los retiros de la contabilidad de las existencias sin valor, que no se puedan realizar mediante su venta.",
    "La reversión de las desvalorizaciones reconocidas previamente."
   ],
   "haber": [
    "La estimación de la desvalorización de existencias."
   ]
  },
  "comentarios": [
   "Cuando las existencias destinadas para la venta o para ser utilizadas directa o indirectamente en la producción pierden valor, se reconoce esa desvalorización.",
   "La desvalorización de existencias puede originarse: en la obsolescencia, en la disminución del valor de mercado, o en daños físicos o pérdida de su calidad de utilizable en el propósito de negocio. El efecto financiero de dicha desvalorización, es que el monto invertido en las existencias no podrá ser recuperado a través de la venta de la mercadería o producto terminado. En el caso de existencias que serán incorporadas directa o indirectamente en los proceso productivos, para la elaboración de productos terminados, la disminución de su costo de adquisición puede indicar que el costo de esos productos terminados (en los que se incorporarán) exceden su valor neto realizable, en cuyo caso, el costo de reposición puede ser la medida adecuada de su valor neto realizable."
  ],
  "niif": [
   "NIC 2 Existencias ELEMENTO 3: ACTIVO INMOVILIZADO Incluye las cuentas de la 30 hasta la 39. Comprende: las inversiones mobiliarias e inmobiliarias; los inmuebles, maquinaria y equipo; los activos biológicos; los intangibles; y, los otros activos que no son de realización en el corto plazo. Asimismo, se encuentran las inversiones inmobiliarias y los inmuebles, maquinaria y equipo adquiridos bajo la modalidad de arrendamiento financiero. Se espera que estos activos permanezcan en la entidad más de un período o ejercicio económico completo."
  ]
 },
 "30": {
  "contenido": [
   "Comprende los activos financieros (no derivados) cuyos cobros son de cuantía fija o determinable, sus vencimientos son fijos, y respecto de los cuales, la empresa tiene la intención, así como la capacidad, de conservarlos hasta su vencimiento, diferentes de: a) los que, en el momento de reconocimiento inicial, la entidad haya designado para contabilizar al valor razonable, con cambios en los resultados (negociables); b) los que la entidad haya designado como activos disponibles para la venta; y, c) los que cumplan con la definición de préstamos y partidas por cobrar.",
   "Además, incluye los instrumentos financieros representativos de derecho patrimonial en otras empresas.",
   "Inversiones en acciones o participaciones, incluyendo a las entidades relacionadas, los certificados de participación de fondos, las participaciones en asociaciones en participación, entre otros.",
   "RECONOCIMIENTO Y MEDICIÓN Se reconoce la inversión a ser mantenida hasta el vencimiento a su valor razonable, más los costos de transacción directamente atribuibles a la compra o a su emisión.",
   "Los instrumentos financieros representativos de deuda se registrarán al costo de adquisición, el que incluye todos los costos de transacción.",
   "Con posterioridad a su reconocimiento inicial, las inversiones a ser mantenidas hasta el vencimiento serán medidas al costo amortizado utilizando el método de la tasa de interés efectiva.",
   "En el caso de inversiones en acciones y/o participaciones en subsidiarias y asociadas, éstas se deben medir al valor de participación patrimonial, con posterioridad a su reconocimiento inicial. En la oportunidad del reconocimiento inicial, debe medirse y registrarse, si existiese, cualquier plusvalía mercantil contenida en el costo de adquisición cuando se trata de una combinación de negocios. Otras inversiones en acciones y/o participaciones se medirán al costo.",
   "Cuando exista evidencia de deterioro del valor de la inversión, el importe en libros del valor del activo se reducirá mediante una cuenta de valuación, cuando no se sigue el método de participación patrimonial."
  ],
  "subcuentas": {
   "301": "Inversiones a ser mantenidas hasta el vencimiento. Instrumentos financieros representativos de deuda adquiridos. Entre ellos están los valores emitidos o garantizados, por el Estado, por el sistema financiero, por empresas, u otras entidades.",
   "302": "Instrumentos financieros representativos de derecho patrimonial.",
   "308": "Inversiones mobiliarias – Acuerdo de compra. Incluye los acuerdos de compra por las inversiones a ser mantenidas hasta el vencimiento, así como los instrumentos financieros representativos de derecho patrimonial, cuando son liquidados en una base convencional."
  },
  "dinamica": {
   "debe": [
    "El costo de adquisición de los instrumentos financieros.",
    "El valor de las acciones recibidas por distribución de utilidades como pago de deudores.",
    "La diferencia de cambio en caso se incremente el tipo de cambio, cuando se trate de instrumentos financieros representativos de deuda.",
    "La recuperación de valor por la aplicación del costo amortizado bajo el método de la tasa de interés efectiva, o por la aplicación del método de participación patrimonial."
   ],
   "haber": [
    "El costo de los instrumentos financieros vendidos o redimidos.",
    "La diferencia de cambio si disminuye el tipo de cambio, en el caso de instrumentos financieros representativos de deuda.",
    "La reducción del valor por la aplicación del costo amortizado bajo el método de la tasa de interés efectiva, o por la aplicación del método de participación patrimonial.",
    "Los dividendos recibidos correspondientes a períodos anteriores a la fecha de adquisición."
   ]
  },
  "comentarios": [
   "Las inversiones en instrumentos de deuda, a ser mantenidas hasta el vencimiento, cuyo valor se encuentre expresado en moneda extranjera, se re- expresarán a la tasa de cambio aplicable a la fecha del Balance General.",
   "De acuerdo a lo establecido por la Resolución Nº 038-2005-EF/93.01 del Consejo Normativo de Contabilidad, se mantiene en el Perú la aplicación del Método de Participación Patrimonial en la elaboración de los estados financieros individuales, para la valuación de las inversiones en subsidiarias, entidades controladas conjuntamente y asociadas, en adición a los métodos establecidos en la NIC 27 Estados financieros consolidados e individuales y en la NIC 28 Inversiones en asociadas."
  ],
  "niif": [
   "NIC 27 Estados financieros consolidados e individuales",
   "NIC 28 Inversiones en asociadas",
   "NIC 31 Participaciones en asociaciones en participación",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 2 Pagos basados en acciones",
   "NIIF 3 Combinaciones de negocios",
   "NIIF 7 Instrumentos financieros: información a revelar",
   "SIC 13 Asociación en participación – Aportes no monetarios de los participantes (ventures)"
  ]
 },
 "31": {
  "contenido": [
   "Incluye las propiedades (terrenos o edificaciones) cuya tenencia es mantenida (por el propietario o por el arrendatario que haya acordado un arrendamiento financiero), con el objeto de obtener rentas, aumentar el valor del capital o, ambos, en lugar de utilizar dichas propiedades para: a) la producción o suministro de bienes o servicios, o para fines administrativos; o, para, b) su venta en el curso normal de las operaciones.",
   "RECONOCIMIENTO Y MEDICIÓN Los bienes que componen esta cuenta deben registrarse inicialmente al costo de adquisición.",
   "Con posterioridad a su reconocimiento inicial todas las partidas de Inversiones inmobiliarias deben ser medidas a su valor razonable; o al costo o valor revaluado, menos el importe acumulado de las pérdidas por deterioro de valor y menos la depreciación acumulada, cuando el valor razonable no puede ser determinado de manera confiable.",
   "Las inversiones inmobiliarias en proceso de construcción se reconocen como bienes de inmuebles, maquinaria y equipo, hasta su terminación, oportunidad en la que se transfieren a esta cuenta.",
   "Los intereses devengados durante el período de construcción de inversiones inmobiliarias que clasifican como activos calificados (véase la NIC 23), se capitalizan hasta el momento en que el activo esté en condiciones de ser utilizado en el propósito de negocio.",
   "En el caso de activos en arrendamiento financiero, véase la cuenta 32 Activos adquiridos bajo arrendamiento financiero."
  ],
  "subcuentas": {
   "311": "Terrenos. Urbanos o rurales que se mantienen para obtener ganancias de capital o para su arrendamiento a terceros.",
   "312": "Edificaciones. Incluye los activos destinados a la obtención de rentas mediante su alquiler a terceros o mediante su incremento de valor."
  },
  "dinamica": {
   "debe": [
    "El costo de adquisición o de construcción, acondicionamiento o equipamiento.",
    "La transferencia de activos inmobiliarios de la cuenta de inmuebles, maquinaria y equipo, cuyo propósito de negocio se cambia al de este tipo de activo.",
    "La transferencia del costo de construcción incurrido (mantenido como parte de inmuebles, maquinaria y equipo durante el periodo de construcción).",
    "Los costos de financiación en el caso de activos calificados, acumulados durante la etapa de construcción.",
    "Las mejoras y renovaciones capitalizables.",
    "Los incrementos de valor por medición al valor razonable."
   ],
   "haber": [
    "El costo de las unidades vendidas o retiradas, o transferidas a la cuenta de activos no corrientes disponibles para la venta.",
    "La transferencia a la cuenta Inmuebles, maquinaria y equipo para uso del ente económico.",
    "Las disminuciones de valor por medición al valor razonable."
   ]
  },
  "comentarios": [
   "Aquellas inversiones en inmuebles cuya política contable de medición se realice a valor razonable, no están sujetas a depreciación. En el caso de no existir un mercado activo que determine dicho valor, se podrá optar por el valor razonable sobre la base de una valuación hecha por un tasador independiente.",
   "En el caso que un inmueble se utilice, en una parte para arrendar a terceros o aumentar el valor del capital y en otra, para uso en la producción o propósitos administrativos, y si estas porciones pueden ser reconocidas separadamente, la empresa deberá contabilizar en forma separada en las cuentas 31 Inversiones inmobiliarias y 33 Inmuebles, maquinaria y equipo, el valor correspondiente a cada clase de activo.",
   "Un activo que se haya dispuesto para la venta y si su importe en libros será recuperado, fundamentalmente a través de una transacción de venta, en lugar de su uso continuado, debe ser clasificado como activo no corriente mantenido para la venta, en la cuenta 27.",
   "La desvalorización de inversión inmobiliaria, cuando es llevada al costo, en tanto contengan costos de financiación, para su adecuado tratamiento contable, plantea la consideración de si tal desvalorización alcanza al costo de adquisición o producción, o al costo de financiación relacionado, o a una distribución entre ambos componentes, para efectos de la presentación en los estados financieros. Por razones prácticas, se conviene en que ante una desvalorización, el componente de costo de financiación activado es el primero que se afecta hasta agotarlo.",
   "La NIC 40 Inversiones inmobiliarias establece la clasificación de la propiedad inmobiliaria, mientras se encuentra en construcción, como parte de los inmuebles."
  ],
  "niif": [
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 17 Arrendamientos",
   "NIC 23 Costos de financiamiento",
   "NIC 36 Deterioro del valor de los activos",
   "NIC 40 Inversiones inmobiliarias",
   "NIIF 5 Activos no corrientes mantenidos para la venta y operaciones discontinuadas"
  ]
 },
 "32": {
  "contenido": [
   "Agrupa las subcuentas en las que se registra el costo del activo que se adquiere bajo la modalidad de arrendamiento financiero.",
   "RECONOCIMIENTO Y MEDICIÓN Los bienes que componen esta cuenta deben registrarse inicialmente por el que resulte menor entre el valor razonable de la propiedad y el valor presente de los pagos mínimos por arrendamiento.",
   "Con posterioridad a su reconocimiento inicial, los activos adquiridos en arrendamiento financiero deben seguir las políticas de medición establecidas para cada tipo de activo del que se trate: los inmuebles, maquinaria y equipo según la NIC 16, y las inversiones inmobiliarias según la NIC 40."
  ],
  "subcuentas": {
   "321": "Inversiones inmobiliarias. Comprende los activos que se mantienen para obtener ganancias de capital o para su arrendamiento a terceros, adquiridos bajo la modalidad de arrendamiento financiero.",
   "322": "Inmuebles, maquinaria y equipo. Comprende los activos adquiridos en arrendamiento financiero, que la empresa utiliza para la producción o suministro de bienes y servicios, para arrendarlos a terceros o para propósitos administrativos, y que se espera usar por más de un ejercicio económico."
  },
  "dinamica": {
   "debe": [
    "El costo de adquisición y otros directamente relacionados.",
    "Véase también la dinámica de las cuentas 31 y 33."
   ],
   "haber": [
    "La desapropiación o devolución del bien.",
    "El traslado a la cuenta de inversiones inmobiliarias e inmuebles, maquinaria y equipo, según sea el caso, al finalizar el contrato de arrendamiento financiero al ejercer la opción de compra.",
    "Véase también la dinámica de las cuentas 31 y 33."
   ]
  },
  "comentarios": [
   "Esta cuenta acumula diversos tipos de activos, con la particularidad de haber sido adquiridos mediante operación de financiamiento del tipo arrendamiento financiero. La presentación de cada una de estas subcuentas corresponde efectuarla conjuntamente con los activos adquiridos de la misma naturaleza, financiados con otras formas de endeudamiento."
  ],
  "niif": [
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 17 Arrendamientos",
   "NIC 40 Inversiones inmobiliarias",
   "SIC 27 Evaluación de lo sustancial en una serie de transacciones que tiene la forma legal de un arrendamiento",
   "CINIIF 4 Determinación de si un acuerdo contiene un arrendamiento",
   "CINIIF 5 Derechos por la participación en fondos para el retiro del servicio, la restauración y la rehabilitación medioambiental"
  ]
 },
 "33": {
  "contenido": [
   "Agrupa los activos tangibles que: a) posee una empresa para su uso en la producción o suministro de bienes y servicios, para arrendarlos a terceros o para propósitos administrativos; y b) se espera usar durante más de un período.",
   "correspondientes a inversiones inmobiliarias, las que una vez concluidas se transfieren a la cuenta 31.",
   "RECONOCIMIENTO Y MEDICIÓN Los bienes que componen esta cuenta deben registrarse inicialmente al costo de adquisición o de construcción, o al valor razonable determinado mediante tasación, en el caso de bienes aportados, donados, recibidos en pago de deuda, y otros similares.",
   "El costo incluye el total del valor de compra más todos los gastos necesarios para tener el activo en el lugar y condiciones que permitan su funcionamiento y uso en las condiciones planeadas. En particular este tipo de bienes incorporan como parte del costo, aquellos relacionados con la instalación y desmantelamiento de los bienes.",
   "Los intereses devengados durante el período de construcción e instalación de activos calificados (véase la NIC 23) de Inmuebles, maquinaria y equipo, se capitalizan hasta el momento en que el activo esté en condiciones de entrar en servicio, independientemente de la fecha en que sea trasladado a la respectiva cuenta de inmuebles, maquinaria y equipo. A partir de esta ocurrencia los intereses deben afectarse a los resultados del período.",
   "Los desembolsos posteriores a la adquisición de un bien de inmuebles, maquinaria y equipo, deben añadirse al valor en libros del activo cuando sea probable que de los mismos se deriven beneficios económicos futuros adicionales a los originalmente evaluados, siguiendo pautas normales de rendimiento para el activo existente.",
   "Con posterioridad a su reconocimiento inicial como un activo, todas las partidas de Inmuebles, maquinaria y equipo, deben ser mantenidas en libros como sigue:",
   "- A su costo, menos el importe acumulado de las pérdidas por deterioro de valor y menos la depreciación acumulada; o, - A su valor revaluado, menos el importe acumulado de las pérdidas por deterioro de valor y menos la depreciación acumulada.",
   "En el caso de inmuebles, maquinaria y equipo adquiridos bajo la modalidad de arrendamiento financiero véase la cuenta 32."
  ],
  "subcuentas": {
   "331": "Terrenos. Comprende el valor de los terrenos destinados al uso de la entidad.",
   "332": "Edificaciones. Incluye aquellos que están destinados al proceso productivo o a uso administrativo.",
   "333": "Maquinarias y equipos de explotación. Corresponde a las que se utilizan en el proceso productivo",
   "334": "Unidades de transporte. Incluye los vehículos motorizados y no motorizados para el transporte de bienes o para uso del personal.",
   "335": "Muebles y enseres. Comprende el mobiliario y los enseres utilizados en todos los procesos empresariales, incluyendo el administrativo.",
   "336": "Equipos diversos. Incluye los equipos no utilizados directamente en el proceso productivo, además de aquellos para el soporte administrativo.",
   "337": "Herramientas y unidades de reemplazo. Contiene herramientas de importancia material, y activos cuyo propósito es sustituir a otros en uso.",
   "338": "Unidades por recibir. Bienes de inmuebles, maquinaria y equipo adquiridos pendientes de ingreso a la entidad.",
   "339": "Construcciones y obras en curso. Bienes de las subcuentas 331 a la"
  },
  "dinamica": {
   "debe": [
    "El costo de adquisición, de las construcciones, instalaciones, equipamiento, montaje de bienes, necesarios para estar en condiciones de ser utilizados.",
    "El valor de los activos, convenido o determinado mediante tasación de los inmuebles, y avalúo técnico de los otros bienes, recibidos por cesión, donación o aporte otorgado.",
    "Las mejoras capitalizables.",
    "La revaluación de activos.",
    "Las transferencias de cuentas de inversión inmobiliaria.",
    "Los costos de financiación, con abono a la subcuenta 725.",
    "Las reclasificaciones entre cuentas en lo que hace a unidades por recibir, y entre cuentas o inversiones inmobiliarias en lo que hace a construcciones en proceso, y de activos no corrientes mantenidos para la venta."
   ],
   "haber": [
    "El valor de las unidades vendidas, cedidas, o dadas de baja.",
    "El costo de los bienes devueltos a los proveedores.",
    "Las transferencias a cuentas de inversión inmobiliaria y activos no corrientes disponibles para la venta.",
    "La desvalorización de inmuebles, maquinaria y equipo hasta por el monto revaluado previamente.",
    "Las reclasificaciones entre cuentas en lo que hace a unidades por recibir, y entre cuentas o inversiones inmobiliarias en lo que hace a construcciones en proceso."
   ]
  },
  "comentarios": [
   "Los costos de mantenimientos menores y reparaciones de los activos se reconocen como gasto en el momento en que se incurren.",
   "Un activo que se haya dispuesto para la venta y si su importe en libros será recuperado, fundamentalmente a través de una transacción de venta en lugar de su uso continuado, debe ser clasificado como activo no corriente mantenido para la venta.",
   "Los inmuebles adquiridos o construidos por una entidad para su comercialización serán clasificados como existencias.",
   "Los montos revaluados de cada tipo de activo se deben registrar en las subcuentas que para el efecto existen, separados del costo. En consecuencia, el valor revaluado podrá ser disminuido por el deterioro de valor que pueda sufrir posteriormente el activo.",
   "El deterioro de valor de inmuebles, maquinaria y equipo, cuando se lleva al costo, en tanto contengan costos de financiación, para su adecuado tratamiento contable, plantea la consideración de si tal deterioro alcanza al costo de adquisición o producción, o al costo de financiación relacionado, o a una distribución entre ambos componentes, para efectos de la presentación en los estados financieros. Por razones prácticas, se conviene en que ante un deterioro de valor del activo, el componente de costo de financiación activado es el primero que se afecta hasta agotarlo.",
   "La divisionaria 3391 Adaptación de terrenos, como parte de la subcuenta 339 Construcciones y obras en curso, acumula el costo invertido en la adecuación de terrenos, cuyo propósito (destino) aun no ha sido decidido."
  ],
  "niif": [
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 17 Arrendamientos",
   "NIC 23 Costos de financiamiento",
   "NIC 36 Deterioro del valor de los activos",
   "NIC 40 Inversiones inmobiliarias",
   "NIIF 5 Activos no corrientes mantenidos para la venta y operaciones discontinuadas",
   "CINIIF 1 Cambios en pasivos existentes por retiro del servicio, restauración y similares",
   "CINIIF 4 Determinación de si un acuerdo contiene un arrendamiento",
   "CINIIF 5 Derechos por la participación en fondos para el retiro del servicio, la restauración y la rehabilitación medioambiental"
  ]
 },
 "34": {
  "contenido": [
   "Agrupa las subcuentas que representan activos identificables, de carácter no monetario y sin sustancia o contenido físico.",
   "RECONOCIMIENTO Y MEDICIÓN Los Intangibles se registran inicialmente al costo de adquisición que incluye todos los desembolsos identificables directamente.",
   "Después del tratamiento inicial los activos intangibles se miden al costo menos la amortización acumulada y menos las pérdidas por deterioro. Si la empresa opta por el modelo de la revaluación, se miden a su valor revaluado menos su amortización acumulada y menos cualquier pérdida acumulada por desvalorización."
  ],
  "subcuentas": {
   "341": "Concesiones, licencias y otros derechos. Incluye los derechos obtenidos para desarrollar proyectos o para explorar y/o explotar recursos naturales, entre otros; permisos para efectuar operaciones específicas, por tiempo limitado o indeterminado; y concesiones (de servicios públicos) adquiridas del Estado.",
   "342": "Patentes y propiedad industrial. Costos de adquisición, desarrollo y registro de patentes y otros activos de propiedad industrial.",
   "343": "Programas de computadora (software). Costos de inversión en el desarrollo interno o costo de adquisición de programas de procesamiento electrónico de datos.",
   "344": "Costos de exploración y desarrollo. Comprende los costos que representan la búsqueda de reservas de recursos naturales.",
   "345": "Fórmulas, diseños y prototipos. Incluye los costos de desarrollo de fórmulas, diseños y prototipos obtenidos con nuevos conocimientos científicos y tecnológicos aprovechables por la empresa, de los que se obtendrán beneficios económicos futuros.",
   "346": "Reservas de recursos extraíbles. Comprende el costo de adquisición de las reservas probadas de recursos naturales extraíbles.",
   "347": "Plusvalía mercantil. Corresponde al exceso en la fecha de adquisición, del costo de combinación de negocios sobre el valor razonable de los activos identificables adquiridos menos el de los pasivos asumidos.",
   "349": "Otros activos intangibles. Para reconocer cualquier otro activo intangible no registrado en las subcuentas anteriores."
  },
  "dinamica": {
   "debe": [
    "El costo de adquisición de los activos intangibles.",
    "El valor asignado a los intangibles recibidos como donación o aporte.",
    "La revaluación de activos intangibles."
   ],
   "haber": [
    "El costo de los intangibles vendidos o retirados.",
    "La desvalorización de intangibles hasta por el monto revaluado previamente."
   ]
  },
  "comentarios": [
   "Los intangibles en fase de investigación no se incorporan como activos, ni aquellos, que estando en fase de desarrollo, no cumplen las condiciones establecidas en la NIC 38.",
   "La capitalización de los costos de exploración y desarrollo de recursos naturales es permitida, más no exigida, por la NIIF 6 Exploración y evaluación de recursos minerales, sujeta a evaluaciones anuales de pérdidas por desvalorización."
  ],
  "niif": [
   "NIC 23 Costos de financiamiento",
   "NIC 36 Deterioro del valor de los activos",
   "NIC 38 Activos intangibles",
   "NIIF 3 Combinaciones de negocios",
   "NIIF 5 Activos no corrientes mantenidos para la venta y operaciones discontinuadas",
   "NIIF 6 Exploración y evaluación de recursos minerales",
   "SIC 29 Revelación – Convenios de concesión de servicios",
   "SIC 32 Activos intangibles – Costo de un sitio web",
   "CINIIF 4 Determinación de si un acuerdo contiene un arrendamiento",
   "CINIIF 12 Acuerdos de Concesión de servicios"
  ]
 },
 "35": {
  "contenido": [
   "Agrupa a los animales vivos y las plantas que forman parte de una actividad agrícola, pecuaria y/o piscícola, que resultan de la gestión por parte de una entidad, de las transformaciones de los activos biológicos, ya sea para destinarlos a la venta, para dar lugar a productos agrícolas (activos realizables) o para convertirlos en otros activos biológicos diferentes.",
   "RECONOCIMIENTO Y MEDICIÓN El activo biológico debe ser medido, al momento de su reconocimiento inicial como en la fecha de cada balance, a su valor razonable menos los costos estimados en el punto de venta. El valor razonable en el reconocimiento inicial es generalmente el costo de adquisición. En el caso de que el valor razonable no pueda ser medido confiablemente, y sólo en el momento del reconocimiento inicial, se puede reconocer y medir el activo biológico al costo menos la depreciación acumulada y menos su deterioro."
  ],
  "subcuentas": {
   "351": "Activos biológicos en producción. Activos de origen animal o vegetal que se encuentran en etapa productiva.",
   "352": "Activos biológicos en desarrollo. Activos de origen animal o vegetal en crecimiento, que aún no alcanzaron su etapa productiva."
  },
  "dinamica": {
   "debe": [
    "La adquisición del activo biológico.",
    "Incrementos por medición a valor razonable."
   ],
   "haber": [
    "El retiro o venta de los activos biológicos.",
    "Reducción por medición a valor razonable."
   ]
  },
  "comentarios": [
   "Las ganancias o pérdidas surgidas por causa del reconocimiento inicial de un activo biológico a su valor razonable menos los costos estimados en el punto de venta, así como las surgidas por los cambios sucesivos en el valor razonable menos los costos estimados hasta el punto de venta, deben ser incluidos en la ganancia o pérdida neta del ejercicio en que se produzcan. Esta cuenta se relaciona con la divisionaria 6622 Activos biológicos de la cuenta 66 Pérdida por medición de activos no financieros al valor razonable, y con la divisionaria 7622 Activos biológicos de la cuenta 76 Ganancia por medición de activos no financieros al valor razonable.",
   "Los activos que se hayan dispuesto para la venta y si su importe en libros será recuperado, fundamentalmente a través de una transacción de venta en lugar de su uso continuado, deben ser clasificados como activos no corrientes mantenidos para la venta."
  ],
  "niif": [
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 36 Deterioro del valor de los activos",
   "NIC 41 Agricultura",
   "NIIF 5 Activos no corrientes mantenidos para la venta y operaciones discontinuadas"
  ]
 },
 "36": {
  "contenido": [
   "Agrupa las subcuentas de medición de deterioro para: inmuebles, maquinaria y equipo; activos intangibles; activos biológicos; e inversiones inmobiliarias y mobiliarias, individualmente considerados o por grupos homogéneos.",
   "RECONOCIMIENTO Y MEDICIÓN Se registrará la desvalorización de los activos mencionados en las subcuentas precedentes, en los casos en que el valor recuperable de un activo, ya sea por su precio de venta neto o valor presente de las estimaciones de los flujos de efectivo futuros que se prevé resultara del aprovechamiento de dichos activos, exceda su valor neto en libros (deduciendo la depreciación, amortización o agotamiento, según sea el caso, y las estimaciones de desvalorización anteriores).",
   "La pérdida por disminución de valor debe ser reconocida en el estado de ganancias y pérdidas cuando se trate de activos contabilizados a su costo; o como una disminución en su valor revaluado cuando se trate de activos que se llevan en libros al valor revaluado, hasta el límite del incremento por revaluación; los excesos se reconocen en resultados.",
   "Es posible revertir una pérdida por deterioro sólo si se presentan cambios en estimados anteriores y hasta que el valor no supere el costo neto del activo si éste hubiese seguido depreciándose o amortizándose normalmente."
  ],
  "subcuentas": {
   "361": "Desvalorización de inversiones inmobiliarias. Comprende la estimación del deterioro de los activos que se mantienen para obtener ganancias de capital o para su arrendamiento a terceros, cuando para su registro se ha empleado el método del costo. Estos activos son registrados en la cuenta 31.",
   "363": "Desvalorización de inmuebles, maquinaria y equipo. Comprende la estimación del deterioro de los activos registrados en la cuenta 33.",
   "364": "Desvalorización de intangibles. Comprende la estimación del deterioro de los activos registrados en la cuenta 34.",
   "365": "Desvalorización de activos biológicos. Comprende la estimación del deterioro de los activos registrados en la cuenta 35, cuando son medidos al costo menos la depreciación y el deterioro acumulados.",
   "366": "Desvalorización de inversiones mobiliarias. Incluye la estimación de pérdida de valor de los instrumentos financieros reconocidos en la cuenta 30, cuando son medidos al costo."
  },
  "dinamica": {
   "debe": [
    "La reversión de pérdidas reconocidas previamente.",
    "El importe del deterioro de los bienes retirados o vendidos.",
    "El monto del deterioro de los bienes transferidos a Activos no corrientes disponibles para la venta."
   ],
   "haber": [
    "El valor estimado de la desvalorización de activos inmovilizados."
   ]
  },
  "comentarios": [
   "La NIC 36 requiere que se evalúe por cada activo que genera flujo de efectivo, si el valor actual de esos flujos permitirá o no recuperar el valor en libros del activo. Esta evaluación deberá hacerse cuando existan evidencias que indiquen que pueden existir problemas de recuperación del valor en libros de los activos inmovilizados.",
   "Esta cuenta se relaciona con la subcuenta 685 Deterioro del valor de los activos, excepto por las inversiones mobiliarias que se reconoce en la divisionaria 6843."
  ],
  "niif": [
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 17 Arrendamientos",
   "NIC 36 Deterioro del valor de los activos",
   "NIC 38 Activos intangibles",
   "NIC 40 Inversiones inmobiliarias",
   "NIC 41 Agricultura",
   "CINIIF 10 Información financiera intermedia y deterioro del valor"
  ]
 },
 "37": {
  "contenido": [
   "Incorpora los activos que se generan por diferencias temporales deducibles entre la base contable y la base tributaria, y por el derecho a compensar pérdidas tributarias en ejercicios posteriores. Asimismo, se incluyen en esta cuenta los intereses diferidos no devengados, contenidos en cuentas por pagar.",
   "RECONOCIMIENTO Y MEDICIÓN Se reconocen activos por impuesto a la renta y participaciones de los trabajadores diferidos en la medida que resulte probable que la empresa disponga de rentas tributarias (fiscales) futuras que permitan la aplicación de las diferencias temporales deducibles, y de las pérdidas tributarias que se espera, razonablemente, compensar en ejercicios futuros.",
   "La medición, en el reconocimiento inicial y posterior, es al costo, sin ningún descuento financiero."
  ],
  "subcuentas": {
   "371": "Impuesto a la renta diferido. Contiene el efecto acumulado en el impuesto a la renta, originado en diferencias temporales deducibles, que se espera recuperar en ejercicios futuros. También acumula el efecto del escudo fiscal asociado a pérdidas tributarias que razonablemente se espera compensar en el futuro.",
   "372": "Participaciones de los trabajadores diferidas. Acumula el efecto en las participaciones de los trabajadores que se calculan sobre la base de la renta tributaria (y no contable), originada en diferencias temporales deducibles, que se espera recuperar en ejercicios futuros. También acumula el efecto del escudo fiscal asociado a pérdidas tributarias que razonablemente se espera compensar en el futuro.",
   "373": "Intereses diferidos. Comprende los intereses relacionados con cuentas por pagar, los que aun no han devengado. Incluye los intereses no devengados en medición a valor descontado."
  },
  "dinamica": {
   "debe": [
    "El importe del activo por diferencias temporales deducibles o por pérdidas tributarias arrastrables, o por cambios en la legislación, originadas en el ejercicio.",
    "El importe del activo que surja de una transacción reconocida directamente en el patrimonio neto.",
    "Los intereses no devengados incorporados por el financiamiento recibido de instituciones financieras y otras entidades."
   ],
   "haber": [
    "Las reducciones de activos por diferencias temporales deducibles, que revirtieron en el ejercicio o por cambios en la legislación.",
    "Las reducciones de activos por reversión de las diferencias temporales deducibles, reconocidas directamente en el patrimonio neto.",
    "Los intereses devengados por el financiamiento recibido."
   ]
  },
  "comentarios": [
   "Esta cuenta se relaciona con las subcuentas 872 y 882 Participaciones de los trabajadores diferidas e Impuesto a la renta diferido, respectivamente. El registro de estos activos está asociado al reconocimiento paralelo de un ahorro o ingreso por impuesto a la renta y por participación de los trabajadores.",
   "Los intereses diferidos no se presentan en los estados financieros, pues son compensados contra las cuentas por pagar que los contiene.",
   "La divisionaria 3732 Intereses no devengados en medición a valor descontado, acumula los intereses implícitos incorporados en el valor de compra de bienes y servicios. El devengado de los gastos por intereses se acumula en la divisionaria 6792 Gastos financieros en medición a valor descontado."
  ],
  "niif": [
   "NIC 12 Impuesto a la Renta",
   "SIC 21 Impuesto a la renta – Recuperación de activos revaluados no depreciables",
   "SIC 25 Impuesto a la renta – Cambios en la situación tributaria de una empresa o de sus accionistas"
  ]
 },
 "38": {
  "contenido": [
   "Agrupa las subcuentas en las que se registra el costo de adquisición de los bienes que no están destinados para la venta ni para el desarrollo de las actividades propias de la empresa, como es el caso de las obras de arte, las bibliotecas, las monedas conmemorativas, entre otros.",
   "RECONOCIMIENTO Y MEDICIÓN Los bienes que componen esta cuenta deben registrarse al costo de adquisición, o a su valor razonable en el caso de bienes aportados, recibidos por donación o ingresados al patrimonio por cualquier otro concepto.",
   "El costo de adquisición incluye el total de los desembolsos por los bienes incluyendo aquellos relacionados con: honorarios profesionales, comisiones, impuestos de compra no recuperables y otros similares."
  ],
  "subcuentas": {
   "381": "Bienes de arte y cultura. Incluye obras de arte como cuadros de pintura y esculturas, así como antigüedades, libros, revistas, entre otros.",
   "382": "Diversos. Incluye monedas y joyas, y cualquier otro bien de similar naturaleza, no incluidos en la subcuenta anterior."
  },
  "dinamica": {
   "debe": [
    "Es debitado por: Es acreditado por:",
    "El costo de adquisición de los bienes de arte y cultura y otros similares que se registran en otros activos."
   ],
   "haber": [
    "El costo de adquisición de activos vendidos o retirados."
   ]
  },
  "comentarios": [
   "Para efectos de presentación en el Balance General, este rubro se presentará como última partida del activo a largo plazo."
  ],
  "niif": []
 },
 "39": {
  "contenido": [
   "Acumula la distribución sistemática del importe depreciable de un activo a lo largo de su vida útil, así como la amortización de los intangibles, y el agotamiento de recursos naturales.",
   "RECONOCIMIENTO Y MEDICIÓN La depreciación, amortización y agotamiento se reconocen a lo largo de la vida útil de los activos con los que están relacionados, siguiendo un método que refleje el patrón de consumo de beneficios económicos incorporados en el activo.",
   "En todos los casos, la vida útil resulta de una estimación, por lo que cualquier cambio en los supuestos que dan origen a la estimación, y que resulta en una nueva estimación de vida útil, debe ser reconocido a partir de la oportunidad en que tales cambios se producen.",
   "Se debe depreciar, amortizar o agotar por separado cada unidad de activo reconocido individualmente.",
   "La vida útil de cada activo se debe revisar por lo menos una vez al año, al cierre del ejercicio económico y, si las expectativas difieren de las estimaciones previas, los cambios se contabilizarán como un cambio en una estimación contable (véase la NIC 8 Políticas contables, cambios en estimaciones contables y errores)."
  ],
  "subcuentas": {
   "391": "Depreciación acumulada. Incluye la depreciación de los inmuebles, maquinaria y equipo; así como de las inversiones inmobiliarias, los activos adquiridos en arrendamiento financiero, y los activos biológicos, cuando son llevados al costo. La depreciación acumulada corresponde a los activos reconocidos en las cuentas 31, 32, 33 y 35.",
   "392": "Amortización acumulada. Incluye la amortización de activos intangibles. La amortización corresponde a los activos reconocidos en la cuenta 34, con excepción de la subcuenta 346.",
   "393": "Agotamiento acumulado. Acumula el agotamiento de los depósitos de recursos naturales adquiridos. El agotamiento corresponde a los activos reconocidos en la subcuenta 346."
  },
  "dinamica": {
   "debe": [
    "La reducción o anulación de la depreciación, amortización o agotamiento acumulados correspondiente a activos vendidos, retirados o transferidos a disponibles para la venta.",
    "La disminución de la depreciación acumulada y de la amortización acumulada, cuando los valores de revaluación son menores que el valor en libros y se sigue el método de reajuste proporcional de la depreciación y amortización, o cuando se sigue el método de eliminación de la depreciación."
   ],
   "haber": [
    "La depreciación, amortización y agotamiento del ejercicio.",
    "El incremento en la depreciación y amortización por la revaluación de los activos relacionados, cuando se sigue el método de reajuste proporcional de la depreciación y amortización."
   ]
  },
  "comentarios": [
   "La depreciación, amortización y agotamiento, acumulados, reflejan el consumo de beneficios económicos incorporados en los activos relacionados. Su presentación es la de una cuenta de valuación, reduciendo los valores de los activos relacionados.",
   "Para las inversiones inmobiliarias, se han contemplado divisionarias que distinguen entre la depreciación acumulada del costo de adquisición y los costos financieros capitalizados. En lo que hace a los inmuebles, maquinarias y equipo, donde corresponde, adicionalmente se han considerado divisionarias para acumular por separado la depreciación de la revaluación."
  ],
  "niif": [
   "NIC 12 Impuesto a la renta",
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 17 Arrendamientos",
   "NIC 38 Activos intangibles",
   "NIC 40 Inversiones inmobiliarias",
   "NIC 41 Agricultura",
   "SIC 29 Revelación – Convenios de concesión de servicios",
   "SIC 32 Activos intangibles – Costo de un sitio web",
   "CINIIF 12 Acuerdos de Concesión de servicios ELEMENTO 4: PASIVO Agrupa las cuentas de la 40 hasta la 49. Incluye todas las obligaciones presentes, que resultan de hechos pasados, respecto de las cuales se espera que fluyan recursos económicos que incorporan beneficios económicos, fuera de la empresa. Asimismo, incluye las cuentas del impuesto a la renta y participaciones de los trabajadores diferidos, que se esperan pagar en el futuro."
  ]
 },
 "40": {
  "contenido": [
   "Agrupa las subcuentas que representan obligaciones por impuestos, contribuciones y otros tributos, a cargo de la empresa, por cuenta propia o como agente retenedor, así como los aportes a los sistemas de pensiones.",
   "También incluye el impuesto a las transacciones financieras que la empresa liquida.",
   "RECONOCIMIENTO Y MEDICIÓN Los tributos y aportes a los sistemas de pensiones y de salud se reconocen a su valor nominal menos los pagos efectuados. Su valor nominal corresponde al monto calculado cuando es de cuenta propia, o retenido cuando es por cuenta de terceros, en las fechas de las transacciones."
  ],
  "subcuentas": {
   "401": "Gobierno Central. Incluye los tributos que representan ingresos del Gobierno Central, tanto por la empresa en su calidad de contribuyente como en su calidad de agente retenedor.",
   "402": "Certificados tributarios. Contiene los documentos recibidos por reintegro de tributos. Esta subcuenta es de naturaleza deudora.",
   "403": "Instituciones públicas. Incluye las obligaciones por contribuciones de la empresa en diferentes instituciones públicas, tales como las de seguridad social. Estas obligaciones se originan en los descuentos efectuados a los trabajadores y las aportaciones de la empresa.",
   "405": "Gobiernos regionales. Contemplado para la acumulación de obligaciones por tributos para los gobiernos regionales en el futuro. Por el momento, la ley no los ha establecido.",
   "406": "Gobiernos locales. Comprende el importe de tributos por concepto de licencias, arbitrios y otros impuestos municipales.",
   "407": "Administradoras de fondos de pensiones. Acumula las obligaciones por descuentos realizados a los trabajadores por aportes al Sistema privado de pensiones y al sistema público de pensiones (ONP).",
   "408": "Empresas prestadoras de servicios de salud. Incluye las obligaciones con las Empresas Prestadoras de Salud (EPS).",
   "409": "Otros costos administrativos e intereses. Incluye obligaciones por sanciones administrativas, tributarias y no tributarias, otros costos legales relacionados con deuda tributaria y otros con los niveles de gobierno en su capacidad sancionadora, e intereses moratorios y de fraccionamiento."
  },
  "dinamica": {
   "debe": [
    "El pago de la deuda tributaria, de aportes a los sistemas de pensiones y de salud.",
    "Los pagos a cuenta del impuesto a la renta de cuenta propia.",
    "El importe nominal de los certificados de reintegro tributario recibido.",
    "El IGV acreditable."
   ],
   "haber": [
    "El importe de todos los tributos a cargo de la empresa.",
    "El importe de los tributos retenidos, y aportes al sistema de pensiones.",
    "El IGV facturado.",
    "La venta o aplicación de los certificados tributarios.",
    "Los aportes a los sistemas de pensiones."
   ]
  },
  "comentarios": [
   "El detalle de las divisionarias y otras clasificaciones adicionales que se utilicen en esta cuenta, debe considerar la forma y detalle con que se liquidan los tributos de acuerdo a lo requerido por los órganos competentes para administrar tributos.",
   "Para efectos de presentación de los tributos de saldo deudor, se debe considerar el plazo en que razonablemente se espera sean aplicados, a efectos de determinar su clasificación como corriente o no corriente; su presentación corresponde al activo del balance general.",
   "En la divisionaria 4011 se registra el impuesto general a las ventas, pendiente de acreditación.",
   "Los pagos a cuentas del impuesto a la renta por cuenta propia se muestran en el activo en el balance general. Sin embargo, si al aplicarse la NIC 34 Información financiera intermedia, se determina la existencia de gasto corriente o diferido por impuesto a la renta, tales pagos a cuenta se presentarán deducidos de esos pasivos, en la presentación de información a fechas intermedias."
  ],
  "niif": [
   "Marco Conceptual (en lo referente a pasivos)",
   "NIC 12 Impuesto a la renta",
   "NIC 19 Beneficios a los trabajadores"
  ]
 },
 "41": {
  "contenido": [
   "Agrupa las subcuentas que representan las obligaciones con los trabajadores por concepto de remuneraciones, participaciones por pagar, y beneficios sociales.",
   "RECONOCIMIENTO Y MEDICIÓN Las obligaciones por remuneraciones y participaciones por pagar, tanto para los que representan beneficios a corto o largo plazos, como los beneficios posteriores al retiro de los trabajadores, se reconocen al costo que normalmente es su valor nominal. El importe total de dichos beneficios será descontado de cualquier importe ya pagado.",
   "Si existieran importes por pagar en moneda extranjera a la fecha de los estados financieros, éstos se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "411": "Remuneraciones por pagar. Comprende los sueldos, salarios, comisiones, incluyendo las remuneraciones en especie, devengadas a favor de los trabajadores de la empresa, así como las obligaciones devengadas por vacaciones y gratificaciones legales.",
   "413": "Participaciones de los trabajadores por pagar. Incluye las obligaciones de la empresa que, por disposiciones de ley o convenio laboral, debe pagar a sus trabajadores por concepto de participaciones en las utilidades.",
   "415": "Beneficios sociales de los trabajadores por pagar. Registra las obligaciones de la empresa por concepto de compensación por tiempo de servicios y pensiones de jubilación.",
   "419": "Otras remuneraciones y participaciones por pagar. Registra cualquier otra obligación de la empresa con sus trabajadores no considerada en las subcuentas anteriores, tales como gratificaciones extraordinarias y otros beneficios como los que se derivan de convenios colectivos."
  },
  "dinamica": {
   "debe": [
    "El pago de las obligaciones acreditadas a esta cuenta."
   ],
   "haber": [
    "Las remuneraciones por pagar.",
    "Las participaciones por pagar y otras remuneraciones devengadas.",
    "Los beneficios sociales devengados."
   ]
  },
  "comentarios": [
   "Las remuneraciones y participaciones por pagar suponen una relación de subordinación de un trabajador hacia una empresa.",
   "Las obligaciones con trabajadores independientes se reconocen dentro de la subcuenta 424 Honorarios por pagar de la cuenta 42 Cuentas por pagar comerciales – Terceros."
  ],
  "niif": [
   "NIC 19 Beneficios a los trabajadores",
   "NIC 21 Efectos de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 26 Tratamiento contable y presentación de información sobre planes de prestaciones de jubilación"
  ]
 },
 "42": {
  "contenido": [
   "Agrupa las subcuentas que representan obligaciones que contrae la empresa derivada de la compra de bienes y servicios en operaciones objeto del negocio.",
   "RECONOCIMIENTO Y MEDICIÓN Las cuentas por pagar comerciales se reconocerán por el monto nominal de la transacción, menos los pagos efectuados, lo que es igual al costo amortizado.",
   "Las cuentas en moneda extranjera pendientes de pago a la fecha de los estados financieros, se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "421": "Facturas, boletas y otros comprobantes por pagar. Obligaciones por concepto de bienes o servicios adquiridos.",
   "422": "Anticipos a proveedores. Efectivo o sus equivalentes, entregado a proveedores a cuenta de compras posteriores. Es de naturaleza deudora.",
   "423": "Letras por pagar. Obligaciones sustentadas en documentos de cambio aceptados por la empresa.",
   "424": "Honorarios por pagar. Obligaciones con personas naturales, proveedores de servicios prestados en relación de independencia."
  },
  "dinamica": {
   "debe": [
    "Los pagos efectuados a los proveedores.",
    "La disminución de las obligaciones por devoluciones de compras a los proveedores.",
    "Las notas de crédito emitidas por los proveedores.",
    "Los movimientos entre subcuentas, por ejemplo cuando se canjean las facturas por letras.",
    "La diferencia de cambio si disminuye el tipo de cambio de la moneda extranjera."
   ],
   "haber": [
    "El importe de los bienes adquiridos y servicios recibidos de los proveedores.",
    "Los movimientos entre subcuentas, por ejemplo cuando se canjean las facturas con letras.",
    "La diferencia de cambio si se incrementa el tipo de cambio de la moneda extranjera."
   ]
  },
  "comentarios": [
   "Los anticipos otorgados a proveedores, en cuanto corresponden a compra de bienes o servicios pactados, deben reclasificarse para efectos de presentación, de acuerdo con la naturaleza de la transacción. Si el anticipo no corresponde a una compra de bienes o servicios pactados, corresponde presentarse como Otras cuentas por cobrar en el balance general."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo referente a compensación de cuentas)",
   "NIC 21 Efecto de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "43": {
  "contenido": [
   "Agrupa las subcuentas que representan obligaciones que se contrae con entidades relacionadas, derivadas de la compra de bienes y servicios en operaciones objeto del negocio.",
   "RECONOCIMIENTO Y MEDICIÓN Las cuentas por pagar comerciales se reconocerán por el monto nominal de la transacción, menos los pagos efectuados, lo que es igual al costo amortizado.",
   "Las cuentas en moneda extranjera pendientes de pago a la fecha de los estados financieros, se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "431": "Facturas, boletas y otros comprobantes por pagar. Obligaciones por concepto de bienes o servicios adquiridos.",
   "432": "Anticipos otorgados. Efectivo o sus equivalentes, entregado a cuenta de compras posteriores. Es de naturaleza deudora.",
   "433": "Letras por pagar. Obligaciones sustentadas en documentos de cambio aceptados por la empresa.",
   "434": "Honorarios por pagar. Incluye las obligaciones con Gerentes, Directores u otros funcionarios de empresas relacionadas."
  },
  "dinamica": {
   "debe": [
    "Lo pagos efectuados.",
    "La disminución de las obligaciones por devoluciones de compras.",
    "Notas de crédito emitidas por entidades relacionadas.",
    "Los movimientos entre subcuentas, por ejemplo cuando se canjean facturas por letras.",
    "La diferencia de cambio si disminuye el tipo de cambio de la moneda extranjera."
   ],
   "haber": [
    "El importe de los bienes adquiridos y servicios recibidos.",
    "Los movimientos entre subcuentas, por ejemplo cuando se canjean facturas por letras.",
    "La diferencia de cambio si se incrementa el tipo de cambio de la moneda extranjera."
   ]
  },
  "comentarios": [
   "Los saldos que resulten deudores, en adición a la subcuenta 432, deben ser presentados como parte del activo. Su presentación en el activo es de acuerdo con la naturaleza y objeto del anticipo."
  ],
  "niif": [
   "NIC 1 Presentación de Estados Financieros",
   "NIC 21 Efecto de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 24 Revelaciones sobre entes vinculados",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "44": {
  "contenido": [
   "Agrupa las subcuentas que representan las sumas adeudadas por la empresa a los accionistas (o socios), directores y gerentes.",
   "RECONOCIMIENTO Y MEDICIÓN Las cuentas por pagar a accionistas, directores y gerentes, se reconocerán por el monto de la transacción, menos los pagos efectuados.",
   "El saldo de moneda extranjera se expresará al tipo de cambio al que se pagarían las transacciones a la fecha de los estados financieros."
  ],
  "subcuentas": {
   "441": "Accionistas (o socios). Obligaciones con los accionistas por concepto de préstamos y dividendos, entre otros.",
   "442": "Directores. Obligaciones con los directores por dietas u otros conceptos.",
   "443": "Gerentes. Obligaciones con los gerentes por conceptos diferentes a las remuneraciones."
  },
  "dinamica": {
   "debe": [
    "Los pagos efectuados a los accionistas, directores y gerentes.",
    "La diferencia de cambio si disminuye el tipo de cambio de la moneda extranjera."
   ],
   "haber": [
    "Los préstamos recibidos de accionistas (o socios).",
    "Los dividendos declarados a favor de los accionistas (o socios) menos cualquier impuesto o retención.",
    "Las dietas devengadas a favor de los directores.",
    "Las obligaciones con gerentes, diferentes de las remuneraciones.",
    "La diferencia de cambio, si se incrementa el tipo de cambio de la moneda extranjera."
   ]
  },
  "comentarios": [
   "En esta cuenta sólo se incluye las transacciones realizadas con accionistas personas naturales; las realizadas con personas jurídicas se presentan en la cuenta 47."
  ],
  "niif": [
   "NIC 21 Efecto de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 24 Revelaciones sobre entes vinculados",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "45": {
  "contenido": [
   "Agrupa las subcuentas que representan obligaciones por operaciones de financiación que contrae la empresa con instituciones financieras y otras entidades no vinculadas, y por emisión de instrumentos financieros de deuda.",
   "También se incluyen las acumulaciones y costos financieros asociados a dicha financiación y otras obligaciones relacionadas con derivados financieros.",
   "Operaciones de préstamos en general obtenidos de bancos y otras instituciones.",
   "RECONOCIMIENTO Y MEDICIÓN Los préstamos de instituciones financieras y otros instrumentos financieros por pagar se reconocen al valor razonable, que es generalmente igual al costo.",
   "Después de su reconocimiento inicial se medirán al costo amortizado, utilizando la tasa de interés efectiva.",
   "Las cuentas en moneda extranjera pendientes de pago a la fecha de los estados financieros, se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "452": "Contratos de arrendamiento financiero. Préstamos obtenidos bajo la modalidad de arrendamiento financiero, los que están relacionados con los activos adquiridos (Inversión inmobiliaria e Inmuebles, maquinaria y equipo).",
   "453": "Obligaciones emitidas. Obligaciones por concepto de deuda emitida para la consecución de fondos, tales como papeles comerciales y bonos corporativos.",
   "454": "Otros instrumentos financieros por pagar. Obligaciones por concepto de letras; papeles comerciales; bonos; pagarés, entre otros, que la empresa ha adquirido.",
   "455": "Costos de financiación por pagar. Acumula todos los costos de financiación relacionados con obligaciones financieras contraídas de acuerdo con las subcuentas precedentes, tales como: intereses, comisiones, costos de reestructuración de deuda, legales y costos incrementales relacionados con la obligación financiera contraída.",
   "456": "Préstamos con compromisos de recompra. Registra las obligaciones contraídas con terceros referidas a préstamos obtenidos dando a cambio valores en garantía (con pacto de recompra), los que son readquiridos en plazos y condiciones predeterminados."
  },
  "dinamica": {
   "debe": [
    "Los pagos de préstamos o instrumentos financieros de deuda.",
    "Los pagos de costos de financiación.",
    "La reducción de valor por la aplicación del valor razonable.",
    "La diferencia de cambio si el tipo de cambio de la moneda extranjera baja."
   ],
   "haber": [
    "Los préstamos y otras formas de financiación recibidos de las instituciones financieras, distintos a los sobregiros en cuenta corriente.",
    "Los instrumentos financieros de deuda emitidos y colocados.",
    "Los costos de financiación devengados.",
    "Las obligaciones que se contraen por contratos de arrendamiento financiero.",
    "El incremento de valor por la aplicación del valor razonable.",
    "La diferencia de cambio si el tipo de cambio de la moneda extranjera sube."
   ]
  },
  "comentarios": [
   "Los costos de financiación deben incrementar el valor del activo cuando éste tiene las características de activo calificado a que se refiere la NIC 23.",
   "Los activos dados en garantía se registran en cuentas de orden, subcuenta 012 Valores y bienes entregados en garantía."
  ],
  "niif": [
   "NIC 17 Arrendamientos",
   "NIC 21 Efectos de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 23 Costos de financiamiento",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "46": {
  "contenido": [
   "Agrupa las subcuentas que representan cuentas por pagar a terceros, que contrae la entidad por transacciones distintas a las comerciales, tributarias, laborales y de financiamiento.",
   "RECONOCIMIENTO Y MEDICIÓN Estas subcuentas se reconocen inicialmente a su valor razonable, generalmente igual al costo. Después de su reconocimiento inicial se reconocen a su costo amortizado, utilizando el método de la tasa de interés efectiva, excepto para los pasivos por instrumentos financieros derivados y pasivos financieros por compromiso de venta, los que deben reflejar el valor razonable de los instrumentos relacionados.",
   "Las cuentas en moneda extranjera pendientes de pago a la fecha de los estados financieros, se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "461": "Reclamaciones de terceros. Obligaciones con terceros por reclamos pendientes de resolución, relacionadas con actividades comerciales y no comerciales.",
   "464": "Pasivos por instrumentos financieros. Incluye los pasivos financieros para los que existe un acuerdo de venta cuando se reconocen en la fecha de contratación, en cuyo caso las variaciones posteriores se reconocen en la subcuenta 563; también acumulan los pasivos financieros por variaciones en los valores razonables cuando el acuerdo de venta se reconoce en la fecha de liquidación.",
   "465": "Pasivos por compra de activo inmovilizado. Obligaciones por compra de activos inmovilizados a terceros.",
   "467": "Depósitos recibidos en garantía. Importes recibidos por la empresa por contratos o convenios como condición de garantía.",
   "469": "Otras cuentas por pagar diversas. Cualquier cuenta por pagar a terceros no considerada en las subcuentas anteriores, incluyendo las subvenciones gubernamentales sujetas al cumplimiento de condiciones o distribuibles en más de un periodo."
  },
  "dinamica": {
   "debe": [
    "Los pagos efectuados por • Las reclamaciones de terceros.",
    "acreencias reconocidas en esta cuenta.",
    "La devolución de los depósitos recibidos en garantía.",
    "La diferencia de cambio si disminuye el tipo de cambio de la moneda extranjera.",
    "El cumplimiento de los compromisos de venta."
   ],
   "haber": [
    "Las obligaciones con terceros por compra de activos inmovilizados.",
    "Los depósitos que se reciben de terceros en calidad de garantía por préstamos otorgados u otras operaciones contractuales.",
    "La diferencia de cambio si el tipo de cambio de la moneda extranjera sube.",
    "Los compromisos de venta cuando se reconocen en la fecha de contratación y las variaciones de dichos compromisos reconocidos en la fecha de contratación o liquidación."
   ]
  },
  "comentarios": [
   "Los subsidios gubernamentales (subcuenta 469) pueden estar sujetos al cumplimiento de condiciones, y por lo tanto, de haberse recibido de manera anticipada se reconoce un pasivo por la obligación de devolver tal subsidio (subvención) en caso de incumplimiento. En otros casos, las subvenciones recibidas deben reconocerse a lo largo de períodos en que compensará costos relacionados. La divisionaria de ingresos relacionada es la 7591."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo relacionado con la compensación de cuentas)",
   "NIC 20 Tratamiento contable de los subsidios gubernamentales y revelaciones referentes a la asistencia gubernamental",
   "NIC 21 Efectos de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar",
   "SIC 15 Arrendamientos operativos – Incentivos"
  ]
 },
 "47": {
  "contenido": [
   "Agrupa las subcuentas que representan obligaciones a favor de empresas relacionadas, que contrae la entidad por operaciones diferentes a las comerciales y a las obligaciones financieras.",
   "Asimismo, incluye las obligaciones que con carácter similar se distribuye en otros tipos de organización.",
   "RECONOCIMIENTO Y MEDICIÓN Las obligaciones con entidades relacionadas se reconocerán inicialmente por el monto de la transacción. Posteriormente se medirán a su costo amortizado, utilizando el método de la tasa de interés efectiva menos los pagos realizados.",
   "Las cuentas en moneda extranjera pendientes de pago a la fecha de los estados financieros, se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "471": "Préstamos. Financiamiento obtenido, sujeto o no a costos financieros.",
   "472": "Costos de financiación. Incluye los costos de financiación relacionados con las obligaciones financieras.",
   "473": "Anticipos recibidos. Efectivo o sus equivalentes, recibido en calidad de anticipos a ser aplicados a cuenta de compras posteriores.",
   "474": "Regalías. Obligaciones originadas en el uso o explotación de intangibles que posee otra entidad, y que se determina de acuerdo con el contrato que sustente las regalías.",
   "475": "Dividendos. Comprende las obligaciones con los accionistas, como remuneración al capital invertido, por declaración de dividendos.",
   "477": "Pasivo por compra de activo inmovilizado. Obligaciones por compra de activos inmovilizados.",
   "479": "Otras cuentas por pagar diversas. Obligaciones con entidades relacionadas por conceptos distintos de las subcuentas precedentes."
  },
  "dinamica": {
   "debe": [
    "Los pagos efectuados por los conceptos acreditados en esta cuenta.",
    "La diferencia de cambio, si disminuye el tipo de cambio de la moneda extranjera.",
    "COMENTARIO Para facilitar la presentación de saldos, las entidades pueden distinguir los saldos de obligaciones sujetas a costos financieros de aquellas no sujetas a dichos costos.",
    "Los pasivos por compra de activos inmovilizados facilitan la preparación del estado de flujos de efectivo, en lo que corresponde a la determinación de flujos obtenidos o aplicados en las actividades de inversión. Véase la NIC 7 Estado de flujos de efectivo."
   ],
   "haber": [
    "Los préstamos recibidos.",
    "Los costos de financiación, las regalías y los dividendos.",
    "Los anticipos recibidos.",
    "La obligación por compra de activo inmovilizado.",
    "La diferencia de cambio, si el tipo de cambio de la moneda extranjera sube."
   ]
  },
  "comentarios": [],
  "niif": [
   "NIC 21 Efectos de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 24 Revelaciones sobre entes vinculados",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar",
   "CINIIF 1 Cambios en pasivos existentes por retiro del servicio, restauración y similares"
  ]
 },
 "48": {
  "contenido": [
   "Agrupa las subcuentas que expresan los valores estimados por obligaciones de monto y oportunidad inciertos.",
   "Existe obligación implícita sólo si la empresa tiene un plan formal y detallado para proceder y se ha producido una expectativa válida entre los afectados.",
   "Obligaciones legales, contractuales o implícitas de la empresa o compromisos adquiridos para prevenir o reparar daños sobre el medio ambiente, salvo las que tengan origen en el desmantelamiento, retiro o rehabilitación del activo inmovilizado.",
   "RECONOCIMIENTO Y MEDICIÓN Una provisión se debe reconocer sólo cuando: a) la entidad tiene una obligación presente como resultado de un suceso pasado; b) es probable que la entidad tenga que desprenderse de recursos que involucren beneficios económicos, para pagar la obligación; y c) puede estimarse de manera fiable el importe de la obligación.",
   "Las provisiones en moneda extranjera a la fecha de los estados financieros, se expresarán al tipo de cambio aplicable a las transacciones a dicha fecha."
  ],
  "subcuentas": {
   "481": "Provisión para litigios. Estimación de la provisión en casos de litigios en curso.",
   "482": "Provisión por desmantelamiento, retiro o rehabilitación del inmovilizado. Importe estimado de los costos de desmantelamiento o retiro del activo inmovilizado, así como la rehabilitación del lugar donde se encuentra. La obligación se reconoce paralelamente con el activo.",
   "483": "Provisión para reestructuraciones. Estimación de los costos que surgen de una reestructuración, como por ejemplo en la venta o liquidación de una línea de actividad, la clausura de emplazamiento de la entidad en un país o región, o los cambios en la estructura gerencial.",
   "485": "Provisión para gastos de responsabilidad social. Comprende las obligaciones por los gastos en los que la empresa estima incurrir en la atención de aspectos de responsabilidad social.",
   "486": "Provisión para garantías. Incluye la estimación de gastos a incurrir por la reparación o reposición de activos vendidos.",
   "489": "Otras provisiones. Comprende cualquier otra provisión no incluida en las subcuentas precedentes."
  },
  "dinamica": {
   "debe": [
    "El desembolso de las provisiones efectuadas.",
    "El traslado a las cuentas por pagar correspondientes.",
    "La reversión de las provisiones.",
    "La diferencia de cambio, si disminuye el tipo de cambio de la moneda extranjera."
   ],
   "haber": [
    "Las provisiones estimadas para cubrir obligaciones.",
    "El incremento de la provisión por nuevas estimaciones o actualización financiera de valor.",
    "La diferencia de cambio, si se incrementa el tipo de cambio de la moneda extranjera."
   ]
  },
  "comentarios": [
   "A diferencia de las cuentas por pagar comerciales y de las obligaciones devengadas, las provisiones corresponden a obligaciones de monto u oportunidad de pago, inciertos. Una provisión es distinta a una estimación de recuperación de un activo; la primera representa una obligación, mientras que la estimación permite mostrar el monto recuperable del activo.",
   "Algunas de las subcuentas aquí contenidas se deben reconocer inicialmente al valor descontado, según lo establece la NIC 37. En esos casos, la actualización financiera de valor se reconoce en la subdivisionaria correspondiente de la cuenta 68."
  ],
  "niif": [
   "NIC 37 Provisiones, pasivos contingentes y activos contingentes",
   "CINIIF 1 Cambios en pasivos existentes por retiro del servicio, restauración y similares",
   "CINIIF 5 Derechos por la participación en fondos para el retiro del servicio, la restauración y la rehabilitación medioambiental"
  ]
 },
 "49": {
  "contenido": [
   "Incluye los pasivos por impuestos que se generan por diferencias temporales gravables (imponibles) sin efecto tributario y en actualizaciones de valor.",
   "También contiene la participación de los trabajadores diferidas cuando se determina sobre la base de un resultado tributario. Asimismo, incorpora los intereses referidos a cuentas por cobrar que aun no han devengado.",
   "NOMENCLATURA DE LAS DIVISIONARIAS 491 Impuesto a la renta diferido 492 Participaciones de los trabajadores diferidas 493 Intereses diferidos 494 Ganancia en venta con arrendamiento financiero paralelo 495 Subsidios recibidos diferidos 496 Ingresos diferidos 497 Costos diferidos 491 Impuesto a la renta diferido. Acumula los efectos del gasto contable por impuesto a la renta originado en diferencias temporales gravables, que se estima dará lugar al pago de impuesto a la renta en ejercicios futuros. Asimismo, acumula el efecto del impuesto a la renta diferido por actualización de valor sin efecto tributario, como es el caso de las revaluaciones, reconocidas directamente en el patrimonio neto.",
   "492 Participaciones de los trabajadores diferidas. Acumula el efecto del gasto en las participaciones de los trabajadores que se calculan sobre la base de la renta tributaria (y no contable), originado en diferencias temporales gravables, que se estima darán lugar al pago de participaciones en ejercicios futuros. Asimismo, acumula el efecto de las participaciones de los trabajadores diferidas por actualización de valor sin efecto tributario, como es el caso de las revaluaciones, reconocidas directamente en el patrimonio neto.",
   "493 Intereses diferidos. Incorpora los intereses relacionados con cuentas por cobrar, los que aún no han devengado. Estos intereses pueden incluir tanto aquellos que se pactan explícitamente, como los que están implícitamente contenidos en las cuentas por cobrar.",
   "494 Ganancia en venta con arrendamiento financiero paralelo. Acumula el ingreso en la venta de activos con arrendamiento financiero paralelo, el que se devenga durante el plazo del contrato del arrendamiento.",
   "495 Subsidios recibidos diferidos. Acumulan ingresos no devengados por subsidios recibidos del Estado.",
   "496 Ingresos diferidos. Incluye los ingresos que se devengan en resultados en el futuro no contenidos en las subcuentas anteriores. No incluye la contabilización de ingresos de contratos de construcción, los anticipos recibidos por venta futura de bienes o servicios, ni los adelantos por venta de bienes futuros.",
   "497 Costos diferidos. Corresponde a los costos asociados con los ingresos diferidos acumulados en la subcuenta 496.",
   "RECONOCIMIENTO Y MEDICIÓN Las transacciones acumuladas en esta cuenta se miden al costo.",
   "Se reconocen pasivos por impuesto a la renta y participaciones de los trabajadores por las diferencias temporales gravables (imponibles) en períodos futuros y por las actualizaciones de valor reconocidas directamente en el patrimonio neto."
  ],
  "subcuentas": {},
  "dinamica": {
   "debe": [
    "Disminución del impuesto a la renta y participaciones de los trabajadores diferidas por la reversión de las diferencias temporales gravables (imponibles) relacionadas.",
    "Disminución del impuesto a la renta y participaciones de los trabajadores diferidas por transacciones relacionadas con el patrimonio.",
    "Intereses devengados en el financiamiento entregado a terceros.",
    "Los costos diferidos, asociados a ingresos diferidos.",
    "El reconocimiento en resultados de los ingresos diferidos y de la ganancia en venta de activos en transacciones paralelas de arrendamiento financiero."
   ],
   "haber": [
    "El impuesto a la renta y participaciones de los trabajadores diferidas, originadas en diferencias temporales gravables (imponibles) relacionadas con transacciones que se reconocen en los resultados del período o en el patrimonio neto.",
    "El incremento de estos pasivos por cambios en la legislación tributaria en relación con el impuesto a la renta y participaciones de los trabajadores.",
    "Los intereses no devengados incorporados por el financiamiento otorgado a terceros.",
    "La ganancia en la venta de activos en transacciones con arrendamiento financiero paralelo.",
    "Los ingresos diferidos y el reconocimiento en resultados de los costos diferidos."
   ]
  },
  "comentarios": [
   "Las subcuentas 491 y 492 se relacionan con las subcuentas 872 y 882, Participación de los trabajadores diferida e Impuesto a la renta diferido, respectivamente. El registro de estos pasivos está asociado al reconocimiento paralelo de un gasto por impuesto a la renta y por participaciones de los trabajadores diferidos.",
   "El reconocimiento en ganancias y pérdidas de ingresos por subsidios recibidos del Estado, previamente acumulados en la subcuenta 495, se registran en la divisionaria 7591.",
   "Los intereses diferidos no se presentan en los estados financieros; son compensados con la cuenta por cobrar correspondiente, en tanto constituyen intereses no devengados.",
   "La NIC 18 Ingresos, de manera consistente con otras normas que involucran financiamiento otorgado o recibido, requiere la diferenciación entre los componentes comerciales y financieros en las transacciones con terceros. Así, cuando una cuenta por cobrar originada en una venta contiene intereses, sin diferenciarlos, se requiere el reconocimiento por separado del ingreso por ventas, del de intereses, para lo cual expone la medición a valor actual de las cuentas por cobrar."
  ],
  "niif": [
   "NIC 12 Impuesto a la renta",
   "NIC 18 Ingresos (en lo concerniente al reconocimiento de intereses)",
   "NIC 20 Tratamiento contable de los subsidios gubernamentales y revelaciones referentes a la asistencia gubernamental",
   "SIC 21 Impuesto a la renta – Recuperación de activos revaluados no depreciables",
   "SIC 25 Impuesto a la renta – Cambios en la situación tributaria de una empresa o de sus accionistas ELEMENTO 5: PATRIMONIO NETO Agrupa las cuentas de la 50 hasta la 59. Las transacciones patrimoniales provienen de aportes efectuados por accionistas o partícipes, de los resultados generados por la entidad, y de las actualizaciones de valor. Todas ellas, modifican el patrimonio neto en su conjunto."
  ]
 },
 "50": {
  "contenido": [
   "Agrupa las subcuentas que representan aportes de accionistas, socios o participacionistas, cuando tales aportes han sido formalizados desde el punto de vista legal. Asimismo, se incluye las acciones de propia emisión que han sido readquiridas.",
   "RECONOCIMIENTO Y MEDICIÓN El importe del capital se registra por el monto nominal de las acciones aportado. En el caso de aportes en especies, el importe del capital relacionado corresponde a la valuación del activo a su valor razonable.",
   "Cuando existe una diferencia (en exceso o en defecto) entre el valor de las acciones recompradas y su valor nominal, o entre el valor nominal de las acciones y el monto pagado por ellas, se genera una prima (descuento) de emisión, la que se registra en la cuenta 52."
  ],
  "subcuentas": {
   "501": "Capital social. Acumula los aportes de socios, accionistas o participacionistas, en efectivo o en especie.",
   "502": "Acciones en tesorería. Acciones o participaciones de propia emisión, readquiridas por la empresa. Su naturaleza es deudora."
  },
  "dinamica": {
   "debe": [
    "Las reducciones de capital.",
    "Recompra de acciones propias."
   ],
   "haber": [
    "El capital aportado.",
    "Las capitalizaciones de reservas, acreencias y utilidades."
   ]
  },
  "comentarios": [
   "Este plan de cuentas dispone códigos a nivel de cuatro dígitos (divisionarias) para esta cuenta. Puede ser conveniente, dependiendo del tipo de instrumento patrimonial, abrir subdivisionarias adicionales que permitan una clasificación por tipo específico de instrumento patrimonial, por ejemplo acciones del tipo ordinario o preferente.",
   "No obstante la forma legal de los montos contenidos en esta cuenta, desde el punto de vista financiero, alguno de estos saldos podría corresponder a un pasivo y no a una cuenta patrimonial, como ocurre en ciertos casos con las acciones preferentes. De existir este tipo de partidas, requieren ser reclasificadas para efectos de presentación del balance general. Concordantemente, los dividendos pagados a los tenedores de dichas acciones preferentes, serán reclasificados para efectos de presentación como gastos financieros.",
   "En los casos de aportes acordados en una moneda distinta a la de curso legal, las diferencias cambiarias generadas entre la fecha del acuerdo y la fecha de pago del aporte, corresponden a una prima (descuento) de emisión.",
   "El capital aportado, las capitalizaciones de reservas, acreencias y utilidades, y las reducciones de capital, se reconocen en esta cuenta cuando se ha completado la forma legal, incluyendo la inscripción en el registro público correspondiente. Los acuerdos de accionistas, socios o participacionistas sobre tales incrementos y reducciones de capital, se mantienen hasta la oportunidad de su inscripción en el registro público, en la cuenta 52."
  ],
  "niif": [
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 2 Pagos basados en acciones",
   "NIIF 7 Instrumentos financieros: información a revelar",
   "CINIIF 8 Alcance de la NIIF 2",
   "CINIIF 11 Transacciones con acciones propias y del grupo"
  ]
 },
 "51": {
  "contenido": [
   "Agrupa las subcuentas que representa las acciones de inversión, formalizadas legalmente. Asimismo, se incluye las acciones de propia emisión que han sido readquiridas.",
   "RECONOCIMIENTO Y MEDICIÓN El importe del accionariado de inversión se registra por el monto nominal de las acciones y de las respectivas capitalizaciones efectuadas."
  ],
  "subcuentas": {
   "511": "Acciones de inversión. Comprende el valor nominal de las acciones de inversión.",
   "512": "Acciones de inversión en tesorería. Acumula acciones de inversión de propia emisión, readquiridas por la entidad. Su naturaleza es deudora."
  },
  "dinamica": {
   "debe": [
    "Las redenciones o pagos de acciones de inversión."
   ],
   "haber": [
    "Aumentos por aportes y/o capitalización de otras partidas."
   ]
  },
  "comentarios": [],
  "niif": [
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "52": {
  "contenido": [
   "Agrupa las subcuentas que representan las primas (descuentos) de emisión y los aportes y reducciones de capital que se encuentran en proceso de formalización.",
   "NOMENCLATURA DE LAS DIVISIONARIAS 521 Primas (descuento) de acciones 522 Capitalizaciones en trámite 523 Reducciones de capital pendientes de formalización 521 Primas (descuento) de acciones. Variación (exceso o defecto) entre el valor nominal de las acciones y el precio pagado por ellas en una emisión; o entre el valor nominal y su precio de compra en el caso de las acciones de tesorería. Incluye también la diferencia cambiaria que se genera entre la fecha del acuerdo y la fecha de pago del aporte, cuando éste se ha acordado en moneda distinta a la del curso legal.",
   "522 Capitalizaciones en trámite. Comprende los aportes ya efectuados que se encuentran pendientes de formalización legal e inscripción en los registros públicos. Esta subcuenta recibe los montos acordados por capitalizar de otras subcuentas patrimoniales como reservas y resultados acumulados, así como el monto de deuda con acuerdo de capitalización.",
   "523 Reducciones de capital pendientes de formalización. Incluye las reducciones de capital que se encuentran pendientes de formalización legal e inscripción en los registros correspondientes. Su naturaleza es deudora.",
   "RECONOCIMIENTO Y MEDICIÓN El importe del capital adicional se registra por el monto que excede (o que es menor) al valor nominal de las acciones, en el caso de las primas; y, en el caso de los aportes por capitalizar al valor nominal de los aportes.",
   "Las suscripciones pendientes de pago, cuando fueron acordadas en moneda extranjera, generan diferencia de cambio por las cuentas por cobrar relacionadas, la que se corrige de acuerdo al tipo de cambio aplicable a la fecha de los estados financieros."
  ],
  "subcuentas": {},
  "dinamica": {
   "debe": [
    "La capitalización parcial o total de las partidas acreditadas en esta cuenta (transferencias a las cuentas 50 y 51).",
    "El descuento de acciones cuando el valor nominal de las acciones es mayor que el importe recibido.",
    "Las reducciones de capital pendientes de formalización."
   ],
   "haber": [
    "La primas de emisión, cuando exceden el valor nominal de las acciones.",
    "Los aportes, reservas, acreencias y utilidades con acuerdo de capitalización."
   ]
  },
  "comentarios": [
   "El capital adicional es una cuenta patrimonial de tipo transitorio. Recibe el importe de transacciones por acuerdos tomados por accionistas, pero respecto de los cuales, por mandato de la Ley de Sociedades u otros dispositivos de ley, se requiere su inscripción en los registros públicos. Mientras tal inscripción no se ha producido, los saldos no deben ser transferidos a la cuenta 50. Este plan de cuentas dispone códigos al nivel de cuatro dígitos (divisionarias) para esta cuenta. Puede ser conveniente, dependiendo del tipo de instrumento patrimonial, abrir subdivisionarias adicionales que permitan una clasificación por tipo específico de instrumento patrimonial; por ejemplo acciones del tipo ordinario o preferente.",
   "No obstante la forma legal de los montos contenidos en esta cuenta, desde el punto de vista financiero, alguno de estos, podrían corresponder a un pasivo y no a una cuenta patrimonial, como ocurre en ciertos casos con las acciones preferentes. De existir este tipo de partidas, su evaluación es necesaria para efectos de su presentación en el balance general.",
   "La diferencia de cambio generada en cuentas por cobrar a los accionistas, socios o partícipes, por suscripciones pendientes de pago, se reconocen directamente en el patrimonio (primas o descuento de acciones) y no en los resultados del período."
  ],
  "niif": [
   "NIC 21 Efectos de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 2 Pagos basados en acciones",
   "NIIF 7 Instrumentos financieros: información a revelar",
   "CINIIF 2 Aportaciones de socios de entidades cooperativas e instrumentos similares",
   "CINIIF 8 Alcance de la NIIF 2",
   "CINIIF 11 Transacciones con acciones propias y del grupo"
  ]
 },
 "56": {
  "contenido": [
   "Agrupa las subcuentas que representan las ganancias por diferencias de cambio originadas por las inversiones netas en una entidad extranjera; la ganancia o pérdida en la cobertura del flujo de efectivo; las obtenidas en activos y pasivos financieros disponibles para la venta; y, las que se obtienen como resultado de la venta o compra convencional de una inversión disponible para la venta en la fecha de liquidación.",
   "Comprende las ganancias o pérdidas generadas por un instrumento financiero de cobertura de flujo de efectivo.",
   "Acumula las ganancias o pérdidas que se originan en el reconocimiento de los cambios de valor en un activo o pasivo financiero disponible para la venta, por el cual existe un acuerdo de compra o venta, calificada como una transacción convencional, cuando dicha transacción se reconoce en la fecha de liquidación.",
   "RECONOCIMIENTO Y MEDICIÓN Los resultados no realizados descritos en esta cuenta se reconocen en la oportunidad en que se mide los instrumentos financieros asociados, o en la oportunidad en que se mide la inversión permanente en una entidad extranjera.",
   "Consecuentemente, su medición resulta de los incrementos o disminuciones de los valores atribuidos a los activos o pasivos correspondientes."
  ],
  "subcuentas": {
   "561": "Diferencia en cambio de inversiones permanentes en entidades extranjeras. Incluye las ganancias o pérdidas generadas por la tenencia de una inversión neta en un negocio en el extranjero, originada en partidas monetarias.",
   "563": "Ganancia o pérdida en activos o pasivos financieros disponibles para la venta. Comprende la acumulación de las ganancias o pérdidas generadas por activos o pasivos financieros en cartera disponibles para la venta.",
   "564": "Ganancia o pérdida en activos o pasivos financieros disponibles para la venta – compra o venta convencional fecha de liquidación."
  },
  "dinamica": {
   "debe": [
    "La pérdida por diferencia de cambio en inversiones netas realizadas en una entidad extranjera.",
    "La transferencia a resultados del periodo, en el momento de la desapropiación de la inversión permanente en una entidad extranjera.",
    "La porción de la pérdida en el instrumento de cobertura que se haya determinado como una cobertura eficaz.",
    "La ganancia acumulada en la fecha de expiración de la cobertura o realización del activo o pasivo financiero disponible para la venta, transferida a resultados.",
    "Pérdida en activos financieros disponibles para la venta o incremento del valor en los pasivos financieros disponibles para la venta."
   ],
   "haber": [
    "La ganancia por diferencia de cambio en inversiones netas o de cobertura realizada en una entidad extranjera.",
    "La transferencia a resultados del ejercicio, en el momento de la desapropiación de la inversión permanente en una entidad extranjera.",
    "La porción de la ganancia en el instrumento de cobertura que se haya determinado como una cobertura eficaz.",
    "La pérdida acumulada en la fecha de expiración de la cobertura o realización del activo o pasivo financiero disponible para la venta, transferido a resultados.",
    "Ganancia en activos financieros o disminución del valor de los pasivos financieros disponibles para la venta."
   ]
  },
  "comentarios": [
   "Las subcuentas 563 y 564 se relacionan con la subcuenta 113 Activos financieros – Acuerdo de compra, y con la 464 Pasivos por instrumentos financieros."
  ],
  "niif": [
   "NIC 21 Efecto de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "57": {
  "contenido": [
   "Corresponde a las variaciones en los inmuebles, maquinaria y equipo; intangibles; e inversiones inmobiliarias, que han sido objeto de revaluación.",
   "Asimismo, incluye los excedentes de revaluación originados por acciones liberadas recibidas, y la participación en excedente de revaluación por el mantenimiento de inversiones en empresas bajo control o influencia significativa, cuando se aplica el método de participación patrimonial.",
   "RECONOCIMIENTO Y MEDICIÓN Con posterioridad al reconocimiento inicial de los activos inmovilizados, estos pueden ser medidos al valor revaluado, determinado mediante tasación o por referencia a un mercado activo, dependiendo del tipo de activo que se revalúa.",
   "Los incrementos por revaluación, netos del impuesto a la renta y participaciones de los trabajadores diferidas, así como las disminuciones de valor hasta el límite de los excedentes previamente registrados, se reconocen en esta cuenta."
  ],
  "subcuentas": {
   "571": "Excedente de revaluación. Acumula los incrementos por actualización de valor de los bienes de inmuebles, maquinaria y equipo, intangibles e inversiones inmobiliarias; en estas últimas cuando su medición es al costo. También incluye las disminuciones de valor por excedentes de revaluación, hasta el límite de los incrementos reconocidos anteriormente por el mismo concepto.",
   "572": "Excedente de revaluación – Acciones liberadas recibidas. Acumula el importe de las acciones liberadas recibidas, originadas en la capitalización de actualizaciones de valor en entidades en las que se mantiene inversiones.",
   "573": "Participación en excedente de revaluación – Inversiones en entidades relacionadas. Acumula el efecto neto de aumentos y disminuciones en la medición a valor de participación patrimonial, de inversiones en el patrimonio neto de entidades bajo control o influencia significativa (grupos económicos), cuando dicha participación patrimonial se basa en variaciones patrimoniales por actualización de valor de la entidad relacionada en cuyo patrimonio neto se ha invertido (aplicación del método de participación patrimonial)."
  },
  "dinamica": {
   "debe": [
    "La disminución del valor de los • El excedente proveniente del activos revaluados cuando existe excedente previo.",
    "La liberación del excedente de revaluación en la proporción que corresponde al monto de la depreciación o amortización del activo revaluado o del activo vendido."
   ],
   "haber": [
    "mayor valor de los activos inmovilizados, y por las acciones liberadas recibidas provenientes de capitalización en las empresas en las que se invierte.",
    "La transferencia proporcional del pasivo por impuesto a la renta y participaciones de los trabajadores diferidas.",
    "La participación en excedentes de revaluación en entidades bajo control o influencia significativa, cuando se aplica el método de participación patrimonial."
   ]
  },
  "comentarios": [
   "Las actualizaciones de valor que dan lugar a excedente de revaluación se descuentan en el monto del impuesto a la renta y participaciones de los trabajadores diferidas, a fin de determinar el incremento o disminución que afecta al patrimonio neto.",
   "El excedente de revaluación se origina en una expectativa futura de ganancia marginal, por lo que sus efectos incrementales se reconocen en el patrimonio neto y no en los resultados del período en que se revalúa."
  ],
  "niif": [
   "NIC 12 Impuesto a la renta",
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 38 Activos intangibles",
   "NIC 40 Inversiones inmobiliarias",
   "SIC 21 Impuesto a la renta – Recuperación de activos revaluados no depreciables"
  ]
 },
 "58": {
  "contenido": [
   "Agrupa las subcuentas que representa apropiaciones de utilidades, autorizadas por ley, por los estatutos, o por acuerdo de los accionistas (o socios) y, que serán destinadas a fines específicos o para cubrir eventualidades."
  ],
  "subcuentas": {
   "581": "Reinversión. Para reinvertirlas en la empresa al amparo de dispositivos de ley.",
   "582": "Legal. De acuerdo a los dispuesto por la Ley General de Sociedades.",
   "583": "Contractuales. De acuerdo con las cláusulas previstas en los contratos suscritos por la empresa.",
   "584": "Estatuarias. En cumplimiento de lo establecido en los estatutos de la empresa.",
   "585": "Facultativas. Constituidas por decisión voluntaria de los socios o accionistas.",
   "589": "Otras reservas. Cualquier otra reserva con carácter diferente a las señaladas en las subcuentas anteriores."
  },
  "dinamica": {
   "debe": [
    "La capitalización de las reservas constituidas.",
    "Las disminuciones de las reservas por acuerdos societarios o dispositivos de ley, o cobertura de resultados."
   ],
   "haber": [
    "Las detracciones de utilidades atendiendo a razones de orden legal, estatutario, contractual o por acuerdo de los accionistas (o socios)."
   ]
  },
  "comentarios": [
   "Las reservas resultan de detracciones de utilidades y consecuentemente corresponden a transacciones patrimoniales, y no de resultados."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros"
  ]
 },
 "59": {
  "contenido": [
   "Agrupa las subcuentas que representan utilidades no distribuidas y las pérdidas acumuladas sobre las que los accionistas, socios o participacionistas no han tomado decisiones.",
   "NOMENCLATURA DE LAS DIVISIONARIAS 591 Utilidades no distribuidas 592 Pérdidas acumuladas 591 Utilidades no distribuidas. Contiene las utilidades netas acumuladas así como la corrección de utilidades de años anteriores y la liberación de excedentes de revaluación y otras actualizaciones de valor. Incluye los efectos de los cambios en las políticas contables correspondientes a años anteriores, así como los originados en la corrección de errores, cuando dan lugar a utilidades.",
   "592 Pérdidas acumuladas. Contiene las pérdidas netas acumuladas así como la corrección de pérdidas de años anteriores. Incluye los efectos de los cambios en las políticas contables correspondientes a años anteriores, así como los originados en la corrección de errores, cuando dan lugar a pérdidas."
  ],
  "subcuentas": {},
  "dinamica": {
   "debe": [
    "Los ajustes de ejercicios anteriores cuando corresponda a mayores pérdidas o menores utilidades.",
    "La pérdida del ejercicio.",
    "La aplicación de las utilidades como dividendos o apropiación a reservas.",
    "Las pérdidas producto de cambios en las políticas contables y errores contables."
   ],
   "haber": [
    "Los ajustes de ejercicios anteriores cuando corresponda a mayores utilidades o menores pérdidas.",
    "La utilidad del ejercicio.",
    "La cobertura de pérdida.",
    "Las utilidades producto de cambios en las políticas contables y errores contables."
   ]
  },
  "comentarios": [
   "Las subcuentas de utilidades no distribuidas y pérdidas acumuladas recogen directamente los efectos financieros que corresponden a años anteriores, por los errores contables detectados en el ejercicio corriente, o por cambios de políticas contables incorporadas en el ejercicio corriente. Desde el punto de vista contable, entonces, tales errores y cambios en políticas contables, no requieren la modificación de registros contables de años anteriores."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros",
   "NIC 8 Políticas contables, cambios en estimaciones contables y errores ELEMENTO 6: GASTOS POR NATURALEZA Agrupa las cuentas de la 60 hasta la 69. Comprende las cuentas de gestión clasificadas por su naturaleza económica, las que representan consumos de beneficios económicos. Incluye las compras; la variación de existencias; los gastos de personal; los gastos por servicios de terceros; los gastos por tributos; otros gastos de gestión; la pérdida por medición de activos y pasivos no financieros al valor razonable; los gastos financieros; la valuación por deterioro de activos y provisiones; y el costo de ventas."
  ]
 },
 "60": {
  "contenido": [
   "Acumula las compras de bienes que efectúa la empresa, para destinarlos a la venta o para incorporarlos al proceso productivo. Las subcuentas distinguen los bienes adquiridos de acuerdo con su naturaleza y su relación con el elemento 2 de Existencias.",
   "Las subcuentas 601 a 604 acumulan el costo de compra al proveedor, mientras que la subcuenta 609 acumula todos los costos adicionales necesarios para tener las existencias en condiciones de ser utilizadas en el propósito del negocio."
  ],
  "subcuentas": {},
  "dinamica": {
   "debe": [
    "El importe de las compras, de acuerdo con su naturaleza, distinguiendo entre el costo de adquisición del proveedor y otros costos vinculados, con abono a la cuenta 42 ó 43, según corresponda a terceros o a entidades relacionadas."
   ],
   "haber": [
    "El valor de las devoluciones de las compras",
    "El saldo de esta cuenta, al cierre del período, con cargo a la cuenta 82 Valor agregado (excepto el saldo de la subcuenta 601, que se traslada a la subcuenta 801 Margen Comercial)."
   ]
  },
  "comentarios": [
   "Las compras deberán registrarse en las subcuentas que correspondan, efectuando la transferencia del costo total de las compras a las existencias del Elemento 2, a través de la cuenta 61 Variación de existencias, de manera simultánea al reconocimiento en esta cuenta.",
   "Esta cuenta incluye además las compras de bienes destinados al consumo inmediato y que por lo tanto no formarán parte de las existencias de la empresa; en este caso la transferencia por destino se hará a través de la subcuenta 791 Cargas imputables a cuentas de costos y gastos. Cuando la compra se destina al costo de activos inmovilizados, la transferencia se efectúa a la cuenta del activo inmovilizado correspondiente a través de la cuenta 72 Producción de activo inmovilizado.",
   "La subcuenta 601 Mercaderías y la divisionaria 6091 Costos vinculados con las compras de mercaderías, permiten, conjuntamente con la subcuenta 611 Variación de existencias – mercaderías, construir el costo de mercaderías vendidas de acuerdo con su naturaleza, para determinar el margen comercial.",
   "Por su parte, las subcuentas 602 a 604, y la divisionarias 6092 a 6094, permiten, conjuntamente con las subcuentas 612 a 614, acumular el valor agregado generado en el período (cuenta 82)"
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo relativo a la presentación del estado de ganancias y pérdidas por naturaleza)",
   "NIC 2 Existencias"
  ]
 },
 "61": {
  "contenido": [
   "Acumula las variaciones en los saldos de existencias de mercadería, materias primas, materiales auxiliares y suministros, y envases y embalajes, para un período."
  ],
  "subcuentas": {
   "611": "Mercaderías. Incluye las compras de mercaderías así como su consumo o venta; se encuentra relacionada con la cuenta 20.",
   "612": "Materias primas. Incluye las compras de materias primas así como su consumo; se encuentra relacionada con la cuenta 24.",
   "613": "Materiales auxiliares, suministros y repuestos. Incluye las compras de materiales auxiliares y suministros así como su consumo; se encuentra relacionada con la cuenta 25.",
   "614": "Envases y embalajes. Incluye las compras de envases y embalajes así como su venta, se encuentra relacionada con la cuenta 26."
  },
  "dinamica": {
   "debe": [
    "El costo por la utilización de materias primas, materiales auxiliares y suministros, y de envases y embalajes, con abono a las cuentas: 20 Mercaderías; 24 Materias primas; 25 Materiales auxiliares, suministros y repuestos; ó 26 Envases y embalajes.",
    "El costo de los bienes devueltos a los proveedores, con abono a las cuentas: 20 Mercaderías; 24 Materias primas; 25 Materiales auxiliares, suministros y repuestos; ó 26 Envases y embalajes.",
    "Al cierre del período:",
    "La transferencia del saldo de las subcuentas correspondientes de la cuenta 69 Costo de ventas.",
    "El saldo acreedor de la subcuenta 611 Mercaderías con abono a la cuenta 80 Margen comercial; y ,",
    "Los saldos acreedores de las divisionarias 612 Materias primas, 613 Materiales auxiliares, suministros y repuestos, y 614 Envases y embalajes con abono a la cuenta 82 Valor agregado."
   ],
   "haber": [
    "El costo de los componentes de esta cuenta adquiridos por la empresa, con cargo a las cuentas pertinentes del Elemento 2.",
    "Al cierre del período:",
    "El saldo deudor de la subcuenta 611 Mercaderías con cargo a la cuenta 80 Margen comercial; y",
    "Los saldos deudores de las subcuentas 612 Materias primas, 613 Materiales auxiliares, suministros y repuestos, y 614 Envases y embalajes con cargo a la cuenta 82 Valor agregado."
   ]
  },
  "comentarios": [
   "Las variaciones de existencias participan a nivel de resultados por naturaleza como cuentas correctoras de las compras de la manera siguiente:",
   "− Si presentan saldos deudores, indican que las ventas de mercaderías y las salidas a producción de materias primas, materiales auxiliares y suministros, y envases y embalajes, han sido mayores que las compras del período, lo que ha determinado que la diferencia sea cubierta con las existencias (los inventarios) iniciales.",
   "− Si presentan saldos acreedores, indican que las ventas de mercaderías y las salidas de materias primas, materiales auxiliares y suministros, y envases y embalajes, a la producción, han sido menores que las compras del período, lo que ha originado un aumento en el nivel de las existencias (inventarios) iniciales.",
   "La variación de productos terminados, productos en proceso, subproductos, desechos, desperdicios y existencias de servicios, se registran en la cuenta 71 Variación de la producción almacenada.",
   "La variación de envases y embalajes que hayan sido producidos por la empresa se registran en la subcuenta 714 Variación de envases y embalajes."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo relativo a la presentación del estado de ganancias y pérdidas por naturaleza)"
  ]
 },
 "62": {
  "contenido": [
   "Agrupa las subcuentas que representan las remuneraciones a que tiene derecho el trabajador, tanto en efectivo como en especie así como las distintas contribuciones para seguridad y previsión social, y en general todas las cargas que lo benefician. Incluye por extensión, las dietas a los miembros del Directorio de la empresa."
  ],
  "subcuentas": {
   "621": "Remuneraciones. Gastos incurridos por concepto de remuneraciones del personal, que incluye los sueldos, salarios, comisiones, remuneraciones en especie, vacaciones, y gratificaciones, entre otros, de carácter fijo.",
   "622": "Otras remuneraciones. Gastos por concepto de bonos extraordinarios, movilidad, pasajes, asignación para vivienda, seguros particulares de salud, escolaridad, entre otros.",
   "623": "Indemnizaciones al personal. Comprende los gastos por concepto de pagos adicionales a las remuneraciones, por ejemplo en el caso de ceses de personal.",
   "624": "Capacitación. Importe utilizado en la capacitación del personal, ya sea dentro de la empresa o fuera de ella, en otras instituciones especializadas.",
   "625": "Atención al personal. Gastos de atención al personal, tal como almuerzos, celebración de festividades, entre otros.",
   "626": "Gerentes. Gastos diferentes a las remuneraciones incurridos en el personal de gerencia.",
   "627": "Seguridad, previsión social y otras contribuciones. Contribuciones de la empresa establecidas por ley, tales como seguro social, seguro complementario de trabajos de riesgo, SENCICO, SENATI, entre otras similares.",
   "628": "Retribuciones al directorio. Importe de las retribuciones asignadas a los miembros del directorio de la empresa.",
   "629": "Beneficios sociales de los trabajadores. Gastos por concepto de compensación por tiempo de servicios de acuerdo a ley, y por concepto de pensiones de jubilación y otros beneficios, después de terminado el vínculo laboral (post-empleo), como los seguros de salud y otros pagados a pensionistas."
  },
  "dinamica": {
   "debe": [
    "El monto bruto de las remuneraciones, en efectivo o en especie, del personal permanente o eventual.",
    "El importe total de las contribuciones devengadas a cargo de la empresa.",
    "Las retribuciones asignadas a los Directores.",
    "Los beneficios sociales de los trabajadores, pensiones de jubilación y otros beneficios post- empleo."
   ],
   "haber": [
    "Al cierre del periodo:",
    "El total de las cargas de personal, al cierre del período, con cargo a la cuenta 83 Excedente bruto (insuficiencia bruta) de explotación."
   ]
  },
  "comentarios": [
   "La contratación de mano de obra y otros servicios a empresas especializadas se registran en la cuenta 63 Gastos de servicios prestados por terceros.",
   "Los gastos de personal se transfieren a las cuentas de activo o gasto a través de la subcuenta 791 Cargas imputables a cuentas de costos y gastos."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo relativo a la presentación del estado de ganancias y pérdidas por naturaleza)",
   "NIC 19 Beneficios a los trabajadores",
   "NIC 24 Revelaciones sobre entes vinculados",
   "NIC 26 Tratamiento contable y presentación de información sobre planes de prestaciones de jubilación"
  ]
 },
 "63": {
  "contenido": [
   "Agrupa las subcuentas que acumulan los gastos de servicios prestados por terceros a la empresa.",
   "Incluye tanto el gasto por los servicios como el costo de los materiales y repuestos utilizados."
  ],
  "subcuentas": {
   "631": "Transporte, correos y gastos de viaje. Incluye los fletes relacionados con la venta de mercaderías, transporte entre establecimientos, transporte colectivo de personal, pasajes en el ámbito nacional e internacional u otros medios de transporte, y otros fletes y gastos de correo. Asimismo, incluye los gastos de viaje, como alojamiento, alimentación, entre otros.",
   "632": "Asesoría y consultoría. Servicios recibidos por asesoría y consultoría, en materia: administrativa; contable; legal; notarial; planeamiento y producción; mercadotecnia; medioambiente, entre otros.",
   "633": "Producción encargada a terceros. Comprende el servicio relacionado con la producción que se encarga a terceros, a los cuales la empresa le proporciona los insumos.",
   "634": "Mantenimiento y reparaciones. Gastos relacionados con la conservación y mantenimiento de los bienes (tangibles e intangibles).",
   "635": "Alquileres. Gastos relacionados con el arrendamiento operativo de bienes muebles e inmuebles. Si corresponden al alquiler de un inmueble o similar para uso de trabajadores, que constituya remuneración en especie, deberá ser reconocido en la cuenta 62.",
   "636": "Servicios básicos. Gastos en servicios básicos, tales como energía, agua y comunicaciones.",
   "637": "Publicidad, publicaciones, relaciones públicas. Incluye los gastos relacionados con anuncios, catálogos impresos y otras publicaciones, atenciones en ferias, exposiciones, gastos de atención a clientes.",
   "638": "Servicios de contratistas. Gastos por servicios prestados por contratistas.",
   "639": "Otros servicios prestados por terceros. Gastos por otros servicios prestados por terceros no incluidos en las subcuentas precedentes, tales como gastos de laboratorio y gastos bancarios."
  },
  "dinamica": {
   "debe": [
    "El importe de los servicios prestados a la empresa por terceros."
   ],
   "haber": [
    "El total al cierre del periodo con cargo a la cuenta 82 Valor agregado."
   ]
  },
  "comentarios": [
   "Los intereses relacionados con los créditos que se deriven por los servicios prestados por terceros, deben ser registrados en la cuenta 67 Gastos financieros.",
   "Las primas de seguros serán registradas en la cuenta 65 Otros gastos de gestión.",
   "Los servicios vinculados con la adquisición de inmuebles, maquinarias y equipo, así como de otros activos inmovilizados, como los intangibles, biológicos, y de propiedad inmobiliaria, serán transferidos a las cuentas del activo correspondiente, a través de la cuenta 72 Producción de activo inmovilizado.",
   "La divisionaria 6391 Gastos bancarios, acumula el gasto por los servicios recibidos de los bancos y otras instituciones financieras, tales como la gestión de cuentas bancarias y gastos de cobranzas de documentos, entre otros, los que corresponden a consumo intermedio desde el punto de vista económico."
  ],
  "niif": [
   "Marco Conceptual para la preparación y presentación de estados financieros (en lo referido a gastos)",
   "NIC 1 Presentación de estados financieros (en lo relativo a la presentación del estado de ganancias y pérdidas por naturaleza)",
   "NIC 2 Existencias",
   "NIC 17 Arrendamientos",
   "SIC 15 Arrendamientos operativos – Incentivos",
   "SIC 31 Ingresos – Transacciones de canje referentes a servicios de publicidad"
  ]
 },
 "64": {
  "contenido": [
   "Agrupa las subcuentas que acumulan los impuestos, tasas y contribuciones de cargo de la empresa, establecidos por el gobierno nacional, el gobierno regional y el gobierno municipal o local."
  ],
  "subcuentas": {
   "641": "Gobierno Central. Comprende, a nivel de divisonarias, el importe del Impuesto General a las Ventas, del Impuesto Selectivo al Consumo y del Impuesto de Promoción Municipal por compra de bienes y servicios que no pueden ser materia de crédito fiscal ni identificado con una categoría de activo o gasto. Asimismo, incluye el impuesto a las transacciones financieras y el impuesto temporal a los activos netos cuando no puede ser acreditado contra el impuesto a la renta, así como las regalías mineras, los cánones sectoriales y el impuesto a los juegos de casino y tragamonedas.",
   "642": "Gobierno regional. Los tributos que se establezcan donde el perceptor sea el gobierno regional.",
   "643": "Gobierno local. Incluye los tributos municipales, tales como el impuesto predial e impuesto vehicular, arbitrios, licencias y otras tasas.",
   "644": "Otros gastos por tributos. Cualquier otro gasto por tributos no contemplados en las subcuentas precedentes, tales como las contribuciones al SENCICO o al SENATI."
  },
  "dinamica": {
   "debe": [
    "El importe de los tributos devengados a cargo de la empresa."
   ],
   "haber": [
    "El total, al cierre del período, de los tributos que afectan a la empresa, con cargo a la cuenta 83 Excedente bruto (insuficiencia bruta) de explotación."
   ]
  },
  "comentarios": [
   "El Impuesto a la Renta de las personas jurídicas, por su naturaleza, representa una disposición o aplicación de las utilidades; en consecuencia, será objeto de registro en la cuenta 88 Impuesto a la renta.",
   "Los impuestos a las ventas selectivo al consumo, y promoción municipal relacionados con la compra de bienes y servicios que se reconocen en esta cuenta, corresponden a la porción que no puede ser acreditada con el impuesto facturado del mismo tipo, ni que puede ser identificado con una categoría específica de activo o gasto.",
   "Las multas e intereses relacionados con tributos se deberán contabilizar en las divisionarias 6592 Sanciones administrativas y 6737 Obligaciones tributarias, respectivamente."
  ],
  "niif": [
   "Marco Conceptual para la preparación y presentación de estados financieros (en lo referido a gastos)",
   "NIC 1 Presentación de estados financieros (en lo relativo a la presentación del estado de ganancias y pérdidas por naturaleza)"
  ]
 },
 "65": {
  "contenido": [
   "Agrupa las subcuentas que acumulan otros gastos de gestión que por su naturaleza no se consideran como consumo de bienes relacionados con la producción o la prestación de servicios, ni como remuneración de los factores de la producción (gastos de personal, tributos, intereses, depreciaciones y provisiones del ejercicio)."
  ],
  "subcuentas": {
   "651": "Seguros. Incluye el importe de las pólizas de seguros devengados en el ejercicio económico que se toma para la cobertura de diversos riesgos.",
   "652": "Regalías. Gastos referidos al usufructo de los derechos de autor, patentes, marcas, diseños, entre otros.",
   "653": "Suscripciones. Comprende los gastos por la suscripción de revistas, diarios y otras publicaciones. Incluye las membresías sin derecho a devolución (cuotas periódicas).",
   "654": "Licencias y derechos de vigencia. Comprende los permisos de operación para ciertas actividades, como la pesca o la minería, por ejemplo.",
   "655": "Costo neto de enajenación de activos inmovilizados y operaciones discontinuadas. Corresponde al valor neto en libros que mantenían los activos inmovilizados al momento de enajenarlos, o cuando han sido siniestrados. Asimismo, incluye los gastos incurridos por la discontinuidad de segmentos de negocios o actividad geográfica.",
   "656": "Suministros. Incluye los suministros consumidos previamente activados o no, distintos de los que se integran en productos elaborados, incluyendo aquellos que se consumen en labores de oficina, las herramientas y equipos desechables, vestimenta, suministros de campo, medicinas, y equipos no reconocidos como activos.",
   "658": "Gestión medioambiental. Incluye los gastos por naturaleza relacionados con las contribuciones y otros gastos voluntarios que una entidad efectúa a favor de la comunidad ubicada en su ámbito de influencia, tales como el apoyo tecnológico, recreativo, de salud, entre otros. Estos gastos de gestión medioambiental son distintos de aquellos que son acumulados en otras cuentas por naturaleza, como las remuneraciones y beneficios sociales del personal asignado a estas labores. Todos los gastos por naturaleza relacionados con la gestión medioambiental pueden ser acumulados en cuenta de destino.",
   "659": "Otros gastos. Cualquier otro gasto relacionado no incluido en las subcuentas precedentes, entre ellos, las donaciones y las sanciones administrativas."
  },
  "dinamica": {
   "debe": [
    "El importe de las primas de seguros, las regalías, suscripciones y cotizaciones, donaciones, suministros consumidos y otros.",
    "El valor contable neto de los activos enajenados y discontinuados sin valor de recuperación.",
    "Las sanciones administrativas.",
    "Los gastos realizados con motivo de la discontinuidad de operaciones."
   ],
   "haber": [
    "El total al cierre del período, de Otros gastos de gestión, con cargo a la cuenta 84 Resultado de explotación."
   ]
  },
  "comentarios": [
   "Las operaciones discontinuas son aquellas que resultan de la venta o abandono (temporal o definitivo) de una operación que representa una línea importante del negocio por separado y cuyos activos, utilidad o pérdida neta y actividades pueden ser distinguidos físicamente, operacionalmente y para propósito de información financiera.",
   "Las compras de útiles de escritorio se registran en la subcuenta 603 Materiales auxiliares, suministros y repuestos.",
   "Los seguros de vida y los seguros particulares de prestaciones de salud se registran en la subcuenta 627 Seguridad, previsión social y otras contribuciones.",
   "Los seguros vinculados con la compra de existencias forman parte del costo de adquisición, y se registran en la subcuenta 609 Costos vinculados con las compras."
  ],
  "niif": [
   "Marco Conceptual para la preparación y presentación de estados financieros (en lo referido a gastos)",
   "NIC 1 Presentación de estados financieros (en lo relativo a la presentación del estado de ganancias y pérdidas por naturaleza)",
   "NIC 16, NIC 17, NIC 38, NIC 40, y NIC 41, en lo referido a la disposición de activos",
   "NIC 38 Intangibles (en lo referido a gastos de investigación y desarrollo)",
   "NIIF 5 Activos no corrientes mantenidos para la venta y operaciones discontinuadas"
  ]
 },
 "66": {
  "contenido": [
   "Agrupa las subcuentas que acumulan las disminuciones de valor de activos no financieros en comparación con su valor en libros, cuando son medidos al valor razonable."
  ],
  "subcuentas": {
   "661": "Activo realizable. Incluye la disminución de valor de las mercaderías y los productos terminados llevados al valor razonable, así como la de los activos no corrientes mantenidos para la venta.",
   "662": "Activo inmovilizado. Comprende la disminución de valor de las inversiones inmobiliarias y del activo biológico."
  },
  "dinamica": {
   "debe": [
    "La pérdida de valor de los activos realizables e inmovilizados."
   ],
   "haber": [
    "El total al cierre del período con cargo a la cuenta 84 Resultado de explotación."
   ]
  },
  "comentarios": [
   "La pérdida de valor de los activos y pasivos financieros medidos al valor razonable, se registran en la subcuenta 677."
  ],
  "niif": [
   "Marco Conceptual para la preparación y presentación de estados financieros",
   "NIC 2 Existencias",
   "NIC 40 Inversiones inmobiliarias",
   "NIC 41 Agricultura",
   "NIIF 5 Activos no corrientes mantenidos para la venta y operaciones discontinuadas"
  ]
 },
 "67": {
  "contenido": [
   "Agrupa las subcuentas que acumulan los intereses y gastos ocasionados por la obtención de recursos financieros temporales y financiamiento de operaciones comerciales o por efectos de la diferencia en cambio, así como la pérdida por medición de activos y pasivos financieros al valor razonable."
  ],
  "subcuentas": {
   "671": "Gastos en operaciones de endeudamiento y otros. Corresponde a los gastos diferentes de intereses en los que se incurre con las instituciones financieras que prestan dinero a la empresa.",
   "672": "Pérdida por instrumentos financieros derivados. Pérdidas obtenidas en operaciones de cobertura realizadas.",
   "673": "Intereses por préstamos y otras obligaciones. Registra los gastos por concepto de intereses que devengan los préstamos en un ejercicio económico.",
   "674": "Gastos en operaciones de factoraje (factoring). Incluye los gastos financieros y otros originados en la venta de cuentas por cobrar.",
   "675": "Descuentos concedidos por pronto pago. Descuentos que la empresa otorga a sus clientes por pago anticipado de sus cuentas.",
   "676": "Diferencia de cambio. Pérdidas por diferencia en cambio originadas por las operaciones efectuadas en moneda extranjera.",
   "677": "Pérdida por medición de activos y pasivos financieros al valor razonable. Comprende el menor valor de los instrumentos financieros en comparación con su valor en libros a la fecha de los estados financieros.",
   "678": "Participación en resultados de entidades relacionadas. Registra la pérdida en el valor de las inversiones en subsidiarias y afiliadas que reconoce la empresa, con motivo de la disminución del patrimonio neto de dichas subsidiarias y afiliadas, donde se ejerce control o influencia significativa, respectivamente. Asimismo, incluye la pérdida en la participación en negocios conjuntos.",
   "679": "Otros gastos financieros. Gastos similares no incluidos en las subcuentas precedentes. En esta subcuenta se incluye el costo financiero de endeudamiento que se paga en bonos o acciones."
  },
  "dinamica": {
   "debe": [
    "El importe de los gastos financieros incurridos por la empresa durante el período.",
    "El importe de los gastos financieros y otros descontados en una operación de venta de cuentas por cobrar (factoring)."
   ],
   "haber": [
    "El total al cierre del período, de los gastos financieros, con cargo a la cuenta 85 Resultado antes de participaciones e impuestos."
   ]
  },
  "comentarios": [
   "Los intereses que se capitalicen según el tratamiento permitido por la NIC 23 Costos de financiamiento se incluirán en la cuenta de activo correspondiente.",
   "En la subcuenta 679 se incorpora una divisionaria 6792 – Gastos financieros en medición a valor descontado, para acumular las actualizaciones por el costo del dinero en el tiempo, de las subcuentas correspondientes de provisiones."
  ],
  "niif": [
   "Marco Conceptual para la preparación y presentación de estados financieros (en lo referido a gastos)",
   "NIC 21 Efecto de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 23 Costos de financiamiento",
   "NIC 24 Revelaciones sobre entes vinculados",
   "NIC 27 Estados financieros consolidados e individuales",
   "NIC 28 Inversiones en asociadas",
   "NIC 31 Participaciones en asociaciones en participación",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar",
   "CINIIF 2 Aportaciones de socios de entidades cooperativas e instrumentos similares"
  ]
 },
 "68": {
  "contenido": [
   "Agrupa las subcuentas que acumulan el consumo de beneficio económico incorporado en activos a largo plazo; la pérdida de valor de activos por medición a su valor razonable; y, los gastos por provisiones que dan lugar al reconocimiento paralelo de un pasivo de monto u oportunidad inciertos."
  ],
  "subcuentas": {
   "681": "Depreciación. Comprende la estimación del consumo de beneficio económico de las inversiones inmobiliarias, cuando son llevadas al costo, y de los inmuebles, maquinaria y equipo.",
   "682": "Amortización de intangibles. Incluye la estimación de disminución de valor de los intangibles de vida definida, sea que se hayan adquirido o se hayan generado internamente.",
   "683": "Agotamiento. Comprende la estimación del consumo de beneficios económicos incorporados en los recursos naturales adquiridos.",
   "684": "Valuación de activos. Estimación de la disminución de valor de las cuentas por cobrar, existencias, e inversiones mobiliarias.",
   "685": "Deterioro del valor de los activos. Comprende la pérdida de valor de las inversiones inmobiliarias, inmuebles, maquinaria y equipo, intangibles, y activos biológicos cuando se miden al costo.",
   "686": "Provisiones. Comprende los gastos asociados a pasivos respecto de los cuales existe incertidumbre sobre su cuantía o vencimiento."
  },
  "dinamica": {
   "debe": [
    "La estimación de disminución de valor de los activos, por referencia a su valor razonable.",
    "La disminución de valor de los activos inmovilizados, diferentes a la valuación.",
    "La estimación de provisiones."
   ],
   "haber": [
    "El saldo de esta cuenta al cierre del período, con cargo a la cuenta 84 Resultado de explotación."
   ]
  },
  "comentarios": [
   "Las subcuentas 681, 682 y 683 se relacionan con las divisionarias de las subcuentas 391, 392 y 393, respectivamente.",
   "La subcuenta 684 se relaciona con las cuentas 19 y 29, y con la subcuenta 366.",
   "La subcuenta 685 se relaciona con la cuenta 36 Desvalorización de Activo inmovilizado.",
   "La subcuenta 686 se relaciona con la cuenta 48 Provisiones.",
   "La depreciación de inmuebles, maquinaria y equipo adquiridos mediante operaciones de financiamiento en la modalidad de arrendamiento financiero, y la del incremento por revaluación, se reconocen en subcuentas por separado; lo mismo ocurre con la amortización por la revaluación de activos intangibles.",
   "Cuando la oportunidad del desembolso de las provisiones para litigios o para desmantelamiento, retiro o rehabilitación del activo inmovilizado, o para protección y remediación del medio ambiente sea lejana en relación con el reconocimiento original de la provisión, y el costo del dinero en el tiempo sea importante, se requiere que esta última sea medida a su valor descontado. Las actualizaciones posteriores de la provisión, referida exclusivamente al transcurso del tiempo, son reconocidas como parte de los gastos financieros en la divisionaria 6792. Véase la NIC 37.",
   "La transferencia de estos gastos a cuentas de producción, o a las acumulativas de la función del gasto, se efectúa a través de la cuenta 78.",
   "La recuperación de deterioro de valor previamente reconocida, se efectúa directamente en las divisionarias de la subcuenta 757 Recuperación de deterioro de cuentas de activos inmovilizados."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo relativo a la presentación del estado de ganancias y pérdidas por naturaleza)",
   "NIC 2 Existencias",
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 36 Deterioro del valor de los activos",
   "NIC 37 Provisiones, pasivos contingentes y activos contingentes",
   "NIC 38 Activos intangibles",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIC 40 Inversiones inmobiliarias",
   "NIC 41 Agricultura",
   "NIIF 7 Instrumentos financieros: información a revelar",
   "SIC 29 Revelación – Convenios de concesión de servicios",
   "SIC 32 Activos intangibles – Costo de un sitio web",
   "CINIIF 5 Derechos por la Participación en fondos para el retiro del servicio, la restauración y la rehabilitación medioambiental",
   "CINIIF 10 Información financiera intermedia y deterioro del valor",
   "CINIIF 12 Acuerdos de Concesión de servicios"
  ]
 },
 "69": {
  "contenido": [
   "Agrupa las subcuentas que acumulan el costo de los bienes y/o servicios inherentes al giro del negocio, transferidos a título oneroso."
  ],
  "subcuentas": {
   "691": "Mercaderías. Costo de las mercaderías vendidas o transferidas, previamente reconocidas en la cuenta 20 Mercaderías.",
   "692": "Productos terminados. Costo de los productos terminados vendidos o transferidos previamente reconocidos en la cuenta 21 Productos terminados, excepto la subcuenta 215.",
   "693": "Subproductos, desechos y desperdicios. Costo de los subproductos, desechos y desperdicios vendidos o transferidos, previamente reconocidos en la cuenta 22.",
   "694": "Servicios. Costo de las existencias de servicios prestados previamente reconocidos en la subcuenta 215 Existencias de servicios terminados, o acumulado directamente en esta cuenta.",
   "695": "Gastos por desvalorización de existencias. Incluye la pérdida de valor de las existencias por: medición a valor de realización, por deterioro, y por diferencias de inventario."
  },
  "dinamica": {
   "debe": [
    "El costo de los bienes y servicios vendidos."
   ],
   "haber": [
    "El costo de los bienes vendidos devueltos por los clientes.",
    "El saldo al cierre del ejercicio del costo de ventas, con cargo a las cuentas 61 Variación de existencias en el caso de las mercaderías, y 71 Variación de la producción almacenada, cuando se trate de productos terminados, subproductos, desechos y desperdicios, y prestación de servicios."
   ]
  },
  "comentarios": [
   "Para la acumulación de cifras para el estado de ganancias y pérdidas por naturaleza, el saldo de la subcuenta 691 Costo de ventas – Mercaderías y la divisionaria correspondiente de la subcuenta 695, deben ser transferidos a la subcuenta 611 Variación de existencias de mercaderías, y los saldos de las subcuentas 692, 693 y 694, a las subcuentas correspondientes de la cuenta 71, incluyendo en este último caso las divisionarias correspondientes de la subcuenta 695."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo relativo a la presentación del estado de ganancias y pérdidas, por función y por naturaleza)",
   "NIC 2 Existencias ELEMENTO 7: INGRESOS Agrupa las cuentas de la 70 hasta la 79. Comprende las cuentas de gestión de ingresos por la explotación de la actividad económica de las empresas; se clasifican de acuerdo con su naturaleza."
  ]
 },
 "70": {
  "contenido": [
   "Agrupa las subcuentas que acumulan los ingresos por ventas de bienes y/o servicios inherentes a las operaciones del giro del negocio, desagregando las que corresponden a entidades relacionadas de las que corresponden a ventas a terceros.",
   "manufacturados; productos de extracción terminados; productos agropecuarios y piscícolas; productos inmuebles, y otros productos.",
   "RECONOCIMIENTO Y MEDICIÓN Los ingresos por la venta de productos se reconocen cuando se cumplen las siguientes condiciones: a) La transferencia al comprador de los riesgos significativos y los beneficios de propiedad de los productos; b) La empresa ya no retiene la continuidad de la responsabilidad gerencial en el grado asociado usualmente a la propiedad, ni el control efectivo de los productos vendidos; c) El importe de ingresos puede ser medido confiablemente; d) Es probable que los beneficios económicos relacionados con la transacción fluirán a la empresa; y, e) Los costos incurridos o a ser incurridos por la transferencia pueden ser medidos confiablemente.",
   "Los ingresos por la prestación de servicios se reconocen cuando se cumplen las siguientes condiciones: a) El importe de ingresos puede ser medido confiablemente; b) Es probable que los beneficios económicos relacionados con la transacción fluirán a la empresa; c) El grado de culminación de la transacción en la fecha de los estados financieros, puede ser medido fiablemente; y, d) Los costos incurridos o a ser incurridos hasta completarlo, pueden ser medidos fiablemente."
  ],
  "subcuentas": {
   "701": "Mercaderías. Comprende las ventas de productos adquiridos para su venta, distinguiendo entre mercadería manufacturada; de extracción; agropecuaria y piscícola, y otras.",
   "703": "Subproductos, desechos y desperdicios. Incluye las ventas de productos originados en el proceso de producción o en el almacenamiento de existencias, con valor de recuperación reducido.",
   "704": "Prestación de servicios. Incluye los ingresos por la prestación de servicios.",
   "709": "Devoluciones sobre ventas. Comprende las devoluciones de las ventas de existencias señaladas en las subcuentas 701 a la 703."
  },
  "dinamica": {
   "debe": [
    "Las devoluciones de bienes vendidos a clientes.",
    "El saldo al cierre del período, con abono a las cuentas:",
    "80 Margen comercial en el caso de mercaderías u 81 Producción del ejercicio, por las ventas de productos terminados; subproductos, desechos y desperdicios; y prestación de servicios."
   ],
   "haber": [
    "El importe de las ventas de bienes y/o servicios."
   ]
  },
  "comentarios": [
   "Los descuentos concedidos por pronto pago, aún cuando se indiquen en facturas deberán registrarse en la subcuenta 675 Descuentos concedidos por pronto pago.",
   "Los intereses en financiamiento a clientes, se reconocen en la subcuenta 772."
  ],
  "niif": [
   "Marco Conceptual para la preparación y presentación de estados financieros (en lo referido a ingresos)",
   "NIC 11 Contratos de construcción",
   "NIC 18 Ingresos",
   "SIC 31 Ingresos – Transacciones de canje referentes a servicios de publicidad"
  ]
 },
 "71": {
  "contenido": [
   "Agrupa las subcuentas cuyos saldos representan las variaciones que se han originado en un período determinado, entre los inventarios finales de productos en proceso y los inventarios iniciales de dichos bienes; así como de los productos terminados, de los subproductos, desechos y desperdicios, de los envases y embalajes, y de las existencias de servicios."
  ],
  "subcuentas": {
   "711": "Variación de productos terminados. Importe resultante de las variaciones (positivas o negativas) originadas en el ejercicio, entre el inventario final e inventario inicial de productos terminados.",
   "712": "Variación de subproductos, desechos y desperdicios. Importe resultante de las variaciones (positivas o negativas) originadas en el ejercicio, entre el inventario final e inventario inicial de subproductos, desechos y desperdicios.",
   "713": "Variación de productos en proceso. Importe resultante de las variaciones (positivas o negativas) originadas en el ejercicio, entre el inventario final e inventario inicial de productos en proceso.",
   "714": "Variación de envases y embalajes. Importe resultante de las variaciones (positivas o negativas) originadas en el ejercicio, entre el inventario final e inventario inicial de envases y embalajes.",
   "715": "Variación de existencias de servicios. Incluye la variación (positiva o negativa) originada en el ejercicio, entre las existencias de servicios al final del ejercicio y los saldos iniciales."
  },
  "dinamica": {
   "debe": [
    "Los productos en proceso, al inicio del período.",
    "Al cierre del período:",
    "La transferencia de los saldos de las subcuentas 692 Productos terminados, 693 Subproductos, desechos y desperdicios, y 694 Servicios, de la cuenta 69 Costo de ventas.",
    "El saldo acreedor de los componentes de esta cuenta, con abono a la cuenta 81 Producción del ejercicio."
   ],
   "haber": [
    "El costo de las existencias producidas, con cargo a las respectivas cuentas de existencias.",
    "Al cierre del período:",
    "El saldo deudor de los componentes de esta cuenta con cargo a la cuenta 81 Producción del ejercicio."
   ]
  },
  "comentarios": [
   "La variación de la producción almacenada participa a nivel de resultados, como cuenta correctora de los ingresos, de la manera siguiente:",
   "− Cuando muestra saldo deudor, indica que la producción vendida ha sido mayor que la producción del período, lo que ha determinado que la diferencia sea cubierta con el inventario inicial.",
   "− Cuando muestra saldo acreedor, indica que la producción vendida ha sido menor que la producción del período, lo cual ha originado un aumento del inventario inicial.",
   "Las variaciones de las mercaderías, materias primas, materiales auxiliares y suministros; y envases y embalajes (sólo los adquiridos, no los elaborados por la empresa) se registran en la cuenta 61 Variación de existencias."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo relativo a la presentación del estado de ganancias y pérdidas por naturaleza)"
  ]
 },
 "72": {
  "contenido": [
   "Esta cuenta registra el costo incurrido por la empresa en la construcción o producción de activos inmovilizados para la obtención de rentas futuras, aumentar el valor de su capital en el tiempo, o para su uso. Dicho costo, previamente registrado según su naturaleza en el Elemento 6, se deberá transferir a través de esta cuenta, a los rubros de activo inmovilizado que corresponda."
  ],
  "subcuentas": {
   "721": "Inversiones inmobiliarias. Comprende el costo incurrido en la construcción de bienes que van a ser destinados a la obtención de rentas, aumentar el valor del capital, o ambas.",
   "722": "Inmuebles, maquinaria y equipo. Comprende el costo incurrido por la empresa en la construcción o fabricación de bienes para su uso, que forman parte de inmuebles, maquinaria y equipo.",
   "723": "Intangibles. Comprende el costo incurrido en la producción o desarrollo de bienes intangibles, para su uso.",
   "724": "Activos biológicos. Incluye el costo incurrido por la entidad en la producción o desarrollo de activos biológicos.",
   "725": "Costos de financiación capitalizados. Incluye el costo financiero incurrido en la financiación de activo inmovilizado, que reúne las condiciones para ser considerado como “activo calificado”."
  },
  "dinamica": {
   "debe": [
    "El total al cierre del período con abono a la cuenta 81 Producción del ejercicio, excepto la subcuenta 725, cuyo saldo se transfiere a la cuenta 85 Resultado antes de participaciones e impuestos."
   ],
   "haber": [
    "El costo incurrido por la empresa con cargo a las cuentas 31 Inversiones inmobiliarias; 33 Inmuebles, maquinaria y equipo; 34 Intangibles ó 35 Activos biológicos."
   ]
  },
  "comentarios": [
   "La producción de activos inmovilizados constituye ingreso de explotación, y se orienta a balancear las cargas en que se han incurrido para su generación.",
   "Cuando corresponda la capitalización de costos financieros, según lo establece la NIC 23, su transferencia se efectúa a través de la subcuenta 725, la que no afecta la producción del ejercicio (cuenta 81), sino más bien el resultado antes de participaciones e impuestos (cuenta 85)."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo relativo a la presentación del estado de ganancias y pérdidas por naturaleza)",
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 23 Costos de financiamiento",
   "NIC 38 Activos intangibles",
   "NIC 40 Inversiones inmobiliarias",
   "NIC 41 Agricultura"
  ]
 },
 "73": {
  "contenido": [
   "Acumula los descuentos, rebajas y bonificaciones obtenidos sobre compras de bienes y servicios corrientes, distintos al pronto pago, y de aquellos contenidos en facturas."
  ],
  "subcuentas": {
   "731": "Descuentos, rebajas y bonificaciones obtenidos. Corresponden a los incrementos de beneficios económicos originados en compras, que no pueden identificarse con el bien o servicio adquirido, y consecuentemente, no pueden ser deducidos del costo de adquisición de aquellos."
  },
  "dinamica": {
   "debe": [
    "El total al cierre del período, con abono a la cuenta 84 Resultado de explotación."
   ],
   "haber": [
    "Los descuentos, rebajas y bonificaciones obtenidos."
   ]
  },
  "comentarios": [
   "Los descuentos por pronto pago se deben incluir como ingresos financieros en la subcuenta 775 Descuentos obtenidos por pronto pago.",
   "Las bonificaciones están asociadas a una consideración de volumen. Por su parte, los descuentos y rebajas corresponden a deducciones monetarias respecto de valores previamente facturados.",
   "En tanto el descuento, la bonificación y la rebaja, son recibidos luego de la fecha de facturación y oportunidad de reconocimiento de compras, su reconocimiento corresponde a la clasificación general de otros ingresos para efectos de presentación, luego del resultado de operación.",
   "Las NIIF sobre activos inmovilizados (NIC 16, NIC 38, y NIC 40), al referirse al costo de adquisición en el reconocimiento inicial de los activos inmovilizados, requieren que cualquier descuento o rebaja obtenido sea deducido de dicho costo. No obstante que no se menciona específicamente el caso de los descuentos o rebajas obtenidos después de algún período de tiempo importante (cuando el activo ya está siendo depreciado o amortizado), si tales descuentos o rebajas se obtienen, también deben deducirse del activo, y su depreciación o amortización, corregida en períodos futuros."
  ],
  "niif": [
   "NIC 2 Existencias",
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 38 Activos intangibles",
   "NIC 40 Inversiones inmobiliarias"
  ]
 },
 "74": {
  "contenido": [
   "Acumula los descuentos, rebajas y bonificaciones concedidos, distintos a los descuentos por pronto pago. Su naturaleza es deudora."
  ],
  "subcuentas": {
   "741": "Descuentos, rebajas y bonificaciones concedidos. Corresponden a las disminuciones de beneficios económicos originados en descuentos, rebajas y bonificaciones efectuadas a clientes sobre el valor de venta."
  },
  "dinamica": {
   "debe": [
    "El monto de los descuentos, bonificaciones y rebajas concedidos sobre el precio de la venta."
   ],
   "haber": [
    "El total, al cierre del período, de los descuentos, bonificaciones y rebajas concedidos sobre ventas, con cargo a la cuenta 80 Margen comercial u 81 Producción del ejercicio, según se relacionen con la venta de mercaderías, o la venta de bienes producidos, respectivamente."
   ]
  },
  "comentarios": [
   "Los descuentos concedidos por el pronto pago efectuado por los clientes, deben reconocerse como gastos financieros en la subcuenta 675.",
   "La presentación de los descuentos, rebajas y bonificaciones concedidos corresponde a una corrección del monto bruto de venta."
  ],
  "niif": [
   "NIC 18 Ingresos"
  ]
 },
 "75": {
  "contenido": [
   "Agrupa las subcuentas que acumulan los ingresos distintos de los relacionados con la actividad principal del ente económico y de los provenientes de financiamientos otorgados, tanto de terceros como de entidades relacionadas.",
   "Incluye el mayor valor actual de los activos que anteriormente fueron deteriorados, y cuyo deterioro acumulado se encuentra registrado en la cuenta 36 Desvalorización de activo inmovilizado, cuando los activos son medidos al costo."
  ],
  "subcuentas": {
   "751": "Servicios en beneficio del personal. Ingresos provenientes de la prestación de servicios al personal.",
   "752": "Comisiones y corretajes. Servicios prestados por la empresa como intermediario comercial a favor de terceros, tales como comisiones por ventas a consignación, comisiones por venta de inmuebles, entre otros.",
   "753": "Regalías. Ingresos por el uso de derechos de propiedad de la empresa por parte de terceros, como es el caso de las marcas, patentes, modelos.",
   "754": "Alquileres. Arrendamientos de activos inmovilizados, o de bienes muebles.",
   "755": "Recuperación de cuentas de valuación. Comprende la recuperación de valor del activo, cuyo valor fue previamente disminuido por intermedio de cuentas de valuación.",
   "756": "Enajenación de activos inmovilizados. Ingreso generado por la venta de activos inmovilizados.",
   "757": "Recuperación de deterioro de cuentas de activos inmovilizados.",
   "759": "Otros ingresos de gestión. Los de similar naturaleza, diferentes a los señalados en las subcuentas precedentes. Incluye los subsidios gubernamentales."
  },
  "dinamica": {
   "debe": [
    "El total al cierre del período, con abono a la cuenta 84 Resultado de explotación."
   ],
   "haber": [
    "Recuperación de cuentas de valuación y de deterioro de activos.",
    "Los ingresos por concepto distinto a la actividad principal de la empresa."
   ]
  },
  "comentarios": [
   "Cuando los ingresos por comisiones y corretajes, regalías, y alquileres, corresponden al objeto o propósito de la empresa, deben exponerse como componentes principales de la actividad, al inicio del estado de ganancias y pérdidas."
  ],
  "niif": [
   "Marco Conceptual para la preparación y presentación de estados financieros (en lo referido a ingresos)",
   "NIC 16 Inmuebles, maquinaria y equipo",
   "NIC 18 Ingresos",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 36 Deterioro del valor de los activos",
   "NIC 38 Activos intangibles",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIC 40 Inversiones inmobiliarias",
   "NIC 41 Agricultura",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "76": {
  "contenido": [
   "Agrupa las subcuentas que acumulan los incrementos de valor de activos no financieros en comparación con su valor en libros, cuando son valuados al valor razonable."
  ],
  "subcuentas": {
   "761": "Activo realizable. Incluye el incremento de valor de las mercaderías y los productos terminados llevados al valor razonable, así como la de los activos no corrientes mantenidos para la venta.",
   "762": "Activo inmovilizado. Comprende el incremento de valor de las inversiones inmobiliarias y del activo biológico."
  },
  "dinamica": {
   "debe": [
    "El total al cierre del período con abono a la cuenta 84 Resultado de explotación."
   ],
   "haber": [
    "El incremento por referencia al valor razonable de los activos realizables e inmovilizados."
   ]
  },
  "comentarios": [
   "La ganancia por medición de activos y pasivos financieros al valor razonable, se registra en la subcuenta 777."
  ],
  "niif": [
   "Marco Conceptual para la preparación y presentación de estados financieros (en lo referido a gastos)",
   "NIC 2 Existencias",
   "NIC 27 Estados financieros consolidados e individuales",
   "NIC 28 Inversiones en asociadas",
   "NIC 31 Participaciones en asociaciones en participación",
   "NIC 40 Inversiones inmobiliarias",
   "NIC 41 Agricultura",
   "NIIF 3 Combinaciones de negocios",
   "NIIF 5 Activos no corrientes mantenidos para la venta y operaciones discontinuadas"
  ]
 },
 "77": {
  "contenido": [
   "Agrupa las subcuentas que acumulan las rentas o rendimientos provenientes de colocación de capitales; de la diferencia en cambio a favor de la empresa; de los descuentos obtenidos por pronto pago; así como de la ganancia por medición de activos y pasivos al valor razonable."
  ],
  "subcuentas": {
   "771": "Ganancia por instrumento financiero derivado. Ganancias en operaciones de cobertura realizadas por la empresa.",
   "772": "Rendimientos ganados. Intereses que devengan los depósitos en cuentas en instituciones financieras; las cuentas por cobrar comerciales; los préstamos otorgados; y los bonos y otros títulos.",
   "773": "Dividendos. Ganancias obtenidas por la tenencia de inversiones en valores representativos del patrimonio de otras empresas.",
   "774": "Ingresos en operaciones de factoraje (factoring). Incluye los rendimientos financieros y otros obtenidos en operaciones de compra de cuentas por cobrar.",
   "775": "Descuentos obtenidos por pronto pago. Importe de los descuentos que la empresa obtiene de sus proveedores por el pago anticipado de sus cuentas.",
   "776": "Diferencia en cambio. Ganancias por diferencia en cambio originadas por las operaciones efectuadas en moneda extranjera.",
   "777": "Ganancia por medición de activos y pasivos financieros al valor razonable. Comprende el mayor valor de los instrumentos financieros primarios en comparación con su valor en libros a la fecha de los estados financieros.",
   "778": "Participación en los resultados de entidades relacionadas. Registra la ganancia en el valor de las inversiones en subsidiarias y afiliadas que reconoce la empresa, con motivo del incremento del patrimonio neto de dichas subsidiarias y afiliadas, donde se ejerce control o influencia significativa, respectivamente. Asimismo, incluye la ganancia por el incremento de valor de las participaciones en negocios conjuntos.",
   "779": "Otros ingresos financieros. Ingresos de naturaleza financiera no incluidos en las subcuentas precedentes."
  },
  "dinamica": {
   "debe": [
    "El total, al cierre del período de los ingresos financieros, con abono a la cuenta 85 Resultado antes de participaciones e impuestos."
   ],
   "haber": [
    "El importe de los ingresos financieros obtenidos en el período.",
    "El importe de los ingresos financieros y otros en operaciones de compra de cuentas por cobrar (factoring)."
   ]
  },
  "comentarios": [
   "La subcuenta 773 Dividendos, incluye los dividendos derivados de las utilidades generadas por la empresa donde se mantiene la inversión en fecha posterior a la adquisición. En caso las utilidades correspondan a fecha anterior a su adquisición, disminuirán el valor de la inversión.",
   "En la subcuenta 779 se incorpora una divisionaria 7792 – Ingresos financieros en medición a valor descontado, para acumular los rendimientos financieros en compra de activos o gastos, cuyo financiamiento incorpora implícitamente dicho componente. Esta divisionaria se incrementa por el devengado de intereses reconocidos en la divisionaria 3732."
  ],
  "niif": [
   "Marco Conceptual para la preparación y presentación de estados financieros (en lo referido a ingresos)",
   "NIC 18 Ingresos",
   "NIC 21 Efectos de las variaciones en los tipos de cambio de monedas extranjeras",
   "NIC 28 Inversiones en asociadas",
   "NIC 31 Participaciones en asociaciones en participación",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 },
 "78": {
  "contenido": [
   "Esta cuenta se utiliza para transferir los gastos incurridos en el período para cubrir las provisiones reconocidas en la cuenta 68."
  ],
  "subcuentas": {
   "781": "Cargas cubiertas por provisiones. Transfiere las cargas por valuación, deterioro de activos y provisiones, acumulados por su naturaleza, a cuenta del costo de producción o cuentas acumulativas de función del gasto (Elemento 9)."
  },
  "dinamica": {
   "debe": [
    "El total, a la fecha de los estados financieros de los gastos cubiertos por provisiones, con abono a la cuenta 84 Resultados de explotación."
   ],
   "haber": [
    "Las cargas por provisiones imputables a cuentas de costos con cargo a las cuentas del Elemento 9."
   ]
  },
  "comentarios": [
   "El saldo acreedor de esta cuenta, no representa ingresos sino compensación de gastos.",
   "Los gastos imputables a cuentas de costos, distintos de los de valuación y deterioro de activos y provisiones, deben trasladarse a través de la cuenta 79 Cargas imputables a cuentas de costos y gastos.",
   "Las cargas que inciden en la producción de activos por cuenta propia deben ser registradas en la cuenta 72 Producción de activo inmovilizado."
  ],
  "niif": []
 },
 "79": {
  "contenido": [
   "Esta cuenta se utiliza para transferir, en los casos pertinentes, los gastos por naturaleza registrados en el elemento 6, excepto a las cuentas de costos del elemento 9 Contabilidad Analítica de Explotación."
  ],
  "subcuentas": {
   "791": "Cargas imputables a cuentas de costos y gastos. Transfiere costos y gastos acumulados por su naturaleza, a cuentas de costo de producción o cuentas acumulativas de función del gasto (Elemento 9).",
   "792": "Gastos financieros imputables a cuentas de existencias. Transfiere los costos financieros a las existencias calificadas de productos en proceso (subcuenta 238)."
  },
  "dinamica": {
   "debe": [
    "El total, al cierre del período, de las cargas imputables a cuentas de costos con abono a las Cuentas del Elemento 9."
   ],
   "haber": [
    "Los gastos imputables a cuentas de costos con cargo a las cuentas del Elemento 9."
   ]
  },
  "comentarios": [
   "Es el nexo entre la contabilidad financiera y la contabilidad analítica de explotación. Su saldo no constituye ingresos, es una cuenta de enlace de aquellos gastos que deben afectar los costos.",
   "El saldo acreedor de esta cuenta debe ser igual a la sumatoria de los saldos deudores de las cuentas de costos y gastos (Elemento 9), con los cuales se compensa al cierre del ejercicio.",
   "Los gastos cubiertos por provisiones se transfieren a través de la cuenta 78.",
   "Las transferencias de los gastos por naturaleza que inciden en la producción de activos construidos por la propia empresa para sí misma, se efectuarán utilizando la cuenta 72 Producción de activo inmovilizado."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo que hace a la presentación del estado de ganancias y pérdidas por naturaleza) ELEMENTO 8: SALDOS INTERMEDIARIOS DE GESTIÓN Y DETERMINACIÓN DEL RESULTADO DEL EJERCICIO Este elemento presenta los saldos intermediarios de gestión, incluyendo el impuesto a la renta y participaciones de los trabajadores, de ser el caso."
  ]
 },
 "80": {
  "contenido": [
   "Se determina al cierre del ejercicio económico, por la diferencia entre las ventas de mercaderías y el costo de las mismas. El costo de ventas de mercaderías se determina por diferencia entre las compras y la variación, entre el saldo inicial y final, de las existencias de mercaderías.",
   "NOMENCLATURA DE LA SUBCUENTA 801 Margen comercial 801 Margen comercial. Es la ganancia bruta por el servicio de intermediación comercial de una entidad. Resulta de la comparación de los ingresos por ventas, menos las devoluciones sobre ventas, descuentos, rebajas y bonificaciones concedidas, y menos las compras, distinguiendo entre el costo de compra al proveedor y los gastos vinculados con las compras (transporte, seguro, gastos y derechos de aduana, entre otros), corregidas por el aumento o disminución de saldos de mercaderías acumuladas en el período."
  ],
  "subcuentas": {},
  "dinamica": {
   "debe": [
    "El saldo de las compras de mercaderías - subcuenta 601 y divisionaria 6091.",
    "El saldo deudor de la variación de mercaderías - subcuenta 611.",
    "El saldo de esta cuenta 80 Margen comercial, con abono a la cuenta 82 Valor agregado."
   ],
   "haber": [
    "El saldo de las ventas de mercaderías - subcuenta 701.",
    "El saldo acreedor de la variación de mercaderías - subcuenta 611."
   ]
  },
  "comentarios": [
   "La presentación de información por función expone el costo de mercaderías vendidas, mientras que la información por naturaleza, determina esa magnitud por diferencia entre compras y variación de inventarios.",
   "Los descuentos por pronto pago constituyen una carga financiera, y por lo tanto no corrigen el monto de ventas, debiendo reconocerse en la cuenta 67."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo que hace a la presentación del estado de ganancias y pérdidas por naturaleza)"
  ]
 },
 "81": {
  "contenido": [
   "Representa el valor de lo que la empresa ha producido al cierre del período, sea que se haya vendido, almacenado o inmovilizado.",
   "La producción que se acumula es la que corresponde a: bienes; servicios y producción de activos para su propio uso por la empresa."
  ],
  "subcuentas": {
   "811": "Producción de bienes. Resulta de la comparación de las ventas de productos terminados y, subproductos, desechos y desperdicios menos las devoluciones sobre ventas, descuentos, rebajas y bonificaciones concedidos, y el almacenamiento o desalmacenamiento (disminución de los saldos al inicio del período) de productos terminados, subproductos, desechos y desperdicios, productos en proceso, y envases y embalajes.",
   "812": "Producción de servicios. Se determina al comparar los ingresos por prestación de servicios menos las devoluciones (servicios no aceptados por clientes), descuentos y rebajas, y la variación de existencias de servicios (subcuenta 215).",
   "813": "Producción de activo inmovilizado. Corresponde a la fabricación para uso o explotación propios de: inversiones inmobiliarias; inmuebles, maquinaria y equipo; intangibles; y activos biológicos."
  },
  "dinamica": {
   "debe": [
    "Los saldos deudores de las subcuentas 711, 712, 713 y 714, los que se transfieren a la subcuenta 811 Producción de bienes.",
    "El saldo deudor de la cuenta 715, que se transfiere a la subcuenta 812 Producción de servicios.",
    "El saldo acreedor de esta cuenta con abono a la Cuenta 82 Valor agregado."
   ],
   "haber": [
    "El saldo de las ventas de bienes y servicios (subcuentas 702, 703 y 704).",
    "Los saldos acreedores de las subcuentas 711, 712, 713 y 714, las que se acumulan en la subcuenta 811 Producción de bienes.",
    "El saldo de la cuenta 72 - Producción de activo inmovilizado, que se acumula en la subcuenta 813."
   ]
  },
  "comentarios": [
   "La producción del ejercicio incorpora en este PCGE el almacenamiento o desalmacenamiento de la producción de servicios, ahora contemplada como una clase de existencias, y dentro de la producción inmovilizada se presenta una mayor distinción de activos inmovilizados, de manera concordante con el desarrollo de las NIIF."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo que hace a la presentación del estado de ganancias y pérdidas por naturaleza)"
  ]
 },
 "82": {
  "contenido": [
   "El valor agregado indica al cierre del período lo que la empresa añade en su proceso de producción, según su actividad, a la economía nacional, como creación de valor.",
   "Esta variable es medida por la diferencia entre la producción del período y los consumos de bienes y servicios suministrados por terceros para esta producción (consumo intermedio).",
   "Asimismo, el valor agregado equivale a la suma de las remuneraciones a los factores de producción, es decir a la mano de obra y al capital.",
   "NOMENCLATURA DE LA SUBCUENTA 821 Valor agregado 821 Valor agregado. Resulta de comparar la producción total (actividad comercial y actividades de producción de bienes y servicios), menos los bienes de existencias de materias primas, materiales auxiliares, envases y embalajes, y suministros diversos, a los costos facturados por proveedores y los gastos vinculados con esas compras; y los servicios prestados por terceros, corregidos por el incremento (almacenamiento) o disminución (desalmacenamiento) en su nivel."
  ],
  "subcuentas": {},
  "dinamica": {
   "debe": [
    "El saldo de las compras acumuladas en las subcuentas 602, 603 y 604, y el saldo de las divisionarias 6092, 6093 y 6094.",
    "El saldo deudor de las subcuentas de Variación de existencias (subcuentas 612, 613 y 614).",
    "El saldo de la Cuenta 63 Gastos de servicios prestados por terceros.",
    "El saldo de esta cuenta, con abono a la cuenta 83 Excedente bruto (insuficiencia bruta) de explotación."
   ],
   "haber": [
    "El saldo de las cuentas 80 Margen comercial y 81 Producción del ejercicio.",
    "El saldo acreedor de las subcuentas de Variación de existencias (subcuentas 612, 613 y 614)."
   ]
  },
  "comentarios": [
   "El saldo acumulado de valor agregado (o añadido) no tiene equivalente en alguna línea de presentación específica en un estado de ganancias y pérdidas, ubicándose en algún estadío anterior al resultado de operación."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo que hace a la presentación del estado de ganancias y pérdidas por naturaleza)"
  ]
 },
 "83": {
  "contenido": [
   "Desde el punto de vista económico, mide el resultado (ganancia o excedente bruto; pérdida o insuficiencia bruta) que se deriva de la actividad productiva de la empresa; en cuánto excedente, representa la generación de recursos financieros nuevos procedentes de la explotación, y en tanto, insuficiencia, representa el consumo de recursos financieros antes generados.",
   "NOMENCLATURA DE LA SUBCUENTA 831 Excedente bruto (insuficiencia bruta) de explotación 831 Excedente bruto (insuficiencia bruta) de explotación. Se deriva del valor agregado o añadido (cuenta 82), del cual se descuentan los gastos de personal (cuenta 62), los tributos indirectos (cuenta 64), y se adicionan los subsidios recibidos (subcuenta 759)."
  ],
  "subcuentas": {},
  "dinamica": {
   "debe": [
    "Los saldos de las cuentas 62 Gastos de personal, directores y gerentes, y 64 Gastos por tributos.",
    "El saldo acreedor de esta cuenta (excedente bruto), con abono a la cuenta 84 Resultado de explotación."
   ],
   "haber": [
    "El saldo de la cuenta 82 Valor agregado.",
    "Los subsidios recibidos.",
    "El saldo deudor de esta cuenta (Insuficiencia bruta) con cargo a la cuenta 84 Resultado de explotación."
   ]
  },
  "comentarios": [
   "Los gastos de personal y los gastos por tributos representan desde el punto de vista contable, componentes para determinar el resultado de operación; lo mismo ocurre con los subsidios recibidos, en cuanto permiten compensar operaciones cuyos rendimientos por sí solos no justificarían la inversión."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo que hace a la presentación del estado de ganancias y pérdidas por naturaleza)"
  ]
 },
 "84": {
  "contenido": [
   "Muestra el resultado obtenido por la empresa al cierre del período sin considerar los efectos de la financiación externa de sus operaciones, ni de otras partidas ajenas a la explotación.",
   "NOMENCLATURA DE LA SUBCUENTA 841 Resultado de explotación 841 Resultado de explotación. Resulta de sustraer al resultado bruto de explotación, los otros gastos de gestión (cuenta 65) excepto el costo neto de enajenación de activos inmovilizados y operaciones discontinuadas (subcuenta 655), las donaciones (divisionaria 6591), y las sanciones administrativas (divisionaria 6592); y de adicionar los otros ingresos de gestión (cuenta 75), excepto la divisionaria 7591 subsidios gubernamentales, la cuenta 78 Cargas cubiertas por provisiones, y las ganancias por medición de activos no financieros al valor razonable (cuenta 76)."
  ],
  "subcuentas": {},
  "dinamica": {
   "debe": [
    "El saldo deudor de la cuenta 83 Excedente bruto (insuficiencia bruta) de explotación.",
    "El saldo de las cuentas 65 Otros gastos de gestión y 68 Valuación y deterioro de activos y provisiones.",
    "El saldo acreedor de esta cuenta, con abono a la cuenta 85 Resultado antes de participaciones e impuestos."
   ],
   "haber": [
    "El saldo acreedor de la cuenta 83 Excedente bruto (insuficiencia bruta) de explotación.",
    "El saldo de las cuentas 75 Otros ingresos de gestión (excepto la divisionaria 7591 Subsidios gubernamentales), 76 Ganancia por medición de activos no financieros al valor razonable, y 78 Cargas cubiertas por provisiones.",
    "El saldo deudor de esta cuenta con cargo a la cuenta 85 Resultado antes de participaciones e impuestos."
   ]
  },
  "comentarios": [
   "El resultado de explotación coincide con el resultado antes de financiación, participaciones e impuesto a la renta, al presentar el estado de ganancias y pérdidas por función."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo que hace a la presentación del estado de ganancias y pérdidas por naturaleza)"
  ]
 },
 "85": {
  "contenido": [
   "Muestra el resultado del período antes de las participaciones de los trabajadores y del impuesto a la renta.",
   "NOMENCLATURA DE LA SUBCUENTA 851 Resultado antes de participaciones e impuestos 851 Resultado antes de participaciones e impuestos. Resulta de sustraer del resultado neto de explotación, los montos de ingresos y gastos financieros."
  ],
  "subcuentas": {},
  "dinamica": {
   "debe": [
    "El saldo deudor de la cuenta 84 Resultado de explotación.",
    "El saldo de la cuenta 67 Gastos financieros.",
    "El saldo acreedor de esta cuenta con abono a la cuenta 89 Determinación del resultado del ejercicio."
   ],
   "haber": [
    "El saldo acreedor de la cuenta 84 Resultado de explotación.",
    "El saldo de la cuenta 77 Ingresos financieros.",
    "El saldo deudor de esta cuenta, con cargo a la cuenta 89 Determinación del resultado del ejercicio."
   ]
  },
  "comentarios": [],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo que hace a la presentación del estado de ganancias y pérdidas por naturaleza)"
  ]
 },
 "87": {
  "contenido": [
   "Incluye la participación de utilidades de los trabajadores, cuando se calcula a partir de una renta tributaria (impositiva), en sus componentes, corriente y diferido.",
   "RECONOCIMIENTO Y MEDICIÓN Se reconocen participaciones de los trabajadores corrientes, con la existencia de renta tributaria. El componente diferido se reconoce con la existencia de diferencias temporales gravables y deducibles que se espera reviertan en el futuro, dando lugar a impuestos corrientes (en el futuro) o a una recuperación (deducción) de la carga tributaria.",
   "Asimismo, se reconocen ingresos (ahorros) originados en pérdidas tributarias arrastrables, cuando es posible demostrar razonablemente que en el futuro se generará renta tributaria para compensar dicha pérdida."
  ],
  "subcuentas": {
   "871": "Participación de los trabajadores – Corriente. Es el gasto calculado sobre la base de la renta tributaria.",
   "872": "Participación de los trabajadores – Diferida. Es el gasto o ingreso (ahorro) calculado sobre la base de las diferencias temporales (gravables y deducibles), determinado por la comparación de saldos contables y tributarios. También incluye el ingreso (ahorro) en participaciones de los trabajadores, calculado sobre pérdidas tributarias que razonablemente se espera compensar en el futuro."
  },
  "dinamica": {
   "debe": [
    "El importe del gasto contable relacionado con diferencias temporales gravables con abono a la divisionaria 4922 Participaciones de los trabajadores diferidas – Resultado.",
    "El importe de las participaciones corrientes con abono a la cuenta 413 Participaciones de los trabajadores por pagar.",
    "El importe de las participaciones de los trabajadores diferidas activo, relacionado con la reversión de diferencias temporales deducibles, reconocidas en períodos anteriores.",
    "Al final del período:",
    "El saldo acreedor de esta cuenta con abono a la cuenta 89 Determinación del resultado del ejercicio."
   ],
   "haber": [
    "El monto del ingreso (ahorro) reconocido en diferencias temporales deducibles o pérdidas tributarias, con cargo a la subcuenta 372.",
    "La participación de utilidades.",
    "El importe de las participaciones de los trabajadores diferidas pasivo, relacionado con la reversión de diferencias temporales gravables, reconocidas en periodos anteriores.",
    "Al final del período:",
    "El saldo deudor de esta cuenta con cargo a la cuenta 89 Determinación del resultado del ejercicio."
   ]
  },
  "comentarios": [],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo que hace a la presentación del estado de ganancias y pérdidas)",
   "NIC 12 Impuesto a la renta",
   "SIC 21 Impuesto a la renta – Recuperación de activos revaluados no depreciables",
   "SIC 25 Impuesto a la renta – Cambios en la situación tributaria de una empresa o de sus accionistas"
  ]
 },
 "88": {
  "contenido": [
   "En esta cuenta se reconoce el impuesto calculado sobre la renta imponible del ejercicio (impuesto corriente), así como el importe del impuesto a la renta diferido.",
   "RECONOCIMIENTO Y MEDICIÓN Se reconoce impuesto a la renta corriente, con la existencia de renta tributaria.",
   "El componente diferido se reconoce con la existencias de diferencias temporales gravables y deducibles que se espera reviertan en el futuro, dando lugar a impuestos corrientes (en el futuro) o a una recuperación (deducción) de la carga tributaria.",
   "Asimismo, se reconocen ingresos (ahorros) originados en pérdidas tributarias arrastrables, cuando es posible demostrar razonablemente que en el futuro se generará renta tributaria para compensar dicha pérdida."
  ],
  "subcuentas": {
   "881": "Impuesto a la renta – Corriente. Es el gasto calculado sobre la base de la renta tributaria.",
   "882": "Impuesto a la renta – Diferido. Es el gasto o ingreso (ahorro) calculado sobre la base de las diferencias temporales (gravables y deducibles), determinado por la comparación de saldos contables y tributarios. También incluye el ingreso (ahorro) en impuesto a la renta, calculado sobre pérdidas tributarias que razonablemente se espera compensar en el futuro."
  },
  "dinamica": {
   "debe": [
    "El importe del impuesto a la renta corriente con abono a la divisionaria 4017 Impuesto a la renta.",
    "El importe del gasto contable por impuesto a la renta originado en diferencias temporales gravables (gasto por impuesto diferido) con abono a la divisionaria 4912.",
    "El importe del impuesto a la renta diferido activo, relacionado con la reversión de diferencias temporales deducibles, reconocidas en períodos anteriores.",
    "Al final del período:",
    "El saldo acreedor de esta cuenta con abono a la cuenta 89 Determinación del resultado del ejercicio."
   ],
   "haber": [
    "El importe del impuesto a la renta diferido pasivo, relacionado con la reversión de diferencias temporales gravables, reconocidas en periodos anteriores.",
    "El importe del ingreso (ahorro) contable reconocido en diferencias temporales deducibles o pérdidas tributarias, con cargo a la subcuenta 371.",
    "Al final del período:",
    "El saldo deudor de esta cuenta con cargo a la cuenta 89 Determinación del resultado del ejercicio."
   ]
  },
  "comentarios": [],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo que hace a la presentación del estado de ganancias y pérdidas)",
   "NIC 12 Impuesto a la renta",
   "SIC 21 Impuesto a la renta – Recuperación de activos revaluados no depreciables",
   "SIC 25 Impuesto a la renta – Cambios en la situación tributaria de una empresa o de sus accionistas"
  ]
 },
 "89": {
  "contenido": [
   "Muestra el resultado neto total que corresponde a un período determinado.",
   "Por su naturaleza, al cierre de operaciones, se integra al balance ya que forma parte de la estructura financiera del patrimonio neto de la empresa.",
   "Cuentas que se establecen para el control interno contable de la empresa sobre bienes y valores dados en garantía, derechos sobre instrumentos financieros derivados y sobre instrumentos financieros primarios cuando se registran bajo el método de la fecha de liquidación, y sobre bienes dados de baja, entre otros.",
   "NOMENCLATURA DE LAS CUENTAS 01 Bienes y valores entregados 02 Derechos sobre instrumentos financieros 03 Otras cuentas de orden deudoras 04 Deudoras por contra DINÁMICA DE LAS CUENTAS Es debitada por: Es acreditada por:",
   "• Los activos dados en custodia o garantía.",
   "• Lo contratos firmados que dan derecho sobre instrumentos financieros primarios y derivados.",
   "• Otras cuentas de control.",
   "• Recuperación de los activos dados en custodia o garantía.",
   "• Finalización o ejecución de contratos sobre instrumentos financieros primarios y derivados.",
   "• Retiro o baja de otras cuentas de control.",
   "Cuentas que se establecen para el control interno contable de la empresa sobre bienes y valores recibidos en garantía, compromisos sobre instrumentos financieros derivados y sobre instrumentos financieros primarios cuando se registran bajo el método de la fecha de liquidación, entre otros.",
   "NOMENCLATURA DE LAS CUENTAS 06 Bienes y valores recibidos 07 Compromisos sobre instrumentos financieros 08 Otras cuentas de orden acreedoras 09 Acreedoras por contra DINÁMICA DE LAS CUENTAS Es debitada por: Es acreditada por:",
   "• Devolución de los activos recibidos en custodia o garantía.",
   "• Finalización o ejecución de contratos sobre instrumentos financieros primarios y derivados.",
   "• La disminución o retiro de otras cuentas de control acreedoras.",
   "• Los activos recibidos en custodia o garantía.",
   "• Los contratos firmados que representan responsabilidad de cumplimiento de instrumentos financieros primarios y derivados.",
   "• Otras cuentas de control."
  ],
  "subcuentas": {
   "891": "Utilidad. Incremento neto en los beneficios económicos del ejercicio.",
   "892": "Pérdida. Disminución neta en los beneficios económicos del ejercicio."
  },
  "dinamica": {
   "debe": [
    "El saldo deudor de la cuenta 85 Resultado antes de participaciones e impuestos.",
    "La distribución legal de la renta.",
    "El Impuesto a la Renta.",
    "El saldo acreedor de esta cuenta, al cierre del período con abono a la cuenta 59 Resultados acumulados."
   ],
   "haber": [
    "El saldo acreedor de la cuenta 85 Resultado antes de participaciones e impuestos.",
    "El saldo deudor de esta cuenta, al cierre del período con cargo a la cuenta 59 Resultados acumulados."
   ]
  },
  "comentarios": [
   "Tanto la utilidad como la pérdida antes de participaciones e impuestos pueden incrementarse o disminuir por la existencia de componente diferido en ingresos (ahorros) por participaciones e impuesto a la renta."
  ],
  "niif": [
   "NIC 1 Presentación de estados financieros (en lo que hace a la presentación del estado de ganancias y pérdidas) ELEMENTO 9: CONTABILIDAD ANALÍTICA DE EXPLOTACIÓN: COSTOS DE PRODUCCIÓN Y GASTOS POR FUNCIÓN Este elemento comprende la contabilidad analítica de explotación, que muestra los costos de producción y los gastos por función.",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar CUENTAS DE ORDEN ACREEDORAS",
   "NIC 32 Instrumentos financieros: presentación",
   "NIC 39 Instrumentos financieros: reconocimiento y medición",
   "NIIF 7 Instrumentos financieros: información a revelar"
  ]
 }
};
