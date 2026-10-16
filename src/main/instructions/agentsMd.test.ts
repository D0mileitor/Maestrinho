import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENTS_MD_BEGIN, AGENTS_MD_END } from '@shared/constants'
import { AgentsMdManager, detectEol, insertSection, removeSection, scanSection, toBytes } from './agentsMd'

const logs = vi.hoisted(() => [] as { level: string; msg: string; meta?: unknown }[])
vi.mock('../util/log', () => {
  const push = (level: string) => (msg: string, meta?: unknown) => {
    logs.push({ level, msg, meta })
  }
  return { log: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') } }
})

const SECTION = '## Seção do app\nlinha 1\nlinha 2'
const BLOCK_LF = `${AGENTS_MD_BEGIN}\n${SECTION}\n${AGENTS_MD_END}\n`

let root: string
let registry: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-agentsmd-'))
  registry = path.join(root, 'userData', 'run', 'agents-md.json')
  logs.length = 0
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function project(name = 'proj'): { dir: string; file: string } {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  return { dir, file: path.join(dir, 'AGENTS.md') }
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1
}

function readRegistry(): { version: number; entries: Record<string, { terminals: string[] }> } {
  return JSON.parse(fs.readFileSync(registry, 'utf8')) as { version: number; entries: Record<string, { terminals: string[] }> }
}

describe('AgentsMdManager — arquivo inexistente', () => {
  it('cria o AGENTS.md com exatamente uma seção e o apaga ao liberar', () => {
    const { dir, file } = project()
    const m = new AgentsMdManager(registry)
    expect(m.acquire(dir, 't1', SECTION)).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toBe(BLOCK_LF)
    m.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(false)
    expect(readRegistry().entries).toEqual({})
  })

  it('mantém o arquivo criado pelo app se o usuário escreveu nele (só a seção sai)', () => {
    const { dir, file } = project()
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    fs.appendFileSync(file, '# Minhas regras\n')
    m.release(dir, 't1')
    expect(fs.readFileSync(file, 'utf8')).toBe('# Minhas regras\n')
  })

  it('apaga o arquivo criado se sobrar só espaço em branco', () => {
    const { dir, file } = project()
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    fs.appendFileSync(file, '\n  \n')
    m.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(false)
  })
})

describe('AgentsMdManager — preserva o conteúdo do usuário byte a byte', () => {
  const cases: [string, Buffer][] = [
    ['LF com quebra final', Buffer.from('# Projeto\n\nRegras do time.\n', 'utf8')],
    ['LF sem quebra final', Buffer.from('# Projeto\nRegras do time.', 'utf8')],
    ['CRLF com quebra final', Buffer.from('# Projeto\r\n\r\nRegras do time.\r\n', 'utf8')],
    ['CRLF sem quebra final', Buffer.from('# Projeto\r\nRegras do time.', 'utf8')],
    ['BOM UTF-8 e acentos', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Ação\nRegras: ç, ã, é.\n', 'utf8')])],
    ['bytes Latin-1 (não UTF-8)', Buffer.from([0x23, 0x20, 0x41, 0xe7, 0xe3, 0x6f, 0x0a, 0x52, 0xe9])],
    ['termina com linhas em branco', Buffer.from('texto\n\n\n', 'utf8')],
    ['uma linha só, sem quebra', Buffer.from('Regras do time.', 'utf8')],
    ['arquivo vazio', Buffer.alloc(0)],
    ['só espaços', Buffer.from('  \n\t\n', 'utf8')],
    ['quebras mistas', Buffer.from('a\r\nb\nc\r\n', 'utf8')]
  ]

  it.each(cases)('%s', (_label, original) => {
    const { dir, file } = project()
    fs.writeFileSync(file, original)
    const m = new AgentsMdManager(registry)
    expect(m.acquire(dir, 't1', SECTION)).toBe(true)
    const during = fs.readFileSync(file)
    expect(during.subarray(0, original.length).equals(original)).toBe(true)
    expect(count(during.toString('latin1'), toBytes(AGENTS_MD_BEGIN))).toBe(1)
    m.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.readFileSync(file).equals(original)).toBe(true)
  })

  it('separa a seção do conteúdo por uma linha em branco', () => {
    const { dir, file } = project()
    fs.writeFileSync(file, '# A\n')
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    expect(fs.readFileSync(file, 'utf8')).toBe(`# A\n\n${BLOCK_LF}`)

    const other = project('sem-quebra')
    fs.writeFileSync(other.file, '# B')
    m.acquire(other.dir, 't2', SECTION)
    expect(fs.readFileSync(other.file, 'utf8')).toBe(`# B\n\n${BLOCK_LF}`)
  })

  it('arquivo CRLF recebe a seção em CRLF (nenhum LF solto)', () => {
    const { dir, file } = project()
    fs.writeFileSync(file, '# A\r\nB\r\n')
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    const text = fs.readFileSync(file, 'utf8')
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    expect(text).toBe(`# A\r\nB\r\n\r\n${AGENTS_MD_BEGIN}\r\n${SECTION.replace(/\n/g, '\r\n')}\r\n${AGENTS_MD_END}\r\n`)
  })

  it('nunca registra conteúdo do usuário nem o texto da seção no log', () => {
    const { dir, file } = project()
    fs.writeFileSync(file, '# Segredo do time\n')
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    m.release(dir, 't1')
    const dump = JSON.stringify(logs)
    expect(dump).not.toContain('Segredo')
    expect(dump).not.toContain('linha 1')
  })
})

describe('AgentsMdManager — contagem de referências', () => {
  it('a seção fica enquanto houver terminal na pasta', () => {
    const { dir, file } = project()
    fs.writeFileSync(file, '# Projeto\n')
    const m = new AgentsMdManager(registry)
    expect(m.acquire(dir, 't1', SECTION)).toBe(true)
    expect(m.acquire(dir, 't2', SECTION)).toBe(true)
    expect(count(fs.readFileSync(file, 'utf8'), AGENTS_MD_BEGIN)).toBe(1)
    expect(Object.values(readRegistry().entries)[0]?.terminals.sort()).toEqual(['t1', 't2'])

    m.release(dir, 't1')
    expect(count(fs.readFileSync(file, 'utf8'), AGENTS_MD_BEGIN)).toBe(1)
    m.release(dir, 't2')
    expect(fs.readFileSync(file, 'utf8')).toBe('# Projeto\n')
  })

  it('acquire repetido do mesmo terminal é idempotente', () => {
    const { dir, file } = project()
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    m.acquire(dir, 't1', SECTION)
    expect(count(fs.readFileSync(file, 'utf8'), AGENTS_MD_BEGIN)).toBe(1)
    m.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('release de terminal que não adquiriu (outro agente na mesma pasta) não mexe em nada', () => {
    const { dir, file } = project()
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    m.release(dir, 'outro')
    expect(fs.readFileSync(file, 'utf8')).toBe(BLOCK_LF)
    m.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('pastas diferentes são independentes', () => {
    const a = project('a')
    const b = project('b')
    const m = new AgentsMdManager(registry)
    m.acquire(a.dir, 't1', SECTION)
    m.acquire(b.dir, 't2', SECTION)
    m.release(a.dir, 't1')
    expect(fs.existsSync(a.file)).toBe(false)
    expect(fs.existsSync(b.file)).toBe(true)
  })
})

describe('AgentsMdManager — seção já existente', () => {
  it('troca só o miolo e preserva tudo fora dos marcadores', () => {
    const { dir, file } = project()
    const original = `# Meu\n\n${AGENTS_MD_BEGIN}\ntexto antigo\n${AGENTS_MD_END}\n\n## Depois\nfim\n`
    fs.writeFileSync(file, original)
    const m = new AgentsMdManager(registry)
    expect(m.acquire(dir, 't1', 'novo texto')).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toBe(`# Meu\n\n${AGENTS_MD_BEGIN}\nnovo texto\n${AGENTS_MD_END}\n\n## Depois\nfim\n`)
    m.release(dir, 't1')
    // Sem saber que separador foi usado, só a seção sai; o resto fica intacto.
    expect(fs.readFileSync(file, 'utf8')).toBe('# Meu\n\n\n## Depois\nfim\n')
  })

  it('não reescreve o arquivo quando o texto já é o mesmo', () => {
    const { dir, file } = project()
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(file, old, old)
    const before = fs.statSync(file).mtimeMs
    m.acquire(dir, 't2', SECTION)
    expect(fs.statSync(file).mtimeMs).toBe(before)
  })

  it('texto da seção com os marcadores é neutralizado', () => {
    const { dir, file } = project()
    const m = new AgentsMdManager(registry)
    expect(m.acquire(dir, 't1', `antes ${AGENTS_MD_END} depois ${AGENTS_MD_BEGIN}`)).toBe(true)
    const text = fs.readFileSync(file, 'utf8')
    expect(count(text, AGENTS_MD_BEGIN)).toBe(1)
    expect(count(text, AGENTS_MD_END)).toBe(1)
    m.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(false)
  })
})

describe('AgentsMdManager — marcadores malformados: nada muda', () => {
  const malformed: [string, string][] = [
    ['só o início', `# A\n${AGENTS_MD_BEGIN}\nx\n`],
    ['só o fim', `# A\n${AGENTS_MD_END}\n`],
    ['fim antes do início', `${AGENTS_MD_END}\nx\n${AGENTS_MD_BEGIN}\n`],
    ['dois inícios', `${AGENTS_MD_BEGIN}\n${AGENTS_MD_BEGIN}\nx\n${AGENTS_MD_END}\n`],
    ['dois pares', `${AGENTS_MD_BEGIN}\na\n${AGENTS_MD_END}\n${AGENTS_MD_BEGIN}\nb\n${AGENTS_MD_END}\n`],
    ['marcador no meio da linha', `texto ${AGENTS_MD_BEGIN}\nx\n${AGENTS_MD_END}\n`],
    ['texto depois do marcador', `${AGENTS_MD_BEGIN} extra\nx\n${AGENTS_MD_END}\n`]
  ]

  it.each(malformed)('%s', (_label, original) => {
    const { dir, file } = project()
    fs.writeFileSync(file, original)
    const m = new AgentsMdManager(registry)
    expect(m.acquire(dir, 't1', SECTION)).toBe(false)
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    m.release(dir, 't1')
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    expect(logs.some((l) => l.level === 'warn')).toBe(true)
  })

  it('marcadores quebrados pelo usuário durante a sessão: release não mexe', () => {
    const { dir, file } = project()
    fs.writeFileSync(file, '# A\n')
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    const broken = fs.readFileSync(file, 'utf8').replace(AGENTS_MD_END, '')
    fs.writeFileSync(file, broken)
    m.release(dir, 't1')
    expect(fs.readFileSync(file, 'utf8')).toBe(broken)
    expect(logs.some((l) => l.level === 'warn')).toBe(true)
  })

  it('arquivo UTF-16 não é tocado', () => {
    const { dir, file } = project()
    const original = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# A\n', 'utf16le')])
    fs.writeFileSync(file, original)
    const m = new AgentsMdManager(registry)
    expect(m.acquire(dir, 't1', SECTION)).toBe(false)
    expect(fs.readFileSync(file).equals(original)).toBe(true)
  })

  it('AGENTS.md que é diretório não é tocado', () => {
    const { dir, file } = project()
    fs.mkdirSync(file)
    const m = new AgentsMdManager(registry)
    expect(m.acquire(dir, 't1', SECTION)).toBe(false)
    expect(fs.statSync(file).isDirectory()).toBe(true)
  })
})

describe('AgentsMdManager — edições do usuário durante a sessão', () => {
  it('texto acrescentado depois da seção é mantido', () => {
    const { dir, file } = project()
    fs.writeFileSync(file, '# Projeto\n')
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    fs.appendFileSync(file, '## Nota do usuário\n')
    m.release(dir, 't1')
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toBe('# Projeto\n\n## Nota do usuário\n')
    expect(text).not.toContain(AGENTS_MD_BEGIN)
  })

  it('edição antes da seção é mantida e o separador do app sai', () => {
    const { dir, file } = project()
    fs.writeFileSync(file, '# Projeto\nRegras\n')
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('# Projeto', '# Projeto v2'))
    m.release(dir, 't1')
    expect(fs.readFileSync(file, 'utf8')).toBe('# Projeto v2\nRegras\n')
  })

  it('seção removida à mão pelo usuário: release não mexe no arquivo', () => {
    const { dir, file } = project()
    fs.writeFileSync(file, '# Projeto\n')
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    fs.writeFileSync(file, '# Projeto reescrito\n')
    m.release(dir, 't1')
    expect(fs.readFileSync(file, 'utf8')).toBe('# Projeto reescrito\n')
  })

  it('arquivo apagado pelo usuário: o próximo terminal recria e o último apaga', () => {
    const { dir, file } = project()
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    fs.rmSync(file)
    m.acquire(dir, 't2', SECTION)
    expect(fs.readFileSync(file, 'utf8')).toBe(BLOCK_LF)
    m.release(dir, 't1')
    m.release(dir, 't2')
    expect(fs.existsSync(file)).toBe(false)
  })
})

describe('AgentsMdManager — crash e órfãos', () => {
  it('cleanupOrphans remove as seções de uma sessão anterior e zera o registro', () => {
    const a = project('a')
    const b = project('b')
    fs.writeFileSync(b.file, '# B\r\nconteúdo\r\n')
    const crashed = new AgentsMdManager(registry)
    crashed.acquire(a.dir, 't1', SECTION)
    crashed.acquire(b.dir, 't2', SECTION)
    // O processo "morre" aqui, sem release.

    const next = new AgentsMdManager(registry)
    next.cleanupOrphans()
    expect(fs.existsSync(a.file)).toBe(false)
    expect(fs.readFileSync(b.file, 'utf8')).toBe('# B\r\nconteúdo\r\n')
    expect(readRegistry()).toEqual({ version: 1, entries: {} })
  })

  it('cleanupOrphans preserva o que este processo adquiriu', () => {
    const { dir, file } = project()
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    m.cleanupOrphans()
    expect(fs.readFileSync(file, 'utf8')).toBe(BLOCK_LF)
    m.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('ids de uma sessão anterior não seguram a contagem', () => {
    const { dir, file } = project()
    const crashed = new AgentsMdManager(registry)
    crashed.acquire(dir, 't1', SECTION)
    crashed.acquire(dir, 't2', SECTION)

    const next = new AgentsMdManager(registry)
    next.acquire(dir, 't1', SECTION)
    next.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('registro corrompido é ignorado sem quebrar', () => {
    const { dir, file } = project()
    fs.mkdirSync(path.dirname(registry), { recursive: true })
    fs.writeFileSync(registry, '{ isto não é json')
    const m = new AgentsMdManager(registry)
    m.cleanupOrphans()
    expect(m.acquire(dir, 't1', SECTION)).toBe(true)
    m.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(false)
    expect(readRegistry().version).toBe(1)
  })

  it('registro é JSON válido e gravado sem temporários sobrando', () => {
    const { dir } = project()
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    expect(Object.keys(readRegistry().entries)).toHaveLength(1)
    expect(fs.readdirSync(path.dirname(registry)).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('AgentsMdManager — sistema de arquivos', () => {
  it.runIf(process.platform !== 'win32')('preserva as permissões do arquivo (POSIX)', () => {
    const { dir, file } = project()
    fs.writeFileSync(file, '# A\n')
    fs.chmodSync(file, 0o640)
    const m = new AgentsMdManager(registry)
    m.acquire(dir, 't1', SECTION)
    expect(fs.statSync(file).mode & 0o777).toBe(0o640)
    m.release(dir, 't1')
    expect(fs.statSync(file).mode & 0o777).toBe(0o640)
  })

  it.runIf(process.platform === 'win32')('arquivo somente leitura (Windows) não é alterado', () => {
    const { dir, file } = project()
    fs.writeFileSync(file, '# A\n')
    fs.chmodSync(file, 0o444)
    try {
      const m = new AgentsMdManager(registry)
      expect(m.acquire(dir, 't1', SECTION)).toBe(false)
      expect(fs.readFileSync(file, 'utf8')).toBe('# A\n')
      expect(fs.existsSync(registry) ? readRegistry().entries : {}).toEqual({})
    } finally {
      fs.chmodSync(file, 0o666)
    }
  })

  it('link simbólico: edita o destino e o link continua link', (ctx) => {
    const { dir, file } = project()
    const target = path.join(dir, 'CLAUDE.md')
    fs.writeFileSync(target, '# Regras\n')
    try {
      fs.symlinkSync(target, file, 'file')
    } catch {
      ctx.skip() // Windows sem permissão para criar links simbólicos
      return
    }
    const m = new AgentsMdManager(registry)
    expect(m.acquire(dir, 't1', SECTION)).toBe(true)
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(target, 'utf8')).toContain(AGENTS_MD_BEGIN)
    m.release(dir, 't1')
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(target, 'utf8')).toBe('# Regras\n')
  })
})

describe('edição pura', () => {
  it('detectEol escolhe a quebra predominante', () => {
    expect(detectEol('a\r\nb\r\nc\n')).toBe('\r\n')
    expect(detectEol('a\nb\r\nc\n')).toBe('\n')
    expect(detectEol('sem quebra')).toBe('\n')
  })

  it('insert + remove devolvem o original', () => {
    for (const original of ['', 'a', 'a\n', 'a\r\n', 'a\n\n', '﻿título\r\nx']) {
      const bytes = toBytes(original)
      const { content, separator } = insertSection(bytes, SECTION)
      const scan = scanSection(content)
      expect(scan.kind).toBe('one')
      if (scan.kind !== 'one') continue
      expect(removeSection(content, scan, separator)).toBe(bytes)
    }
  })

  it('scanSection aceita espaços no fim da linha do marcador', () => {
    const text = toBytes(`${AGENTS_MD_BEGIN}  \nx\n${AGENTS_MD_END}\t\n`)
    expect(scanSection(text).kind).toBe('one')
  })
})
