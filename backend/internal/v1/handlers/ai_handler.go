package handlers

import (
	"github.com/gofiber/fiber/v3"
	"trading-dashboard/internal/api"
	"trading-dashboard/internal/v1/repos"
)

type AIHandler struct {
	repo *repos.AIRepository
}

func NewAIHandler(repo *repos.AIRepository) *AIHandler {
	return &AIHandler{repo: repo}
}

func (h *AIHandler) Signals(c fiber.Ctx) error {
	data, err := h.repo.GetSignals(c.Context())
	if err != nil {
		return api.Error(c, fiber.StatusInternalServerError, "failed to fetch signals")
	}
	return api.Success(c, fiber.StatusOK, data)
}

func (h *AIHandler) Anomalies(c fiber.Ctx) error {
	data, err := h.repo.GetAnomalies(c.Context())
	if err != nil {
		return api.Error(c, fiber.StatusInternalServerError, "failed to fetch anomalies")
	}
	return api.Success(c, fiber.StatusOK, data)
}

func (h *AIHandler) Regime(c fiber.Ctx) error {
	data, err := h.repo.GetRegime(c.Context())
	if err != nil {
		return api.Error(c, fiber.StatusInternalServerError, "failed to fetch regime")
	}
	return api.Success(c, fiber.StatusOK, data)
}
