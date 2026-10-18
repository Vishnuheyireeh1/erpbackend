import { todayIST } from '../../utils/financialYear'
import { createBackup, hasBackupForDay } from './backup.service'

// Automatic backup: a minute after the server starts, then every hour — if today has no backup yet, make one.
// (The shop PC may be switched on at any time of day, so "once a day at 2 AM" would often be missed.)
export function startBackupSchedule() {
  const check = async () => {
    try {
      if (!(await hasBackupForDay(todayIST()))) await createBackup('auto', 'system')
    } catch {
      // Error is kept by the backup service and shown on Settings → Backups.
    }
  }
  setTimeout(check, 60_000).unref()
  setInterval(check, 60 * 60_000).unref()
}
