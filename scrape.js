import { readFile, writeFile, mkdir, readdir } from 'fs/promises'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { detect } from './src/detector.js'
import { normalize } from './src/normalizer.js'
import { score as computeScore } from './src/scorer.js'
import { loadSeen, isNew, markSeen, saveSeen } from './src/seen.js'
import { sendTelegram } from './src/notifier.js'
import * as ats from './src/strategies/ats/index.js'
import { scrape as scrapeIntercept } from './src/strategies/intercept.js'
import { scrape as scrapeDomwait } from './src/strategies/domwait.js'
import { scrape as scrapeStatic } from './src/strategies/static.js'
import { scrape as scrapeIframe } from './src/strategies/iframe.js'
import { scrape as scrapeJobSearch } from './src/strategies/jobsearch.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env without an external dependency
try {
  const env = await readFile(join(__dirname, '.env'), 'utf-8')
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '').trim()
  }
} catch {}

// ANSI color helpers (no external dependency)
const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
}

async function runStrategy(company, strategyName, companiesData, profile) {
  if (ats[strategyName]) return ats[strategyName](company)

  switch (strategyName) {
    case 'intercept':  return scrapeIntercept(company, companiesData)
    case 'domwait':    return scrapeDomwait(company)
    case 'iframe':     return scrapeIframe(company, companiesData, runStrategy)
    case 'jobsearch':  return scrapeJobSearch(company, profile)
    case 'static':
    case 'recruitee':
    case 'bamboohr':
    case 'workable':
    case 'pinpoint':
    default:
      if (strategyName !== 'static') {
        console.warn(C.yellow(`  Unknown strategy "${strategyName}", falling back to static`))
      }
      return scrapeStatic(company)
  }
}

async function withRateLimitRetry(fn) {
  try {
    return await fn()
  } catch (err) {
    if (err.response?.status === 429) {
      console.warn(C.yellow('  Rate limited — waiting 10s before retry…'))
      await new Promise(r => setTimeout(r, 10000))
      return fn()
    }
    throw err
  }
}

function dedup(jobs) {
  const seen = new Set()
  return jobs.filter(j => {
    if (seen.has(j.id)) return false
    seen.add(j.id)
    return true
  })
}

function processJobs(normalizedJobs, seenMap, profile) {
  const newJobs = []
  for (const job of normalizedJobs) {
    const { score, matchedKeywords } = computeScore(job, profile)
    job.score = score
    job.matchedKeywords = matchedKeywords
    const isJobNew = isNew(job.id, seenMap)
    markSeen(job.id, seenMap)
    if (score >= profile.min_score && isJobNew) newJobs.push(job)
  }
  return newJobs
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()) }))
}

async function pickFiles(companiesDir, available) {
  console.log(C.bold('\nAvailable company lists:'))
  console.log(`  ${C.cyan('0.')} All`)
  available.forEach((f, i) => console.log(`  ${C.cyan(`${i + 1}.`)} ${f.replace('.json', '')}`))
  console.log()

  const answer = await ask('Enter number (or 0 / Enter for all): ')
  if (!answer || answer === '0') return available.map(f => join(companiesDir, f))

  const picked = answer.split(/[\s,]+/).map(n => parseInt(n)).filter(n => n > 0 && n <= available.length)
  if (picked.length === 0) return available.map(f => join(companiesDir, f))
  return picked.map(n => join(companiesDir, available[n - 1]))
}

async function loadCompanies(root) {
  const companiesDir = join(root, 'companies')
  const args = process.argv.slice(2).filter(a => !a.startsWith('-'))

  let filePaths = []
  let useDir = false

  try {
    const available = (await readdir(companiesDir)).filter(f => f.endsWith('.json')).sort()
    if (available.length > 0) {
      useDir = true
      if (args.length > 0) {
        filePaths = args.map(a => join(companiesDir, a.endsWith('.json') ? a : `${a}.json`))
      } else {
        filePaths = await pickFiles(companiesDir, available)
      }
    }
  } catch {}

  if (!useDir) {
    filePaths = [join(root, 'companies.json')]
  }

  const loaded = []
  for (const filePath of filePaths) {
    const entries = JSON.parse(await readFile(filePath, 'utf-8'))
    for (const c of entries) c._sourceFile = filePath
    loaded.push(...entries)
  }

  const fileList = filePaths.map(f => f.split(/[\\/]/).slice(-2).join('/')).join(', ')
  console.log(C.dim(`Loaded ${loaded.length} companies from: ${fileList}`))
  return loaded
}

async function saveCompanies(companiesData) {
  const byFile = {}
  for (const c of companiesData) {
    if (!byFile[c._sourceFile]) byFile[c._sourceFile] = []
    const { _sourceFile, ...rest } = c
    byFile[c._sourceFile].push(rest)
  }
  for (const [filePath, companies] of Object.entries(byFile)) {
    await writeFile(filePath, JSON.stringify(companies, null, 2))
  }
}

async function main() {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timeStr = now.toISOString().replace('T', ' ').slice(0, 19)

  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v')

  console.log(C.bold(`\nJob Scraper — Starting run at ${timeStr}`))
  console.log('─'.repeat(50))

  const outputDir = join(__dirname, 'output')
  await mkdir(outputDir, { recursive: true })

  const companiesData = await loadCompanies(__dirname)
  const keywordsData  = JSON.parse(await readFile(join(__dirname, 'keywords.json'), 'utf-8'))
  const profile = keywordsData.profiles[keywordsData.active_profile]
  const seenMap = await loadSeen()

  const allNewJobs = []
  const allFetchedJobs = []
  const total = companiesData.length

  for (let i = 0; i < total; i++) {
    const company = companiesData[i]
    const tag   = `[${String(i + 1).padStart(String(total).length)}/${total}]`
    const label = `${tag} ${company.name.padEnd(20)}`
    const arrow = C.dim('→')

    console.log(`Scraping ${company.name}…`)

    // Resolve strategy name
    let strategyName
    if (company.strategy !== 'auto') {
      strategyName = company.strategy
    } else {
      try {
        strategyName = (await detect(company, companiesData)).strategy
      } catch (err) {
        console.error(C.red(`${label} ${arrow} Detection failed: ${err.message}`))
        if (i < total - 1) await new Promise(r => setTimeout(r, Math.random() * 2000 + 2000))
        continue
      }
    }

    // Run primary strategy
    let rawJobs = null
    try {
      rawJobs = await withRateLimitRetry(() => runStrategy(company, strategyName, companiesData, profile))
    } catch (err) {
      if (err.message === 'TEAMTAILOR_AUTH_REQUIRED') {
        console.warn(C.yellow(`${label} ${arrow} Teamtailor requires an API key — falling back to domwait`))
        strategyName = 'domwait'
        try { rawJobs = await scrapeDomwait(company) } catch {}
      } else if (err.response?.status === 404) {
        console.error(C.red(`${label} ${arrow} 404 — company may have changed ATS`))
      } else {
        console.error(C.red(`${label} ${arrow} Error: ${err.message}`))
      }

      // Auto-fallback: if everything above failed and we have a JSearch key, try it
      if (rawJobs === null && process.env.RAPIDAPI_KEY && strategyName !== 'jobsearch') {
        console.warn(C.yellow(`${label} ${arrow} Falling back to jobsearch`))
        try {
          rawJobs = await scrapeJobSearch(company, profile)
          strategyName = 'jobsearch'
        } catch (e2) {
          console.error(C.red(`  jobsearch also failed: ${e2.message}`))
          rawJobs = []
        }
      }

      if (rawJobs === null) rawJobs = []
    }

    const normalizedJobs = dedup(rawJobs.map(normalize))
    const newJobs = processJobs(normalizedJobs, seenMap, profile)
    allNewJobs.push(...newJobs)
    allFetchedJobs.push(...normalizedJobs)

    const stratPad = strategyName.padEnd(14)
    const fetched  = String(normalizedJobs.length).padStart(4)
    const newCount = newJobs.length > 0
      ? C.green(`${newJobs.length} new, relevant`)
      : C.dim('0 new, relevant')
    console.log(`${label} ${arrow} ${C.cyan(stratPad)} ${arrow} ${fetched} jobs fetched ${arrow} ${newCount}`)

    if (verbose) {
      normalizedJobs.forEach((j, idx) => console.log(C.dim(`    ${idx + 1}. ${j.title} — ${j.location}`)))
    }

    if (i < total - 1) {
      await new Promise(r => setTimeout(r, Math.random() * 2000 + 2000))
    }
  }

  // Persist updated company files (_detectedStrategy / _apiUrl filled in by detector)
  await saveCompanies(companiesData)

  allNewJobs.sort((a, b) => b.score - a.score)

  const todayPath = join(outputDir, `jobs_${dateStr}.json`)
  await writeFile(todayPath, JSON.stringify(
    { generatedAt: now.toISOString(), newJobsCount: allNewJobs.length, jobs: allNewJobs },
    null, 2
  ))

  const allJobsPath = join(outputDir, 'all_jobs.json')
  let allJobs = []
  try { allJobs = JSON.parse(await readFile(allJobsPath, 'utf-8')) } catch {}
  allJobs.push(...allNewJobs)
  await writeFile(allJobsPath, JSON.stringify(allJobs, null, 2))

  await saveSeen(seenMap)

  const debugPath = join(outputDir, 'debug_all_fetched.json')
  await writeFile(debugPath, JSON.stringify(
    { generatedAt: now.toISOString(), totalFetched: allFetchedJobs.length, jobs: allFetchedJobs },
    null, 2
  ))

  console.log('─'.repeat(50))
  console.log(C.bold(`Total new relevant jobs: ${C.green(String(allNewJobs.length))}`))
  console.log(`Output: output/jobs_${dateStr}.json\n`)

  try {
    await sendTelegram(allNewJobs, dateStr)
    console.log(C.green('Telegram notification sent.'))
  } catch (err) {
    console.warn(C.yellow(`Telegram notification failed: ${err.message}`))
  }

  if (allNewJobs.length > 0) {
    console.log('Top results:')
    allNewJobs.slice(0, 10).forEach((job, idx) => {
      const num     = `  #${idx + 1}`.padEnd(5)
      const title   = job.title.slice(0, 32).padEnd(34)
      const company = job.company.slice(0, 16).padEnd(18)
      console.log(`${num} ${C.green(title)} ${company} score:${job.score}  ${job.location}`)
    })
  }

  console.log()
}

main().catch(err => {
  console.error(C.red(`\nFatal: ${err.message}`))
  process.exit(1)
})
