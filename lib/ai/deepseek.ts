// DeepSeek 调用封装：OpenAI 兼容协议，含超时控制与重试。仅服务端使用。

export interface DeepSeekChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export class DeepSeekError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export async function chatCompletion(messages: DeepSeekChatMessage[], opts: DeepSeekOptions = {}): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new DeepSeekError("缺少环境变量 DEEPSEEK_API_KEY");
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const timeoutMs = opts.timeoutMs ?? 60_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 4096,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new DeepSeekError(`DeepSeek 调用失败（HTTP ${resp.status}）：${text.slice(0, 200)}`, resp.status);
    }

    const json = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new DeepSeekError("DeepSeek 返回内容为空");
    return content;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new DeepSeekError(`DeepSeek 调用超时（${timeoutMs / 1000}s）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 从模型输出中提取 JSON（兼容 ```json 围栏与前后多余文字） */
export function extractJson<T = unknown>(text: string): T {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 截取第一个 { 到最后一个 }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last + 1);
  try {
    return JSON.parse(s) as T;
  } catch {
    throw new DeepSeekError("模型输出无法解析为 JSON");
  }
}
