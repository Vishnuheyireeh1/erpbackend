import app from './app'
import { prisma } from './config/prisma'
import { env } from './config/env'
import { startBackupSchedule } from './services/system/backup.schedule'

const server = app.listen(env.port, () => {
  console.log(`[api] Sairandhri ERP running on http://localhost:${env.port} (${env.nodeEnv})`)
})
startBackupSchedule()

// Close HTTP + DB connections cleanly on Ctrl+C / service stop.
function shutdown() {
  server.close(() => prisma.$disconnect().then(() => process.exit(0)))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
