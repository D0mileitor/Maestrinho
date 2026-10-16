// Teste manual automatizado da Fase 0: abre o app, digita no PowerShell e verifica a saída e o resize.
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import path from 'node:path'

const shotDir = process.env.SHOT_DIR || path.resolve('test-results')
const app = await electron.launch({ executablePath: electronPath, args: ['.'], env: (() => { const e = { ...process.env, NODE_ENV: 'production' }; delete e.ELECTRON_RUN_AS_NODE; return e })() })
const win = await app.firstWindow()
await win.waitForSelector('.xterm-rows', { timeout: 20000 })
await win.waitForTimeout(2500)
await win.click('.xterm')
await win.keyboard.type('Write-Output ("FASE0-" + (6*7)); $Host.UI.RawUI.WindowSize.Width\r')
await win.waitForTimeout(2000)
const text1 = await win.textContent('.xterm-rows')
console.log('HAS FASE0-42:', /FASE0-42/.test(text1 ?? ''))
const width1 = (text1 ?? '').match(/FASE0-42\s*(\d+)/)?.[1]
console.log('cols reportadas pelo PowerShell:', width1)
await win.screenshot({ path: path.join(shotDir, 'fase0-1.png') })
// redimensiona a janela e confere se o PTY acompanhou
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(900, 600) })
await win.waitForTimeout(1200)
await win.keyboard.type('cls; $Host.UI.RawUI.WindowSize.Width\r')
await win.waitForTimeout(2000)
const text2 = await win.textContent('.xterm-rows')
const width2 = (text2 ?? '').match(/(\d{2,3})\s*PS /)?.[1] ?? (text2 ?? '').match(/\n?(\d{2,3})\b/)?.[1]
console.log('cols após resize:', width2)
await win.screenshot({ path: path.join(shotDir, 'fase0-2.png') })
await app.close()
