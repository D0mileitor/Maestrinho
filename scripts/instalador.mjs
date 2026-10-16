// Gera o instalador do Windows (NSIS, por usuário, sem admin) em release/, para anexar a uma release do GitHub.
// Uso:
//   npm run instalador
//   (--manter guarda a pasta temporária, com o app empacotado em pack/, para testes)
//
// - Não toca no out/ nem no node_modules do projeto: o build vai para uma pasta temporária (dá para
//   gerar com o app de desenvolvimento aberto e agentes trabalhando).
// - A versão é a do package.json: suba o "version" antes de gerar uma versão nova.
// - Saída em release/: Maestrinho-Setup-<versão>.exe; o SHA-256 sai no console para as notas da release.
// - O electron-builder roda via npx (fica no cache do npm, fora do projeto) e baixa o NSIS na primeira vez.
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON_BUILDER = 'electron-builder@26.15.3'
// O mesmo de APP_USER_MODEL_ID em src/shared/appIdentity.ts (o app instalado usa este id).
const APP_USER_MODEL_ID = 'app.maestrinho.desktop'

const step = (s) => console.log(`\n=== ${s}`)

if (process.platform !== 'win32') {
  console.error('O instalador é do Windows: gere numa máquina Windows.')
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
const electronVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version

const STAGE = path.join(os.tmpdir(), 'maestrinho-instalador')
const APP = path.join(STAGE, 'app')
const PACK = path.join(STAGE, 'pack')
const BUILDER = path.join(STAGE, 'builder')
const DIST = path.join(STAGE, 'dist')
fs.rmSync(STAGE, { recursive: true, force: true })
fs.mkdirSync(APP, { recursive: true })

step(`1/5 build da versão ${version} (fora do out/ do projeto)`)
execSync(`npx electron-vite build --outDir "${path.join(APP, 'out')}"`, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } })
for (const f of ['main/index.js', 'main/orq.js']) {
  if (!fs.existsSync(path.join(APP, 'out', f))) throw new Error(`build incompleto: falta out/${f}`)
}

step('2/5 pasta do app (só o necessário)')
for (const f of ['package.json', 'LICENSE', 'README.md']) fs.copyFileSync(path.join(ROOT, f), path.join(APP, f))
fs.mkdirSync(path.join(APP, 'resources'))
for (const f of ['icon.png', 'icon.ico']) fs.copyFileSync(path.join(ROOT, 'resources', f), path.join(APP, 'resources', f))
// Dependências de produção (fecho transitivo de "dependencies"), copiadas: o node_modules do projeto só é lido.
const deps = new Set()
const visit = (name) => {
  if (deps.has(name)) return
  const pj = path.join(ROOT, 'node_modules', name, 'package.json')
  if (!fs.existsSync(pj)) return
  deps.add(name)
  const dep = JSON.parse(fs.readFileSync(pj, 'utf8'))
  for (const d of Object.keys({ ...(dep.dependencies ?? {}), ...(dep.optionalDependencies ?? {}) })) visit(d)
}
for (const d of Object.keys(pkg.dependencies ?? {})) visit(d)
for (const d of deps) fs.cpSync(path.join(ROOT, 'node_modules', d), path.join(APP, 'node_modules', d), { recursive: true })
console.log('dependências de produção:', [...deps].join(', '))

step('3/5 app empacotado (@electron/packager)')
const { packager } = await import(pathToFileURL(path.join(ROOT, 'node_modules', '@electron', 'packager', 'dist', 'index.js')).href)
const [appDir] = await packager({
  dir: APP,
  name: pkg.productName,
  appVersion: version,
  // Versão do arquivo no Windows só aceita números: "0.2.2-beta" vira 0.2.2 aqui (o app e o instalador mantêm o -beta).
  buildVersion: version.replace(/-.*$/, ''),
  electronVersion,
  out: PACK,
  overwrite: true,
  // Sem asar: o CLI orq (out/main/orq.js) e o node-pty nativo funcionam sem extração.
  asar: false,
  prune: false,
  platform: 'win32',
  arch: 'x64',
  icon: path.join(ROOT, 'resources', 'icon.ico'),
  win32metadata: {
    ProductName: pkg.productName,
    FileDescription: 'Maestrinho — canvas local para orquestrar agentes de código',
    OriginalFilename: `${pkg.productName}.exe`,
    CompanyName: pkg.author
  }
})
const locales = path.join(appDir, 'locales')
for (const f of fs.readdirSync(locales)) if (!/^(pt-BR|en-US)\.pak$/.test(f)) fs.rmSync(path.join(locales, f))

step(`4/5 instalador (${ELECTRON_BUILDER} via npx)`)
fs.mkdirSync(BUILDER, { recursive: true })
fs.writeFileSync(
  path.join(BUILDER, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      productName: pkg.productName,
      version,
      description: pkg.description,
      author: pkg.author,
      license: pkg.license,
      build: {
        // Mesmo AppUserModelID do app: as notificações do Windows dependem do atalho com esse id.
        appId: APP_USER_MODEL_ID,
        productName: pkg.productName,
        electronVersion,
        directories: { output: DIST },
        win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: path.join(ROOT, 'resources', 'icon.ico'), signAndEditExecutable: false },
        nsis: {
          oneClick: false,
          perMachine: false,
          allowElevation: false,
          allowToChangeInstallationDirectory: true,
          createDesktopShortcut: true,
          createStartMenuShortcut: true,
          shortcutName: pkg.productName,
          uninstallDisplayName: pkg.productName,
          deleteAppDataOnUninstall: false,
          installerLanguages: ['pt_BR'],
          language: '1046',
          artifactName: 'Maestrinho-Setup-${version}.exe'
        }
      }
    },
    null,
    2
  )
)
execSync(`npx --yes ${ELECTRON_BUILDER} --win nsis --x64 --prepackaged "${appDir}" --projectDir "${BUILDER}"`, {
  cwd: BUILDER,
  stdio: 'inherit',
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
})
const file = `Maestrinho-Setup-${version}.exe`
if (!fs.existsSync(path.join(DIST, file))) throw new Error('o instalador não foi gerado')

step('5/5 release/')
const release = path.join(ROOT, 'release')
fs.mkdirSync(release, { recursive: true })
fs.copyFileSync(path.join(DIST, file), path.join(release, file))
const bytes = fs.readFileSync(path.join(release, file))
console.log(`instalador: ${path.join(release, file)} (${(bytes.length / 1048576).toFixed(1)} MB)`)
console.log(`SHA-256: ${createHash('sha256').update(bytes).digest('hex')}`)
console.log(`\nPara publicar: crie a release v${version} no GitHub, anexe o instalador e cole o SHA-256 nas notas.`)
// --manter: deixa a pasta temporária (com o app empacotado em pack/) para testes.
if (process.argv.includes('--manter')) console.log(`pasta temporária mantida: ${STAGE}`)
else fs.rmSync(STAGE, { recursive: true, force: true })
