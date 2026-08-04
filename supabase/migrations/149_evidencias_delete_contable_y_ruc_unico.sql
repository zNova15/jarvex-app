-- 149: (a) DELETE de evidencias para roles CONTABLES (no solo admin) → así el
-- cleanup de constancias (detracción/bancarización) al eliminar/corregir funciona
-- desde ayudante_contador/contador; antes solo admin y el borrado server fallaba en
-- silencio dejando constancias HUÉRFANAS en Storage.
-- (b) Índice UNIQUE parcial de RUC en companies: backstop server-side contra
-- empresas duplicadas (Captura Mágica creaba duplicados cuando el OCR no leía el RUC).
--
-- evidencias está publicada en Realtime → el ADD POLICY va con lock de
-- realtime.subscription (regla del handoff §4) para evitar deadlock.

lock table realtime.subscription in access exclusive mode;

drop policy if exists "evidencias: contable borra" on public.evidencias;
create policy "evidencias: contable borra" on public.evidencias
  for delete to authenticated
  using (has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text, 'gerente'::text, 'tesorero'::text]));

-- 0 RUC duplicados entre empresas activas (verificado) → seguro crear el único.
create unique index if not exists companies_ruc_uniq
  on public.companies (ruc)
  where deleted_at is null and ruc is not null and ruc <> '';

notify pgrst, 'reload schema';
