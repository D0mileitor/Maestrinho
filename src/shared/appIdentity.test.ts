import { describe, expect, it } from 'vitest'
import { APP_USER_MODEL_ID, appIdentity } from './appIdentity'

describe('appIdentity', () => {
  it('o app instalado usa o id do instalador e o atalho "Maestrinho"', () => {
    expect(appIdentity(true)).toEqual({ id: APP_USER_MODEL_ID, shortcutName: 'Maestrinho.lnk' })
  })

  it('rodando do código-fonte, id e atalho próprios (não disputa com o instalado)', () => {
    const dev = appIdentity(false)
    expect(dev.id).not.toBe(APP_USER_MODEL_ID)
    expect(dev.id.startsWith(APP_USER_MODEL_ID)).toBe(true)
    expect(dev.shortcutName).toBe('Maestrinho (dev).lnk')
  })
})
