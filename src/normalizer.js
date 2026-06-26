export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function truncate(text, len = 500) {
  if (!text) return ''
  const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > len ? clean.slice(0, len) + '...' : clean
}

export function normalize(job) {
  return {
    id: job.id || '',
    title: job.title || 'Untitled',
    company: job.company || '',
    location: job.location || 'Unknown',
    url: job.url || '',
    postedAt: job.postedAt || null,
    description: job.description || '',
    source: job.source || 'unknown',
    score: job.score || 0,
    matchedKeywords: job.matchedKeywords || []
  }
}
