import { describe, expect, it } from 'vitest'
import { COMMANDS } from './commands'
import { HELP_TOPICS, helpText, isHelpTopic } from './help'

const ALL_TEXTS = [undefined, ...HELP_TOPICS].map((topic) => ({ topic: topic ?? 'geral', text: helpText(topic) }))

describe('textos de ajuda', () => {
  it('terminadores de heredoc ficam no início da linha (agentes copiam os exemplos como estão)', () => {
    for (const { topic, text } of ALL_TEXTS) {
      for (const line of text.split('\n')) {
        expect(line, `${topic}: ${line}`).not.toMatch(/^\s+EOF\s*$/)
        expect(line, `${topic}: ${line}`).not.toMatch(/^\s+'@/)
      }
    }
  })

  it('cada heredoc aberto é fechado', () => {
    for (const { topic, text } of ALL_TEXTS) {
      const opened = (text.match(/<<'EOF'/g) ?? []).length
      const closed = text.split('\n').filter((l) => l === 'EOF').length
      expect(closed, topic).toBe(opened)
    }
  })

  it('linhas de até 100 colunas e sem espaço no fim', () => {
    for (const { topic, text } of ALL_TEXTS) {
      for (const line of text.split('\n')) {
        expect([...line].length, `${topic}: ${line}`).toBeLessThanOrEqual(100)
        expect(line, `${topic}: ${line}`).toBe(line.trimEnd())
      }
    }
  })

  it('todo comando tem um tópico de ajuda', () => {
    for (const def of COMMANDS.values()) expect(isHelpTopic(def.topic), def.name).toBe(true)
    expect(isHelpTopic('xyz')).toBe(false)
  })

  it('a ajuda geral documenta os códigos de saída e o envio de texto longo', () => {
    const general = helpText()
    for (const code of ['0 ok', '2 uso incorreto', '3 sem permissão', '5 tempo esgotado', '7 conflito/limite']) {
      expect(general).toContain(code)
    }
    expect(general).toContain("orq send revisor - <<'EOF'")
    expect(general).toContain('Get-Content arq.md | orq send revisor -')
  })
})
