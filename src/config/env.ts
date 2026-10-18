import 'dotenv/config'

// Reads a required variable; fails fast at startup if it is missing.
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

const nodeEnv = process.env.NODE_ENV ?? 'development'

export const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: Number(process.env.PORT ?? 5050),
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5174',
  // Login cookie only over https. Keep false when the shop uses http://<pc-ip>:5050 on its own Wi-Fi.
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  // Serve the built screens (frontend/dist) from this server → one program, one address for the shop.
  clientDist: process.env.CLIENT_DIST ?? '../frontend/dist',
  backup: {
    dir: process.env.BACKUP_DIR ?? 'backups', // relative to the backend folder
    copyDir: process.env.BACKUP_COPY_DIR || null, // optional 2nd place: pen drive / OneDrive / Google Drive folder
    keep: Number(process.env.BACKUP_KEEP ?? 30), // automatic daily backups kept
    pgBin: process.env.PG_BIN || null, // folder with pg_dump / pg_restore; found automatically on Windows
  },
  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    name: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
  },
  auth: {
    jwtSecret: required('JWT_SECRET'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    cookieName: 'sairandhri_session',
  },
}

// Connection string built from the DB_* parts (password is URL-encoded).
const { user, password, host, port, name } = env.db
export const databaseUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}?schema=public`
