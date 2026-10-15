// Dates in Georgian. Chrome ships no Georgian date names (toLocaleDateString
// with 'ka-GE' falls back to English), so the months are spelled out here.

const MONTHS = ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ']

const pad = (n) => String(n).padStart(2, '0')

/** "1 სექ. 2026" */
export function formatDate(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()]}. ${d.getFullYear()}`
}

/** "1 სექ. 2026, 21:05" */
export function formatDateTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${formatDate(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
