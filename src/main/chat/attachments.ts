import { execFile } from 'node:child_process'
import { nativeImage } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { PDF_FILE } from '@shared/chatAttachments'

/** PDF anexado no chat: caminho absoluto de um .pdf que existe. */
export function checkPdf(p: string): string {
  if (!path.isAbsolute(p) || !PDF_FILE.test(p)) throw new Error('anexo inválido: além de imagens, só PDF')
  const st = fs.statSync(p, { throwIfNoEntry: false })
  if (!st?.isFile()) throw new Error(`PDF não encontrado: ${path.basename(p)}`)
  return p
}

/**
 * Primeira página do PDF como PNG em base64, pelo renderizador do próprio Windows (Windows.Data.Pdf).
 * O caminho vai por variável de ambiente (nada do arquivo entra no comando).
 */
const WINDOWS_RENDER = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$ext = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$opT = $ext | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
$actT = $ext | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Wait-Op($op, [Type]$t) { $task = $opT.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(15000); $task.Result }
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$file = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:MAESTRINHO_PDF)) ([Windows.Storage.StorageFile])
$doc = Wait-Op ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$page = $doc.GetPage(0)
$opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
$opts.DestinationWidth = 160
$stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
[void]$actT.Invoke($null, @($page.RenderToStreamAsync($stream, $opts))).Wait(15000)
$read = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream.GetInputStreamAt(0))
$mem = New-Object System.IO.MemoryStream
$read.CopyTo($mem)
[Convert]::ToBase64String($mem.ToArray())
`

/** Saída do renderizador → data URL do PNG (null se não for um PNG em base64). */
export function pngDataUrl(stdout: string): string | null {
  const b64 = stdout.trim()
  return b64.startsWith('iVBORw0KGgo') && /^[A-Za-z0-9+/]+=*$/.test(b64) ? `data:image/png;base64,${b64}` : null
}

function renderOnWindows(file: string): Promise<string | null> {
  const encoded = Buffer.from(WINDOWS_RENDER, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, MAESTRINHO_PDF: file }, timeout: 20_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : pngDataUrl(String(stdout)))
    )
  })
}

const cache = new Map<string, string>()

/**
 * Miniatura de um PDF anexado: a do sistema (Explorer/Quick Look); sem ela, no Windows, a primeira página
 * desenhada pelo renderizador de PDF do próprio Windows. null se nada der certo (a interface mostra "PDF").
 */
export async function pdfThumbnail(p: string): Promise<string | null> {
  let file: string
  try {
    file = checkPdf(p)
  } catch {
    return null
  }
  const key = `${file}|${fs.statSync(file).mtimeMs}`
  const hit = cache.get(key)
  if (hit) return hit
  let url: string | null = null
  try {
    const img = await nativeImage.createThumbnailFromPath(file, { width: 160, height: 208 })
    if (!img.isEmpty()) url = img.toDataURL()
  } catch {
    // sem miniatura do sistema para PDF (comum no Windows sem leitor de PDF instalado)
  }
  if (!url && process.platform === 'win32') url = await renderOnWindows(file)
  if (url) {
    if (cache.size >= 30) cache.delete(cache.keys().next().value!)
    cache.set(key, url)
  }
  return url
}
