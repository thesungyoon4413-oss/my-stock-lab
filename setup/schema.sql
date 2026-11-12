begin;
-- MY STOCK LAB encrypted backup. Run as project administrator on the approved FREE project.
-- Only encrypted vault envelopes and metadata are stored. No plaintext financial data is accepted.
create table if not exists public.msl_backup_owners(user_id uuid primary key);
create table if not exists public.msl_backup_heads(
 user_id uuid primary key references public.msl_backup_owners(user_id),
 revision bigint not null default 0, writer_id uuid, digest text,
 updated_at timestamptz not null default clock_timestamp(),
 upload_times timestamptz[] not null default '{}'
);
create table if not exists public.msl_backup_snapshots(
 user_id uuid not null references public.msl_backup_owners(user_id),
 revision bigint not null, payload text not null check(octet_length(payload)<=10000000),
 digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 captured_at timestamptz not null default clock_timestamp(),
 primary key(user_id,revision)
);
alter table public.msl_backup_snapshots set(autovacuum_vacuum_scale_factor=0,autovacuum_vacuum_threshold=3);
alter table public.msl_backup_owners enable row level security;
alter table public.msl_backup_heads enable row level security;
alter table public.msl_backup_snapshots enable row level security;
do $policy$ begin if not exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='msl_backup_owners' and policyname='owner_only') then create policy owner_only on public.msl_backup_owners for select to authenticated using(user_id=(select auth.uid())); end if; end; $policy$;
do $policy$ begin if not exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='msl_backup_heads' and policyname='owner_only') then create policy owner_only on public.msl_backup_heads for select to authenticated using(user_id=(select auth.uid())); end if; end; $policy$;
do $policy$ begin if not exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='msl_backup_snapshots' and policyname='owner_only') then create policy owner_only on public.msl_backup_snapshots for select to authenticated using(user_id=(select auth.uid())); end if; end; $policy$;
revoke all on public.msl_backup_owners,public.msl_backup_heads,public.msl_backup_snapshots from public,anon,authenticated;

create or replace function public.msl_backup_actor() returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.msl_backup_owners where user_id=actor) then raise exception using errcode='42501',message='not_owner';end if;
 return actor;
end;$$;
create or replace function public.msl_backup_status() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.msl_backup_actor(); result jsonb;
begin
 select jsonb_build_object('revision',revision,'writer_id',writer_id,'digest',digest,'updated_at',updated_at) into result from public.msl_backup_heads where user_id=actor;
 if result is null then raise exception using errcode='P0001',message='setup_incomplete';end if;return result;
end;$$;
create or replace function public.msl_backup_claim(p_expected bigint,p_writer uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.msl_backup_actor(); h public.msl_backup_heads;
begin
 if p_expected is null or p_expected<0 then raise exception using errcode='P0001',message='invalid_revision';end if;
 select * into h from public.msl_backup_heads where user_id=actor for update;
 if h.user_id is null or p_writer is null then raise exception using errcode='P0001',message='setup_incomplete';end if;
 if h.revision<>p_expected then raise exception using errcode='40001',message='revision_conflict';end if;
 update public.msl_backup_heads set writer_id=p_writer,revision=revision+1,updated_at=clock_timestamp() where user_id=actor;
 return public.msl_backup_status();
end;$$;
create or replace function public.msl_backup_put(p_expected bigint,p_writer uuid,p_payload text,p_digest text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.msl_backup_actor(); h public.msl_backup_heads; e jsonb; times timestamptz[]; moment timestamptz:=clock_timestamp();
begin
 if p_expected is null or p_expected<0 then raise exception using errcode='P0001',message='invalid_revision';end if;
 select * into h from public.msl_backup_heads where user_id=actor for update;
 if h.user_id is null then raise exception using errcode='P0001',message='setup_incomplete';end if;
 if h.revision<>p_expected then raise exception using errcode='40001',message='revision_conflict';end if;
 if h.writer_id is distinct from p_writer or p_writer is null then raise exception using errcode='42501',message='writer_changed';end if;
 if p_payload is null or octet_length(p_payload)>10000000 or p_digest !~ '^[a-f0-9]{64}$' then raise exception using errcode='P0001',message='invalid_envelope';end if;
 if encode(sha256(convert_to(p_payload,'UTF8')),'hex') is distinct from p_digest then raise exception using errcode='P0001',message='digest_mismatch';end if;
 e:=p_payload::jsonb;
 if jsonb_typeof(e) is distinct from 'object' or e->>'format' is distinct from 'MY-STOCK-LAB-AES256' or e->'version' is distinct from '1'::jsonb or (select count(*) from jsonb_object_keys(e))<>5 or jsonb_typeof(e->'salt') is distinct from 'string' or jsonb_typeof(e->'iv') is distinct from 'string' or jsonb_typeof(e->'data') is distinct from 'string' or e->>'salt' !~ '^[A-Za-z0-9+/]{22}==$' or e->>'iv' !~ '^[A-Za-z0-9+/]{16}$' or length(e->>'data')<24 or e->>'data' !~ '^[A-Za-z0-9+/]+={0,2}$' then raise exception using errcode='P0001',message='invalid_envelope';end if;
 select coalesce(array_agg(t),'{}') into times from unnest(h.upload_times) t where t>moment-interval '24 hours';
 if cardinality(times)>=4 then raise exception using errcode='P0001',message='free_limit';end if;
 insert into public.msl_backup_snapshots(user_id,revision,payload,digest) values(actor,h.revision+1,p_payload,p_digest);
 delete from public.msl_backup_snapshots where user_id=actor and revision not in(select revision from public.msl_backup_snapshots where user_id=actor order by revision desc limit 3);
 update public.msl_backup_heads set revision=revision+1,digest=p_digest,upload_times=array_append(times,moment),updated_at=moment where user_id=actor;
 return public.msl_backup_status();
end;$$;
create or replace function public.msl_backup_get(p_revision bigint default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=public.msl_backup_actor(); result jsonb;
begin
 select jsonb_build_object('revision',revision,'digest',digest,'captured_at',captured_at,'payload',payload) into result from public.msl_backup_snapshots where user_id=actor and (p_revision is null or revision=p_revision) order by revision desc limit 1;
 return result;
end;$$;
revoke all on function public.msl_backup_actor(),public.msl_backup_status(),public.msl_backup_claim(bigint,uuid),public.msl_backup_put(bigint,uuid,text,text),public.msl_backup_get(bigint) from public,anon,authenticated;
grant execute on function public.msl_backup_status(),public.msl_backup_claim(bigint,uuid),public.msl_backup_put(bigint,uuid,text,text),public.msl_backup_get(bigint) to authenticated;


notify pgrst, 'reload schema';
commit;
select 'MSL_BACKUP_SCHEMA_READY' as status, (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('msl_backup_owners','msl_backup_heads','msl_backup_snapshots') and c.relrowsecurity) as protected_tables;
