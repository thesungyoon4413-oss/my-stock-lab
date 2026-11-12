-- Run only after creating exactly ONE email/password user in this project's
-- Authentication > Users screen and confirming that user's email there.
-- Existing ownership, snapshots, encryption keys and payloads are preserved.
begin;
do $owner$
declare candidate uuid; users_count bigint; confirmed timestamptz;
begin
 select count(*) into users_count from auth.users;
 if users_count<>1 then
  raise exception 'MSL_SETUP_NEEDS_EXACTLY_ONE_AUTH_USER';
 end if;
 select id,email_confirmed_at into candidate,confirmed from auth.users limit 1;
 if confirmed is null then
  raise exception 'MSL_SETUP_NEEDS_CONFIRMED_EMAIL';
 end if;
 if exists(select 1 from public.msl_backup_owners where user_id<>candidate) then
  raise exception 'MSL_SETUP_ALREADY_HAS_ANOTHER_OWNER';
 end if;
 insert into public.msl_backup_owners(user_id) values(candidate) on conflict do nothing;
 insert into public.msl_backup_heads(user_id) values(candidate) on conflict do nothing;
end;
$owner$;
notify pgrst, 'reload schema';
commit;
select 'MSL_BACKUP_OWNER_READY' as status;
