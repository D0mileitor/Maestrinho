import { clipboard } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { log } from './util/log'

/** Imagens coladas ficam por este tempo (os agentes podem relê-las depois, ex.: o qa ou o doc). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Prints colados num terminal: o CLI de um agente (Claude Code, Codex) não recebe imagem pelo PTY, mas
 * reconhece o caminho de um arquivo de imagem colado como anexo. A imagem da área de transferência é
 * gravada como PNG numa pasta local do app e o renderer cola o caminho. Sem espaços no nome, para o
 * caminho chegar ao agente sem aspas.
 */
export class PastedImages {
  constructor(private readonly dir: string) {}

  /** Grava a imagem da área de transferência; null se não houver imagem. */
  async saveFromClipboard(): Promise<string | null> {
    for (const item of await clipboard.read()) {
      // A plataforma entrega o print (bitmap) como image/png.
      if (!item.types.includes('image/png')) continue
      const blob = await item.getType('image/png')
      const bytes = Buffer.from(await blob.arrayBuffer())
      if (bytes.length === 0) continue
      fs.mkdirSync(this.dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
      let file = path.join(this.dir, `print-${stamp}.png`)
      for (let i = 2; fs.existsSync(file); i++) file = path.join(this.dir, `print-${stamp}-${i}.png`)
      fs.writeFileSync(file, bytes)
      log.info('imagem colada gravada', { bytes: bytes.length })
      return file
    }
    return null
  }

  /** Apaga imagens antigas (na inicialização). */
  prune(now = Date.now()): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(this.dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isFile() || !/^print-[\w-]+\.png$/.test(e.name)) continue
      const file = path.join(this.dir, e.name)
      try {
        if (now - fs.statSync(file).mtimeMs > MAX_AGE_MS) fs.rmSync(file, { force: true })
      } catch {
        // arquivo em uso ou já removido
      }
    }
  }
}
