import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickSeriesOptions,
  Time,
} from 'lightweight-charts';
import { api, Kline } from '../lib/api';

interface ChartProps {
  symbol: string;
  name?: string;
  price?: string;
  change?: string;
  isUp?: boolean;
  startPrice?: number;
  minimal?: boolean;
}

// Forward-fill gaps up to MAX_FILL_MINUTES with flat candles so the chart looks continuous.
// Gaps larger than that are left as-is (system was down, it's honest to show empty space).
const MAX_FILL_MINUTES = 15;

interface CandleBar {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

function toCandles(klines: Kline[]): CandleBar[] {
  const sorted = [...klines].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const result: CandleBar[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i];
    const t = Math.floor(new Date(k.timestamp).getTime() / 1000);
    result.push({ time: t as Time, open: k.open, high: k.high, low: k.low, close: k.close });

    if (i < sorted.length - 1) {
      const nextT = Math.floor(new Date(sorted[i + 1].timestamp).getTime() / 1000);
      const gapMinutes = Math.round((nextT - t) / 60) - 1;
      const fill = Math.min(gapMinutes, MAX_FILL_MINUTES);
      for (let g = 1; g <= fill; g++) {
        result.push({
          time: (t + g * 60) as Time,
          open: k.close,
          high: k.close,
          low: k.close,
          close: k.close,
        });
      }
    }
  }
  return result;
}

// ─── Minimal mini card (used in EQUITIES top row) ───────────────────────────

export function TradingChart({ symbol, name, price, change, isUp, minimal }: ChartProps) {
  if (minimal) {
    return (
      <div className="flex flex-col justify-between h-full bg-[#0b0e17] border border-white/5 rounded-lg px-4 py-3 overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{symbol}</span>
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
            {change ?? ''}
          </span>
        </div>
        <span className="text-sm font-mono font-bold text-white">{price ?? '—'}</span>
      </div>
    );
  }

  return <FullChart symbol={symbol} name={name} />;
}

// ─── Full candlestick chart with gap-fill + live polling ────────────────────

function FullChart({ symbol, name }: { symbol: string; name?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', CandlestickSeriesOptions> | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty'>('loading');
  const [livePrice, setLivePrice] = useState<string | null>(null);

  // Build and tear down the chart when symbol changes
  useEffect(() => {
    if (!containerRef.current) return;

    setStatus('loading');
    setLivePrice(null);

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#64748b',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: false,
        fixRightEdge: true,
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(255,255,255,0.15)', style: 1, labelBackgroundColor: '#1e293b' },
        horzLine: { color: 'rgba(255,255,255,0.15)', style: 1, labelBackgroundColor: '#1e293b' },
      },
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });
    seriesRef.current = series;

    // Initial load: 200 candles with gap-fill
    api
      .getKlines(symbol, 200)
      .then((klines) => {
        if (!klines || klines.length === 0) {
          setStatus('empty');
          return;
        }
        const bars = toCandles(klines);
        series.setData(bars);
        chart.timeScale().fitContent();
        setStatus('ready');

        const last = klines.reduce((a, b) =>
          new Date(a.timestamp) > new Date(b.timestamp) ? a : b
        );
        setLivePrice(last.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      })
      .catch(() => setStatus('empty'));

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [symbol]);

  // Live polling: fetch the last 5 candles every 15s and update the series
  useEffect(() => {
    const id = setInterval(async () => {
      if (!seriesRef.current) return;
      try {
        const klines = await api.getKlines(symbol, 5);
        if (!klines || klines.length === 0) return;
        const bars = toCandles(klines);
        bars.forEach((bar) => seriesRef.current!.update(bar));

        const last = klines.reduce((a, b) =>
          new Date(a.timestamp) > new Date(b.timestamp) ? a : b
        );
        setLivePrice(last.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        setStatus('ready');
      } catch {
        // silent — don't flip to error on a transient poll failure
      }
    }, 15_000);

    return () => clearInterval(id);
  }, [symbol]);

  return (
    <div className="flex flex-col w-full h-full bg-[#0b0f19] border border-white/5 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-2.5 border-b border-white/5 bg-[#080b13] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded bg-indigo-500/20 text-indigo-400 font-bold text-sm">
            {symbol.charAt(0)}
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-white text-sm tracking-wider">{symbol}</span>
            {name && <span className="text-[10px] text-slate-500">{name}</span>}
          </div>
          <span className="text-[10px] text-slate-600 uppercase tracking-widest ml-1">1m candles</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {livePrice && (
            <span className="font-mono font-bold text-white text-sm">{livePrice}</span>
          )}
          {status === 'ready' && (
            <div className="flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span className="text-[9px] text-emerald-400 font-mono">LIVE</span>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 w-full min-h-0 relative" ref={containerRef}>
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-slate-500 text-sm animate-pulse">Loading {symbol}…</span>
          </div>
        )}
        {status === 'empty' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <span className="text-slate-500 text-sm">No data for {symbol}</span>
            <span className="text-slate-600 text-xs">Is the stream processor running?</span>
          </div>
        )}
      </div>
    </div>
  );
}
