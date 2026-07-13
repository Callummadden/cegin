#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
//
// Migration runner — tracks applied migrations in schema_migrations table.
// Usage:
//   node migrations/migrate.js              — apply all pending migrations
//   node migrations/migrate.js --dry-run    — show what would run, don't apply
//   node migrations/migrate.js --status     — show applied vs pending

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'recipes.db');
const migrationsDir = __dirname;

// ── Helpers ──────────────────────────────────────────────────────────────

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version   TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

function getAppliedVersions(db) {
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  return new Set(rows.map(r => r.version));
}

function discoverMigrationFiles() {
  return fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort() // filenames are sortable: 001_xxx.sql, 002_xxx.sql, …
    .map(f => ({
      version: f.split('_')[0],          // "001"
      name: f.replace(/\.sql$/, ''),     // "001_baseline"
      file: f,
      path: path.join(migrationsDir, f),
    }));
}

// ── Main ─────────────────────────────────────────────────────────────────

function run(dryRun = false, statusOnly = false) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  ensureMigrationsTable(db);

  const applied = getAppliedVersions(db);
  const files = discoverMigrationFiles();
  const pending = files.filter(f => !applied.has(f.version));

  if (statusOnly) {
    console.log('── Migration Status ──');
    console.log(`Database : ${dbPath}`);
    console.log(`Applied  : ${applied.size}`);
    console.log(`Pending  : ${pending.length}\n`);

    for (const f of files) {
      const mark = applied.has(f.version) ? '✓' : '○';
      console.log(`  ${mark}  ${f.name}`);
    }
    if (pending.length === 0) console.log('\nAll migrations applied.');
    db.close();
    return;
  }

  if (pending.length === 0) {
    console.log('No pending migrations.');
    db.close();
    return;
  }

  for (const migration of pending) {
    const sql = fs.readFileSync(migration.path, 'utf-8');
    if (dryRun) {
      console.log(`[dry-run] Would apply: ${migration.name}`);
      continue;
    }

    console.log(`Applying: ${migration.name} …`);
    const txn = db.transaction(() => {
      // Split on semicolons that end a statement (ignoring those inside strings).
      // For simplicity we execute the whole file as one exec — better-sqlite3 supports multi-statement exec.
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name,
      );
    });

    try {
      txn();
      console.log(`  ✓ ${migration.name}`);
    } catch (err) {
      console.error(`  ✗ ${migration.name}: ${err.message}`);
      db.close();
      process.exit(1);
    }
  }

  if (!dryRun) {
    console.log(`\n${pending.length} migration(s) applied successfully.`);
  }
  db.close();
}

// ── CLI ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node migrations/migrate.js [options]
Options:
  --dry-run   Show pending migrations without applying them
  --status    Show applied vs pending migration status
  --help      Show this help message`);
  process.exit(0);
}

run(args.includes('--dry-run'), args.includes('--status'));
