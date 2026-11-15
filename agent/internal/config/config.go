package config

import (
	"os"
	"strings"
)

// Config holds runtime settings for the Life OS Norma agent sidecar.
type Config struct {
	Port       string
	BackendURL string
	DataDir    string
	APIKey     string
	Provider   string
	Model      string
	BaseURL    string
	LLMAPIKey  string
}

// Load reads configuration from environment variables with safe defaults.
func Load() Config {
	provider := strings.ToLower(envOr("AGENT_PROVIDER", "openai"))
	defaultModel := "gpt-4o-mini"
	if provider == "anthropic" {
		defaultModel = "claude-sonnet-4-5"
	}

	llmKey := firstNonEmpty(
		os.Getenv("AGENT_API_KEY"),
		func() string {
			if provider == "anthropic" {
				return os.Getenv("ANTHROPIC_API_KEY")
			}
			return os.Getenv("OPENAI_API_KEY")
		}(),
		os.Getenv("ANTHROPIC_API_KEY"),
		os.Getenv("OPENAI_API_KEY"),
	)

	return Config{
		Port:       envOr("AGENT_PORT", "8081"),
		BackendURL: strings.TrimRight(envOr("BACKEND_URL", "http://localhost:8080"), "/"),
		DataDir:    envOr("AGENT_DATA_DIR", ".lifeos-agent"),
		APIKey:     os.Getenv("API_KEY"),
		Provider:   provider,
		Model:      envOr("AGENT_MODEL", defaultModel),
		BaseURL:    strings.TrimRight(os.Getenv("AGENT_BASE_URL"), "/"),
		LLMAPIKey:  llmKey,
	}
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}
