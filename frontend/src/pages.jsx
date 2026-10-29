import React, { useMemo, useState, useEffect } from 'react'
import { ResponsiveContainer, ComposedChart, LineChart, AreaChart, BarChart, Line, Area, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from 'recharts'
import { Upload, Download, Play, Printer, Save } from 'lucide-react'
import { api } from './api.js'
import { useApp } from './ctx.js'

const f1 = (n) => (n == null || Number.isNaN(n) ? '–' : Number(n).toFixed(1))
const tick = (s) => String(s).slice(5, 10)
const stKey = (s) => (s || '').split(' ')[0]
const Status = ({ s }) => <span className={'badge st-' + stKey(s)}>{s || 'No data'}</span>
const Card = ({ title, children, note }) => <section className="card">{title && <h2>{title}</h2>}{children}{note && <p className="note">{note}</p>}</section>
const Head = ({ t, s }) => <><h1>{t}</h1><p className="sub">{s}</p></>
const Kpi = ({ label, value, sub }) => <div className="card kpi"><span>{label}</span><b>{value}</b><small>{sub}</small></div>
const Sk = ({ h = 280 }) => <div className="sk" style={{ height: h }} aria-busy="true" />
const Empty = ({ children }) => <div className="empty">{children}</div>
const Chart = ({ label, h = 280, children }) => <div role="img" aria-label={label} style={{ height: h }}><ResponsiveContainer>{children}</ResponsiveContainer></div>
const axes = <><CartesianGrid stroke="#e3e9f0" /><XAxis dataKey="t" tickFormatter={tick} minTickGap={40} fontSize={11} /><YAxis fontSize={11} width={44} /><Tooltip /><Legend /></>

function useJoined(hist = 168) {
  const { series, forecast } = useApp()
  return useMemo(() => {
    const h = (series?.rows || []).slice(-hist).map((r) => ({ t: r.timestamp, actual: r.bandwidth_in_mbps }))
    const p = (forecast?.points || []).map((r) => ({ t: r.timestamp, predicted: r.predicted_mbps, band: [r.lower_80_mbps, r.upper_80_mbps] }))
    return [...h, ...p]
  }, [series, forecast, hist])
}

export function Overview() {
  const { series, settings: s, analysis: a, forecast } = useApp()
  const rows = series.rows, cap = s.capacity_mbps, joined = useJoined(168)
  const last = rows.at(-1)?.bandwidth_in_mbps, peak24 = Math.max(...rows.slice(-24).map((r) => r.bandwidth_in_mbps))
  const byHour = useMemo(() => { const acc = Array.from({ length: 24 }, () => [0, 0]); rows.forEach((r) => { const h = new Date(r.timestamp.replace(' ', 'T')).getHours(); if (r.bandwidth_in_mbps != null) { acc[h][0] += r.bandwidth_in_mbps; acc[h][1]++ } }); return acc.map(([t, n], h) => ({ t: String(h).padStart(2, '0') + ':00', avg: n ? +(t / n).toFixed(1) : 0 })) }, [rows])
  const ud = rows.slice(-168).map((r) => ({ t: r.timestamp, download: r.download_mbps, upload: r.upload_mbps }))
  const util = peak24 / cap * 100
  return <>
    <Head t="Network overview" s="Current load, AI forecast and capacity position." />
    <div className="grid g3" style={{ marginBottom: 14 }}>
      <Kpi label="Current bandwidth" value={`${f1(last)} Mbps`} sub={`of ${cap} Mbps installed`} />
      <Kpi label="Current utilization (24 h peak)" value={`${f1(util)}%`} sub={`peak ${f1(peak24)} Mbps`} />
      <Kpi label="Forecast peak demand" value={a ? `${f1(a.peak_demand_mbps)} Mbps` : '–'} sub={forecast ? `next ${forecast.horizon_hours} h` : 'no forecast yet'} />
      <Kpi label="Predicted utilization" value={a ? `${f1(a.peak_utilization_pct)}%` : '–'} sub={`target ${s.target_util_pct}%`} />
      <Kpi label="Capacity headroom" value={a ? `${f1(a.headroom_mbps)} Mbps` : '–'} sub="installed − forecast peak" />
      <div className="card kpi"><span>Network health</span><b style={{ fontSize: '1.2rem', marginTop: 8 }}><Status s={a?.status} /></b><div className="bar" aria-label="Forecast utilization"><i style={{ width: `${Math.min(100, a?.peak_utilization_pct || 0)}%`, background: a?.peak_utilization_pct > s.target_util_pct ? 'var(--bad)' : 'var(--acc)' }} /></div></div>
    </div>
    <div className="grid g2">
      <Card title="History and AI forecast (Mbps)" note="Shaded band: empirical 80% interval."><Chart label="History vs forecast"><ComposedChart data={joined}>{axes}<Area dataKey="band" name="80% interval" stroke="none" fill="#1668e3" fillOpacity={0.15} /><Line dataKey="actual" name="Actual" stroke="#14243a" dot={false} /><Line dataKey="predicted" name="Forecast" stroke="#1668e3" dot={false} /><ReferenceLine y={cap * s.target_util_pct / 100} stroke="#c53030" strokeDasharray="5 4" /></ComposedChart></Chart></Card>
      <Card title="Average traffic by hour of day"><Chart label="Traffic by hour"><BarChart data={byHour}><CartesianGrid stroke="#e3e9f0" /><XAxis dataKey="t" fontSize={11} interval={2} /><YAxis fontSize={11} width={40} /><Tooltip /><Bar dataKey="avg" name="Avg Mbps" fill="#1668e3" /></BarChart></Chart></Card>
      <Card title="Download / upload, last 7 days">{series.columns.includes('download_mbps') ? <Chart label="Upload download breakdown"><AreaChart data={ud}>{axes}<Area dataKey="download" stackId="1" stroke="#1668e3" fill="#1668e3" fillOpacity={0.5} /><Area dataKey="upload" stackId="1" stroke="#14855a" fill="#14855a" fillOpacity={0.5} /></AreaChart></Chart> : <Empty>Upload/download columns are not in this dataset.</Empty>}</Card>
      <Card title="Alerts and recommended action">{a ? <><p><Status s={a.status} /> Forecast peak {f1(a.peak_utilization_pct)}% of {cap} Mbps.</p>
        <p>{a.first_threshold_breach ? `Predicted to pass the ${s.target_util_pct}% threshold at ${a.first_threshold_breach}.` : `No threshold breach in the forecast horizon.`}</p>
        <p><b>Next action:</b> {a.capacity_gap_mbps > 0 ? `Plan an upgrade to at least ${f1(a.recommended_capacity_mbps)} Mbps${a.recommended_tier_mbps ? ` (tier ${a.recommended_tier_mbps} Mbps)` : ''}.` : 'No upgrade needed; keep monitoring.'}</p></> : <Empty>Generate a forecast to see alerts.</Empty>}</Card>
    </div></>
}

export function Traffic() {
  const { series } = useApp()
  const rows = series.rows, [from, setFrom] = useState(rows[0].timestamp.slice(0, 10)), [to, setTo] = useState(rows.at(-1).timestamp.slice(0, 10))
  const sel = rows.filter((r) => r.timestamp.slice(0, 10) >= from && r.timestamp.slice(0, 10) <= to)
  const daily = useMemo(() => { const m = {}; sel.forEach((r) => { const d = r.timestamp.slice(0, 10); (m[d] ||= []).push(r.bandwidth_in_mbps) }); return Object.entries(m).map(([t, v]) => ({ t, avg: +(v.reduce((x, y) => x + y, 0) / v.length).toFixed(1), peak: Math.max(...v) })) }, [sel])
  const pk = sel.reduce((b, r) => (r.bandwidth_in_mbps > (b?.bandwidth_in_mbps ?? -1) ? r : b), null)
  const has = (c) => series.columns.includes(c)
  return <>
    <Head t="Traffic analytics" s="Explore historical usage from the cleaned dataset." />
    <div className="row noprint"><label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label><span className="note">{sel.length} hourly rows selected</span></div>
    {!sel.length ? <Card><Empty>No data in this range.</Empty></Card> : <div className="grid g2">
      <Card title="Total traffic (Mbps)" note={pk && `Peak: ${f1(pk.bandwidth_in_mbps)} Mbps at ${pk.timestamp}`}><Chart label="Traffic trend"><LineChart data={sel.map((r) => ({ t: r.timestamp, total: r.bandwidth_in_mbps }))}>{axes}<Line dataKey="total" stroke="#1668e3" dot={false} /></LineChart></Chart></Card>
      <Card title="Daily average and peak"><Chart label="Daily summary"><LineChart data={daily}>{axes}<Line dataKey="avg" stroke="#14855a" dot={false} /><Line dataKey="peak" stroke="#c53030" dot={false} /></LineChart></Chart></Card>
      <Card title="Upload vs download">{has('download_mbps') && has('upload_mbps') ? <Chart label="Upload and download"><LineChart data={sel.map((r) => ({ t: r.timestamp, download: r.download_mbps, upload: r.upload_mbps }))}>{axes}<Line dataKey="download" stroke="#1668e3" dot={false} /><Line dataKey="upload" stroke="#14855a" dot={false} /></LineChart></Chart> : <Empty>Not available: dataset has no upload/download columns.</Empty>}</Card>
      <Card title="Active users and latency">{has('active_users') || has('latency_ms') ? <Chart label="Users and latency"><LineChart data={sel.map((r) => ({ t: r.timestamp, users: r.active_users, latency: r.latency_ms }))}>{axes}{has('active_users') && <Line dataKey="users" stroke="#1668e3" dot={false} />}{has('latency_ms') && <Line dataKey="latency" stroke="#b7791f" dot={false} />}</LineChart></Chart> : <Empty>Not available: dataset has no user or latency columns.</Empty>}</Card>
    </div>}</>
}

export function Forecast() {
  const { settings: s, forecast, metrics, setMetrics, runForecast, notify } = useApp()
  const [model, setModel] = useState(s.model), [h, setH] = useState(s.horizon_hours), [busy, setBusy] = useState(''), [err, setErr] = useState('')
  const joined = useJoined(168)
  const run = (kind) => async () => { setBusy(kind); setErr(''); try { if (kind === 'train') { setMetrics(await api.train(model)); notify('Model trained and evaluated.') } else { await runForecast(h); notify('Forecast generated.') } } catch (e) { setErr(e.message); notify(e.message, true) } finally { setBusy('') } }
  const m = metrics?.metrics?.[metrics.model_name]
  return <>
    <Head t="AI forecasting" s="Train a model on the chronological training split, then forecast recursively." />
    <div className="row noprint">
      <label>Model<select value={model} onChange={(e) => setModel(e.target.value)}><option value="hgb">Gradient Boosting</option><option value="rf">Random Forest</option></select></label>
      <label>Horizon<select value={h} onChange={(e) => setH(+e.target.value)}><option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option></select></label>
      <button className="btn alt" onClick={run('train')} disabled={!!busy}><Play size={16} />{busy === 'train' ? 'Training…' : 'Train model'}</button>
      <button className="btn" onClick={run('fc')} disabled={!!busy}><Play size={16} />{busy === 'fc' ? 'Forecasting…' : 'Generate forecast'}</button>
      <a className="btn alt" href="/api/reports/forecast.csv" download aria-disabled={!forecast}><Download size={16} />Forecast CSV</a>
    </div>
    {err && <div className="err" role="alert">{err}</div>}
    <div className="grid g3" style={{ marginBottom: 14 }}>
      <Kpi label="Model" value={metrics ? metrics.model_name.toUpperCase() : 'Not trained'} sub={metrics ? `${metrics.trained_rows} rows, test from ${metrics.test_start.slice(0, 10)}` : 'press Train model'} />
      <Kpi label="MAE / RMSE (Mbps)" value={m ? `${f1(m.mae)} / ${f1(m.rmse)}` : '–'} sub="24 h rolling backtest" />
      <Kpi label="R²" value={m?.r2 != null ? m.r2.toFixed(3) : '–'} sub="chronological holdout" />
    </div>
    <Card title="Forecast (Mbps)" note={forecast ? `Last observation ${forecast.last_observation}. Interval: ${forecast.interval}.` : ''}>{busy === 'fc' ? <Sk /> : forecast ? <Chart label="Forecast chart" h={340}><ComposedChart data={joined}>{axes}<Area dataKey="band" name="80% interval" stroke="none" fill="#1668e3" fillOpacity={0.15} /><Line dataKey="actual" name="History" stroke="#14243a" dot={false} /><Line dataKey="predicted" name="Forecast" stroke="#1668e3" dot={false} /></ComposedChart></Chart> : <Empty>No forecast yet. Press Generate forecast.</Empty>}</Card></>
}

export function Planner() {
  const { settings: s, forecast, analysis, runForecast, analyse, setAnalysis, notify } = useApp()
  const [f, setF] = useState({ capacity_mbps: s.capacity_mbps, target_util_pct: s.target_util_pct, growth_pct: 0, tiers: s.tiers.join(', ') })
  const [r, setR] = useState(analysis), [err, setErr] = useState(''), [h, setH] = useState(forecast?.horizon_hours || s.horizon_hours)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        if (!forecast || forecast.horizon_hours !== h) await runForecast(h)
        const out = await api.capacity({ capacity_mbps: +f.capacity_mbps, target_util_pct: +f.target_util_pct, growth_pct: +f.growth_pct, tiers: f.tiers.split(',').map((x) => +x.trim()).filter((x) => x > 0), watch_pct: s.watch_pct, near_pct: Math.min(s.near_pct, +f.target_util_pct) })
        setR(out); setAnalysis(out); setErr('')
      } catch (e) { setErr(e.message) }
    }, 350); return () => clearTimeout(t)
  }, [f, h])
  const cap = +f.capacity_mbps
  return <>
    <Head t="Capacity planner" s="Edit the inputs; results recalculate from the real forecast." />
    <div className="row"><label>Current capacity (Mbps)<input type="number" min="1" value={f.capacity_mbps} onChange={set('capacity_mbps')} /></label>
      <label>Target utilization (%)<input type="number" min="1" max="100" value={f.target_util_pct} onChange={set('target_util_pct')} /></label>
      <label>Extra growth (%)<input type="number" min="0" value={f.growth_pct} onChange={set('growth_pct')} /></label>
      <label>Horizon<select value={h} onChange={(e) => setH(+e.target.value)}><option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option></select></label>
      <label>Service tiers (Mbps)<input value={f.tiers} onChange={set('tiers')} /></label></div>
    {err && <div className="err" role="alert">{err}</div>}
    {!r ? <Sk h={160} /> : <>
      <div className="grid g3" style={{ marginBottom: 14 }}>
        <Kpi label="Forecast peak demand" value={`${f1(r.peak_demand_mbps)} Mbps`} sub={`average ${f1(r.avg_demand_mbps)} Mbps`} />
        <Kpi label="Peak utilization" value={`${f1(r.peak_utilization_pct)}%`} sub={<Status s={r.status} />} />
        <Kpi label="Headroom" value={`${f1(r.headroom_mbps)} Mbps`} sub="installed − peak" />
        <Kpi label="Recommended minimum" value={`${f1(r.recommended_capacity_mbps)} Mbps`} sub="peak ÷ target utilization" />
        <Kpi label="Capacity gap" value={`${f1(r.capacity_gap_mbps)} Mbps`} sub="max(0, recommended − current)" />
        <Kpi label="Recommended tier" value={r.recommended_tier_mbps ? `${r.recommended_tier_mbps} Mbps` : 'None fits'} sub="smallest tier ≥ recommended" />
      </div>
      <div className="grid g2">
        <Card title="Current vs recommended"><Chart label="Capacity comparison" h={200}><BarChart data={[{ n: 'Current', v: cap }, { n: 'Forecast peak', v: +r.peak_demand_mbps.toFixed(1) }, { n: 'Recommended', v: +r.recommended_capacity_mbps.toFixed(1) }]}><CartesianGrid stroke="#e3e9f0" /><XAxis dataKey="n" fontSize={12} /><YAxis fontSize={11} width={40} /><Tooltip /><Bar dataKey="v" name="Mbps" fill="#1668e3" /></BarChart></Chart></Card>
        <Card title="Explanation"><p>Peak utilization = {f1(r.peak_demand_mbps)} ÷ {cap} × 100 = {f1(r.peak_utilization_pct)}%. Recommended capacity = {f1(r.peak_demand_mbps)} ÷ {(+f.target_util_pct / 100).toFixed(2)} = {f1(r.recommended_capacity_mbps)} Mbps.</p>
          <p>{r.first_threshold_breach ? `Threshold first exceeded at ${r.first_threshold_breach}.` : 'Threshold not exceeded within the horizon.'} Extra growth is applied once, on top of the forecast.</p><p className="note">{r.note}</p></Card></div></>}</>
}

export function Datasets() {
  const { series, loadData, notify, runForecast, settings } = useApp()
  const [rep, setRep] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  useEffect(() => { api.summary().then((x) => setRep(x.report)) }, [series])
  const up = async (e) => { const file = e.target.files[0]; if (!file) return; setBusy(true); setErr('')
    try { const r = await api.upload(file); setRep(r.report); await loadData(); await runForecast(settings.horizon_hours).catch(() => {}); notify('Dataset uploaded and validated.') } catch (x) { setErr(x.message); notify(x.message, true) } finally { setBusy(false); e.target.value = '' } }
  return <>
    <Head t="Dataset manager" s="Required columns: timestamp, bandwidth_in_mbps. Optional: upload_mbps, download_mbps, active_users, latency_ms, packet_loss_pct. Hourly data."/>
    <div className="row noprint"><label className="btn" style={{ flexDirection: 'row', color: '#fff' }}><Upload size={16} />{busy ? 'Validating…' : 'Upload CSV'}<input type="file" accept=".csv" onChange={up} disabled={busy} style={{ display: 'none' }} /></label>
      <a className="btn alt" href="/api/dataset/sample" download><Download size={16} />Sample dataset</a></div>
    {err && <div className="err" role="alert">{err}</div>}
    {!rep ? <Sk h={160} /> : <div className="grid g2">
      <Card title="Validation report"><table><tbody>{[['Rows in', rep.rows_in], ['Rows after cleaning', rep.rows_out], ['Range', `${rep.start.slice(0, 16)} → ${rep.end.slice(0, 16)}`], ['Frequency', rep.frequency], ['Invalid timestamps dropped', rep.invalid_timestamps_dropped], ['Duplicate timestamps dropped', rep.duplicate_timestamps_dropped], ['Irregular intervals', rep.irregular_intervals]].map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
        {rep.warnings.map((w) => <p key={w} className="note">⚠ {w}</p>)}</Card>
      <Card title="Missing values (before → after fill)"><table><tbody>{Object.keys(rep.missing_before_fill).map((c) => <tr key={c}><th>{c}</th><td>{rep.missing_before_fill[c]} → {rep.missing_after_fill[c]}</td></tr>)}</tbody></table></Card>
      <Card title="Preview (latest 8 rows)"><div className="scroll"><table><thead><tr><th>timestamp</th>{series.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{series.rows.slice(-8).map((r) => <tr key={r.timestamp}><td>{r.timestamp}</td>{series.columns.map((c) => <td key={c}>{r[c] ?? '–'}</td>)}</tr>)}</tbody></table></div></Card></div>}</>
}

export function Evaluation() {
  const { metrics } = useApp()
  if (!metrics) return <><Head t="Model evaluation" s="Chronological holdout results." /><Card><Empty>No trained model yet. Go to AI Forecasting and press Train model.</Empty></Card></>
  const names = { baseline: 'Seasonal-naive baseline', hgb: 'Gradient Boosting', rf: 'Random Forest' }
  const bt = metrics.backtest, pts = bt.timestamps.slice(0, 168).map((t, i) => ({ t, actual: bt.actual[i], predicted: +bt.predicted[i].toFixed(2), residual: +(bt.actual[i] - bt.predicted[i]).toFixed(2) }))
  return <>
    <Head t="Model evaluation" s={`Train ≤ ${metrics.train_end.slice(0, 16)}; test ${metrics.test_start.slice(0, 16)} → ${metrics.test_end.slice(0, 16)}. Rolling 24-hour recursive forecasts.`} />
    <Card title="Model comparison" note="MAE/RMSE: average error in Mbps (lower is better). R²: share of variance explained (closer to 1 is better). MAPE ignores actuals ≤ 1 Mbps. The ML model is not guaranteed to beat the baseline; these are the measured values."><div className="scroll"><table><thead><tr><th>Model</th><th>MAE</th><th>RMSE</th><th>R²</th><th>MAPE %</th></tr></thead><tbody>{Object.entries(metrics.metrics).map(([k, m]) => <tr key={k}><td>{names[k]}{k === metrics.model_name && ' (selected)'}</td><td>{f1(m.mae)}</td><td>{f1(m.rmse)}</td><td>{m.r2?.toFixed(3)}</td><td>{f1(m.mape)}</td></tr>)}</tbody></table></div></Card>
    <div className="grid g2" style={{ marginTop: 14 }}>
      <Card title="Actual vs predicted (first 7 test days)"><Chart label="Actual vs predicted"><LineChart data={pts}>{axes}<Line dataKey="actual" stroke="#14243a" dot={false} /><Line dataKey="predicted" stroke="#1668e3" dot={false} /></LineChart></Chart></Card>
      <Card title="Residuals (actual − predicted)"><Chart label="Residuals"><BarChart data={pts}><CartesianGrid stroke="#e3e9f0" /><XAxis dataKey="t" tickFormatter={tick} minTickGap={40} fontSize={11} /><YAxis fontSize={11} width={40} /><Tooltip /><Bar dataKey="residual" fill="#b7791f" /></BarChart></Chart></Card></div></>
}

export function Reports() {
  const { settings: s, forecast, analysis: a, metrics, series } = useApp()
  const m = metrics?.metrics?.[metrics.model_name]
  const rows = [['Dataset', series.label], ['Rows', series.rows.length], ['Model', metrics?.model_name || forecast?.model || '–'], ['Forecast horizon', forecast ? `${forecast.horizon_hours} h from ${forecast.last_observation}` : '–'],
    ['Peak predicted demand', a ? `${f1(a.peak_demand_mbps)} Mbps` : '–'], ['Predicted peak utilization', a ? `${f1(a.peak_utilization_pct)}%` : '–'], ['Status', a?.status || '–'], ['Capacity gap', a ? `${f1(a.capacity_gap_mbps)} Mbps` : '–'],
    ['Recommended capacity', a ? `${f1(a.recommended_capacity_mbps)} Mbps (tier ${a.recommended_tier_mbps ?? 'none'})` : '–'], ['MAE / RMSE / R²', m ? `${f1(m.mae)} / ${f1(m.rmse)} / ${m.r2?.toFixed(3)}` : 'Train a model to see metrics'],
    ['Alert', a?.first_threshold_breach ? `Threshold ${s.target_util_pct}% first exceeded ${a.first_threshold_breach}` : 'No breach in horizon'], ['Rationale', a ? `Recommended = peak ÷ ${s.target_util_pct}% target utilization. ${a.note}` : '–']]
  return <><Head t="Reports" s="Capacity-planning summary. Export or print." />
    <div className="row noprint"><a className="btn" href="/api/reports/forecast.csv" download aria-disabled={!forecast}><Download size={16} />Forecast CSV</a><button className="btn alt" onClick={() => window.print()}><Printer size={16} />Print report</button></div>
    <Card title="NetCapacity AI: capacity planning report"><table><tbody>{rows.map(([k, v]) => <tr key={k}><th style={{ width: 220 }}>{k}</th><td>{v}</td></tr>)}</tbody></table></Card></>
}

export function SettingsPage() {
  const { settings, setSettings, notify } = useApp()
  const [f, setF] = useState({ ...settings, tiers: settings.tiers.join(', ') }), [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => { try { const out = await api.putSettings({ ...f, capacity_mbps: +f.capacity_mbps, target_util_pct: +f.target_util_pct, watch_pct: +f.watch_pct, near_pct: +f.near_pct, horizon_hours: +f.horizon_hours, tiers: f.tiers.split(',').map((x) => +x.trim()).filter((x) => x > 0) }); setSettings(out); setErr(''); notify('Settings saved.') } catch (e) { setErr(e.message); notify(e.message, true) } }
  return <><Head t="Settings" s="Stored by the backend and kept after restarts. Require watch < near ≤ target." />
    {err && <div className="err" role="alert">{err}</div>}
    <Card><div className="row">{[['capacity_mbps', 'Default capacity (Mbps)'], ['target_util_pct', 'Max utilization (%)'], ['watch_pct', 'Watch threshold (%)'], ['near_pct', 'Near-capacity threshold (%)']].map(([k, l]) => <label key={k}>{l}<input type="number" value={f[k]} onChange={set(k)} /></label>)}
      <label>Default horizon<select value={f.horizon_hours} onChange={set('horizon_hours')}><option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option></select></label>
      <label>Preferred model<select value={f.model} onChange={set('model')}><option value="hgb">Gradient Boosting</option><option value="rf">Random Forest</option></select></label>
      <label>Service tiers (Mbps)<input value={f.tiers} onChange={set('tiers')} /></label></div>
      <button className="btn" onClick={save}><Save size={16} />Save settings</button></Card></>
}
