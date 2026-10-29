const j = async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(typeof b.detail === 'string' ? b.detail : `Request failed (${r.status})`); return b }
const send = (m, b) => ({ method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
export const api = {
  series: () => fetch('/api/dataset/series').then(j),
  summary: () => fetch('/api/dataset/summary').then(j),
  upload: (f) => { const d = new FormData(); d.append('file', f); return fetch('/api/dataset/upload', { method: 'POST', body: d }).then(j) },
  train: (model) => fetch('/api/model/train', send('POST', { model })).then(j),
  metrics: () => fetch('/api/model/metrics').then(j),
  forecast: (h) => fetch('/api/forecast', send('POST', { horizon_hours: h })).then(j),
  capacity: (b) => fetch('/api/capacity/analyze', send('POST', b)).then(j),
  settings: () => fetch('/api/settings').then(j),
  putSettings: (s) => fetch('/api/settings', send('PUT', s)).then(j),
}
