export type ScriptedReply =
  | { text: string; thinking?: string }
  | { toolCalls: { name: string; arguments: Record<string, unknown> }[] }
  | { error: { status: number; type: string; message: string } };

export interface FakeRequest {
  model?: string;
  system?: unknown;
  messages: { role: string; content: unknown }[];
  tools?: { name: string }[];
  stream?: boolean;
  max_tokens?: number;
}

export interface FakeAnthropic {
  url: string;
  requests: FakeRequest[];
  script: ScriptedReply[];
  /** Tokens reported for every agent request; raise them to test budgets. */
  usage: { input_tokens: number; output_tokens: number };
  stop(): void;
}

/** True for requests from the agent loop; Claude Code also makes small side
 *  requests (titles, summaries) that never carry the session's tools. */
export const isAgentRequest = (request: FakeRequest): boolean =>
  !!request.tools?.length;

/** A minimal Anthropic Messages API (SSE) endpoint driven by a script of
 *  replies. It listens on 127.0.0.1 only; the Claude Code subprocess reaches
 *  it through ANTHROPIC_BASE_URL in tests, so nothing leaves the machine. */
export function startFakeAnthropic(
  respond?: (request: FakeRequest) => ScriptedReply | Promise<ScriptedReply>,
): FakeAnthropic {
  const requests: FakeRequest[] = [];
  const script: ScriptedReply[] = [];
  const usage = { input_tokens: 10, output_tokens: 5 };
  let counter = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname.endsWith("/count_tokens"))
        return Response.json({ input_tokens: 10 });
      if (request.method !== "POST" || !url.pathname.endsWith("/messages"))
        return new Response(JSON.stringify({ type: "error" }), {
          status: 404,
        });
      const body = (await request.json()) as FakeRequest;
      const id = `msg_fake_${++counter}`;
      const agent = isAgentRequest(body);
      if (agent) requests.push(body);
      const reply: ScriptedReply = !agent
        ? { text: "Pico" }
        : respond
          ? await respond(body)
          : (script.shift() ?? { text: "(no scripted reply)" });
      if ("error" in reply)
        return Response.json(
          {
            type: "error",
            error: { type: reply.error.type, message: reply.error.message },
          },
          { status: reply.error.status },
        );
      const model = body.model ?? "claude-fake";
      // Side requests stay cheap, so budget tests count agent requests only.
      const used = agent
        ? { ...usage }
        : { input_tokens: 10, output_tokens: 5 };
      const events: [string, unknown][] = [
        [
          "message_start",
          {
            type: "message_start",
            message: {
              id,
              type: "message",
              role: "assistant",
              model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: used.input_tokens, output_tokens: 1 },
            },
          },
        ],
      ];
      let index = 0;
      if ("text" in reply) {
        if (reply.thinking) {
          events.push(
            [
              "content_block_start",
              {
                type: "content_block_start",
                index,
                content_block: {
                  type: "thinking",
                  thinking: "",
                  signature: "",
                },
              },
            ],
            [
              "content_block_delta",
              {
                type: "content_block_delta",
                index,
                delta: { type: "thinking_delta", thinking: reply.thinking },
              },
            ],
            [
              "content_block_delta",
              {
                type: "content_block_delta",
                index,
                delta: { type: "signature_delta", signature: "fake" },
              },
            ],
            ["content_block_stop", { type: "content_block_stop", index }],
          );
          index++;
        }
        events.push(
          [
            "content_block_start",
            {
              type: "content_block_start",
              index,
              content_block: { type: "text", text: "" },
            },
          ],
          [
            "content_block_delta",
            {
              type: "content_block_delta",
              index,
              delta: { type: "text_delta", text: reply.text },
            },
          ],
          ["content_block_stop", { type: "content_block_stop", index }],
        );
      } else
        for (const call of reply.toolCalls) {
          events.push(
            [
              "content_block_start",
              {
                type: "content_block_start",
                index,
                content_block: {
                  type: "tool_use",
                  id: `toolu_${counter}_${index}`,
                  name: call.name,
                  input: {},
                },
              },
            ],
            [
              "content_block_delta",
              {
                type: "content_block_delta",
                index,
                delta: {
                  type: "input_json_delta",
                  partial_json: JSON.stringify(call.arguments),
                },
              },
            ],
            ["content_block_stop", { type: "content_block_stop", index }],
          );
          index++;
        }
      events.push(
        [
          "message_delta",
          {
            type: "message_delta",
            delta: {
              stop_reason: "text" in reply ? "end_turn" : "tool_use",
              stop_sequence: null,
            },
            usage: used,
          },
        ],
        ["message_stop", { type: "message_stop" }],
      );
      if (!body.stream)
        return Response.json({
          id,
          type: "message",
          role: "assistant",
          model,
          content:
            "text" in reply
              ? [{ type: "text", text: reply.text }]
              : reply.toolCalls.map((call, i) => ({
                  type: "tool_use",
                  id: `toolu_${counter}_${i}`,
                  name: call.name,
                  input: call.arguments,
                })),
          stop_reason: "text" in reply ? "end_turn" : "tool_use",
          stop_sequence: null,
          usage: used,
        });
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const [event, data] of events)
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "request-id": `req_fake_${counter}`,
        },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    script,
    usage,
    stop: () => server.stop(true),
  };
}
