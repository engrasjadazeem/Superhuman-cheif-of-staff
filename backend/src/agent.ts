import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { logInfo } from "./logger.js";
import type {
  CriticOutput,
  CoordinatorOutput,
  IngestionOutput,
  KnowledgeOutput,
  MemoryOutput,
  StakeholderOutput,
  TriageOutput
} from "./types.js";

const IngestionSchema = z.object({
  from: z.string(),
  to: z.array(z.string()),
  timestamp: z.string(),
  body: z.string()
});

const TriageSchema = z.object({
  runAgents: z.object({
    knowledge: z.boolean(),
    stakeholder: z.boolean(),
    memory: z.boolean(),
    critic: z.boolean()
  }),
  reasoning: z.string()
});

const KnowledgeSchema = z.object({
  topics: z.array(z.string()),
  decisions: z.array(z.string()),
  facts: z.array(z.string())
});

const StakeholderSchema = z.object({
  stakeholders: z.array(
    z.object({
      email: z.string(),
      importance: z.enum(["low", "medium", "high"]),
      reason: z.string()
    })
  )
});

const MemorySchema = z.object({
  updates: z.array(
    z.object({
      topic: z.string(),
      changeType: z.enum(["new", "update", "conflict"]),
      summary: z.string()
    })
  )
});

const CriticSchema = z.object({
  conflicts: z.array(
    z.object({
      topic: z.string(),
      description: z.string(),
      severity: z.enum(["low", "medium", "high"])
    })
  )
});

const CoordinatorSchema = z.object({
  executiveBrief: z.string(),
  notify: z.array(z.string()),
  priorityItems: z.array(z.string())
});

const ingestionAgent = new Agent({
  name: "IngestionAgent",
  instructions: [
    "You parse raw email messages into structured fields.",
    "Extract sender, recipients, timestamp, and cleaned message body.",
    "Return ONLY JSON matching the schema:",
    "{",
    "  \"from\": string,",
    "  \"to\": string[],",
    "  \"timestamp\": string,",
    "  \"body\": string",
    "}",
    "No extra text."
  ].join("\n"),
  outputType: IngestionSchema
});

const triageAgent = new Agent({
  name: "TriageAgent",
  instructions: [
    "You decide which specialist agents should run for this batch.",
    "Prioritize signal, avoid overload.",
    "Return ONLY JSON matching the schema:",
    "{",
    "  \"runAgents\": {",
    "    \"knowledge\": boolean,",
    "    \"stakeholder\": boolean,",
    "    \"memory\": boolean,",
    "    \"critic\": boolean",
    "  },",
    "  \"reasoning\": string",
    "}",
    "No extra text."
  ].join("\n"),
  outputType: TriageSchema
});

const knowledgeAgent = new Agent({
  name: "KnowledgeAgent",
  instructions: [
    "Convert cleaned messages into organizational knowledge.",
    "Identify topics, decisions, proposals, and factual statements.",
    "Return ONLY JSON matching the schema:",
    "{",
    "  \"topics\": string[],",
    "  \"decisions\": string[],",
    "  \"facts\": string[]",
    "}",
    "No extra text."
  ].join("\n"),
  outputType: KnowledgeSchema
});

const stakeholderAgent = new Agent({
  name: "StakeholderAgent",
  instructions: [
    "Build and update the stakeholder map.",
    "Infer who is central, impacted, and communication dependencies.",
    "Return ONLY JSON matching the schema:",
    "{",
    "  \"stakeholders\": [",
    "    { \"email\": string, \"importance\": \"low\" | \"medium\" | \"high\", \"reason\": string }",
    "  ]",
    "}",
    "No extra text."
  ].join("\n"),
  outputType: StakeholderSchema
});

const memoryAgent = new Agent({
  name: "MemoryAgent",
  instructions: [
    "Maintain organizational memory over time.",
    "Decide what is new, what updates existing knowledge, and what contradicts it.",
    "Return ONLY JSON matching the schema:",
    "{",
    "  \"updates\": [",
    "    { \"topic\": string, \"changeType\": \"new\" | \"update\" | \"conflict\", \"summary\": string }",
    "  ]",
    "}",
    "No extra text."
  ].join("\n"),
  outputType: MemorySchema
});

const criticAgent = new Agent({
  name: "CriticAgent",
  instructions: [
    "Review outputs from other agents.",
    "Detect contradictions, ambiguity, or overload.",
    "Return ONLY JSON matching the schema:",
    "{",
    "  \"conflicts\": [",
    "    { \"topic\": string, \"description\": string, \"severity\": \"low\" | \"medium\" | \"high\" }",
    "  ]",
    "}",
    "No extra text."
  ].join("\n"),
  outputType: CriticSchema
});

const coordinatorAgent = new Agent({
  name: "CoordinatorAgent",
  instructions: [
    "You are the Chief of Staff who coordinates outputs.",
    "Decide what to amplify, what to suppress, and who should be informed.",
    "Produce human-facing intelligence.",
    "Return ONLY JSON matching the schema:",
    "{",
    "  \"executiveBrief\": string,",
    "  \"notify\": string[],",
    "  \"priorityItems\": string[]",
    "}",
    "No extra text."
  ].join("\n"),
  outputType: CoordinatorSchema
});

function normalizeJsonString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return trimmed;
}

function parseOutput<T>(schema: z.ZodType<T>, output: unknown): T {
  if (typeof output === "string") {
    const jsonText = normalizeJsonString(output);
    return schema.parse(JSON.parse(jsonText));
  }
  return schema.parse(output);
}

export async function runIngestionAgent(input: string, batchNumber: number, index: number): Promise<IngestionOutput> {
  logInfo("[Orchestrator] IngestionAgent start", { batchNumber, index });
  const result = await run(ingestionAgent, input);
  const output = parseOutput(IngestionSchema, result.finalOutput);
  logInfo("[Orchestrator] IngestionAgent end", { batchNumber, index });
  return output;
}

export async function runTriageAgent(input: string, batchNumber: number): Promise<TriageOutput> {
  logInfo("[Orchestrator] TriageAgent start", { batchNumber });
  const result = await run(triageAgent, input);
  const output = parseOutput(TriageSchema, result.finalOutput);
  logInfo("[Orchestrator] TriageAgent end", { batchNumber });
  return output;
}

export async function runKnowledgeAgent(input: string, batchNumber: number): Promise<KnowledgeOutput> {
  logInfo("[Orchestrator] KnowledgeAgent start", { batchNumber });
  const result = await run(knowledgeAgent, input);
  const output = parseOutput(KnowledgeSchema, result.finalOutput);
  logInfo("[Orchestrator] KnowledgeAgent end", { batchNumber, topics: output.topics.length });
  return output;
}

export async function runStakeholderAgent(input: string, batchNumber: number): Promise<StakeholderOutput> {
  logInfo("[Orchestrator] StakeholderAgent start", { batchNumber });
  const result = await run(stakeholderAgent, input);
  const output = parseOutput(StakeholderSchema, result.finalOutput);
  logInfo("[Orchestrator] StakeholderAgent end", { batchNumber, stakeholders: output.stakeholders.length });
  return output;
}

export async function runMemoryAgent(input: string, batchNumber: number): Promise<MemoryOutput> {
  logInfo("[Orchestrator] MemoryAgent start", { batchNumber });
  const result = await run(memoryAgent, input);
  const output = parseOutput(MemorySchema, result.finalOutput);
  logInfo("[Orchestrator] MemoryAgent end", { batchNumber, updates: output.updates.length });
  return output;
}

export async function runCriticAgent(input: string, batchNumber: number): Promise<CriticOutput> {
  logInfo("[Orchestrator] CriticAgent start", { batchNumber });
  const result = await run(criticAgent, input);
  const output = parseOutput(CriticSchema, result.finalOutput);
  logInfo("[Orchestrator] CriticAgent end", { batchNumber, conflicts: output.conflicts.length });
  return output;
}

export async function runCoordinatorAgent(input: string, batchNumber: number): Promise<CoordinatorOutput> {
  logInfo("[Orchestrator] CoordinatorAgent start", { batchNumber });
  const result = await run(coordinatorAgent, input);
  const output = parseOutput(CoordinatorSchema, result.finalOutput);
  logInfo("[Orchestrator] CoordinatorAgent end", { batchNumber, notify: output.notify.length });
  return output;
}
