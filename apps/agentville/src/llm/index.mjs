// Chooses the brain. AGENTVILLE_PROVIDER=offline|anthropic forces one; by
// default Claude is used when Anthropic credentials are present in the env.
import { createClaudeBrain } from './anthropic.mjs';
import { createOfflineBrain } from './offline.mjs';

export const DEFAULT_MODEL = 'claude-opus-5-5';

export async function selectBrain(env = process.env, { log = console } = {}) {
  const forced = String(env.AGENTVILLE_PROVIDER ?? '').toLowerCase();
  const hasCredentials = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE);
  const wantClaude = forced === 'anthropic' || (forced !== 'offline' && hasCredentials);
  if (wantClaude) {
    try {
      return await createClaudeBrain({ model: env.AGENTVILLE_MODEL || DEFAULT_MODEL });
    } catch (error) {
      log.warn?.(`[agentville] Claude 두뇌를 만들지 못해 시뮬레이션 두뇌로 전환합니다: ${error.message}`);
    }
  }
  return createOfflineBrain({ delayMs: Number(env.AGENTVILLE_SIM_DELAY ?? 18) });
}
