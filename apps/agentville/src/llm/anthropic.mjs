// Claude brain: official Anthropic SDK, streamed text for deliverables and
// chat, JSON-schema structured output for debriefs, reflections and character
// generation. Server-side fallbacks retry a safety decline on another model.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class RefusalError extends Error {
  constructor(category) {
    super(`요청이 안전 정책으로 거절되었습니다${category ? ` (${category})` : ''}.`);
    this.name = 'RefusalError';
    this.category = category ?? null;
  }
}

// `fallback` blocks are audit markers for a server-side model switch. A
// stream keeps the declined model's partial text and the fallback model
// continues from it; a non-streamed reply omits the partial. Either way the
// reply is every text block in order. A refusal means the whole chain declined.
export function readText(message) {
  if (message.stop_reason === 'refusal') throw new RefusalError(message.stop_details?.category);
  return (message.content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('');
}

export async function createClaudeBrain({ model }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  let useFallbacks = true;

  const request = (params) => (useFallbacks ? { model, ...params, betas: [FALLBACK_BETA], fallbacks: 'default' } : { model, ...params });

  // An account or proxy that rejects the fallback parameter still works: drop
  // it once and keep going without it.
  async function guarded(run) {
    try {
      return await run();
    } catch (error) {
      if (useFallbacks && error instanceof Anthropic.BadRequestError && /fallback/i.test(String(error.message))) {
        useFallbacks = false;
        return run();
      }
      throw error;
    }
  }

  return {
    name: 'claude',
    live: true,
    model,
    async text({ system, messages, effort = 'medium', maxTokens = 32000, onText }) {
      return guarded(async () => {
        const stream = client.beta.messages.stream(request({ max_tokens: maxTokens, system, messages, output_config: { effort } }));
        if (onText) stream.on('text', (delta) => onText(delta));
        const message = await stream.finalMessage();
        return readText(message);
      });
    },
    async json({ system, messages, schema, effort = 'low', maxTokens = 6000 }) {
      return guarded(async () => {
        const message = await client.beta.messages.create(request({
          max_tokens: maxTokens,
          system,
          messages,
          output_config: { effort, format: { type: 'json_schema', schema } },
        }));
        return JSON.parse(readText(message));
      });
    },
    describeError(error) {
      if (error instanceof RefusalError) return error.message;
      if (error instanceof Anthropic.AuthenticationError) return 'API 키를 확인해 주세요 (인증 실패).';
      if (error instanceof Anthropic.RateLimitError) return '요청이 많아 잠시 제한되었습니다. 조금 뒤 다시 시도해 주세요.';
      if (error instanceof Anthropic.BadRequestError) return `요청 형식 오류: ${error.message}`;
      if (error instanceof Anthropic.APIConnectionError) return 'Claude API에 연결하지 못했습니다. 네트워크를 확인해 주세요.';
      if (error instanceof Anthropic.APIError) return `Claude API 오류 ${error.status ?? ''}: ${error.message}`;
      return error?.message ?? String(error);
    },
  };
}
