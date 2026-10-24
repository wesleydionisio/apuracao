-- Esquema mínimo (spec §5.3). Idempotente: roda em todo start do poller e da API.
create table if not exists candidates (
  id text primary key,
  name text not null,
  short text not null,
  color text not null
);

create table if not exists snapshots (
  id bigserial primary key,
  scope text not null,          -- 'br' | 'uf' | 'mun'
  scope_code text not null,     -- 'br' | 'SP' | IBGE
  captured_at timestamptz not null,
  pct_counted numeric(6,3) not null,
  votes_a bigint not null,
  votes_b bigint not null,
  blank bigint not null default 0,
  nulls bigint not null default 0,
  abst bigint not null default 0,
  raw jsonb
);
create index if not exists snapshots_scope_idx on snapshots (scope, scope_code, captured_at desc);

create table if not exists history (
  scope text not null,
  scope_code text not null,
  round smallint not null,
  year smallint not null,
  votes_by_cand jsonb not null,
  electorate bigint,
  turnout bigint,
  primary key (scope, scope_code, round, year)
);

create table if not exists municipalities (
  ibge_code text primary key,
  tse_code text not null,
  name text not null,
  uf text not null,
  electorate bigint,
  lat double precision,
  lng double precision
);

create table if not exists guesses (
  id text primary key,
  nick text not null,
  anon_id text not null unique,
  pct_a numeric(5,2) not null,
  uf text,
  uf_pct_a numeric(5,2),
  mun_ibge text,
  mun_pct_a numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_hash text
);
create index if not exists guesses_mun_idx on guesses (mun_ibge);
-- sync incremental da API a cada 15 s (where updated_at >= $1)
create index if not exists guesses_updated_idx on guesses (updated_at);

create table if not exists moments (
  id text primary key,
  kind text not null,
  scope text not null,
  scope_code text not null,
  title text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id text primary key,
  room text not null,
  nick text not null,
  anon_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- contas do chat (login com o Google). Nome e celular nunca saem da API; no chat só aparece o username.
create table if not exists accounts (
  id text primary key,
  google_sub text not null unique,
  email text not null,
  name text not null,
  phone text not null,
  username text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists accounts_username_idx on accounts (lower(username));

-- Super Chats (Pix). O registro inteiro em jsonb: volume baixo, lido todo na memória ao subir a API.
create table if not exists superchats (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
