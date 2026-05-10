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
	// Backend talks to ClickHouse Cloud over HTTPS on port 8443.
	chPort, _ := strconv.Atoi(getEnv("CLICKHOUSE_PORT", "8443"))
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
