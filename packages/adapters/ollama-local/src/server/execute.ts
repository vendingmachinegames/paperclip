import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  buildPaperclipEnv,
  parseObject,
  renderTemplate,
} from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from "../index.js";
import { connectMcpServers, type McpBridge, type McpServersConfig, type McpToolSpec } from "./mcp-bridge.js";

const MCP_TOOL_ITERATION_LIMIT = 20;

interface OllamaToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
}

export interface OllamaChunkLine {
  type: "chunk";
  content: string;
}

export interface OllamaDoneLine {
  type: "done";
  model: string;
  prompt_eval_count: number;
  eval_count: number;
  total_duration_ns: number;
}

export interface OllamaErrorLine {
  type: "error";
  message: string;
}

export type OllamaStdoutLine = OllamaChunkLine | OllamaDoneLine | OllamaErrorLine;

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI assistant integrated into the Paperclip control plane. Respond concisely and helpfully.";

function buildContextNote(context: Record<string, unknown>): string {
  const parts: string[] = [];
  const taskId =
    (typeof context.taskId === "string" && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim()
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim()
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim()
      ? context.approvalStatus.trim()
      : null;
  if (taskId) parts.push(`Task ID: ${taskId}`);
  if (wakeReason) parts.push(`Wake reason: ${wakeReason}`);
  if (wakeCommentId) parts.push(`Wake comment ID: ${wakeCommentId}`);
  if (approvalId) parts.push(`Approval ID: ${approvalId}`);
  if (approvalStatus) parts.push(`Approval status: ${approvalStatus}`);
  return parts.join("\n");
}

/**
 * Try to resolve a possibly-untagged model name (e.g. "llama3.2") to the exact
 * name Ollama has installed (e.g. "llama3.2:3b").  Falls back to the original
 * name if the tags API is unavailable or no match is found.
 */
async function resolveModelName(baseUrl: string, requested: string): Promise<string> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return requested;
    const body = (await res.json()) as Record<string, unknown>;
    if (!Array.isArray(body.models)) return requested;
    const names: string[] = (body.models as Record<string, unknown>[])
      .filter((m) => typeof m.name === "string")
      .map((m) => m.name as string);

    // 1. Exact match
    if (names.includes(requested)) return requested;

    // 2. Exact match ignoring case
    const lower = requested.toLowerCase();
    const exact = names.find((n) => n.toLowerCase() === lower);
    if (exact) return exact;

    // 3. Base-name match (strip tag from both sides)
    const requestedBase = requested.split(":")[0].toLowerCase();
    const baseMatch = names.find(
      (n) => n.split(":")[0].toLowerCase() === requestedBase,
    );
    if (baseMatch) return baseMatch;
  } catch {
    // network error / timeout — continue with original name
  }
  return requested;
}

function extractMcpServers(config: Record<string, unknown>): McpServersConfig | null {
  const raw = config.mcpServers;
  if (!raw || typeof raw !== "object") return null;
  const servers = raw as McpServersConfig;
  return Object.keys(servers).length > 0 ? servers : null;
}

function toolSpecsToOllama(specs: McpToolSpec[]): Array<Record<string, unknown>> {
  return specs.map((spec) => ({
    type: "function",
    function: {
      name: spec.qualifiedName,
      description: spec.description.slice(0, 1024),
      parameters: spec.parameters,
    },
  }));
}

function normalizeToolCallArgs(args: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return args;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta } = ctx;

  const baseUrl = asString(config.baseUrl, DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
  const rawModel = asString(config.model, DEFAULT_OLLAMA_MODEL).trim();
  const timeoutSec = asNumber(config.timeoutSec, 300);
  const temperature =
    typeof config.temperature === "number" && Number.isFinite(config.temperature)
      ? config.temperature
      : undefined;
  const systemPrompt = asString(config.system, DEFAULT_SYSTEM_PROMPT);

  // Resolve the model name against what Ollama actually has installed.
  // e.g. config says "llama3.2" but Ollama stores it as "llama3.2:3b".
  const model = await resolveModelName(baseUrl, rawModel);

  // Connect to any MCP servers the agent has configured. If any are set,
  // we swap from streaming text to a non-streaming tool-calling loop:
  // streaming tool_calls varies wildly across Ollama versions/models, and
  // tools plus streaming is the most common source of bugs in the wild.
  // (See upstream issue #2525.) Local-model latency is usually fine.
  const mcpServers = extractMcpServers(config);
  let mcpBridge: McpBridge | null = null;
  if (mcpServers) {
    try {
      mcpBridge = await connectMcpServers(mcpServers, {
        name: "paperclip-ollama-adapter",
        version: "0.1.0",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await onLog("stderr", `[mcp-bridge] init failed: ${message}\n`);
      mcpBridge = null;
    }
  }
  const mcpTools = mcpBridge?.tools ?? [];
  const useToolLoop = mcpTools.length > 0;

  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId },
    context,
  };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);

  // Annotate user message with Paperclip context
  const contextNote = buildContextNote(context);
  const userContent = contextNote.length > 0 ? `${contextNote}\n\n${renderedPrompt}` : renderedPrompt;

  // Rehydrate prior conversation history from session
  const sessionParams = parseObject(runtime.sessionParams);
  const priorMessages: OllamaMessage[] = (() => {
    if (!Array.isArray(sessionParams.messages)) return [];
    return (sessionParams.messages as unknown[]).filter((m): m is OllamaMessage => {
      if (typeof m !== "object" || m === null || Array.isArray(m)) return false;
      const record = m as Record<string, unknown>;
      return typeof record.role === "string" && typeof record.content === "string";
    });
  })();

  const messages: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
    ...priorMessages,
    { role: "user", content: userContent },
  ];

  // Emit Paperclip-standard env vars for logging/meta (no subprocess, but agent needs context)
  const paperclipEnv = buildPaperclipEnv(agent);

  if (onMeta) {
    await onMeta({
      adapterType: "ollama_local",
      command: `POST ${baseUrl}/api/chat`,
      cwd: process.cwd(),
      commandNotes: [
        `Model: ${model}`,
        `Prior conversation turns: ${Math.floor(priorMessages.length / 2)}`,
        useToolLoop ? `MCP tools: ${mcpTools.length}` : "Streaming: true",
      ],
      commandArgs: [],
      env: {
        PAPERCLIP_AGENT_ID: paperclipEnv.PAPERCLIP_AGENT_ID ?? agent.id,
        PAPERCLIP_COMPANY_ID: paperclipEnv.PAPERCLIP_COMPANY_ID ?? agent.companyId,
      },
      prompt: userContent,
      promptMetrics: {
        promptChars: userContent.length,
        heartbeatPromptChars: renderedPrompt.length,
      },
      context,
    });
  }

  // Set up AbortController for timeout
  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle =
    timeoutSec > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutSec * 1000)
      : null;

  let assistantContent = "";
  let promptEvalCount = 0;
  let evalCount = 0;
  let exitCode: number | null = null;
  let errorMessage: string | null = null;

  try {
    if (useToolLoop && mcpBridge) {
      const outcome = await runToolLoop({
        baseUrl,
        model,
        messages,
        temperature,
        tools: toolSpecsToOllama(mcpTools),
        bridge: mcpBridge,
        onLog,
        signal: controller.signal,
      });
      assistantContent = outcome.assistantContent;
      promptEvalCount = outcome.promptEvalCount;
      evalCount = outcome.evalCount;
    } else {
      const requestBody: Record<string, unknown> = {
        model,
        messages,
        stream: true,
      };
      if (temperature !== undefined) {
        requestBody.options = { temperature };
      }

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        const errMsg = bodyText.trim() || `HTTP ${response.status} ${response.statusText}`;
        const errLine: OllamaErrorLine = { type: "error", message: errMsg };
        await onLog("stderr", JSON.stringify(errLine) + "\n");
        return {
          exitCode: 1,
          signal: null,
          timedOut: false,
          errorMessage: `Ollama returned ${response.status}: ${errMsg}`,
          provider: "ollama",
          model,
          resultJson: { error: errMsg },
        };
      }

      if (!response.body) {
        throw new Error("Ollama response has no body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line) as Record<string, unknown>;
          } catch {
            await onLog("stdout", line + "\n");
            continue;
          }

          const isDone = parsed.done === true;
          const messageObj =
            typeof parsed.message === "object" && parsed.message !== null
              ? (parsed.message as Record<string, unknown>)
              : null;
          const contentChunk =
            typeof messageObj?.content === "string" ? messageObj.content : "";

          if (!isDone && contentChunk) {
            assistantContent += contentChunk;
            const chunkLine: OllamaChunkLine = { type: "chunk", content: contentChunk };
            await onLog("stdout", JSON.stringify(chunkLine) + "\n");
          }

          if (isDone) {
            promptEvalCount =
              typeof parsed.prompt_eval_count === "number" ? parsed.prompt_eval_count : 0;
            evalCount = typeof parsed.eval_count === "number" ? parsed.eval_count : 0;
            const totalDurationNs =
              typeof parsed.total_duration === "number" ? parsed.total_duration : 0;
            const doneLine: OllamaDoneLine = {
              type: "done",
              model: typeof parsed.model === "string" ? parsed.model : model,
              prompt_eval_count: promptEvalCount,
              eval_count: evalCount,
              total_duration_ns: totalDurationNs,
            };
            await onLog("stdout", JSON.stringify(doneLine) + "\n");
          }
        }
      }
    }

    exitCode = 0;
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (timedOut) {
      return {
        exitCode: null,
        signal: null,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        provider: "ollama",
        model,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("connect EREFUSED") ||
      msg.includes("Failed to fetch")
    ) {
      const errLine: OllamaErrorLine = {
        type: "error",
        message: `Cannot reach Ollama at ${baseUrl}: ${msg}`,
      };
      await onLog("stderr", JSON.stringify(errLine) + "\n");
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: `Cannot reach Ollama at ${baseUrl}. Is Ollama running? Run: ollama serve`,
        errorCode: "ollama_not_running",
        provider: "ollama",
        model,
      };
    }
    const errLine: OllamaErrorLine = { type: "error", message: msg };
    await onLog("stderr", JSON.stringify(errLine) + "\n");
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: msg,
      provider: "ollama",
      model,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (mcpBridge) {
      await mcpBridge.close().catch(() => {});
    }
  }

  // Build updated session params with appended message history
  const updatedMessages: OllamaMessage[] = [
    ...priorMessages,
    { role: "user", content: userContent },
    ...(assistantContent ? [{ role: "assistant" as const, content: assistantContent }] : []),
  ];

  return {
    exitCode,
    signal: null,
    timedOut: false,
    errorMessage: exitCode === 0 ? null : (errorMessage ?? `Ollama exited with code ${exitCode}`),
    usage:
      promptEvalCount || evalCount
        ? { inputTokens: promptEvalCount, outputTokens: evalCount }
        : undefined,
    provider: "ollama",
    model,
    billingType: "subscription",
    sessionParams: updatedMessages.length > 0 ? { messages: updatedMessages } : null,
    summary: assistantContent.trim() || null,
  };
}

interface ToolLoopParams {
  baseUrl: string;
  model: string;
  messages: OllamaMessage[];
  temperature: number | undefined;
  tools: Array<Record<string, unknown>>;
  bridge: McpBridge;
  onLog: AdapterExecutionContext["onLog"];
  signal: AbortSignal;
}

interface ToolLoopOutcome {
  assistantContent: string;
  promptEvalCount: number;
  evalCount: number;
}

/**
 * Non-streaming tool-calling loop. Streaming + tool_calls is brittle
 * across Ollama versions (upstream issue #2525), so we accept the
 * latency cost to get correctness.
 *
 * Each iteration POSTs the growing message list, executes any
 * tool_calls the model returned, appends `tool` role messages with
 * results, and loops until the model returns a turn with no tool_calls
 * or MCP_TOOL_ITERATION_LIMIT is reached.
 */
async function runToolLoop(params: ToolLoopParams): Promise<ToolLoopOutcome> {
  const { baseUrl, model, messages, temperature, tools, bridge, onLog, signal } = params;

  let totalPromptEval = 0;
  let totalEval = 0;
  let finalAssistantContent = "";

  for (let iter = 0; iter < MCP_TOOL_ITERATION_LIMIT; iter += 1) {
    const requestBody: Record<string, unknown> = {
      model,
      messages,
      tools,
      stream: false,
    };
    if (temperature !== undefined) {
      requestBody.options = { temperature };
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(
        `Ollama returned ${response.status}: ${bodyText.trim() || response.statusText}`,
      );
    }

    const parsed = (await response.json()) as Record<string, unknown>;
    const messageObj =
      typeof parsed.message === "object" && parsed.message !== null
        ? (parsed.message as Record<string, unknown>)
        : null;

    if (typeof parsed.prompt_eval_count === "number") totalPromptEval += parsed.prompt_eval_count;
    if (typeof parsed.eval_count === "number") totalEval += parsed.eval_count;

    const assistantText = typeof messageObj?.content === "string" ? messageObj.content : "";
    const rawToolCalls = Array.isArray(messageObj?.tool_calls)
      ? (messageObj.tool_calls as unknown[])
      : [];

    // Record assistant turn (visible in UI stream) even if it's a
    // tool-call-only turn with empty content.
    if (assistantText) {
      const chunkLine: OllamaChunkLine = { type: "chunk", content: assistantText };
      await onLog("stdout", JSON.stringify(chunkLine) + "\n");
      finalAssistantContent = assistantText;
    }

    const assistantMessage: OllamaMessage = {
      role: "assistant",
      content: assistantText,
    };
    const toolCallsNormalized: OllamaToolCall[] = [];
    for (const raw of rawToolCalls) {
      if (!raw || typeof raw !== "object") continue;
      const fn = (raw as Record<string, unknown>).function;
      if (!fn || typeof fn !== "object") continue;
      const fnRecord = fn as Record<string, unknown>;
      if (typeof fnRecord.name !== "string") continue;
      toolCallsNormalized.push({
        id: typeof (raw as Record<string, unknown>).id === "string"
          ? String((raw as Record<string, unknown>).id)
          : undefined,
        function: {
          name: fnRecord.name,
          arguments: fnRecord.arguments as Record<string, unknown> | string,
        },
      });
    }
    if (toolCallsNormalized.length > 0) {
      assistantMessage.tool_calls = toolCallsNormalized;
    }
    messages.push(assistantMessage);

    if (toolCallsNormalized.length === 0) {
      // Model stopped requesting tools — this was the final turn.
      await onLog(
        "stdout",
        JSON.stringify({
          type: "done",
          model,
          prompt_eval_count: totalPromptEval,
          eval_count: totalEval,
          total_duration_ns: 0,
        } satisfies OllamaDoneLine) + "\n",
      );
      return {
        assistantContent: finalAssistantContent,
        promptEvalCount: totalPromptEval,
        evalCount: totalEval,
      };
    }

    // Execute each tool call; append results as `tool` messages.
    for (const call of toolCallsNormalized) {
      const args = normalizeToolCallArgs(call.function.arguments);
      const result = await bridge.callTool(call.function.name, args);
      messages.push({
        role: "tool",
        content: result || "(empty tool result)",
        tool_call_id: call.id,
      });
      await onLog(
        "stderr",
        `[mcp] ${call.function.name} -> ${result.length} chars\n`,
      );
    }
  }

  // Hit the safety limit. Record what we have and note the truncation.
  await onLog(
    "stderr",
    `[mcp] tool-call iteration limit (${MCP_TOOL_ITERATION_LIMIT}) reached; truncating.\n`,
  );
  return {
    assistantContent:
      finalAssistantContent
      || `(reached ${MCP_TOOL_ITERATION_LIMIT}-iteration tool-call safety limit without final answer)`,
    promptEvalCount: totalPromptEval,
    evalCount: totalEval,
  };
}
