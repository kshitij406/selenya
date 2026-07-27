/**
 * Provider/model constants with zero SDK dependency.
 *
 * Split out of assistant.ts so screens that only need to render a model
 * picker (onboarding) don't pull the Anthropic SDK into their bundle chunk —
 * only the screen that actually sends a request (AssistantScreen) should.
 */

export type AssistantProvider = 'anthropic' | 'openai' | 'openrouter'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5'
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra'
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/**
 * By policy this app only ever calls OpenRouter's zero-cost tier: every
 * OpenRouter model id on that tier ends in ':free'. Enforced both by
 * restricting the picker to this list AND by a hard runtime check in
 * assistant.ts that rejects any non-':free' model before sending a request
 * — so even a hand-edited config can't accidentally incur a charge. This
 * list may drift as OpenRouter's free catalog changes; check
 * openrouter.ai/models?max_price=0 for the current set.
 */
export const OPENROUTER_FREE_SUFFIX = ':free'
export const OPENROUTER_FREE_MODELS = [
  { id: 'deepseek/deepseek-chat-v3.1:free', label: 'DeepSeek Chat v3.1 · free' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B · free' },
  { id: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash · free' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small 3.1 · free' },
] as const
export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_FREE_MODELS[0].id

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 · most capable' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 · balanced' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 · fastest' },
] as const
