-- ============================================================
-- LOGBOOK — схема базы данных Supabase (Postgres)
-- Выполните этот файл в Supabase Studio → SQL Editor → New query
-- ============================================================

-- Профили пользователей (создаётся автоматически при первой регистрации по email)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text default 'mechanic',   -- 'mechanic' | 'senior' | 'admin'
  created_at timestamptz default now()
);

-- Автоматически создаёт запись в profiles при регистрации нового пользователя.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Суда / объекты (на будущее, если оборудование числится за несколькими судами)
create table if not exists vessels (
  id text primary key,            -- напр. 'MORINI7'
  name text not null,
  imo text,
  created_at timestamptz default now()
);

-- Оборудование (котёл, двигатель, генератор...)
create table if not exists equipment (
  id text primary key,            -- код с QR-этикетки, напр. '53817R1'
  vessel_id text references vessels(id),
  name text not null,
  category text,                  -- 'Котёл' / 'Двигатель' / 'Генератор' ...
  builder text,
  customer text,
  job text,
  capacity text,
  pressure text,
  fuel text,
  dis text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Документы: оригинальные мануалы и электросхемы (PDF), а также
-- исправления/доработки — тоже отдельными PDF поверх оригинала.
-- Таблица НАМЕРЕННО без update/delete-политик ниже — документы неизменяемы:
-- один раз загруженный файл нельзя перезаписать или удалить, только
-- добавить новый рядом (см. RLS-политики).
create table if not exists documents (
  id bigserial primary key,
  equipment_id text references equipment(id) on delete cascade,
  doc_type text not null check (doc_type in ('manual', 'schema')),
  title text not null,
  file_path text not null,        -- путь в Supabase Storage, бакет 'documents'
  file_url text not null,         -- публичная ссылка (или сформированная signed URL)
  uploaded_by uuid references auth.users(id),
  uploaded_by_name text,
  uploaded_at timestamptz default now()
);
create index if not exists idx_documents_equipment on documents(equipment_id, doc_type, uploaded_at desc);

-- Журнал обслуживания / ремонтов
create table if not exists journal_entries (
  id bigserial primary key,
  equipment_id text references equipment(id) on delete cascade,
  author_id uuid references auth.users(id),
  name text,                      -- имя, если без авторизации
  problem text,
  action text,
  photo_url text,                 -- ссылка на Supabase Storage
  created_at timestamptz default now()
);
create index if not exists idx_journal_equipment on journal_entries(equipment_id, created_at desc);

-- Диагностические процедуры (конструктор чек-листов из LOGBOOK)
create table if not exists procedures (
  id text primary key,            -- напр. 'mancanza-fiamma'
  equipment_id text references equipment(id) on delete cascade,
  name text not null,
  ok_conclusion text,
  ok_where text,
  steps jsonb not null default '[]'
);

-- ============================================================
-- ROW LEVEL SECURITY — критично! Без этого любой человек с anon-ключом
-- сможет читать/писать всё. Ниже — базовая политика: читать могут все
-- авторизованные пользователи, писать в журнал — тоже все авторизованные.
-- Настройте под свою структуру ролей (капитан / старший механик / матрос).
-- ============================================================
alter table profiles enable row level security;
alter table equipment enable row level security;
alter table documents enable row level security;
alter table journal_entries enable row level security;
alter table procedures enable row level security;

create policy "user reads own profile" on profiles for select using (auth.uid() = id);
create policy "user updates own profile" on profiles for update using (auth.uid() = id);

create policy "authenticated read equipment" on equipment for select using (auth.role() = 'authenticated');
create policy "authenticated write equipment" on equipment for insert with check (auth.role() = 'authenticated');
create policy "authenticated update equipment" on equipment for update using (auth.role() = 'authenticated');

-- Документы: читать и загружать может любой авторизованный механик,
-- update/delete НЕ разрешены никому (намеренно нет таких политик) —
-- это и есть механизм неизменяемости на уровне базы данных.
create policy "authenticated read documents" on documents for select using (auth.role() = 'authenticated');
create policy "authenticated upload documents" on documents for insert with check (auth.role() = 'authenticated');

create policy "authenticated read procedures" on procedures for select using (auth.role() = 'authenticated');

create policy "authenticated read journal" on journal_entries for select using (auth.role() = 'authenticated');
create policy "authenticated write journal" on journal_entries for insert with check (auth.role() = 'authenticated');

-- Мануалы и схемы теперь хранятся как PDF-документы (таблица documents) и
-- принципиально неизменяемы после загрузки — исправления добавляются как
-- новые документы, не как правки существующих записей. equipment (базовые
-- поля вроде name/category) при необходимости можно так же сузить до
-- ролей 'senior'/'admin' через profiles.role, если открытое редактирование
-- этих полей окажется проблемой.
