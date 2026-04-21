package middlewares

import (
	"log"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"
)

func RequestID() fiber.Handler {
	return requestid.New()
}

func RequestLogging() fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()
		err := c.Next()
		log.Printf("request_id=%s method=%s path=%s status=%d duration=%s", c.Get("X-Request-ID"), c.Method(), c.Path(), c.Response().StatusCode(), time.Since(start))
		return err
	}
}
