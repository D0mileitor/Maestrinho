import { describe, expect, it } from 'vitest'
import { defaultReviewer, reviewRequest } from './review'

describe('pedir revisão', () => {
  const t = (id: string, name: string, roleId?: string) => ({ id, name, roleId })

  it('revisor sugerido: papel revisor, depois quem não editou, depois o primeiro', () => {
    expect(defaultReviewer([t('1', 'construtor'), t('2', 'qa', 'revisor')], ['qa'])?.id).toBe('2')
    expect(defaultReviewer([t('1', 'construtor'), t('2', 'testador')], ['construtor'])?.id).toBe('2')
    expect(defaultReviewer([t('1', 'construtor')], ['construtor'])?.id).toBe('1')
    expect(defaultReviewer([], [])).toBeNull()
  })

  it('mensagem com repositório, branch, arquivos, autores e o pedido', () => {
    const msg = reviewRequest({
      root: 'C:/proj',
      branch: 'main',
      files: [
        { path: 'src/a.ts', kind: 'M' },
        { path: 'src/b.ts', kind: '?' }
      ],
      kinds: { M: 'modificado', '?': 'novo (fora do git)' },
      editors: ['construtor']
    })
    expect(msg).toContain('repositório C:/proj (branch main)')
    expect(msg).toContain('Arquivos (2), editados por construtor:')
    expect(msg).toContain('- src/b.ts (novo (fora do git))')
    expect(msg).toContain('git -C "C:/proj" diff -- <arquivo>')
    expect(msg).toContain('mande também o resultado pelo orq para quem editou')
  })

  it('lista longa é cortada; sem autores, sem a linha do orq', () => {
    const files = Array.from({ length: 53 }, (_, i) => ({ path: `f${i}.ts`, kind: 'M' as const }))
    const msg = reviewRequest({ root: '/r', branch: null, files, kinds: {}, editors: [] })
    expect(msg).toContain('- … e mais 3')
    expect(msg).not.toContain('f50.ts')
    expect(msg).not.toContain('orq')
    expect(msg.startsWith('Revisão de código pedida pelo usuário no repositório /r.')).toBe(true)
  })
})
