-- ═══════════════════════════════════════════════════════════════════
-- 219 — Estado 'ilegible' para las capturas de campo (17-set-2026)
--
-- POR QUÉ. El 16-set dos facturas del portal de campo se subieron como un
-- JPEG en blanco. Contabilidad se enteró DOS DÍAS DESPUÉS, al intentar
-- leerlas — y para entonces el comprobante de papel ya no estaba. El error
-- vivía en la bandeja de UNA PC y nunca llegaba a la única persona que podía
-- arreglarlo: la que sacó la foto.
--
-- 'ilegible' es ese aviso de vuelta. Lo pone contabilidad (o la propia
-- lectura, cuando la IA responde `doc_ilegible`) y el portal de campo lo
-- muestra en rojo: «esta foto no se pudo leer, hay que sacarla de nuevo».
--
-- NO es un estado de cierre: la foto sigue contando como pendiente en la
-- bandeja, porque el comprobante sigue sin registrarse. Se cierra cuando
-- alguien la vuelve a subir (entra como fila nueva) o cuando contabilidad la
-- descarta a mano.
-- ═══════════════════════════════════════════════════════════════════

alter table public.evidencias
  drop constraint if exists evidencias_campo_revision_check;

alter table public.evidencias
  add constraint evidencias_campo_revision_check
  check (
    campo_revision is null
    or campo_revision in ('pendiente', 'leida', 'registrada', 'descartada', 'ilegible')
  );

comment on column public.evidencias.campo_revision is
  'Estado de la captura de campo: pendiente | leida (ya pasó por la IA) | '
  'registrada | descartada | ilegible (la foto no se puede leer: el portal de '
  'campo la muestra en rojo para que la saquen de nuevo).';
