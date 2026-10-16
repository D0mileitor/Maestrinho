import * as fs from 'node:fs'
import * as path from 'node:path'
import { CHARACTER_FILE_RE } from '@shared/schemas'
import { metaDirOf } from '../store/WorkspaceStore'
import { log } from '../util/log'
import { safeBackgroundName, sniffImage } from './backgrounds'

/**
 * Personagens próprios do escritório (folhas de sprites enviadas pelo usuário). Ficam no projeto, em
 * .maestrinho/personagens, e só são lidos/apagados por nome simples dentro dessa pasta.
 */

export const CHARACTERS_DIR = 'personagens'
export const MAX_CHARACTER_BYTES = 4 * 1024 * 1024

const MIME: Record<string, string> = { png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

export function charactersDir(workspaceDir: string): string {
  return path.join(metaDirOf(workspaceDir), CHARACTERS_DIR)
}

/** Caminho de um personagem pelo nome; recusa qualquer coisa fora da pasta de personagens. */
export function characterPath(workspaceDir: string, file: string): string {
  if (!CHARACTER_FILE_RE.test(file)) throw new Error('nome de personagem inválido')
  const dir = charactersDir(workspaceDir)
  const full = path.resolve(dir, file)
  if (path.dirname(full) !== path.resolve(dir)) throw new Error('nome de personagem inválido')
  return full
}

export function listCharacters(workspaceDir: string): { file: string; bytes: number }[] {
  let names: string[]
  try {
    names = fs.readdirSync(charactersDir(workspaceDir))
  } catch {
    return []
  }
  return names
    .filter((n) => CHARACTER_FILE_RE.test(n))
    .flatMap((file) => {
      try {
        const st = fs.statSync(path.join(charactersDir(workspaceDir), file))
        return st.isFile() ? [{ file, bytes: st.size }] : []
      } catch {
        return []
      }
    })
    .sort((a, b) => a.file.localeCompare(b.file))
}

/** Copia a folha de sprites para a pasta de personagens do projeto; devolve o nome gravado. */
export function importCharacter(workspaceDir: string, source: string): string {
  const st = fs.statSync(source)
  if (!st.isFile()) throw new Error('escolha um arquivo de imagem')
  if (st.size > MAX_CHARACTER_BYTES) throw new Error(`a imagem passa de ${MAX_CHARACTER_BYTES / 1024 / 1024} MB; personagens em pixel art costumam ter poucos KB`)
  const bytes = fs.readFileSync(source)
  const kind = sniffImage(bytes)
  if (kind !== 'png' && kind !== 'webp' && kind !== 'gif') {
    throw new Error('o personagem precisa ser PNG, WebP ou GIF (com fundo transparente)')
  }
  const dir = charactersDir(workspaceDir)
  fs.mkdirSync(dir, { recursive: true })
  const first = safeBackgroundName(source, kind)
  let file = first
  for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = first.replace(/\.(\w+)$/, ` (${i}).$1`)
  fs.writeFileSync(characterPath(workspaceDir, file), bytes)
  log.info('personagem do escritório importado', { bytes: bytes.length, kind })
  return file
}

export function readCharacter(workspaceDir: string, file: string): string {
  const bytes = fs.readFileSync(characterPath(workspaceDir, file))
  const kind = sniffImage(bytes)
  if (kind !== 'png' && kind !== 'webp' && kind !== 'gif') throw new Error('o arquivo do personagem não é uma imagem válida')
  return `data:${MIME[kind]};base64,${bytes.toString('base64')}`
}

export function removeCharacter(workspaceDir: string, file: string): void {
  fs.rmSync(characterPath(workspaceDir, file), { force: true })
}
