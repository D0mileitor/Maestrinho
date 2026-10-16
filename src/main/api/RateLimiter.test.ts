import { describe, expect, it } from 'vitest'
import { RateLimiter } from './RateLimiter'

describe('RateLimiter (janela deslizante)', () => {
  it('padrão: 30 eventos por 60 s', () => {
    const rl = new RateLimiter()
    expect(rl.limit).toBe(30)
    expect(rl.windowMs).toBe(60_000)
    for (let i = 0; i < 30; i++) expect(rl.hit('a→b', 1000 + i).allowed).toBe(true)
    const denied = rl.hit('a→b', 1030)
    expect(denied.allowed).toBe(false)
    // A vaga reabre quando o evento mais antigo (t=1000) sai da janela.
    expect(denied.retryAfterMs).toBe(1000 + 60_000 - 1030)
  })

  it('a janela desliza: eventos antigos liberam vagas uma a uma', () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 1000 })
    expect(rl.hit('k', 0).allowed).toBe(true)
    expect(rl.hit('k', 400).allowed).toBe(true)
    expect(rl.hit('k', 800).allowed).toBe(true)
    expect(rl.hit('k', 900)).toEqual({ allowed: false, retryAfterMs: 100, remaining: 0 })
    expect(rl.hit('k', 1000).allowed).toBe(true) // t=0 venceu
    expect(rl.hit('k', 1001).allowed).toBe(false)
    expect(rl.hit('k', 1400).allowed).toBe(true) // t=400 venceu
  })

  it('recusas não contam como eventos', () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1000 })
    expect(rl.hit('k', 0).allowed).toBe(true)
    for (let t = 1; t < 1000; t += 50) expect(rl.hit('k', t).allowed).toBe(false)
    expect(rl.hit('k', 1000).allowed).toBe(true)
  })

  it('chaves são independentes', () => {
    const rl = new RateLimiter({ limit: 2, windowMs: 1000 })
    rl.hit('a', 0)
    rl.hit('a', 1)
    expect(rl.hit('a', 2).allowed).toBe(false)
    expect(rl.hit('b', 2).allowed).toBe(true)
  })

  it('check consulta sem registrar e remaining diminui', () => {
    const rl = new RateLimiter({ limit: 2, windowMs: 1000 })
    expect(rl.check('k', 0)).toEqual({ allowed: true, retryAfterMs: 0, remaining: 2 })
    expect(rl.hit('k', 0).remaining).toBe(1)
    expect(rl.check('k', 1).remaining).toBe(1)
    expect(rl.hit('k', 1).remaining).toBe(0)
    expect(rl.check('k', 2).allowed).toBe(false)
  })

  it('descarta chaves vencidas (memória limitada) e reset limpa', () => {
    const rl = new RateLimiter({ limit: 5, windowMs: 100 })
    for (let i = 0; i < 50; i++) rl.hit(`k${i}`, 0)
    expect(rl.size).toBe(50)
    rl.sweep(500)
    expect(rl.size).toBe(0)
    rl.hit('x', 0)
    rl.reset('x')
    expect(rl.check('x', 1).remaining).toBe(5)
    rl.hit('y', 0)
    rl.reset()
    expect(rl.size).toBe(0)
  })

  it('usa o relógio injetado', () => {
    let now = 10_000
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, now: () => now })
    expect(rl.hit('k').allowed).toBe(true)
    expect(rl.hit('k').allowed).toBe(false)
    now += 1000
    expect(rl.hit('k').allowed).toBe(true)
  })

  it('relógio que volta no tempo não gera espera maior que a janela', () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1000 })
    rl.hit('k', 50_000)
    const d = rl.hit('k', 10_000)
    expect(d.allowed).toBe(false)
    expect(d.retryAfterMs).toBeLessThanOrEqual(1000)
  })
})
