export function score(job, profile) {
  let s = 0
  const matched = []
  const title = job.title.toLowerCase()
  const desc = (job.description || '').toLowerCase()

  for (const kw of profile.title_keywords) {
    if (title.includes(kw.toLowerCase())) {
      s += 3
      matched.push(kw)
    }
  }

  for (const kw of profile.description_keywords) {
    if (desc.includes(kw.toLowerCase())) {
      s += 1
      if (!matched.includes(kw)) matched.push(kw)
    }
  }

  for (const kw of profile.exclude_keywords) {
    if (title.includes(kw.toLowerCase()) || desc.includes(kw.toLowerCase())) {
      s = -1
      break
    }
  }

  return { score: s, matchedKeywords: matched }
}
