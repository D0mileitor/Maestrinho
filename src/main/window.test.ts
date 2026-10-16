import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, Menu: {}, nativeTheme: {}, session: {}, shell: {} }))

const { e2eWindowOptions } = await import('./window')

describe('janela nos testes ponta a ponta', () => {
  it('posição e "sem foco" só quando pedidos e válidos', () => {
    expect(e2eWindowOptions({})).toEqual({ bounds: null, inactive: false })
    expect(e2eWindowOptions({ MAESTRINHO_E2E_JANELA: '1940, 20, 1440, 920', MAESTRINHO_E2E_SEM_FOCO: '1' })).toEqual({
      bounds: { x: 1940, y: 20, width: 1440, height: 920 },
      inactive: true
    })
    expect(e2eWindowOptions({ MAESTRINHO_E2E_JANELA: '10,10,100,100' }).bounds).toBeNull()
    expect(e2eWindowOptions({ MAESTRINHO_E2E_JANELA: 'a,b,c,d' }).bounds).toBeNull()
    expect(e2eWindowOptions({ MAESTRINHO_E2E_SEM_FOCO: 'sim' }).inactive).toBe(false)
  })
})
