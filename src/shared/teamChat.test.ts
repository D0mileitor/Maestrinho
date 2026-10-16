import { describe, expect, it } from 'vitest'
import type { ChatItem } from './chat'
import { mentionQuery, mergeFeeds, parseMentions } from './teamChat'

const user = (key: string, at: string, text: string): ChatItem => ({ kind: 'user', key, at, text, images: [] })
const reply = (key: string, at: string, text: string): ChatItem => ({ kind: 'assistant', key, at, text })
const orq = (key: string, at: string, from: string, text: string): ChatItem => ({ kind: 'orq', key, at, from, text })
const tool = (key: string, at: string): ChatItem => ({ kind: 'tool', key, at, name: 'Bash', title: 'x', done: true })

describe('mergeFeeds', () => {
  it('junta as conversas em ordem de horário, sem ferramentas', () => {
    const merged = mergeFeeds([
      { terminalId: 'arq', items: [user('u1', '2026-10-07T10:00:00Z', 'nova demanda'), tool('t1', '2026-10-07T10:00:30Z'), reply('a1', '2026-10-07T10:01:00Z', 'plano pronto')] },
      { terminalId: 'dev', items: [orq('o1', '2026-10-07T10:02:00Z', 'arq', 'IMPLEMENTAR'), reply('a2', '2026-10-07T10:05:00Z', 'feito')] }
    ])
    expect(merged.map((e) => `${e.terminalId}:${e.kind}:${e.text}`)).toEqual([
      'arq:user:nova demanda',
      'arq:assistant:plano pronto',
      'dev:orq:IMPLEMENTAR',
      'dev:assistant:feito'
    ])
    expect(merged[2]!.from).toBe('arq')
    expect(new Set(merged.map((e) => e.key)).size).toBe(4)
  })

  it('item sem horário herda o anterior da mesma conversa; mantém só os últimos', () => {
    const merged = mergeFeeds([{ terminalId: 'a', items: [reply('1', '2026-10-07T10:00:00Z', 'x'), reply('2', '', 'y')] }, { terminalId: 'b', items: [reply('3', '2026-10-07T09:00:00Z', 'z')] }], 2)
    expect(merged.map((e) => e.text)).toEqual(['x', 'y'])
  })

  it('resposta de ajudante entra (com quem respondeu); o pedido não', () => {
    const call: ChatItem = { kind: 'helper', key: 'toolu_1', at: '2026-10-07T10:00:00Z', role: 'call', seed: 'toolu_1', title: 'Mapear', status: 'done' }
    const report: ChatItem = { kind: 'helper', key: 'relatorio:a1', at: '2026-10-07T10:07:00Z', role: 'report', seed: 'toolu_1', title: 'Mapear', type: 'Explore', status: 'done', report: '## Achados' }
    expect(mergeFeeds([{ terminalId: 'arq', items: [call, report] }])).toEqual([
      { key: 'arq:relatorio:a1', at: '2026-10-07T10:07:00Z', terminalId: 'arq', kind: 'helper', text: '## Achados', helper: { seed: 'toolu_1', title: 'Mapear', type: 'Explore', status: 'done' } }
    ])
  })

  it('ignora mensagens vazias', () => {
    expect(mergeFeeds([{ terminalId: 'a', items: [reply('1', '2026-10-07T10:00:00Z', '   ')] }])).toEqual([])
  })
})

describe('parseMentions', () => {
  const names = ['arquiteto', 'dev', 'qa', 'code-review']

  it('menções do começo viram destinatários e saem do texto', () => {
    expect(parseMentions('@dev @QA rodem os testes', names)).toEqual({ targets: ['dev', 'qa'], body: 'rodem os testes' })
    expect(parseMentions('@code-review, revise o PR', names)).toEqual({ targets: ['code-review'], body: 'revise o PR' })
  })

  it('menção no meio do texto também é destinatário, e o texto fica inteiro', () => {
    expect(parseMentions('pede pro @qa testar a busca', names)).toEqual({ targets: ['qa'], body: 'pede pro @qa testar a busca' })
  })

  it('sem menção conhecida: destinatário fica para o último usado', () => {
    expect(parseMentions('obrigado!', names)).toEqual({ targets: [], body: 'obrigado!' })
    expect(parseMentions('@fulano oi', names)).toEqual({ targets: [], body: '@fulano oi' })
    expect(parseMentions('mande para email@empresa.com', names).targets).toEqual([])
  })
})

describe('mentionQuery', () => {
  it('reconhece a menção sendo digitada no fim', () => {
    expect(mentionQuery('@de')).toBe('de')
    expect(mentionQuery('olá @')).toBe('')
    expect(mentionQuery('email@x')).toBeNull()
    expect(mentionQuery('@dev já foi ')).toBeNull()
  })
})
