import { describe, expect, it } from 'vitest'
import { builtinPresets } from './defaults'

describe('presets de fábrica', () => {
  it('Aider: o padrão de ociosidade reconhece os prompts dele e não texto comum', () => {
    const aider = builtinPresets().find((p) => p.id === 'aider')!
    const re = new RegExp(aider.idlePatterns[0]!)
    for (const prompt of ['> ', 'ask> ', 'architect multi> ', 'multi>']) expect(re.test(prompt)).toBe(true)
    for (const text of ['olá> mundo', 'Tokens: 2k sent', '>> ']) expect(re.test(text)).toBe(false)
  })

  it('Copilot retoma pelo id da sessão e deixa o orq pré-autorizado; Gemini manda as instruções na 1ª mensagem', () => {
    const presets = builtinPresets()
    const copilot = presets.find((p) => p.id === 'copilot')!
    expect(copilot.sessionArgs).toEqual(['--session-id', '{sessionId}'])
    expect(copilot.args).toEqual(['--allow-tool=shell(orq:*)'])
    expect(presets.find((p) => p.id === 'gemini')!.instructionsTarget).toBe('first-message')
  })
})
