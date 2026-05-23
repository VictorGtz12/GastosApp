-- GastosApp - Supabase structured sync schema
-- Run once in Supabase SQL Editor.

create table if not exists public.gs_gastos (
  id text primary key,
  estado text not null default 'activo',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text,
  deleted_at timestamptz
);

create table if not exists public.gs_cuentas (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text,
  deleted_at timestamptz
);

create table if not exists public.gs_catalogos (
  id text primary key,
  tipo text not null,
  valor text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text,
  deleted_at timestamptz
);

create table if not exists public.gs_cuentas_ahorro (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text,
  deleted_at timestamptz
);

create table if not exists public.gs_movimientos_ahorro (
  id text primary key,
  cuenta_id text not null,
  mov_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text,
  deleted_at timestamptz
);

create table if not exists public.gs_recurrentes (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text,
  deleted_at timestamptz
);

create table if not exists public.gs_deudas (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text,
  deleted_at timestamptz
);

create table if not exists public.gs_app_settings (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text
);

create table if not exists public.gs_tasks (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text,
  deleted_at timestamptz
);

create table if not exists public.gs_task_projects (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text,
  deleted_at timestamptz
);

create index if not exists idx_gs_gastos_updated_at on public.gs_gastos(updated_at);
create index if not exists idx_gs_gastos_deleted_at on public.gs_gastos(deleted_at);
create index if not exists idx_gs_gastos_estado on public.gs_gastos(estado);
create index if not exists idx_gs_catalogos_tipo on public.gs_catalogos(tipo);
create index if not exists idx_gs_movimientos_ahorro_cuenta on public.gs_movimientos_ahorro(cuenta_id);
create index if not exists idx_gs_tasks_updated_at on public.gs_tasks(updated_at);
create index if not exists idx_gs_task_projects_updated_at on public.gs_task_projects(updated_at);

alter table public.gs_gastos enable row level security;
alter table public.gs_cuentas enable row level security;
alter table public.gs_catalogos enable row level security;
alter table public.gs_cuentas_ahorro enable row level security;
alter table public.gs_movimientos_ahorro enable row level security;
alter table public.gs_recurrentes enable row level security;
alter table public.gs_deudas enable row level security;
alter table public.gs_app_settings enable row level security;
alter table public.gs_tasks enable row level security;
alter table public.gs_task_projects enable row level security;

-- Personal-app policy: the current app already stores data through the public
-- REST key. These policies preserve that behavior for the new structured tables.
do $$
declare
  t text;
begin
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
    execute format('drop policy if exists "gastosapp anon all" on public.%I', t);
    execute format(
      'create policy "gastosapp anon all" on public.%I for all to anon using (true) with check (true)',
      t
    );
  end loop;
end $$;
