-- Backup of public.handle_new_user taken 2026-09-14 before any migration,
-- from pg_get_functiondef on project gdakokshfjqljddlrkrh. Rollback = run this.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;
