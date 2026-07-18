// ═══════════════════════════════════════════════════════════════════
// JARVEX — Programación de los reportes por email (diario/semanal/mensual).
//
// Lógica PURA compartida entre el builder (scripts/reporte-email, corre por
// GitHub Actions cada hora) y la UI de configuración. Cada tipo de reporte
// tiene su fila en reportes_email_config: activo, hora_envio, día (semana o
// mes) y destinatarios. El builder corre cada hora y pregunta "¿este reporte
// debe salir ahora?" — con catch-up: si una corrida se saltó (Actions caído),
// el reporte sale en la siguiente hora del MISMO día.
//
// Perú no tiene horario de verano → Lima = UTC-5 fijo.
// ═══════════════════════════════════════════════════════════════════

/** Partes de fecha/hora en Lima a partir de un Date (UTC-5 fijo). */
export function partesLima(date) {
  const t = new Date(date.getTime() - 5 * 3600 * 1000);
  const fecha = t.toISOString().slice(0, 10);
  return {
    fecha,                                   // 'YYYY-MM-DD'
    hora: t.getUTCHours(),                   // 0-23
    diaSemana: ((t.getUTCDay() + 6) % 7) + 1, // 1=Lunes … 7=Domingo (como DIAS_SEMANA de la UI)
    diaMes: t.getUTCDate(),                  // 1-31
  };
}

/** Resta días a una fecha 'YYYY-MM-DD' (para los rangos semanal/mensual). */
export function fechaMenosDias(fecha, dias) {
  const d = new Date(fecha + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

const horaDe = (horaEnvio, def = 18) => {
  const h = parseInt(String(horaEnvio ?? '').split(':')[0], 10);
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : def;
};

const diasEntre = (desde, hasta) => {
  if (!desde) return Infinity;
  return Math.round((new Date(hasta + 'T00:00:00Z') - new Date(String(desde).slice(0, 10) + 'T00:00:00Z')) / 86400000);
};

/**
 * ¿El reporte configurado en `cfg` debe enviarse en este instante (Lima)?
 * cfg: { tipo: 'diario'|'semanal'|'mensual', activo, hora_envio, dia_semana
 *        (1=Lun…7=Dom), dia_mes (1-28), destinatarios[], ultimo_envio,
 *        frecuencia (legacy del diario: 'diario'|'cada_3_dias') }
 * ahora: resultado de partesLima().
 */
export function debeEnviarse(cfg, ahora) {
  if (!cfg || !cfg.activo) return false;
  if (!Array.isArray(cfg.destinatarios) || cfg.destinatarios.length === 0) return false;
  // Ya salió hoy (el guard clave del catch-up: máx. 1 envío por día por tipo).
  if (cfg.ultimo_envio && String(cfg.ultimo_envio).slice(0, 10) === ahora.fecha) return false;
  // Aún no llega la hora configurada (después de esa hora, cualquier corrida lo manda).
  if (ahora.hora < horaDe(cfg.hora_envio)) return false;

  const tipo = cfg.tipo || 'diario';
  if (tipo === 'diario') {
    // Legacy: la frecuencia 'cada_3_dias' del config viejo se respeta.
    if (cfg.frecuencia === 'cada_3_dias') return diasEntre(cfg.ultimo_envio, ahora.fecha) >= 3;
    return true;
  }
  if (tipo === 'semanal') return ahora.diaSemana === (Number(cfg.dia_semana) || 1);
  if (tipo === 'mensual') return ahora.diaMes === (Number(cfg.dia_mes) || 1);
  return false;
}

/** Rango [desde, hasta] (inclusive, 'YYYY-MM-DD') que cubre cada tipo. */
export function rangoDe(tipo, hoy) {
  if (tipo === 'semanal') return { desde: fechaMenosDias(hoy, 6), hasta: hoy };
  if (tipo === 'mensual') return { desde: fechaMenosDias(hoy, 29), hasta: hoy };
  return { desde: hoy, hasta: hoy };
}
