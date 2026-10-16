import { describe, expect, it } from 'vitest'
import { addedFileDiff, editedFiles, isAppFile, normalizePath, parseNumstatZ, parsePorcelainZ, parseUnifiedDiff } from './changes'

describe('parsePorcelainZ', () => {
  it('modificado, novo no índice, apagado, fora do git, conflito e renomeado', () => {
    const out = [' M src/a.ts', 'A  src/novo.ts', ' D velho.txt', '?? notas/rascunho.md', 'UU conflito.ts', 'R  src/b2.ts', 'src/b.ts', ''].join('\0')
    expect(parsePorcelainZ(out)).toEqual([
      { path: 'src/a.ts', kind: 'M', staged: false },
      { path: 'src/novo.ts', kind: 'A', staged: true },
      { path: 'velho.txt', kind: 'D', staged: false },
      { path: 'notas/rascunho.md', kind: '?', staged: false },
      { path: 'conflito.ts', kind: 'U', staged: true },
      { path: 'src/b2.ts', kind: 'R', staged: true, orig: 'src/b.ts' }
    ])
  })

  it('caminhos com espaços e acentos chegam inteiros', () => {
    expect(parsePorcelainZ(' M docs/manual de tela/ação.md\0')[0]!.path).toBe('docs/manual de tela/ação.md')
  })
})

describe('parseNumstatZ', () => {
  it('conta linhas e marca binários', () => {
    const map = parseNumstatZ(['3\t1\tsrc/a.ts', '-\t-\tlogo.png', ''].join('\0'))
    expect(map.get('src/a.ts')).toEqual({ added: 3, deleted: 1, binary: false })
    expect(map.get('logo.png')).toEqual({ added: 0, deleted: 0, binary: true })
  })

  it('renomeação (-z): usa o caminho novo', () => {
    const map = parseNumstatZ(['2\t0\t', 'src/b.ts', 'src/b2.ts', ''].join('\0'))
    expect(map.get('src/b2.ts')).toEqual({ added: 2, deleted: 0, binary: false })
  })
})

describe('parseUnifiedDiff', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,3 +10,4 @@ function x() {',
    ' const a = 1',
    '-const b = 2',
    '+const b = 3',
    '+const c = 4',
    ' return a',
    '\\ No newline at end of file',
    ''
  ].join('\n')

  it('blocos com números de linha antigos e novos', () => {
    const r = parseUnifiedDiff(diff)
    expect(r.binary).toBe(false)
    expect(r.hunks).toHaveLength(1)
    expect(r.hunks[0]!.lines).toEqual([
      { type: 'ctx', text: 'const a = 1', old: 10, new: 10 },
      { type: 'del', text: 'const b = 2', old: 11 },
      { type: 'add', text: 'const b = 3', new: 11 },
      { type: 'add', text: 'const c = 4', new: 12 },
      { type: 'ctx', text: 'return a', old: 12, new: 13 }
    ])
  })

  it('binário e corte por tamanho', () => {
    expect(parseUnifiedDiff('Binary files a/x.png and b/x.png differ\n').binary).toBe(true)
    const r = parseUnifiedDiff(diff, 2)
    expect(r.truncated).toBe(true)
    expect(r.hunks[0]!.lines).toHaveLength(2)
  })
})

describe('addedFileDiff', () => {
  it('arquivo novo: tudo como adicionado', () => {
    const r = addedFileDiff('a\r\nb\n')
    expect(r.hunks[0]!.lines).toEqual([
      { type: 'add', text: 'a', new: 1 },
      { type: 'add', text: 'b', new: 2 }
    ])
    expect(addedFileDiff('').hunks).toEqual([])
  })
})

describe('editedFiles', () => {
  it('pega só ferramentas de edição; resolve relativos (apply_patch) pela pasta do agente', () => {
    const items = [
      { kind: 'tool', name: 'Edit', detail: 'C:\\proj\\src\\a.ts' },
      { kind: 'tool', name: 'Read', detail: 'C:\\proj\\src\\lido.ts' },
      { kind: 'tool', name: 'apply_patch', detail: 'src/b.ts\n./docs/../README.md' },
      { kind: 'assistant', name: 'Edit', detail: 'C:\\proj\\x.ts' }
    ]
    expect(editedFiles(items, 'C:\\proj')).toEqual(['C:/proj/src/a.ts', 'C:/proj/src/b.ts', 'C:/proj/README.md'])
  })

  it('normalizePath: unidade em maiúscula, barras, "." e ".."', () => {
    expect(normalizePath('c:\\a\\.\\b\\..\\c.ts', 'X:/')).toBe('C:/a/c.ts')
    expect(normalizePath('/home/ana/p/../q', '/x')).toBe('/home/ana/q')
  })
})

describe('isAppFile', () => {
  it('arquivos do Maestrinho ficam fora da revisão', () => {
    expect(isAppFile('.maestrinho/workspace.json')).toBe(true)
    expect(isAppFile('.claude/skills/orq/SKILL.md')).toBe(true)
    expect(isAppFile('.claude/settings.json')).toBe(false)
    expect(isAppFile('src/maestrinho.ts')).toBe(false)
  })
})
