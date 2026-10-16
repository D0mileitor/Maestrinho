import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@shared/api'
import { NoteFileSchema } from '@shared/schemas'
import {
  NOTE_MAX_BYTES,
  NotesService,
  desiredNoteName,
  normalizeNoteFile,
  noteFileProblem,
  noteRevision,
  notesDirOf,
  resolveNotePath,
  stripBom
} from './NotesService'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor(pred: () => boolean, timeoutMs = 6000, what = 'condição'): Promise<void> {
  const until = Date.now() + timeoutMs
  while (!pred()) {
    if (Date.now() > until) throw new Error(`tempo esgotado esperando: ${what}`)
    await sleep(20)
  }
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (err) {
    if (err instanceof ApiError) return err
    throw err
  }
  throw new Error('a operação deveria ter falhado')
}

function record(service: NotesService): { changed: string[]; lists: number; reset(): void } {
  const rec = {
    changed: [] as string[],
    lists: 0,
    reset() {
      rec.changed.length = 0
      rec.lists = 0
    }
  }
  service.on('changed', (_dir, file) => rec.changed.push(file))
  service.on('listChanged', () => {
    rec.lists++
  })
  return rec
}

// ------------------------------------------------------------------ helpers puros

describe('segurança de caminho das notas', () => {
  const malicious = [
    '',
    '../segredo.md',
    '..\\segredo.md',
    'planos/../../segredo.md',
    'planos/../x.md',
    './x.md',
    'a/./b.md',
    '..',
    '../',
    '/etc/passwd.md',
    '/x.md',
    '\\x.md',
    '\\\\servidor\\compartilhado\\x.md',
    '//servidor/compartilhado/x.md',
    '\\\\?\\C:\\Windows\\x.md',
    'C:\\Windows\\x.md',
    'C:/Windows/x.md',
    'c:x.md',
    'Z:nota.md',
    'nota.md:oculto.md',
    'nota.md::$DATA',
    'nota\0.md',
    'nota.md\0.txt',
    'con.md',
    'CON.md',
    'Con.md',
    'nul.md',
    'NUL.txt.md',
    'aux.md',
    'prn.md',
    'com1.md',
    'COM9.md',
    'com0.md',
    'lpt1.md',
    'LPT9.md',
    'com¹.md',
    'lpt³.md',
    'CON .md',
    'planos/con.md',
    'con/x.md',
    'aux.d/x.md',
    'nota.md.',
    'nota.md ',
    'planos./x.md',
    'planos /x.md',
    ' nota.md',
    ' planos/x.md',
    '.oculta.md',
    '.md',
    'planos/.x.md',
    '.git/x.md',
    'a/b/c.md',
    'a/b/c/d.md',
    'nota.txt',
    'nota',
    'nota.MD',
    'nota.Md',
    'nota.markdown',
    'pasta.md/x.md',
    `${'x'.repeat(198)}.md`,
    'nota*.md',
    'nota?.md',
    'nota<x>.md',
    'nota|x.md',
    'nota"x".md',
    "nota'x'.md",
    '~/nota.md',
    '$HOME/nota.md',
    '%USERPROFILE%/nota.md',
    '%2e%2e/x.md',
    'planos//x.md',
    'planos/',
    '/',
    'ａ／ｂ.md',
    '．．/x.md',
    'nota\u202e.md',
    'nota\n.md',
    'nota\r.md',
    'nota\t.md',
    'a..b.md'
  ]

  it.each(malicious)('rejeita %j', (file) => {
    expect(noteFileProblem(file)).not.toBeNull()
    expect(() => normalizeNoteFile(file)).toThrow(ApiError)
    expect(() => resolveNotePath(path.resolve('ws-teste'), file)).toThrow(ApiError)
    try {
      normalizeNoteFile(file)
    } catch (err) {
      expect((err as ApiError).code).toBe('bad_request')
      expect((err as ApiError).message).toMatch(/^nome de nota inválido: /)
    }
  })

  const valid = [
    'spec.md',
    'planos/sprint-1.md',
    'Notas do time.md',
    'ação_e_reação.md',
    'v1.2.3.md',
    'console.md',
    'config.md',
    'com10.md',
    'nul-x.md',
    'lpt.md',
    '-x.md',
    'a.b/c.md',
    '日本語.md',
    `${'x'.repeat(197)}.md`
  ]

  it.each(valid)('aceita %j (e o NoteFileSchema também)', (file) => {
    expect(noteFileProblem(file)).toBeNull()
    expect(normalizeNoteFile(file)).toBe(file)
    expect(NoteFileSchema.safeParse(file).success).toBe(true)
  })

  it('normaliza para NFC antes de validar', () => {
    const nfd = 'ac\u0327a\u0303o.md'
    expect(noteFileProblem(nfd)).not.toBeNull()
    expect(normalizeNoteFile(nfd)).toBe('ação.md')
  })

  it('resolve o caminho dentro da pasta de notas', () => {
    const ws = path.resolve('ws-teste')
    const { abs, notesDir, file } = resolveNotePath(ws, 'planos/sprint.md')
    expect(notesDir).toBe(path.join(ws, '.maestrinho', 'notes'))
    expect(abs).toBe(path.join(ws, '.maestrinho', 'notes', 'planos', 'sprint.md'))
    expect(file).toBe('planos/sprint.md')
  })

  it('exige diretório de workspace absoluto', () => {
    expect(() => resolveNotePath('relativo', 'x.md')).toThrow(ApiError)
  })

  it('nome desejado: apara, garante .md minúsculo e usa "nota.md" quando vazio', () => {
    expect(desiredNoteName('')).toBe('nota.md')
    expect(desiredNoteName('   ')).toBe('nota.md')
    expect(desiredNoteName('ideias')).toBe('ideias.md')
    expect(desiredNoteName('X.MD')).toBe('X.md')
    expect(desiredNoteName('  planos/s  ')).toBe('planos/s.md')
    expect(desiredNoteName('a.markdown')).toBe('a.markdown.md')
  })
})

describe('revisão e BOM', () => {
  it('revisão = 16 primeiros hex do SHA-256 (UTF-8)', () => {
    expect(noteRevision('')).toBe('e3b0c44298fc1c14')
    expect(noteRevision('abc')).toBe('ba7816bf8f01cfea')
    const text = 'ação — 漢字 🎵'
    const expected = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex').slice(0, 16)
    expect(noteRevision(text)).toBe(expected)
    expect(noteRevision(text)).toMatch(/^[0-9a-f]{16}$/)
    expect(noteRevision('a')).not.toBe(noteRevision('a\n'))
  })

  it('remove só o BOM inicial', () => {
    expect(stripBom('\uFEFFolá')).toBe('olá')
    expect(stripBom('olá')).toBe('olá')
    expect(stripBom('\uFEFF\uFEFFx')).toBe('\uFEFFx')
    expect(stripBom('a\uFEFF')).toBe('a\uFEFF')
  })
})

// ------------------------------------------------------------------ serviço (disco)

describe('NotesService', () => {
  let ws: string
  let notesDir: string
  let service: NotesService

  beforeEach(async () => {
    ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'maestrinho-notas-'))
    notesDir = notesDirOf(ws)
    service = new NotesService({ debounceMs: 40 })
  })

  afterEach(async () => {
    await service.closeAll()
    await fsp.rm(ws, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('escreve e lê (ida e volta) com a revisão correta', async () => {
    const { revision } = await service.write(ws, 'spec.md', '# Spec\n\nolá')
    expect(revision).toBe(noteRevision('# Spec\n\nolá'))
    const read = await service.read(ws, 'spec.md')
    expect(read).toEqual({ content: '# Spec\n\nolá', revision })
    expect(await fsp.readFile(path.join(notesDir, 'spec.md'), 'utf8')).toBe('# Spec\n\nolá')
    expect(await service.exists(ws, 'spec.md')).toBe(true)
    expect(await service.exists(ws, 'outra.md')).toBe(false)
  })

  it('remove o BOM ao ler e não grava BOM', async () => {
    await fsp.mkdir(notesDir, { recursive: true })
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('olá', 'utf8')])
    await fsp.writeFile(path.join(notesDir, 'bom.md'), withBom)
    const read = await service.read(ws, 'bom.md')
    expect(read.content).toBe('olá')
    expect(read.revision).toBe(noteRevision('olá'))
    await service.write(ws, 'bom2.md', '\uFEFFtexto')
    const raw = await fsp.readFile(path.join(notesDir, 'bom2.md'))
    expect(raw[0]).not.toBe(0xef)
    expect((await service.read(ws, 'bom2.md')).revision).toBe(noteRevision('texto'))
  })

  it('preserva CRLF e conteúdo arbitrário', async () => {
    const text = 'linha 1\r\nlinha 2\r\n\u0000? não: só texto 🎵'
    await service.write(ws, 'crlf.md', text)
    expect((await service.read(ws, 'crlf.md')).content).toBe(text)
  })

  it('ler nota inexistente gera not_found', async () => {
    const err = await rejection(service.read(ws, 'nada.md'))
    expect(err.code).toBe('not_found')
    expect(err.message).toContain('nada.md')
  })

  it('cria subpasta ao escrever "planos/sprint.md"', async () => {
    await service.write(ws, 'planos/sprint.md', 'x')
    expect(fs.existsSync(path.join(notesDir, 'planos', 'sprint.md'))).toBe(true)
  })

  it('recusa nomes inválidos sem tocar o disco fora da pasta', async () => {
    for (const bad of ['../fora.md', '..\\fora.md', 'planos/../../fora.md', 'con.md', path.join(ws, 'x.md')]) {
      expect((await rejection(service.write(ws, bad, 'x'))).code).toBe('bad_request')
      expect((await rejection(service.read(ws, bad))).code).toBe('bad_request')
      expect((await rejection(service.append(ws, bad, 'x'))).code).toBe('bad_request')
    }
    expect(fs.existsSync(path.join(ws, '.maestrinho', 'fora.md'))).toBe(false)
    expect(fs.existsSync(path.join(ws, 'fora.md'))).toBe(false)
    expect((await rejection(service.read('relativo', 'x.md'))).code).toBe('bad_request')
  })

  it('não segue junção/link de pasta que leva para fora da pasta de notas', async () => {
    const outside = path.join(ws, 'fora')
    await fsp.mkdir(outside, { recursive: true })
    await fsp.writeFile(path.join(outside, 'segredo.md'), 'segredo')
    await fsp.mkdir(notesDir, { recursive: true })
    try {
      await fsp.symlink(outside, path.join(notesDir, 'link'), 'junction')
    } catch {
      return // sistema sem suporte a links/junções: nada a verificar
    }
    expect((await rejection(service.read(ws, 'link/segredo.md'))).code).toBe('forbidden')
    expect((await rejection(service.write(ws, 'link/novo.md', 'x'))).code).toBe('forbidden')
    expect((await rejection(service.append(ws, 'link/segredo.md', 'x'))).code).toBe('forbidden')
    expect((await rejection(service.create(ws, 'link/novo.md'))).code).toBe('forbidden')
    expect(fs.existsSync(path.join(outside, 'novo.md'))).toBe(false)
    expect(await fsp.readFile(path.join(outside, 'segredo.md'), 'utf8')).toBe('segredo')
    expect((await service.list(ws)).map((e) => e.file)).not.toContain('link/segredo.md')
  })

  it('não lê arquivo-link que aponta para fora da pasta de notas', async () => {
    const outside = path.join(ws, 'segredo.md')
    await fsp.writeFile(outside, 'segredo')
    await fsp.mkdir(notesDir, { recursive: true })
    try {
      await fsp.symlink(outside, path.join(notesDir, 'atalho.md'), 'file')
    } catch {
      return // criar links de arquivo exige privilégio no Windows: nada a verificar
    }
    expect((await rejection(service.read(ws, 'atalho.md'))).code).toBe('forbidden')
  })

  describe('ifRevision', () => {
    it('aceita a revisão atual e recusa revisão antiga (precondition com a revisão atual)', async () => {
      const r1 = await service.write(ws, 'n.md', 'a')
      const r2 = await service.write(ws, 'n.md', 'b', r1.revision)
      expect(r2.revision).toBe(noteRevision('b'))
      const err = await rejection(service.write(ws, 'n.md', 'c', r1.revision))
      expect(err.code).toBe('precondition')
      expect(err.message).toContain(r2.revision)
      expect(err.message).toContain(r1.revision)
      expect((await service.read(ws, 'n.md')).content).toBe('b')
    })

    it('compara sem diferenciar maiúsculas e recusa nota inexistente', async () => {
      const r1 = await service.write(ws, 'n.md', 'a')
      const upper = await service.write(ws, 'n.md', 'b', r1.revision.toUpperCase())
      expect(upper).toEqual({ revision: noteRevision('b') })
      const err = await rejection(service.write(ws, 'sumiu.md', 'x', noteRevision('')))
      expect(err.code).toBe('precondition')
      expect(fs.existsSync(path.join(notesDir, 'sumiu.md'))).toBe(false)
    })

    it('duas escritas concorrentes com a mesma base: só uma vence', async () => {
      const base = await service.write(ws, 'c.md', 'base')
      const results = await Promise.allSettled([
        service.write(ws, 'c.md', 'versão A', base.revision),
        service.write(ws, 'c.md', 'versão B', base.revision)
      ])
      const ok = results.filter((r) => r.status === 'fulfilled')
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(ok).toHaveLength(1)
      expect(failed).toHaveLength(1)
      expect((failed[0]!.reason as ApiError).code).toBe('precondition')
      expect((await service.read(ws, 'c.md')).content).toBe('versão A')
    })
  })

  describe('append', () => {
    it('cria a nota se não existir e separa com quebra de linha', async () => {
      await service.append(ws, 'log.md', 'linha 1')
      expect((await service.read(ws, 'log.md')).content).toBe('linha 1')
      await service.append(ws, 'log.md', 'linha 2')
      expect((await service.read(ws, 'log.md')).content).toBe('linha 1\nlinha 2')
    })

    it('não duplica a quebra quando o arquivo já termina com uma', async () => {
      await service.write(ws, 'log.md', 'a\n')
      await service.append(ws, 'log.md', 'b\n')
      await service.append(ws, 'log.md', 'c')
      expect((await service.read(ws, 'log.md')).content).toBe('a\nb\nc')
    })

    it('usa CRLF quando o arquivo usa CRLF', async () => {
      await service.write(ws, 'win.md', 'a\r\nb')
      await service.append(ws, 'win.md', 'c')
      expect((await service.read(ws, 'win.md')).content).toBe('a\r\nb\r\nc')
    })

    it('texto vazio não altera a nota', async () => {
      const r = await service.write(ws, 'v.md', 'x')
      expect(await service.append(ws, 'v.md', '')).toEqual(r)
      expect((await service.read(ws, 'v.md')).content).toBe('x')
    })

    it('appends concorrentes são serializados (nenhum se perde, ordem preservada)', async () => {
      const n = 40
      await Promise.all(Array.from({ length: n }, (_, i) => service.append(ws, 'fila.md', `linha ${i}`)))
      const lines = (await service.read(ws, 'fila.md')).content.split('\n')
      expect(lines).toEqual(Array.from({ length: n }, (_, i) => `linha ${i}`))
    })

    it('escritas e appends intercalados não se perdem', async () => {
      await service.write(ws, 'mix.md', 'início')
      await Promise.all([
        service.append(ws, 'mix.md', 'a'),
        service.write(ws, 'mix.md', 'reescrito'),
        service.append(ws, 'mix.md', 'b'),
        service.append(ws, 'mix.md', 'c')
      ])
      expect((await service.read(ws, 'mix.md')).content).toBe('reescrito\nb\nc')
    })
  })

  describe('create', () => {
    it('gera nomes únicos (nota.md, nota-2.md, ...) sem diferenciar maiúsculas', async () => {
      expect(await service.create(ws, 'nota')).toBe('nota.md')
      expect(await service.create(ws, 'nota.md')).toBe('nota-2.md')
      expect(await service.create(ws, '')).toBe('nota-3.md')
      expect(await service.create(ws, 'Nota.MD')).toBe('Nota-4.md')
      const files = (await service.list(ws)).map((e) => e.file)
      expect(new Set(files)).toEqual(new Set(['nota.md', 'nota-2.md', 'nota-3.md', 'Nota-4.md']))
    })

    it('grava o conteúdo inicial e nunca sobrescreve uma nota existente', async () => {
      await service.write(ws, 'x.md', 'original')
      expect(await service.create(ws, 'x.md', 'novo')).toBe('x-2.md')
      expect((await service.read(ws, 'x.md')).content).toBe('original')
      expect((await service.read(ws, 'x-2.md')).content).toBe('novo')
    })

    it('cria em subpasta', async () => {
      expect(await service.create(ws, 'planos/sprint')).toBe('planos/sprint.md')
      expect(await service.create(ws, 'planos/sprint')).toBe('planos/sprint-2.md')
      expect(fs.existsSync(path.join(notesDir, 'planos', 'sprint-2.md'))).toBe(true)
    })

    it('criações concorrentes recebem nomes distintos', async () => {
      const names = await Promise.all(Array.from({ length: 12 }, () => service.create(ws, 'paralela')))
      expect(new Set(names).size).toBe(12)
      expect(names).toContain('paralela.md')
      expect(names).toContain('paralela-12.md')
    })

    it('encurta o nome para caber no limite ao acrescentar o sufixo', async () => {
      const long = `${'n'.repeat(197)}.md`
      expect(await service.create(ws, long)).toBe(long)
      const second = await service.create(ws, long)
      expect(second.length).toBeLessThanOrEqual(200)
      expect(second.endsWith('-2.md')).toBe(true)
      expect(noteFileProblem(second)).toBeNull()
    })

    it('recusa nome inválido', async () => {
      expect((await rejection(service.create(ws, '../fora'))).code).toBe('bad_request')
      expect((await rejection(service.create(ws, 'a/b/c'))).code).toBe('bad_request')
    })
  })

  describe('list', () => {
    it('lista recursivamente (1 nível), ordenado, ignorando nomes inválidos', async () => {
      await fsp.mkdir(path.join(notesDir, 'planos', 'fundo'), { recursive: true })
      await fsp.mkdir(path.join(notesDir, '.oculta'), { recursive: true })
      const files: Record<string, string> = {
        'b.md': 'bb',
        'a.md': 'a',
        'nota-10.md': 'x',
        'nota-2.md': 'x',
        'planos/sprint.md': 'sprint',
        'planos/fundo/demais.md': 'x',
        'planos/x.txt': 'x',
        'NOTA.MD': 'x',
        'leia.txt': 'x',
        '.escondida.md': 'x',
        '.oculta/x.md': 'x',
        '.a.md.123abc.tmp': 'x'
      }
      for (const [rel, text] of Object.entries(files)) await fsp.writeFile(path.join(notesDir, ...rel.split('/')), text)
      const list = await service.list(ws)
      expect(list.map((e) => e.file)).toEqual(['a.md', 'b.md', 'nota-2.md', 'nota-10.md', 'planos/sprint.md'])
      const b = list.find((e) => e.file === 'b.md')!
      expect(b.size).toBe(2)
      expect(b.mtimeMs).toBeGreaterThan(0)
    })

    it('pasta de notas inexistente = lista vazia', async () => {
      expect(await service.list(ws)).toEqual([])
    })
  })

  it('recusa conteúdo acima do limite', async () => {
    const big = 'x'.repeat(NOTE_MAX_BYTES + 1)
    expect((await rejection(service.write(ws, 'grande.md', big))).code).toBe('too_large')
    await service.write(ws, 'quase.md', 'x'.repeat(NOTE_MAX_BYTES - 1))
    expect((await rejection(service.append(ws, 'quase.md', 'yy'))).code).toBe('too_large')
  })

  it('emite changed/listChanged nas escritas do próprio serviço (sem watcher)', async () => {
    const rec = record(service)
    await service.write(ws, 'e.md', '1')
    expect(rec.changed).toEqual(['e.md'])
    expect(rec.lists).toBe(1)
    await service.write(ws, 'e.md', '2')
    expect(rec.changed).toEqual(['e.md', 'e.md'])
    expect(rec.lists).toBe(1)
    // Conteúdo idêntico: nada muda, nada é emitido.
    await service.write(ws, 'e.md', '2')
    expect(rec.changed).toHaveLength(2)
    await service.create(ws, 'e.md')
    expect(rec.changed).toEqual(['e.md', 'e.md', 'e-2.md'])
    expect(rec.lists).toBe(2)
  })

  it('um ouvinte com erro não faz a escrita falhar', async () => {
    service.on('changed', () => {
      throw new Error('ouvinte quebrado')
    })
    await expect(service.write(ws, 'ok.md', 'x')).resolves.toEqual({ revision: noteRevision('x') })
  })

  // ---------------------------------------------------------------- watcher

  describe('watcher', () => {
    it('alteração externa emite changed', async () => {
      await service.write(ws, 'w.md', 'inicial')
      await service.watch(ws)
      const rec = record(service)
      await fsp.writeFile(path.join(notesDir, 'w.md'), 'mudou por fora')
      await waitFor(() => rec.changed.includes('w.md'), 6000, 'changed de w.md')
      expect(rec.lists).toBe(0)
    })

    it('escrita própria não gera eco do watcher (só o evento imediato do serviço)', async () => {
      await service.watch(ws)
      await service.write(ws, 'p.md', 'v1')
      await sleep(500)
      const rec = record(service)
      await service.write(ws, 'p.md', 'v2')
      await service.append(ws, 'p.md', 'v3')
      expect(rec.changed).toEqual(['p.md', 'p.md'])
      await sleep(900)
      expect(rec.changed).toEqual(['p.md', 'p.md'])
      expect(rec.lists).toBe(0)
      // Prova de que o watcher estava ativo neste teste.
      await fsp.writeFile(path.join(notesDir, 'p.md'), 'externo')
      await waitFor(() => rec.changed.length === 3, 6000, 'changed externo')
    })

    it('salvamento atômico de editor (temporário + rename) emite changed', async () => {
      await service.write(ws, 'a.md', 'v1')
      await service.watch(ws)
      const rec = record(service)
      const tmp = path.join(notesDir, '.a.md.editor.tmp')
      await fsp.writeFile(tmp, 'v2 atômico')
      await fsp.rename(tmp, path.join(notesDir, 'a.md'))
      await waitFor(() => rec.changed.includes('a.md'), 6000, 'changed após rename')
      expect((await service.read(ws, 'a.md')).content).toBe('v2 atômico')
    })

    it('unlink seguido de add (editor) emite changed', async () => {
      await service.write(ws, 'u.md', 'v1')
      await service.watch(ws)
      const rec = record(service)
      await fsp.unlink(path.join(notesDir, 'u.md'))
      await sleep(20)
      await fsp.writeFile(path.join(notesDir, 'u.md'), 'v2')
      await waitFor(() => rec.changed.includes('u.md'), 6000, 'changed após unlink+add')
      await sleep(400)
      expect((await service.read(ws, 'u.md')).content).toBe('v2')
    })

    it('arquivo novo e arquivo removido por fora emitem listChanged e changed', async () => {
      await service.write(ws, 'existe.md', 'x')
      await service.watch(ws)
      const rec = record(service)
      await fsp.writeFile(path.join(notesDir, 'novo.md'), 'novo')
      await waitFor(() => rec.lists > 0 && rec.changed.includes('novo.md'), 6000, 'nota nova')
      rec.reset()
      await fsp.unlink(path.join(notesDir, 'existe.md'))
      await waitFor(() => rec.lists > 0 && rec.changed.includes('existe.md'), 6000, 'nota removida')
    })

    it('subpasta: eventos usam "/" no nome', async () => {
      await service.write(ws, 'planos/s.md', 'v1')
      await service.watch(ws)
      const rec = record(service)
      await fsp.writeFile(path.join(notesDir, 'planos', 's.md'), 'v2')
      await waitFor(() => rec.changed.includes('planos/s.md'), 6000, 'changed em subpasta')
    })

    it('ignora temporários, ocultos e arquivos que não são .md', async () => {
      await service.watch(ws)
      const rec = record(service)
      await fsp.writeFile(path.join(notesDir, 'x.txt'), 'x')
      await fsp.writeFile(path.join(notesDir, '.y.md.abc.tmp'), 'x')
      await fsp.writeFile(path.join(notesDir, '.oculta.md'), 'x')
      await fsp.writeFile(path.join(notesDir, 'z.md~'), 'x')
      await sleep(700)
      expect(rec.changed).toEqual([])
      expect(rec.lists).toBe(0)
    })

    it('watch é idempotente e unwatch para os eventos', async () => {
      await service.write(ws, 'i.md', 'v1')
      const p1 = service.watch(ws)
      const p2 = service.watch(ws)
      expect(p1).toBe(p2)
      await p1
      expect(service.isWatching(ws)).toBe(true)
      await service.unwatch(ws)
      expect(service.isWatching(ws)).toBe(false)
      const rec = record(service)
      await fsp.writeFile(path.join(notesDir, 'i.md'), 'v2')
      await sleep(600)
      expect(rec.changed).toEqual([])
      await service.unwatch(ws)
      await service.closeAll()
    })

    it('pasta de notas apagada e recriada: avisa a remoção e volta a observar', async () => {
      await service.write(ws, 'r.md', 'v1')
      await service.watch(ws)
      const rec = record(service)
      await fsp.rm(notesDir, { recursive: true, force: true })
      await waitFor(() => rec.changed.includes('r.md'), 6000, 'remoção da pasta')
      rec.reset()
      await sleep(200)
      await fsp.mkdir(notesDir, { recursive: true })
      await fsp.writeFile(path.join(notesDir, 'r.md'), 'v2')
      await waitFor(() => rec.changed.includes('r.md'), 8000, 'nota recriada')
      // E alterações seguintes continuam chegando.
      rec.reset()
      await sleep(300)
      await fsp.writeFile(path.join(notesDir, 'r.md'), 'v3')
      await waitFor(() => rec.changed.includes('r.md'), 6000, 'alteração após religar')
    })
  })
})
