import { useState, useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, ReferenceLine, CartesianGrid, Dot,
} from 'recharts';
import { Calculator, TrendingUp, TrendingDown, Minus, DollarSign, Clock, Star, AlertTriangle } from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import type { Kline } from '../lib/api';

// ─── Constants ────────────────────────────────────────────────────────────────

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];

const CANDLES_AGO_OPTIONS = [1, 5, 15, 30, 60, 120, 200];

const INTERVAL_OPTIONS: { label: string; binance: string; minutes: number }[] = [
  { label: '1m',  binance: '1m',  minutes: 1    },
  { label: '5m',  binance: '5m',  minutes: 5    },
  { label: '15m', binance: '15m', minutes: 15   },
  { label: '30m', binance: '30m', minutes: 30   },
  { label: '1h',  binance: '1h',  minutes: 60   },
  { label: '4h',  binance: '4h',  minutes: 240  },
  { label: '1d',  binance: '1d',  minutes: 1440 },
];

type PriceMode = 'open' | 'high' | 'low' | 'close' | 'average';

const PRICE_MODES: { label: string; value: PriceMode }[] = [
  { label: 'Open',    value: 'open'    },
  { label: 'High',    value: 'high'    },
  { label: 'Low',     value: 'low'     },
  { label: 'Close',   value: 'close'   },
  { label: 'Average', value: 'average' },
];

// ─── Binance REST fetch ────────────────────────────────────────────────────────

async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Kline[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API ${res.status}`);
  // Each row: [openTime, open, high, low, close, volume, closeTime, ...]
  const rows: (string | number)[][] = await res.json();
  return rows.map(r => ({
    symbol,
    timestamp:    new Date(Number(r[0])).toISOString(),
    open:         parseFloat(String(r[1])),
    high:         parseFloat(String(r[2])),
    low:          parseFloat(String(r[3])),
    close:        parseFloat(String(r[4])),
    volume:       parseFloat(String(r[5])),
    // Feature columns not available from raw Binance OHLCV
    sma7:         null,
    sma25:        null,
    sma99:        null,
    rsi14:        null,
    volatility20: null,
    vwap:         null,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPrice(k: Kline, mode: PriceMode): number {
  if (mode === 'average') return (k.open + k.high + k.low + k.close) / 4;
  return k[mode];
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return p.toFixed(4);
  return p.toFixed(6);
}

function fmtUSD(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(ts: string, intervalMinutes: number): string {
  const d = new Date(ts);
  if (intervalMinutes >= 1440) {
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }
  if (intervalMinutes >= 60) {
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`;
  }
  if (intervalMinutes >= 15) {
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, initialAmount }: {
  active?: boolean;
  payload?: { value: number }[];
  initialAmount: number;
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  const pnl = val - initialAmount;
  return (
    <div className="bg-[#131825] border border-white/10 rounded-lg px-3 py-2 shadow-xl text-[10px]">
      <div className="text-white font-mono font-bold">${fmtUSD(val)}</div>
      <div className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
        {pnl >= 0 ? '+' : ''}${fmtUSD(pnl)} ({pnl >= 0 ? '+' : ''}{((pnl / initialAmount) * 100).toFixed(2)}%)
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function Simulator() {
  const [symbol,     setSymbol]     = useState('BTCUSDT');
  const [amount,     setAmount]     = useState(1000);
  const [candlesAgo, setCandlesAgo] = useState(60);
  const [priceMode,  setPriceMode]  = useState<PriceMode>('close');
  const [interval,   setInterval]   = useState(INTERVAL_OPTIONS[0]);

  const limit = Math.min(candlesAgo + 10, 1000);

  const { data: klines, loading, error } = usePolling(
    () => fetchBinanceKlines(symbol, interval.binance, limit),
    60_000,
    [symbol, interval.binance, limit],
  );

  // ── Computation ───────────────────────────────────────────────────────────
  const result = useMemo(() => {
    if (!klines || klines.length < candlesAgo + 1) return null;

    // Binance returns ascending order already
    const sorted = klines;

    const entryIdx      = sorted.length - 1 - candlesAgo;
    const entryCandle   = sorted[entryIdx];
    const currentCandle = sorted[sorted.length - 1];

    const entryPrice   = getPrice(entryCandle, priceMode);
    const currentPrice = currentCandle.close;
    const quantity     = amount / entryPrice;
    const currentValue = quantity * currentPrice;
    const pnl          = currentValue - amount;
    const pnlPct       = (pnl / amount) * 100;

    const slice      = sorted.slice(entryIdx);
    const bestPrice  = Math.max(...slice.map(k => k.high));
    const worstPrice = Math.min(...slice.map(k => k.low));
    const bestValue  = quantity * bestPrice;
    const worstValue = quantity * worstPrice;
    const bestPnl    = bestValue  - amount;
    const worstPnl   = worstValue - amount;

    const chartData = slice.map((k, i) => ({
      i,
      time:  fmtTime(k.timestamp, interval.minutes),
      value: parseFloat((quantity * k.close).toFixed(2)),
    }));

    return {
      entryCandle, currentCandle,
      entryPrice, currentPrice,
      quantity, currentValue,
      pnl, pnlPct,
      bestPrice, bestValue, bestPnl,
      worstPrice, worstValue, worstPnl,
      chartData,
    };
  }, [klines, candlesAgo, priceMode, amount, interval]);

  const isProfit = (result?.pnl ?? 0) >= 0;
  const chartMin = result ? Math.min(...result.chartData.map(d => d.value)) * 0.97 : 0;
  const chartMax = result ? Math.max(...result.chartData.map(d => d.value)) * 1.03 : 0;

  const summary = result
    ? `If you bought ${symbol.replace('USDT', '')} ${candlesAgo} × ${interval.label} candle${candlesAgo > 1 ? 's' : ''} ago at the ${priceMode} price, your $${fmtUSD(amount)} would now be worth $${fmtUSD(result.currentValue)}. Best moment: $${fmtUSD(result.bestValue)}. Worst dip: $${fmtUSD(result.worstValue)}.`
    : null;

  const insufficientData = !loading && !error && klines && !result;

  // Human-readable time representation of selected combo
  const totalMinutes  = candlesAgo * interval.minutes;
  const humanDuration = totalMinutes >= 1440
    ? `${(totalMinutes / 1440).toFixed(0)} day${totalMinutes / 1440 > 1 ? 's' : ''}`
    : totalMinutes >= 60
    ? `${(totalMinutes / 60).toFixed(0)}h`
    : `${totalMinutes}m`;

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 text-slate-300 p-2">

      {/* Header */}
      <div className="shrink-0 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <Calculator size={16} className="text-cyan-400" />
        </div>
        <div>
          <h1 className="text-white font-bold text-sm tracking-wide">What If Simulator</h1>
          <p className="text-[10px] text-slate-500">See how a past crypto buy would look today · live data from Binance</p>
        </div>
        <div className="ml-auto text-[9px] text-slate-600 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
          Binance REST
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex gap-3">

        {/* Controls */}
        <div className="shrink-0 w-52 flex flex-col gap-2 overflow-y-auto hide-scrollbar pb-1">

          {/* Symbol */}
          <div className="bg-[#0b0e17] rounded-lg border border-white/5 p-3 flex flex-col gap-2">
            <span className="text-[9px] text-slate-500 uppercase tracking-widest">Symbol</span>
            <div className="flex flex-col gap-1">
              {SYMBOLS.map(sym => (
                <button
                  key={sym}
                  onClick={() => setSymbol(sym)}
                  className={`text-left px-2.5 py-1.5 rounded text-xs font-mono font-bold transition-colors ${
                    symbol === sym
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                      : 'text-slate-500 hover:text-slate-300 border border-transparent hover:border-white/10'
                  }`}
                >
                  {sym.replace('USDT', '')}
                  <span className="text-[9px] font-normal text-slate-600 ml-1">/ USDT</span>
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div className="bg-[#0b0e17] rounded-lg border border-white/5 p-3 flex flex-col gap-2">
            <span className="text-[9px] text-slate-500 uppercase tracking-widest">Investment Amount</span>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={e => setAmount(Math.max(1, Number(e.target.value)))}
                className="w-full bg-[#131825] border border-white/10 rounded text-white text-xs font-mono pl-6 pr-3 py-1.5 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
              />
            </div>
            <span className="text-[9px] text-slate-600">USDT</span>
          </div>

          {/* Candle interval */}
          <div className="bg-[#0b0e17] rounded-lg border border-white/5 p-3 flex flex-col gap-2">
            <span className="text-[9px] text-slate-500 uppercase tracking-widest">Candle Size</span>
            <p className="text-[9px] text-slate-600 leading-relaxed">Each "candle ago" represents this time window</p>
            <div className="grid grid-cols-4 gap-1">
              {INTERVAL_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  onClick={() => setInterval(opt)}
                  className={`px-1 py-1.5 rounded text-[10px] font-mono font-bold transition-colors ${
                    interval.label === opt.label
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                      : 'text-slate-500 hover:text-slate-300 border border-white/[0.05] hover:border-white/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Candles ago */}
          <div className="bg-[#0b0e17] rounded-lg border border-white/5 p-3 flex flex-col gap-2">
            <span className="text-[9px] text-slate-500 uppercase tracking-widest">Bought</span>
            <div className="flex flex-col gap-1">
              {CANDLES_AGO_OPTIONS.map(n => {
                const mins  = n * interval.minutes;
                const label = mins >= 1440
                  ? `${Math.round(mins / 1440)}d ago`
                  : mins >= 60
                  ? `${(mins / 60).toFixed(0)}h ago`
                  : `${mins}m ago`;
                return (
                  <button
                    key={n}
                    onClick={() => setCandlesAgo(n)}
                    className={`text-left px-2.5 py-1.5 rounded text-[10px] transition-colors flex items-center justify-between ${
                      candlesAgo === n
                        ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                        : 'text-slate-500 hover:text-slate-300 border border-transparent hover:border-white/10'
                    }`}
                  >
                    <span className="font-mono">{n} × {interval.label}</span>
                    <span className={`text-[9px] ${candlesAgo === n ? 'text-cyan-500' : 'text-slate-600'}`}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Entry price mode */}
          <div className="bg-[#0b0e17] rounded-lg border border-white/5 p-3 flex flex-col gap-2">
            <span className="text-[9px] text-slate-500 uppercase tracking-widest">Entry Price</span>
            <div className="grid grid-cols-2 gap-1">
              {PRICE_MODES.map(m => (
                <button
                  key={m.value}
                  onClick={() => setPriceMode(m.value)}
                  className={`px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                    priceMode === m.value
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                      : 'text-slate-500 hover:text-slate-300 border border-white/[0.04] hover:border-white/10'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-3">

          {loading && !result && (
            <div className="flex-1 flex items-center justify-center text-slate-600">
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                <span className="text-xs">Fetching from Binance…</span>
              </div>
            </div>
          )}

          {insufficientData && (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-center">
                <AlertTriangle size={22} className="text-amber-500/50" />
                <p className="text-xs text-slate-400">
                  Not enough data for <span className="text-white font-mono">{candlesAgo} × {interval.label}</span>
                </p>
                <p className="text-[10px] text-slate-600">Try a smaller count or shorter interval.</p>
              </div>
            </div>
          )}

          {error && !result && (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <AlertTriangle size={22} className="text-rose-500/50" />
                <p className="text-xs text-rose-400">Could not reach Binance API.</p>
              </div>
            </div>
          )}

          {result && (
            <>
              {/* Top metrics */}
              <div className="shrink-0 grid grid-cols-4 gap-3">

                {/* PnL card */}
                <div className={`col-span-2 rounded-lg border p-4 flex flex-col gap-2 ${
                  isProfit ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-rose-500/5 border-rose-500/20'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest">Now Worth</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-600">{humanDuration} hold</span>
                      <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded ${
                        isProfit ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                      }`}>
                        {isProfit ? 'Profit' : 'Loss'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-mono font-bold text-white">${fmtUSD(result.currentValue)}</span>
                    <span className="text-xs text-slate-500">USDT</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-mono font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isProfit ? '+' : ''}${fmtUSD(result.pnl)}
                    </span>
                    <span className={`flex items-center gap-1 text-sm font-mono font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isProfit ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                      {isProfit ? '+' : ''}{result.pnlPct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="text-[9px] text-slate-600">
                    invested ${fmtUSD(amount)} · qty {result.quantity.toFixed(6)} {symbol.replace('USDT', '')}
                  </div>
                </div>

                {/* Entry price */}
                <div className="bg-[#0b0e17] rounded-lg border border-white/5 p-3 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase tracking-widest">
                    <Clock size={9} /> Entry Price
                  </div>
                  <span className="text-sm font-mono font-bold text-white mt-1">${fmtPrice(result.entryPrice)}</span>
                  <span className="text-[9px] text-slate-600">{fmtTime(result.entryCandle.timestamp, interval.minutes)}</span>
                  <span className="text-[9px] text-slate-600 capitalize">{priceMode} · −{candlesAgo} {interval.label}</span>
                </div>

                {/* Current price */}
                <div className="bg-[#0b0e17] rounded-lg border border-white/5 p-3 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase tracking-widest">
                    <DollarSign size={9} /> Current Price
                  </div>
                  <span className="text-sm font-mono font-bold text-white mt-1">${fmtPrice(result.currentPrice)}</span>
                  <span className="text-[9px] text-slate-600">{fmtTime(result.currentCandle.timestamp, interval.minutes)}</span>
                  <span className="text-[9px] text-slate-600">Close · latest {interval.label} candle</span>
                </div>
              </div>

              {/* Best / Worst */}
              <div className="shrink-0 grid grid-cols-2 gap-3">
                <div className="bg-emerald-500/[0.04] rounded-lg border border-emerald-500/15 p-3 flex items-center gap-3">
                  <Star size={18} className="text-emerald-400 shrink-0" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest">Best Moment</span>
                    <span className="text-sm font-mono font-bold text-emerald-400">${fmtUSD(result.bestValue)}</span>
                    <span className="text-[9px] text-emerald-600">
                      +${fmtUSD(result.bestPnl)} ({((result.bestPnl / amount) * 100).toFixed(2)}%) · high {fmtPrice(result.bestPrice)}
                    </span>
                  </div>
                </div>
                <div className="bg-rose-500/[0.04] rounded-lg border border-rose-500/15 p-3 flex items-center gap-3">
                  <Minus size={18} className="text-rose-400 shrink-0" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest">Worst Dip</span>
                    <span className="text-sm font-mono font-bold text-rose-400">${fmtUSD(result.worstValue)}</span>
                    <span className="text-[9px] text-rose-600">
                      {result.worstPnl >= 0 ? '+' : ''}${fmtUSD(result.worstPnl)} ({((result.worstPnl / amount) * 100).toFixed(2)}%) · low {fmtPrice(result.worstPrice)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="flex-1 min-h-0 bg-[#0b0e17] rounded-lg border border-white/5 flex flex-col overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/5 bg-[#080b13] flex items-center gap-2 shrink-0">
                  <TrendingUp size={13} className="text-cyan-400" />
                  <span className="text-white font-bold tracking-widest text-xs uppercase">Portfolio Value Over Time</span>
                  <span className="text-[9px] text-slate-600 ml-auto">
                    {candlesAgo} × {interval.label} · {humanDuration} · entry → now
                  </span>
                </div>
                <div className="flex-1 min-h-0 p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={result.chartData} margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis
                        dataKey="time"
                        tick={{ fill: '#475569', fontSize: 9 }}
                        tickLine={false}
                        axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                        interval={Math.max(1, Math.floor(result.chartData.length / 6))}
                      />
                      <YAxis
                        domain={[chartMin, chartMax]}
                        tick={{ fill: '#475569', fontSize: 9 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)}`}
                        width={52}
                      />
                      <Tooltip content={<ChartTooltip initialAmount={amount} />} />
                      <ReferenceLine
                        y={amount}
                        stroke="rgba(255,255,255,0.15)"
                        strokeDasharray="6 3"
                        label={{ value: 'Break-even', fill: '#475569', fontSize: 9, position: 'insideTopLeft' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke={isProfit ? '#10b981' : '#f43f5e'}
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 3, fill: isProfit ? '#10b981' : '#f43f5e', stroke: 'none' }}
                      />
                      {/* Cyan dot at entry */}
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="transparent"
                        dot={(props) => {
                          if (props.index !== 0) return <g key={props.index} />;
                          return (
                            <Dot key="entry" cx={props.cx} cy={props.cy} r={5}
                              fill="#06b6d4" stroke="#0b0e17" strokeWidth={2} />
                          );
                        }}
                        activeDot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Plain English summary */}
              <div className="shrink-0 bg-[#0b0e17] rounded-lg border border-white/5 px-4 py-3">
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  <span className="text-slate-500 mr-1">Summary:</span>
                  {summary}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
