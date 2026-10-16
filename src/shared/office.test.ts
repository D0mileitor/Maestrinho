import { describe, expect, it } from 'vitest'
import { archiveRoute, archiveUse, boardRect, buildScene, defaultLook, effectiveLook, orthogonalPath, routeBetween, toolActivity, walkRoute, helperLook, lastToolName, mainMonitor, monitorLayout, OFFICE_GEOMETRY, type OfficeScene } from './office'
import { LookSchema, type CanvasEdge, type CanvasNode } from './schemas'

const term = (id: string, x: number, y: number, floorId?: string): CanvasNode => ({
  id,
  kind: 'terminal',
  name: id,
  presetId: 'claude',
  cwd: '',
  autoStart: true,
  position: { x, y },
  size: { w: 600, h: 420 },
  floorId
})
const note = (id: string, file: string, x: number, y: number): CanvasNode => ({ id, kind: 'note', file, position: { x, y }, size: { w: 400, h: 320 } })
const edge = (id: string, source: string, target: string): CanvasEdge => ({ id, source, target })

describe('aparência', () => {
  it('visual padrão é válido, varia com o id e é estável', () => {
    const a = defaultLook('t-abc')
    expect(LookSchema.safeParse(a).success).toBe(true)
    expect(defaultLook('t-abc')).toEqual(a)
    const looks = ['t-1', 't-2', 't-3', 't-4', 't-5', 't-6'].map((id) => JSON.stringify(defaultLook(id)))
    expect(new Set(looks).size).toBeGreaterThan(3)
  })

  it('camiseta segue o papel quando marcado; sem papel usa a cor neutra', () => {
    const l = { ...defaultLook('x'), shirtFromRole: true, shirt: '#000000' }
    expect(effectiveLook(l, 'x', '#5b8def').shirt).toBe('#5b8def')
    expect(effectiveLook(l, 'x', undefined).shirt).toBe('#7d8597')
    expect(effectiveLook({ ...l, shirtFromRole: false }, 'x', '#5b8def').shirt).toBe('#000000')
  })
})

describe('toolActivity', () => {
  it('traduz ferramentas do Claude Code e do Codex em animações', () => {
    expect(toolActivity('Edit')).toBe('typing')
    expect(toolActivity('apply_patch')).toBe('typing')
    expect(toolActivity('Grep')).toBe('reading')
    expect(toolActivity('Bash')).toBe('terminal')
    expect(toolActivity('exec_command')).toBe('terminal')
    expect(toolActivity('mcp__playwright__browser_click')).toBe('browser')
    expect(toolActivity('browser_file_upload')).toBe('browser')
    expect(toolActivity('Skill')).toBe('writing')
    expect(toolActivity('Task')).toBe('thinking')
  })
})

describe('buildScene', () => {
  // Layout da partitura "Fluxo do chamado"
  const nodes = [
    term('dev', 0, 100),
    term('qa', 660, 100),
    term('entrega', 1320, 100),
    term('doc', 1980, 100),
    note('chamado', 'chamado-atual.md', 160, 580),
    note('relatorio', 'relatorio-qa.md', 800, 580),
    term('outro-floor', 0, 0, 'f1')
  ]
  const edges = [edge('e1', 'dev', 'qa'), edge('e2', 'qa', 'dev'), edge('e3', 'dev', 'chamado'), edge('e4', 'qa', 'relatorio'), edge('e5', 'chamado', 'relatorio')]

  it('mesas e quadros nas posições proporcionais do canvas (só o floor ativo)', () => {
    const s = buildScene(nodes, edges, null)
    expect(s.desks.map((d) => d.id)).toEqual(['dev', 'qa', 'entrega', 'doc'])
    expect(s.boards.map((b) => b.file)).toEqual(['chamado-atual.md', 'relatorio-qa.md'])
    const dev = s.desks[0]!
    const qa = s.desks[1]!
    expect(dev.y).toBe(OFFICE_GEOMETRY.top)
    expect(qa.y).toBe(dev.y)
    expect(qa.x - dev.x).toBe(Math.round(660 * OFFICE_GEOMETRY.scaleX))
    // O quadro fica abaixo da mesa com espaço para cadeira e etiqueta (topo do quadro abaixo do assento).
    expect(s.boards[0]!.y - 56).toBeGreaterThan(dev.y + 20)
    expect(s.width).toBeGreaterThanOrEqual(OFFICE_GEOMETRY.minWidth)
    expect(buildScene(nodes, edges, 'f1').desks.map((d) => d.id)).toEqual(['outro-floor'])
  })

  it('conexões viram tapetes (terminais) e passarelas (notas); nota-nota e duplicadas ficam de fora', () => {
    const s = buildScene(nodes, edges, null)
    expect(s.edges.map((e) => [e.a, e.b, e.note])).toEqual([
      ['dev', 'qa', false],
      ['dev', 'chamado', true],
      ['qa', 'relatorio', true]
    ])
    const r = routeBetween(s, 'qa', 'dev')!
    expect(r[0]).toEqual({ x: s.desks[1]!.x, y: s.desks[1]!.y + OFFICE_GEOMETRY.deskDoor })
    expect(r[r.length - 1]).toEqual({ x: s.desks[0]!.x, y: s.desks[0]!.y + OFFICE_GEOMETRY.deskDoor })
    expect(routeBetween(s, 'qa', 'doc')).toBeNull()
  })

  it('passarela chega à frente do quadro sem passar por trás dele', () => {
    const cases = [
      buildScene(nodes, edges, null),
      // mesa logo acima do quadro e mesa abaixo dele
      buildScene([term('a', 0, 100), note('q', 'q.md', 100, 580), term('b', 100, 1100)], [edge('e1', 'a', 'q'), edge('e2', 'q', 'b')], null),
      // layout do print: entrega acima do relatório e ligada à nota do chamado, mais à esquerda
      buildScene(
        [term('dev', 0, 1100), term('qa', 1700, 100), term('entrega', 2700, 100), term('doc', 3400, 100), note('n1', 'chamado-atual.md', 1400, 2400), note('n2', 'relatorio-qa.md', 2700, 2600)],
        [edge('e1', 'dev', 'n1'), edge('e2', 'qa', 'n2'), edge('e3', 'entrega', 'n1'), edge('e4', 'doc', 'n2')],
        null
      )
    ]
    for (const s of cases) {
      for (const e of s.edges.filter((x) => x.note)) {
        const board = s.boards.find((b) => b.id === e.a || b.id === e.b)!
        const last = board.id === e.b ? e.path[e.path.length - 1]! : e.path[0]!
        expect(last).toEqual({ x: board.x, y: board.y + OFFICE_GEOMETRY.boardDoor })
        // Nenhum trecho passa por dentro de um quadro (painel, pernas e etiqueta), nem do próprio nem dos outros.
        for (const r of s.boards.map(boardRect)) {
          for (let i = 0; i < e.path.length - 1; i++) {
            const p = e.path[i]!
            const q = e.path[i + 1]!
            const crosses =
              p.x === q.x
                ? p.x > r.x0 && p.x < r.x1 && Math.max(p.y, q.y) > r.y0 && Math.min(p.y, q.y) < r.y1
                : p.y > r.y0 && p.y < r.y1 && Math.max(p.x, q.x) > r.x0 && Math.min(p.x, q.x) < r.x1
            expect(crosses, `${e.a}→${e.b} trecho ${i}`).toBe(false)
          }
        }
      }
    }
  })

  it('arquivo de gavetas: sempre no canto direito, sem encostar em mesa ou quadro', () => {
    for (const view of [undefined, { w: 1920, h: 900 }, { w: 700, h: 900 }]) {
      const s = buildScene(nodes, edges, null, view)
      const a = s.archive!
      expect(s.width - a.x).toBeLessThanOrEqual(40)
      for (const d of s.desks) expect(a.x - 16).toBeGreaterThan(d.x + 34)
      for (const b of s.boards) expect(a.x - 16).toBeGreaterThan(b.x + 33)
      expect(a.y).toBe(OFFICE_GEOMETRY.archiveBaseY)
    }
    expect(buildScene([], [], null).archive).toBeNull()
  })

  it('caminho da mesa até o arquivo e de volta', () => {
    const s = buildScene(nodes, edges, null)
    const r = archiveRoute(s, 'qa')!
    expect(r[0]).toEqual({ x: s.desks[1]!.x, y: s.desks[1]!.y + OFFICE_GEOMETRY.deskDoor })
    expect(r[r.length - 1]).toEqual({ x: s.archive!.x, y: s.archive!.y + OFFICE_GEOMETRY.archiveDoor })
    for (let i = 1; i < r.length; i++) expect(r[i]!.x === r[i - 1]!.x || r[i]!.y === r[i - 1]!.y).toBe(true)
    expect(archiveRoute(s, 'chamado')).toBeNull()
  })

  it('reconhece quando o agente usa o histórico de chamados', () => {
    expect(archiveUse('Read', 'C:/proj/.maestrinho/notes/historico/INDICE.md')).toBe('read')
    expect(archiveUse('Grep', '.maestrinho\\notes\\historico')).toBe('read')
    expect(archiveUse('Bash', 'grep -ri "cpf" .maestrinho/notes/historico/')).toBe('read')
    expect(archiveUse('Read', '.maestrinho/notes/projeto.md')).toBe('read')
    expect(archiveUse('Write', '.maestrinho/notes/historico/2026-10-07-123456-triagem.md')).toBe('write')
    expect(archiveUse('exec_command', 'Copy-Item .maestrinho\\notes\\chamado-atual.md .maestrinho\\notes\\historico\\x.md')).toBe('write')
    expect(archiveUse('Read', '.maestrinho/notes/chamado-atual.md')).toBeNull()
    expect(archiveUse('Bash', 'git log --oneline')).toBeNull()
  })

  it('caminho em ângulos retos', () => {
    expect(orthogonalPath({ x: 0, y: 10 }, { x: 50, y: 10 })).toEqual([{ x: 0, y: 10 }, { x: 50, y: 10 }])
    expect(orthogonalPath({ x: 0, y: 10 }, { x: 50, y: 30 })).toEqual([{ x: 0, y: 10 }, { x: 0, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 30 }])
  })

  it('com o tamanho da área, a sala ganha a mesma proporção e o conteúdo fica no centro', () => {
    const base = buildScene(nodes, edges, null)
    const wide = buildScene(nodes, edges, null, { w: 1680, h: 960 })
    expect(wide.width / wide.height).toBeCloseTo(1680 / 960, 1)
    expect(wide.height).toBe(base.height)
    const dx = wide.desks[0]!.x - base.desks[0]!.x
    expect(dx).toBeGreaterThan(0)
    expect(wide.desks[0]!.x - dx).toBe(base.desks[0]!.x)
    expect(wide.width - wide.desks[3]!.x - (base.width - base.desks[3]!.x) - dx).toBeLessThanOrEqual(1)
    expect(wide.edges[0]!.path[0]).toEqual({ x: wide.desks[0]!.x, y: wide.desks[0]!.y + OFFICE_GEOMETRY.deskDoor })

    const tall = buildScene(nodes, edges, null, { w: 600, h: 900 })
    expect(tall.width).toBe(base.width)
    expect(tall.width / tall.height).toBeCloseTo(600 / 900, 1)
    expect(tall.desks[0]!.y).toBeGreaterThan(base.desks[0]!.y)
  })

  it('sem nós: escritório vazio do tamanho mínimo', () => {
    expect(buildScene([], [], null)).toMatchObject({ width: OFFICE_GEOMETRY.minWidth, height: OFFICE_GEOMETRY.minHeight, desks: [] })
  })
})

describe('walkRoute', () => {
  const scene = (desks: { id: string; x: number; y: number }[], edges: OfficeScene['edges'] = []): OfficeScene => ({
    width: 600,
    height: 500,
    desks,
    boards: [],
    edges,
    archive: null
  })

  it('com tapete, usa o tapete', () => {
    const path = [{ x: 100, y: 172 }, { x: 300, y: 172 }]
    const s = scene([{ id: 'a', x: 100, y: 150 }, { id: 'b', x: 300, y: 150 }], [{ a: 'a', b: 'b', note: false, path }])
    expect(walkRoute(s, 'b', 'a')).toEqual(path.slice().reverse())
  })

  it('sem tapete, anda pelo chão entre as saídas das mesas', () => {
    const s = scene([{ id: 'a', x: 100, y: 150 }, { id: 'b', x: 300, y: 150 }])
    expect(walkRoute(s, 'a', 'b')).toEqual([{ x: 100, y: 172 }, { x: 300, y: 172 }])
  })

  it('desvia de uma mesa no meio do caminho', () => {
    const s = scene([{ id: 'a', x: 100, y: 150 }, { id: 'b', x: 300, y: 390 }, { id: 'c', x: 200, y: 300 }])
    expect(walkRoute(s, 'a', 'b')).toEqual([{ x: 100, y: 172 }, { x: 300, y: 172 }, { x: 300, y: 412 }])
  })

  it('não anda até si mesmo nem até quem não está na sala', () => {
    const s = scene([{ id: 'a', x: 100, y: 150 }])
    expect(walkRoute(s, 'a', 'a')).toBeNull()
    expect(walkRoute(s, 'a', 'fantasma')).toBeNull()
  })
})

describe('ajudantes no escritório', () => {
  it('visual de estagiário: sempre de boné, o mesmo para a mesma semente', () => {
    expect(helperLook('toolu_A')).toEqual(helperLook('toolu_A'))
    expect(helperLook('toolu_A').cap).toBe(true)
    expect(LookSchema.parse(helperLook('toolu_B'))).toBeTruthy()
  })

  it('ferramenta mais recente no histórico do ajudante', () => {
    const tail = [
      JSON.stringify({ message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Grep', input: {} }] } }),
      JSON.stringify({ message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Read', input: {} }] } })
    ].join('\n')
    expect(lastToolName(tail)).toBe('Read')
    expect(lastToolName('sem ferramentas')).toBeNull()
  })
})

describe('monitores na mesa', () => {
  const rows = (n: number): number => new Set(monitorLayout(n).map((m) => m.y)).size

  it('de 1 a 6 monitores, todos dentro da largura da mesa', () => {
    for (let n = 1; n <= 6; n++) {
      const list = monitorLayout(n)
      expect(list).toHaveLength(n)
      for (const m of list) {
        expect(m.x).toBeGreaterThanOrEqual(-32)
        expect(m.x + m.w).toBeLessThanOrEqual(32)
        expect(m.y + m.h).toBeLessThanOrEqual(0)
      }
    }
  })

  it('até 3 numa fileira; de 4 a 6, os que passam de 3 ficam numa fileira em cima', () => {
    expect([1, 2, 3, 4, 5, 6].map(rows)).toEqual([1, 1, 1, 2, 2, 2])
    const four = monitorLayout(4)
    expect(four.filter((m) => m.y < -15)).toHaveLength(1)
    expect(monitorLayout(6).filter((m) => m.y < -15)).toHaveLength(3)
  })

  it('valores fora do intervalo viram 1 ou 6; o principal é o do meio embaixo', () => {
    expect(monitorLayout(0)).toHaveLength(1)
    expect(monitorLayout(9)).toHaveLength(6)
    expect(mainMonitor(1)).toBe(0)
    expect(mainMonitor(3)).toBe(1)
    expect(monitorLayout(6)[mainMonitor(6)]).toMatchObject({ x: -10, y: -15 })
  })
})
