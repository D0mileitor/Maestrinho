import * as fs from 'node:fs'
import * as path from 'node:path'
import { BACKGROUND_FILE_RE } from '@shared/schemas'
import { metaDirOf } from '../store/WorkspaceStore'
import { log } from '../util/log'

/**
 * Imagens de fundo do escritório enviadas pelo usuário. Ficam no próprio projeto, em
 * .maestrinho/cenarios, e só são lidas/apagadas por nome simples dentro dessa pasta.
 */

export const BACKGROUNDS_DIR = 'cenarios'
export const MAX_BACKGROUND_BYTES = 12 * 1024 * 1024

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

/** Tipo real da imagem pelos primeiros bytes (a extensão do arquivo não basta). */
export function sniffImage(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | 'gif' | null {
  const at = (i: number): number => bytes[i] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'gif'
  const ascii = (from: number, to: number): string => String.fromCharCode(...bytes.slice(from, to))
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  return null
}

/** Nome seguro para o arquivo copiado: só letras, números, espaço, ponto, hífen, parênteses. */
export function safeBackgroundName(original: string, kind: 'png' | 'jpg' | 'webp' | 'gif'): string {
  const base = path
    .basename(original)
    .replace(/\.[^.]*$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w .()-]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base || 'fundo'}.${kind}`
}

export function backgroundsDir(workspaceDir: string): string {
  return path.join(metaDirOf(workspaceDir), BACKGROUNDS_DIR)
}

/** Caminho de um fundo pelo nome; recusa qualquer coisa fora da pasta de cenários. */
export function backgroundPath(workspaceDir: string, file: string): string {
  if (!BACKGROUND_FILE_RE.test(file)) throw new Error('nome de imagem de fundo inválido')
  const dir = backgroundsDir(workspaceDir)
  const full = path.resolve(dir, file)
  if (path.dirname(full) !== path.resolve(dir)) throw new Error('nome de imagem de fundo inválido')
  return full
}

export function listBackgrounds(workspaceDir: string): { file: string; bytes: number }[] {
  const dir = backgroundsDir(workspaceDir)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((n) => BACKGROUND_FILE_RE.test(n))
    .flatMap((file) => {
      try {
        const st = fs.statSync(path.join(dir, file))
        return st.isFile() ? [{ file, bytes: st.size }] : []
      } catch {
        return []
      }
    })
    .sort((a, b) => a.file.localeCompare(b.file))
}

/** Copia uma imagem para a pasta de cenários do projeto; devolve o nome gravado. */
export function importBackground(workspaceDir: string, source: string): string {
  const st = fs.statSync(source)
  if (!st.isFile()) throw new Error('escolha um arquivo de imagem')
  if (st.size > MAX_BACKGROUND_BYTES) throw new Error(`a imagem passa de ${MAX_BACKGROUND_BYTES / 1024 / 1024} MB; reduza o tamanho e tente de novo`)
  const bytes = fs.readFileSync(source)
  const kind = sniffImage(bytes)
  if (!kind) throw new Error('o arquivo não é uma imagem PNG, JPEG, WebP ou GIF')
  const dir = backgroundsDir(workspaceDir)
  fs.mkdirSync(dir, { recursive: true })
  const first = safeBackgroundName(source, kind)
  let file = first
  for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = first.replace(/\.(\w+)$/, ` (${i}).$1`)
  fs.writeFileSync(backgroundPath(workspaceDir, file), bytes)
  log.info('fundo do escritório importado', { bytes: bytes.length, kind })
  return file
}

export function readBackground(workspaceDir: string, file: string): string {
  const bytes = fs.readFileSync(backgroundPath(workspaceDir, file))
  const kind = sniffImage(bytes)
  if (!kind) throw new Error('o arquivo de fundo não é uma imagem válida')
  return `data:${MIME[kind]};base64,${bytes.toString('base64')}`
}

export function removeBackground(workspaceDir: string, file: string): void {
  fs.rmSync(backgroundPath(workspaceDir, file), { force: true })
}
