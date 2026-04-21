package routes

import (
	"github.com/gofiber/fiber/v3"
	"trading-dashboard/internal/db"
	"trading-dashboard/internal/v1/handlers"
	"trading-dashboard/internal/v1/repos"
)

func SetupRoutes(app *fiber.App, connections *db.Connections) {
	marketRepo := repos.NewMarketRepository(connections.ClickHouse)
	marketH := handlers.NewMarketHandler(marketRepo)

	aiRepo := repos.NewAIRepository(connections.ClickHouse)
	aiH := handlers.NewAIHandler(aiRepo)

	v1 := app.Group("/api/v1")

	v1.Get("/ping", marketH.Ping)

	// Market data (from ClickHouse)
	v1.Get("/market/overview", marketH.Overview)
	v1.Get("/market/klines", marketH.Klines)
	v1.Get("/market/symbols", marketH.Symbols)

	// AI outputs (from ClickHouse)
	v1.Get("/ai/signals", aiH.Signals)
	v1.Get("/ai/anomalies", aiH.Anomalies)
	v1.Get("/ai/regime", aiH.Regime)
}
