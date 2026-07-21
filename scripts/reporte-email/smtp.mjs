// ═══════════════════════════════════════════════════════════════════
// JARVEX — Cliente SMTP mínimo para Gmail (cero dependencias, node:tls).
//
// Envía el HTML de reportes_email_outbox directo desde GitHub Actions,
// eliminando a n8n del circuito. Usa el puerto 465 (TLS implícito) de
// smtp.gmail.com con AUTH LOGIN — requiere una CONTRASEÑA DE APLICACIÓN
// de Gmail (cuenta con verificación en 2 pasos): GMAIL_USER +
// GMAIL_APP_PASSWORD como secrets del repo.
// ═══════════════════════════════════════════════════════════════════
import tls from 'node:tls';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
// Asuntos con tildes/emoji → RFC 2047 (si es ASCII puro va tal cual).
const encabezado = (s) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
// El cuerpo va en base64 con líneas de 76 chars (evita problemas de longitud
// de línea y de "dot-stuffing" del protocolo).
const cuerpo76 = (s) => b64(s).replace(/(.{76})/g, '$1\r\n');

/**
 * Envía UN correo HTML por Gmail. Rechaza con el último diálogo SMTP si algo
 * falla (código inesperado, timeout de 60s, socket caído).
 * @param {{ user, pass, to: string[], subject, html }} p
 */
export function enviarGmail({ user, pass, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const destinos = (to || []).map((d) => String(d).trim()).filter(Boolean);
    if (!destinos.length) return reject(new Error('sin destinatarios'));

    const mensaje = [
      `From: JARVEX <${user}>`,
      `To: ${destinos.join(', ')}`,
      `Subject: ${encabezado(subject || 'Reporte JARVEX')}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      cuerpo76(html || ''),
    ].join('\r\n');

    // Guion del diálogo: se espera el código N y ENTONCES se envía el comando.
    const pasos = [
      { espera: 220, envia: 'EHLO jarvex.app' },
      { espera: 250, envia: 'AUTH LOGIN' },
      { espera: 334, envia: b64(user) },
      { espera: 334, envia: pass ? b64(pass) : '' },
      { espera: 235, envia: `MAIL FROM:<${user}>` },
      ...destinos.map((d) => ({ espera: 250, envia: `RCPT TO:<${d}>` })),
      { espera: 250, envia: 'DATA' },
      { espera: 354, envia: `${mensaje}\r\n.` },
      { espera: 250, envia: 'QUIT', fin: true },
    ];

    let i = 0;
    let acumulado = '';
    let terminado = false;
    const socket = tls.connect(465, 'smtp.gmail.com', { servername: 'smtp.gmail.com' });
    const cerrar = (err) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      try { socket.end(); } catch { /* ya cerrado */ }
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => cerrar(new Error('timeout SMTP (60s)')), 60000);

    socket.on('error', (e) => cerrar(new Error(`socket SMTP: ${e.message || e}`)));
    socket.on('data', (chunk) => {
      if (terminado) return;
      acumulado += chunk.toString('utf8');
      // Respuesta completa = última línea "NNN " (espacio, no guion = fin de multilínea).
      const lineas = acumulado.split(/\r?\n/).filter(Boolean);
      const ultima = lineas[lineas.length - 1] || '';
      if (!/^\d{3} /.test(ultima)) return; // aún parcial (o multilínea "250-")
      const codigo = Number(ultima.slice(0, 3));
      const paso = pasos[i];
      acumulado = '';
      if (!paso) return cerrar();
      if (codigo !== paso.espera) {
        return cerrar(new Error(`SMTP esperaba ${paso.espera} y llegó: ${ultima.slice(0, 200)}`));
      }
      socket.write(paso.envia + '\r\n');
      i++;
      if (paso.fin) cerrar(); // tras QUIT no hace falta esperar el 221
    });
  });
}
