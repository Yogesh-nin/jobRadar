import { readFile, writeFile, mkdir } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { detect } from './src/detector.js'
import { normalize } from './src/normalizer.js'
import { score as computeScore } from './src/scorer.js'
import { loadSeen, isNew, markSeen, saveSeen } from './src/seen.js'
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
  for (const line of env.split('\n')) {
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

async function main() {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timeStr = now.toISOString().replace('T', ' ').slice(0, 19)

  console.log(C.bold(`\nJob Scraper — Starting run at ${timeStr}`))
  console.log('─'.repeat(50))

  const outputDir = join(__dirname, 'output')
  await mkdir(outputDir, { recursive: true })

  const companiesPath = join(__dirname, 'companies.json')
  const companiesData = JSON.parse(await readFile(companiesPath, 'utf-8'))
  const keywordsData  = JSON.parse(await readFile(join(__dirname, 'keywords.json'), 'utf-8'))
  const profile = keywordsData.profiles[keywordsData.active_profile]
  const seenMap = await loadSeen()

  const allNewJobs = []
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

    const normalizedJobs = rawJobs.map(normalize)
    const newJobs = processJobs(normalizedJobs, seenMap, profile)
    allNewJobs.push(...newJobs)

    const stratPad = strategyName.padEnd(14)
    const fetched  = String(normalizedJobs.length).padStart(4)
    const newCount = newJobs.length > 0
      ? C.green(`${newJobs.length} new, relevant`)
      : C.dim('0 new, relevant')
    console.log(`${label} ${arrow} ${C.cyan(stratPad)} ${arrow} ${fetched} jobs fetched ${arrow} ${newCount}`)

    if (i < total - 1) {
      await new Promise(r => setTimeout(r, Math.random() * 2000 + 2000))
    }
  }

  // Persist updated companies.json (_detectedStrategy / _apiUrl filled in by detector)
  await writeFile(companiesPath, JSON.stringify(companiesData, null, 2))

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

  console.log('─'.repeat(50))
  console.log(C.bold(`Total new relevant jobs: ${C.green(String(allNewJobs.length))}`))
  console.log(`Output: output/jobs_${dateStr}.json\n`)

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
