package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	for _, k := range []string{
		"AGENT_PORT", "BACKEND_URL", "AGENT_DATA_DIR", "API_KEY",
		"AGENT_PROVIDER", "AGENT_MODEL", "AGENT_BASE_URL",
		"AGENT_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
	} {
		t.Setenv(k, "")
	}

	cfg := Load()
	if cfg.Port != "8081" {
		t.Fatalf("expected default Port 8081, got %q", cfg.Port)
	}
	if cfg.BackendURL != "http://localhost:8080" {
		t.Fatalf("expected default BackendURL http://localhost:8080, got %q", cfg.BackendURL)
	}
	if cfg.DataDir != ".lifeos-agent" {
		t.Fatalf("expected default DataDir .lifeos-agent, got %q", cfg.DataDir)
	}
	if cfg.Provider != "openai" {
		t.Fatalf("expected default Provider openai, got %q", cfg.Provider)
	}
	if cfg.Model == "" {
		t.Fatalf("expected non-empty default Model")
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("AGENT_PORT", "9090")
	t.Setenv("BACKEND_URL", "http://127.0.0.1:8080")
	t.Setenv("AGENT_DATA_DIR", "/tmp/lifeos-agent-data")
	t.Setenv("API_KEY", "secret-key")
	t.Setenv("AGENT_PROVIDER", "anthropic")
	t.Setenv("AGENT_MODEL", "claude-sonnet-4-5")
	t.Setenv("AGENT_BASE_URL", "https://proxy.example.com")
	t.Setenv("AGENT_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "sk-test")
	t.Setenv("OPENAI_API_KEY", "")

	cfg := Load()
	if cfg.Port != "9090" || cfg.BackendURL != "http://127.0.0.1:8080" || cfg.DataDir != "/tmp/lifeos-agent-data" {
		t.Fatalf("unexpected basic overrides: %+v", cfg)
	}
	if cfg.APIKey != "secret-key" || cfg.Provider != "anthropic" || cfg.Model != "claude-sonnet-4-5" {
		t.Fatalf("unexpected provider overrides: %+v", cfg)
	}
	if cfg.BaseURL != "https://proxy.example.com" || cfg.LLMAPIKey != "sk-test" {
		t.Fatalf("unexpected auth/url overrides: %+v", cfg)
	}
}
