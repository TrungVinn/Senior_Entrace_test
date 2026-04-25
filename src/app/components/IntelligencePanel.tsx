import { useState, useEffect } from 'react';
import {
  AlertTriangle, Tag, Layers,
  Activity, Zap, TrendingUp, TrendingDown, Minus, X, BarChart2, Clock, Sparkles, RefreshCw,
} from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { api, AISignal, AnomalyItem, MarketRegimeItem, MarketOverviewItem } from '../lib/api';

// ─── Gemini ───────────────────────────────────────────────────────────────────

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response from Gemini.';
}

function buildGeminiPrompt(
  symbol: string,
  sig: AISignal | null,
  regime: MarketRegimeItem | null,
  price: MarketOverviewItem | null,
  anomalies: AnomalyItem[],
): string {
  return `You are a quantitative crypto analyst. Analyze the following live market data and provide a concise trading signal.

Symbol: ${symbol}
Current Price: ${price?.close?.toFixed(2) ?? 'N/A'} USDT
RSI(14): ${price?.rsi14?.toFixed(1) ?? 'N/A'}

Algorithmic Signal:
- Signal: ${sig?.signal ?? 'N/A'} (score: ${sig?.score?.toFixed(2) ?? 'N/A'})
- RSI component: ${sig?.rsiComponent?.toFixed(2) ?? 'N/A'} (negative = oversold, positive = overbought)
- SMA component: ${sig?.smaComponent?.toFixed(2) ?? 'N/A'} (positive = bullish crossover)
- Volume component: ${sig?.volumeComponent?.toFixed(2) ?? 'N/A'} (positive = volume spike)

Market Regime: ${regime?.regime ?? 'N/A'} (confidence: ${regime ? Math.round(regime.confidence * 100) : 'N/A'}%)

Recent Anomalies (last 3):
${anomalies.slice(0, 3).map(a => `- ${a.severity.toUpperCase()} ${a.type}: ${a.description} (z=${a.zscore.toFixed(2)})`).join('\n') || '- None detected'}

Respond in exactly this format (no markdown, plain text):
SIGNAL: [BUY / SELL / HOLD]
CONFIDENCE: [HIGH / MEDIUM / LOW]
REASONING: [2-3 sentences explaining the key drivers]
RISK: [LOW / MEDIUM / HIGH] — [one sentence on main risk factor]`;
}

// ─── Gemini Signal Card ───────────────────────────────────────────────────────

function GeminiSignal({
  symbol, sig, regime, price, anomalies,
}: {
  symbol: string;
  sig: AISignal | null;
  regime: MarketRegimeItem | null;
  price: MarketOverviewItem | null;
  anomalies: AnomalyItem[];
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [response, setResponse] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset when symbol changes
  useEffect(() => { setStatus('idle'); setResponse(null); }, [symbol]);

  async function analyze() {
    setStatus('loading');
    setErrorMsg(null);
    try {
      const prompt = buildGeminiPrompt(symbol, sig, regime, price, anomalies);
      const text = await callGemini(prompt);
      setResponse(text);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
      setStatus('error');
    }
  }

  // Parse signal line for color
  const signalLine = response?.match(/SIGNAL:\s*(\w+)/i)?.[1]?.toUpperCase();
  const signalColor = signalLine === 'BUY' ? 'text-emerald-400' : signalLine === 'SELL' ? 'text-rose-400' : 'text-amber-400';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
          <Sparkles size={10} className="text-violet-400" /> Gemini LLM Signal
        </span>
        <button
          onClick={analyze}
          disabled={status === 'loading'}
          className="flex items-center gap-1.5 px-2 py-1 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[10px] font-semibold hover:bg-violet-500/20 transition-colors disabled:opacity-50"
        >
          {status === 'loading' ? (
            <RefreshCw size={10} className="animate-spin" />
          ) : (
            <Sparkles size={10} />
          )}
          {status === 'loading' ? 'Analyzing…' : status === 'done' ? 'Re-analyze' : 'Analyze'}
        </button>
      </div>

      {status === 'idle' && (
        <div className="p-3 bg-violet-500/5 border border-violet-500/10 rounded-lg text-center">
          <p className="text-[10px] text-slate-500">Click Analyze to get Gemini LLM prediction for {symbol}</p>
        </div>
      )}

      {status === 'loading' && (
        <div className="p-3 bg-violet-500/5 border border-violet-500/10 rounded-lg flex items-center gap-2">
          <RefreshCw size={12} className="animate-spin text-violet-400 shrink-0" />
          <span className="text-[10px] text-slate-400">Sending market data to Gemini…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="p-3 bg-rose-500/5 border border-rose-500/20 rounded-lg">
          <p className="text-[10px] text-rose-400">{errorMsg}</p>
        </div>
      )}

      {status === 'done' && response && (
        <div className="p-3 bg-violet-500/5 border border-violet-500/15 rounded-lg flex flex-col gap-2">
          {signalLine && (
            <span className={`text-sm font-bold font-mono ${signalColor}`}>{signalLine}</span>
          )}
          <p className="text-[10px] text-slate-300 leading-relaxed whitespace-pre-line">{response}</p>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function latestPerSymbol<T extends { symbol: string; timestamp: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const existing = map.get(item.symbol);
    if (!existing || new Date(item.timestamp) > new Date(existing.timestamp)) {
      map.set(item.symbol, item);
    }
  }
  return Array.from(map.values());
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function whyText(sig: AISignal): string {
  const parts: string[] = [];
  if (sig.rsiComponent <= -0.4) parts.push('RSI oversold');
  else if (sig.rsiComponent >= 0.4) parts.push('RSI overbought');
  if (sig.smaComponent >= 0.4) parts.push('bullish SMA crossover');
  else if (sig.smaComponent <= -0.4) parts.push('bearish SMA');
  if (sig.volumeComponent >= 0.4) parts.push('volume spike');
  else if (sig.volumeComponent <= -0.4) parts.push('volume weak');
  return parts.length > 0 ? parts.join(' + ') : 'mixed signals';
}

function signalStyle(signal: string) {
  if (signal === 'BUY') return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-500' };
  if (signal === 'SELL') return { bg: 'bg-rose-500/10', text: 'text-rose-400', dot: 'bg-rose-500' };
  return { bg: 'bg-slate-500/10', text: 'text-slate-400', dot: 'bg-slate-500' };
}

function regimeStyle(regime: string) {
  if (regime === 'high_volatility') return { bg: 'bg-rose-500/10', text: 'text-rose-400', bar: 'bg-rose-500', label: 'HIGH VOL' };
  if (regime === 'medium_volatility') return { bg: 'bg-amber-500/10', text: 'text-amber-400', bar: 'bg-amber-500', label: 'MED VOL' };
  return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', bar: 'bg-emerald-500', label: 'LOW VOL' };
}

function severityStyle(s: string) {
  if (s === 'high') return { dot: 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]', text: 'text-rose-400', border: 'border-rose-500/40' };
  if (s === 'medium') return { dot: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500/40' };
  return { dot: 'bg-slate-500', text: 'text-slate-400', border: 'border-slate-500/20' };
}

// ─── Score bar (centered, -1 → +1) ───────────────────────────────────────────

function ScoreBar({ value, label }: { value: number; label: string }) {
  const pct = Math.abs(value) * 50;
  const isPos = value >= 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-slate-500 uppercase tracking-wider w-7 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full relative overflow-hidden">
        <div
          className={`absolute top-0 h-full rounded-full ${isPos ? 'bg-emerald-500' : 'bg-rose-500'}`}
          style={{ left: isPos ? '50%' : `${50 - pct}%`, width: `${pct}%` }}
        />
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/20" />
      </div>
      <span className={`text-[10px] font-mono w-10 text-right shrink-0 ${isPos ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
        {isPos ? '+' : ''}{value.toFixed(2)}
      </span>
    </div>
  );
}

// ─── Market Pulse (top summary row) ──────────────────────────────────────────

function MarketPulse({
  signals, anomalies, regimes, lagMinutes, isStale,
}: {
  signals: AISignal[] | null;
  anomalies: AnomalyItem[] | null;
  regimes: MarketRegimeItem[] | null;
  lagMinutes: number | null;
  isStale: boolean;
}) {
  const latest = signals ? latestPerSymbol(signals) : [];
  const buy = latest.filter(s => s.signal === 'BUY').length;
  const sell = latest.filter(s => s.signal === 'SELL').length;
  const neutral = latest.filter(s => s.signal === 'NEUTRAL').length;

  const recentAnomaly = anomalies?.filter(a => Date.now() - new Date(a.timestamp).getTime() < 3_600_000) ?? [];
  const highA = recentAnomaly.filter(a => a.severity === 'high').length;
  const medA = recentAnomaly.filter(a => a.severity === 'medium').length;

  const regimeCounts = (regimes ? latestPerSymbol(regimes) : []).reduce<Record<string, number>>((acc, r) => {
    acc[r.regime] = (acc[r.regime] || 0) + 1;
    return acc;
  }, {});
  const topRegime = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const rs = topRegime ? regimeStyle(topRegime) : null;

  return (
    <div className="shrink-0 grid grid-cols-5 gap-2">
      {/* Dominant regime */}
      <div className={`rounded-lg border border-white/5 p-3 flex flex-col gap-0.5 ${rs?.bg ?? 'bg-white/[0.02]'}`}>
        <span className="text-[9px] text-slate-500 uppercase tracking-widest">Dominant Regime</span>
        <span className={`text-sm font-bold ${rs?.text ?? 'text-slate-400'}`}>{rs?.label ?? '—'}</span>
        <span className="text-[9px] text-slate-600">across {latest.length} symbols</span>
      </div>

      {/* Signal breakdown */}
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 flex flex-col gap-0.5">
        <span className="text-[9px] text-slate-500 uppercase tracking-widest">Signal Mix</span>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-emerald-400 font-bold font-mono">{buy}<span className="text-[9px] ml-0.5">B</span></span>
          <span className="text-rose-400 font-bold font-mono">{sell}<span className="text-[9px] ml-0.5">S</span></span>
          <span className="text-slate-500 font-bold font-mono">{neutral}<span className="text-[9px] ml-0.5">N</span></span>
        </div>
        <span className="text-[9px] text-slate-600">latest per symbol</span>
      </div>

      {/* Anomalies */}
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 flex flex-col gap-0.5">
        <span className="text-[9px] text-slate-500 uppercase tracking-widest">Anomalies (1h)</span>
        <div className="flex items-baseline gap-2 mt-0.5">
          {highA > 0 && <span className="text-rose-400 font-bold">{highA}<span className="text-[9px] ml-0.5 text-rose-500">H</span></span>}
          {medA > 0 && <span className="text-amber-400 font-bold">{medA}<span className="text-[9px] ml-0.5 text-amber-500">M</span></span>}
          {highA === 0 && medA === 0 && <span className="text-emerald-400 font-bold text-sm">Clean</span>}
        </div>
        <span className="text-[9px] text-slate-600">{recentAnomaly.length} total detections</span>
      </div>

      {/* Symbols */}
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 flex flex-col gap-0.5">
        <span className="text-[9px] text-slate-500 uppercase tracking-widest">Coverage</span>
        <span className="text-sm font-bold text-white mt-0.5">{latest.length} symbols</span>
        <span className="text-[9px] text-slate-600">with active signals</span>
      </div>

      {/* AI freshness */}
      <div className={`rounded-lg border p-3 flex flex-col gap-0.5 ${isStale ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
        <div className="flex items-center gap-1.5">
          <Clock size={9} className={isStale ? 'text-amber-400' : 'text-slate-500'} />
          <span className="text-[9px] text-slate-500 uppercase tracking-widest">Last AI Run</span>
          {isStale && (
            <span className="ml-auto text-[8px] font-bold bg-amber-500/20 text-amber-400 px-1 rounded">STALE</span>
          )}
        </div>
        <span className={`text-sm font-bold font-mono mt-0.5 ${isStale ? 'text-amber-400' : 'text-white'}`}>
          {lagMinutes === null ? '—' : lagMinutes < 1 ? 'just now' : `${lagMinutes}m ago`}
        </span>
        <span className="text-[9px] text-slate-600">{isStale ? 'runner may be stopped' : 'data is fresh'}</span>
      </div>
    </div>
  );
}

// ─── Signal Center (table) ────────────────────────────────────────────────────

function SignalTable({
  signals, selectedSymbol, onSelect,
}: {
  signals: AISignal[] | null;
  selectedSymbol: string | null;
  onSelect: (sym: string | null) => void;
}) {
  const rows = signals
    ? latestPerSymbol(signals).sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    : [];

  return (
    <div className="flex flex-col bg-[#0b0e17] rounded-lg border border-white/5 overflow-hidden flex-1 min-h-0">
      <div className="px-4 py-2.5 border-b border-white/5 bg-[#080b13] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Tag size={13} className="text-cyan-400" />
          <span className="text-white font-bold tracking-widest text-xs uppercase">Signal Center</span>
        </div>
        <span className="text-[9px] text-slate-600">click row · detail panel opens</span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[72px_80px_60px_auto] gap-x-3 px-4 py-1.5 border-b border-white/[0.03] bg-[#080b13] shrink-0">
        {['Symbol', 'Signal · Score', 'Age', 'Why'].map(h => (
          <span key={h} className="text-[9px] text-slate-500 uppercase tracking-widest">{h}</span>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto hide-scrollbar">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center p-10 text-slate-500 text-sm">
            {signals === null ? 'Loading signals…' : 'No signals — start the AI runner'}
          </div>
        ) : rows.map(sig => {
          const s = signalStyle(sig.signal);
          const isSelected = sig.symbol === selectedSymbol;
          return (
            <button
              key={sig.symbol}
              onClick={() => onSelect(isSelected ? null : sig.symbol)}
              className={`w-full grid grid-cols-[72px_80px_60px_auto] gap-x-3 px-4 py-3 border-b border-white/[0.03] text-left transition-colors
                ${isSelected
                  ? 'bg-cyan-500/10 border-l-[3px] border-l-cyan-500'
                  : 'hover:bg-white/[0.025] border-l-[3px] border-l-transparent'}`}
            >
              <span className="font-bold text-xs text-white self-center">{sig.symbol}</span>
              <div className="flex items-center gap-1.5 self-center">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${s.bg} ${s.text}`}>{sig.signal}</span>
                <span className={`text-xs font-mono font-bold ${s.text}`}>{sig.score >= 0 ? '+' : ''}{sig.score.toFixed(2)}</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono self-center">{timeAgo(sig.timestamp)}</span>
              <span className="text-[10px] text-slate-400 self-center leading-relaxed">{whyText(sig)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Regime Matrix ────────────────────────────────────────────────────────────

function RegimeMatrix({ regimes }: { regimes: MarketRegimeItem[] | null }) {
  const rows = regimes
    ? latestPerSymbol(regimes).sort((a, b) => b.confidence - a.confidence)
    : [];

  return (
    <div className="flex flex-col bg-[#0b0e17] rounded-lg border border-white/5 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 bg-[#080b13] flex items-center gap-2 shrink-0">
        <Layers size={13} className="text-indigo-400" />
        <span className="text-white font-bold tracking-widest text-xs uppercase">Regime Matrix</span>
      </div>
      <div className="p-3 flex flex-col gap-2">
        {rows.length === 0 ? (
          <div className="text-center text-slate-600 text-xs py-3">{regimes === null ? 'Loading…' : 'No regime data'}</div>
        ) : rows.map(r => {
          const rs = regimeStyle(r.regime);
          const pct = Math.round(r.confidence * 100);
          return (
            <div key={r.symbol} className={`rounded-lg p-2.5 border border-white/[0.04] ${rs.bg}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-xs text-white">{r.symbol}</span>
                <span className={`text-[10px] font-mono font-bold uppercase ${rs.text}`}>{rs.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${rs.bar}`} style={{ width: `${pct}%` }} />
                </div>
                <span className={`text-[9px] font-mono shrink-0 ${rs.text}`}>{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Anomaly Timeline ─────────────────────────────────────────────────────────

function AnomalyTimeline({ anomalies }: { anomalies: AnomalyItem[] | null }) {
  const items = anomalies
    ? [...anomalies].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 12)
    : [];

  return (
    <div className="flex flex-col bg-[#0b0e17] rounded-lg border border-white/5 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 bg-[#080b13] flex items-center gap-2 shrink-0">
        <Zap size={13} className="text-indigo-400" />
        <span className="text-white font-bold tracking-widest text-xs uppercase">Anomaly Timeline</span>
      </div>
      <div className="p-3">
        {items.length === 0 ? (
          <div className="text-center text-slate-600 text-xs py-3">
            {anomalies === null ? 'Loading…' : 'No anomalies detected — market stable'}
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-[6px] top-2 bottom-2 w-px bg-white/[0.06]" />
            <div className="flex flex-col gap-3 pl-5">
              {items.map((a, i) => {
                const ss = severityStyle(a.severity);
                return (
                  <div key={i} className="relative">
                    <div className={`absolute -left-5 top-1 w-3 h-3 rounded-full border border-[#0b0e17] ${ss.dot}`} />
                    <div className={`border-l-2 ${ss.border} pl-2.5 py-0.5`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${ss.text}`}>{a.severity}</span>
                        <span className="text-[10px] font-bold text-white">{a.symbol}</span>
                        <span className="text-[9px] text-slate-600 font-mono">{a.type.replace(/_/g, ' ')}</span>
                        <span className="text-[9px] text-slate-600 font-mono ml-auto">z={a.zscore.toFixed(2)}</span>
                        <span className="text-[9px] text-slate-600 font-mono">{timeAgo(a.timestamp)}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{a.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Market Story ─────────────────────────────────────────────────────────────

type Mood      = 'Calm' | 'Active' | 'Volatile';
type Direction = 'Up' | 'Flat' | 'Down';
type Attention = 'Normal' | 'Watch Closely' | 'Risky';

function buildMarketStory(
  ov: MarketOverviewItem | null,
  sig: AISignal | null,
  regime: MarketRegimeItem | null,
  recent: AnomalyItem[],
): { mood: Mood; direction: Direction; attention: Attention; sentences: string[] } {
  // Direction
  let direction: Direction = 'Flat';
  if (ov?.sma7 != null) {
    if (ov.close > ov.sma7 * 1.002)      direction = 'Up';
    else if (ov.close < ov.sma7 * 0.998) direction = 'Down';
  } else if (sig != null) {
    if (sig.score > 0.2)       direction = 'Up';
    else if (sig.score < -0.2) direction = 'Down';
  }

  // Mood & Attention
  const hasHighA = recent.some(a => a.severity === 'high');
  const hasMedA  = recent.some(a => a.severity === 'medium');
  let mood: Mood; let attention: Attention;
  if (regime?.regime === 'high_volatility' || hasHighA) {
    mood = 'Volatile'; attention = 'Risky';
  } else if (regime?.regime === 'medium_volatility' || hasMedA) {
    mood = 'Active'; attention = 'Watch Closely';
  } else if (regime?.regime === 'low_volatility') {
    mood = 'Calm'; attention = 'Normal';
  } else {
    mood = 'Active'; attention = 'Watch Closely';
  }

  // Story sentences
  if (!ov && !sig) {
    return { mood, direction, attention, sentences: [
      'Not enough data to tell the full market story yet, but the system is still monitoring this symbol.',
    ]};
  }

  const s: string[] = [];
  if (direction === 'Up')        s.push('Price is leaning upward in the short term.');
  else if (direction === 'Down') s.push('Price is showing weakness compared to the recent trend.');
  else                           s.push('The market is moving sideways with no clear direction.');

  if (regime?.regime === 'high_volatility')        s.push('Volatility is elevated — keep a close eye on this one.');
  else if (regime?.regime === 'medium_volatility') s.push('Market activity is picking up above the usual baseline.');
  else if (regime?.regime === 'low_volatility')    s.push('Conditions are relatively quiet and stable.');

  const rsi = ov?.rsi14;
  if (rsi != null) {
    if (rsi > 70)      s.push('Momentum is running hot — potential overbought territory.');
    else if (rsi < 30) s.push('Selling pressure is heavy — a potential recovery zone.');
  }

  if (recent.length > 0) s.push('Unusual price movement has been detected recently — worth monitoring.');

  return { mood, direction, attention, sentences: s };
}

function MarketStory({
  selectedSymbol, signals, regimes, overview, anomalies,
}: {
  selectedSymbol: string | null;
  signals:   AISignal[]           | null;
  regimes:   MarketRegimeItem[]   | null;
  overview:  MarketOverviewItem[] | null;
  anomalies: AnomalyItem[]        | null;
}) {
  const latestSigs = signals ? latestPerSymbol(signals) : [];
  const strongest  = [...latestSigs].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
  const symbol = selectedSymbol ?? strongest?.symbol ?? 'BTCUSDT';

  const sig    = latestSigs.find(s => s.symbol === symbol) ?? null;
  const regime = regimes ? latestPerSymbol(regimes).find(r => r.symbol === symbol) ?? null : null;
  const ov     = overview?.find(o => o.symbol === symbol) ?? null;
  const recent = anomalies
    ? anomalies
        .filter(a => a.symbol === symbol && Date.now() - new Date(a.timestamp).getTime() < 3_600_000)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 3)
    : [];

  const noData = !ov && !sig && !regime;
  const { mood, direction, attention, sentences } = buildMarketStory(ov, sig, regime, recent);

  const moodCls: Record<Mood, string> = {
    Calm:     'bg-emerald-500/10 text-emerald-400',
    Active:   'bg-amber-500/10   text-amber-400',
    Volatile: 'bg-rose-500/10    text-rose-400',
  };
  const moodDot: Record<Mood, string> = {
    Calm: 'bg-emerald-500', Active: 'bg-amber-500', Volatile: 'bg-rose-500',
  };
  const attCls: Record<Attention, string> = {
    Normal:          'bg-emerald-500/10 text-emerald-400',
    'Watch Closely': 'bg-amber-500/10   text-amber-400',
    Risky:           'bg-rose-500/10    text-rose-400',
  };
  const dirCls: Record<Direction, string> = {
    Up: 'text-emerald-400', Flat: 'text-slate-400', Down: 'text-rose-400',
  };

  return (
    <div className="flex flex-col bg-[#0b0e17] rounded-lg border border-white/5 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 bg-[#080b13] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={13} className="text-cyan-400" />
          <span className="text-white font-bold tracking-widest text-xs uppercase">Market Story</span>
        </div>
        <span className="text-[9px] font-mono font-bold text-slate-400 bg-white/[0.04] px-1.5 py-0.5 rounded">
          {symbol.replace('USDT', '')}
        </span>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* Badges */}
        <div className="flex gap-1.5 flex-wrap">
          <span className={`flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded ${moodCls[mood]}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${moodDot[mood]}`} />
            {mood}
          </span>
          <span className={`flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-white/[0.04] ${dirCls[direction]}`}>
            {direction === 'Up'   && <TrendingUp   size={9} />}
            {direction === 'Flat' && <Minus        size={9} />}
            {direction === 'Down' && <TrendingDown size={9} />}
            {direction}
          </span>
          <span className={`flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded ${attCls[attention]}`}>
            {attention}
          </span>
        </div>

        {/* Story */}
        <p className={`text-[10px] leading-relaxed ${noData ? 'text-slate-500 italic' : 'text-slate-300'}`}>
          {sentences.join(' ')}
        </p>
      </div>
    </div>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────

function DetailDrawer({
  symbol, signals, anomalies, regimes, overview, onClose,
}: {
  symbol: string;
  signals: AISignal[] | null;
  anomalies: AnomalyItem[] | null;
  regimes: MarketRegimeItem[] | null;
  overview: MarketOverviewItem[] | null;
  onClose: () => void;
}) {
  const sig = signals ? latestPerSymbol(signals).find(s => s.symbol === symbol) : null;
  const regime = regimes ? latestPerSymbol(regimes).find(r => r.symbol === symbol) : null;
  const price = overview?.find(o => o.symbol === symbol);
  const symbolAnomalies = anomalies
    ? [...anomalies].filter(a => a.symbol === symbol)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 4)
    : [];

  const s = sig ? signalStyle(sig.signal) : null;
  const rs = regime ? regimeStyle(regime.regime) : null;

  const explanation = sig
    ? sig.signal === 'BUY'
      ? [
          sig.rsiComponent < -0.3 && 'RSI đang oversold',
          sig.smaComponent > 0.3 && 'giá vượt SMA ngắn hạn',
          sig.volumeComponent > 0.3 && 'volume xác nhận xu hướng tăng',
        ].filter(Boolean).join(', ') || 'tín hiệu hỗn hợp'
      : sig.signal === 'SELL'
      ? [
          sig.rsiComponent > 0.3 && 'RSI overbought',
          sig.smaComponent < -0.3 && 'giá dưới SMA ngắn hạn',
          sig.volumeComponent < -0.3 && 'volume suy yếu',
        ].filter(Boolean).join(', ') || 'tín hiệu hỗn hợp'
      : null
    : null;

  return (
    <div className="flex flex-col h-full bg-[#0b0e17] border border-white/5 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/5 bg-[#080b13] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {s && sig && (
            <div className={`w-2 h-2 rounded-full ${s.dot}`} />
          )}
          <span className="font-bold text-white text-sm">{symbol}</span>
          {s && sig && (
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${s.bg} ${s.text}`}>{sig.signal}</span>
          )}
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-0.5">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto hide-scrollbar p-4 flex flex-col gap-4">
        {/* Price */}
        {price && (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-white">
              {price.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs text-slate-500">USDT</span>
            {price.rsi14 != null && (
              <span className="ml-auto text-[10px] font-mono text-slate-500">RSI {price.rsi14.toFixed(1)}</span>
            )}
          </div>
        )}

        {/* Score breakdown */}
        {sig && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                <BarChart2 size={10} /> Score Breakdown
              </span>
              <span className={`text-sm font-mono font-bold ${s?.text}`}>
                {sig.score >= 0 ? '+' : ''}{sig.score.toFixed(2)}
              </span>
            </div>
            <div className="p-3 bg-white/[0.02] rounded-lg border border-white/[0.04] flex flex-col gap-2.5">
              <ScoreBar value={sig.rsiComponent} label="RSI" />
              <ScoreBar value={sig.smaComponent} label="SMA" />
              <ScoreBar value={sig.volumeComponent} label="Vol" />
            </div>
          </div>
        )}

        {/* Regime */}
        {regime && rs && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] text-slate-500 uppercase tracking-widest">Market Regime</span>
            <div className={`flex flex-col gap-2 p-2.5 rounded-lg border border-white/[0.04] ${rs.bg}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold uppercase ${rs.text}`}>{rs.label}</span>
                <span className={`text-xs font-mono ${rs.text}`}>{Math.round(regime.confidence * 100)}% conf</span>
              </div>
              <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${rs.bar}`} style={{ width: `${Math.round(regime.confidence * 100)}%` }} />
              </div>
            </div>
          </div>
        )}

        {/* Explanation */}
        {sig && explanation && (
          <div className="p-3 bg-white/[0.015] rounded-lg border border-white/[0.04]">
            <p className="text-[11px] text-slate-300 leading-relaxed">
              <span className={`font-bold ${s?.text}`}>{sig.signal}</span>{' '}
              vì {explanation}.
            </p>
          </div>
        )}

        {/* Recent anomalies */}
        {symbolAnomalies.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
              <AlertTriangle size={10} /> Recent Anomalies
            </span>
            {symbolAnomalies.map((a, i) => {
              const ss = severityStyle(a.severity);
              return (
                <div key={i} className={`border-l-2 ${ss.border} pl-2.5 py-1`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase ${ss.text}`}>{a.severity}</span>
                    <span className="text-[9px] text-slate-600 font-mono">{a.type.replace(/_/g, ' ')}</span>
                    <span className="text-[9px] text-slate-600 font-mono ml-auto">{timeAgo(a.timestamp)}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{a.description}</p>
                </div>
              );
            })}
          </div>
        )}

        {symbolAnomalies.length === 0 && anomalies !== null && (
          <div className="flex items-center gap-2 p-2.5 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-[11px] text-emerald-400">No anomalies detected for {symbol}</span>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Gemini Panel (standalone, always visible) ────────────────────────────────

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];

function GeminiPanel({
  activeSymbol,
  signals, regimes, overview, anomalies,
}: {
  activeSymbol: string | null;
  signals: AISignal[] | null;
  regimes: MarketRegimeItem[] | null;
  overview: MarketOverviewItem[] | null;
  anomalies: AnomalyItem[] | null;
}) {
  const [geminiSymbol, setGeminiSymbol] = useState<string>('BTCUSDT');

  useEffect(() => {
    if (activeSymbol) setGeminiSymbol(activeSymbol);
  }, [activeSymbol]);

  const sig = signals ? latestPerSymbol(signals).find(s => s.symbol === geminiSymbol) ?? null : null;
  const regime = regimes ? latestPerSymbol(regimes).find(r => r.symbol === geminiSymbol) ?? null : null;
  const price = overview?.find(o => o.symbol === geminiSymbol) ?? null;
  const symbolAnomalies = anomalies
    ? [...anomalies]
        .filter(a => a.symbol === geminiSymbol)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 3)
    : [];

  return (
    <div className="flex flex-col bg-[#0b0e17] rounded-lg border border-violet-500/20 overflow-hidden shrink-0">
      <div className="px-3 py-2 border-b border-violet-500/10 bg-[#080b13] flex items-center justify-between shrink-0">
        <span className="text-[9px] text-violet-400 uppercase tracking-widest flex items-center gap-1.5 font-bold">
          <Sparkles size={10} /> LLM Signal
        </span>
        <div className="flex gap-0.5">
          {SYMBOLS.map(sym => (
            <button
              key={sym}
              onClick={() => setGeminiSymbol(sym)}
              className={`text-[8px] px-1.5 py-0.5 rounded font-mono font-bold transition-colors ${
                geminiSymbol === sym
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
                  : 'text-slate-600 hover:text-slate-300 border border-transparent'
              }`}
            >
              {sym.replace('USDT', '')}
            </button>
          ))}
        </div>
      </div>
      <div className="p-3">
        <GeminiSignal symbol={geminiSymbol} sig={sig} regime={regime} price={price} anomalies={symbolAnomalies} />
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function IntelligencePanel({ onSymbolSelect }: { onSymbolSelect?: (sym: string) => void }) {
  const { data: signals } = usePolling(() => api.getAISignals(), 10_000);
  const { data: anomalies } = usePolling(() => api.getAnomalies(), 10_000);
  const { data: regimes } = usePolling(() => api.getRegime(), 30_000);
  const { data: overview } = usePolling(() => api.getMarketOverview(), 5_000);

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  function selectSymbol(sym: string | null) {
    setSelectedSymbol(sym);
    if (sym) onSymbolSelect?.(sym);
  }
  const [now, setNow] = useState(Date.now());

  // Clock for staleness check
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  // Freshness
  const latestTs = signals?.length
    ? signals.reduce((a, b) => new Date(a.timestamp) > new Date(b.timestamp) ? a : b).timestamp
    : null;
  const lagMinutes = latestTs ? Math.floor((now - new Date(latestTs).getTime()) / 60_000) : null;
  const isStale = lagMinutes !== null && lagMinutes > 5;

  return (
    <div className="flex flex-col h-full min-h-0 gap-2 text-slate-300">
      {/* Row 1: Market Pulse */}
      <MarketPulse
        signals={signals} anomalies={anomalies} regimes={regimes}
        lagMinutes={lagMinutes} isStale={isStale}
      />

      {/* Row 2: Main content + right panel */}
      <div className="flex-1 min-h-0 flex gap-2">
        {/* Left: Signal Center */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-2">
          <SignalTable signals={signals} selectedSymbol={selectedSymbol} onSelect={selectSymbol} />

          {/* Bottom row: Market Story + Anomaly Timeline */}
          <div className="shrink-0 grid grid-cols-2 gap-2">
            <MarketStory
              selectedSymbol={selectedSymbol}
              signals={signals}
              regimes={regimes}
              overview={overview}
              anomalies={anomalies}
            />
            <AnomalyTimeline anomalies={anomalies} />
          </div>
        </div>

        {/* Right column: always visible */}
        <div className="shrink-0 flex flex-col gap-2 min-h-0 w-72">
          {/* Top: Detail Drawer (when selected) or Regime Matrix */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {selectedSymbol ? (
              <DetailDrawer
                symbol={selectedSymbol}
                signals={signals}
                anomalies={anomalies}
                regimes={regimes}
                overview={overview}
                onClose={() => selectSymbol(null)}
              />
            ) : (
              <RegimeMatrix regimes={regimes} />
            )}
          </div>

          {/* Bottom: Gemini LLM Panel — always visible */}
          <GeminiPanel
            activeSymbol={selectedSymbol}
            signals={signals}
            regimes={regimes}
            overview={overview}
            anomalies={anomalies}
          />
        </div>
      </div>
    </div>
  );
}
