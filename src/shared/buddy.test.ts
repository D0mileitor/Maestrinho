import { describe, expect, it } from 'vitest'
import { BUDDY_CARD_W, BUDDY_MAX, BuddyActionSchema, buddySlotX, clipBuddyText, expireCalls, lastOutputLine, leftNeighbor, mergeCalls, nextExpiry, pauseCountdown, plainSummary, restartCountdown, type BuddyCall } from './buddy'
import { defaultLook } from './office'

const call = (id: string, at: number, text = 'ok'): BuddyCall => ({
  terminalId: id,
  name: id,
  roleName: '',
  roleColor: '#5b8def',
  look: defaultLook(id),
  kind: 'done',
  headline: 'Terminei!',
  text,
  at
})

describe('fila de avisos do personagem', () => {
  it('novo primeiro, mesmo terminal substitui, no máximo três', () => {
    let list: BuddyCall[] = []
    list = mergeCalls(list, call('dev', 1))
    list = mergeCalls(list, call('qa', 2))
    list = mergeCalls(list, call('dev', 3, 'de novo'))
    expect(list.map((c) => c.terminalId)).toEqual(['dev', 'qa'])
    expect(list[0]!.text).toBe('de novo')
    for (const id of ['a', 'b', 'c']) list = mergeCalls(list, call(id, 4))
    expect(list).toHaveLength(BUDDY_MAX)
    expect(list.map((c) => c.terminalId)).toEqual(['c', 'b', 'a'])
  })

  it('o minuto só conta com a tela desbloqueada', () => {
    const counting = (id: string, since?: number): BuddyCall => ({ ...call(id, 0), since })
    // bloqueado: chegou sem contagem e fica até desbloquear
    expect(expireCalls([counting('a', undefined)], 999_999, 60_000)).toHaveLength(1)
    expect(nextExpiry([counting('a', undefined)], 60_000)).toBeNull()
    // desbloqueou: o minuto de todos começa agora
    const unlocked = restartCountdown([counting('a', undefined), counting('b', 5_000)], 100_000)
    expect(unlocked.map((c) => c.since)).toEqual([100_000, 100_000])
    expect(nextExpiry(unlocked, 60_000)).toBe(160_000)
    expect(expireCalls(unlocked, 159_999, 60_000)).toHaveLength(2)
    expect(expireCalls(unlocked, 160_000, 60_000)).toHaveLength(0)
    // bloqueou de novo no meio: para de contar
    const paused = pauseCountdown(unlocked)
    expect(paused.every((c) => c.since === undefined)).toBe(true)
    expect(expireCalls(paused, 10_000_000, 60_000)).toHaveLength(2)
  })

  it('avisos antigos expiram; altura da janela acompanha a quantidade', () => {
    expect(expireCalls([{ ...call('a', 0), since: 0 }, { ...call('b', 0), since: 9_000 }], 10_000, 5_000).map((c) => c.terminalId)).toEqual(['b'])
    // lado a lado: o mais recente no canto direito, os outros à esquerda dele, sem sobrepor
    const a = buddySlotX(0, 1920)
    const b = buddySlotX(1, 1920)
    expect(a + BUDDY_CARD_W).toBeLessThanOrEqual(1920)
    expect(b + BUDDY_CARD_W).toBeLessThanOrEqual(a)
  })

  it('texto do balão: sem controles, sem quebras, cortado', () => {
    expect(clipBuddyText('linha 1\nlinha\t2\x1b[31m')).toBe('linha 1 linha 2 [31m')
    expect(clipBuddyText('x'.repeat(300))).toHaveLength(220)
  })

  it('resposta em Markdown vira texto corrido no balão', () => {
    const md = '## Pronto\n\nCorrigi o **filtro** em `api.ts` e rodei os testes:\n\n- 12 passaram\n- [relatório](relatorio.md)\n\n```ts\nconst x = 1\n```\n| a | b |\n|---|---|\n| 1 | 2 |'
    expect(plainSummary(md)).toBe('Pronto Corrigi o filtro em api.ts e rodei os testes: 12 passaram relatório a b 1 2')
  })

  it('ao sair, segue pelos monitores da direita para a esquerda, na ordem do Windows', () => {
    // a arrumação desta máquina: DISPLAY2 à esquerda, DISPLAY1 (principal) no meio, DISPLAY3 à direita
    const d2 = { id: 2, x: -1920, y: 0, width: 1920, height: 1080 }
    const d1 = { id: 1, x: 0, y: 0, width: 1920, height: 1080 }
    const d3 = { id: 3, x: 1920, y: 0, width: 1920, height: 1080 }
    const all = [d1, d2, d3]
    expect(leftNeighbor(all, 3)?.id).toBe(1)
    expect(leftNeighbor(all, 1)?.id).toBe(2)
    expect(leftNeighbor(all, 2)).toBeNull()
    // monitor empilhado em cima não é "à esquerda"; com dois candidatos, vale o mais alinhado na vertical
    const top = { id: 4, x: 0, y: -1080, width: 1920, height: 1080 }
    const lowLeft = { id: 5, x: -1280, y: 600, width: 1280, height: 1024 }
    const sameRowLeft = { id: 6, x: -1280, y: 0, width: 1280, height: 1024 }
    expect(leftNeighbor([d1, top], 1)).toBeNull()
    expect(leftNeighbor([d1, lowLeft, sameRowLeft], 1)?.id).toBe(6)
    expect(leftNeighbor([d1], 99)).toBeNull()
  })

  it('no shell, o balão mostra a última saída, não o prompt nem o comando', () => {
    const ps = 'C:\\Users\\ana\\ws> 1..20 | ForEach-Object { Write-Output "passo $_" }; Write-Output pronto\npasso 19\npasso 20\npronto\nC:\\Users\\ana\\ws>\n\n'
    expect(lastOutputLine(ps)).toBe('pronto')
    expect(lastOutputLine('PS C:\\proj> npm test\n  12 passed\nPS C:\\proj> ')).toBe('12 passed')
    expect(lastOutputLine('ana@srv:~/app$ make\nok: build pronto\nana@srv:~/app$ ')).toBe('ok: build pronto')
    expect(lastOutputLine('C:\\proj> dir\nC:\\proj>')).toBe('')
  })

  it('ações da janela do personagem são validadas', () => {
    expect(BuddyActionSchema.safeParse({ terminalId: 't-1', action: 'open' }).success).toBe(true)
    expect(BuddyActionSchema.safeParse({ terminalId: 't-1', action: 'rm -rf' }).success).toBe(false)
  })
})
