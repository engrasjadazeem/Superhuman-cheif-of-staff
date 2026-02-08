export type EmailRecord = {
  file: string;
  message: string;
};

export type ProcessingStatus = {
  status: "idle" | "running" | "completed" | "error";
  startedAt: string | null;
  completedAt: string | null;
  lastBatchAt: string | null;
  queued: number;
  processed: number;
  results: number;
  errors: number;
  batches: number;
  message?: string;
};

export type PersonIndexEntry = {
  email: string;
  name: string | null;
  inferredRole: string | null;
  messageCount: number;
  topics: string[];
};

export type TopicIndexEntry = {
  topic: string;
  latestSummary: string;
  confidence: number;
  isNew: boolean;
  isConflicting: boolean;
  lastUpdatedAt: string;
};

export type Conflict = {
  topic: string;
  description: string;
};

export type IntelligenceUpdates = {
  knowledgeUpdates: MemoryUpdate[];
  decisions: string[];
  recommendations: CoordinatorOutput | null;
  informationFlow: InformationFlow[];
};

export type InformationFlow = {
  from: string;
  to: string;
  topic: string;
  intent: "inform" | "propose" | "debate";
};

export type IngestionOutput = {
  from: string;
  to: string[];
  timestamp: string;
  body: string;
};

export type TriageOutput = {
  runAgents: {
    knowledge: boolean;
    stakeholder: boolean;
    memory: boolean;
    critic: boolean;
  };
  reasoning: string;
};

export type KnowledgeOutput = {
  topics: string[];
  decisions: string[];
  facts: string[];
};

export type StakeholderOutput = {
  stakeholders: {
    email: string;
    importance: "low" | "medium" | "high";
    reason: string;
  }[];
};

export type MemoryUpdate = {
  topic: string;
  changeType: "new" | "update" | "conflict";
  summary: string;
};

export type MemoryOutput = {
  updates: MemoryUpdate[];
};

export type CriticOutput = {
  conflicts: {
    topic: string;
    description: string;
    severity: "low" | "medium" | "high";
  }[];
};

export type CoordinatorOutput = {
  executiveBrief: string;
  notify: string[];
  priorityItems: string[];
};

export type AgentRunInfo = {
  name: "Ingestion" | "Triage" | "Knowledge" | "Stakeholder" | "Memory" | "Critic" | "Coordinator";
  status: "ran" | "skipped" | "conflict";
  reason?: string;
  timestamp: string;
  output?: unknown;
  explanation?: string;
};

export type ReasoningTimelineItem = {
  timestamp: string;
  label: string;
  detail: string;
};

export type AgentRunSnapshot = {
  batchNumber: number;
  agents: AgentRunInfo[];
  triageReasoning: string;
  selectedAgents: string[];
  skippedAgents: string[];
  timeline: ReasoningTimelineItem[];
};
