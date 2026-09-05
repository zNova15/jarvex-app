// Cómo se le muestra a la usuaria QUÉ motor leyó cada comprobante.
//
// Desde el 5-sep-2026 la lectura puede resolverse por más de un camino: el
// postprocesamiento normal va a un modelo gratuito por OpenRouter, y Claude
// queda de respaldo automático. Sin esto, dos facturas que tardaron 3 s y 20 s
// se ven idénticas en la bandeja y no hay forma de saber por qué.
//
// La regla que no se puede romper: **la etiqueta no puede mentir**. Si la
// lectura la terminó el respaldo, tiene que decirlo — es la señal de que el
// motor titular está fallando y alguien debería mirarlo.

const ETIQUETAS = {
  'mistral-ocr+openrouter': { texto: 'Mistral OCR + OpenRouter', respaldo: false },
  'mistral-ocr+claude': { texto: 'Mistral OCR + Claude', respaldo: false },
  'mistral-ocr+claude(respaldo)': { texto: 'Mistral OCR + Claude (respaldo)', respaldo: true },
  'claude-vision': { texto: 'Claude visión', respaldo: true },
};

// 3512 → '3,5 s' · 890 → '0,9 s'. Coma decimal (es-PE).
export function segundos(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

// motor = { engine, model, proveedor, ms } tal como lo guarda la fila.
// Devuelve null si no hay nada que mostrar (comprobantes leídos antes de este
// cambio, que quedaron guardados sin `motor`).
export function etiquetaMotorIa(motor) {
  if (!motor || !motor.engine) return null;
  const conocido = ETIQUETAS[motor.engine];
  const base = conocido || { texto: motor.engine, respaldo: false };
  const t = segundos(motor.ms);
  // El detalle (tooltip) lleva el modelo REAL servido y el proveedor de
  // cómputo: con la cadena de respaldo, el titular configurado y el que
  // respondió pueden ser distintos.
  const detalle = [
    motor.model ? `Modelo: ${motor.model}` : null,
    motor.proveedor ? `Proveedor: ${motor.proveedor}` : null,
    t ? `Tardó ${t}` : null,
    base.respaldo ? 'Se resolvió por el motor de respaldo.' : null,
  ].filter(Boolean).join(' · ');
  return { texto: base.texto, respaldo: base.respaldo, tiempo: t, detalle };
}
