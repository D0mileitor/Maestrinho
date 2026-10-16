import { describe, expect, it } from 'vitest'
import { fitChatBounds } from './chatWindow'

const left = { x: -1920, y: 0, width: 1920, height: 1040 }
const center = { x: 0, y: 0, width: 1920, height: 1040 }

describe('fitChatBounds', () => {
  it('reabre onde estava se ainda cabe num monitor', () => {
    const saved = { x: -1500, y: 100, width: 600, height: 800 }
    expect(fitChatBounds(saved, [left, center], null)).toEqual(saved)
  })

  it('monitor desligado: volta para perto da janela principal', () => {
    const saved = { x: -1500, y: 100, width: 600, height: 800 }
    const b = fitChatBounds(saved, [center], { x: 100, y: 50, width: 1440, height: 920 })
    expect(b).toEqual({ x: 916, y: 110, width: 600, height: 860 })
  })

  it('sem posição salva, abre no monitor da janela principal, sem passar da borda', () => {
    const b = fitChatBounds(null, [left, center], { x: -1800, y: 0, width: 1700, height: 1000 })
    expect(b.x).toBeGreaterThanOrEqual(-1920)
    expect(b.x + b.width).toBeLessThanOrEqual(0)
  })

  it('tamanho salvo menor que o mínimo é ignorado', () => {
    expect(fitChatBounds({ x: 10, y: 10, width: 100, height: 100 }, [center], null).width).toBe(600)
  })
})
