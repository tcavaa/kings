-- ─── profile_characters ─────────────────────────────────────────────────
-- How a profile looks at the 3D table: the base body (gender) and, if the
-- owner uploaded one, a head/face model (.glb, base64) that replaces the
-- default head. Kept apart from profiles so the profile mirror (which every
-- process caches in full) never carries model files.
create table if not exists public.profile_characters (
  profile_id  varchar(64)  primary key references public.profiles (id) on delete cascade,
  gender      varchar(8)   not null default 'male' check (gender in ('male', 'female')),
  head_glb    text,                          -- base64 GLB, ≤ 2 MB decoded
  head_v      varchar(16),                   -- left(md5(head_glb), 12), for cache-busting URLs
  updated_at  timestamptz  not null default now()
);

alter table public.profile_characters enable row level security;
revoke all on table public.profile_characters from anon, authenticated;
