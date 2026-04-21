package repos

import (
	"trading-dashboard/internal/models"
)

// PortfolioRepository provides portfolio data.
// Uses mock data (ClickHouse-only backend — no PostgreSQL).
type PortfolioRepository struct{}

func NewPortfolioRepository() *PortfolioRepository {
	return &PortfolioRepository{}
}

func (r *PortfolioRepository) GetPortfolioSummary() models.PortfolioSummary {
	return models.PortfolioSummary{
		TotalValue:      124567.89,
		TodayGain:       1234.56,
		TodayGainPct:    0.99,
		TotalReturn:     24567.89,
		TotalReturnPct:  24.56,
		ActivePositions: 3,
		TotalInvested:   100000,
	}
}

func (r *PortfolioRepository) ListPositions() ([]models.Position, error) {
	return []models.Position{
		{ID: 1, Symbol: "BTCUSDT", Quantity: 1.5, EntryPrice: 65000, CurrentPrice: 75600, ProfitLoss: 15900, ProfitLossPct: 16.31},
		{ID: 2, Symbol: "ETHUSDT", Quantity: 10, EntryPrice: 2100, CurrentPrice: 2305, ProfitLoss: 2050, ProfitLossPct: 9.76},
		{ID: 3, Symbol: "SOLUSDT", Quantity: 100, EntryPrice: 70, CurrentPrice: 85.33, ProfitLoss: 1533, ProfitLossPct: 21.90},
	}, nil
}
