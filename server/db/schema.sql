-- King Card Game Database Schema
-- Run this once to initialize the database, e.g.:
--   mysql -u root -p < db/schema.sql

-- Almost every literal in this file is Georgian. Some mysql clients default
-- to a latin1 connection charset, which silently re-encodes those UTF-8
-- bytes and lands mojibake in utf8mb4 columns. Pin the connection charset so
-- the import is correct no matter how the client is configured.
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS king_card_game
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE king_card_game;

-- ─── profiles ────────────────────────────────────────────────────────────────
-- One row per saved player profile (created from the lobby).
CREATE TABLE IF NOT EXISTS profiles (
  id            VARCHAR(64)   NOT NULL PRIMARY KEY,
  name          VARCHAR(64)   NOT NULL,
  avatar        MEDIUMTEXT    NULL,           -- base64 data URL of a thumbnail
  device_key    VARCHAR(128)  NULL,           -- ownership token (the browser that created it)
  pin_hash      VARCHAR(128)  NULL,           -- sha256(pin + id) — never returned to clients
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_profiles_name (name)
) ENGINE=InnoDB;

-- One-shot migration for existing deployments. We can't use
-- `ADD COLUMN IF NOT EXISTS` (only supported on MariaDB 10.0.2+ / MySQL 8.0.29+),
-- so we wrap it in a stored procedure that checks information_schema first.
-- That way re-running `schema.sql` against any database — fresh or already-
-- migrated — is a no-op instead of a 1060 "duplicate column" error.
DROP PROCEDURE IF EXISTS _king_add_pin_hash;
DELIMITER //
CREATE PROCEDURE _king_add_pin_hash()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'profiles'
       AND COLUMN_NAME  = 'pin_hash'
  ) THEN
    ALTER TABLE profiles
      ADD COLUMN pin_hash VARCHAR(128) NULL AFTER device_key;
  END IF;
END //
DELIMITER ;
CALL _king_add_pin_hash();
DROP PROCEDURE _king_add_pin_hash;

-- ─── finished_games ──────────────────────────────────────────────────────────
-- One row per finished game. The full per-round detail is kept as JSON so the
-- leaderboard view can render the tally trail and round breakdown without
-- joining a half-dozen tables.
CREATE TABLE IF NOT EXISTS finished_games (
  id             VARCHAR(64)   NOT NULL PRIMARY KEY,
  played_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  winner_name    VARCHAR(64)   NOT NULL,
  winner_seat    TINYINT       NOT NULL,
  winner_score   INT           NOT NULL,
  payload        MEDIUMTEXT    NOT NULL,      -- {players: [...], roundDetails: [...]}
  UNIQUE KEY uq_winner_played (winner_name, winner_score, played_at),
  INDEX idx_finished_played_at (played_at)
) ENGINE=InnoDB;

-- Championship flag. Games played in a "championship" room count toward the
-- daily per-player championship quota and are the only games exposed by the
-- public API by default (the score app's seasons are built from them).
-- Existing rows default to 1 — every game recorded before the flag existed
-- was counted by the score app, so they stay "championship" for continuity.
DROP PROCEDURE IF EXISTS _king_add_is_championship;
DELIMITER //
CREATE PROCEDURE _king_add_is_championship()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'finished_games'
       AND COLUMN_NAME  = 'is_championship'
  ) THEN
    ALTER TABLE finished_games
      ADD COLUMN is_championship TINYINT(1) NOT NULL DEFAULT 1 AFTER winner_score,
      ADD INDEX idx_finished_championship (is_championship, played_at);
  END IF;
END //
DELIMITER ;
CALL _king_add_is_championship();
DROP PROCEDURE _king_add_is_championship;

-- ─── durak_live_games ───────────────────────────────────────────────────────
-- Snapshot of every in-flight ჩეხური დურაკა room, same crash/rejoin recovery
-- story as live_games below: updated after every state-changing action,
-- removed when the room dies.
CREATE TABLE IF NOT EXISTS durak_live_games (
  room_code   VARCHAR(8)    NOT NULL PRIMARY KEY,
  state_json  MEDIUMTEXT    NOT NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_durak_live_updated (updated_at)
) ENGINE=InnoDB;

-- ─── live_games ─────────────────────────────────────────────────────────────
-- Snapshot of every in-flight room. Updated after every state-changing
-- action (join, play, discard, next round, etc.) so a server restart or a
-- player re-joining with the same room code can resume mid-game.
-- Row is removed when the game ends (a finished_games row takes over) or
-- when the last player leaves the room.
CREATE TABLE IF NOT EXISTS live_games (
  room_code   VARCHAR(6)    NOT NULL PRIMARY KEY,
  state_json  MEDIUMTEXT    NOT NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_live_updated (updated_at)
) ENGINE=InnoDB;

-- ─── sounds ─────────────────────────────────────────────────────────────────
-- The reaction-clip catalogue behind the in-game sound buttons. Adding a clip
-- used to mean editing three source files and redeploying; now it's a row
-- here, written by the /admin page.
--
-- `source` splits the two storage strategies:
--   'builtin'  → the file ships with the front-end build, served from
--                /sounds/<id>.mp3. `audio_b64` is NULL.
--   'uploaded' → the bytes live in `audio_b64` and are served by
--                GET /api/sounds/:id/audio. Storing them in MySQL (rather
--                than writing into the deploy directory) keeps uploads
--                surviving a cPanel deploy, which rsyncs over public/.
CREATE TABLE IF NOT EXISTS sounds (
  id          VARCHAR(64)   NOT NULL PRIMARY KEY,   -- also the play-sound wire id
  label       VARCHAR(64)   NOT NULL,               -- name shown on the button
  glyph       VARCHAR(8)    NOT NULL DEFAULT '?',   -- single char on the canvas buttons
  color       VARCHAR(16)   NOT NULL DEFAULT '#8e6a1e',
  source      VARCHAR(16)   NOT NULL DEFAULT 'uploaded',
  mime        VARCHAR(64)   NULL,                   -- uploaded clips only
  audio_b64   MEDIUMTEXT    NULL,                   -- uploaded clips only (base64, no data: prefix)
  sort_order  INT           NOT NULL DEFAULT 0,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sounds_order (sort_order, id)
-- Charset pinned explicitly rather than inherited: a database created
-- outside this file (cPanel makes them latin1 by default) would otherwise
-- hand the table latin1 columns, and every Georgian label would bounce with
-- "#1366 Incorrect string value".
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the clips that predate this table, but ONLY on the very first run
-- (empty table). Re-running schema.sql is a routine migration step, and an
-- unconditional INSERT IGNORE would resurrect every built-in an admin had
-- deliberately deleted. Same stored-procedure guard style as the column
-- migrations above.
DROP PROCEDURE IF EXISTS _king_seed_sounds;
DELIMITER //
CREATE PROCEDURE _king_seed_sounds()
BEGIN
  IF (SELECT COUNT(*) FROM sounds) = 0 THEN
    INSERT INTO sounds (id, label, glyph, color, source, sort_order) VALUES
      ('yeehaw',      'ყიჟინა',       'ჰ', '#b98a2f', 'builtin',  10),
      ('gunshot',     'გასროლა',      '!', '#a5372b', 'builtin',  20),
      ('whistle',     'სტვენა',       '~', '#4c7a2f', 'builtin',  30),
      ('giv',         'გივ',          'გ', '#31536b', 'builtin',  40),
      ('janmrteloba', 'ჯანმრთელობა',  'ჯ', '#6b3fa0', 'builtin',  50),
      ('sheilage',    'შეილაგე',      'შ', '#5b3d99', 'builtin',  60),
      ('shemetxara',  'შემეთხარა',    'ხ', '#a83a68', 'builtin',  70),
      ('tsava',       'ცავა',         'ც', '#8e6a1e', 'builtin',  80),
      ('Dedofali',    'დედოფალი',     'დ', '#b0446e', 'builtin',  90),
      ('Male!',       'მალე!',        'მ', '#2f5d8a', 'builtin', 100),
      ('Revia',       'რევია',        'რ', '#2b7a55', 'builtin', 110),
      ('Tazik',       'თაზიკ',        'თ', '#9c7818', 'builtin', 120),
      ('10-10',       '10-10',        '1', '#b04a52', 'builtin', 130),
      ('achexet',     'აჩეხეთ',       'ა', '#9c5a24', 'builtin', 140),
      ('bedi',        'ბედი',         'ბ', '#a97b14', 'builtin', 150),
      ('cxado',       'ცხადო',        'ო', '#22758a', 'builtin', 160),
      ('ketika',      'კეტიკა',       'კ', '#5e7a1e', 'builtin', 170);
  END IF;
END //
DELIMITER ;
CALL _king_seed_sounds();
DROP PROCEDURE _king_seed_sounds;
