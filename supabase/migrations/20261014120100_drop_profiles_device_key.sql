-- ─────────────────────────────────────────────────────────────────────────────
-- profiles.device_key was the MySQL build's "which browser made this profile"
-- token. Nothing writes or reads it any more (profiles are protected by their
-- PIN and session tokens), so it goes, and the touch trigger stops watching it.
-- ─────────────────────────────────────────────────────────────────────────────

drop trigger if exists profiles_touch_updated_at on public.profiles;

alter table public.profiles drop column if exists device_key;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row
  when (
    (old.id, old.name, old.avatar, old.pin_hash, old.created_at)
      is distinct from
    (new.id, new.name, new.avatar, new.pin_hash, new.created_at)
    and old.updated_at is not distinct from new.updated_at
  )
  execute function public.king_touch_updated_at();
