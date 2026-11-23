import { getProviderConfig, isLocalUrl } from '../config.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAIProvider } from './openai.js';

export function createProvider(config, name) {
  const provider = getProviderConfig(config, name);
  if (!provider.model) {
    throw new Error(`provider "${provider.name}" has no model configured`);
  }
  if (!provider.baseUrl) {
    throw new Error(`provider "${provider.name}" has no baseUrl configured`);
  }
  if (!provider.apiKey && !isLocalEndpoint(provider.baseUrl)) {
    const envHint = provider.apiKeyEnv ? ` or export ${provider.apiKeyEnv}=...` : '';
    throw new Error(
      `provider "${provider.name}" is missing an API key. Run "chan config set providers.${provider.name}.apiKey=YOUR_KEY"${envHint}`,
    );
  }
  if (provider.type === 'anthropic') return createAnthropicProvider(provider);
  if (provider.type === 'openai' || provider.type === 'openai-compatible') return createOpenAIProvider(provider);
  throw new Error(`unsupported provider type "${provider.type}" (use "openai" or "anthropic")`);
}

export const isLocalEndpoint = isLocalUrl;

export { createOpenAIProvider, createAnthropicProvider };
