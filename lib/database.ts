import { mkdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const configured = process.env.DATABASE_URL || 'file:./data/medicare.db'
if (!configured.startsWith('file:')) throw new Error('DATABASE_URL must be a SQLite file URL such as file:./data/medicare.db')
const dbFile = join(process.cwd(), 'data', basename(configured.slice('file:'.length)))
mkdirSync(dirname(dbFile), { recursive: true })

const globalDb = globalThis as unknown as { medicareDb?: DatabaseSync }
export const db = globalDb.medicareDb ?? new DatabaseSync(dbFile)
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
if (process.env.NODE_ENV !== 'production') globalDb.medicareDb = db

export function logActivity(action: string, userId?: string | null, patientId?: string | null, details?: string | null) {
  db.prepare('INSERT INTO activity_logs(id,user_id,patient_id,action,details) VALUES(?,?,?,?,?)')
    .run(randomUUID(), userId ?? null, patientId ?? null, action, details ?? null)
}
