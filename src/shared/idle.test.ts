import { describe, expect, it } from 'vitest'
import { IdleDetector, compileIdlePatterns, type IdleTransition } from './idle'

describe('IdleDetector', () => {
  it('começa ocioso, sem prazo e sem atividade registrada', () => {
    const d = new IdleDetector({ idleMs: 1000 })
    expect(d.state).toBe('idle')
    expect(d.nextDeadline).toBeNull()
    expect(d.lastActivity).toBe(Number.NEGATIVE_INFINITY)
    expect(d.tick(1_000_000)).toBeNull()
  })

  it('saída deixa o terminal ocupado e arma o prazo de idleMs', () => {
    const d = new IdleDetector({ idleMs: 1000 })
    expect(d.onOutput(5000)).toEqual({ state: 'busy', at: 5000 })
    expect(d.state).toBe('busy')
    expect(d.nextDeadline).toBe(6000)
    expect(d.lastActivity).toBe(5000)
  })

  it('saídas seguidas mantêm ocupado e renovam o prazo, sem nova transição', () => {
    const d = new IdleDetector({ idleMs: 1000 })
    d.onOutput(5000)
    expect(d.onOutput(5600)).toBeNull()
    expect(d.nextDeadline).toBe(6600)
    expect(d.tick(6000)).toBeNull()
    expect(d.tick(6599)).toBeNull()
    expect(d.tick(6600)?.state).toBe('idle')
  })

  it('fica ocioso após idleMs sem saída; busyMs mede da primeira à última saída', () => {
    const d = new IdleDetector({ idleMs: 1000 })
    d.onOutput(1000)
    d.onOutput(1300)
    d.onOutput(1800)
    expect(d.tick(2799)).toBeNull()
    expect(d.tick(2800)).toEqual({ state: 'idle', at: 2800, busyMs: 800, firstIdle: true, reason: 'timeout' })
    expect(d.state).toBe('idle')
    expect(d.nextDeadline).toBeNull()
    // tick repetido depois de ocioso não gera nova transição
    expect(d.tick(9999)).toBeNull()
  })

  it('tick atrasado informa o instante do tick em `at` (busyMs não muda)', () => {
    const d = new IdleDetector({ idleMs: 100 })
    d.onOutput(0)
    d.onOutput(40)
    const t = d.tick(5000)
    expect(t?.at).toBe(5000)
    expect(t?.busyMs).toBe(40)
  })

  it('firstIdle só é verdadeiro na primeira ociosidade; cada ciclo mede seu próprio busyMs', () => {
    const d = new IdleDetector({ idleMs: 100 })
    d.onOutput(0)
    d.onOutput(50)
    expect(d.tick(150)).toMatchObject({ firstIdle: true, busyMs: 50 })

    expect(d.onOutput(1000)).toEqual({ state: 'busy', at: 1000 })
    d.onOutput(1300)
    expect(d.tick(1400)).toMatchObject({ state: 'idle', firstIdle: false, busyMs: 300 })

    d.onOutput(2000)
    expect(d.tick(2100)).toMatchObject({ firstIdle: false, busyMs: 0 })
  })

  it('simulação: rajadas com pausas menores que idleMs não encerram o trabalho', () => {
    const d = new IdleDetector({ idleMs: 1000 })
    const transitions: IdleTransition[] = []
    for (let now = 0; now <= 3000; now += 300) {
      const out = d.onOutput(now)
      if (out) transitions.push(out)
      const t = d.tick(now + 250)
      if (t) transitions.push(t)
    }
    expect(transitions).toEqual([{ state: 'busy', at: 0 }])
    expect(d.tick(3999)).toBeNull()
    expect(d.tick(4000)).toMatchObject({ state: 'idle', busyMs: 3000 })
  })

  describe('eco de entrada do usuário', () => {
    it('saída logo após uma tecla (até echoWindowMs, padrão 150 ms) não conta como atividade', () => {
      const d = new IdleDetector({ idleMs: 1000 })
      d.onUserInput(1000)
      expect(d.onOutput(1100)).toBeNull()
      expect(d.onOutput(1150)).toBeNull() // limite inclusivo
      expect(d.state).toBe('idle')
      expect(d.nextDeadline).toBeNull()
      expect(d.lastActivity).toBe(Number.NEGATIVE_INFINITY)
      expect(d.onOutput(1151)).toEqual({ state: 'busy', at: 1151 })
    })

    it('eco enquanto ocupado renova o prazo, mas não altera a última atividade', () => {
      const d = new IdleDetector({ idleMs: 1000 })
      d.onOutput(0)
      d.onUserInput(900)
      expect(d.onOutput(950)).toBeNull()
      expect(d.nextDeadline).toBe(1950)
      expect(d.lastActivity).toBe(0)
      expect(d.tick(1000)).toBeNull()
      expect(d.tick(1950)).toMatchObject({ state: 'idle', busyMs: 0 })
    })

    it('lastUserInput guarda o instante da última tecla (para não intercalar mensagens com a digitação)', () => {
      const d = new IdleDetector({ idleMs: 1000 })
      expect(d.lastUserInput).toBe(Number.NEGATIVE_INFINITY)
      d.onUserInput(120)
      d.onUserInput(450)
      expect(d.lastUserInput).toBe(450)
      // Saída (eco ou não) não altera o registro da digitação.
      d.onOutput(500)
      d.onOutput(2000)
      expect(d.lastUserInput).toBe(450)
    })

    it('echoWindowMs é configurável', () => {
      const d = new IdleDetector({ idleMs: 1000, echoWindowMs: 0 })
      d.onUserInput(10)
      expect(d.onOutput(10)).toBeNull()
      expect(d.onOutput(11)?.state).toBe('busy')
    })
  })

  describe('redimensionamento', () => {
    it('redesenho logo após resize (até resizeQuietMs, padrão 500 ms) não conta como atividade', () => {
      const d = new IdleDetector({ idleMs: 1000 })
      d.onOutput(0)
      d.tick(1000)
      d.onResize(2000)
      expect(d.onOutput(2400)).toBeNull()
      expect(d.onOutput(2500)).toBeNull() // limite inclusivo
      expect(d.state).toBe('idle')
      expect(d.onOutput(2501)).toEqual({ state: 'busy', at: 2501 })
    })

    it('a primeira saída do processo conta como atividade mesmo logo após um resize', () => {
      const d = new IdleDetector({ idleMs: 1000 })
      d.onResize(0)
      expect(d.onOutput(20, true)).toEqual({ state: 'busy', at: 20 })
      expect(d.tick(220)).toMatchObject({ state: 'idle', firstIdle: true, reason: 'pattern' })
    })

    it('resizeQuietMs é configurável e o redesenho mantém vivo um período ocupado', () => {
      const d = new IdleDetector({ idleMs: 1000, resizeQuietMs: 50 })
      d.onOutput(0)
      d.onResize(900)
      expect(d.onOutput(940)).toBeNull()
      expect(d.nextDeadline).toBe(1940)
      expect(d.lastActivity).toBe(0)
      expect(d.onOutput(951)).toBeNull() // fora da janela: atividade real, já ocupado
      expect(d.lastActivity).toBe(951)
    })
  })

  describe('padrões de ociosidade', () => {
    it('padrão casado declara ociosidade após a carência curta (patternGraceMs, padrão 200 ms)', () => {
      const d = new IdleDetector({ idleMs: 10_000 })
      expect(d.onOutput(1000, true)).toEqual({ state: 'busy', at: 1000 })
      expect(d.nextDeadline).toBe(1200)
      expect(d.tick(1199)).toBeNull()
      expect(d.tick(1200)).toEqual({ state: 'idle', at: 1200, busyMs: 0, firstIdle: true, reason: 'pattern' })
    })

    it('saída sem padrão depois do padrão volta ao prazo normal (motivo timeout)', () => {
      const d = new IdleDetector({ idleMs: 10_000 })
      d.onOutput(1000, true)
      d.onOutput(1100, false)
      expect(d.nextDeadline).toBe(11_100)
      expect(d.tick(1300)).toBeNull()
      expect(d.tick(11_100)?.reason).toBe('timeout')
    })

    it('nova saída com padrão renova a carência', () => {
      const d = new IdleDetector({ idleMs: 10_000, patternGraceMs: 50 })
      d.onOutput(0, true)
      d.onOutput(40, true)
      expect(d.tick(50)).toBeNull()
      expect(d.tick(90)).toMatchObject({ state: 'idle', reason: 'pattern', busyMs: 40 })
    })
  })

  describe('forceIdle', () => {
    it('encerra o período ocupado imediatamente (ex.: processo terminou)', () => {
      const d = new IdleDetector({ idleMs: 10_000 })
      d.onOutput(100)
      d.onOutput(130)
      expect(d.forceIdle(150)).toEqual({ state: 'idle', at: 150, busyMs: 30, firstIdle: true, reason: 'timeout' })
      expect(d.state).toBe('idle')
      expect(d.nextDeadline).toBeNull()
    })

    it('quando já ocioso não faz nada', () => {
      const d = new IdleDetector({ idleMs: 1000 })
      expect(d.forceIdle(1)).toBeNull()
      d.onOutput(10)
      d.tick(2000)
      expect(d.forceIdle(3000)).toBeNull()
    })

    it('conta como a primeira ociosidade e preserva o motivo armado (padrão)', () => {
      const d = new IdleDetector({ idleMs: 1000 })
      d.onOutput(100, true)
      expect(d.forceIdle(120)).toMatchObject({ firstIdle: true, reason: 'pattern' })
      d.onOutput(500)
      expect(d.forceIdle(600)).toMatchObject({ firstIdle: false, reason: 'timeout' })
    })
  })

  it('idleMs mínimo é 1 ms (valores zero/negativos não desarmam o detector)', () => {
    const zero = new IdleDetector({ idleMs: 0 })
    zero.onOutput(10)
    expect(zero.nextDeadline).toBe(11)
    const negative = new IdleDetector({ idleMs: -50 })
    negative.onOutput(10)
    expect(negative.nextDeadline).toBe(11)
    expect(negative.tick(11)?.state).toBe('idle')
  })
})

describe('compileIdlePatterns', () => {
  it('compila padrões válidos com a flag "u" e sem "g" (test() repetido não guarda estado)', () => {
    const [re] = compileIdlePatterns(['^PS [^>]*>\\s?$'])
    expect(re).toBeInstanceOf(RegExp)
    expect(re!.flags).toBe('u')
    expect(re!.test('PS C:\\Users\\dev> ')).toBe(true)
    expect(re!.test('PS C:\\Users\\dev> ')).toBe(true)
    expect(re!.test('PS C:\\Users\\dev> ls')).toBe(false)
  })

  it('padrões de prompt típicos casam PowerShell e shells POSIX', () => {
    const res = compileIdlePatterns(['^PS [^>]*>\\s?$', '[$#]\\s?$'])
    const matches = (line: string): boolean => res.some((re) => re.test(line))
    expect(matches('PS C:\\projeto>')).toBe(true)
    expect(matches('dev@maquina:~/projeto$ ')).toBe(true)
    expect(matches('root@maquina:/# ')).toBe(true)
    expect(matches('compilando 50%')).toBe(false)
  })

  it('ignora padrões vazios ou só com espaços', () => {
    expect(compileIdlePatterns(['', '   ', '\t'])).toEqual([])
  })

  it('ignora regex inválida sem lançar e preserva a ordem das válidas', () => {
    const res = compileIdlePatterns(['(', 'primeiro$', '[a-', '*', 'segundo$'])
    expect(res.map((r) => r.source)).toEqual(['primeiro$', 'segundo$'])
  })

  it('como compila em modo Unicode, aceita \\p{...} e descarta escapes inválidos nesse modo', () => {
    const [letters] = compileIdlePatterns(['^\\p{L}+>$'])
    expect(letters!.test('ação>')).toBe(true)
    // "\-" fora de classe é válido sem "u", mas inválido com "u": é descartado.
    expect(compileIdlePatterns(['\\-'])).toEqual([])
  })

  it('lista vazia devolve lista vazia', () => {
    expect(compileIdlePatterns([])).toEqual([])
  })
})

describe('IdleDetector: aviso do próprio agente (hold/release)', () => {
  it('hold deixa ocupado mesmo sem saída e o silêncio não vira "terminou"', () => {
    const d = new IdleDetector({ idleMs: 1000 })
    expect(d.hold(1000)).toEqual({ state: 'busy', at: 1000 })
    expect(d.isHeld).toBe(true)
    expect(d.nextDeadline).toBeNull()
    d.onOutput(1500)
    expect(d.nextDeadline).toBeNull()
    expect(d.tick(60_000)).toBeNull()
    expect(d.state).toBe('busy')
  })

  it('release idleNow fica ocioso na hora, com a duração desde o início do trabalho', () => {
    const d = new IdleDetector({ idleMs: 1000 })
    d.onOutput(1000)
    d.hold(1200)
    d.onOutput(2000)
    expect(d.release(9000, 'idleNow')).toEqual({ state: 'idle', at: 9000, busyMs: 8000, firstIdle: true, reason: 'signal' })
    expect(d.state).toBe('idle')
    expect(d.isHeld).toBe(false)
  })

  it('release resume volta à detecção pelo silêncio a partir da última saída', () => {
    const d = new IdleDetector({ idleMs: 1000 })
    d.hold(1000)
    d.onOutput(1500)
    expect(d.release(1600, 'resume')).toBeNull()
    expect(d.state).toBe('busy')
    expect(d.nextDeadline).toBe(2600)
    expect(d.tick(2600)?.state).toBe('idle')
  })

  it('release sem estar ocupado não gera transição', () => {
    const d = new IdleDetector({ idleMs: 1000 })
    expect(d.release(500, 'idleNow')).toBeNull()
    expect(d.release(500, 'resume')).toBeNull()
  })

  it('hold quando já ocupado não gera transição nova e cancela o prazo do silêncio', () => {
    const d = new IdleDetector({ idleMs: 1000 })
    d.onOutput(1000)
    expect(d.hold(1100)).toBeNull()
    expect(d.nextDeadline).toBeNull()
  })

  it('o processo encerrar (forceIdle) também solta o hold', () => {
    const d = new IdleDetector({ idleMs: 1000 })
    d.hold(1000)
    expect(d.forceIdle(5000)?.state).toBe('idle')
    expect(d.isHeld).toBe(false)
  })
})
