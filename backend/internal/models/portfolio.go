package models

import "time"

// Position represents a single portfolio position.
type Position struct {
	ID            int64     `json:"id"`
	UserID        int64     `json:"userId"`
	Symbol        string    `json:"symbol"`
	Quantity      float64   `json:"quantity"`
	EntryPrice    float64   `json:"entryPrice"`
	CurrentPrice  float64   `json:"currentPrice"`
	ProfitLoss    float64   `json:"profitLoss"`
	ProfitLossPct float64   `json:"profitLossPct"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// PortfolioSummary is an aggregated view of all positions.
type PortfolioSummary struct {
	TotalValue      float64 `json:"totalValue"`
	TodayGain       float64 `json:"todayGain"`
	TodayGainPct    float64 `json:"todayGainPct"`
	TotalReturn     float64 `json:"totalReturn"`
	TotalReturnPct  float64 `json:"totalReturnPct"`
	ActivePositions int     `json:"activePositions"`
	TotalInvested   float64 `json:"totalInvested"`
}
