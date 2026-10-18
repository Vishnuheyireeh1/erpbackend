import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import helmet from 'helmet'
import { env } from './config/env'
import { errorHandler, notFound } from './middlewares/error.middleware'
import routes from './routes'

const app = express()

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'blob:'],
        'frame-src': ["'self'", 'blob:'], // bill printing uses a hidden frame; PDFs open as blob URLs
        'font-src': ["'self'", 'data:'],
        // The shop opens the ERP over plain http on its own Wi-Fi — never force https sub-requests.
        'upgrade-insecure-requests': env.cookieSecure ? [] : null,
      },
    },
    strictTransportSecurity: env.cookieSecure,
  }),
)
app.use(cors({ origin: env.clientUrl, credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

app.use('/api', routes)

// Production: the built screens (frontend/dist) come from this same server → one address, e.g. http://192.168.1.10:5050
const clientDir = path.resolve(__dirname, '..', env.clientDist)
if (env.isProd && fs.existsSync(path.join(clientDir, 'index.html'))) {
  app.use(express.static(clientDir, { index: false, maxAge: '7d', setHeaders: (res, file) => file.endsWith('.html') && res.setHeader('Cache-Control', 'no-cache') }))
  // Any other page (/, /billing, /jobs/12 …) → the app's index.html; the browser router takes over.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(clientDir, 'index.html'))
  })
}

app.use(notFound)
app.use(errorHandler)

export default app
