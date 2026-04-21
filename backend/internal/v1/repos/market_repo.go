package repos

import (
	"context"
	"database/sql"
	"trading-dashboard/internal/models"
)

type MarketRepository struct {
	ch *sql.DB
}

func NewMarketRepository(ch *sql.DB) *MarketRepository {
	return &MarketRepository{ch: ch}
}

func (r *MarketRepository) GetMarketOverview(ctx context.Context) ([]models.MarketOverview, error) {
	if r.ch == nil {
		return mockOverview(), nil
	}

	rows, err := r.ch.QueryContext(ctx, `
		SELECT symbol, toString(timestamp), close, volume, sma_7, rsi_14
		FROM market_latest_price FINAL
		ORDER BY symbol
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.MarketOverview
	for rows.Next() {
		var m models.MarketOverview
		if err := rows.Scan(&m.Symbol, &m.Timestamp, &m.Close, &m.Volume, &m.SMA7, &m.RSI14); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	if len(result) == 0 {
		return mockOverview(), nil
	}
	return result, rows.Err()
}

func (r *MarketRepository) GetKlines(ctx context.Context, symbol string, limit int) ([]models.Kline, error) {
	if r.ch == nil {
		return nil, nil
	}
	if limit <= 0 || limit > 1000 {
		limit = 200
	}

	rows, err := r.ch.QueryContext(ctx, `
		SELECT symbol, timestamp, open, high, low, close, volume,
		       quote_volume, num_trades, is_closed, interval,
		       sma_7, sma_25, sma_99, rsi_14,
		       log_return, pct_change, volatility_20, vwap
		FROM market_klines_stream FINAL
		WHERE symbol = ?
		ORDER BY timestamp DESC
		LIMIT ?
	`, symbol, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.Kline
	for rows.Next() {
		var k models.Kline
		if err := rows.Scan(
			&k.Symbol, &k.Timestamp, &k.Open, &k.High, &k.Low, &k.Close, &k.Volume,
			&k.QuoteVolume, &k.NumTrades, &k.IsClosed, &k.Interval,
			&k.SMA7, &k.SMA25, &k.SMA99, &k.RSI14,
			&k.LogReturn, &k.PctChange, &k.Volatility20, &k.VWAP,
		); err != nil {
			return nil, err
		}
		// Clean NaN values for safe JSON serialization
		k.SMA7 = models.CleanNaN(k.SMA7)
		k.SMA25 = models.CleanNaN(k.SMA25)
		k.SMA99 = models.CleanNaN(k.SMA99)
		k.RSI14 = models.CleanNaN(k.RSI14)
		k.LogReturn = models.CleanNaN(k.LogReturn)
		k.PctChange = models.CleanNaN(k.PctChange)
		k.Volatility20 = models.CleanNaN(k.Volatility20)
		k.VWAP = models.CleanNaN(k.VWAP)
		result = append(result, k)
	}
	return result, rows.Err()
}

func (r *MarketRepository) GetSymbols(ctx context.Context) ([]string, error) {
	if r.ch == nil {
		return []string{"BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"}, nil
	}

	rows, err := r.ch.QueryContext(ctx, `
		SELECT DISTINCT symbol FROM market_klines_stream FINAL ORDER BY symbol
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func mockOverview() []models.MarketOverview {
	sma := 71250.0
	rsi := 55.0
	return []models.MarketOverview{
		{Symbol: "BTCUSDT", Close: 71250.00, Volume: 1234.56, SMA7: &sma, RSI14: &rsi, Timestamp: "2024-01-01 00:00:00"},
		{Symbol: "ETHUSDT", Close: 2305.00, Volume: 5678.90, SMA7: &sma, RSI14: &rsi, Timestamp: "2024-01-01 00:00:00"},
	}
}
