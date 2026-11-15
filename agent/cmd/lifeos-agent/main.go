package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"lifeos-agent/internal/chat"
	"lifeos-agent/internal/config"
	"lifeos-agent/internal/httpapi"
	"lifeos-agent/internal/lifeostools"
)

func main() {
	config.LoadDotEnv(".env", "../.env")
	cfg := config.Load()
	client := lifeostools.NewClient(cfg.BackendURL, cfg.APIKey)
	mgr := chat.NewManager(cfg, client, nil)
	handler := httpapi.NewRouter(cfg, mgr)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("lifeos-agent listening on http://0.0.0.0:%s (backend: %s, llmConfigured: %v)", cfg.Port, cfg.BackendURL, cfg.LLMAPIKey != "")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
