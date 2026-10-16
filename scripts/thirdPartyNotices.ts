// Plugin de build: grava THIRD-PARTY-NOTICES.txt junto de cada bundle (out/main, out/renderer) com a licença
// de todo pacote de node_modules que entrou nele. MIT, ISC, BSD e a OFL das fontes pedem o aviso junto de cada cópia do
// app, e o bundle do Vite remove os comentários de licença do código.
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Plugin } from 'vite'

export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt'

export interface NoticePackage {
  name: string
  version: string
  license: string
  /** Conteúdo dos arquivos LICENSE/COPYING/NOTICE do pacote. */
  texts: string[]
}

/** Pasta do pacote de node_modules que contém `file` (o mais interno, se aninhado); null se não for de um pacote. */
export function packageRoot(file: string): string | null {
  const clean = file.replace(/^\0/, '').replace(/\?.*$/, '').replace(/\\/g, '/')
  const marker = '/node_modules/'
  const i = clean.lastIndexOf(marker)
  if (i < 0) return null
  const parts = clean.slice(i + marker.length).split('/')
  const scoped = parts[0]?.startsWith('@') ?? false
  const name = scoped ? (parts[1] ? `${parts[0]}/${parts[1]}` : '') : (parts[0] ?? '')
  if (!name || name === '.bin') return null
  return clean.slice(0, i + marker.length) + name
}

/** Licença declarada no package.json (string, objeto `{ type }` ou a forma antiga `licenses: [...]`). */
export function declaredLicense(pkg: { license?: unknown; licenses?: unknown }): string {
  const typeOf = (v: unknown): string | null => {
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (v && typeof v === 'object' && 'type' in v && typeof v.type === 'string') return v.type
    return null
  }
  const single = typeOf(pkg.license)
  if (single) return single
  if (Array.isArray(pkg.licenses)) {
    const all = pkg.licenses.map(typeOf).filter((t): t is string => t !== null)
    if (all.length) return all.join(' OR ')
  }
  return 'DESCONHECIDA'
}

/** Arquivos de licença/aviso de um pacote: LICENSE e COPYING antes de NOTICE. */
export function isLicenseFile(name: string): boolean {
  return /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(name)
}

/**
 * Pacotes publicados no npm sem arquivo de licença: o texto vem de outro pacote do mesmo projeto.
 * (@xterm/headless e @xterm/addon-serialize são do repositório xterm.js, como o @xterm/xterm.)
 */
const LICENSE_FROM: Record<string, string> = {
  '@xterm/headless': '@xterm/xterm',
  '@xterm/addon-serialize': '@xterm/xterm'
}

function licenseTexts(root: string): string[] {
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root)
    .filter(isLicenseFile)
    .sort((a, b) => Number(/^notice/i.test(a)) - Number(/^notice/i.test(b)) || a.localeCompare(b))
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
}

function readPackage(root: string): NoticePackage | null {
  let pkg: { name?: unknown; version?: unknown; license?: unknown; licenses?: unknown }
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as typeof pkg
  } catch {
    return null
  }
  // Pastas internas com package.json próprio (ex.: "type": "module") não têm nome: não são pacotes.
  if (typeof pkg.name !== 'string') return null
  let texts = licenseTexts(root)
  const from = LICENSE_FROM[pkg.name]
  if (texts.length === 0 && from) {
    const sibling = path.join(root.slice(0, root.length - pkg.name.length), from)
    texts = licenseTexts(sibling).map((t) => `(publicado sem LICENSE; texto do mesmo projeto, em ${from})\n\n${t}`)
  }
  return {
    name: pkg.name,
    version: typeof pkg.version === 'string' ? pkg.version : '?',
    license: declaredLicense(pkg),
    texts
  }
}

/** Texto do arquivo de avisos: um bloco por pacote, em ordem alfabética. */
export function formatNotices(target: string, pkgs: NoticePackage[]): string {
  const sorted = [...pkgs].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  const lines = [
    `Maestrinho: avisos de terceiros (${target})`,
    '',
    `Este build embute ${sorted.length} pacotes de terceiros. Cada um segue abaixo com a própria licença.`,
    ''
  ]
  for (const p of sorted) {
    const body = p.texts.map((t) => t.replace(/\r\n/g, '\n').trim()).filter(Boolean)
    lines.push('='.repeat(80), `${p.name}@${p.version} (${p.license})`, '-'.repeat(80))
    lines.push(body.length ? body.join('\n\n') : `(o pacote não traz arquivo de licença; licença declarada: ${p.license})`, '')
  }
  return lines.join('\n')
}

/** `target` descreve o bundle no cabeçalho do arquivo (ex.: "interface"). */
export function thirdPartyNotices(target: string): Plugin {
  let root = process.cwd()
  return {
    name: 'maestrinho:third-party-notices',
    apply: 'build',
    configResolved(config) {
      root = config.root
    },
    generateBundle(_options, bundle) {
      const roots = new Set<string>()
      const add = (file: string): void => {
        const clean = file.replace(/^\0/, '').replace(/\?.*$/, '')
        const found = packageRoot(path.resolve(root, clean))
        if (found) roots.add(found)
      }
      for (const out of Object.values(bundle)) {
        // Módulos JS e CSS importados por JS aparecem nos chunks; fontes vindas de @import em CSS só como asset.
        if (out.type === 'chunk') out.moduleIds.forEach(add)
        else out.originalFileNames.forEach(add)
      }
      const pkgs = new Map<string, NoticePackage>()
      for (const r of roots) {
        const p = readPackage(r)
        if (p) pkgs.set(`${p.name}@${p.version}`, p)
      }
      if (pkgs.size === 0) return
      this.emitFile({ type: 'asset', fileName: NOTICES_FILE, source: formatNotices(target, [...pkgs.values()]) })
    }
  }
}
