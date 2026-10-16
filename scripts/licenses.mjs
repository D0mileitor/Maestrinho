// Inventário de licenças de todas as dependências instaladas (para auditoria).
// Uso: node scripts/licenses.mjs  →  gera docs/THIRD-PARTY.md
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('node_modules')
const pkgs = new Map()

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ')
  return 'DESCONHECIDA'
}

function visit(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.name.startsWith('@')) {
      visit(full)
      continue
    }
    const pj = path.join(full, 'package.json')
    if (fs.existsSync(pj)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'))
        if (pkg.name && pkg.version) {
          const key = `${pkg.name}@${pkg.version}`
          if (!pkgs.has(key)) pkgs.set(key, { name: pkg.name, version: pkg.version, license: licenseOf(pkg) })
        }
      } catch {
        // ignora package.json inválido
      }
    }
    const nested = path.join(full, 'node_modules')
    if (fs.existsSync(nested)) visit(nested)
  }
}

visit(root)
const own = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const direct = new Set([...Object.keys(own.dependencies ?? {}), ...Object.keys(own.devDependencies ?? {})])
const byLicense = new Map()
for (const p of pkgs.values()) {
  const list = byLicense.get(p.license) ?? []
  list.push(p)
  byLicense.set(p.license, list)
}
const copyleft = /GPL|AGPL|LGPL|SSPL|EUPL|MPL|CDDL|EPL/i
// Proprietárias ou que restringem uso/redistribuição (não comercial, Business Source, Commons Clause).
const restricted = /UNLICENSED|SEE LICENSE|BUSL|Commons[- ]Clause|(^|[-\s])NC([-\s]|$)|NonCommercial/i
const lines = [
  '# Licenças de terceiros',
  '',
  `Gerado por \`node scripts/licenses.mjs\` a partir de node_modules (${pkgs.size} pacotes).`,
  'Pacotes marcados com * são dependências diretas do projeto.',
  ''
]
const flagged = [...pkgs.values()].filter((p) => copyleft.test(p.license) || restricted.test(p.license) || p.license === 'DESCONHECIDA')
lines.push('## Atenção', '')
if (flagged.length === 0) lines.push('Nenhuma licença copyleft, restritiva ou desconhecida encontrada.', '')
else for (const p of flagged) lines.push(`- ${p.name}@${p.version}: ${p.license}`)
lines.push('', '## Por licença', '')
for (const [license, list] of [...byLicense.entries()].sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`### ${license} (${list.length})`, '')
  for (const p of list.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`- ${direct.has(p.name) ? '*' : ''}${p.name}@${p.version}`)
  }
  lines.push('')
}
fs.mkdirSync('docs', { recursive: true })
fs.writeFileSync(path.join('docs', 'THIRD-PARTY.md'), lines.join('\n'))
console.log(`docs/THIRD-PARTY.md: ${pkgs.size} pacotes, ${flagged.length} para revisar`)
for (const p of flagged) console.log(`  revisar: ${p.name}@${p.version} (${p.license})`)
