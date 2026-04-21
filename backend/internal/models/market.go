package models

import (
	"math"
	"time"
)

// CleanNaN replaces NaN float64 pointers with nil for safe JSON serialization.
func CleanNaN(v *float64) *float64 {
	if v != nil && math.IsNaN(*v) {
		return nil
	}
	return v
}

// MarketOverview represents the latest price snapshot for a symbol.
type MarketOverview struct {
	Symbol    string   `json:"symbol"`
	Timestamp string   `json:"timestamp"`
	Close     float64  `json:"close"`
	Volume    float64  `json:"volume"`
	SMA7      *float64 `json:"sma7"`
	RSI14     *float64 `json:"rsi14"`
}

// Kline represents a single candlestick with computed features.
type Kline struct {
	Symbol       string    `json:"symbol"`
	Timestamp    time.Time `json:"timestamp"`
	Open         float64   `json:"open"`
	High         float64   `json:"high"`
	Low          float64   `json:"low"`
	Close        float64   `json:"close"`
	Volume       float64   `json:"volume"`
	QuoteVolume  float64   `json:"quoteVolume"`
	NumTrades    uint32    `json:"numTrades"`
	IsClosed     bool      `json:"isClosed"`
	Interval     string    `json:"interval"`
	SMA7         *float64  `json:"sma7"`
	SMA25        *float64  `json:"sma25"`
	SMA99        *float64  `json:"sma99"`
	RSI14        *float64  `json:"rsi14"`
	LogReturn    *float64  `json:"logReturn"`
	PctChange    *float64  `json:"pctChange"`
	Volatility20 *float64  `json:"volatility20"`
	VWAP         *float64  `json:"vwap"`
}
