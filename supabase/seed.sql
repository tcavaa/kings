-- Built-in reaction clips, for a FRESH database only (local dev, a new
-- project). Production got its catalogue — including every uploaded clip —
-- from the MySQL import (scripts/import-mysql-dump.mjs), so this is a no-op
-- there: like the MySQL seed it only runs while the table is empty, so a
-- clip an admin deletes from /admin never comes back.
insert into public.sounds (id, label, glyph, color, source, sort_order)
select v.id, v.label, v.glyph, v.color, 'builtin', v.sort_order
from (values
  ('yeehaw',      'ყიჟინა',       'ჰ', '#b98a2f',  10),
  ('gunshot',     'გასროლა',      '!', '#a5372b',  20),
  ('whistle',     'სტვენა',       '~', '#4c7a2f',  30),
  ('giv',         'გივ',          'გ', '#31536b',  40),
  ('janmrteloba', 'ჯანმრთელობა',  'ჯ', '#6b3fa0',  50),
  ('sheilage',    'შეილაგე',      'შ', '#5b3d99',  60),
  ('shemetxara',  'შემეთხარა',    'ხ', '#a83a68',  70),
  ('tsava',       'ცავა',         'ც', '#8e6a1e',  80),
  ('Dedofali',    'დედოფალი',     'დ', '#b0446e',  90),
  ('Male!',       'მალე!',        'მ', '#2f5d8a', 100),
  ('Revia',       'რევია',        'რ', '#2b7a55', 110),
  ('Tazik',       'თაზიკ',        'თ', '#9c7818', 120),
  ('10-10',       '10-10',        '1', '#b04a52', 130),
  ('achexet',     'აჩეხეთ',       'ა', '#9c5a24', 140),
  ('bedi',        'ბედი',         'ბ', '#a97b14', 150),
  ('cxado',       'ცხადო',        'ო', '#22758a', 160),
  ('ketika',      'კეტიკა',       'კ', '#5e7a1e', 170)
) as v(id, label, glyph, color, sort_order)
where not exists (select 1 from public.sounds);
