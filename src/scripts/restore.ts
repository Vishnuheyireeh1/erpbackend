import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { env } from '../config/env'
import { prisma } from '../config/prisma'
import { backupDir, createBackup, NAME, pgArgs, pgEnv, pgTool } from '../services/system/backup.service'

// Put a backup back:  npm run db:restore -- sairandhri-2026-10-08_1930-auto.dump --yes
// 1. STOP the ERP first (close the server window) so nobody bills during the restore.
// 2. A safety backup of the current data is made first ("before-restore"), so this can be undone.
// Everything entered after the chosen backup is replaced by the backup's data.

const run = promisify(execFile)

async function main() {
  const args = process.argv.slice(2)
  const name = args.find((a) => !a.startsWith('--'))
  if (!name || !NAME.test(path.basename(name))) {
    console.log('Usage: npm run db:restore -- <backup file name> --yes')
    console.log(`Backups are in ${backupDir()}`)
    process.exit(1)
  }
  const file = path.isAbsolute(name) ? name : path.join(backupDir(), name)
  if (!args.includes('--yes')) {
    console.log(`This replaces ALL data in database "${env.db.name}" with ${path.basename(file)}.`)
    console.log('Stop the ERP server first, then run again with --yes')
    process.exit(1)
  }
  console.log('1/2 Safety backup of the current data …')
  const safety = await createBackup('before-restore', 'restore-script')
  console.log(`    saved ${safety.name}`)
  console.log(`2/2 Restoring ${path.basename(file)} …`)
  await prisma.$disconnect()
  await run(pgTool('pg_restore'), [...pgArgs(), '--clean', '--if-exists', '--no-owner', '--single-transaction', file], { env: pgEnv(), timeout: 30 * 60_000, windowsHide: true, maxBuffer: 50 * 1024 * 1024 })
  console.log('Done. Start the ERP again. (To undo: restore the before-restore backup above.)')
}

main().catch((err) => {
  console.error('Restore failed:', (err as { stderr?: string }).stderr || (err as Error).message)
  console.error('Nothing was changed if the error came before step 2. The safety backup (if made) is in the backups folder.')
  process.exit(1)
})
