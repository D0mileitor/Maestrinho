import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '@shared/activity'
import { ActivityService } from './ActivityService'

describe('linha do tempo', () => {
  it('numera, avisa a interface, filtra por instante e guarda só os 1000 mais novos', () => {
    const sent: ActivityEvent[] = []
    const svc = new ActivityService((e) => sent.push(e))
    svc.add({ kind: 'done', dir: '/ws', who: 'construtor' }, 100)
    svc.add({ kind: 'message', dir: '/ws', who: 'revisor', to: 'construtor', mood: 'complaint' }, 200)
    expect(sent.map((e) => e.id)).toEqual([1, 2])
    expect(svc.list(150).map((e) => e.who)).toEqual(['revisor'])
    for (let i = 0; i < 1005; i++) svc.add({ kind: 'routine', dir: '/ws', who: `r${i}` }, 300 + i)
    const all = svc.list()
    expect(all).toHaveLength(1000)
    expect(all[0]!.who).toBe('r5')
  })
})
