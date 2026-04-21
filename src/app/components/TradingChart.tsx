import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, Time } from 'lightweight-charts';
import { api, Kline } from '../lib/api';

interface ChartProps {
  symbol: string;
}

export function TradingChart({ symbol }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty'>('loading');

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart: IChartApi = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#64748b',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(255, 255, 255, 0.2)', style: 3 },
        horzLine: { color: 'rgba(255, 255, 255, 0.2)', style: 3 },
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });

    setStatus('loading');
    api
      .getKlines(symbol, 200)
      .then((klines: Kline[]) => {
        if (!klines || klines.length === 0) {
          setStatus('empty');
          return;
        }
        const sorted = [...klines].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        const data = sorted.map((k) => ({
          time: (new Date(k.timestamp).getTime() / 1000) as Time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        }));
        series.setData(data);
        chart.timeScale().fitContent();
        setStatus('ready');
      })
      .catch(() => setStatus('empty'));

    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [symbol]);

  return (
    <div className="flex flex-col w-full h-full bg-[#0b0f19] border border-white/5 rounded-lg overflow-hidden">
      <div className="flex justify-between items-center px-4 py-3 border-b border-white/5 bg-[#080b13] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded bg-indigo-500/20 text-indigo-400 font-bold text-sm">
            {symbol.charAt(0)}
          </div>
          <span className="font-bold text-white text-sm tracking-widest">{symbol}</span>
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">1-minute candles</span>
        </div>
      </div>
      <div className="flex-1 w-full min-h-0 relative" ref={chartContainerRef}>
        {status !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm pointer-events-none">
            {status === 'loading' ? 'Loading chart…' : 'No data — is the processor running?'}
          </div>
        )}
      </div>
    </div>
  );
}
