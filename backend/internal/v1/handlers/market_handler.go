package handlers

import (
	"strconv"

	"github.com/gofiber/fiber/v3"
	"trading-dashboard/internal/api"
	"trading-dashboard/internal/v1/repos"
)

type MarketHandler struct {
	repo *repos.MarketRepository
}

func NewMarketHandler(repo *repos.MarketRepository) *MarketHandler {
	return &MarketHandler{repo: repo}
}

func (h *MarketHandler) Ping(c fiber.Ctx) error {
	return api.Success(c, fiber.StatusOK, fiber.Map{"version": "v1", "status": "ok"})
}

func (h *MarketHandler) Overview(c fiber.Ctx) error {
	data, err := h.repo.GetMarketOverview(c.Context())
	if err != nil {
		return api.Error(c, fiber.StatusInternalServerError, "failed to fetch market overview")
	}
	return api.Success(c, fiber.StatusOK, data)
}

func (h *MarketHandler) Klines(c fiber.Ctx) error {
	symbol := c.Query("symbol", "BTCUSDT")
	limit, _ := strconv.Atoi(c.Query("limit", "200"))

	data, err := h.repo.GetKlines(c.Context(), symbol, limit)
	if err != nil {
		return api.Error(c, fiber.StatusInternalServerError, "failed to fetch klines")
	}
	return api.Success(c, fiber.StatusOK, data)
}

func (h *MarketHandler) Symbols(c fiber.Ctx) error {
	data, err := h.repo.GetSymbols(c.Context())
	if err != nil {
		return api.Error(c, fiber.StatusInternalServerError, "failed to fetch symbols")
	}
	return api.Success(c, fiber.StatusOK, data)
}
