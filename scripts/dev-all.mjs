#!/usr/bin/env node
/**
 * Run the Rust backend and the Next.js frontend together for local dev.
 *
 * The backend is required for task / habit / journal API calls to succeed —
 * forgetting to start it surfaces as opaque "Internal Server Error" responses
 * from the Next.js rewrite proxy. This launcher prevents that whole class of
 * mistake by always starting both processes together.
 *
 * Usage:  bun run dev:all     (or  node scripts/dev-all.mjs)
 */

import { spawn } from 'node:child_process'
import { platform } from 'node:os'

const ESC = '\x1b['
const color = (n, s) => (process.stdout.isTTY ? `${ESC}${n}m${s}${ESC}0m` : s)
const tag = {
  back: color(36, '[back]'),   // cyan
  agent: color(35, '[agent]'), // magenta
  front: color(33, '[front]'), // yellow
}

const isWindows = platform() === 'win32'
const shellOpts = { stdio: ['ignore', 'pipe', 'pipe'], shell: isWindows, detached: !isWindows }

function pipe(child, label) {
  child.stdout.on('data', (b) => process.stdout.write(`${label} ${b}`))
  child.stderr.on('data', (b) => process.stderr.write(`${label} ${b}`))
}

console.log(color(1, '\n  Life OS · dev (backend + agent + frontend)\n'))

const back = spawn('cargo', ['run'], { ...shellOpts, cwd: 'backend' })
pipe(back, tag.back)

const agent = spawn('go', ['run', './cmd/lifeos-agent'], { ...shellOpts, cwd: 'agent' })
pipe(agent, tag.agent)

const front = spawn('bun', ['run', 'dev'], shellOpts)
pipe(front, tag.front)

const children = [back, agent, front]
let exiting = false
const stopAll = (sig = 'SIGTERM') => {
  if (exiting) return
  exiting = true
  for (const c of children) {
    if (c.killed || !c.pid) continue
    try {
      if (!isWindows) {
        process.kill(-c.pid, sig)
      } else {
        c.kill(sig)
      }
    } catch { /* already gone */ }
  }
}

back.on('exit', (code) => {
  console.error(color(31, `\n${tag.back} backend exited with code ${code}`))
  stopAll()
})
agent.on('exit', (code) => {
  console.error(color(31, `\n${tag.agent} agent exited with code ${code}`))
  stopAll()
})
front.on('exit', (code) => {
  console.error(color(31, `\n${tag.front} frontend exited with code ${code}`))
  stopAll()
})

process.on('SIGINT', () => stopAll('SIGINT'))
process.on('SIGTERM', () => stopAll('SIGTERM'))
