// ═══════════════════════════════════════════════════════════════════
// JARVEX — Contenido del botón "?" de AYUDA (pedido de Gabriel, jul 2026).
//
// UN SOLO lugar con la explicación de cada sección: qué es, cómo se usa y
// notas por ROL. El botón vive en el Header (components/jx-ayuda.jsx) y
// resuelve por el id de página de la navegación (lib/nav-planos / sidebar).
//
// ⚠ REGLA DE MANTENIMIENTO: cada vez que se agregue una sección o cambie el
// comportamiento de una existente (nuevos botones, reglas, flujos), ACTUALIZÁ
// su entrada acá en el mismo commit. Esta ayuda es el onboarding de los
// usuarios nuevos — si miente, confunde más de lo que ayuda.
// ═══════════════════════════════════════════════════════════════════

// Notas generales por rol (se muestran en TODAS las secciones, arriba de la
// nota específica si la hay).
const ROL_GENERAL = {
  ingeniero_residente: 'Tu vista es netamente TÉCNICA: partidas, avance, cronograma, incidencias, personal obrero y subcontratos. Almacén, dinero y los módulos de especialistas no aparecen en tu menú — el avance de los especialistas lo ves resumido en tu Panel.',
  almacenero: 'Tu día a día vive en el grupo "Control de Almacén". Registrá cada entrada/salida el mismo día que ocurre — el candado cronológico rechaza salidas con fecha en la que no había stock.',
  ayudante_contador: 'Podés registrar y subir documentos contables. Lo ya registrado (bancarizaciones, estados de pago) no se cambia solo: usá el botón "Solicitar" y el admin o la Contadora Jefe lo aplican.',
  contador: 'Como Contadora Jefe ves y editás todo lo contable de todas las empresas y obras, incluida la bandeja "Sin clasificar" y las solicitudes de cambio de las asistentes.',
  prevencionista: 'Tu foco: SSOMA (charlas, IPERC, inducciones, inspecciones, SCTR en consulta) y tu reporte diario. Los EPP los ves en CONSULTA para cuadrar con la almacenera (ella registra entradas/salidas y entregas). En Personal creás obreros (directos o de subcontrato) y podés SOLICITAR subcontratos nuevos.',
  ing_ambiental: 'Tu foco: Gestión Ambiental y tu reporte diario de especialidad con evidencias.',
  ing_calidad: 'Tu foco: Gestión de Calidad (certificados vs expediente) y tu reporte diario de especialidad.',
  ing_social: 'Tu foco: Gestión Social (compromisos, quejas, padrón) y tu reporte diario de especialidad.',
};

// dueño: rol(es) que más usan la sección — se resalta en la ventana.
const AYUDA = {
  // ── GENERAL ──────────────────────────────────────────────────────
  'inicio': {
    titulo: 'Inicio',
    que: 'El punto de partida: elegís tu obra de trabajo y entrás a las secciones desde los bloques. Solo ves los bloques que tu rol puede usar.',
    como: [
      'Elegí la obra en "Obra de trabajo" — los bloques "de obra" trabajan sobre ella.',
      'Los bloques de "General" (Reportes, Captura Mágica, Empresas…) cruzan todas las obras.',
      'Si te falta un bloque que necesitás, pedile acceso al administrador.',
      'Arriba a la derecha cambiás entre tema oscuro y claro. La elección es tuya y queda guardada en ese dispositivo (también está en Mi Perfil, abajo en el menú lateral).',
    ],
  },
  'captura-magica': {
    titulo: 'Captura Mágica',
    que: 'Subís fotos o PDFs de comprobantes (facturas, guías) y la IA extrae los datos para registrarlos como movimientos contables sin tipear.',
    como: [
      'Arrastrá o seleccioná los archivos; revisá lo que la IA leyó antes de confirmar.',
      '📥 RECIBIDAS DE CAMPO: arriba está la bandeja con lo que el personal sube desde el portal 📸 Captura de Campo (fotos y PDFs), con el NOMBRE de quién lo subió. Tiene dos pestañas: "⏳ Pendientes" (sin trabajar) y "🤖 Trabajadas". Al tocar "Leer con IA" el comprobante se manda al lector y, SI la lectura terminó bien, pasa solo a Trabajadas (si la IA falló — sin señal, sin crédito — se queda en Pendientes y te avisa, para que nada se pierda de vista); desde ahí lo cerrás como "✓ Registrada" cuando confirmaste el movimiento, lo "✗ Descartás", o lo devolvés con "↩ A pendientes" si preferís seguir viéndolo.',
      'VENTA A UN CLIENTE EXTERNO: si el que EMITE la factura es una empresa tuya y el que compra NO lo es, la app lo detecta sola y lo registra como VENTA de esa empresa. En ese caso no te ofrece crear un proveedor (el emisor sos vos) ni sumar al comprador a tus empresas del grupo: el cliente queda guardado como contraparte, y podés corregir su nombre o RUC ahí mismo si el OCR los leyó mal.',
      'El DESTINO es obligatorio: una obra específica, Gastos Generales, Contabilidad Neta u "No sé" (la Contadora Jefe lo clasifica después).',
      'Facturas en soles > S/ 2,000 entran como "Pendiente" y pasan a "Pagado" solas cuando se sube su bancarización completa.',
      'DETRACCIÓN (SPOT): si la factura la tiene, la IA la detecta y te propone el %, el monto y el código — corregilo si hace falta antes de confirmar (el neto a pagar al proveedor se calcula solo). El depósito lo registrás después en Movimientos Contables. Las NOTAS de crédito/débito NO llevan detracción (la lleva el comprobante que genera el pago), así que ahí el bloque ni aparece.',
      'RECIBOS POR HONORARIOS: la IA los reconoce (emisor persona natural) y te deja elegir/confirmar el TRABAJADOR; al confirmar se crea el pago del trabajador con el recibo ya adjunto, listo para que subas el voucher en Pagos. No crea proveedor ni movimiento de compra.',
      'RxH · RETENCIÓN Y MONTO EDITABLE: el pago al trabajador es el NETO (honorarios − retención de renta). En la revisión tenés los campos Honorarios (bruto), Retención y Neto a pagar — todos EDITABLES: si el OCR leyó mal el monto, corregilo ahí antes de confirmar (el neto se recalcula solo al cambiar bruto o retención). El recibo NO lleva IGV.',
      'RECIBO DE UN TRABAJADOR NO REGISTRADO: si no aparece en la lista, tocá "➕ Crear trabajador nuevo" — pide solo lo básico (nombres, apellidos, DNI, cargo, y teléfono/correo opcionales), pre-llenado desde el recibo (el DNI sale del RUC). El CARGO es obligatorio; el resto se puede completar después. Al confirmar, en un paso se crea el trabajador Y su pago. Si subís varios recibos de la misma persona, se crea UNA sola vez (dedup por DNI).',
      'NOTAS DE CRÉDITO/DÉBITO: la IA las reconoce y detecta qué factura modifican. La nota de CRÉDITO se registra RESTANDO (baja el costo del proveedor o las ventas) y queda vinculada a la factura original; la de DÉBITO suma. No piden bancarización ni recepción de almacén.',
      'OPERACIONES ENTRE EMPRESAS DEL GRUPO (INTERCO): si el emisor Y el receptor son empresas nuestras, al confirmar la VENTA JARVEX crea SOLA la COMPRA espejo en la empresa compradora (marcada 🔁 AUTO en Contabilidad) — así la operación interna nunca queda a medias. Si esa compra ya existe (subida a mano), NO la duplica. Y si más tarde subís el comprobante real de esa compra, la app te avisa que la contraparte era automática y te deja REEMPLAZARLA por el tuyo.',
      '"Genera ingreso al almacén": se marca solo cuando corresponde — en compras de bienes viene activado (aparece en Compras Pendientes del almacenero); en recibos por honorarios, notas de crédito/débito y ventas ni siquiera se muestra (no tienen nada que ver con el almacén).',
      'Si la fecha de la factura es anterior al inicio de la obra elegida, la app te lo advierte (no bloquea).',
      'TIPO DE DOCUMENTO: si la IA se equivocó, corregilo en el select del modal — el formulario CAMBIA con él (recibo por honorarios muestra su panel de trabajador; nota de crédito/débito, el de la factura que modifica) y el documento se registra por el camino correcto.',
      'MODO PRUEBA: lo que confirmás mientras estás en modo prueba queda SOLO en tu dispositivo (no se registra de verdad ni se sincroniza) — para cargar comprobantes reales, salí del modo prueba primero.',
      'COMPROBANTES CON MUCHAS LÍNEAS (30, 50, 60 ítems): la lectura automática tarda más y puede no completarse. Si sale "demasiadas líneas de detalle", reintentá una vez; si vuelve a fallar, cargá la factura a mano desde Movimientos Contables → Nuevo Movimiento (cabecera y total los copiás del PDF).',
      'GUÍAS DE REMISIÓN: no llevan montos (así es el documento SUNAT) — es normal que salgan sin total. El panel te dice si la guía es 📤 EMITIDA (el RUC del emisor es una empresa tuya) o 📥 RECIBIDA (de un proveedor), y según eso busca entre tus VENTAS o entre tus COMPRAS.',
      'GUÍA · FACTURAS RECOMENDADAS: debajo del Doc. de referencia aparecen las facturas candidatas, cada una con su nivel de confianza y el motivo ("la guía la referencia y el emisor coincide"). Vienen marcadas SOLO las de confianza alta; las demás las sumás vos con un clic. Una misma guía puede amparar VARIAS facturas — marcá todas las que correspondan y quedan vinculadas al confirmar. Si el Doc. de referencia trae varios números (F001-123, F001-124), se buscan todos.',
      'GUÍA · FACTURA QUE TODAVÍA NO ESTÁ: si la guía referencia una factura que aún no cargaste, aparece el aviso ⏳ "falta F001-125". No bloquea nada — confirmá igual: se vinculan las que sí existen y la que falta queda PENDIENTE. Cuando después subas esa factura por Captura Mágica, la app la vincula SOLA con la guía que la estaba esperando y te avisa con un mensaje.',
      'Si ninguna candidata aparece o no estás segura, confirmá igual: la guía queda registrada sin vincular y la vinculás después desde Guías de Remisión.',
      'RECIBIDAS DE CAMPO 📥: las fotos de facturas que sube el personal de obra (portal con PIN) aparecen en esa bandeja azul. "🤖 Leer con IA" la mete al flujo normal; tras confirmarla marcala "✓ Registrada" (o "✗ Descartar" si la foto no sirve) — el que la subió ve ese estado desde su portal.',
      'ARCHIVOS: máximo 3 MB por comprobante. Si tu PDF pesa más, abrilo y usá "Imprimir → Guardar como PDF" (baja mucho el peso sin perder legibilidad) o escaneá en menor calidad; si son varias páginas, subilas por separado.',
      'SI TODAS LAS FILAS SALEN EN "Error": no es culpa del archivo. Si el mensaje habla de FACTURACIÓN/servicio deshabilitado, la cuenta del hosting (Vercel) tiene un pago pendiente y las funciones de IA están cortadas — avisá al admin con el botón "📨 Avisar al admin". Mientras tanto la app y la sincronización siguen funcionando: tus comprobantes quedan en la bandeja y se procesan al reintentar (botón "Reintentar" de cada fila) cuando el servicio vuelva. También podés cargar la factura a mano desde Movimientos Contables → Nuevo Movimiento.',
    ],
    rol: { ayudante_contador: 'Evitá el doble registro: si el comprobante ya existe (misma serie, mismo RUC y mismo TIPO de documento), la app lo detecta y no lo duplica. Cuando una fila dice "Ya existe en la DB", ahora te muestra CUÁL registro coincide (serie · fecha · monto · proveedor · fecha de registro): si estás segura de que es OTRO documento, abrí "Revisar" y verificá la serie que leyó el OCR. NOTAS DE CRÉDITO: si el OCR leyó como serie el número de la FACTURA que modifica, la app te avisa (ℹ) y pre-carga esa factura como "documento que modifica" — corregí la serie propia de la nota (suele empezar con FC/BC) antes de confirmar. Los archivos que descartás con ✕ ya no vuelven a aparecer. Tu bandeja de pendientes es TUYA (otra cuenta en la misma PC no la ve).' },
  },
  'proveedores': { titulo: 'Proveedores', que: 'Directorio de proveedores del grupo: RUC, contacto, dirección y su historial de compras.', como: ['Creá el proveedor una sola vez y reutilizalo en compras y captura mágica.', 'El RUC correcto es clave: con él se cruzan facturas, guías y trazabilidad.', 'La tarjeta muestra contacto, teléfono, dirección y correo; para comparar PRECIOS entre proveedores usá "Análisis de Insumos" (admin/gerencia).'] },
  'captura-campo': {
    titulo: 'Captura de Campo',
    que: 'Guardá el comprobante de una compra apenas te lo den — foto o PDF — y contabilidad lo revisa y lo registra después. Así ningún comprobante se pierde.',
    como: [
      'Mirá el "torpedo" de arriba: dictale al proveedor el RUC de la empresa del grupo según el rubro de la compra.',
      'ADMIN / CONTADORA JEFE: en "⚙️ Configuración del portal" (acá mismo, solo lo ven ellos) se cambia el PIN de campo (numérico, 4-8 dígitos) y se elige qué empresas salen en la tabla de RUCs y con qué rubro.',
      'La tabla de RUCs es desplegable (botón "▼ Ver tabla") y la cuenta compartida de campo NO puede cambiar su propia contraseña ni salir del portal — solo subir fotos y cerrar sesión.',
      'Tres formas de cargarlo, hasta 3 archivos: 📷 Tomar foto (abre la cámara), 🖼️ Galería, y 📄 PDF para las facturas que te llegan por WhatsApp ya en PDF (no hace falta fotografiar la pantalla). Después, "Guardar factura": la obra y la empresa las asigna contabilidad al registrarlo.',
      'Quién sube queda registrado y contabilidad lo ve en su bandeja: desde la cuenta compartida de campo se te pide tu nombre; con tu usuario normal se usa tu nombre y apellido del sistema.',
      'Sin señal también funciona: el archivo queda en el teléfono y sube solo al recuperar internet. Si aparece la caja naranja "⬆ archivos que aún NO llegan al servidor", dejá la app abierta con señal hasta que desaparezca (o tocá 🔄 Reintentar) — recién ahí contabilidad los ve.',
      'NO gastes la foto en apuros: nítida, con el comprobante completo y sin dedos encima — contabilidad la lee con IA tal cual.',
    ],
  },
  'analisis-insumos': {
    titulo: 'Análisis de Insumos',
    que: 'Panel de admin/gerencia: compara qué proveedor vende cada insumo más barato y unifica los nombres distintos con que facturan el mismo producto.',
    como: [
      'COMPARADOR: buscá el insumo (sin tildes) → ves cada proveedor con su último precio, mínimo, máximo y el gráfico de evolución, más todas las facturas donde apareció.',
      'CORRELACIONES: el sistema propone pares tipo "Clavo 8 pulg" ≈ "Clavos de 8\'\'" — confirmá "Mismo insumo" o "Son distintos". Tu decisión queda grabada y NO se vuelve a preguntar; los unidos se cuentan como UN solo insumo en el comparador.',
      '¿Te equivocaste? En "Decisiones tomadas", el botón ↺ Cambiar invierte la decisión.',
      'El "más barato" solo se declara con la misma moneda y unidad — si hay mezcla, compará a ojo con la tabla.',
    ],
  },
  'dashboard': { titulo: 'Dashboard', que: 'Visión general de la operación: indicadores de obras, stock y contabilidad en un vistazo.', como: ['Usalo como resumen diario; cada tarjeta te lleva a su sección para el detalle.'] },
  'obras': { titulo: 'Obras / Proyectos', que: 'Catálogo de obras del grupo: datos generales, fecha de inicio, estado y avance.', como: ['La FECHA DE INICIO importa: la app la usa para advertir facturas anteriores al arranque de la obra.', 'Cerrá las obras terminadas para sacarlas de los selectores.'] },
  'reportes': {
    titulo: 'Reportes',
    que: 'Reportes ejecutivos de la operación y la configuración del ENVÍO POR EMAIL (diario, semanal y mensual).',
    como: [
      'En "Envío por email" hay 3 pestañas: Diario, Semanal y Mensual — cada una con su interruptor, su hora (Perú), su día y sus DESTINATARIOS propios (los correos que quieras).',
      'El correo llega con resumen ejecutivo, tops de materiales con barras, ranking de ingenieros, especialidades y contabilidad, legible desde el teléfono.',
      'El reporte mensual es el más detallado: incluye top proveedores y avance físico por obra.',
      'El envío es automático (cada hora se revisa qué toca y se despacha por Gmail) — si un reporte no llega, revisá que la pestaña esté ACTIVA y con destinatarios.',
    ],
  },
  'busqueda': { titulo: 'Búsqueda Global', que: 'Buscador que cruza todos los módulos: materiales, movimientos, facturas, personal, etc.', como: ['Escribí cualquier dato (nombre, serie de factura, DNI) y saltá directo al registro.'] },

  // ── ALMACÉN ──────────────────────────────────────────────────────
  'materiales': {
    titulo: 'Materiales',
    que: 'Catálogo e inventario de materiales de la obra: stock actual, stock mínimo y alertas de reposición.',
    como: [
      'El stock NO se edita a mano: se mueve registrando entradas/salidas en "Mov. de Materiales".',
      'Definí stock mínimo para que la app te avise cuándo reponer (alerta "reponer"/"crítico").',
      '"Recalcular stocks" reconcilia el stock guardado con el historial de movimientos si algo no cuadra (ahora también disponible para el almacén, no solo admin). No toca los movimientos, solo el número de stock.',
      'DESAJUSTE POR SINCRONIZACIÓN: si registraste una entrada pero al sacar te dice "sin stock", suele ser que el número guardado no reflejó ese movimiento todavía. La app ahora se apoya en los MOVIMIENTOS (no solo en el número guardado) para no bloquearte una salida legítima, y te avisa del desajuste — tocá "Recalcular stocks" para corregir el número.',
    ],
    rol: { almacenero: 'Si ves stock que no cuadra: primero "Recalcular stocks" (reconcilia con los movimientos). Si aun así no coincide con lo FÍSICO, avisá — puede faltar registrar un movimiento o ser un tema de inventario real.' },
  },
  'mov-materiales': {
    titulo: 'Movimientos de Materiales',
    que: 'El registro de TODAS las entradas, salidas, devoluciones y mermas de materiales — es lo que mueve el stock.',
    como: [
      'Registrá el movimiento con la FECHA REAL en que ocurrió.',
      'BÚSQUEDA POR PALABRAS: el buscador exige TODAS las palabras que escribís, en cualquier orden — "Tubo 1/2" encuentra "TUBO PVC SAP 1/2\\"" aunque no estén juntas. Sirve para acotar rápido (nombre del insumo, documento, responsable, frente o almacén).',
      'HISTORIAL DE UN INSUMO: desde Almacén (Materiales), el botón 📜 de cada material te trae acá con la búsqueda ya cargada con su nombre — ves de una todas sus entradas y salidas.',
      'La app rechaza salidas con fecha en la que no había stock suficiente (candado cronológico) — suele significar que falta registrar una entrada previa.',
      'ANTI-DUPLICADOS: si registrás un movimiento idéntico a uno de las últimas horas, la app te avisa antes de guardar — si solo estabas verificando, cancelá: el anterior ya quedó guardado.',
      'COMPROBANTE DE UN INGRESO: en la última columna, un ingreso sin factura muestra 🔎 (buscar comprobante), 📎 (adjuntar foto) y 📩 (avisar a contabilidad). Con 🔎 la app busca las facturas que cuadran por insumo, fecha y cantidad — elegís la correcta y queda vinculada (verás la referencia sin montos). "✓ Factura" = ya vinculado.',
      'CONSULTAS CON CONTABILIDAD (💬 arriba): si no encontrás el comprobante, "Preguntar a contabilidad" abre un hilo con la referencia exacta del ingreso (sin montos); contabilidad responde Sí / Parcial / No / Otra fecha. El número en el botón son las consultas que te toca responder a vos.',
      'Si un registro queda "con error de sincronización", abrí el detalle y tocá "Reintentar todos".',
    ],
  },
  'herramientas': { titulo: 'Herramientas', que: 'Inventario de herramientas por almacén y por condición (nuevo/bueno/regular/reparación/baja).', como: ['El stock por almacén manda: la salida valida contra el almacén de origen elegido.', 'La condición se registra al sacar y al devolver cada herramienta.'] },
  'mov-herramientas': { titulo: 'Movimientos de Herramientas', que: 'Entradas, salidas y devoluciones de herramientas, con responsable y condición.', como: ['Elegí el almacén de origen correcto — la columna STOCK muestra lo disponible en ese almacén.', 'Al devolver, registrá la condición real (sirve para el historial de estado).'] },
  'caja-chica': { titulo: 'Caja Chica', que: 'Control de gastos menores de la obra: aperturas, gastos y rendiciones.', como: ['Registrá cada gasto con su comprobante; rendí la caja al cerrarla.'] },
  'ubicaciones': { titulo: 'Ubicaciones de Obra', que: 'Los almacenes y puntos de acopio de la obra donde vive el stock.', como: ['Creá las ubicaciones antes de mover stock — cada movimiento indica de/hacia qué almacén va.'] },
  'compras-pendientes': { titulo: 'Vinculación de Compras', que: 'Une las compras registradas por contabilidad con los ingresos físicos al almacén.', como: ['Revisá las compras pendientes y vinculalas con su entrada de materiales.', 'Así el costo contable y el stock físico cuentan la misma historia.'] },
  'evidencias': {
    titulo: 'Evidencias',
    que: 'La galería de archivos de la obra: fotos de movimientos, firmas de EPP, formatos, actas y documentos.',
    como: [
      'Cada rol ve SOLO lo pertinente a su función; lo contable (facturas, guías, bancarizaciones, detracciones) es exclusivo de contabilidad y admin.',
      'Lo que subís vos siempre lo ves, aunque sea de otro ámbito.',
      'Ordená la galería con las pestañas de categoría y el selector "Tipo" (muestra cada tipo con su cantidad — útil cuando hay decenas de firmas EPP).',
      'Subí archivos con "Subir Archivo" eligiendo el tipo correcto — de eso depende quién puede verlo.',
      'FOTOS DE IPHONE ANTIGUAS (.heic): si una foto vieja no se ve en la PC, el admin puede convertirlas todas a JPEG desde el badge de sincronización → "Mantenimiento: fotos HEIC antiguas" (correrlo en Safari; las nuevas ya se convierten solas al capturar).',
    ],
    rol: {
      almacenero: 'Ves lo de almacén, EPP y asistencia. Las guías de remisión y facturas son de contabilidad — no aparecen acá.',
      contador: 'Ves también todo lo contable: facturas, comprobantes, bancarizaciones, guías, recibos, pagos y constancias de detracción.',
      ayudante_contador: 'Ves también todo lo contable: facturas, comprobantes, bancarizaciones, guías, recibos, pagos y constancias de detracción.',
    },
  },
  'plantillas': { titulo: 'Plantillas', que: 'Formatos descargables de la obra (actas, formatos de registro) listos para imprimir o firmar.', como: ['Descargá la plantilla, completala/firmala y subila como evidencia del tipo que corresponda.'] },

  // ── COMPRAS / LOGÍSTICA ──────────────────────────────────────────
  'solicitud-residente': { titulo: 'Solicitud de Insumos', que: 'El pedido técnico de materiales del frente/residente hacia logística.', como: ['Pedí lo que la obra necesita con cantidades y fecha requerida.', 'Logística lo convierte en requisición u orden de compra — acá no se maneja dinero.'] },
  'requisiciones': { titulo: 'Requisiciones', que: 'Consolidación de solicitudes en pedidos formales de compra.', como: ['Agrupá solicitudes, definí cantidades finales y pasalas a cotización u orden de compra.'] },
  'ordenes-compra': { titulo: 'Órdenes de Compra', que: 'Las OC emitidas a proveedores, con sus ítems, montos y recepciones.', como: ['Emití la OC al proveedor elegido y registrá las recepciones contra ella.', 'La OC firmada se puede subir como evidencia (tipo "OC Firmada").'] },

  // ── MAQUINARIA ───────────────────────────────────────────────────
  'activos-pesados': { titulo: 'Equipos Pesados', que: 'Registro de maquinaria: horómetros, combustible y movimientos de equipos.', como: ['Registrá horas máquina y consumos por equipo — alimentan los costos de la obra.'] },
  'mantenimiento-programado': { titulo: 'Mantenimiento Programado', que: 'Plan de mantenimientos de la maquinaria con alertas por horómetro o fecha.', como: ['Programá el mantenimiento y registrá cuando se ejecute; la app avisa los vencidos.'] },

  // ── DIRECCIÓN ────────────────────────────────────────────────────
  'dashboard-ejecutivo': { titulo: 'Dashboard Ejecutivo', que: 'Vista de dirección: todas las obras en una pantalla (avance, costos, alertas).', como: ['Usalo para la foto semanal del grupo; cada obra linkea a su detalle.'] },
  'kpis-obra': { titulo: 'KPIs por Obra', que: 'Indicadores comparables entre obras: avance físico, consumo, cumplimiento.', como: ['Compará obras entre sí para detectar desvíos temprano.'] },
  'cumplimiento-cronograma': { titulo: 'Cumplimiento de Cronograma', que: 'Qué tan al día va cada obra contra su cronograma planificado.', como: ['Revisá los frentes atrasados y bajá al detalle de partidas.'] },
  'alertas': { titulo: 'Centro de Alertas', que: 'Todas las alertas del sistema en un solo lugar: stock crítico, vencimientos, incidencias.', como: ['Entrá a cada alerta para resolverla en su módulo de origen.'] },

  // ── FRENTE / TÉCNICO ─────────────────────────────────────────────
  'dashboard-tecnico': { titulo: 'Dashboard Técnico', que: 'Resumen del frente del ingeniero: sus partidas, avance y pendientes.', como: ['Es tu página de arranque: de acá saltás a reportar avance o pedir insumos.'] },
  'mis-partidas': { titulo: 'Partidas del Proyecto', que: 'Las partidas asignadas a tu frente con su avance y metrado.', como: ['Revisá el % de avance de cada partida — se actualiza con tus reportes diarios.'] },
  'cronograma-frente': { titulo: 'Cronograma de mis Partidas', que: 'Fechas planificadas de tus partidas.', como: ['Compará lo planificado contra tu avance real para anticipar atrasos.'] },
  'salidas-frente': {
    titulo: 'Vinculación de Insumos',
    que: 'Vincula las salidas de almacén con las partidas donde realmente se usaron — así el control de consumo por partida es real.',
    como: [
      'La 💡 te SUGIERE la partida que presupuesta cada material: confirmala con un clic, o elegí otra con el buscador.',
      'EN LOTE: marcá varias salidas con su casilla ☑ y vinculalas todas a una partida de un solo golpe; repetí por grupo ("estas 3 a esta partida, estas 2 a esta otra").',
      '"✨ Aplicar sugerencias" vincula automáticamente todas las pendientes que tengan sugerencia.',
      'Si te equivocaste, en "Registro de vinculaciones" pedís el cambio y lo aprueba el admin.',
    ],
  },
  'reporte-diario': { titulo: 'Reporte Diario', que: 'Tu reporte de avance del día: partidas trabajadas, metrados y fotos.', como: ['Reportá el mismo día; si es de un día anterior, indicá el motivo del atraso (queda registrado en el reporte).', 'BUSCADOR: escribí sin tildes tranquilo ("excavacion" encuentra EXCAVACIÓN), en cualquier orden de palabras; Enter agrega la primera sugerencia. Tus partidas reportadas recientemente aparecen primero.', 'FOTOS: "📷 Tomar foto" abre la cámara directo; "🖼️ Galería" busca en tu teléfono. Verás la miniatura de cada foto y podés quitarla con la ✕.', 'DESCRIPCIÓN: los botoncitos de arriba precargan tu última descripción de esa partida o un arranque de frase — después la completás (mínimo 5 palabras).', 'El borrador se guarda SOLO mientras escribís (las fotos se re-adjuntan al retomar). Al llegar al 100% la partida se marca terminada sola.', 'ATAJO: en tu Dashboard Técnico tenés el botón "📝 Reportar hoy".'] },
  'mis-reportes': { titulo: 'Mis Reportes', que: 'El historial de tus reportes diarios enviados.', como: ['Revisá el estado de cada reporte (aprobado/observado) y sus fotos.'] },
  'borradores-reporte': { titulo: 'Borradores', que: 'Reportes a medio llenar que guardaste para completar después.', como: ['Retomá el borrador y envialo — no cuenta como reporte hasta enviarlo.'] },
  'plan-real': { titulo: 'Plan vs Real', que: 'Comparación de tu avance real contra lo planificado.', como: ['Identificá las partidas con desvío y explicalo en tu reporte.'] },
  'emitir-alerta': { titulo: 'Emitir Alerta', que: 'Canal para reportar problemas del frente que necesitan atención (falta de material, interferencias).', como: ['Emití la alerta con detalle y foto; llega al Centro de Alertas de dirección.'] },
  'vinculacion-salidas': { titulo: 'Vinculación de Salidas', que: 'Asocia salidas de almacén con partidas ejecutadas.', como: ['Mantené las salidas vinculadas para que el costo por partida sea confiable.'] },

  // ── GESTIÓN DE OBRA ──────────────────────────────────────────────
  'dashboard-gestion': { titulo: 'Dashboard de Gestión', que: 'El tablero de la obra: avance físico, costos, incidencias y stock crítico.', como: ['Es la home del residente/supervisión: cada tarjeta baja al módulo respectivo.'] },
  'panel-residente': {
    titulo: 'Panel del Residente',
    que: 'La vista de control del residente: quién reportó hoy (ingenieros de frente y especialistas), el avance de los especialistas en los últimos 7 días y accesos a su gestión.',
    como: [
      'La tabla muestra por responsable si presentó su reporte de HOY.',
      'La columna "Últimos 7 días" resume cuántos días reportó cada especialista (SSOMA, Ambiental, Calidad, Social) y su último reporte — seguimiento de solo lectura, sin entrar a sus módulos.',
    ],
  },
  'importar': { titulo: 'Importar Presupuesto', que: 'Carga del presupuesto de obra (partidas + insumos) desde Excel.', como: ['Importá la estructura una vez; después trabajá versiones en vez de re-importar.'] },
  'partidas': { titulo: 'Partidas', que: 'La estructura del presupuesto de obra: partidas, metrados y precios.', como: ['Asigná partidas a frentes para que los ingenieros reporten sobre ellas.'] },
  'control-consumo': { titulo: 'Control de Consumo', que: 'Consumo real de insumos contra lo presupuestado por partida.', como: ['Los desvíos fuertes ameritan revisar salidas mal vinculadas o mermas.'] },
  'insumos': { titulo: 'Insumos por Partida', que: 'El detalle de insumos que compone cada partida del presupuesto.', como: ['Es la base del control de consumo: mantenelo fiel al expediente.'] },
  'versiones': { titulo: 'Versiones de Presupuesto', que: 'Historial de versiones del presupuesto (original, modificados).', como: ['Creá una versión nueva ante un adicional o deductivo — no pises la original.'] },
  'cronograma': { titulo: 'Cronograma / Gantt', que: 'La programación de la obra en Gantt.', como: ['Mantené fechas reales: alimentan el cumplimiento y los dashboards.'] },
  'avance': { titulo: 'Avance de Obra', que: 'El avance físico consolidado por partida y por frente, con evidencias.', como: ['Se alimenta de los reportes diarios aprobados de los ingenieros.'] },
  'aprobaciones-reporte': { titulo: 'Aprobación de Frentes', que: 'Cola de reportes diarios pendientes de aprobación.', como: ['Aprobá u observá con comentario; lo observado vuelve al ingeniero.'] },
  'rendimiento-ingenieros': { titulo: 'Rendimiento de Ingenieros', que: 'Ranking de reportes y avance por ingeniero.', como: ['Úsalo como termómetro de reportería, no como única vara de desempeño.'] },
  'comparativo': { titulo: 'Planificado vs Real', que: 'Curvas de avance planificado contra real de la obra.', como: ['El cruce de curvas te dice si la obra se adelanta o atrasa.'] },
  'costos': { titulo: 'Costos', que: 'Costos reales de la obra por categoría y partida.', como: ['Cruzalo con Control de Consumo para explicar los desvíos.'] },
  'valorizaciones': { titulo: 'Valorizaciones', que: 'Las valorizaciones mensuales de la obra (avance económico a cobrar).', como: ['Generá la valorización del periodo desde el avance aprobado.'] },
  'subcontratistas': { titulo: 'Subcontratistas', que: 'Directorio de subcontratistas de la obra.', como: ['Registralos acá para poder asignarles personal y subcontratos.'] },
  'subcontratos': { titulo: 'Subcontratos', que: 'Los contratos con subcontratistas: alcance, monto y avance.', como: ['El personal de un subcontratista aparece en Personal bajo la categoría "Subcontratos".'] },
  'subcontrato-valorizaciones': { titulo: 'Valorizaciones de Subcontrato', que: 'Avance económico a pagar a cada subcontratista.', como: ['Valorizá contra el avance real verificado del subcontrato.'] },
  'incidencias': { titulo: 'Incidencias', que: 'Registro de problemas de la obra: seguridad, calidad, stock, equipos.', como: ['La app también crea incidencias automáticas (p. ej. conflictos de stock al sincronizar) — revisalas y cerralas con su solución.'] },
  'movimientos-insumos': { titulo: 'Movimientos de Insumos', que: 'Vista consolidada de los movimientos de insumos de la obra.', como: ['Filtrá por insumo o fecha para auditar el flujo completo.'] },

  // ── CONTABILIDAD (obra y general) ────────────────────────────────
  'movimientos-contables': {
    titulo: 'Movimientos Contables',
    que: 'Todas las compras y ventas del grupo: facturas, estados de pago y bancarizaciones.',
    como: [
      'FILTROS con etiqueta (31-ago): la barra es una grilla donde cada desplegable dice qué filtra — Obra, Empresa, Período, Compra/Venta, Clasificación, TIPO DE COMPROBANTE (factura, boleta, nota de crédito, recibo… y "Con guía vinculada"), Estado de pago, BANCARIZACIÓN (necesita y no tiene / necesita y tiene / no necesita) y Emisor/Receptor. Todos se combinan; "✕ Limpiar filtros" vuelve a ver todo.',
      'GUÍA EN LA FILA: si el comprobante tiene guía de remisión vinculada, el chip 📄 abre su PDF al toque si la guía tiene el archivo adjunto (roles contables); si no lo tiene o no hay señal, lleva a la página Guías. El botón ↗ va directo a esa página. Así desde la misma fila ves comprobante (👁), pago/bancarización, detracción y guía.',
      'FACTURAS INTERCO: también se les puede pedir "Solicitar cambio", pero SOLO la VINCULACIÓN (obra/destino) o un pedido descriptivo — monto, fecha, estado de pago y eliminación se cambian desde "Operaciones entre empresas" (tocar un solo lado rompería el par). Al aprobarse la vinculación, el cambio se aplica a la factura Y a su compra espejo automática.',
      '🏷 INSUMOS PARA VENTA (botón arriba): los ítems facturados que NUNCA ingresaron a obra se pueden separar para venderlos. Flujo con doble control: 1) "💬 Comprobar" le pregunta a almacén si el insumo va a ingresar; 2) SOLO con el "No" de ESA consulta (un "No llegó" de la consulta vieja "¿llegó?" no cuenta — significa "todavía no"), la Contadora Jefe o un Admin lo SEPARA (queda en el pool "Disponibles para venta" con su costo de compra como referencia); si almacén responde que SÍ ingresó (total, parcial o en otra fecha) no se puede separar: vinculá el ingreso con 🔎 ¿llegó?; 3) al emitir la factura de venta, se vincula desde el pool → trazabilidad compra→venta. Un ítem separado deja de contar como "pendiente de recepción" en el semáforo y en la bandeja de almacén (aparece como 🏷 para venta). "↩" devuelve un ítem separado por error (también desde Vendidos si la venta se borró).',
      'FILTRO POR PERÍODO (📅): elegí un MES puntual (ej. "Junio 2026" — solo aparecen los meses que tienen comprobantes) o "Personalizado…" para un rango de fechas a medida. Al filtrar, arriba sale el RESUMEN del período: cuántos comprobantes y el total de Ventas y Compras (anulados excluidos; las notas de crédito restan). "✕ Quitar filtro" vuelve a todo el período.',
      'Facturas en soles > S/ 2,000 exigen bancarización: subila con el botón "Subir" de la fila (👁 "Ver" abre la constancia).',
      'OPERACIÓN ENTRE EMPRESAS DEL GRUPO: una venta interco son DOS movimientos (la venta y su compra espejo) por UN comprobante y UNA transferencia — la constancia que subas en cualquiera de las dos patas vale para las dos, y la otra muestra "✅ Bancarizado (por la contraparte interco)" con su botón Ver. No hay que subir el mismo voucher dos veces. Con un cliente EXTERNO no aplica: ahí la bancarización es propia de esa venta.',
      'Tres formas de bancarizar: Pago exacto (1 voucher = la factura), Pago en partes (varios vouchers a 1 factura) y Voucher multi-factura (1 depósito cubre varias facturas del mismo pagador→cobrador, con control de saldo).',
      'Cuando la cobertura llega al 100%, la factura pasa sola a "Pagado".',
      'DETRACCIÓN (SPOT): las facturas con detracción muestran su desglose (detracción y neto a pagar). Registrá el depósito con "Registrar depósito" subiendo la constancia del Banco de la Nación — queda "depositada". Si la IA no la detectó, con "＋ Detracción" la registrás a mano (sirve para compras y ventas).',
      'RECEPCIÓN EN ALMACÉN: cada factura de compra muestra un semáforo de si sus insumos llegaron — ✅ Recibido, 🟡 Parcial, ⏳ Sin confirmar, ❌ No recibido, o 🏢 Consumo empresa/general. Con el botón "🔎 ¿llegó?" (en las que faltan confirmar) la app te muestra los ingresos de almacén que cuadran por insumo/fecha/cantidad y los vinculás en 1 clic ("Sí, este"). La almacenera hace lo mismo desde su lado. Así sabés cuáles fueron a la obra y cuáles son consumo de empresa u otra obra.',
      'CONSULTAS CON ALMACÉN (💬 arriba): desde "🔎 ¿llegó?" podés "Preguntar a almacén" por una línea puntual (queda un hilo con la referencia exacta, sin montos); la almacenera responde Sí / Parcial / No / Otra fecha. El número en el botón son las consultas que te toca responder.',
      'REPORTE DE RECEPCIÓN (📊 arriba): resume, por insumo y por factura, cuánto de lo FACTURADO llegó a la obra, cuánto FALTA y cuánto es consumo de EMPRESA o gasto general (no fue a obra). Respeta el filtro de ámbito (obra/empresa) de arriba. Se alimenta de las vinculaciones que hacen los 🔎 ¿llegó? / buscar comprobante.',
      'El botón "Duplicados" detecta y fusiona comprobantes registrados dos veces.',
      'COSTO o GASTO ya NO se elige (31-ago): en Nuevo/Editar Movimiento elegís solo la CLASE (compra = egreso / venta = ingreso) y la VINCULACIÓN. De ahí sale la clasificación: vinculado a una OBRA → COSTO; a "Gastos Generales de la Empresa" → GASTO; Contabilidad Neta y "Sin clasificar" quedan provisionalmente como COSTO. El recuadro "Clasificación contable" te muestra en vivo cómo va a quedar y por qué. Cambiar la vinculación (acá, en la bandeja "Sin clasificar" o aprobando una solicitud) RECLASIFICA el movimiento solo.',
      'OPERACIONES ENTRE EMPRESAS DEL GRUPO: siempre cuentan como COSTO, aunque su vinculación diga Gastos Generales — es lo que le permite al Consolidado eliminarlas de a pares sin dobles conteos.',
      'AJUSTE MANUAL costo/gasto: cuando la vinculación no alcanza (una compra DE OBRA que igual es gasto administrativo: útiles de oficina, comida de una reunión), en Editar Movimiento tenés el selector "⚙ Automático / ✋ Forzar COSTO / ✋ Forzar GASTO". El ajuste manda sobre la vinculación y la fila queda marcada "✋ manual" en la lista (solo cuando contradice a la vinculación). "Automático" le devuelve el mando a la vinculación. En operaciones internas del grupo el ajuste NO se aplica (siguen siendo costo).',
      '✨ COSTO O GASTO (IA): el botón arriba del recuadro le pregunta a la IA si el comprobante es costo de obra o gasto de la empresa — mira la descripción, el proveedor, los ítems facturados y la obra. Te muestra su respuesta, el porqué y su confianza, pero NO se aplica sola: vos tocás "Aplicar como ajuste manual" si estás de acuerdo. Con confianza menor a 60% te avisa que lo decidas vos.',
    ],
    rol: {
      ayudante_contador: 'Una vez subida una bancarización queda fija: para cambiarla (constancia, tipo o montos) usá "Solicitar cambio" y lo aplica el admin o la Contadora Jefe. Antes de cada subida verás una ventana de confirmación — revisá monto y archivo ahí. La DETRACCIÓN sí la registrás vos: en la fila subís la constancia del depósito (Banco de la Nación) y queda "depositada".',
      contador: 'Con "Cambiar" podés reemplazar la constancia y con la ✕ de cada pago registrado eliminarlo (libera saldo de voucher) para rehacer la bancarización con el tipo correcto. La bandeja "Sin clasificar" te muestra las facturas que las asistentes marcaron como "No sé".',
      admin: 'Igual que la Contadora Jefe: "Cambiar", ✕ en pagos registrados, bandeja "Sin clasificar" y edición de la vinculación (obra / Gastos Generales / Contabilidad Neta) desde Editar Movimiento.',
    },
  },
  'conciliacion-insumos': { titulo: 'Conciliación de Insumos', que: 'Cruce entre lo comprado (facturas) y lo ingresado al almacén.', como: ['Las diferencias señalan compras sin ingreso o ingresos sin factura.'] },
  'pagos': {
    titulo: 'Pagos',
    que: 'Los pagos al PERSONAL y a subcontratos: sueldos de planilla, recibos por honorarios y sus transferencias parciales, con historial por cada persona.',
    como: [
      'Definí la FORMA DE PAGO de cada trabajador (planilla / RxH / otro) y tocá 💸 Pagar para crear el compromiso del período.',
      'PESTAÑA 📄 RECIBOS: todos los pagos en una sola lista estilo facturas, filtrable por EMPRESA pagadora, MES, forma de pago y búsqueda por palabras (trabajador, concepto, serie). Arriba ves el total acordado y pagado del filtro — ideal para ver, por ejemplo, "los recibos de Junio de CONSORCIO EL INCA".',
      'EMPRESA PAGADORA: los recibos nuevos de Captura Mágica ya la traen sola (el receptor del recibo). Los pagos VIEJOS nacieron sin empresa — el botón "⚠ N sin empresa — clasificar" te los muestra y les asignás la suya con el selector de la fila (una sola vez).',
      'Dentro del pago todo va separadito: 1️⃣ el DOCUMENTO del pago (recibo por honorarios o boleta/planilla firmada) y 2️⃣ cada TRANSFERENCIA con su constancia adjunta.',
      'Solo aparece personal ACTIVO y que no sea de subcontratos: a la gente de un subcontrato le paga su subcontratista — el pago va al SUBCONTRATO en su pestaña (los subcontratistas sin contrato formal también aparecen ahí).',
      'El historial por persona (con Σ total pagado) queda como base de datos de todo lo pagado; el personal inactivado conserva su historial en la sección de abajo.',
      'Los recibos por honorarios subidos por Captura Mágica ya crean acá el pago del trabajador con su recibo adjunto — solo te falta agregar la(s) transferencia(s)/voucher(s) hasta cubrir el total.',
      'Si una persona tiene muchos pagos, se muestran los primeros 3 y un botón "▾ +N más" que despliega TODOS (y "▲ ver menos" los colapsa).',
      'EVITÁ DUPLICAR: un recibo por honorarios subido por Captura Mágica YA crea el pago acá — para pagarlo, abrí ese pago desde su chip y agregá la transferencia. Si tocás "💸 Pagar" y la persona ya tiene pagos sin completar, la app te avisa (no crees uno nuevo para el mismo recibo).',
    ],
    rol: { ayudante_contador: 'Podés registrar pagos y subir recibos por honorarios y constancias. Los recibos y constancias son material contable: solo contabilidad y admin los ven en Evidencias.' },
  },
  'cont-dashboard': { titulo: 'Dashboard Contable', que: 'Resumen financiero del grupo: ingresos, egresos y pendientes por empresa.', como: [
    'Es la portada de contabilidad; cada indicador baja a su libro o listado.',
    'COSTOS vs GASTOS (31-ago): la tarjeta "Gastos" dejó de estar en cero. Los comprobantes vinculados a "Gastos Generales de la Empresa" ahora cuentan como GASTO y salieron de "Costos" — la suma Costos + Gastos y la utilidad NO cambian, cambia el reparto entre las dos tarjetas.',
    'INGRESOS SIN SUSTENTO: cuando almacén registra un material sin factura, aparece acá para vincularlo. Al tocar "Vincular factura", arriba salen las 🎯 SUGERENCIAS: las facturas que CUADRAN con ese ingreso (mismo insumo, fecha cercana, cantidad parecida) con su % de coincidencia, el ítem exacto de la factura y el porqué — elegí la correcta con un click y el ítem queda marcado como recibido. Abajo está el resto de facturas del proveedor (con sus ítems visibles) para elegir a mano si ninguna sugerencia aplica.',
  ] },
  'empresas': { titulo: 'Empresas', que: 'Las entidades legales del grupo (ejecutoras y proveedoras internas).', como: ['El RUC y la clase de cada empresa alimentan el cruce INTERCO y los filtros de emisor/receptor.', 'El RUBRO y el checkbox "📸 Mostrar en el portal de campo" controlan la tabla de RUCs que ve el personal de obra al subir facturas: solo salen las empresas marcadas.', 'VER DETALLE: el botón de cada fila abre la ficha de esa empresa. Arriba, sus números con el MISMO criterio del Consolidado (una moneda por vez, sin anulados y con lo facturado entre empresas del grupo separado). Abajo, QUÉ COMPRÓ: cada insumo con sus cantidades (unificando las formas en que el OCR escribe la unidad: "und", "unidad", "each"), el gasto por moneda, los proveedores, la última compra y las facturas detrás. Si además revende, muestra cuánto de ese insumo volvió a salir vendido y el saldo.', 'OJO con el inventario: es lo COMPRADO según las facturas con detalle de ítems (las de Captura Mágica), NO el stock — los consumos y salidas se llevan en Almacén por obra. Las facturas registradas a mano sin ítems se cuentan aparte y se avisa cuántas son.'] },
  'guias-remision': {
    titulo: 'Guías de Remisión',
    que: 'Las guías de remisión electrónicas: emitidas por el grupo o recibidas de proveedores, vinculadas a su factura, con detector de facturas a las que les FALTA la guía.',
    como: [
      'PESTAÑAS de origen: "↗ Emitidas" = el RUC emisor es una empresa del grupo; "↘ Recibidas" = la emitió un proveedor. Con filtros de vínculo, empresa, obra y fechas de emisión ("✕ Limpiar" resetea todo).',
      '🚚 "FACTURAS QUE REQUIEREN GUÍA": lista las facturas con ítems que NO son servicios (los bienes se trasladan con guía) y sin guía vinculada — separadas en VENTAS (nos tocaba emitirla: el riesgo tributario propio) y COMPRAS (reclamarla al proveedor). Por defecto muestra los últimos 90 días; "Ver todo el histórico" abre el backlog completo.',
      'En esa lista: "🔗 Vincular guía" ofrece las guías sueltas que pueden corresponder (coincidencia de referencia primero; en ventas solo guías emitidas por el grupo — sin mezclar RUCs); "✕ No requiere" saca la factura de la lista (pide confirmación y se puede DESHACER desde el plegado 🚫 "marcadas no requiere"). Las facturas sin detalle de ítems van en su propio plegado: "⚑ Sí requiere" las pasa a pendientes, "✕ No requiere" las descarta.',
      'UNA GUÍA PUEDE AMPARAR VARIAS FACTURAS (y una factura llevar varias guías): en la columna "Facturas vinculadas" se listan todas, cada una con su ✕ para quitar solo esa, y "+ otra factura" agrega una más sin tocar las que ya están.',
      '⏳ GUÍAS ESPERANDO SU FACTURA: el apartado ámbar de arriba lista las guías que referencian facturas todavía no cargadas ("falta F001-125"), y la fila de cada guía lleva el mismo chip. La guía YA está registrada acá (Captura Mágica no retiene nada); no hay que hacer nada más: cuando esa factura entre por Captura Mágica, el vínculo se cierra solo y la guía sale de la lista. El filtro de vínculo tiene la opción "Esperando factura" para ver solo esas en la tabla.',
      '📦 FACTURAS CON GUÍAS INCOMPLETAS: el panel naranja lista las facturas que YA tienen guía pero cuyas cantidades trasladadas no llegan a lo facturado (ej. "falta 25 bolsas de Cemento Sol: 75 de 100") — o sea que falta que entreguen el resto y suba su guía. Se compara descripción + unidad; si las descripciones de la guía y la factura no se parecen en nada, la factura NO se lista (preferimos no avisar antes que dar una alarma falsa).',
      'Se cargan principalmente por Captura Mágica, donde ya se eligen las facturas a vincular sobre las recomendaciones que muestra la pantalla de revisión.',
      'Su PDF es material contable: solo contabilidad y admin lo ven en Evidencias.',
    ],
  },
  'intercompany': { titulo: 'Operaciones entre Empresas', que: 'Las operaciones INTERCO: ventas/compras entre empresas del propio grupo.', como: ['Editá los movimientos INTERCO desde acá (en Movimientos aparecen bloqueados).'] },
  'trazabilidad': { titulo: 'Trazabilidad de Cadenas', que: 'Sigue la cadena de un insumo o dinero a través de las empresas del grupo.', como: ['Útil para sustentar el recorrido proveedor → interco → obra.'] },
  'compras-categoria': { titulo: 'Compras por Categoría', que: 'Las compras agrupadas por categoría de gasto.', como: ['Sirve para ver en qué se va la plata por rubro y por periodo.'] },
  'ordenes-intercompany': { titulo: 'Órdenes Intercompany', que: 'Órdenes de venta/compra entre empresas del grupo.', como: ['Generalas para respaldar el flujo INTERCO antes de facturar.'] },
  'consolidado': { titulo: 'Consolidado', que: 'Los números del grupo consolidados (eliminando el efecto INTERCO).', como: ['Es la vista "de verdad" del grupo: sin dobles conteos entre empresas.'] },
  'cuentas-bancarias': { titulo: 'Cuentas Bancarias', que: 'Las cuentas del grupo y sus movimientos bancarios.', como: ['Mantené los saldos al día para que el flujo de caja sea confiable.'] },
  'flujo-caja': { titulo: 'Flujo de Caja / Pagos', que: 'Entradas y salidas de dinero por empresa, con cronograma de pagos.', como: ['Programá los pagos por vencer y marcalos al ejecutarlos.'] },
  'flujo-proyectado': { titulo: 'Flujo de Caja Proyectado', que: 'La proyección de caja de las próximas semanas por empresa.', como: ['Se alimenta del cronograma de pagos y las cobranzas esperadas.'] },
  'plan-cuentas': { titulo: 'Plan de Cuentas (PCGE)', que: 'El plan contable general empresarial usado para clasificar asientos.', como: ['La IA sugiere la cuenta PCGE al categorizar; corregila si no aplica.'] },
  'libro-diario': {
    titulo: 'Libro Diario / Asientos',
    que: 'Los asientos contables generados automáticamente desde los movimientos (PCGE Perú), con herramienta de cuadre y acceso al comprobante.',
    como: [
      'CUADRE: cada asiento que no cuadra solo (debe ≠ haber) sale marcado en rojo con su Δ propio y una explicación de la causa. La tarjeta "Cuadre" y el check "Solo descuadrados" filtran directo a los culpables — ya no hay que buscar el descuadre a mano en Excel.',
      'OJO 👁 en la glosa: abre el comprobante adjunto del movimiento (la misma factura/imagen que se ve en Movimientos).',
      'NOTAS DE CRÉDITO: se asientan como EXTORNO (montos positivos con debe y haber invertidos, contrapartida 121/42 — o 41 si es planilla) y llevan el badge "↩ NC · extorno". Por eso los totales Debe/Haber SUBEN en bruto respecto de antes — pero ahora cuadran.',
      'El export a Excel incluye la columna "Δ asiento": si algo descuadra, el culpable salta solo al ordenar por esa columna.',
      'MONEDA EXTRANJERA: los asientos en USD llevan su badge azul y NO se suman con los totales en S/ (sin tipo de cambio, mezclarlos inventaría un número). El total dice "solo S/" y la tarjeta Haber muestra aparte cuánto hay en la otra moneda.',
      'IGV REAL (31-ago): la base y el IGV de cada asiento salen del COMPROBANTE, no de un 18% inventado. Las facturas de comida con tasa especial (8% IGV + 2% IPM = 10%) y las exoneradas se asientan con su IGV verdadero, así la repartición 70 / 4011 es la de la factura.',
      'BADGE DE IGV: solo aparece cuando hay algo que mirar. Azul "IGV 10% del comprobante" = tasa distinta a la general. Ámbar "IGV 18% estimado" = ese comprobante NO trae desglose y hubo que estimarlo (corregí el movimiento si la tasa era otra). Sin badge = factura normal al 18% leída del comprobante.',
      'Si el comprobante tiene parte EXONERADA o INAFECTA (o bolsa/ICBPER), esa parte va a la misma cuenta 60/63/70 junto con la gravada —así lo manda el PCGE— y la línea lo dice: "incluye S/ X no gravado".',
      'FECHAS: la columna Fecha y los filtros de año/mes muestran el día del comprobante. Antes toda fecha salía un día antes (y una factura del 01 del mes caía en el mes anterior).',
      'COSTOS vs GASTOS: el badge de cada asiento dice Ingreso / Costo / Gasto según la VINCULACIÓN del movimiento (obra = costo, Gastos Generales de la empresa = gasto). Ya no es un campo que se teclee.',
    ],
  },
  'balance-general': { titulo: 'Balance General', que: 'La foto de activos, pasivos y patrimonio por empresa.', como: ['Elegí empresa y periodo; los números salen de los asientos registrados.'] },
  'estado-resultados': { titulo: 'Estado de Resultados', que: 'Ingresos, costos y gastos del periodo por empresa.', como: [
    'Compará contra el periodo anterior con "Comparativo Periodos".',
    'La línea de GASTOS se alimenta de los comprobantes vinculados a "Gastos Generales de la Empresa"; la de COSTOS, de los vinculados a una obra. Si algo está en la línea equivocada, se corrige cambiando la VINCULACIÓN del movimiento (Movimientos Contables), no un campo de tipo.',
  ] },
  'comprobantes': { titulo: 'Comprobantes Electrónicos SUNAT', que: 'Los comprobantes electrónicos emitidos/recibidos consultados contra SUNAT.', como: ['Validá el estado del comprobante (aceptado/anulado) antes de contabilizarlo.'] },
  'libros-electronicos': { titulo: 'Libros Electrónicos PLE / PDT', que: 'Generación de los libros electrónicos para SUNAT.', como: [
    'Generá el PLE del periodo cerrado y presentalo según cronograma SUNAT.',
    'IGV REAL (31-ago): los registros de Compras y Ventas declaran el IGV del COMPROBANTE (antes se calculaba siempre al 18%). Lo que no paga IGV —exonerado, inafecto, bolsa— va a su propia columna y no infla la base gravada ni el crédito fiscal.',
    'PERÍODO: un comprobante del día 1 del mes ya cae en SU mes (antes se iba al mes anterior, y uno del 1 de enero, al año anterior). Si presentaste PLE de meses anteriores, vale la pena regenerarlos y comparar.',
    'NOTAS DE CRÉDITO/DÉBITO: ahora llevan las columnas del DOCUMENTO DE REFERENCIA (fecha, tipo, serie y número de la factura que modifican) — SUNAT observa las notas que van sin ellas. La factura original se toma del vínculo de la nota, aunque sea de un mes anterior; si esa factura no está en el sistema, las 4 columnas van vacías (no se inventan datos).',
    'MONEDA: las compras en dólares se declaran en USD. Antes salían todas como PEN con tipo de cambio 0.000 — si presentaste Registro de Compras de meses con facturas en dólares, regeneralo.',
  ] },
  'config-sunat': { titulo: 'Configuración SUNAT', que: 'Credenciales y parámetros de conexión con SUNAT.', como: ['Solo el admin debería tocar esto; un dato mal puesto rompe las consultas.'] },
  'comparativo-periodos': { titulo: 'Comparativo de Periodos', que: 'Compara los números contables entre dos periodos.', como: ['Ideal para detectar saltos raros de un mes a otro.'] },

  // ── SSOMA / ESPECIALIDADES ───────────────────────────────────────
  'reporte-especialidad': { titulo: 'Reporte Diario de Especialidad', que: 'El reporte diario del especialista (seguridad, ambiental, calidad, social) con actividades y fotos.', como: ['Reportá cada día con evidencias — tu bloque de Inicio muestra SOLO tu especialidad.'] },
  'charlas-plan': { titulo: 'Planificador de Charlas', que: 'La programación semanal/mensual de charlas de seguridad.', como: ['Planificá los temas y marcá las dictadas con su asistencia.'] },
  'sctr-personal': {
    titulo: 'SCTR del Personal',
    que: 'El control de pólizas SCTR en dos ventanas: DOCUMENTOS (el trámite completo, subido con IA) y TRABAJADORES (quién tiene SCTR, con qué póliza y hasta cuándo).',
    como: [
      'DOCUMENTOS (Contadora Jefe/admin): subí el PDF del trámite COMPLETO (cotización + constancia + pago + factura juntos) — la IA lo separa en 4 documentos, lee los asegurados y la vigencia, y te muestra la lista para CORROBORAR antes de vincular.',
      'Al confirmar, los trabajadores corroborados quedan con su vencimiento, aseguradora y póliza de un solo golpe.',
      'TRABAJADORES: el semáforo muestra vencidos, sin SCTR y por vencer — cada fila con aseguradora/póliza y vencimiento. También se puede cargar el SCTR de una persona a mano.',
      'La subida (documentos o carga manual) es SOLO de la Contadora Jefe y el admin.',
    ],
    rol: { prevencionista: 'Consultás los vencimientos para avisar a tiempo y en Documentos ves SOLO el certificado/constancia (la cotización, el pago y la factura son del área contable).' },
  },
  'inducciones': { titulo: 'Inducciones', que: 'Registro de inducciones de seguridad del personal nuevo con su ficha firmada.', como: ['Subí la ficha de inducción firmada como evidencia de cada trabajador.'] },
  'charlas-seguridad': { titulo: 'Charlas de 5 minutos', que: 'El registro diario de charlas de seguridad con asistencia.', como: ['Registrá la charla del día con tema y asistentes.'] },
  'iperc': { titulo: 'IPERC', que: 'Matriz de identificación de peligros y evaluación de riesgos por actividad.', como: ['Mantené la matriz al día cuando cambien las actividades del frente.'] },
  'epps-inventario': {
    titulo: 'EPPs (inventario)', que: 'La BASE DE DATOS de equipos de protección personal: catálogo, stock y accesos rápidos a su historial — manejo igual que Materiales.',
    como: [
      'Igual que materiales: el stock se mueve con entregas y reposiciones, no a mano.',
      '👷 POR TRABAJADOR: el botón "Por trabajador" abre la ventana para revisar, organizar y filtrar los EPPs entregados a CADA persona — resumen por trabajador (entregas, unidades, última entrega) y su detalle con filtro por EPP.',
      'HISTORIAL DE UN EPP: el botón 📜 de cada fila te lleva a "Mov. de EPPs" con la búsqueda ya cargada con ese EPP.',
      '"Movimientos" (arriba) abre el historial completo, igual que "Mov. de Materiales".',
    ],
    rol: { prevencionista: 'Lo ves en CONSULTA: las entradas y salidas las registra la almacenera — tu rol es verificar y cuadrar con ella.' },
  },
  'mov-epp': {
    titulo: 'Movimientos de EPPs',
    que: 'El historial completo de entregas y entradas de EPP — espejo de "Mov. de Materiales".',
    como: [
      'BÚSQUEDA POR PALABRAS: cada palabra debe coincidir, en cualquier orden — buscá por EPP, trabajador, motivo, almacén o frente (ej. "guantes juan").',
      'Filtrá por tipo con los botones: Entradas (compras), Entregas (salidas a trabajadores) o Devoluciones.',
      'Llegás acá pre-filtrado desde el 📜 de un EPP del inventario o desde "Ver en Movimientos" de la ventana Por trabajador.',
    ],
  },
  'epp': {
    titulo: 'Entregas de EPP', que: 'La entrega de EPPs al personal con firma digital del trabajador, y las entradas (compras) al inventario.',
    como: [
      'Registrá la entrega y capturá la FIRMA del trabajador — queda como evidencia (tipo "Firma EPP").',
      '¿Te equivocaste en una cantidad o fecha? Usá el botón de alerta (⚠) de la fila: pedís el cambio o la ELIMINACIÓN del registro y el admin lo aprueba desde Solicitudes — el stock se reajusta solo.',
    ],
    rol: { prevencionista: 'Lo ves en CONSULTA: las entregas las registra la almacenera; vos verificás a quién se entregó y cuadrás con ella.' },
  },
  'insumos-persona': { titulo: 'Insumos por Persona', que: 'Qué EPPs/insumos tiene asignados cada trabajador.', como: ['Consultalo antes de reponer: muestra la última entrega de cada ítem.'] },
  'inspecciones-seguridad': { titulo: 'Inspecciones', que: 'Inspecciones de seguridad programadas y sus hallazgos.', como: ['Registrá hallazgos con foto y hacé seguimiento hasta cerrarlos.'] },
  'capacitaciones': { titulo: 'Capacitaciones', que: 'Las capacitaciones del personal y su asistencia.', como: ['Registrá cada capacitación con sus asistentes y evidencia.'] },
  'insumos-emergencia': { titulo: 'Insumos de Emergencia', que: 'Stock de emergencia (botiquines, extintores) con control de vencimientos.', como: ['Las salidas también respetan el candado cronológico de fechas.'] },
  'gestion-ambiental': { titulo: 'Gestión Ambiental', que: 'Registros ambientales ISO 14001: monitoreos, residuos, evidencias.', como: ['Cargá los registros del plan de manejo ambiental con su evidencia.'] },
  'gestion-calidad': { titulo: 'Gestión de Calidad', que: 'Certificados de calidad de insumos contra el expediente técnico.', como: ['Verificá cada insumo crítico: certificado presente y vigente.'] },
  'gestion-social': { titulo: 'Gestión Social', que: 'La relación con la comunidad: compromisos, quejas/reclamos y padrón de actores.', como: ['Registrá cada compromiso y dale seguimiento hasta cumplirlo.'] },

  // ── RRHH ─────────────────────────────────────────────────────────
  'personal': {
    titulo: 'Personal',
    que: 'El padrón del personal de la obra con su CATEGORÍA: Personal Obrero, Profesionales, Subcontratos (por subcontratista) y Otros.',
    como: [
      'Filtrá por categoría con el selector; la categoría se deriva sola del cargo/subcontratista.',
      'Los roles con scope (seguridad/almacenera/residente) crean SOLO personal obrero — directo (Peón/Oficial/Operario/Maestro/Capataz) o de subcontrato (eligiendo el subcontratista). Los profesionales y "Otros" los registra el admin.',
      'Si el subcontrato aún no existe, usá "Solicitar subcontrato": el admin lo aprueba y lo crea, y después le vinculás el personal.',
      'Inactivá al personal que cesa (estado inactivo/retirado) — deja de ofrecerse en Pagos y demás módulos, pero conserva su historial.',
    ],
    rol: { ingeniero_residente: 'Ves y gestionás SOLO Personal Obrero y de Subcontratos — los profesionales y "Otros" están fuera de tu alcance.' },
  },
  'frentes': { titulo: 'Frentes de Trabajo', que: 'Los frentes de la obra y qué personal/partidas tiene cada uno.', como: ['Asigná ingenieros y partidas a cada frente para ordenar la reportería.'] },
  'asistencia': { titulo: 'Asistencia', que: 'El control diario de asistencia del personal, con foto/lista.', como: ['Registrá la asistencia del día; la foto de la lista queda como evidencia.'] },
  'personal-contratos': { titulo: 'Contratos Laborales', que: 'Los contratos del personal y sus vigencias.', como: ['Cargá el contrato firmado y su vigencia para el control de vencimientos.'] },
  'planillas': { titulo: 'Planillas / Sueldos', que: 'El cálculo y pago de planillas del personal.', como: ['Generá la planilla del periodo y registrá los pagos con constancia.'] },
  'cts': { titulo: 'CTS', que: 'El control de depósitos CTS del personal.', como: ['Calculá y registrá los depósitos semestrales con su constancia.'] },
  'gratificaciones': { titulo: 'Gratificaciones', que: 'El cálculo de gratificaciones de julio y diciembre.', como: ['Generá el cálculo del periodo y registrá el pago.'] },
  'plame': { titulo: 'PLAME / T-Registro', que: 'La información para las declaraciones laborales SUNAT.', como: ['Mantené el T-Registro al día con altas y bajas del personal.'] },

  // ── ADMINISTRACIÓN ───────────────────────────────────────────────
  'usuarios': {
    titulo: 'Usuarios',
    que: 'La gestión de cuentas: crear usuarios, asignarles rol y obras.',
    como: [
      'Al crear un usuario definí email, contraseña (mín. 8), ROL y al menos 1 obra (salvo admin).',
      'El usuario solo ve datos de sus obras asignadas — "Editar obras" para cambiarlas después.',
      '"Cambiar rol" actualiza también el rol en sus obras asignadas.',
    ],
  },
  'roles': { titulo: 'Roles y Permisos', que: 'La matriz de qué módulos ve y edita cada rol.', como: ['Cambiá con cuidado: un permiso de más expone información sensible.'] },
  'solicitudes': {
    titulo: 'Solicitudes',
    que: 'La bandeja de solicitudes de cambio que envían los usuarios: cambios de campos, eliminaciones de movimientos, vinculación de facturas, bancarizaciones equivocadas, subcontratos nuevos.',
    como: [
      'La mayoría se APLICA SOLA al aprobar: cantidades y eliminaciones de movimientos (recalculan stock/consumo), la vinculación de facturas (obra / Gastos Generales / Contabilidad Neta), la eliminación de bancarizaciones (borra partes/constancias, libera vouchers y devuelve la factura a Pendiente si queda descubierta) y la eliminación de DETRACCIONES (borra la constancia y deja la factura sin detracción).',
      'SOLICITUDES "FANTASMA": si al enviar una solicitud no había señal (o falló la subida), queda guardada SOLO en tu dispositivo y el admin NO la ve. Ahora la página te lo muestra con un cartel rojo "⚠ N solicitud(es) SIN SUBIR" con el motivo del fallo y el botón "⬆ Subir ahora". Si enviaste una solicitud y el admin dice que no le llegó: entrá a Solicitudes y mirá ese cartel.',
      '↗ IR AL REGISTRO: en cada solicitud, este botón abre la sección correspondiente CON EL REGISTRO YA BUSCADO (facturas, movimientos de materiales/EPP, catálogos, pagos, personal) — ya no hay que buscarlo a mano para entender qué piden cambiar.',
      'PESTAÑA "RESUELTAS" (admin/Contadora Jefe): el historial de todo lo que aprobaste o rechazaste, con filtros por persona, tipo, estado (aprobada/rechazada), CUÁNDO te la pidieron y CUÁNDO la resolviste, más tu comentario de revisión.',
      'En una PC COMPARTIDA, las solicitudes encoladas por otro usuario suben recién cuando ESA persona vuelve a iniciar sesión ahí (aparecen con la etiqueta "de otro usuario").',
      'Las marcadas "acción manual del admin" son descriptivas: hacé el cambio en su módulo y aprobá como acuse.',
      'Usá el buscador y los filtros (chips por PERSONA y menú por TIPO) para no perder ninguna: la bandeja mezcla las solicitudes de almacén, obra y contabilidad de todos los usuarios.',
      'Al enviar: los campos que se eligen de una lista (ej. la vinculación de una factura) se mandan de una — no hay pantalla de "confirmar". Solo el texto libre pide revisar el cambio antes de enviarlo.',
    ],
  },
  'configuracion': { titulo: 'Configuración', que: 'Parámetros generales de la app.', como: ['Tras cada actualización de la app, cerrá y reabrila para tomar la versión nueva.', 'ADMIN: en Sistema podés fijar los minutos de inactividad antes del cierre automático de sesión (5 a 480; default 30). Es global y le llega a cada equipo con el sync — rige desde su próxima interacción.'] },
  'conflictos': { titulo: 'Conflictos de Sincronización', que: 'Registros donde dos dispositivos editaron lo mismo sin conexión.', como: ['Elegí qué versión gana; el resto de dispositivos se actualiza solo.'] },
  'audit-log': { titulo: 'Auditoría', que: 'El registro de quién hizo qué y cuándo en toda la app.', como: ['Buscá por usuario, tabla o registro para reconstruir cualquier cambio.'] },
};

const FALLBACK = {
  titulo: 'Esta sección',
  que: 'Sección de JARVEX. Aún no tiene ayuda detallada escrita.',
  como: ['Explorá con confianza: casi todo se registra con el botón principal de la esquina superior.', 'Si algo no queda claro, avisale al administrador para que sumemos la ayuda de esta sección.'],
};

/**
 * Ayuda de una página para un rol.
 * @returns {{ titulo, que, como: string[], notaRol: string|null, notaRolGeneral: string|null }}
 */
export function ayudaDe(pageId, rol) {
  const base = AYUDA[pageId] || FALLBACK;
  return {
    titulo: base.titulo,
    que: base.que,
    como: base.como || [],
    notaRol: (base.rol && rol && base.rol[rol]) || null,
    notaRolGeneral: (rol && ROL_GENERAL[rol]) || null,
  };
}

export { AYUDA };
