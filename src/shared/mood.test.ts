import { describe, expect, it } from 'vitest'
import { messageMood } from './mood'

describe('messageMood', () => {
  it('reconhece o veredito do qa', () => {
    expect(messageMood('REPROVADO rodada 2: 3 problema(s) — ver qa-relatorio')).toBe('complaint')
    expect(messageMood('APROVADO rodada 3 — ver qa-relatorio')).toBe('praise')
    expect(messageMood('Resultado: reprovada, a busca por CPF não acha nada')).toBe('complaint')
  })

  it('o veredito que vem primeiro vale', () => {
    expect(messageMood('Não aprovado: o botão salvar some')).toBe('complaint')
    expect(messageMood('Aprovado! Antes estava reprovado por causa do layout')).toBe('praise')
  })

  it('aceita termos comuns de code review', () => {
    expect(messageMood('LGTM, pode subir')).toBe('praise')
    expect(messageMood('Changes requested: faltou o teste')).toBe('complaint')
    expect(messageMood('Mandou bem no refactor')).toBe('praise')
  })

  it('usa sinais fracos de erro só sem negação e sem correção', () => {
    expect(messageMood('O login quebrou depois do seu último commit')).toBe('complaint')
    expect(messageMood('Deu erro ao salvar o cadastro')).toBe('complaint')
    expect(messageMood('Rodei tudo e nada quebrou')).toBeUndefined()
    expect(messageMood('Corrigi o que quebrou no login, pode testar de novo')).toBeUndefined()
  })

  it('mensagens comuns ficam sem tom', () => {
    expect(messageMood('Terminei a tela de busca, pode testar')).toBeUndefined()
    expect(messageMood('')).toBeUndefined()
  })

  it('só olha o começo da mensagem', () => {
    expect(messageMood(`${'relatório '.repeat(60)} reprovado`)).toBeUndefined()
  })
})
