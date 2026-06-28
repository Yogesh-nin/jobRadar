import axios from 'axios'

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function send(token, chatId, text) {
  const res = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
  if (!res.data.ok) throw new Error(`Telegram API error: ${res.data.description}`)
}

function buildJobBlock(job, index) {
  const title   = escapeHtml(job.title)
  const company = escapeHtml(job.company)
  const loc     = escapeHtml(job.location || 'Unknown')
  const link    = job.url ? ` | <a href="${escapeHtml(job.url)}">View Job</a>` : ''
  return `<b>#${index} ${title}</b> — ${company}\n📍 ${loc} | Score: ${job.score}${link}`
}

export async function sendTelegram(jobs, dateStr) {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  if (jobs.length === 0) {
    await send(token, chatId, `<b>Job Digest — ${dateStr}</b>\n\nNo new relevant jobs found today.`)
    return
  }

  // Send header + first batch
  const BATCH = 10
  const header = `<b>Job Digest — ${dateStr}</b>\nFound <b>${jobs.length}</b> new relevant job${jobs.length === 1 ? '' : 's'}:\n`
  const chunks = []
  for (let i = 0; i < jobs.length; i += BATCH) {
    chunks.push(jobs.slice(i, i + BATCH))
  }

  for (let c = 0; c < chunks.length; c++) {
    const lines = c === 0 ? [header] : []
    chunks[c].forEach((job, idx) => {
      lines.push(buildJobBlock(job, c * BATCH + idx + 1))
      lines.push('')
    })
    await send(token, chatId, lines.join('\n'))
    // Small delay between messages to avoid rate limiting
    if (c < chunks.length - 1) await new Promise(r => setTimeout(r, 500))
  }
}
