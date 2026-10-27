-- Les comptes anonymes (collaborateurs qui rejoignent par lien d'invitation, sans e-mail ni mot
-- de passe) n'ont ni `raw_user_meta_data.name` ni `email` : sans ce correctif, `split_part(null,
-- '@', 1)` renvoie null et l'insertion dans profiles.name (not null) échoue, ce qui bloque la
-- connexion anonyme elle-même.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1), 'Invité'));
  return new;
end;
$$;
