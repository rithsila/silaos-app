package config

import (
	"os"
	"strings"
)

// LoadDotEnv reads KEY=VALUE pairs from the first existing env file paths and
// sets any variable that is not already set (or empty) in the process env.
func LoadDotEnv(paths ...string) {
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(raw), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			line = strings.TrimPrefix(line, "export ")
			idx := strings.IndexByte(line, '=')
			if idx <= 0 {
				continue
			}
			key := strings.TrimSpace(line[:idx])
			val := strings.TrimSpace(line[idx+1:])
			if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
				val = val[1 : len(val)-1]
			} else if hash := strings.Index(val, " #"); hash >= 0 {
				val = strings.TrimSpace(val[:hash])
			}
			if key == "" || val == "" {
				continue
			}
			if strings.TrimSpace(os.Getenv(key)) == "" {
				_ = os.Setenv(key, val)
			}
		}
		return
	}
}

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
