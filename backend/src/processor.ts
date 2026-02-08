import fs from "node:fs";
import csv from "csv-parser";
import {
  runCoordinatorAgent,
  runCriticAgent,
  runIngestionAgent,
  runKnowledgeAgent,
  runMemoryAgent,
  runStakeholderAgent,
  runTriageAgent
} from "./agent.js";
import { logError, logInfo } from "./logger.js";
import type {
  AgentRunSnapshot,
  Conflict,
  CoordinatorOutput,
  EmailRecord,
  IntelligenceUpdates,
  MemoryUpdate,
  PersonIndexEntry,
  ProcessingStatus,
  TopicIndexEntry
} from "./types.js";

const CSV_PATH = process.env.CSV_PATH ?? "/Users/asjadazeem/Downloads/emails.csv";
const RECORD_LIMIT = Number(process.env.CSV_RECORD_LIMIT ?? "100") || 100;
const BATCH_INTERVAL_SECONDS = Number(process.env.BATCH_INTERVAL_SECONDS ?? "30") || 30;
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? "10") || 10;

let status: ProcessingStatus = {
  status: "idle",
  startedAt: null,
  completedAt: null,
  lastBatchAt: null,
  queued: 0,
  processed: 0,
  results: 0,
  errors: 0,
  batches: 0
};

let queue: EmailRecord[] = [];
let knowledgeUpdates: MemoryUpdate[] = [];
let informationFlow: IntelligenceUpdates["informationFlow"] = [];
let conflicts: Conflict[] = [];
let decisionLog: string[] = [];
let recommendations: CoordinatorOutput | null = null;
let latestAgentSnapshot: AgentRunSnapshot | null = null;

const peopleIndex = new Map<string, PersonIndexEntry>();
const topicIndex = new Map<string, TopicIndexEntry>();

let batchTimer: NodeJS.Timeout | null = null;
let batchInProgress = false;

function resetState(): void {
  status = {
    status: "idle",
    startedAt: null,
    completedAt: null,
    lastBatchAt: null,
    queued: 0,
    processed: 0,
    results: 0,
    errors: 0,
    batches: 0
  };
  queue = [];
  knowledgeUpdates = [];
  informationFlow = [];
  conflicts = [];
  decisionLog = [];
  recommendations = null;
  latestAgentSnapshot = null;
  peopleIndex.clear();
  topicIndex.clear();
}

export function getStatus(): ProcessingStatus {
  return { ...status };
}

export function getPeople(): PersonIndexEntry[] {
  return Array.from(peopleIndex.values()).sort((a, b) => b.messageCount - a.messageCount);
}

export function getTopics(): TopicIndexEntry[] {
  return Array.from(topicIndex.values());
}

export function getConflicts(): Conflict[] {
  return conflicts;
}

export function getUpdates(): IntelligenceUpdates {
  return {
    knowledgeUpdates,
    decisions: decisionLog,
    recommendations,
    informationFlow
  };
}

export function getLatestAgentRuns(): AgentRunSnapshot | null {
  return latestAgentSnapshot;
}

export async function startProcessing(): Promise<ProcessingStatus> {
  if (status.status === "running") {
    return getStatus();
  }

  resetState();
  status.status = "running";
  status.startedAt = new Date().toISOString();

  logInfo("CSV stream start", { path: CSV_PATH, limit: RECORD_LIMIT });

  try {
    queue = await readFirstNRecords(CSV_PATH, RECORD_LIMIT);
    status.queued = queue.length;
    logInfo("CSV stream end", { queued: queue.length });

    scheduleBatches();
    await runBatch();

    return getStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    status.status = "error";
    status.message = message;
    logError("CSV processing failed", { error: message });
    stopBatches();
    return getStatus();
  }
}

function scheduleBatches(): void {
  stopBatches();
  batchTimer = setInterval(() => {
    if (!batchInProgress && status.status === "running") {
      void runBatch();
    }
  }, BATCH_INTERVAL_SECONDS * 1000);
}

function stopBatches(): void {
  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }
}

async function runBatch(): Promise<void> {
  if (batchInProgress) {
    return;
  }

  if (queue.length === 0) {
    status.status = "completed";
    status.completedAt = new Date().toISOString();
    stopBatches();
    return;
  }

  batchInProgress = true;
  const batchNumber = status.batches + 1;
  const batch = queue.splice(0, BATCH_SIZE);
  const batchTimestamp = new Date().toISOString();
  status.queued = queue.length;
  status.lastBatchAt = batchTimestamp;

  logInfo("Batch started", { batchNumber, size: batch.length, remaining: queue.length });

  try {
    const ingestionOutputs = [];
    for (const [index, record] of batch.entries()) {
      const input = [
        "Parse this raw email message.",
        `file: ${record.file}`,
        "message:",
        record.message
      ].join("\n");
      ingestionOutputs.push(await runIngestionAgent(input, batchNumber, index));
    }

    logInfo("[Orchestrator] IngestionAgent outputs", {
      batchNumber,
      count: ingestionOutputs.length
    });

    const triageInput = [
      "Decide which specialist agents should run for this batch.",
      JSON.stringify(ingestionOutputs, null, 2)
    ].join("\n\n");
    const triage = await runTriageAgent(triageInput, batchNumber);

    const selected = triage.runAgents;
    const selectedList = Object.entries(selected)
      .filter(([, shouldRun]) => shouldRun)
      .map(([name]) => name);
    const skippedList = Object.entries(selected)
      .filter(([, shouldRun]) => !shouldRun)
      .map(([name]) => name);

    logInfo(`[TriageAgent] Running agents: ${selectedList.join(", ") || "none"}`);
    logInfo(`[TriageAgent] Skipping agents: ${skippedList.join(", ") || "none"}`);
    logInfo("[TriageAgent] Reasoning", { batchNumber, reasoning: triage.reasoning });

    const knowledgeInput = [
      "Use the cleaned messages below to extract organizational knowledge.",
      JSON.stringify(ingestionOutputs, null, 2)
    ].join("\n\n");

    const stakeholderInput = [
      "Build the stakeholder map from the cleaned messages and extracted knowledge (if any).",
      JSON.stringify({ ingestionOutputs }, null, 2)
    ].join("\n\n");

    const memoryContext = {
      existingTopics: Array.from(topicIndex.values()),
      existingDecisions: decisionLog.slice(0, 10)
    };
    const memoryInput = [
      "Compare new knowledge to existing memory and classify updates.",
      JSON.stringify({ memoryContext }, null, 2)
    ].join("\n\n");

    const agentRuns: Array<Promise<unknown>> = [];
    const resultMap: {
      knowledge?: { topics: string[]; decisions: string[]; facts: string[] };
      stakeholder?: { stakeholders: { email: string; importance: string; reason: string }[] };
      memory?: { updates: MemoryUpdate[] };
    } = {};

    if (selected.knowledge) {
      agentRuns.push(
        runKnowledgeAgent(knowledgeInput, batchNumber).then((output) => {
          resultMap.knowledge = output;
        })
      );
    }

    if (selected.stakeholder) {
      agentRuns.push(
        runStakeholderAgent(stakeholderInput, batchNumber).then((output) => {
          resultMap.stakeholder = output;
        })
      );
    }

    if (selected.memory) {
      agentRuns.push(
        runMemoryAgent(memoryInput, batchNumber).then((output) => {
          resultMap.memory = output;
        })
      );
    }

    if (agentRuns.length > 0) {
      await Promise.all(agentRuns);
      logInfo("[Orchestrator] Parallel agents completed", { batchNumber, agents: selectedList });
    }

    const knowledge = resultMap.knowledge ?? { topics: [], decisions: [], facts: [] };
    const stakeholder = resultMap.stakeholder ?? { stakeholders: [] };
    const memory = resultMap.memory ?? { updates: [] };

    let critic = { conflicts: [] as { topic: string; description: string; severity: string }[] };
    if (selected.critic) {
      const criticInput = [
        "Review the outputs for contradictions, ambiguity, or overload.",
        JSON.stringify({ knowledge, stakeholder, memory }, null, 2)
      ].join("\n\n");
      critic = await runCriticAgent(criticInput, batchNumber);
    } else {
      logInfo("[Orchestrator] CriticAgent skipped", { batchNumber });
    }

    const coordinatorInput = [
      "Create the executive brief and notification list.",
      JSON.stringify({ knowledge, stakeholder, memory, critic, triage }, null, 2)
    ].join("\n\n");
    const coordinator = await runCoordinatorAgent(coordinatorInput, batchNumber);

    applyOutputs({
      batchNumber,
      ingestionOutputs,
      knowledge,
      stakeholder,
      memory,
      critic,
      coordinator
    });

    latestAgentSnapshot = buildAgentSnapshot({
      batchNumber,
      timestamp: batchTimestamp,
      triageReasoning: triage.reasoning,
      selectedAgents: selectedList,
      skippedAgents: skippedList,
      knowledge,
      stakeholder,
      memory,
      critic,
      coordinator
    });

    status.processed += batch.length;
    status.results = knowledgeUpdates.length;
    status.batches = batchNumber;

    logInfo("Batch finished", {
      batchNumber,
      processed: status.processed,
      results: status.results,
      agents: [
        "IngestionAgent",
        "TriageAgent",
        ...selectedList.map((agent) => `${agent}Agent`),
        selected.critic ? "CriticAgent" : "CriticAgent (skipped)",
        "CoordinatorAgent"
      ]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    status.errors += 1;
    logError("ChiefOfStaff batch failed", { batchNumber, error: message });
  } finally {
    batchInProgress = false;
  }

  if (queue.length === 0) {
    status.status = "completed";
    status.completedAt = new Date().toISOString();
    stopBatches();
  }
}

function buildAgentSnapshot({
  batchNumber,
  timestamp,
  triageReasoning,
  selectedAgents,
  skippedAgents,
  knowledge,
  stakeholder,
  memory,
  critic,
  coordinator
}: {
  batchNumber: number;
  timestamp: string;
  triageReasoning: string;
  selectedAgents: string[];
  skippedAgents: string[];
  knowledge: { topics: string[]; decisions: string[]; facts: string[] };
  stakeholder: { stakeholders: { email: string; importance: string; reason: string }[] };
  memory: { updates: MemoryUpdate[] };
  critic: { conflicts: { topic: string; description: string; severity: string }[] };
  coordinator: CoordinatorOutput;
}): AgentRunSnapshot {
  const agentTimestamp = timestamp;
  const timeline = [
    {
      timestamp: agentTimestamp,
      label: "Triage",
      detail: `Selected agents: ${selectedAgents.join(", ") || "none"}`
    }
  ];

  if (knowledge.topics.length > 0 || knowledge.decisions.length > 0) {
    timeline.push({
      timestamp: agentTimestamp,
      label: "Knowledge",
      detail: `Detected ${knowledge.topics.length} topics and ${knowledge.decisions.length} decisions`
    });
  }

  if (memory.updates.length > 0) {
    timeline.push({
      timestamp: agentTimestamp,
      label: "Memory",
      detail: `Classified ${memory.updates.length} knowledge updates`
    });
  }

  if (critic.conflicts.length > 0) {
    timeline.push({
      timestamp: agentTimestamp,
      label: "Critic",
      detail: `Flagged ${critic.conflicts.length} conflicts`
    });
  }

  timeline.push({
    timestamp: agentTimestamp,
    label: "Coordinator",
    detail: `Prepared executive brief and ${coordinator.priorityItems.length} priority items`
  });

  const agents = [
    {
      name: "Ingestion",
      status: "ran",
      timestamp: agentTimestamp,
      output: { sample: "Parsed email metadata", count: batchNumber },
      explanation: "Parsed raw emails into sender, recipients, timestamp, and clean body."
    },
    {
      name: "Triage",
      status: "ran",
      reason: triageReasoning,
      timestamp: agentTimestamp,
      output: {
        runAgents: {
          knowledge: selectedAgents.includes("knowledge"),
          stakeholder: selectedAgents.includes("stakeholder"),
          memory: selectedAgents.includes("memory"),
          critic: selectedAgents.includes("critic")
        },
        reasoning: triageReasoning
      },
      explanation: "Decided which specialist agents were needed to reduce noise."
    },
    {
      name: "Knowledge",
      status: selectedAgents.includes("knowledge") ? "ran" : "skipped",
      reason: selectedAgents.includes("knowledge") ? "Selected by triage" : "Skipped by triage",
      timestamp: agentTimestamp,
      output: knowledge,
      explanation: "Extracted topics, decisions, and factual statements."
    },
    {
      name: "Stakeholder",
      status: selectedAgents.includes("stakeholder") ? "ran" : "skipped",
      reason: selectedAgents.includes("stakeholder") ? "Selected by triage" : "Skipped by triage",
      timestamp: agentTimestamp,
      output: stakeholder,
      explanation: "Inferred stakeholder importance and dependencies."
    },
    {
      name: "Memory",
      status: selectedAgents.includes("memory") ? "ran" : "skipped",
      reason: selectedAgents.includes("memory") ? "Selected by triage" : "Skipped by triage",
      timestamp: agentTimestamp,
      output: memory,
      explanation: "Classified new, updated, and conflicting knowledge over time."
    },
    {
      name: "Critic",
      status: selectedAgents.includes("critic") ? (critic.conflicts.length > 0 ? "conflict" : "ran") : "skipped",
      reason: selectedAgents.includes("critic") ? "Selected by triage" : "Skipped by triage",
      timestamp: agentTimestamp,
      output: critic,
      explanation: "Audited outputs for contradictions and overload."
    },
    {
      name: "Coordinator",
      status: "ran",
      timestamp: agentTimestamp,
      output: coordinator,
      explanation: "Synthesized outputs into an executive brief and priority actions."
    }
  ];

  return {
    batchNumber,
    agents,
    triageReasoning,
    selectedAgents,
    skippedAgents,
    timeline
  };
}

function applyOutputs({
  batchNumber,
  ingestionOutputs,
  knowledge,
  stakeholder,
  memory,
  critic,
  coordinator
}: {
  batchNumber: number;
  ingestionOutputs: { from: string; to: string[]; timestamp: string; body: string }[];
  knowledge: { topics: string[]; decisions: string[]; facts: string[] };
  stakeholder: { stakeholders: { email: string; importance: string; reason: string }[] };
  memory: { updates: MemoryUpdate[] };
  critic: { conflicts: { topic: string; description: string; severity: string }[] };
  coordinator: CoordinatorOutput;
}): void {
  for (const entry of ingestionOutputs) {
    const participants = [entry.from, ...entry.to];
    for (const email of participants) {
      if (!email) continue;
      const existing = peopleIndex.get(email);
      if (!existing) {
        peopleIndex.set(email, {
          email,
          name: null,
          inferredRole: null,
          messageCount: 1,
          topics: []
        });
      } else {
        existing.messageCount += 1;
      }
    }
  }

  for (const stakeholderEntry of stakeholder.stakeholders) {
    const existing = peopleIndex.get(stakeholderEntry.email);
    if (!existing) {
      peopleIndex.set(stakeholderEntry.email, {
        email: stakeholderEntry.email,
        name: null,
        inferredRole: stakeholderEntry.importance,
        messageCount: 0,
        topics: []
      });
    } else {
      existing.inferredRole = stakeholderEntry.importance;
    }
  }

  for (const topic of knowledge.topics) {
    if (!topicIndex.has(topic)) {
      topicIndex.set(topic, {
        topic,
        latestSummary: "Awaiting memory classification.",
        confidence: 0.5,
        isNew: true,
        isConflicting: false,
        lastUpdatedAt: new Date().toISOString()
      });
    }
  }

  for (const update of memory.updates) {
    const isConflicting = update.changeType === "conflict";
    const isNew = update.changeType === "new";
    const entry: TopicIndexEntry = {
      topic: update.topic,
      latestSummary: update.summary,
      confidence: isConflicting ? 0.4 : isNew ? 0.75 : 0.6,
      isNew,
      isConflicting,
      lastUpdatedAt: new Date().toISOString()
    };
    topicIndex.set(update.topic, entry);
    knowledgeUpdates.unshift(update);
    logInfo("[Orchestrator] Knowledge update applied", {
      batchNumber,
      topic: update.topic,
      changeType: update.changeType
    });
  }

  for (const conflict of critic.conflicts) {
    conflicts.unshift({ topic: conflict.topic, description: conflict.description });
    const existingTopic = topicIndex.get(conflict.topic);
    if (existingTopic) {
      existingTopic.isConflicting = true;
    }
  }

  if (critic.conflicts.length > 0) {
    logInfo(`[Orchestrator] CriticAgent detected ${critic.conflicts.length} conflicts`, { batchNumber });
  }

  decisionLog.unshift(...knowledge.decisions);

  informationFlow.unshift(
    ...ingestionOutputs.flatMap((entry) =>
      entry.to.map((recipient) => ({
        from: entry.from,
        to: recipient,
        topic: knowledge.topics[0] ?? "general",
        intent: "inform" as const
      }))
    )
  );

  recommendations = coordinator;

  logInfo("[Orchestrator] CoordinatorAgent brief", {
    batchNumber,
    notify: coordinator.notify.length,
    priorityItems: coordinator.priorityItems.length
  });
}

async function readFirstNRecords(path: string, limit: number): Promise<EmailRecord[]> {
  return new Promise((resolve, reject) => {
    const results: EmailRecord[] = [];
    let resolved = false;
    const stream = fs.createReadStream(path).on("error", reject);
    const parser = csv();

    const cleanup = (): void => {
      stream.removeAllListeners();
      parser.removeAllListeners();
    };

    parser.on("data", (data) => {
      if (results.length < limit) {
        results.push({
          file: String(data.file ?? ""),
          message: String(data.message ?? "")
        });
      }

      if (results.length >= limit) {
        stream.destroy();
      }
    });

    const finalize = (): void => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(results);
    };

    parser.on("end", finalize);
    stream.on("close", finalize);

    parser.on("error", (error) => {
      cleanup();
      reject(error);
    });

    stream.pipe(parser);
  });
}
