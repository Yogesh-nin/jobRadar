import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = await readFile(join(__dirname, '.env'), 'utf-8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '').trim()
}

const { sendTelegram } = await import('./src/notifier.js')
const data = JSON.parse(await readFile(join(__dirname, 'output/jobs_2026-06-28.json'), 'utf-8'))
await sendTelegram(data.jobs, '2026-06-28')
console.log('Done!')
