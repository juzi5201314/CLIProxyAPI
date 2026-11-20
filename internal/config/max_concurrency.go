package config

import (
	"fmt"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/credentialconcurrency"
	"gopkg.in/yaml.v3"
)

// MaxCredentialConcurrency is the largest allowed positive credential concurrency limit.
const MaxCredentialConcurrency = int(credentialconcurrency.Max)

// ValidateCredentialMaxConcurrency validates one optional config credential max-concurrency setting.
func ValidateCredentialMaxConcurrency(limit *int) error {
	if limit == nil {
		return nil
	}
	_, errNormalize := credentialconcurrency.Normalize(int64(*limit))
	return errNormalize
}

func validateMaxConcurrencyYAML(data []byte) error {
	var document yaml.Node
	if errUnmarshal := yaml.Unmarshal(data, &document); errUnmarshal != nil {
		return nil
	}
	if len(document.Content) == 0 {
		return nil
	}
	root, err := flattenV8(document.Content[0])
	if err != nil {
		return err
	}
	families := map[string]struct{}{
		"gemini-api-key": {}, "interactions-api-key": {}, "claude-api-key": {},
		"vertex-api-key": {}, "codex-api-key": {}, "xai-api-key": {}, "meta-api-key": {},
	}
	for index := 0; root != nil && root.Kind == yaml.MappingNode && index+1 < len(root.Content); index += 2 {
		name := root.Content[index].Value
		value := root.Content[index+1]
		if _, ok := families[name]; ok {
			if errValidate := validateMaxConcurrencySequenceNode(value, name); errValidate != nil {
				return errValidate
			}
			continue
		}
		if name == "openai-compatibility" {
			if errValidate := validateOpenAICompatibilityMaxConcurrencyNodes(value); errValidate != nil {
				return errValidate
			}
		}
	}
	return nil
}

func validateMaxConcurrencySequenceNode(sequence *yaml.Node, path string) error {
	if sequence == nil || sequence.Kind != yaml.SequenceNode {
		return nil
	}
	for index, item := range sequence.Content {
		if errValidate := validateMaxConcurrencyMappingNode(item, fmt.Sprintf("%s[%d]", path, index)); errValidate != nil {
			return errValidate
		}
	}
	return nil
}

func validateMaxConcurrencyMappingNode(mapping *yaml.Node, path string) error {
	if mapping == nil || mapping.Kind != yaml.MappingNode {
		return nil
	}
	for index := 0; index+1 < len(mapping.Content); index += 2 {
		if mapping.Content[index].Value != "max-concurrency" {
			continue
		}
		value := mapping.Content[index+1]
		if value.Kind == yaml.ScalarNode && value.Tag == "!!null" {
			continue
		}
		if value.Kind != yaml.ScalarNode || value.Tag != "!!int" {
			return fmt.Errorf("%s.max-concurrency: max-concurrency must be an integer", path)
		}
		var limit int64
		if errDecode := value.Decode(&limit); errDecode != nil {
			return fmt.Errorf("%s.max-concurrency: max-concurrency must be an integer", path)
		}
		if _, errNormalize := credentialconcurrency.Normalize(limit); errNormalize != nil {
			return fmt.Errorf("%s.max-concurrency: %w", path, errNormalize)
		}
	}
	return nil
}

func validateOpenAICompatibilityMaxConcurrencyNodes(sequence *yaml.Node) error {
	if sequence == nil || sequence.Kind != yaml.SequenceNode {
		return nil
	}
	for providerIndex, provider := range sequence.Content {
		if provider == nil || provider.Kind != yaml.MappingNode {
			continue
		}
		providerPath := fmt.Sprintf("openai-compatibility[%d]", providerIndex)
		if errValidate := validateMaxConcurrencyMappingNode(provider, providerPath); errValidate != nil {
			return errValidate
		}
		for index := 0; index+1 < len(provider.Content); index += 2 {
			if provider.Content[index].Value != "api-key-entries" {
				continue
			}
			path := fmt.Sprintf("openai-compatibility[%d].api-key-entries", providerIndex)
			if errValidate := validateMaxConcurrencySequenceNode(provider.Content[index+1], path); errValidate != nil {
				return errValidate
			}
		}
	}
	return nil
}

// ValidateMaxConcurrencies validates max-concurrency settings for every API-key family and provider.
func (cfg *Config) ValidateMaxConcurrencies() error {
	if cfg == nil {
		return nil
	}
	for index := range cfg.GeminiKey {
		if errValidate := ValidateCredentialMaxConcurrency(cfg.GeminiKey[index].MaxConcurrency); errValidate != nil {
			return fmt.Errorf("gemini-api-key[%d].max-concurrency: %w", index, errValidate)
		}
	}
	for index := range cfg.InteractionsKey {
		if errValidate := ValidateCredentialMaxConcurrency(cfg.InteractionsKey[index].MaxConcurrency); errValidate != nil {
			return fmt.Errorf("interactions-api-key[%d].max-concurrency: %w", index, errValidate)
		}
	}
	for index := range cfg.ClaudeKey {
		if errValidate := ValidateCredentialMaxConcurrency(cfg.ClaudeKey[index].MaxConcurrency); errValidate != nil {
			return fmt.Errorf("claude-api-key[%d].max-concurrency: %w", index, errValidate)
		}
	}
	for index := range cfg.VertexCompatAPIKey {
		if errValidate := ValidateCredentialMaxConcurrency(cfg.VertexCompatAPIKey[index].MaxConcurrency); errValidate != nil {
			return fmt.Errorf("vertex-api-key[%d].max-concurrency: %w", index, errValidate)
		}
	}
	for index := range cfg.CodexKey {
		if errValidate := ValidateCredentialMaxConcurrency(cfg.CodexKey[index].MaxConcurrency); errValidate != nil {
			return fmt.Errorf("codex-api-key[%d].max-concurrency: %w", index, errValidate)
		}
	}
	for index := range cfg.XAIKey {
		if errValidate := ValidateCredentialMaxConcurrency(cfg.XAIKey[index].MaxConcurrency); errValidate != nil {
			return fmt.Errorf("xai-api-key[%d].max-concurrency: %w", index, errValidate)
		}
	}
	for index := range cfg.MetaKey {
		if errValidate := ValidateCredentialMaxConcurrency(cfg.MetaKey[index].MaxConcurrency); errValidate != nil {
			return fmt.Errorf("meta-api-key[%d].max-concurrency: %w", index, errValidate)
		}
	}
	for providerIndex := range cfg.OpenAICompatibility {
		provider := &cfg.OpenAICompatibility[providerIndex]
		if errValidate := ValidateCredentialMaxConcurrency(provider.MaxConcurrency); errValidate != nil {
			return fmt.Errorf("openai-compatibility[%d].max-concurrency: %w", providerIndex, errValidate)
		}
		for keyIndex := range provider.APIKeyEntries {
			limit := provider.APIKeyEntries[keyIndex].MaxConcurrency
			if errValidate := ValidateCredentialMaxConcurrency(limit); errValidate != nil {
				return fmt.Errorf("openai-compatibility[%d].api-key-entries[%d].max-concurrency: %w", providerIndex, keyIndex, errValidate)
			}
		}
	}
	return nil
}
