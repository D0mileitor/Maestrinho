// Empacota o app numa pasta portátil (release/Maestrinho-<plataforma>-<arch>/), sem instalador.
// Uso: npm run pack   (roda o build antes)
//
// - asar desligado: os arquivos ficam legíveis (auditoria) e o CLI `orq` (out/main/orq.js) e o
//   node-pty nativo funcionam sem extração.
// - Só vão o código compilado (out/), package.json e as dependências de produção.
// - O executável é o próprio Electron renomeado; nada é baixado se o binário já estiver no cache.
import { packager } from '@electron/packager'
import fs from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const electronVersion = JSON.parse(fs.readFileSync(path.join('node_modules', 'electron', 'package.json'), 'utf8')).version

if (!fs.existsSync(path.join('out', 'main', 'index.js'))) {
  console.error('out/ não encontrado: rode "npm run build" antes (ou use "npm run pack").')
  process.exit(1)
}

/** Dependências de produção (fecho transitivo de "dependencies"): só elas vão para o pacote. */
function productionDeps() {
  const out = new Set()
  const visit = (name) => {
    if (out.has(name)) return
    const pj = path.join('node_modules', name, 'package.json')
    if (!fs.existsSync(pj)) return
    out.add(name)
    const dep = JSON.parse(fs.readFileSync(pj, 'utf8'))
    for (const d of Object.keys({ ...(dep.dependencies ?? {}), ...(dep.optionalDependencies ?? {}) })) visit(d)
  }
  for (const d of Object.keys(pkg.dependencies ?? {})) visit(d)
  return [...out]
}
const prodDeps = productionDeps()
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const depsRe = new RegExp(`^/node_modules(/(${prodDeps.map(escapeRe).join('|')})(/|$))?$`)
console.log('dependências de produção no pacote:', prodDeps.join(', '))

const keep = [
  /^\/resources(\/icon\.(png|ico))?$/,
  /^\/out(\/|$)/,
  /^\/package\.json$/,
  /^\/LICENSE$/,
  /^\/README\.md$/
]
const keepPath = (p) => keep.some((re) => re.test(p)) || depsRe.test(p) || prodDeps.some((d) => p.startsWith(`/node_modules/${d}/`))
const iconPath = path.resolve('resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png')

const appPaths = await packager({
  dir: '.',
  name: pkg.productName ?? 'Maestrinho',
  appVersion: pkg.version,
  electronVersion,
  out: 'release',
  overwrite: true,
  asar: false,
  prune: true,
  platform: process.platform,
  arch: process.arch,
  icon: fs.existsSync(iconPath) ? iconPath : undefined,
  // Inclui só o necessário (o filtro recebe caminhos relativos começando com "/"). Uma função aqui
  // substitui o "prune" padrão, por isso as dependências de produção são calculadas acima.
  ignore: (p) => p !== '' && !keepPath(p.replace(/\\/g, '/')),
  win32metadata: {
    ProductName: pkg.productName ?? 'Maestrinho',
    FileDescription: 'Maestrinho — canvas local para orquestrar agentes de código',
    OriginalFilename: `${pkg.productName ?? 'Maestrinho'}.exe`
  }
})

for (const p of appPaths) {
  // Só os idiomas usados pela interface (o Chromium traz dezenas de .pak).
  const locales = path.join(p, 'locales')
  if (fs.existsSync(locales)) {
    for (const f of fs.readdirSync(locales)) if (!/^(pt-BR|en-US)\.pak$/.test(f)) fs.rmSync(path.join(locales, f))
  }
  fs.writeFileSync(
    path.join(p, 'LEIA-ME.txt'),
    [
      'Maestrinho (build portátil, sem instalador)',
      '',
      `Abra ${pkg.productName ?? 'Maestrinho'}${process.platform === 'win32' ? '.exe' : ''} para iniciar.`,
      'Dados do app: %APPDATA%\\Maestrinho (Windows) ou ~/.config/Maestrinho (Linux).',
      'Este pacote foi gerado localmente a partir do código-fonte (npm run pack).',
      '',
      'Licenças: resources/app/LICENSE (Maestrinho, MIT); LICENSE e LICENSES.chromium.html (Electron e Chromium);',
      'resources/app/out/main/THIRD-PARTY-NOTICES.txt e resources/app/out/renderer/THIRD-PARTY-NOTICES.txt',
      '(pacotes de terceiros embutidos no app).',
      ''
    ].join('\r\n')
  )
  console.log('pacote gerado em', p)
}
