import { useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, ChevronUp, ChevronDown, RefreshCw, Sparkles } from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { api, MarketOverviewItem, AISignal, MarketRegimeItem } from '../lib/api';

const COIN_META: Record<string, { name: string; color: string; icon: string }> = {
  BTCUSDT: { name: 'Bitcoin',  color: '#F7931A', icon: '₿' },
  ETHUSDT: { name: 'Ethereum', color: '#627EEA', icon: 'Ξ' },
  BNBUSDT: { name: 'BNB Chain', color: '#F3BA2F', icon: 'B' },
  SOLUSDT: { name: 'Solana',   color: '#9945FF', icon: '◎' },
  XRPUSDT: { name: 'Ripple',   color: '#00AAE4', icon: '✕' },
};

function fmtVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function latestPer<T extends { symbol: string; timestamp: string }>(items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const ex = map.get(item.symbol);
    if (!ex || new Date(item.timestamp) > new Date(ex.timestamp)) map.set(item.symbol, item);
  }
  return map;
}

type SortKey = 'price' | 'rsi14' | 'score' | 'volatility' | 'volume';
type FilterKey = 'ALL' | 'BUY' | 'SELL' | 'NEUTRAL' | 'HIGH_VOL';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL',      label: 'All' },
  { key: 'BUY',      label: 'Buy signals' },
  { key: 'SELL',     label: 'Sell signals' },
  { key: 'NEUTRAL',  label: 'Neutral' },
  { key: 'HIGH_VOL', label: 'High Vol' },
];

const COLS: { label: string; key: SortKey | null }[] = [
  { label: 'Asset',         key: null },
  { label: 'Price',         key: 'price' },
  { label: 'RSI(14)',       key: 'rsi14' },
  { label: 'Volume',        key: 'volume' },
  { label: 'vs SMA7',       key: null },
  { label: 'AI Signal',     key: null },
  { label: 'Score',         key: 'score' },
  { label: 'Regime · Conf', key: 'volatility' },
];

function signalCls(s: string) {
  if (s === 'BUY')  return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25';
  if (s === 'SELL') return 'bg-rose-500/10 text-rose-400 border-rose-500/25';
  return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
}

function regimeMeta(r: string) {
  if (r === 'high_volatility')   return { label: 'HIGH', text: 'text-rose-400',    bg: 'bg-rose-500/10',    bar: 'bg-rose-500' };
  if (r === 'medium_volatility') return { label: 'MED',  text: 'text-amber-400',   bg: 'bg-amber-500/10',   bar: 'bg-amber-500' };
  return                                { label: 'LOW',  text: 'text-emerald-400', bg: 'bg-emerald-500/10', bar: 'bg-emerald-500' };
}

function rsiCls(rsi: number | null) {
  if (rsi === null) return 'text-slate-600';
  if (rsi < 30) return 'text-emerald-400';
  if (rsi > 70) return 'text-rose-400';
  return 'text-slate-200';
}

export function Screener() {
  const { data: overview } = usePolling(() => api.getMarketOverview(), 10_000);
  const { data: signals }  = usePolling(() => api.getAISignals(),      10_000);
  const { data: regimes }  = usePolling(() => api.getRegime(),         30_000);

  const [filter,  setFilter]  = useState<FilterKey>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sigMap = useMemo(() => signals ? latestPer(signals) : new Map<string, AISignal>(), [signals]);
  const regMap = useMemo(() => regimes ? latestPer(regimes) : new Map<string, MarketRegimeItem>(), [regimes]);

  const rows = useMemo(() => {
    if (!overview) return [];
    let list = overview.map(o => ({
      o,
      sig: sigMap.get(o.symbol) ?? null,
      reg: regMap.get(o.symbol) ?? null,
    }));

    if (filter === 'BUY')      list = list.filter(r => r.sig?.signal === 'BUY');
    else if (filter === 'SELL')    list = list.filter(r => r.sig?.signal === 'SELL');
    else if (filter === 'NEUTRAL') list = list.filter(r => r.sig?.signal === 'NEUTRAL');
    else if (filter === 'HIGH_VOL') list = list.filter(r => r.reg?.regime === 'high_volatility');

    list.sort((a, b) => {
      let av = 0, bv = 0;
      if      (sortKey === 'price')      { av = a.o.close;                  bv = b.o.close; }
      else if (sortKey === 'rsi14')      { av = a.o.rsi14 ?? 0;             bv = b.o.rsi14 ?? 0; }
      else if (sortKey === 'score')      { av = a.sig?.score ?? 0;          bv = b.sig?.score ?? 0; }
      else if (sortKey === 'volatility') { av = a.reg?.volatilityValue ?? 0; bv = b.reg?.volatilityValue ?? 0; }
      else if (sortKey === 'volume')     { av = a.o.volume;                 bv = b.o.volume; }
      return sortDir === 'desc' ? bv - av : av - bv;
    });

    return list;
  }, [overview, sigMap, regMap, filter, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(k); setSortDir('desc'); }
  }

  // Summary stats for header
  const buyCount  = rows.filter(r => r.sig?.signal === 'BUY').length;
  const sellCount = rows.filter(r => r.sig?.signal === 'SELL').length;
  const highVol   = rows.filter(r => r.reg?.regime === 'high_volatility').length;

  return (
    <div className="flex flex-col h-full bg-[#0b0e17] rounded-lg border border-white/5 overflow-hidden">

      {/* ── Header ── */}
      <div className="px-4 py-3 border-b border-white/5 bg-[#080b13] flex items-center justify-between shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <Sparkles size={14} className="text-cyan-400 shrink-0" />
          <div>
            <span className="font-bold text-white text-sm tracking-wide">AI Market Screener</span>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[9px] text-emerald-400 font-mono">{buyCount} BUY</span>
              <span className="text-[9px] text-rose-400 font-mono">{sellCount} SELL</span>
              {highVol > 0 && <span className="text-[9px] text-amber-400 font-mono">{highVol} HIGH VOL</span>}
            </div>
          </div>
        </div>

        <div className="flex gap-1 shrink-0">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[9px] px-2.5 py-1 rounded-md font-bold uppercase tracking-wider transition-colors border ${
                filter === f.key
                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                  : 'text-slate-600 border-white/[0.05] hover:text-slate-300 hover:border-white/10'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Column headers ── */}
      <div className="grid grid-cols-[200px_130px_90px_110px_80px_90px_130px_150px] gap-x-2 px-4 py-2 border-b border-white/[0.04] bg-[#080b13] shrink-0">
        {COLS.map(col => (
          <button
            key={col.label}
            onClick={() => col.key && toggleSort(col.key)}
            className={`text-[9px] uppercase tracking-widest text-left flex items-center gap-1 ${
              col.key ? 'text-slate-500 hover:text-slate-200 cursor-pointer transition-colors' : 'text-slate-600 cursor-default'
            }`}
          >
            {col.label}
            {col.key && sortKey === col.key && (
              sortDir === 'desc'
                ? <ChevronDown size={10} className="text-cyan-400" />
                : <ChevronUp   size={10} className="text-cyan-400" />
            )}
            {col.key && sortKey !== col.key && (
              <span className="opacity-20 text-[8px]">↕</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Rows ── */}
      <div className="flex-1 overflow-y-auto hide-scrollbar">

        {/* Skeleton while loading */}
        {!overview && (
          <div className="flex flex-col gap-px p-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-[60px] rounded bg-white/[0.015] animate-pulse" />
            ))}
          </div>
        )}

        {overview && rows.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-600 text-sm">
            No symbols match the selected filter
          </div>
        )}

        {rows.map(({ o, sig, reg }) => {
          const meta = COIN_META[o.symbol] ?? { name: o.symbol, color: '#888', icon: '?' };
          const scorePct = sig ? Math.abs(sig.score) * 50 : 0;
          const scorePos = sig !== null && sig.score >= 0;
          const rm       = reg ? regimeMeta(reg.regime) : null;
          const aboveSMA = o.sma7 !== null && o.close > o.sma7;

          return (
            <div
              key={o.symbol}
              className="grid grid-cols-[200px_130px_90px_110px_80px_90px_130px_150px] gap-x-2 px-4 py-4 border-b border-white/[0.03] hover:bg-white/[0.018] transition-colors"
            >
              {/* Asset */}
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}33` }}
                >
                  {meta.icon}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-white font-bold text-xs">{o.symbol.replace('USDT', '')}</span>
                  <span className="text-[9px] text-slate-600 truncate">{meta.name}</span>
                </div>
              </div>

              {/* Price */}
              <div className="flex flex-col justify-center">
                <span className="text-sm font-mono font-bold text-white leading-tight">{fmtPrice(o.close)}</span>
                <span className="text-[9px] text-slate-600">USDT</span>
              </div>

              {/* RSI */}
              <div className="flex flex-col justify-center">
                {o.rsi14 !== null ? (
                  <>
                    <span className={`text-sm font-mono font-bold leading-tight ${rsiCls(o.rsi14)}`}>{o.rsi14.toFixed(1)}</span>
                    <span className="text-[9px] text-slate-600">
                      {o.rsi14 < 30 ? 'oversold' : o.rsi14 > 70 ? 'overbought' : 'neutral zone'}
                    </span>
                  </>
                ) : <span className="text-slate-600">—</span>}
              </div>

              {/* Volume */}
              <div className="flex flex-col justify-center">
                <span className="text-sm font-mono font-bold text-white leading-tight">{fmtVolume(o.volume)}</span>
                <span className="text-[9px] text-slate-600">USDT volume</span>
              </div>

              {/* vs SMA7 */}
              <div className="flex flex-col justify-center">
                {o.sma7 !== null ? (
                  aboveSMA ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                      <TrendingUp size={11} /> Above
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-rose-400">
                      <TrendingDown size={11} /> Below
                    </span>
                  )
                ) : <span className="text-slate-600 text-xs">—</span>}
              </div>

              {/* AI Signal */}
              <div className="flex items-center">
                {sig ? (
                  <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border ${signalCls(sig.signal)}`}>
                    {sig.signal}
                  </span>
                ) : <span className="text-slate-600 text-xs">—</span>}
              </div>

              {/* Score bar */}
              <div className="flex items-center gap-2">
                {sig ? (
                  <>
                    <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full relative overflow-hidden">
                      <div
                        className={`absolute top-0 h-full rounded-full ${scorePos ? 'bg-emerald-500' : 'bg-rose-500'}`}
                        style={{ left: scorePos ? '50%' : `${50 - scorePct}%`, width: `${scorePct}%` }}
                      />
                      <div className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
                    </div>
                    <span className={`text-[10px] font-mono w-10 text-right shrink-0 ${scorePos ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {sig.score >= 0 ? '+' : ''}{sig.score.toFixed(2)}
                    </span>
                  </>
                ) : <span className="text-slate-600 text-xs">—</span>}
              </div>

              {/* Regime */}
              <div className="flex flex-col justify-center gap-1">
                {reg && rm ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${rm.bg} ${rm.text}`}>{rm.label}</span>
                      <span className={`text-[9px] font-mono ${rm.text}`}>{Math.round(reg.confidence * 100)}% conf</span>
                    </div>
                    <div className="h-0.5 bg-white/[0.06] rounded-full overflow-hidden w-24">
                      <div className={`h-full rounded-full ${rm.bar}`} style={{ width: `${Math.min(reg.volatilityValue * 100, 100)}%` }} />
                    </div>
                  </>
                ) : <span className="text-slate-600 text-xs">—</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-2 border-t border-white/[0.04] bg-[#080b13] flex items-center justify-between shrink-0">
        <span className="text-[9px] text-slate-600">
          Crypto market data · prices & RSI every 10 s · regime every 30 s
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-emerald-500">
          <RefreshCw size={8} className="animate-spin" />
          Live
        </div>
      </div>
    </div>
  );
}
