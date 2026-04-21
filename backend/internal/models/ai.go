package models

// AISignal represents a buy/sell/neutral signal for a symbol.
type AISignal struct {
	Symbol          string  `json:"symbol"`
	Timestamp       string  `json:"timestamp"`
	Signal          string  `json:"signal"` // BUY, SELL, NEUTRAL
	Score           float64 `json:"score"`
	RSIComponent    float64 `json:"rsiComponent"`
	SMAComponent    float64 `json:"smaComponent"`
	VolumeComponent float64 `json:"volumeComponent"`
}

// Anomaly represents a detected market anomaly.
type Anomaly struct {
	Symbol      string  `json:"symbol"`
	Timestamp   string  `json:"timestamp"`
	Type        string  `json:"type"`     // price_zscore, volume_zscore, isolation_forest
	Severity    string  `json:"severity"` // low, medium, high
	ZScore      float64 `json:"zscore"`
	Description string  `json:"description"`
}

// MarketRegime represents the current volatility regime.
type MarketRegime struct {
	Symbol          string  `json:"symbol"`
	Timestamp       string  `json:"timestamp"`
	Regime          string  `json:"regime"` // low_volatility, medium_volatility, high_volatility
	Confidence      float64 `json:"confidence"`
	VolatilityValue float64 `json:"volatilityValue"`
}
