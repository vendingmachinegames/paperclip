import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Same wire format as packages/adapters/claude-local expects in
 * `adapterConfig.mcpServers`, so the same UI editor from PR #3337 works
 * unchanged for ollama_local.
 *
 * stdio: { command, args?, env? }
 * sse:    { type: "sse",  url, headers? }
 * http:   { type: "http", url, headers? }  (Streamable HTTP transport)
 */
export type McpServerStdio = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpServerHttp = {
  type: "sse" | "http";
  url: string;
  headers?: Record<string, string>;
};

export type McpServerSpec = McpServerStdio | McpServerHttp;

export type McpServersConfig = Record<string, McpServerSpec>;

export interface McpToolSpec {
  /** Server name this tool lives on (used to route invocations back). */
  server: string;
  /** Fully-qualified tool name, exposed to the LLM as `<server>__<tool>`. */
  qualifiedName: string;
  /** Original tool name as reported by the MCP server. */
  toolName: string;
  description: string;
  /** JSON Schema for the tool's input parameters. */
  parameters: Record<string, unknown>;
}

export interface McpBridge {
  tools: McpToolSpec[];
  /**
   * Call a tool by its qualified name (`<server>__<tool>`). Returns the
   * flattened text content of the tool result, suitable for inclusion in
   * the Ollama `tool` message body.
   */
  callTool(qualifiedName: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

function isStdioSpec(spec: McpServerSpec): spec is McpServerStdio {
  return typeof (spec as McpServerStdio).command === "string";
}

/**
 * Qualify tool names to avoid collisions across servers. Ollama needs a
 * flat tool namespace; MCP servers each have their own.
 */
function qualify(server: string, tool: string): string {
  // Ollama/most local models tolerate `server__tool`; keep it filename-safe.
  return `${server.replace(/[^a-zA-Z0-9_-]/g, "_")}__${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function parseQualified(qualified: string): { server: string; tool: string } | null {
  const idx = qualified.indexOf("__");
  if (idx < 0) return null;
  return { server: qualified.slice(0, idx), tool: qualified.slice(idx + 2) };
}

async function createTransport(spec: McpServerSpec) {
  if (isStdioSpec(spec)) {
    return new StdioClientTransport({
      command: spec.command,
      args: spec.args ?? [],
      env: spec.env ? { ...process.env as Record<string, string>, ...spec.env } : undefined,
    });
  }
  const url = new URL(spec.url);
  if (spec.type === "sse") {
    return new SSEClientTransport(url, {
      requestInit: spec.headers ? { headers: spec.headers } : undefined,
    });
  }
  return new StreamableHTTPClientTransport(url, {
    requestInit: spec.headers ? { headers: spec.headers } : undefined,
  });
}

/**
 * Connect to every configured MCP server, discover tools, and return a
 * bridge that can execute tool calls and cleanly disconnect.
 *
 * Connect failures for individual servers are swallowed with a console
 * warning rather than aborting the whole run — a misconfigured Gmail
 * server shouldn't prevent the agent from using a working filesystem
 * server. Failed servers contribute zero tools and their invocations
 * (which can't happen anyway since the LLM won't see the tool) are N/A.
 */
export async function connectMcpServers(
  servers: McpServersConfig,
  clientIdentity: { name: string; version: string },
): Promise<McpBridge> {
  const clients: Array<{ name: string; client: Client }> = [];
  const tools: McpToolSpec[] = [];

  for (const [serverName, spec] of Object.entries(servers)) {
    try {
      const transport = await createTransport(spec);
      const client = new Client(
        { name: clientIdentity.name, version: clientIdentity.version },
        { capabilities: {} },
      );
      await client.connect(transport);
      clients.push({ name: serverName, client });

      const listed = await client.listTools();
      for (const tool of listed.tools) {
        tools.push({
          server: serverName,
          qualifiedName: qualify(serverName, tool.name),
          toolName: tool.name,
          description: tool.description ?? "",
          parameters: (tool.inputSchema ?? {}) as Record<string, unknown>,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mcp-bridge] failed to connect to MCP server "${serverName}": ${message}`);
    }
  }

  const clientByName = new Map<string, Client>();
  for (const { name, client } of clients) clientByName.set(name, client);

  async function callTool(qualifiedName: string, args: Record<string, unknown>): Promise<string> {
    const parsed = parseQualified(qualifiedName);
    if (!parsed) {
      return `Error: invalid tool name "${qualifiedName}"`;
    }
    const client = clientByName.get(parsed.server);
    if (!client) {
      return `Error: no active MCP server named "${parsed.server}"`;
    }
    try {
      const result = await client.callTool({
        name: parsed.tool,
        arguments: args,
      });
      return flattenToolResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error calling ${qualifiedName}: ${message}`;
    }
  }

  async function close(): Promise<void> {
    for (const { client } of clients) {
      try {
        await client.close();
      } catch {
        // best-effort
      }
    }
  }

  return { tools, callTool, close };
}

/**
 * MCP tool results are a ContentBlock[] — we only need the text for the
 * Ollama `tool` message. Concatenate any text blocks; describe other
 * block types so the model at least knows something non-text came back.
 */
function flattenToolResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const obj = result as Record<string, unknown>;
  if (obj.isError) {
    const content = Array.isArray(obj.content) ? obj.content : [];
    const text = content
      .filter((c): c is { type: "text"; text: string } =>
        typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text",
      )
      .map((c) => c.text)
      .join("\n");
    return `Tool error: ${text || "unknown error"}`;
  }
  const content = Array.isArray(obj.content) ? obj.content : [];
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    } else if (b.type === "resource" && typeof b.resource === "object" && b.resource) {
      const res = b.resource as Record<string, unknown>;
      if (typeof res.text === "string") parts.push(res.text);
      else if (typeof res.uri === "string") parts.push(`[resource: ${res.uri}]`);
    } else if (typeof b.type === "string") {
      parts.push(`[${b.type} content]`);
    }
  }
  return parts.join("\n").trim();
}
