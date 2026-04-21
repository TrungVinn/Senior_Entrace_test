package handlers

import (
	"github.com/gofiber/fiber/v3"
	"trading-dashboard/internal/api"
	"trading-dashboard/internal/v2/repos"
)

type PortfolioHandler struct {
	repo *repos.PortfolioRepository
}

func NewPortfolioHandler(repo *repos.PortfolioRepository) *PortfolioHandler {
	return &PortfolioHandler{repo: repo}
}

func (h *PortfolioHandler) Ping(c fiber.Ctx) error {
	return api.Success(c, fiber.StatusOK, fiber.Map{"version": "v2", "status": "ok"})
}

func (h *PortfolioHandler) Summary(c fiber.Ctx) error {
	return api.Success(c, fiber.StatusOK, h.repo.GetPortfolioSummary())
}

func (h *PortfolioHandler) Positions(c fiber.Ctx) error {
	positions, err := h.repo.ListPositions()
	if err != nil {
		return api.Error(c, fiber.StatusInternalServerError, "failed to list positions")
	}
	return api.Success(c, fiber.StatusOK, positions)
}
