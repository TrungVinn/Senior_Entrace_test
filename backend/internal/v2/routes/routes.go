package routes

import (
	"github.com/gofiber/fiber/v3"
	"trading-dashboard/internal/v2/handlers"
	"trading-dashboard/internal/v2/repos"
)

func SetupRoutes(app *fiber.App) {
	repo := repos.NewPortfolioRepository()
	h := handlers.NewPortfolioHandler(repo)

	v2 := app.Group("/api/v2")
	v2.Get("/ping", h.Ping)
	v2.Get("/portfolio/summary", h.Summary)
	v2.Get("/portfolio/positions", h.Positions)
}
