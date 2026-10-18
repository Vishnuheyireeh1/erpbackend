import { randomBytes } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ApiError } from '../../utils/ApiError'

// Photos live in backend/uploads/<products|jobs> (git-ignored), served at /api/uploads/<folder>/<file> after login.
export const UPLOADS_DIR = path.resolve(__dirname, '../../../uploads')

// Detect the real file type from its first bytes — never trust the file name or browser type.
function detectImageType(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

// Saves the image under a random name in uploads/<folder>; returns the stored relative path.
export async function saveImage(buf: Buffer, folder: 'products' | 'jobs') {
  const ext = detectImageType(buf)
  if (!ext) throw ApiError.badRequest('Upload a JPG, PNG or WebP image')
  await mkdir(path.join(UPLOADS_DIR, folder), { recursive: true })
  const fileName = `${randomBytes(16).toString('hex')}.${ext}`
  await writeFile(path.join(UPLOADS_DIR, folder, fileName), buf)
  return `${folder}/${fileName}`
}

// Removes an old image file; a missing file is not an error.
export async function deleteImage(relPath: string | null, folder: 'products' | 'jobs') {
  if (!relPath) return
  const full = path.resolve(UPLOADS_DIR, relPath)
  if (!full.startsWith(path.join(UPLOADS_DIR, folder) + path.sep)) return // never touch files outside the folder
  await unlink(full).catch(() => undefined)
}

export const saveProductImage = (buf: Buffer) => saveImage(buf, 'products')
export const deleteProductImage = (relPath: string | null) => deleteImage(relPath, 'products')
