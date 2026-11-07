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

// A paused server-tool turn is resumed by sending it back; this bounds how
// many times one step may do that.
const MAX_CONTINUATIONS = 4;

// Blocks that neither carry the answer nor split it into paragraphs.
const QUIET_BLOCKS = new Set(['text', 'fallback', 'thinking', 'redacted_thinking']);

// Joins a reply's text blocks in order. `fallback` blocks are audit markers
// for a server-side model switch: a stream keeps the declined model's partial
// text and the fallback model continues it, a non-streamed reply omits the
// partial, so either way every text block belongs. Web-search answers come as
// many cited fragments of one paragraph and join directly; text that resumes
// after a tool call starts a new paragraph.
export function assembleText(blocks) {
  let out = '';
  let afterTool = false;
  for (const block of blocks ?? []) {
    if (block.type === 'text') {
      if (afterTool && out && !out.endsWith('\n\n')) out += out.endsWith('\n') ? '\n' : '\n\n';
      out += block.text;
      afterTool = false;
    } else if (!QUIET_BLOCKS.has(block.type)) {
      afterTool = true;
    }
  }
  return out;
}

// A refusal means the whole fallback chain declined.
export function readText(message) {
  if (message.stop_reason === 'refusal') throw new RefusalError(message.stop_details?.category);
  return assembleText(message.content);
}

// Unique web pages cited by the answer, in first-cited order.
export function collectSources(blocks) {
  const seen = new Map();
  for (const block of blocks ?? []) {
    if (block.type !== 'text') continue;
    for (const citation of block.citations ?? []) {
      if (citation?.url && !seen.has(citation.url)) seen.set(citation.url, citation.title || citation.url);
    }
  }
  return [...seen].map(([url, title]) => ({ url, title }));
}

export function formatSources(sources) {
  if (!sources.length) return '';
  const clean = (value) => String(value).replace(/[\[\]\n]/g, ' ').trim();
  return `\n\n### 출처\n${sources.map(({ url, title }) => `- [${clean(title)}](${url})`).join('\n')}`;
}

const firstLine = (value, max = 80) => {
  const line = String(value ?? '').trim().split('\n')[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

// Human-readable trace of a finished server-tool block, or null.
export function describeToolBlock(block) {
  switch (block?.type) {
    case 'server_tool_use':
      if (block.name === 'web_search') return { tool: 'web_search', use: true, text: `검색: ${firstLine(block.input?.query)}` };
      if (block.name === 'web_fetch') return { tool: 'web_fetch', use: true, text: `읽기: ${firstLine(block.input?.url)}` };
      if (block.name === 'text_editor_code_execution') return { tool: 'code_execution', use: true, text: `파일 ${block.input?.command ?? ''}: ${firstLine(block.input?.path)}` };
      if (/code_execution/.test(block.name ?? '')) return { tool: 'code_execution', use: true, text: `실행: ${firstLine(block.input?.command ?? block.input?.code)}` };
      return null;
    case 'web_search_tool_result': {
      const content = block.content;
      if (Array.isArray(content)) return { tool: 'web_search', text: `결과 ${content.length}건` };
      return { tool: 'web_search', text: `검색 실패 (${content?.error_code ?? '알 수 없음'})`, error: true };
    }
    case 'web_fetch_tool_result': {
      const content = block.content ?? {};
      if (content.type === 'web_fetch_result') return { tool: 'web_fetch', text: `읽음: ${firstLine(content.content?.title || content.url)}` };
      return { tool: 'web_fetch', text: `읽기 실패 (${content.error_code ?? '알 수 없음'})`, error: true };
    }
    case 'bash_code_execution_tool_result': {
      const content = block.content ?? {};
      if (content.type === 'bash_code_execution_result') {
        const failed = content.return_code !== 0;
        return { tool: 'code_execution', text: failed ? `종료 코드 ${content.return_code}: ${firstLine(content.stderr)}` : `완료${content.stdout ? `: ${firstLine(content.stdout)}` : ''}`, error: failed };
      }
      return { tool: 'code_execution', text: `실행 실패 (${content.error_code ?? '알 수 없음'})`, error: true };
    }
    default:
      return null;
  }
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
    // `tools` are tool definitions: server tools (web search and fetch, cloud
    // code) that Anthropic runs inside the call, and client tools (computer
    // toolset, text editor, bash, custom tools) that `runTools` executes here:
    // it gets each turn's tool_use blocks and returns their tool_result blocks.
    // The history only ever grows (earlier turns are never edited), which
    // keeps thinking blocks valid and the prompt cache warm. `onActivity` gets
    // a short trace of each server-tool use and result as it finishes.
    async text({ system, messages, effort = 'medium', maxTokens = 32000, tools = [], onText, onActivity, runTools = null, maxTurns = 40, signal = null }) {
      return guarded(async () => {
        const history = [...messages];
        const blocks = [];
        // Mirrors assembleText's paragraph break so the live view matches.
        let wrote = false;
        let afterTool = false;
        let continuations = 0;
        for (let turn = 0; ; turn += 1) {
          const params = { max_tokens: maxTokens, system, messages: history, output_config: { effort } };
          if (tools.length) params.tools = tools;
          // Agent loops resend a growing conversation: cache its tail.
          if (runTools) params.cache_control = { type: 'ephemeral' };
          const stream = client.beta.messages.stream(request(params), signal ? { signal } : undefined);
          stream.on('streamEvent', (event) => {
            if (event.type !== 'content_block_start') return;
            const type = event.content_block?.type;
            if (type === 'text' && afterTool && wrote) onText?.('\n\n');
            if (type === 'text') afterTool = false;
            else if (!QUIET_BLOCKS.has(type)) afterTool = true;
          });
          stream.on('text', (delta) => {
            wrote = true;
            onText?.(delta);
          });
          if (onActivity) {
            stream.on('contentBlock', (block) => {
              const activity = describeToolBlock(block);
              if (activity) onActivity(activity);
            });
          }
          const message = await stream.finalMessage();
          if (message.stop_reason === 'refusal') throw new RefusalError(message.stop_details?.category);
          blocks.push(...message.content);
          // A long server-tool loop pauses; sending the turn back resumes it.
          if (message.stop_reason === 'pause_turn' && continuations < MAX_CONTINUATIONS) {
            continuations += 1;
            history.push({ role: 'assistant', content: message.content });
            continue;
          }
          if (message.stop_reason === 'tool_use' && runTools) {
            const uses = message.content.filter((block) => block.type === 'tool_use');
            history.push({ role: 'assistant', content: message.content });
            // Past the turn limit every call is answered with a request to
            // wrap up; two more turns allow for that before giving up.
            const results = turn < maxTurns
              ? await runTools(uses)
              : uses.map((block) => ({ type: 'tool_result', tool_use_id: block.id, ...(block.toolset_name ? { toolset_name: block.toolset_name } : {}), content: '이번 업무의 작업 한도에 도달했습니다. 도구를 더 쓰지 말고 지금까지의 결과로 마무리하세요.', is_error: true }));
            history.push({ role: 'user', content: results });
            if (turn < maxTurns + 1) continue;
          }
          break;
        }
        const sources = formatSources(collectSources(blocks));
        if (sources) onText?.(sources);
        return assembleText(blocks) + sources;
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
      if (error?.name === 'AbortedError' || error instanceof Anthropic.APIUserAbortError) return '사용자가 업무를 멈췄어요.';
      if (error instanceof Anthropic.AuthenticationError) return 'API 키를 확인해 주세요 (인증 실패).';
      if (error instanceof Anthropic.RateLimitError) return '요청이 많아 잠시 제한되었습니다. 조금 뒤 다시 시도해 주세요.';
      if (error instanceof Anthropic.BadRequestError) return `요청 형식 오류: ${error.message}`;
      if (error instanceof Anthropic.APIConnectionError) return 'Claude API에 연결하지 못했습니다. 네트워크를 확인해 주세요.';
      if (error instanceof Anthropic.APIError) return `Claude API 오류 ${error.status ?? ''}: ${error.message}`;
      return error?.message ?? String(error);
    },
  };
}
