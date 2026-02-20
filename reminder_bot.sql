-- =========================================================
--  FILE: reminder_bot.sql
--  DESCRIZIONE: Database e tabelle per Reminder Discord Bot
-- =========================================================

-- Crea il database (se non esiste) con charset UTF8MB4
CREATE DATABASE IF NOT EXISTS `reminder_bot`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `reminder_bot`;

-- =======================
--  TABELLA: reminders
-- =======================

DROP TABLE IF EXISTS `reminders`;

CREATE TABLE `reminders` (
  `id`         BIGINT      NOT NULL,              -- userai Date.now() dal bot
  `guild_id`   VARCHAR(32) NOT NULL,              -- ID server Discord
  `channel_id` VARCHAR(32) NOT NULL,              -- ID canale Discord
  `time_hhmm`  CHAR(5)     NOT NULL,              -- formato 'HH:MM'
  `repeat_type` VARCHAR(32) NOT NULL DEFAULT 'everyday',
  `max_times`   INT        NOT NULL,              -- -1 = infinito
  `sent_count`  INT        NOT NULL DEFAULT 0,
  `message`     TEXT       NOT NULL,
  `timezone`    VARCHAR(64) NOT NULL DEFAULT 'UTC',
  `days`        VARCHAR(32) NOT NULL DEFAULT '',  -- es. '1,3' (lun e mer) oppure vuoto
  PRIMARY KEY (`id`)
) ENGINE=InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- Indici utili per query per server/canale
CREATE INDEX `idx_reminders_guild` ON `reminders` (`guild_id`);
CREATE INDEX `idx_reminders_channel` ON `reminders` (`channel_id`);

-- ============================
--  TABELLA: guild_timezones
-- ============================

DROP TABLE IF EXISTS `guild_timezones`;

CREATE TABLE `guild_timezones` (
  `guild_id` VARCHAR(32) NOT NULL,
  `timezone` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`guild_id`)
) ENGINE=InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- Fine file
