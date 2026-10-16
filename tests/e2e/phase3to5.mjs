// Aceite (determinístico) das Fases 2 (regras de conexão), 3 (notas ao vivo), 4 (gerente) e 5 (rotinas e floors),
// usando o CLI orq real de dentro de terminais PowerShell do app.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  check,
  edge,
  gitInit,
  launch,
  noteNode,
  readWorkspace,
  seedConfig,
  seedWorkspace,
  shotDir,
  sleep,
  summary,
  tempEnv,
  terminalNode,
  typeInto,
  waitRunning,
  waitScreen
} from './helpers.mjs'

const env = tempEnv('f35')
const git = gitInit(env.workspace)
seedConfig(env.userData, env.workspace)
seedWorkspace(env.workspace, {
  nodes: [
    terminalNode('sh1', 'operador', 'shell', 0, 0, { manager: true }),
    terminalNode('sh2', 'isolado', 'shell', 1400, 0),
    noteNode('n1', 'spec.md', 0, 520),
    noteNode('n2', 'progresso.md', 460, 520)
  ],
  edges: [edge('e1', 'sh1', 'n1'), edge('e2', 'sh1', 'n2')],
  notes: { 'spec.md': '# Spec\n\nConstruir a calculadora.\n', 'progresso.md': '# Progresso\n' }
})

const { app, win } = await launch(env.userData)
win.on('pageerror', (e) => console.log('[pageerror]', e.message))
await win.waitForSelector('.react-flow__node-terminal', { timeout: 30000 })
check(await waitRunning(win, ['sh1', 'sh2'], 45000), 'terminais shell iniciados')
await sleep(1500)

// ------------------------------------------------------------------ CLI básico e regras de conexão
await typeInto(win, 'sh1', 'orq whoami')
check(Boolean(await waitScreen(win, 'sh1', (t) => /operador/.test(t) && /gerente|manager/i.test(t), 20000, 'whoami')), 'orq whoami mostra nome e modo gerente')
await typeInto(win, 'sh1', 'orq peers')
check(Boolean(await waitScreen(win, 'sh1', (t) => /spec\.md/.test(t) && /progresso\.md/.test(t), 20000, 'peers')), 'orq peers lista as notas conectadas')
await typeInto(win, 'sh2', 'orq send operador "oi"; echo "CODIGO=$LASTEXITCODE"')
check(
  Boolean(await waitScreen(win, 'sh2', (t) => /conex[aã]o/i.test(t) && /CODIGO=3/.test(t), 20000, 'send sem conexão')),
  'enviar para terminal não conectado falha com erro claro (código 3)'
)
await typeInto(win, 'sh2', 'orq note read spec.md; echo "CODIGO=$LASTEXITCODE"')
check(Boolean(await waitScreen(win, 'sh2', (t) => (t.match(/CODIGO=3/g) ?? []).length >= 2, 20000, 'nota sem conexão')), 'ler nota não conectada é negado')

// ------------------------------------------------------------------ Fase 3: nota atualiza ao vivo
await typeInto(win, 'sh1', 'orq note append progresso.md "Passo 1 concluido pelo agente"')
let noteText = ''
for (let i = 0; i < 30 && !/Passo 1 concluido/.test(noteText); i++) {
  await sleep(500)
  noteText = (await win.locator('.react-flow__node-note', { hasText: 'progresso.md' }).textContent()) ?? ''
}
check(/Passo 1 concluido/.test(noteText), 'nota conectada atualiza na tela em tempo real após orq note append')
const onDisk = fs.readFileSync(path.join(env.workspace, '.maestrinho', 'notes', 'progresso.md'), 'utf8')
check(/Passo 1 concluido/.test(onDisk), 'conteúdo gravado no arquivo .md')
await typeInto(win, 'sh1', 'orq note read spec.md')
check(Boolean(await waitScreen(win, 'sh1', (t) => /Construir a calculadora/.test(t), 15000, 'note read')), 'orq note read devolve o conteúdo')
await win.screenshot({ path: path.join(shotDir, 'fase3-nota.png') })

// ------------------------------------------------------------------ Fase 4: gerente monta o time
for (const [name, role] of [
  ['construtor', 'Construtor'],
  ['revisor', 'Revisor'],
  ['testador', 'Testador']
]) {
  await typeInto(win, 'sh1', `orq recruit --name ${name} --agent shell --role ${role} --note spec.md`)
  await sleep(1500)
}
let doc = null
for (let i = 0; i < 30; i++) {
  doc = readWorkspace(env.workspace)
  if (doc.nodes.filter((n) => n.recruitedBy === 'sh1').length === 3) break
  await sleep(500)
}
const recruits = doc.nodes.filter((n) => n.recruitedBy === 'sh1')
check(recruits.length === 3, `3 recrutas criados (encontrados: ${recruits.length})`)
const byName = Object.fromEntries(recruits.map((r) => [r.name, r]))
check(byName.construtor?.roleId === 'construtor' && byName.revisor?.roleId === 'revisor' && byName.testador?.roleId === 'testador', 'recrutas com os papéis corretos')
const connected = (a, b) => doc.edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))
check(recruits.every((r) => connected(r.id, 'sh1') && connected(r.id, 'n1')), 'recrutas conectados ao gerente e à nota spec.md')
check(recruits.every((r) => r.position.y >= 420), 'recrutas posicionados abaixo do gerente')
await sleep(2500)
const domTerminals = await win.locator('.react-flow__node-terminal').count()
check(domTerminals === 5, `recrutas aparecem no canvas (terminais na tela: ${domTerminals})`)
await win.screenshot({ path: path.join(shotDir, 'fase4-time.png') })

check(await waitRunning(win, [byName.construtor.id], 45000), 'processo do recruta iniciado')
await typeInto(win, byName.construtor.id, 'orq whoami')
check(
  Boolean(await waitScreen(win, byName.construtor.id, (t) => /construtor/.test(t) && /Construtor/.test(t), 20000, 'whoami recruta')),
  'recruta conhece o próprio papel (orq whoami)'
)

// Mensagem gerente -> recruta (shell: a mensagem é executada como comando) e leitura da tela.
await typeInto(win, 'sh1', 'orq send construtor "echo PING-DO-GERENTE"')
check(Boolean(await waitScreen(win, byName.construtor.id, (t) => /PING-DO-GERENTE/.test(t), 20000, 'send gerente')), 'orq send entrega a mensagem no terminal conectado')
await typeInto(win, 'sh1', 'orq read construtor --lines 15')
check(Boolean(await waitScreen(win, 'sh1', (t) => (t.match(/PING-DO-GERENTE/g) ?? []).length >= 2, 20000, 'read')), 'orq read devolve a tela do peer')

await typeInto(win, 'sh1', 'orq dismiss testador')
let gone = false
for (let i = 0; i < 30 && !gone; i++) {
  await sleep(500)
  gone = !readWorkspace(env.workspace).nodes.some((n) => n.name === 'testador')
}
check(gone, 'orq dismiss remove o recruta')
await typeInto(win, 'sh2', 'orq recruit --name intruso --agent shell; echo "CODIGO=$LASTEXITCODE"')
check(Boolean(await waitScreen(win, 'sh2', (t) => /gerente/i.test(t) && /CODIGO=3/.test(t), 20000, 'recruit sem gerente')), 'comando de gerente negado para terminal comum')

// ------------------------------------------------------------------ Fase 5: rotina de 3 passos
const routine = {
  id: 'rt-e2e',
  name: 'Tres passos',
  targetId: 'sh2',
  script: 'echo PASSO-1\n&&\necho PASSO-2\n&&\necho PASSO-3',
  intervalMinutes: 10,
  enabled: true,
  skipIfBusy: true,
  notifyOnRun: false,
  createdAt: new Date().toISOString()
}
await win.evaluate(([dir, r]) => window.maestrinho.invoke('routines:save', { dir, routine: r }), [env.workspace, routine])
await win.evaluate(([dir]) => window.maestrinho.invoke('routines:runNow', { dir, id: 'rt-e2e' }), [env.workspace])
let state = null
for (let i = 0; i < 60; i++) {
  await sleep(1000)
  state = await win.evaluate(([dir]) => window.maestrinho.invoke('routines:list', { dir }), [env.workspace])
  if (state.history.length > 0) break
}
check(state?.history[0]?.outcome === 'completed' && state.history[0].stepsSent === 3, 'rotina de 3 passos concluída')
const sh2Text = await waitScreen(win, 'sh2', (t) => /PASSO-3/.test(t), 5000, 'rotina')
const order = sh2Text ? [sh2Text.lastIndexOf('PASSO-1'), sh2Text.lastIndexOf('PASSO-2'), sh2Text.lastIndexOf('PASSO-3')] : [-1, -1, -1]
check(order[0] >= 0 && order[0] < order[1] && order[1] < order[2], 'passos executados em ordem')
check(state?.routines[0]?.intervalMinutes === 10, 'rotina configurada para rodar a cada 10 minutos')
const routinesFile = JSON.parse(fs.readFileSync(path.join(env.workspace, '.maestrinho', 'routines.json'), 'utf8'))
check(routinesFile.routines.length === 1, 'rotina persistida em routines.json')

// ------------------------------------------------------------------ Fase 5: floor criado e descartado
const headBefore = git('rev-parse', 'main').trim()
const floor = await win.evaluate(([dir]) => window.maestrinho.invoke('floors:create', { dir, name: 'experimento' }), [env.workspace])
check(fs.existsSync(path.join(floor.worktreePath, 'README.md')), 'floor criado como git worktree')
check(git('branch', '--list', 'floor/experimento').includes('floor/experimento'), 'branch do floor criada')
await sleep(800)
const tabs = await win.locator('.floor-tab').allTextContents()
check(tabs.some((t) => t.includes('experimento')), 'aba do floor aparece no canvas')
await win.screenshot({ path: path.join(shotDir, 'fase5-floor.png') })
await win.evaluate(([dir, id]) => window.maestrinho.invoke('floors:discard', { dir, id, force: true }), [env.workspace, floor.id])
check(!fs.existsSync(floor.worktreePath), 'worktree removido ao descartar')
check(!git('branch', '--list', 'floor/*').trim(), 'branch do floor apagada')
check(git('rev-parse', 'main').trim() === headBefore && git('rev-parse', '--abbrev-ref', 'HEAD').trim() === 'main', 'branch principal intacta')

await win.screenshot({ path: path.join(shotDir, 'fase5-final.png') })
await app.close()
try {
  execFileSync('git', ['worktree', 'prune'], { cwd: env.workspace })
} catch {
  // ignora
}
summary()
console.log('workspace de teste:', env.workspace)
