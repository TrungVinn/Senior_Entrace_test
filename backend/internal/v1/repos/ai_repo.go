package repos

import (
	"context"
	"database/sql"
	"trading-dashboard/internal/models"
)

type AIRepository struct {
	ch *sql.DB
}

func NewAIRepository(ch *sql.DB) *AIRepository {
	return &AIRepository{ch: ch}
}

func (r *AIRepository) GetSignals(ctx context.Context) ([]models.AISignal, error) {
	if r.ch == nil {
		return nil, nil
	}

	rows, err := r.ch.QueryContext(ctx, `
		SELECT symbol, toString(timestamp), signal, score,
		       rsi_component, sma_component, volume_component
		FROM market_ai_signals FINAL
		ORDER BY timestamp DESC
		LIMIT 50
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.AISignal
	for rows.Next() {
		var s models.AISignal
		if err := rows.Scan(&s.Symbol, &s.Timestamp, &s.Signal, &s.Score,
			&s.RSIComponent, &s.SMAComponent, &s.VolumeComponent); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func (r *AIRepository) GetAnomalies(ctx context.Context) ([]models.Anomaly, error) {
	if r.ch == nil {
		return nil, nil
	}

	rows, err := r.ch.QueryContext(ctx, `
		SELECT symbol, toString(timestamp), type, severity, zscore, description
		FROM market_anomalies FINAL
		ORDER BY timestamp DESC
		LIMIT 50
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.Anomaly
	for rows.Next() {
		var a models.Anomaly
		if err := rows.Scan(&a.Symbol, &a.Timestamp, &a.Type, &a.Severity, &a.ZScore, &a.Description); err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, rows.Err()
}

func (r *AIRepository) GetRegime(ctx context.Context) ([]models.MarketRegime, error) {
	if r.ch == nil {
		return nil, nil
	}

	rows, err := r.ch.QueryContext(ctx, `
		SELECT symbol, toString(timestamp), regime, confidence, volatility_value
		FROM market_regimes FINAL
		ORDER BY timestamp DESC
		LIMIT 10
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.MarketRegime
	for rows.Next() {
		var m models.MarketRegime
		if err := rows.Scan(&m.Symbol, &m.Timestamp, &m.Regime, &m.Confidence, &m.VolatilityValue); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}
