import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { ApiError } from '../../utils/ApiError'
import { getSetting } from '../settings.service'

// Bills straight to the dot-matrix printer (TVS MSP 250 Star …) as plain text — like the shop's old software: the
// printer uses its own font (dark, sharp, fast), no print window. Works when the ERP runs on the PC the printer is
// plugged into (Windows). Text goes to the Windows spooler as RAW data through a small PowerShell helper.

const run = promisify(execFile)
const ESC = '\x1b'

const HELPER = String.raw`param([string]$Printer, [string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class SairandhriRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("Printer not found: " + printer);
    try {
      if (StartDocPrinter(h, 1, new DOCINFO { pDocName = "Sairandhri bill", pDataType = "RAW" }) == 0) throw new Exception("Could not start the print job");
      StartPagePrinter(h);
      int written;
      if (!WritePrinter(h, data, data.Length, out written)) throw new Exception("Could not send the bill to the printer");
      EndPagePrinter(h);
      EndDocPrinter(h);
    } finally { ClosePrinter(h); }
  }
}
"@
[SairandhriRaw]::Send($Printer, [IO.File]::ReadAllBytes($Path))
`

let helperPath: string | null = null
async function helper() {
  if (helperPath) return helperPath
  const p = path.join(os.tmpdir(), 'sairandhri-rawprint.ps1')
  await fs.writeFile(p, HELPER, 'utf8')
  return (helperPath = p)
}
const powershell = (args: string[]) =>
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { windowsHide: true, timeout: 30_000 })

function windowsOnly() {
  if (process.platform !== 'win32') throw ApiError.badRequest('Direct printing works only when the ERP runs on a Windows PC with the printer plugged in')
}

// Printers installed on this PC (for the Settings dropdown).
export async function listPrinters() {
  windowsOnly()
  const { stdout } = await powershell(['-Command', 'Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'])
  const parsed: unknown = JSON.parse(stdout.trim() || '[]')
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((n): n is string => typeof n === 'string')
}

// The printer's own character set is plain ASCII — ₹ and fancy dashes become simple letters.
const toAscii = (s: string) =>
  s.replace(/₹/g, 'Rs.').replace(/[—–]/g, '-').replace(/[·•]/g, '.').replace(/×/g, 'x').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e\n]/g, '?')

// ESC/P: reset, draft, double-strike (darker), a character size that fits `columns` across the paper width (10 / 12 cpi, or condensed ≈17 cpi
// like the old bills), first line (shop name) double width; 6 lines per inch, form length = paper height in lines so a form
// feed stops at the next tear line (half inches work: 5.5 in = 33 lines) — or, on a long roll, a few blank lines.
export function escpBill(text: string, s: { paperWidthIn: number; paperHeightIn: number; columns: number; feedLines: number }) {
  const lines = toAscii(text).split('\n').map((l) => l.replace(/\s+$/, ''))
  // Shop name: double width, centred again for the wider letters (like the old bills).
  const first = lines.findIndex((l) => l.trim())
  if (first >= 0) {
    const name = lines[first].trim()
    lines[first] = name.length * 2 <= s.columns ? `${' '.repeat(Math.floor((s.columns - name.length * 2) / 2))}${ESC}W1${name}${ESC}W0` : lines[first]
  }
  const cpi = s.columns / Math.max(1, s.paperWidthIn)
  const pitch = cpi <= 10 ? `${ESC}P` : cpi <= 12 ? `${ESC}M` : `${ESC}P\x0f` // 10, 12, condensed (SI)
  const form = s.paperHeightIn > 0 ? `${ESC}2${ESC}C${String.fromCharCode(Math.min(127, Math.round(s.paperHeightIn * 6)))}` : `${ESC}2`
  // Double-strike (each line printed twice) = darker text on a dot-matrix ribbon.
  const start = `${ESC}@${ESC}x0${pitch}${ESC}G${form}`
  const end = s.paperHeightIn > 0 ? '\f' : '\r\n'.repeat(s.feedLines)
  return Buffer.from(start + lines.join('\r\n') + '\r\n' + end, 'latin1')
}

// `printer` / `copies` come from the print preview (default: the printer chosen in Settings, 1 copy).
export async function printBill(text: string, opt: { printer?: string; copies?: number } = {}) {
  windowsOnly()
  const saved = await getSetting('billing.print')
  const s = { ...saved, printer: opt.printer || saved.printer }
  if (!s.printer) throw ApiError.badRequest('Choose the bill printer in Settings → Sales bills')
  const file = path.join(os.tmpdir(), `sairandhri-bill-${process.pid}-${Date.now()}.prn`)
  const one = escpBill(text, s)
  await fs.writeFile(file, Buffer.concat(Array.from({ length: Math.min(5, Math.max(1, opt.copies ?? 1)) }, () => one)))
  try {
    await powershell(['-File', await helper(), '-Printer', s.printer, '-Path', file])
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? (err as Error).message)
    throw ApiError.badRequest(/not found/i.test(msg) ? `Printer "${s.printer}" not found — is it switched on and plugged in?` : 'Could not print — check the printer is on, has paper and is plugged in')
  } finally {
    await fs.rm(file, { force: true })
  }
}
