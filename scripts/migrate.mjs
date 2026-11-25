import nextEnv from '@next/env'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, join, basename } from 'node:path'
nextEnv.loadEnvConfig(process.cwd())
const configured = process.env.DATABASE_URL || 'file:./data/medicare.db'
if (!configured.startsWith('file:')) throw new Error('DATABASE_URL must be a SQLite file URL such as file:./data/medicare.db')
const file = join(process.cwd(), 'data', basename(configured.slice('file:'.length)))
mkdirSync(dirname(file), { recursive: true })
const db = new DatabaseSync(file)
try {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  const migrations = readdirSync(resolve('db/migrations')).filter(name => name.endsWith('.sql')).sort()
  for (const name of migrations) {
    if (db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name)) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(readFileSync(resolve('db/migrations', name), 'utf8'))
      db.prepare('INSERT INTO schema_migrations(name) VALUES(?)').run(name)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  console.info(`SQLite database ready: ${file}`)
} finally { db.close() }
