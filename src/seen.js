import { readFile, writeFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SEEN_PATH = join(__dirname, '..', 'seen.json')

export async function loadSeen() {
  try {
    const data = await readFile(SEEN_PATH, 'utf-8')
    return new Map(Object.entries(JSON.parse(data)))
  } catch {
    return new Map()
  }
}

export function isNew(id, seenMap) {
  return !seenMap.has(id)
}

export function markSeen(id, seenMap) {
  seenMap.set(id, true)
}

export async function saveSeen(seenMap) {
  await writeFile(SEEN_PATH, JSON.stringify(Object.fromEntries(seenMap), null, 2))
}
