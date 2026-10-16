import { describe, expect, it } from 'vitest'
import { declaredLicense, formatNotices, isLicenseFile, packageRoot } from '../scripts/thirdPartyNotices'

describe('packageRoot', () => {
  it('acha a pasta do pacote, com ou sem escopo', () => {
    expect(packageRoot('/p/node_modules/zod/v4/index.js')).toBe('/p/node_modules/zod')
    expect(packageRoot('/p/node_modules/@xyflow/react/dist/esm/index.js')).toBe('/p/node_modules/@xyflow/react')
  })

  it('usa o pacote mais interno quando há node_modules aninhado', () => {
    expect(packageRoot('/p/node_modules/a/node_modules/b/lib/x.js')).toBe('/p/node_modules/a/node_modules/b')
  })

  it('aceita caminhos do Windows, ids virtuais e query', () => {
    expect(packageRoot('C:\\p\\node_modules\\@fontsource\\ibm-plex-sans\\files\\a.woff2')).toBe(
      'C:/p/node_modules/@fontsource/ibm-plex-sans'
    )
    expect(packageRoot('\0/p/node_modules/react/index.js?commonjs-proxy')).toBe('/p/node_modules/react')
  })

  it('ignora o que não é de pacote', () => {
    expect(packageRoot('/p/src/main/index.ts')).toBeNull()
    expect(packageRoot('/p/node_modules/@escopo')).toBeNull()
    expect(packageRoot('/p/node_modules/.bin/vite')).toBeNull()
  })
})

describe('declaredLicense', () => {
  it('lê string, objeto e a forma antiga em lista', () => {
    expect(declaredLicense({ license: 'MIT' })).toBe('MIT')
    expect(declaredLicense({ license: { type: 'ISC' } })).toBe('ISC')
    expect(declaredLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('MIT OR Apache-2.0')
    expect(declaredLicense({})).toBe('DESCONHECIDA')
  })
})

describe('isLicenseFile', () => {
  it('reconhece os nomes usuais e recusa o resto', () => {
    for (const f of ['LICENSE', 'license.md', 'LICENCE.txt', 'LICENSE-MIT', 'COPYING', 'NOTICE']) expect(isLicenseFile(f)).toBe(true)
    for (const f of ['README.md', 'package.json', 'licenses.json.map', 'xlicense']) expect(isLicenseFile(f)).toBe(false)
  })
})

describe('formatNotices', () => {
  it('lista os pacotes em ordem com a licença de cada um', () => {
    const text = formatNotices('interface', [
      { name: 'zod', version: '4.0.0', license: 'MIT', texts: ['MIT License\r\n\r\nCopyright (c) Colin\r\n'] },
      { name: '@a/b', version: '1.0.0', license: 'ISC', texts: [] }
    ])
    expect(text).toContain('Maestrinho: avisos de terceiros (interface)')
    expect(text).toContain('embute 2 pacotes')
    expect(text.indexOf('@a/b@1.0.0 (ISC)')).toBeLessThan(text.indexOf('zod@4.0.0 (MIT)'))
    expect(text).toContain('MIT License\n\nCopyright (c) Colin')
    expect(text).not.toContain('\r')
    expect(text).toContain('(o pacote não traz arquivo de licença; licença declarada: ISC)')
  })
})
