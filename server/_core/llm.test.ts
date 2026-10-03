import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ENV } from "./env";
import { invokeLLM, type InvokeParams } from "./llm";
import { parseResumeFromFile, parseResumeText, resumeToProfileData } from "../resumeParser";

const result = {
  id: "synthetic-completion",
  created: 1,
  model: "gemini-2.5-flash",
  choices: [{
    index: 0,
    message: { role: "assistant", content: "Synthetic answer" },
    finish_reason: "stop",
  }],
};
const messages: InvokeParams["messages"] = [{ role: "user", content: "Synthetic request" }];

describe("shared LLM request contract", () => {
  beforeEach(() => {
    vi.spyOn(ENV, "forgeApiKey", "get").mockReturnValue("synthetic-forge-key");
    vi.spyOn(ENV, "forgeApiUrl", "get").mockReturnValue("https://forge.example/base");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(result)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { options: {}, expected: 32768 },
    { options: { maxTokens: 1024 }, expected: 1024 },
    { options: { max_tokens: 2048 }, expected: 2048 },
    { options: { maxTokens: 4096, max_tokens: 4096 }, expected: 4096 },
    { options: { maxTokens: 1 }, expected: 1 },
    { options: { maxTokens: 32768 }, expected: 32768 },
  ])("sends the caller's token budget: $options", async ({ options, expected }) => {
    await expect(invokeLLM({ messages, ...options })).resolves.toEqual(result);
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://forge.example/base/v1/chat/completions");
    expect(request).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { authorization: "Bearer synthetic-forge-key" },
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(request!.body as string)).toMatchObject({
      model: "gemini-2.5-flash", messages, max_tokens: expected,
    });
  });

  it.each([0, -1, 1.5, 32769, NaN, Infinity, null, "1024"])(
    "rejects invalid token budget %s before contacting the provider", async (value) => {
      await expect(invokeLLM({ messages, maxTokens: value as number }))
        .rejects.toThrow(/token.*integer.*1.*32768/i);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("validates the snake-case token budget", async () => {
    await expect(invokeLLM({ messages, max_tokens: 0 })).rejects.toThrow(/token/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects conflicting aliases instead of silently ignoring one budget", async () => {
    await expect(invokeLLM({ messages, maxTokens: 1000, max_tokens: 2000 }))
      .rejects.toThrow(/conflict/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("identifies the actual missing credential without making a request", async () => {
    vi.spyOn(ENV, "forgeApiKey", "get").mockReturnValue("");
    await expect(invokeLLM({ messages })).rejects.toThrow("BUILT_IN_FORGE_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not propagate provider response bodies or status text into errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("private-resume-content", {
      status: 503, statusText: "private-provider-detail",
    }));
    const error = await invokeLLM({ messages }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("503");
    expect((error as Error).message).not.toMatch(/private-resume-content|private-provider-detail/);
  });

  it.each(["length", "content_filter", null, "unknown-provider-reason"])(
    "rejects non-complete generation status %s even when text is valid JSON", async (reason) => {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json({
        ...result,
        choices: [{ ...result.choices[0], finish_reason: reason,
          message: { role: "assistant", content: '{"summary":"Looks complete"}' } }],
      }));
      await expect(invokeLLM({ messages })).rejects.toThrow(/LLM response/i);
    },
  );

  it.each([
    null, {}, { ...result, choices: [] },
    { ...result, choices: [null] },
    { ...result, choices: [{ ...result.choices[0], message: null }] },
    { ...result, choices: [{ ...result.choices[0], message: { role: "user", content: "not an answer" } }] },
    { ...result, choices: [{ ...result.choices[0], message: { role: "assistant", content: 12 } }] },
    { ...result, choices: [{ ...result.choices[0], message: { role: "assistant", content: null } }] },
    { ...result, choices: [{ ...result.choices[0], message: { role: "assistant", content: " " } }] },
    { ...result, choices: [{ ...result.choices[0], message: { role: "assistant", content: [] } }] },
    { ...result, choices: [{ ...result.choices[0], message: { role: "assistant", content: [{ type: "text", text: 12 }] } }] },
  ])("rejects malformed or empty response %# without echoing it", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(body));
    await expect(invokeLLM({ messages })).rejects.toThrow(/LLM response/i);
  });

  it("rejects a refusal instead of passing it as application material", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      ...result, choices: [{ ...result.choices[0], message: {
        role: "assistant", content: "Synthetic answer", refusal: "private-refusal-detail",
      } }],
    }));
    const error = await invokeLLM({ messages }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/LLM response/i);
    expect((error as Error).message).not.toContain("private-refusal-detail");
  });

  it("does not leak malformed JSON through the parser error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("private-resume-content", { status: 200 }));
    const error = await invokeLLM({ messages }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/LLM response/i);
    expect((error as Error).message).not.toContain("private-resume-content");
  });

  it("preserves supported content parts and nullable refusal metadata", async () => {
    const body = { ...result, choices: [{ ...result.choices[0], message: {
      role: "assistant", content: [{ type: "text", text: "Complete answer" }], refusal: null,
    } }] };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(body));
    await expect(invokeLLM({ messages })).resolves.toMatchObject(body);
  });

  it.each(["auto", "required", { name: "analyze" }] as const)("keeps a completed function-tool response with null content: %s", async (toolChoice) => {
    const body = { ...result, choices: [{ index: 0, finish_reason: "tool_calls", message: {
      role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function",
        function: { name: "analyze", arguments: '{"value":1}' } }],
    } }] };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(body));
    await expect(invokeLLM({ messages, toolChoice, tools: [{ type: "function", function: { name: "analyze" } }] }))
      .resolves.toMatchObject(body);
  });

  it("does not substitute text when a function response was required", async () => {
    await expect(invokeLLM({ messages, toolChoice: "required",
      tools: [{ type: "function", function: { name: "analyze" } }],
    })).rejects.toThrow(/LLM response/i);
  });

  it.each([undefined, [], [{ id: "call-1", type: "function", function: { name: "unknown", arguments: "{}" } }]])(
    "rejects a tool completion without a valid requested tool: %#", async (tool_calls) => {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, choices: [{
        index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls },
      }] }));
      await expect(invokeLLM({ messages, tools: [{ type: "function", function: { name: "analyze" } }] }))
        .rejects.toThrow(/LLM response/i);
    },
  );

  it.each(["none", { name: "selected" }] as const)(
    "rejects a tool response outside the explicit tool choice: %s", async (toolChoice) => {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, choices: [{
        index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "other", arguments: "{}" } }],
        },
      }] }));
      await expect(invokeLLM({ messages, toolChoice, tools: [
        { type: "function", function: { name: "selected" } },
        { type: "function", function: { name: "other" } },
      ] })).rejects.toThrow(/LLM response/i);
    },
  );

  it.each(["{", "null", "[]", '"text"'])(
    "rejects malformed function argument objects without echoing them: %s", async (args) => {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, choices: [{
        index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "analyze", arguments: args } }],
        },
      }] }));
      await expect(invokeLLM({ messages, tools: [{ type: "function", function: { name: "analyze" } }] }))
        .rejects.toThrow(/LLM response/i);
    },
  );

  it("still enforces the response byte limit before schema validation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { headers: { "content-length": "8388609" } }));
    await expect(invokeLLM({ messages })).rejects.toThrow(/byte limit/);
  });

  const outputSchema = {
    name: "bounded_analysis",
    schema: { type: "object", properties: {
      score: { type: "integer", minimum: 0, maximum: 100 },
      skills: { type: "array", items: { type: "string" }, maxItems: 3 },
      status: { type: "string", enum: ["recorded", "missing"] },
    }, required: ["score", "skills", "status"], additionalProperties: false },
  };

  it.each([
    {}, { score: "80", skills: [], status: "recorded" },
    { score: 101, skills: [], status: "recorded" },
    { score: 80, skills: [12], status: "recorded" },
    { score: 80, skills: ["a", "b", "c", "d"], status: "recorded" },
    { score: 80, skills: [], status: "invented" },
    { score: 80, skills: [], status: "recorded", privateExtra: "private-input" },
    null, [],
  ])("enforces the requested JSON schema on content %#", async (content) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, choices: [{
      ...result.choices[0], message: { role: "assistant", content: JSON.stringify(content) },
    }] }));
    await expect(invokeLLM({ messages, outputSchema })).rejects.toThrow(/LLM.*schema/i);
  });

  it.each([
    { outputSchema }, { output_schema: outputSchema },
    { responseFormat: { type: "json_schema" as const, json_schema: outputSchema } },
    { response_format: { type: "json_schema" as const, json_schema: outputSchema } },
  ])("preserves valid structured content for every schema alias %#", async (options) => {
    const content = '{"score":80,"skills":["TypeScript"],"status":"recorded"}';
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, choices: [{
      ...result.choices[0], message: { role: "assistant", content },
    }] }));
    const response = await invokeLLM({ messages, ...options });
    expect(response.choices[0].message.content).toBe(content);
  });

  it.each(["not-json", "[]", "null", '"value"'])("requires an object for json_object mode: %s", async (content) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, choices: [{
      ...result.choices[0], message: { role: "assistant", content },
    }] }));
    await expect(invokeLLM({ messages, response_format: { type: "json_object" } }))
      .rejects.toThrow(/LLM.*structured/i);
  });

  it.each([
    { type: "not-a-type" },
    { type: "object", unknownValidationKeyword: true },
    { $ref: "https://untrusted.example/private-schema" },
    { $async: true, type: "object" },
  ])("rejects unsupported schemas before any provider call %#", async (schema) => {
    await expect(invokeLLM({ messages, outputSchema: { name: "invalid", schema } }))
      .rejects.toThrow(/LLM.*schema/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates function argument fields against the offered schema", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, choices: [{
      index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
        tool_calls: [{ id: "call-1", type: "function", function: { name: "analyze", arguments: '{"score":"wrong"}' } }],
      },
    }] }));
    await expect(invokeLLM({ messages, tools: [{ type: "function", function: {
      name: "analyze", parameters: { type: "object", properties: { score: { type: "number" } }, required: ["score"] },
    } }] })).rejects.toThrow(/LLM.*schema/i);
  });

  it.each([true, false])("validates actual resume content before profile conversion (valid=%s)", async (valid) => {
    const body = { skills: valid ? ["TypeScript"] : [123], experience: [], education: [], certifications: [], languages: [] };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, choices: [{
      ...result.choices[0], message: { role: "assistant", content: JSON.stringify(body) },
    }] }));
    if (valid) {
      const parsed = await parseResumeText("Synthetic resume text");
      expect(resumeToProfileData(parsed)).toEqual({ skills: "TypeScript" });
    } else {
      await expect(parseResumeText("Synthetic resume text")).rejects.toThrow("Failed to parse resume");
    }
  });

  // Includes the real parser's lazy cold start, not a five-second performance SLA.
  it("passes real PDF text through the shared AI boundary to profile conversion", async () => {
    const fixture = readFileSync(new URL("../testFixtures/resume.pdf", import.meta.url));
    const body = { skills: ["TypeScript", "React"], experience: [], education: [], certifications: [], languages: [] };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, choices: [{
      ...result.choices[0], message: { role: "assistant", content: JSON.stringify(body) },
    }] }));
    const parsed = await parseResumeFromFile(fixture, "application/pdf");
    expect(resumeToProfileData(parsed)).toEqual({ skills: "TypeScript, React" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(request.messages[1].content).toContain("Alex Example");
    expect(request.messages[1].content).toContain("Education: Computer Science");
  }, 30_000);

  it("does not contact AI when PDF extraction fails", async () => {
    await expect(parseResumeFromFile(Buffer.from("invalid PDF"), "application/pdf"))
      .rejects.toThrow("Failed to extract text from PDF");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["", " \n\t "])("does not send empty resume text to AI: %j", async (text) => {
    await expect(parseResumeText(text)).rejects.toThrow(/no readable text/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["direct", "file"])("enforces the existing resume text limit for %s input", async (source) => {
    const text = "x".repeat(500_001);
    const pending = source === "direct" ? parseResumeText(text)
      : parseResumeFromFile(Buffer.from(text), "text/plain");
    await expect(pending).rejects.toThrow(/resume text.*500000/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts the existing exact text limit without silently truncating it", async () => {
    const text = "x".repeat(499_996) + "LAST";
    const body = { skills: [], experience: [], education: [], certifications: [], languages: [] };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, choices: [{
      ...result.choices[0], message: { role: "assistant", content: JSON.stringify(body) },
    }] }));
    await expect(parseResumeText(text)).resolves.toEqual(body);
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(request.messages[1].content).toContain(text);
  });

  it("does not mistake generated PDF page labels for readable resume text", async () => {
    const fixture = readFileSync(new URL("../testFixtures/blank-resume.pdf", import.meta.url));
    await expect(parseResumeFromFile(fixture, "application/pdf")).rejects.toThrow(/no readable text/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["stop", "length"])("uses the actual completion boundary during job matching: %s", async (reason) => {
    const { calculateJobMatch } = await import("../aiMatching");
    const analysis = { matchScore: 88, skillsMatch: 90, experienceMatch: 80,
      locationMatch: 100, salaryMatch: 50, matchReasons: "Synthetic AI analysis" };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, choices: [{
      ...result.choices[0], finish_reason: reason,
      message: { role: "assistant", content: JSON.stringify(analysis) },
    }] }));
    const match = await calculateJobMatch(
      { skills: "TypeScript", desiredLocations: "Remote", experience: "Recorded experience" } as import("../../drizzle/schema").UserProfile,
      { id: 42, title: "Developer", company: "Synthetic Company", skills: "TypeScript",
        location: "Remote", isActive: 1 } as import("../../drizzle/schema").Job,
    );
    expect(match.analysisSource).toBe(reason === "stop" ? "llm" : "deterministic_fallback");
    if (reason === "stop") expect(match.matchReasons).toContain("Synthetic AI analysis");
    else expect(match.matchReasons).not.toContain("Synthetic AI analysis");
  });
});
