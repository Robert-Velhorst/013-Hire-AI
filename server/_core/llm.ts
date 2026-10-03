import { ENV } from "./env";
import { z } from "zod";
import {
  outboundRequestSignal,
  OUTBOUND_RESPONSE_MAX_BYTES,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseJson,
  ResponseSizeLimitError,
} from "./outboundRequest";
import { buildTrustedServiceUrl } from "./trustedServiceUrl";
import { compileLlmSchema, type LlmSchemaValidator } from "./llmSchema";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent> | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const responseContentPart = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({ url: z.string().min(1), detail: z.enum(["auto", "low", "high"]).optional() }),
  }).passthrough(),
  z.object({
    type: z.literal("file_url"),
    file_url: z.object({ url: z.string().min(1), mime_type: z.enum([
      "audio/mpeg", "audio/wav", "application/pdf", "audio/mp4", "video/mp4",
    ]).optional() }),
  }).passthrough(),
]);

const responseSchema = z.object({
  id: z.string().min(1),
  created: z.number().int().nonnegative(),
  model: z.string().min(1),
  choices: z.array(z.object({
    index: z.number().int().nonnegative(),
    finish_reason: z.enum(["stop", "tool_calls"]),
    message: z.object({
      role: z.literal("assistant"),
      content: z.union([z.string(), z.array(responseContentPart), z.null()]),
      refusal: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        id: z.string().min(1),
        type: z.literal("function"),
        function: z.object({ name: z.string().min(1), arguments: z.string() }),
      })).optional(),
    }).passthrough(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }).passthrough().optional(),
}).passthrough();

function validateResponse(
  value: unknown,
  tools: Tool[] | undefined,
  toolChoice: "none" | "auto" | ToolChoiceExplicit | undefined,
  responseFormat: ResponseFormat | undefined,
  outputValidator: LlmSchemaValidator | undefined,
  toolValidators: Map<string, LlmSchemaValidator>,
): InvokeResult {
  const parsed = responseSchema.safeParse(value);
  // Never surface Zod issues: they can contain provider-supplied private data.
  if (!parsed.success) throw new Error("LLM response was incomplete or malformed");
  for (const choice of parsed.data.choices) {
    const { content, refusal, tool_calls } = choice.message;
    if (refusal != null) throw new Error("LLM response was refused");
    if (choice.finish_reason === "tool_calls") {
      if (toolChoice === "none" || !tool_calls?.length || tool_calls.some(call =>
        !tools?.some(tool => tool.function.name === call.function.name) ||
        (typeof toolChoice === "object" && toolChoice.function.name !== call.function.name))) {
        throw new Error("LLM response did not contain valid requested tools");
      }
      for (const call of tool_calls) {
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          throw new Error("LLM response contained malformed tool arguments");
        }
        if (args === null || typeof args !== "object" || Array.isArray(args)) {
          throw new Error("LLM response tool arguments must be a JSON object");
        }
        if (toolValidators.get(call.function.name)?.(args) === false) {
          throw new Error("LLM response tool arguments do not match the requested schema");
        }
      }
    } else {
      if (typeof toolChoice === "object") throw new Error("LLM response omitted the required tool");
      const hasContent = typeof content === "string" ? Boolean(content.trim())
        : content?.some(part => part.type !== "text" || Boolean(part.text.trim()));
      if (!hasContent || tool_calls?.length) throw new Error("LLM response was empty or inconsistent");
      if (responseFormat && responseFormat.type !== "text") {
        let structured: unknown;
        try {
          if (typeof content !== "string") throw new Error();
          structured = JSON.parse(content);
        } catch {
          throw new Error("LLM response did not contain valid structured JSON");
        }
        if (responseFormat.type === "json_object" &&
            (structured === null || typeof structured !== "object" || Array.isArray(structured))) {
          throw new Error("LLM response structured output must be a JSON object");
        }
        if (outputValidator?.(structured) === false) {
          throw new Error("LLM response does not match the requested schema");
        }
      }
    }
  }
  return parsed.data;
}

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

const resolveApiBaseUrl = () =>
  ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
    ? ENV.forgeApiUrl
    : "https://forge.manus.im";

const assertApiKey = () => {
  if (!ENV.forgeApiKey) {
    throw new Error("BUILT_IN_FORGE_API_KEY is not configured");
  }
};

const resolveMaxTokens = ({ maxTokens, max_tokens }: InvokeParams): number => {
  if (maxTokens !== undefined && max_tokens !== undefined && maxTokens !== max_tokens) {
    throw new Error("Conflicting maxTokens and max_tokens budgets");
  }
  const budget = maxTokens !== undefined
    ? maxTokens
    : max_tokens !== undefined ? max_tokens : 32768;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 32768) {
    throw new Error("Token budget must be an integer between 1 and 32768");
  }
  return budget;
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  assertApiKey();

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
  } = params;

  const payload: Record<string, unknown> = {
    model: "gemini-2.5-flash",
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  payload.max_tokens = resolveMaxTokens(params);
  payload.thinking = {
    "budget_tokens": 128
  };

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const outputValidator = normalizedResponseFormat?.type === "json_schema"
    ? compileLlmSchema(normalizedResponseFormat.json_schema.schema) : undefined;
  const toolValidators = new Map<string, LlmSchemaValidator>();
  for (const tool of tools ?? []) {
    if (tool.function.parameters) {
      toolValidators.set(tool.function.name, compileLlmSchema(tool.function.parameters));
    }
  }

  const response = await fetch(buildTrustedServiceUrl(resolveApiBaseUrl(), "v1/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.forgeApiKey}`,
    },
    body: JSON.stringify(payload),
    signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.generation),
    redirect: "error",
  });

  if (!response.ok) {
    // Providers may echo prompts or credentials in their errors. Discard the
    // response instead of passing private content to callers or their logs.
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`LLM invoke failed: HTTP ${response.status}`);
  }

  let result: unknown;
  try {
    result = await readBoundedResponseJson<unknown>(response, OUTBOUND_RESPONSE_MAX_BYTES.llmOrTranscription);
  } catch (error) {
    if (error instanceof ResponseSizeLimitError) throw error;
    // JSON parser and stream errors can include fragments of the response.
    throw new Error("LLM response could not be read as valid JSON");
  }
  return validateResponse(result, tools, normalizedToolChoice,
    normalizedResponseFormat, outputValidator, toolValidators);
}
