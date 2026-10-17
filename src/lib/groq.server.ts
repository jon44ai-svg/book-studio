// Single Groq chat-completions call. No retries here: the pipeline runner owns
// retries so every attempt is reserved and charged against the budget.

export type ChatRequest = {
  model: string
  system: string
  user: string
  temperature: number
  maxTokens: number
  json: boolean
  signal?: AbortSignal
}

export type ChatResult = {
  content: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

export class GroqError extends Error {
  status: number | null
  retryable: boolean
  retryAfterMs: number | null

  constructor(message: string, status: number | null, retryable: boolean, retryAfterMs: number | null) {
    super(message)
    this.name = 'GroqError'
    this.status = status
    this.retryable = retryable
    this.retryAfterMs = retryAfterMs
  }
}

const BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'

export function hasGroqKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY)
}

export async function chatOnce(req: ChatRequest): Promise<ChatResult> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new GroqError('GROQ_API_KEY is not set on the server', null, false, null)

  const started = Date.now()
  let response: Response
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: req.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: req.model,
        temperature: req.temperature,
        max_completion_tokens: req.maxTokens,
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    })
  } catch (error) {
    // Network failure: the request may or may not have been processed.
    throw new GroqError(`Network error: ${(error as Error).message}`, null, true, null)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const retryAfter = response.headers.get('retry-after')
    const retryAfterMs = retryAfter && !Number.isNaN(Number(retryAfter)) ? Number(retryAfter) * 1000 : null
    const retryable = response.status === 429 || response.status >= 500
    throw new GroqError(
      `Groq ${response.status}: ${text.slice(0, 300)}`,
      response.status,
      retryable,
      retryAfterMs,
    )
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    content: body.choices?.[0]?.message?.content ?? '',
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - started,
  }
}

export async function listModels(): Promise<Array<string>> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new GroqError('GROQ_API_KEY is not set on the server', null, false, null)
  const response = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!response.ok) throw new GroqError(`Groq ${response.status}`, response.status, false, null)
  const body = (await response.json()) as { data?: Array<{ id: string }> }
  return (body.data ?? []).map((model) => model.id)
}
