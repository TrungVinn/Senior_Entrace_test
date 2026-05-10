package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"trading-dashboard/internal/api"
	"trading-dashboard/internal/config"
	"trading-dashboard/internal/db"
	"trading-dashboard/internal/middlewares"
	v1Routes "trading-dashboard/internal/v1/routes"
	v2Routes "trading-dashboard/internal/v2/routes"
)

func main() {
	loadEnvFiles()

	cfg := config.InitConfig()

	connections := db.InitConnections(cfg)
	defer connections.Close()

	app := fiber.New(fiber.Config{
		ProxyHeader:        fiber.HeaderXForwardedFor,
		EnableIPValidation: true,
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Request-ID"},
	}))

	app.Use(middlewares.RequestID())
	app.Use(middlewares.RequestLogging())

	app.Get("/health", func(c fiber.Ctx) error {
		return api.Success(c, fiber.StatusOK, fiber.Map{
			"status":  "ok",
			"service": cfg.ServiceName,
			"clickhouse": func() string {
				if connections.ClickHouse != nil {
					return "connected"
				}
				return "disconnected"
			}(),
		})
	})

	v1Routes.SetupRoutes(app, connections)
	v2Routes.SetupRoutes(app)

	listenAddr := fmt.Sprintf("0.0.0.0:%d", cfg.Port)
	log.Printf("server running on http://%s", listenAddr)
	if err := app.Listen(listenAddr); err != nil {
		log.Fatalf("server start failed: %v", err)
	}
}

func loadEnvFiles() {
	for _, path := range []string{".env", "../.env"} {
		if err := loadEnvFile(path); err == nil {
			return
		}
	}
}

func loadEnvFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		if commentIndex := strings.Index(line, " #"); commentIndex != -1 {
			line = strings.TrimSpace(line[:commentIndex])
		}

		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}

		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}

	return scanner.Err()
}
