-- GastosApp - usuarios internos y bases/workspaces compartibles
-- 1) Crea o confirma el usuario Victor en Authentication.
-- 2) Reemplaza victor_email con el correo de Victor.
-- 3) Ejecuta este SQL una vez. Asigna todos los datos actuales a la base personal de Victor.

do $$
declare
  victor_email text := 'vedu.gutierrez@gmail.com';
  victor_auth_id uuid;
  victor_workspace_id uuid := gen_random_uuid();
  t text;
  constraint_name text;
begin
  select id into victor_auth_id
  from auth.users
  where lower(email) = lower(victor_email)
  limit 1;

  if victor_auth_id is null then
    raise exception 'No existe usuario Auth con email %. Crea primero el usuario Victor o cambia victor_email.', victor_email;
  end if;

  create table if not exists public.app_users (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    display_name text,
    role text not null default 'user',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.app_workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_by uuid not null references auth.users(id) on delete cascade,
    is_personal boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.app_workspace_members (
    workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null default 'viewer',
    created_at timestamptz not null default now(),
    primary key (workspace_id, user_id)
  );

  insert into public.app_users (id, email, display_name, role)
  values (victor_auth_id, victor_email, 'Victor', 'admin')
  on conflict (id) do update
    set email = excluded.email, display_name = excluded.display_name, role = 'admin', updated_at = now();

  select wm.workspace_id into victor_workspace_id
  from public.app_workspace_members wm
  join public.app_workspaces w on w.id = wm.workspace_id
  where wm.user_id = victor_auth_id and w.is_personal = true
  order by w.created_at asc
  limit 1;

  if victor_workspace_id is null then
    victor_workspace_id := gen_random_uuid();
    insert into public.app_workspaces (id, name, created_by, is_personal)
    values (victor_workspace_id, 'Base de Victor', victor_auth_id, true);
    insert into public.app_workspace_members (workspace_id, user_id, role)
    values (victor_workspace_id, victor_auth_id, 'admin');
  end if;

  execute $fn$
    create or replace function public.app_workspace_role(p_workspace_id uuid, p_user_id uuid default auth.uid())
    returns text
    language sql
    security definer
    set search_path = public
    as $$
      select role
      from public.app_workspace_members
      where workspace_id = p_workspace_id and user_id = p_user_id
      limit 1
    $$
  $fn$;

  foreach t in array array[
    'gs_gastos',
    'gs_cuentas',
    'gs_catalogos',
    'gs_cuentas_ahorro',
    'gs_movimientos_ahorro',
    'gs_recurrentes',
    'gs_deudas',
    'gs_app_settings',
    'gs_tasks',
    'gs_task_projects'
  ] loop
    execute format('alter table public.%I add column if not exists workspace_id uuid references public.app_workspaces(id) on delete cascade', t);
    execute format('update public.%I set workspace_id = $1 where workspace_id is null', t) using victor_workspace_id;
    execute format('alter table public.%I alter column workspace_id set not null', t);

    execute format('drop policy if exists "gastosapp anon all" on public.%I', t);
    execute format('drop policy if exists "gastosapp owner select" on public.%I', t);
    execute format('drop policy if exists "gastosapp owner insert" on public.%I', t);
    execute format('drop policy if exists "gastosapp owner update" on public.%I', t);
    execute format('drop policy if exists "gastosapp owner delete" on public.%I', t);
    execute format('drop policy if exists "gastosapp workspace select" on public.%I', t);
    execute format('drop policy if exists "gastosapp workspace insert" on public.%I', t);
    execute format('drop policy if exists "gastosapp workspace update" on public.%I', t);
    execute format('drop policy if exists "gastosapp workspace delete" on public.%I', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "gastosapp workspace select" on public.%I for select to authenticated using (public.app_workspace_role(workspace_id) is not null)', t);
    execute format('create policy "gastosapp workspace insert" on public.%I for insert to authenticated with check (public.app_workspace_role(workspace_id) in (''admin'', ''editor''))', t);
    execute format('create policy "gastosapp workspace update" on public.%I for update to authenticated using (public.app_workspace_role(workspace_id) in (''admin'', ''editor'')) with check (public.app_workspace_role(workspace_id) in (''admin'', ''editor''))', t);
    execute format('create policy "gastosapp workspace delete" on public.%I for delete to authenticated using (public.app_workspace_role(workspace_id) in (''admin'', ''editor''))', t);

    execute format('create index if not exists idx_%I_workspace_id on public.%I(workspace_id)', t, t);

    select conname into constraint_name
    from pg_constraint
    where conrelid = format('public.%I', t)::regclass and contype = 'p'
    limit 1;

    if constraint_name is not null then
      execute format('alter table public.%I drop constraint %I', t, constraint_name);
    end if;

    execute format('alter table public.%I add primary key (workspace_id, id)', t);
  end loop;
end $$;

create or replace function public.app_workspace_role(p_workspace_id uuid, p_user_id uuid default auth.uid())
returns text
language sql
security definer
set search_path = public
as $$
  select role
  from public.app_workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id
  limit 1
$$;

grant execute on function public.app_workspace_role(uuid, uuid) to authenticated;

alter table public.app_users enable row level security;
alter table public.app_workspaces enable row level security;
alter table public.app_workspace_members enable row level security;

drop policy if exists "app users self select" on public.app_users;
drop policy if exists "app users self insert" on public.app_users;
drop policy if exists "app users self update" on public.app_users;
drop policy if exists "workspaces member select" on public.app_workspaces;
drop policy if exists "workspaces self insert" on public.app_workspaces;
drop policy if exists "workspaces admin update" on public.app_workspaces;
drop policy if exists "members self select" on public.app_workspace_members;
drop policy if exists "members creator insert" on public.app_workspace_members;
drop policy if exists "members admin manage" on public.app_workspace_members;

create policy "app users self select" on public.app_users
  for select to authenticated using (id = auth.uid());

create policy "app users self insert" on public.app_users
  for insert to authenticated with check (id = auth.uid());

create policy "app users self update" on public.app_users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "workspaces member select" on public.app_workspaces
  for select to authenticated using (created_by = auth.uid() or public.app_workspace_role(id) is not null);

create policy "workspaces self insert" on public.app_workspaces
  for insert to authenticated with check (created_by = auth.uid());

create policy "workspaces admin update" on public.app_workspaces
  for update to authenticated using (public.app_workspace_role(id) = 'admin');

create policy "members self select" on public.app_workspace_members
  for select to authenticated using (
    user_id = auth.uid() or public.app_workspace_role(workspace_id) = 'admin'
  );

create policy "members creator insert" on public.app_workspace_members
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.app_workspaces w
      where w.id = workspace_id and w.created_by = auth.uid()
    )
  );

create policy "members admin manage" on public.app_workspace_members
  for all to authenticated using (public.app_workspace_role(workspace_id) = 'admin')
  with check (public.app_workspace_role(workspace_id) = 'admin');
