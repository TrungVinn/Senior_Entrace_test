package config

import (
	"os"
	"strconv"
)

type Config struct {
	ServiceName string
	Port        int

	// ClickHouse Cloud (only database for backend)
	ClickHouseHost     string
	ClickHousePort     int
	ClickHouseUser     string
	ClickHousePassword string
	ClickHouseDatabase string
	ClickHouseSecure   bool
}

func InitConfig() Config {
	port, _ := strconv.Atoi(getEnv("PORT", "8080"))
	// Backend uses clickhouse-go native TCP driver (port 9440 secure / 9000 plain),
	// distinct from the HTTPS port 8443 used by Python clickhouse-connect.
	chPort, _ := strconv.Atoi(getEnv("CLICKHOUSE_NATIVE_PORT", "9440"))
	chSecure := getEnv("CLICKHOUSE_SECURE", "true") == "true"

	return Config{
		ServiceName:        getEnv("SERVICE_NAME", "trading-dashboard"),
		Port:               port,
		ClickHouseHost:     getEnv("CLICKHOUSE_HOST", ""),
		ClickHousePort:     chPort,
		ClickHouseUser:     getEnv("CLICKHOUSE_USER", "default"),
		ClickHousePassword: getEnv("CLICKHOUSE_PASSWORD", ""),
		ClickHouseDatabase: getEnv("CLICKHOUSE_DATABASE", "default"),
		ClickHouseSecure:   chSecure,
	}
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}
