import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { env } from '../../config/env'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { audit } from '../audit.service'

// Database backups with pg_dump (custom format → restore with pg_restore, see scripts/restore.ts).
// One automatic backup per day (backup.schedule.ts), "Back up now" any time, optional copy to a 2nd folder
// (pen drive / OneDrive) together with the photos folder.

const run = promisify(execFile)
const backendRoot = path.resolve(__dirname, '../../..') // works from src/ (tsx) and dist/ (node)
export const backupDir = () => path.resolve(backendRoot, env.backup.dir)
const uploadsDir = () => path.resolve(backendRoot, 'uploads')
export const NAME = /^sairandhri-(\d{4}-\d{2}-\d{2})_(\d{4})-(auto|manual|before-reset|before-restore)\.dump$/
export type BackupKind = 'auto' | 'manual' | 'before-reset' | 'before-restore'

// pg_dump / pg_restore: PG_BIN, else the newest C:\Program Files\PostgreSQL\<n>\bin, else PATH.
export function pgTool(name: 'pg_dump' | 'pg_restore') {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  if (env.backup.pgBin) return path.join(env.backup.pgBin, exe)
  const base = 'C:\\Program Files\\PostgreSQL'
  if (process.platform === 'win32' && fs.existsSync(base)) {
    const versions = fs.readdirSync(base).filter((v) => /^\d+/.test(v)).sort((a, b) => parseFloat(b) - parseFloat(a))
    for (const v of versions) {
      const p = path.join(base, v, 'bin', exe)
      if (fs.existsSync(p)) return p
    }
  }
  return exe
}

export const pgArgs = () => ['-h', env.db.host, '-p', String(env.db.port), '-U', env.db.user, '-d', env.db.name]
export const pgEnv = () => ({ ...process.env, PGPASSWORD: env.db.password })

// IST time stamp for file names: 2026-10-08_1930
function stamp() {
  const ist = new Date(Date.now() + 5.5 * 3600_000).toISOString()
  return `${ist.slice(0, 10)}_${ist.slice(11, 13)}${ist.slice(14, 16)}`
}

let running: Promise<{ name: string }> | null = null
let lastError: { at: string; message: string } | null = null
let lastCopyError: string | null = null

async function copyToSecondPlace(file: string) {
  const dest = env.backup.copyDir
  if (!dest) return
  try {
    await fs.promises.mkdir(dest, { recursive: true })
    await fs.promises.copyFile(file, path.join(dest, path.basename(file)))
    // Photos: copy new files only (existing ones are never overwritten).
    if (fs.existsSync(uploadsDir())) await fs.promises.cp(uploadsDir(), path.join(dest, 'uploads'), { recursive: true, force: false, errorOnExist: false })
    lastCopyError = null
  } catch (err) {
    // Plain words for the owner; the technical reason goes to the server window.
    console.error(`[backup] copy to ${dest} failed: ${(err as Error).message}`)
    lastCopyError = `Backup saved on this PC, but it could not be copied to ${dest} — is the pen drive plugged in / the folder available?`
  }
}

// Keep the newest N automatic backups; manual / safety backups are never removed automatically.
async function prune() {
  const autos = (await fs.promises.readdir(backupDir())).filter((f) => NAME.exec(f)?.[3] === 'auto').sort().reverse()
  for (const f of autos.slice(Math.max(1, env.backup.keep))) await fs.promises.rm(path.join(backupDir(), f), { force: true })
}

async function doBackup(kind: BackupKind, user: string) {
  await fs.promises.mkdir(backupDir(), { recursive: true })
  const name = `sairandhri-${stamp()}-${kind}.dump`
  const file = path.join(backupDir(), name)
  try {
    await run(pgTool('pg_dump'), [...pgArgs(), '-F', 'c', '-Z', '6', '-f', file], { env: pgEnv(), timeout: 15 * 60_000, windowsHide: true })
    const size = (await fs.promises.stat(file)).size
    const head = Buffer.alloc(5)
    const fd = await fs.promises.open(file, 'r')
    await fd.read(head, 0, 5, 0).finally(() => fd.close())
    if (head.toString() !== 'PGDMP') throw new Error('backup file is not a valid pg_dump file')
    lastError = null
    await copyToSecondPlace(file)
    await prune()
    // Logging must never cost a good backup (e.g. restoring into an empty database has no log table yet).
    await audit(prisma, { actor: user, action: 'backup.create', entity: 'backup', entityId: name, summary: `Backup ${name} (${(size / 1048576).toFixed(1)} MB)` }).catch(() => undefined)
    return { name }
  } catch (err) {
    await fs.promises.rm(file, { force: true })
    const message = (err as { stderr?: string }).stderr?.trim() || (err as Error).message
    lastError = { at: new Date().toISOString(), message: message.slice(0, 300) }
    console.error(`[backup] failed: ${lastError.message}`)
    throw ApiError.badRequest(`Backup failed: ${lastError.message}`)
  }
}

// Only one backup at a time; a second request waits for the running one.
export function createBackup(kind: BackupKind, user: string) {
  if (!running) running = doBackup(kind, user).finally(() => { running = null })
  return running
}

export async function listBackups() {
  await fs.promises.mkdir(backupDir(), { recursive: true })
  const files = (await fs.promises.readdir(backupDir())).filter((f) => NAME.test(f)).sort().reverse()
  const items = await Promise.all(files.map(async (f) => {
    const m = NAME.exec(f)!
    const st = await fs.promises.stat(path.join(backupDir(), f))
    return { name: f, kind: m[3] as BackupKind, day: m[1], createdAt: st.mtime, size: st.size }
  }))
  return {
    items,
    folder: backupDir(),
    copyFolder: env.backup.copyDir,
    keep: env.backup.keep,
    running: !!running,
    lastError,
    lastCopyError,
  }
}

// Path of a backup file for download — only names made by this service (no path tricks).
export function backupFile(name: string) {
  if (!NAME.test(name)) throw ApiError.badRequest('Unknown backup file')
  const file = path.join(backupDir(), name)
  if (!fs.existsSync(file)) throw ApiError.notFound('Backup file not found')
  return file
}

export async function hasBackupForDay(day: string) {
  if (!fs.existsSync(backupDir())) return false
  return (await fs.promises.readdir(backupDir())).some((f) => NAME.exec(f)?.[1] === day)
}
