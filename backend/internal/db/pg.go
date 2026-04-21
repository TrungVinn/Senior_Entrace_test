package db

import (
	"crypto/tls"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"trading-dashboard/internal/config"
)

type Connections struct {
	ClickHouse *sql.DB
}

func InitConnections(cfg config.Config) *Connections {
	conn := &Connections{}

	if cfg.ClickHouseHost == "" {
		log.Println("CLICKHOUSE_HOST not set — running without ClickHouse (mock mode)")
		return conn
	}

	var tlsCfg *tls.Config
	if cfg.ClickHouseSecure {
		tlsCfg = &tls.Config{}
	}

	chDB := clickhouse.OpenDB(&clickhouse.Options{
		Addr: []string{fmt.Sprintf("%s:%d", cfg.ClickHouseHost, cfg.ClickHousePort)},
		Auth: clickhouse.Auth{
			Database: cfg.ClickHouseDatabase,
			Username: cfg.ClickHouseUser,
			Password: cfg.ClickHousePassword,
		},
		TLS: tlsCfg,
		Settings: clickhouse.Settings{
			"max_execution_time": 60,
		},
		DialTimeout: 10 * time.Second,
		Protocol:    clickhouse.Native,
	})

	if err := chDB.Ping(); err != nil {
		log.Printf("WARNING: ClickHouse connection failed: %v (mock mode)", err)
		return conn
	}

	conn.ClickHouse = chDB
	log.Printf("ClickHouse connected: %s:%d", cfg.ClickHouseHost, cfg.ClickHousePort)
	return conn
}

func (c *Connections) Close() {
	if c.ClickHouse != nil {
		c.ClickHouse.Close()
	}
}
