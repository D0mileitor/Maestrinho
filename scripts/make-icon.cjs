// Gera resources/icon.png (512px) e resources/icon.ico (256px, PNG embutido) a partir do SVG abaixo.
// Uso (precisa do Electron, sem ELECTRON_RUN_AS_NODE): npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="SIZE" height="SIZE">
  <rect width="256" height="256" rx="58" fill="#151b27"/>
  <g stroke="#e8e4d8" stroke-opacity="0.2" stroke-width="5" stroke-linecap="round">
    <line x1="40" y1="88" x2="216" y2="88"/>
    <line x1="40" y1="110" x2="216" y2="110"/>
    <line x1="40" y1="132" x2="216" y2="132"/>
    <line x1="40" y1="154" x2="216" y2="154"/>
    <line x1="40" y1="176" x2="216" y2="176"/>
  </g>
  <line x1="66" y1="196" x2="184" y2="78" stroke="#d4a849" stroke-width="13" stroke-linecap="round"/>
  <circle cx="194" cy="68" r="17" fill="#e7bd5c"/>
  <line x1="54" y1="184" x2="78" y2="208" stroke="#d4a849" stroke-width="22" stroke-linecap="round"/>
</svg>`

async function render(size) {
  const win = new BrowserWindow({
    show: false,
    width: size,
    height: size,
    useContentSize: true,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace(/SIZE/g, String(size))}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  win.destroy()
  return img.resize({ width: size, height: size })
}

/** ICO com uma única imagem PNG (formato aceito desde o Windows Vista). */
function pngToIco(png) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry.writeUInt8(0, 0) // 256
  entry.writeUInt8(0, 1)
  entry.writeUInt8(0, 2)
  entry.writeUInt8(0, 3)
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([header, entry, png])
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const out = path.resolve(__dirname, '..', 'resources')
  fs.mkdirSync(out, { recursive: true })
  const img = await render(512)
  fs.writeFileSync(path.join(out, 'icon.png'), img.toPNG())
  fs.writeFileSync(path.join(out, 'icon.ico'), pngToIco(img.resize({ width: 256, height: 256, quality: 'best' }).toPNG()))
  fs.writeFileSync(path.join(out, 'icon.svg'), svg.replace(/ width="SIZE" height="SIZE"/, ''))
  console.log('ícones gerados em', out)
  app.quit()
})
