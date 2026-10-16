import { describe, expect, it } from 'vitest'
import {
  BoardError,
  addCard,
  assignmentMessage,
  cardsOf,
  commentCard,
  defaultBoard,
  moveCard,
  parseBoard,
  removeCard,
  resolveCard,
  resolveColumn,
  setColumns,
  updateCard,
  type BoardFile
} from './board'

const NOW = '2026-10-07T10:00:00.000Z'
const LATER = '2026-10-07T11:00:00.000Z'

function withCards(...titles: [string, string?][]): BoardFile {
  let b = defaultBoard()
  for (const [title, ticket] of titles) b = addCard(b, { title, ticket }, 'você', NOW).board
  return b
}

describe('colunas', () => {
  it('quadro padrão segue o fluxo do chamado', () => {
    expect(defaultBoard().columns.map((c) => c.name)).toEqual([
      'A fazer',
      'Arquitetura',
      'Desenvolvimento',
      'QA',
      'Sua validação',
      'Entrega',
      'Code review',
      'Documentação',
      'Concluído'
    ])
  })

  it('acha a coluna por id, nome sem acento/maiúsculas ou começo único do nome', () => {
    const b = defaultBoard()
    expect(resolveColumn(b, 'qa').id).toBe('qa')
    expect(resolveColumn(b, 'sua validacao').id).toBe('validacao')
    expect(resolveColumn(b, 'DOCUMENTAÇÃO').id).toBe('doc')
    expect(resolveColumn(b, 'desenv').id).toBe('dev')
    expect(resolveColumn(b, 'concl').id).toBe('concluido')
    expect(resolveColumn(b, 'code review').id).toBe('code-review')
  })

  it('coluna inexistente: erro que lista as colunas', () => {
    expect(() => resolveColumn(defaultBoard(), 'homologação')).toThrow(/Colunas: "A fazer" \(a-fazer\)/)
  })

  it('setColumns: excluir coluna leva os cartões para a primeira; rejeita repetidas e lista vazia', () => {
    let b = addCard(defaultBoard(), { title: 'Filtro CPF', column: 'qa' }, 'você', NOW).board
    b = setColumns(b, [
      { id: 'backlog', name: 'Backlog', color: '' },
      { id: 'dev', name: 'Dev', color: '' }
    ])
    expect(b.cards[0]!.column).toBe('backlog')
    expect(() => setColumns(b, [])).toThrow(BoardError)
    expect(() => setColumns(b, [{ id: 'a', name: 'A', color: '' }, { id: 'a', name: 'B', color: '' }])).toThrow(/repetida/)
  })
})

describe('cartões', () => {
  it('addCard numera em sequência, vai para a primeira coluna e registra quem criou', () => {
    const { board, card } = addCard(defaultBoard(), { title: 'Triagem de documentos', ticket: '123456' }, 'dev', NOW)
    expect(card).toMatchObject({ seq: 1, column: 'a-fazer', ticket: '123456', createdBy: 'dev' })
    expect(card.log[0]).toEqual({ at: NOW, by: 'dev', text: 'criou em "A fazer"' })
    const second = addCard(board, { title: 'Outro', column: 'dev' }, 'você', NOW)
    expect(second.card).toMatchObject({ seq: 2, column: 'dev' })
    expect(second.board.nextSeq).toBe(3)
  })

  it('não duplica chamado em andamento; concluído pode voltar como cartão novo', () => {
    let b = addCard(defaultBoard(), { title: 'A', ticket: '100' }, 'você', NOW).board
    expect(() => addCard(b, { title: 'B', ticket: '100' }, 'dev', NOW)).toThrow(/Já existe o cartão #1 para o chamado 100/)
    b = moveCard(b, '#1', 'concluido', 'entrega', NOW).board
    expect(addCard(b, { title: 'B', ticket: '100' }, 'dev', NOW).card.seq).toBe(2)
  })

  it('nota inválida é recusada com mensagem clara', () => {
    expect(() => addCard(defaultBoard(), { title: 'x', note: '../fora.md' }, 'dev', NOW)).toThrow(/Nota inválida/)
    expect(addCard(defaultBoard(), { title: 'x', note: 'historico/2026-10-07-1.md' }, 'dev', NOW).card.note).toBe('historico/2026-10-07-1.md')
  })

  it('resolveCard: #número, número do chamado, id e parte única do título', () => {
    const b = withCards(['Triagem de documentos', '123456'], ['Filtro de CPF na tela de segurados', '12'], ['Relatório mensal'])
    expect(resolveCard(b, '#2').title).toMatch(/Filtro/)
    expect(resolveCard(b, '123456').seq).toBe(1)
    // "12" é o número de um chamado: vale o chamado (o cartão #12 não existe).
    expect(resolveCard(b, '12').seq).toBe(2)
    expect(resolveCard(b, '3').title).toBe('Relatório mensal')
    expect(resolveCard(b, 'segurados').seq).toBe(2)
    expect(resolveCard(b, b.cards[2]!.id).seq).toBe(3)
    expect(() => resolveCard(b, 'nada disso')).toThrow(/não encontrado/)
    expect(() => resolveCard(b, 'r')).toThrow(/não encontrado/)
  })

  it('título ambíguo pede o número do cartão', () => {
    const b = withCards(['Ajuste na tela A'], ['Ajuste na tela B'])
    expect(() => resolveCard(b, 'ajuste')).toThrow(/mais de um cartão: #1 "Ajuste na tela A", #2/)
  })

  it('moveCard registra a mudança de coluna e o comentário; posição dentro da coluna', () => {
    let b = withCards(['A'], ['B'], ['C'])
    b = moveCard(b, '#1', 'qa', 'qa', LATER, { comment: 'rodada 1 aprovada' }).board
    const a = b.cards.find((c) => c.seq === 1)!
    expect(a.column).toBe('qa')
    expect(a.updatedAt).toBe(LATER)
    expect(a.log.slice(-2).map((l) => l.text)).toEqual(['moveu de "A fazer" para "QA"', 'rodada 1 aprovada'])
    // Insere B antes de A na coluna QA.
    b = moveCard(b, '#2', 'qa', 'você', LATER, { index: 0 }).board
    expect(cardsOf(b, 'qa').map((c) => c.title)).toEqual(['B', 'A'])
    // C entre B e A.
    b = moveCard(b, '#3', 'qa', 'você', LATER, { index: 1 }).board
    expect(cardsOf(b, 'qa').map((c) => c.title)).toEqual(['B', 'C', 'A'])
  })

  it('updateCard registra só o que mudou; sem mudança devolve o mesmo quadro', () => {
    const b = withCards(['A'])
    const same = updateCard(b, '#1', { title: 'A' }, 'dev', LATER)
    expect(same.board).toBe(b)
    const { card } = updateCard(b, '#1', { ticket: '42', assignee: 'dev', note: 'chamado-atual.md' }, 'dev', LATER)
    expect(card).toMatchObject({ ticket: '42', assignee: 'dev', note: 'chamado-atual.md', updatedAt: LATER })
    expect(card.log.at(-1)!.text).toBe('alterou chamado, nota chamado-atual.md, responsável dev')
    const cleared = updateCard({ ...b, cards: [card] }, '#1', { note: '' }, 'dev', LATER).card
    expect(cleared.note).toBeUndefined()
  })

  it('commentCard junta espaços e recusa comentário vazio; histórico guarda só os últimos 60', () => {
    let b = withCards(['A'])
    expect(() => commentCard(b, '#1', '   ', 'qa', LATER)).toThrow(/vazio/)
    for (let i = 0; i < 70; i++) b = commentCard(b, '#1', `nota\n${i}`, 'qa', LATER).board
    const log = b.cards[0]!.log
    expect(log).toHaveLength(60)
    expect(log.at(-1)!.text).toBe('nota 69')
  })

  it('removeCard tira o cartão', () => {
    const b = withCards(['A'], ['B'])
    expect(removeCard(b, b.cards[0]!.id).cards.map((c) => c.title)).toEqual(['B'])
  })
})

describe('parseBoard', () => {
  it('arquivo inválido ou ausente vira o quadro padrão', () => {
    expect(parseBoard(undefined).columns).toHaveLength(9)
    expect(parseBoard({ version: 2 }).cards).toEqual([])
  })

  it('cartões em coluna inexistente vão para a primeira; nextSeq nunca repete número', () => {
    const b = withCards(['A'], ['B'])
    const raw = { ...b, nextSeq: 1, cards: b.cards.map((c) => ({ ...c, column: 'sumiu' })) }
    const parsed = parseBoard(JSON.parse(JSON.stringify(raw)))
    expect(parsed.cards.every((c) => c.column === 'a-fazer')).toBe(true)
    expect(parsed.nextSeq).toBe(3)
  })
})

describe('assignmentMessage', () => {
  it('diz o cartão, o chamado, a nota e como mover', () => {
    let b = defaultBoard()
    const r = addCard(b, { title: 'Triagem de documentos', ticket: '123456', column: 'dev', note: 'chamado-atual.md', description: 'Validar documentos.' }, 'você', NOW)
    b = r.board
    const text = assignmentMessage(b, r.card, 'orq')
    expect(text).toContain('cartão #1 "Triagem de documentos" (chamado 123456, coluna "Desenvolvimento")')
    expect(text).toContain('Validar documentos.')
    expect(text).toContain('.maestrinho/notes/chamado-atual.md')
    expect(text).toContain('orq board move 123456 <coluna> (colunas: a-fazer, arquitetura, dev, qa, validacao, entrega, code-review, doc, concluido)')
  })
})
