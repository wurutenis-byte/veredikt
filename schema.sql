-- ════════════════════════════════════════════════════════════
--  VEREDIKT — Schema completo para Supabase
--  Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════

-- ─── EXTENSIONES ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── TABLA: categories ─────────────────────────────────────────
create table categories (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  icon        text,
  "order"     integer default 0,
  created_at  timestamptz default now()
);

-- ─── TABLA: topics ──────────────────────────────────────────────
create table topics (
  id              uuid primary key default uuid_generate_v4(),
  title           text not null,
  description     text,
  category_id     uuid references categories(id) on delete set null,
  subtopic        text,
  author_id       uuid references auth.users(id) on delete set null,
  status          text not null default 'pending' check (status in ('pending','published','rejected')),
  votes_up        integer default 0,
  votes_down      integer default 0,
  votes_total     integer default 0,
  rating_avg      numeric(3,1) default 0,
  rating_count    integer default 0,
  comments_count  integer default 0,
  created_at      timestamptz default now()
);

create index idx_topics_status   on topics(status);
create index idx_topics_category on topics(category_id);
create index idx_topics_search   on topics using gin (to_tsvector('spanish', title || ' ' || coalesce(subtopic,'')));

-- ─── TABLA: votes ───────────────────────────────────────────────
create table votes (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  topic_id    uuid references topics(id) on delete cascade not null,
  value       text not null check (value in ('up','down')),
  created_at  timestamptz default now(),
  unique(user_id, topic_id)
);

-- ─── TABLA: ratings ─────────────────────────────────────────────
create table ratings (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  topic_id    uuid references topics(id) on delete cascade not null,
  value       integer not null check (value between 1 and 10),
  created_at  timestamptz default now(),
  unique(user_id, topic_id)
);

-- ─── TABLA: comments ────────────────────────────────────────────
create table comments (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  topic_id    uuid references topics(id) on delete cascade not null,
  text        text not null check (char_length(text) <= 500),
  created_at  timestamptz default now(),
  unique(user_id, topic_id)
);

-- ─── TABLA: profiles (datos públicos de usuario) ────────────────
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  is_admin    boolean default false,
  created_at  timestamptz default now()
);

-- ════════════════════════════════════════════════════════════
--  TRIGGERS — recálculo automático
-- ════════════════════════════════════════════════════════════

-- Recalcular votos
create or replace function recalc_votes() returns trigger as $$
begin
  update topics set
    votes_up    = (select count(*) from votes where topic_id = coalesce(new.topic_id, old.topic_id) and value = 'up'),
    votes_down  = (select count(*) from votes where topic_id = coalesce(new.topic_id, old.topic_id) and value = 'down'),
    votes_total = (select count(*) from votes where topic_id = coalesce(new.topic_id, old.topic_id))
  where id = coalesce(new.topic_id, old.topic_id);
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger trg_recalc_votes
after insert or update or delete on votes
for each row execute function recalc_votes();

-- Recalcular ratings
create or replace function recalc_ratings() returns trigger as $$
begin
  update topics set
    rating_avg   = (select coalesce(round(avg(value), 1), 0) from ratings where topic_id = coalesce(new.topic_id, old.topic_id)),
    rating_count = (select count(*) from ratings where topic_id = coalesce(new.topic_id, old.topic_id))
  where id = coalesce(new.topic_id, old.topic_id);
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger trg_recalc_ratings
after insert or update or delete on ratings
for each row execute function recalc_ratings();

-- Recalcular comentarios
create or replace function recalc_comments() returns trigger as $$
begin
  update topics set
    comments_count = (select count(*) from comments where topic_id = coalesce(new.topic_id, old.topic_id))
  where id = coalesce(new.topic_id, old.topic_id);
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger trg_recalc_comments
after insert or delete on comments
for each row execute function recalc_comments();

-- Crear perfil automáticamente al registrarse
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_handle_new_user
after insert on auth.users
for each row execute function handle_new_user();

-- ════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY (RLS)
-- ════════════════════════════════════════════════════════════

alter table categories enable row level security;
alter table topics      enable row level security;
alter table votes       enable row level security;
alter table ratings     enable row level security;
alter table comments    enable row level security;
alter table profiles    enable row level security;

-- categories: lectura pública
create policy "categories_select_all" on categories for select using (true);

-- topics: lectura pública solo published, o tus propios temas (cualquier estado)
create policy "topics_select_published" on topics for select
  using (status = 'published' or author_id = auth.uid());

create policy "topics_insert_auth" on topics for insert
  with check (auth.uid() is not null and author_id = auth.uid() and status = 'pending');

-- topics: solo admins pueden actualizar status (aprobar/rechazar)
create policy "topics_update_admin" on topics for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

-- votes: cada usuario ve y gestiona solo lo suyo, pero puede leer todo (para contar)
create policy "votes_select_all" on votes for select using (true);
create policy "votes_insert_own" on votes for insert with check (auth.uid() = user_id);
create policy "votes_update_own" on votes for update using (auth.uid() = user_id);
create policy "votes_delete_own" on votes for delete using (auth.uid() = user_id);

-- ratings: igual que votes
create policy "ratings_select_all" on ratings for select using (true);
create policy "ratings_insert_own" on ratings for insert with check (auth.uid() = user_id);
create policy "ratings_update_own" on ratings for update using (auth.uid() = user_id);
create policy "ratings_delete_own" on ratings for delete using (auth.uid() = user_id);

-- comments: lectura pública, solo el autor inserta/edita lo suyo
create policy "comments_select_all" on comments for select using (true);
create policy "comments_insert_own" on comments for insert with check (auth.uid() = user_id);
create policy "comments_delete_own" on comments for delete using (auth.uid() = user_id);

-- profiles: lectura pública (para mostrar nombres en comentarios), solo el propio usuario edita
create policy "profiles_select_all" on profiles for select using (true);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

-- ════════════════════════════════════════════════════════════
--  DATOS INICIALES — Categorías
-- ════════════════════════════════════════════════════════════

insert into categories (name, icon, "order") values
('Política',         '🏛️', 1),
('Sociedad',          '👥', 2),
('Cultura',           '🎭', 3),
('Cine y series',     '🎬', 4),
('Música',            '🎵', 5),
('Deporte',           '⚽', 6),
('Tecnología',        '💻', 7),
('Gastronomía',       '🍽️', 8),
('Ciencia',           '🔬', 9),
('Historia',          '📜', 10),
('Economía',          '📈', 11),
('Naturaleza',        '🌿', 12),
('Videojuegos',       '🎮', 13),
('Viajes',            '✈️', 14),
('Moda y estilo',     '👗', 15),
('Educación',         '📚', 16),
('Salud',             '🏥', 17),
('Arte',              '🎨', 18),
('Filosofía',         '🤔', 19),
('España',            '🇪🇸', 20),
('Curiosidades',      '🤓', 21),
('Debates clásicos',  '⚔️', 22);

-- ════════════════════════════════════════════════════════════
--  DATOS INICIALES — Temas de ejemplo (sin autor, ya publicados)
-- ════════════════════════════════════════════════════════════

insert into topics (title, description, category_id, subtopic, status, votes_up, votes_down, rating_avg, rating_count, comments_count)
select
  t.title, t.description,
  (select id from categories where name = t.cat_name),
  t.subtopic, 'published', t.up, t.down, t.rating, t.rcount, t.ccount
from (values
  ('La tortilla de patatas ¿con o sin cebolla?', 'El debate más antiguo y encendido de la gastronomía española. Cada familia tiene su bando.', 'Gastronomía', 'Debates clásicos · España', 142, 38, 8.2, 67, 14),
  ('Semana de trabajo de 4 días', '¿Debería implantarse la semana laboral de 4 días como estándar en España?', 'Sociedad', 'Trabajo y economía', 203, 45, 7.8, 89, 22),
  ('Breaking Bad vs The Wire', '¿Cuál es la mejor serie de televisión de todos los tiempos?', 'Cine y series', 'Drama · Series de culto', 178, 62, 8.9, 95, 18),
  ('La Inteligencia Artificial como herramienta educativa', '¿El uso de IA en el aula es positivo para el aprendizaje de los estudiantes?', 'Tecnología', 'Educación · IA', 156, 71, 7.1, 73, 25),
  ('Real Madrid vs FC Barcelona: ¿quién ha sido más grande históricamente?', 'No el mejor ahora mismo, sino en el conjunto de su historia.', 'Deporte', 'Fútbol · LaLiga', 234, 198, 6.5, 112, 41),
  ('El cambio climático, ¿la mayor amenaza del siglo XXI?', 'En términos de impacto global a largo plazo, ¿supera al resto de problemas actuales?', 'Ciencia', 'Medioambiente · Política global', 189, 34, 8.4, 78, 19),
  ('Vivir en ciudad grande vs pueblo pequeño', '¿Qué modo de vida es preferible en términos de calidad y bienestar?', 'Sociedad', 'Estilo de vida', 121, 58, 7.3, 64, 16),
  ('Beethoven vs Mozart: ¿quién fue el mayor genio de la música clásica?', 'El duelo eterno entre los dos compositores más influyentes de la historia.', 'Música', 'Música clásica', 98, 27, 8.7, 52, 11)
) as t(title, description, cat_name, subtopic, up, down, rating, rcount, ccount);
