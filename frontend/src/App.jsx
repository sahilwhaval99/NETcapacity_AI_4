import React, { useEffect, useState, useCallback } from 'react'
import { Activity, BarChart3, BrainCircuit, Gauge, Database, FlaskConical, FileText, Settings as Cog, Menu, Network } from 'lucide-react'
import { api } from './api.js'
import { Ctx } from './ctx.js'
import { Overview, Traffic, Forecast, Planner, Datasets, Evaluation, Reports, SettingsPage } from './pages.jsx'

const NAV = [['overview', 'Overview', Activity, Overview], ['traffic', 'Traffic Analytics', BarChart3, Traffic], ['forecast', 'AI Forecasting', BrainCircuit, Forecast],
  ['planner', 'Capacity Planner', Gauge, Planner], ['datasets', 'Dataset Manager', Database, Datasets], ['evaluation', 'Model Evaluation', FlaskConical, Evaluation],
  ['reports', 'Reports', FileText, Reports], ['settings', 'Settings', Cog, SettingsPage]]

export default function App() {
  const [page, setPage] = useState(location.hash.slice(1) || 'overview')
  const [col, setCol] = useState(false), [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(null), [series, setSeries] = useState(null), [forecast, setForecast] = useState(null)
  const [analysis, setAnalysis] = useState(null), [metrics, setMetrics] = useState(null), [toast, setToast] = useState(null), [boot, setBoot] = useState(null)
  const notify = useCallback((msg, bad) => { setToast({ msg, bad }); setTimeout(() => setToast(null), 4000) }, [])
  const go = (p) => { setPage(p); location.hash = p; setOpen(false) }

  const analyse = useCallback(async (s) => api.capacity({ capacity_mbps: s.capacity_mbps, target_util_pct: s.target_util_pct, watch_pct: s.watch_pct, near_pct: s.near_pct, tiers: s.tiers }), [])
  const runForecast = useCallback(async (h, s) => {
    const f = await api.forecast(h); setForecast(f); api.metrics().then(setMetrics).catch(() => {}); setAnalysis(await analyse(s || settings)); return f
  }, [analyse, settings])
  const loadData = useCallback(async () => { setSeries(await api.series()); setForecast(null); setAnalysis(null); setMetrics(null) }, [])

  useEffect(() => { (async () => {
    try {
      const s = await api.settings(); setSettings(s); await loadData()
      await runForecast(s.horizon_hours, s)
    } catch (e) { setBoot(e.message) }
  })() }, [])

  const Page = (NAV.find((n) => n[0] === page) || NAV[0])[3]
  const label = series?.label || 'Loading…'
  return (
    <Ctx.Provider value={{ settings, setSettings, series, forecast, analysis, setAnalysis, metrics, setMetrics, runForecast, loadData, notify, analyse }}>
      <div className={'app' + (col ? ' col' : '')}>
        <nav className={'side' + (open ? ' open' : '')} aria-label="Main">
          <div className="brand"><Network size={26} color="#4da3ff" /><div>NetCapacity AI<small>Intelligent Network Forecasting & Capacity Planning</small></div></div>
          {NAV.map(([id, name, Icon]) => <button key={id} className="nav" aria-current={page === id ? 'page' : undefined} onClick={() => go(id)} title={name}><Icon size={18} /><span className="lbl">{name}</span></button>)}
        </nav>
        <div className="main">
          <header className="top">
            <button className="ib" aria-label="Toggle sidebar" onClick={() => (window.innerWidth < 820 ? setOpen(!open) : setCol(!col))}><Menu size={18} /></button>
            <strong>{(NAV.find((n) => n[0] === page) || NAV[0])[1]}</strong><span style={{ flex: 1 }} />
            <span className={'badge' + (label.startsWith('Demo') ? ' demo' : '')}>{label}</span>
          </header>
          <main className="content">
            {boot && <div className="err" role="alert">Cannot reach the backend: {boot}. Start it with <code>uvicorn app.main:app --reload</code> in the backend folder.</div>}
            {settings && series ? <Page /> : !boot && <div className="grid g3">{[1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 96 }} />)}</div>}
          </main>
          <footer className="foot">Academic Machine Learning project (B.Tech AI &amp; DS). Demo data is synthetic. Forecasts are planning estimates, not engineering guarantees.</footer>
        </div>
        {toast && <div className={'toast' + (toast.bad ? ' bad' : '')} role="status" aria-live="polite">{toast.msg}</div>}
      </div>
    </Ctx.Provider>
  )
}
