import { describe, expect, it } from 'vitest'
import { agentFamily, effectiveModelEffort, fillArgs, fitEffort, sessionSlug, sessionTitle } from './agentModels'

describe('agentFamily', () => {
  it('vem do modo de aviso, da retomada de sessão ou do nome do comando', () => {
    expect(agentFamily({ agentEvents: 'claude', sessionStore: 'none', command: 'x' })).toBe('claude')
    expect(agentFamily({ agentEvents: 'none', sessionStore: 'codex', command: 'x' })).toBe('codex')
    expect(agentFamily({ sessionStore: 'none', command: 'C:\\npm\\codex.cmd' })).toBe('codex')
    expect(agentFamily({ sessionStore: 'none', command: '/usr/local/bin/claude' })).toBe('claude')
    expect(agentFamily({ sessionStore: 'none', command: 'pwsh.exe' })).toBeNull()
  })
})

describe('fitEffort', () => {
  it('mantém o esforço aceito e aproxima o que o agente não tem', () => {
    expect(fitEffort('high', 'claude')).toBe('high')
    expect(fitEffort('ultra', 'claude')).toBe('max')
    expect(fitEffort('minimal', 'claude')).toBe('low')
    expect(fitEffort('max', 'codex', ['low', 'medium', 'high', 'xhigh'])).toBe('xhigh')
    expect(fitEffort('qualquer', 'codex')).toBeNull()
  })
})

describe('effectiveModelEffort', () => {
  const role = { agentDefaults: { claude: { model: 'opus', effort: 'high' }, codex: { effort: 'max' } } }

  it('escolha do terminal vence o padrão da função', () => {
    expect(effectiveModelEffort({ model: 'sonnet', effort: 'low' }, role, 'claude')).toEqual({
      model: 'sonnet',
      effort: 'low',
      fromRole: { model: false, effort: false }
    })
  })

  it('sem escolha, vale o padrão da função para aquele tipo de agente', () => {
    expect(effectiveModelEffort({}, role, 'claude')).toEqual({ model: 'opus', effort: 'high', fromRole: { model: true, effort: true } })
    expect(effectiveModelEffort({}, role, 'codex')).toMatchObject({ model: null, effort: 'max', fromRole: { model: false, effort: true } })
  })

  it('sem função nem escolha (ou agente sem tipo), nada é passado', () => {
    expect(effectiveModelEffort({}, undefined, 'claude')).toMatchObject({ model: null, effort: null })
    expect(effectiveModelEffort({}, role, null)).toMatchObject({ model: null, effort: null })
  })

  it('modelo com cara de opção é descartado', () => {
    expect(effectiveModelEffort({ model: '--dangerously-skip-permissions' }, undefined, 'claude').model).toBeNull()
  })
})

describe('nome da sessão', () => {
  it('"{projeto}/{agente}" e a versão em slug para o prefixo do Remote Control', () => {
    expect(sessionTitle('loja-online', 'dev')).toBe('loja-online/dev')
    expect(sessionSlug('Atualização Prev', 'qa.2')).toBe('atualizacao-prev-qa-2')
  })
})

describe('fillArgs', () => {
  it('troca os placeholders; sem o valor, o grupo inteiro fica de fora', () => {
    expect(fillArgs(['--model', '{model}'], { model: 'opus' })).toEqual(['--model', 'opus'])
    expect(fillArgs(['-c', 'model_reasoning_effort={effort}'], { effort: 'high' })).toEqual(['-c', 'model_reasoning_effort=high'])
    expect(fillArgs(['--model', '{model}'], {})).toEqual([])
    expect(fillArgs(undefined, { model: 'x' })).toEqual([])
    expect(fillArgs(['--name', '{title}'], { title: 'P/dev' })).toEqual(['--name', 'P/dev'])
  })
})
