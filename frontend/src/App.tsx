import { useEffect, useMemo, useRef, useState } from "react";

type Status = {
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

type Person = {
  email: string;
  name: string | null;
  inferredRole: string | null;
  messageCount: number;
  topics: string[];
};

type Topic = {
  topic: string;
  latestSummary: string;
  confidence: number;
  isNew: boolean;
  isConflicting: boolean;
  lastUpdatedAt: string;
};

type KnowledgeUpdate = {
  topic: string;
  summary: string;
  isNew: true;
  confidence: number;
};

type Conflict = {
  topic: string;
  description: string;
};

type Updates = {
  knowledgeUpdates: KnowledgeUpdate[];
  decisions: string[];
  recommendations: {
    whoShouldKnow: string[];
    why: string;
  } | null;
  informationFlow: {
    from: string;
    to: string;
    topic: string;
    intent: "inform" | "propose" | "debate";
  }[];
};

type AgentRunInfo = {
  name: "Ingestion" | "Triage" | "Knowledge" | "Stakeholder" | "Memory" | "Critic" | "Coordinator";
  status: "ran" | "skipped" | "conflict";
  reason?: string;
  timestamp: string;
  output?: unknown;
  explanation?: string;
};

type AgentRunSnapshot = {
  batchNumber: number;
  agents: AgentRunInfo[];
  triageReasoning: string;
  selectedAgents: string[];
  skippedAgents: string[];
  timeline: {
    timestamp: string;
    label: string;
    detail: string;
  }[];
} | null;

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3001";

function formatTimestamp(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatShortTimestamp(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function statusLabel(status?: Status | null): string {
  if (!status) return "Idle";
  if (status.status === "running") return "Processing";
  if (status.status === "completed") return "Updated";
  if (status.status === "error") return "Error";
  return "Idle";
}

function topicKey(topic: string): string {
  const normalized = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = normalized.split(" ");
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return parts[0] ?? normalized;
}

type MetricDelta = {
  current: number;
  previous: number;
};

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [updates, setUpdates] = useState<Updates | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRunSnapshot>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRunInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const previousMetrics = useRef({
    people: 0,
    topics: 0,
    decisions: 0,
    conflicts: 0
  });

  const isRunning = status?.status === "running";

  const fetchStatus = async () => {
    const response = await fetch(`${API_BASE}/api/status`);
    const data = (await response.json()) as Status;
    setStatus(data);
  };

  const fetchPeople = async () => {
    const response = await fetch(`${API_BASE}/api/intelligence/people`);
    const data = (await response.json()) as Person[];
    setPeople(data);
  };

  const fetchTopics = async () => {
    const response = await fetch(`${API_BASE}/api/intelligence/topics`);
    const data = (await response.json()) as Topic[];
    setTopics(data);
  };

  const fetchUpdates = async () => {
    const response = await fetch(`${API_BASE}/api/intelligence/updates`);
    const data = (await response.json()) as Updates;
    setUpdates(data);
  };

  const fetchConflicts = async () => {
    const response = await fetch(`${API_BASE}/api/intelligence/conflicts`);
    const data = (await response.json()) as Conflict[];
    setConflicts(data);
  };

  const fetchAgentRuns = async () => {
    const response = await fetch(`${API_BASE}/api/agent-runs/latest`);
    const data = (await response.json()) as AgentRunSnapshot;
    setAgentRuns(data);
  };

  const refreshAll = async () => {
    await Promise.all([fetchStatus(), fetchPeople(), fetchTopics(), fetchUpdates(), fetchConflicts(), fetchAgentRuns()]);
  };

  const startProcessing = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/start`, { method: "POST" });
      const data = (await response.json()) as Status;
      setStatus(data);
      await refreshAll();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      void refreshAll();
    }, 2500);
    return () => clearInterval(interval);
  }, [isRunning]);

  const metrics = useMemo(() => {
    const decisionCount = updates?.decisions?.length ?? 0;
    const conflictsCount = conflicts.length;
    const next = {
      people: people.length,
      topics: topics.length,
      decisions: decisionCount,
      conflicts: conflictsCount
    };
    const prev = previousMetrics.current;

    const result: Record<string, MetricDelta> = {
      people: { current: next.people, previous: prev.people },
      topics: { current: next.topics, previous: prev.topics },
      decisions: { current: next.decisions, previous: prev.decisions },
      conflicts: { current: next.conflicts, previous: prev.conflicts }
    };

    previousMetrics.current = next;
    return result as {
      people: MetricDelta;
      topics: MetricDelta;
      decisions: MetricDelta;
      conflicts: MetricDelta;
    };
  }, [people.length, topics.length, updates?.decisions?.length, conflicts.length]);

  const topicClusters = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        topics: Topic[];
        summary: string;
        confidence: number;
        lastUpdatedAt: string;
      }
    >();

    for (const topic of topics) {
      const key = topicKey(topic.topic);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          topics: [topic],
          summary: topic.latestSummary,
          confidence: topic.confidence,
          lastUpdatedAt: topic.lastUpdatedAt
        });
      } else {
        existing.topics.push(topic);
        if (topic.confidence >= existing.confidence) {
          existing.summary = topic.latestSummary;
          existing.confidence = topic.confidence;
          existing.lastUpdatedAt = topic.lastUpdatedAt;
        }
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.topics.length - a.topics.length)
      .slice(0, 6);
  }, [topics]);

  const knowledgeTimeline = useMemo(() => {
    const topicMap = new Map(topics.map((topic) => [topic.topic, topic.lastUpdatedAt]));
    const knowledgeItems = (updates?.knowledgeUpdates ?? []).map((update) => ({
      type: "Knowledge Update",
      topic: update.topic,
      summary: update.summary,
      timestamp: topicMap.get(update.topic) ?? new Date().toISOString()
    }));

    const decisionItems = (updates?.decisions ?? []).map((decision) => ({
      type: "Decision",
      topic: "Decision",
      summary: decision,
      timestamp: new Date().toISOString()
    }));

    const conflictItems = conflicts.map((conflict) => ({
      type: "Conflict",
      topic: conflict.topic,
      summary: conflict.description,
      timestamp: topicMap.get(conflict.topic) ?? new Date().toISOString()
    }));

    return [...knowledgeItems, ...decisionItems, ...conflictItems].slice(0, 12);
  }, [updates, conflicts, topics]);

  const flowGraph = useMemo(() => {
    const flows = updates?.informationFlow ?? [];
    if (flows.length === 0 || people.length === 0) {
      return { nodes: [], links: [] };
    }

    // Count total interactions per person (sent + received)
    const interactionCount = new Map<string, number>();
    for (const flow of flows) {
      interactionCount.set(flow.from, (interactionCount.get(flow.from) ?? 0) + 1);
      interactionCount.set(flow.to, (interactionCount.get(flow.to) ?? 0) + 1);
    }

    // Top N people by interaction count
    const topEmails = Array.from(interactionCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([email]) => email);

    const topSet = new Set(topEmails);

    const nodes = topEmails.map((email, index) => {
      const person = people.find((item) => item.email === email);
      return {
        email,
        label: person?.name ?? email,
        messageCount: person?.messageCount ?? 0,
        index
      };
    });

    // Only keep links between top people, merge directions
    const linkMap = new Map<string, number>();
    for (const flow of flows) {
      if (!topSet.has(flow.from) || !topSet.has(flow.to)) continue;
      const pair = [flow.from, flow.to].sort().join("||");
      linkMap.set(pair, (linkMap.get(pair) ?? 0) + 1);
    }

    const links = Array.from(linkMap.entries())
      .map(([key, count]) => {
        const [from, to] = key.split("||");
        return { from, to, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    return { nodes, links };
  }, [updates?.informationFlow, people]);

  const messageCounts = useMemo(() => {
    const sorted = [...people].sort((a, b) => b.messageCount - a.messageCount).slice(0, 8);
    const max = Math.max(...sorted.map((person) => person.messageCount), 1);
    return { data: sorted, max };
  }, [people]);

  const updatesOverTime = useMemo(() => {
    const points = (updates?.knowledgeUpdates ?? []).slice(0, 10).map((_, index) => ({
      x: index,
      y: index + 1
    }));
    return points.length ? points : [{ x: 0, y: 0 }];
  }, [updates?.knowledgeUpdates]);

  const summarySignals = useMemo(() => {
    const stable = topics.filter((topic) => !topic.isConflicting && topic.confidence >= 0.7).length;
    const updated = topics.filter((topic) => topic.isNew || topic.confidence < 0.7).length;
    return { stable, updated };
  }, [topics]);

  const sortedTopics = useMemo(() => {
    const score = (topic: Topic) => {
      if (topic.isConflicting) return 3;
      if (topic.isNew || topic.confidence < 0.6) return 2;
      return 1;
    };
    return [...topics].sort((a, b) => {
      const byPriority = score(b) - score(a);
      if (byPriority !== 0) return byPriority;
      return new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime();
    });
  }, [topics]);

  const spotlightPeople = useMemo(() => {
    return [...people].sort((a, b) => b.messageCount - a.messageCount).slice(0, 3);
  }, [people]);

  const overloadSignals = useMemo(() => {
    const sorted = [...people].sort((a, b) => b.messageCount - a.messageCount);
    const high = sorted.slice(0, 2);
    const isolated = sorted.filter((person) => person.messageCount <= 1).slice(0, 2);
    return { high, isolated };
  }, [people]);

  const stakeholderMap = useMemo(() => {
    const nodes = people.slice(0, 8);
    const flows = updates?.informationFlow ?? [];

    const topicSet = new Set(topics.map((topic) => topic.topic));
    const derivedTopics = Array.from(new Set(flows.map((flow) => flow.topic))).filter(Boolean);
    const mergedTopics: Topic[] = [
      ...topics,
      ...derivedTopics
        .filter((topic) => !topicSet.has(topic))
        .map((topic) => ({
          topic,
          latestSummary: "Derived from communication flow",
          confidence: 0.4,
          isNew: true,
          isConflicting: false,
          lastUpdatedAt: new Date().toISOString()
        }))
    ];
    const topicNodes = mergedTopics.slice(0, 8);
    const topicNodeSet = new Set(topicNodes.map((topic) => topic.topic));

    const nodeSet = new Set(nodes.map((node) => node.email));
    const linkMap = new Map<string, { from: string; to: string }>();
    for (const flow of flows) {
      if (!nodeSet.has(flow.from)) continue;
      if (!topicNodeSet.has(flow.topic)) continue;
      const key = `${flow.from}-${flow.topic}`;
      if (!linkMap.has(key)) {
        linkMap.set(key, { from: flow.from, to: flow.topic });
      }
    }

    return { nodes, topicNodes, links: Array.from(linkMap.values()) };
  }, [people, topics, updates?.informationFlow]);

  const agentGraph = useMemo(() => {
    const order = ["Ingestion", "Triage", "Knowledge", "Stakeholder", "Memory", "Critic", "Coordinator"];
    const runMap = new Map(agentRuns?.agents.map((agent) => [agent.name, agent]) ?? []);
    return order.map((name) => runMap.get(name as AgentRunInfo["name"]) ?? null).filter(Boolean) as AgentRunInfo[];
  }, [agentRuns]);

  return (
    <div className="app">
      <header className="top-bar">
        <div>
          <h1>Superhuman AI Chief of Staff</h1>
          <p>The company brain for communication, alignment, and deconfliction.</p>
        </div>
        <div className="top-actions">
          <button className="voice" type="button">
            <span className="dot" />
            Voice Brief
          </button>
          <div className={`status-pill ${status?.status ?? "idle"}`}>{statusLabel(status)}</div>
          <button onClick={startProcessing} disabled={loading || isRunning}>
            {loading ? "Starting..." : "Start Processing"}
          </button>
        </div>
      </header>

      <section className="kpi-grid">
        <KpiCard
          label="People Involved"
          value={metrics.people.current}
          delta={metrics.people.current - metrics.people.previous}
        />
        <KpiCard
          label="Active Topics"
          value={metrics.topics.current}
          delta={metrics.topics.current - metrics.topics.previous}
        />
        <KpiCard
          label="Decisions Identified"
          value={metrics.decisions.current}
          delta={metrics.decisions.current - metrics.decisions.previous}
        />
        <KpiCard
          label="Conflicts"
          value={metrics.conflicts.current}
          delta={metrics.conflicts.current - metrics.conflicts.previous}
          tone="danger"
        />
      </section>

      <section className="status-banner">
        <div>
          <span>Processed</span>
          <strong>{status?.processed ?? 0}</strong>
        </div>
        <div>
          <span>Queued</span>
          <strong>{status?.queued ?? 0}</strong>
        </div>
        <div>
          <span>Batches</span>
          <strong>{status?.batches ?? 0}</strong>
        </div>
        <div>
          <span>Last Batch</span>
          <strong>{formatTimestamp(status?.lastBatchAt ?? null)}</strong>
        </div>
        <div>
          <span>Started</span>
          <strong>{formatTimestamp(status?.startedAt ?? null)}</strong>
        </div>
        <div>
          <span>Errors</span>
          <strong>{status?.errors ?? 0}</strong>
        </div>
      </section>

      {status?.message && <p className="error">{status.message}</p>}

      <main className="dashboard">
        <section className="panel briefing">
          <div className="panel-header">
            <h2>Executive Briefing</h2>
            <span className="subtle">Condensed, high-signal view</span>
          </div>
          <div className="briefing-grid">
            <div className="brief-card">
              <span className="label">Knowledge State</span>
              <p>
                <strong>{summarySignals.stable}</strong> stable topics, <strong>{summarySignals.updated}</strong> recently
                updated.
              </p>
            </div>
            <div className="brief-card">
              <span className="label">People Spotlight</span>
              {spotlightPeople.length === 0 ? (
                <p className="empty">No activity yet.</p>
              ) : (
                <ul>
                  {spotlightPeople.map((person) => (
                    <li key={person.email}>
                      <strong>{person.name ?? person.email}</strong>
                      <span>{person.messageCount} interactions</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="brief-card">
              <span className="label">What Changed</span>
              {updates?.knowledgeUpdates?.length ? (
                <ul>
                  {updates.knowledgeUpdates.slice(0, 3).map((update, index) => (
                    <li key={`${update.topic}-${index}`}>
                      <strong>{update.topic}</strong>
                      <span>{update.summary}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">No updates yet.</p>
              )}
            </div>
          </div>
        </section>

        <section className="panel agent-flow">
          <div className="panel-header">
            <h2>Agent Reasoning Flow</h2>
            <span className="subtle">Latest batch routing and agent outputs</span>
          </div>
          <div className="agent-flow-legend">
            <span className="legend ran">Ran</span>
            <span className="legend skipped">Skipped</span>
            <span className="legend conflict">Conflict</span>
          </div>
          <div className="agent-flow-grid">
            <div className="agent-card flow-card">
              <div className="card-header">
                <h3>Execution Map</h3>
                <span className="subtle">Click a node to inspect</span>
              </div>
              <div className="flow-graph">
                <ExecutionMap agents={agentGraph} onSelect={setSelectedAgent} animate />
              </div>
            </div>
            <div className="agent-card triage-card">
              <div className="card-header">
                <h3>Triage Reasoning</h3>
                <span className="subtle">Why agents ran or skipped</span>
              </div>
              <details open>
                <summary>Selection logic</summary>
                <p>{agentRuns?.triageReasoning ?? "No triage reasoning yet."}</p>
              </details>
              <div className="triage-meta">
                <span>Ran: {agentRuns?.selectedAgents.join(", ") || "None"}</span>
                <span>Skipped: {agentRuns?.skippedAgents.join(", ") || "None"}</span>
              </div>
            </div>
            <div className="agent-card output-card">
              <div className="card-header">
                <h3>Agent Output</h3>
                <span className="subtle">Structured JSON</span>
              </div>
              {selectedAgent ? (
                <>
                  <div className="agent-header">
                    <strong>{selectedAgent.name}</strong>
                    <span className={`agent-status ${selectedAgent.status}`}>{selectedAgent.status}</span>
                  </div>
                  <p className="agent-explanation">{selectedAgent.explanation}</p>
                  <div className="agent-output">
                    <pre>{JSON.stringify(selectedAgent.output ?? {}, null, 2)}</pre>
                  </div>
                </>
              ) : (
                <p className="empty">Click an agent node to inspect its output.</p>
              )}
            </div>
            <div className="agent-card timeline-card">
              <div className="card-header">
                <h3>Reasoning Timeline</h3>
                <span className="subtle">Step-by-step execution</span>
              </div>
              {agentRuns?.timeline?.length ? (
                <ol className="timeline-list compact">
                  {agentRuns.timeline.map((item, index) => (
                    <li key={`${item.label}-${index}`}>
                      <div className={`dot ${item.label.replace(/\s/g, "").toLowerCase()}`} />
                      <div>
                        <div className="timeline-header">
                          <strong>{item.label}</strong>
                          <span>{formatShortTimestamp(item.timestamp)}</span>
                        </div>
                        <p className="timeline-summary">{item.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty">No reasoning timeline yet.</p>
              )}
            </div>
          </div>
        </section>

        <section className="panel stakeholder-map">
          <div className="panel-header">
            <h2>Knowledge Graph & Stakeholder Map</h2>
            <span className="subtle">People ↔ Topics dependencies</span>
          </div>
          <StakeholderGraph nodes={stakeholderMap.nodes} topics={stakeholderMap.topicNodes} links={stakeholderMap.links} />
        </section>

        <section className="panel flow">
          <div className="panel-header">
            <h2>Communication Flow</h2>
            <span className="subtle">Top connections · arc height = interaction volume</span>
          </div>
          <FlowGraph nodes={flowGraph.nodes} links={flowGraph.links} />
        </section>

        <section className="panel knowledge">
          <div className="panel-header">
            <h2>Topic & Knowledge Heatmap</h2>
            <span className="subtle">Green = stable, Yellow = updated, Red = conflicted</span>
          </div>
          {topics.length === 0 ? (
            <p className="empty">No topics captured yet.</p>
          ) : (
            <div className="topics">
              {sortedTopics.map((topic) => {
                const tone = topic.isConflicting
                  ? "conflict"
                  : topic.isNew || topic.confidence < 0.6
                    ? "updated"
                    : "stable";
                return (
                  <article key={topic.topic} className={`topic-card ${tone}`}>
                    <header>
                      <h3>{topic.topic}</h3>
                      <span className={topic.confidence >= 0.75 ? "high" : ""}>
                        {Math.round(topic.confidence * 100)}%
                      </span>
                    </header>
                    <p>{topic.latestSummary}</p>
                    <span className="subtle">Updated {formatTimestamp(topic.lastUpdatedAt)}</span>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel clusters">
          <div className="panel-header">
            <h2>Topic Clusters</h2>
            <span className="subtle">Similar topics merged for clarity</span>
          </div>
          {topicClusters.length === 0 ? (
            <p className="empty">No clusters yet.</p>
          ) : (
            <div className="cluster-list">
              {topicClusters.map((cluster) => (
                <div key={cluster.key} className="cluster-card">
                  <div className="cluster-header">
                    <strong>{cluster.key}</strong>
                    <span>{cluster.topics.length} topics</span>
                  </div>
                  <p>{cluster.summary}</p>
                  <div className="cluster-tags">
                    {cluster.topics.slice(0, 4).map((topic) => (
                      <span key={topic.topic}>{topic.topic}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel charts">
          <div className="panel-header">
            <h2>Intelligence Signals</h2>
            <span className="subtle">Signals explain AI reasoning and load</span>
          </div>
          <div className="chart-grid">
            <ChartCard title="Messages per Person">
              <BarChart data={messageCounts.data} maxValue={messageCounts.max} />
            </ChartCard>
            <ChartCard title="Knowledge Momentum">
              <KnowledgePulseChart points={updatesOverTime} />
            </ChartCard>
          </div>
        </section>

        <section className="panel critique">
          <div className="panel-header">
            <h2>Deconfliction & Critique</h2>
            <span className="subtle">Pressure points the AI is flagging</span>
          </div>
          <div className="critique-grid">
            <div>
              <h3>Overloaded</h3>
              {overloadSignals.high.length === 0 ? (
                <p className="empty">No overload detected.</p>
              ) : (
                <ul>
                  {overloadSignals.high.map((person) => (
                    <li key={person.email}>
                      <strong>{person.name ?? person.email}</strong>
                      <span>{person.messageCount} touches</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>Isolated</h3>
              {overloadSignals.isolated.length === 0 ? (
                <p className="empty">No isolated stakeholders.</p>
              ) : (
                <ul>
                  {overloadSignals.isolated.map((person) => (
                    <li key={person.email}>
                      <strong>{person.name ?? person.email}</strong>
                      <span>Low visibility</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>Conflicts</h3>
              {conflicts.length === 0 ? (
                <p className="empty">No conflicts detected.</p>
              ) : (
                <ul>
                  {conflicts.slice(0, 3).map((conflict, index) => (
                    <li key={`${conflict.topic}-${index}`}>
                      <strong>{conflict.topic}</strong>
                      <span>{conflict.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="panel recommendations">
          <div className="panel-header">
            <h2>Recommendations</h2>
            <span className="subtle">Who should know, and why</span>
          </div>
          {updates?.recommendations?.whoShouldKnow?.length ? (
            <div className="recommendation">
              <p className="who">{updates.recommendations.whoShouldKnow.join(", ")}</p>
              <p className="why">{updates.recommendations.why}</p>
            </div>
          ) : (
            <p className="empty">No recommendation yet.</p>
          )}
          <div className="panel-footer">
            <span className="subtle">AI coordinates, it does not broadcast.</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta,
  tone = "default"
}: {
  label: string;
  value: number;
  delta: number;
  tone?: "default" | "danger";
}) {
  const direction = delta === 0 ? "steady" : delta > 0 ? "up" : "down";
  return (
    <div className={`kpi-card ${tone} ${direction !== "steady" ? "pulse" : ""}`}>
      <div>
        <span className="label">{label}</span>
        <strong>{value}</strong>
      </div>
      <div className={`delta ${direction}`}>
        {direction === "steady" ? "→" : direction === "up" ? "↑" : "↓"}
        <span>{Math.abs(delta)}</span>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function BarChart({ data, maxValue }: { data: Person[]; maxValue: number }) {
  if (data.length === 0) {
    return <p className="empty">No data yet.</p>;
  }
  return (
    <div className="bar-chart">
      {data.map((person) => (
        <div key={person.email} className="bar-row">
          <span>{person.name ?? person.email}</span>
          <div className="bar">
            <div style={{ width: `${(person.messageCount / maxValue) * 100}%` }} />
          </div>
          <span className="value">{person.messageCount}</span>
        </div>
      ))}
    </div>
  );
}

function KnowledgePulseChart({ points }: { points: { x: number; y: number }[] }) {
  const width = 300;
  const height = 140;
  const maxY = Math.max(...points.map((point) => point.y), 1);
  const paddingLeft = 30;
  const paddingBottom = 20;
  const coords = points.map((point, index) => {
    const x = (point.x / (points.length - 1 || 1)) * (width - paddingLeft - 10) + paddingLeft;
    const y = height - paddingBottom - (point.y / maxY) * (height - paddingBottom - 10);
    return { x, y };
  });

  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
  const area = `${line} L ${coords[coords.length - 1].x} ${height - paddingBottom} L ${coords[0].x} ${
    height - paddingBottom
  } Z`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="knowledge-pulse">
      <defs>
        <linearGradient id="pulseGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(14, 165, 233, 0.35)" />
          <stop offset="100%" stopColor="rgba(14, 165, 233, 0)" />
        </linearGradient>
      </defs>
      <line x1={paddingLeft} y1={10} x2={paddingLeft} y2={height - paddingBottom} className="axis-line" />
      <line x1={paddingLeft} y1={height - paddingBottom} x2={width - 10} y2={height - paddingBottom} className="axis-line" />
      <text x={width / 2} y={height - 4} textAnchor="middle" className="axis-label">
        Time
      </text>
      <text x={10} y={height / 2} textAnchor="middle" className="axis-label" transform={`rotate(-90 10 ${height / 2})`}>
        Updates
      </text>
      {coords.map((point, index) => (
        <rect
          key={`bar-${index}`}
          x={point.x - 6}
          y={point.y}
          width={12}
          height={height - paddingBottom - point.y}
          className="pulse-bar"
        />
      ))}
      <path d={area} className="pulse-area" />
      <path d={line} className="pulse-line" />
      {coords.map((point, index) => (
        <circle
          key={`dot-${index}`}
          cx={point.x}
          cy={point.y}
          r={index === coords.length - 1 ? 5 : 3}
          className={`pulse-dot ${index === coords.length - 1 ? "active" : ""}`}
        />
      ))}
    </svg>
  );
}

function ExecutionMap({
  agents,
  onSelect,
  animate
}: {
  agents: AgentRunInfo[];
  onSelect: (agent: AgentRunInfo) => void;
  animate: boolean;
}) {
  if (!agents.length) {
    return <p className="empty">No agent run data yet.</p>;
  }

  const agentMap = new Map(agents.map((agent) => [agent.name, agent]));
  const getStatus = (name: AgentRunInfo["name"]) => agentMap.get(name)?.status ?? "skipped";

  const nodeWidth = 110;
  const nodeHeight = 52;
  const nodeMeta = [
    { name: "Ingestion" as const, x: 70, y: 120, role: "Parse" },
    { name: "Triage" as const, x: 210, y: 120, role: "Route" },
    { name: "Knowledge" as const, x: 350, y: 40, role: "Extract" },
    { name: "Stakeholder" as const, x: 350, y: 120, role: "Map" },
    { name: "Memory" as const, x: 350, y: 200, role: "Version" },
    { name: "Critic" as const, x: 480, y: 120, role: "Audit" },
    { name: "Coordinator" as const, x: 620, y: 120, role: "Brief" }
  ];

  const edges = [
    { from: "Ingestion" as const, to: "Triage" as const },
    { from: "Triage" as const, to: "Knowledge" as const },
    { from: "Triage" as const, to: "Stakeholder" as const },
    { from: "Triage" as const, to: "Memory" as const },
    { from: "Knowledge" as const, to: "Critic" as const },
    { from: "Stakeholder" as const, to: "Critic" as const },
    { from: "Memory" as const, to: "Critic" as const },
    { from: "Critic" as const, to: "Coordinator" as const }
  ];

  const edgeStatus = (from: AgentRunInfo["name"], to: AgentRunInfo["name"]) => {
    const fromStatus = getStatus(from);
    const toStatus = getStatus(to);
    if (fromStatus === "skipped" || toStatus === "skipped") return "skipped";
    if (toStatus === "conflict") return "conflict";
    return "ran";
  };

  return (
    <svg viewBox="0 0 680 260" className={`execution-map ${animate ? "animate" : ""}`}>
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
        </marker>
      </defs>
      {edges.map((edge, index) => {
        const from = nodeMeta.find((node) => node.name === edge.from);
        const to = nodeMeta.find((node) => node.name === edge.to);
        if (!from || !to) return null;
        const fromX = from.x + nodeWidth / 2;
        const toX = to.x - nodeWidth / 2;
        const fromY = from.y;
        const toY = to.y;
        const status = edgeStatus(edge.from, edge.to);
        return (
          <path
            key={index}
            d={`M ${fromX} ${fromY} C ${fromX + 30} ${fromY}, ${toX - 30} ${toY}, ${toX} ${toY}`}
            className={`edge ${status}`}
            markerEnd="url(#arrow)"
          />
        );
      })}
      {nodeMeta.map((node) => {
        const status = getStatus(node.name);
        const agent = agentMap.get(node.name);
        return (
          <g
            key={node.name}
            className={`agent-point ${status}`}
            onClick={() => agent && onSelect(agent)}
            style={{ cursor: agent ? "pointer" : "default" }}
          >
            <rect
              x={node.x - nodeWidth / 2}
              y={node.y - nodeHeight / 2}
              width={nodeWidth}
              height={nodeHeight}
              rx={14}
            />
            <text x={node.x} y={node.y - 4} textAnchor="middle">
              {node.name}
            </text>
            <text x={node.x} y={node.y + 14} textAnchor="middle" className="agent-role">
              {node.role}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function FlowGraph({
  nodes,
  links
}: {
  nodes: { email: string; label: string; index: number; messageCount: number }[];
  links: { from: string; to: string; count: number }[];
}) {
  if (nodes.length === 0) {
    return <p className="empty">No communication flow yet.</p>;
  }

  const maxCount = Math.max(...links.map((link) => link.count), 1);
  const maxMessages = Math.max(...nodes.map((node) => node.messageCount), 1);

  // Horizontal layout: nodes spaced along the bottom, arcs above
  const svgWidth = 560;
  const nodeY = 200;
  const padding = 50;
  const spacing = nodes.length > 1 ? (svgWidth - padding * 2) / (nodes.length - 1) : 0;

  const posMap = new Map(
    nodes.map((node, i) => [
      node.email,
      { x: padding + i * spacing, y: nodeY, i }
    ])
  );

  const colors = ["#38bdf8", "#6366f1", "#a855f7", "#ec4899", "#f59e0b", "#22c55e"];

  return (
    <div className="flow-container">
      <svg viewBox={`0 0 ${svgWidth} 240`} className="flow-arc-graph">
        <defs>
          {colors.map((color, i) => (
            <linearGradient key={i} id={`arc-${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity="0.6" />
              <stop offset="50%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
          ))}
        </defs>

        {links.map((link, index) => {
          const from = posMap.get(link.from);
          const to = posMap.get(link.to);
          if (!from || !to) return null;
          const dist = Math.abs(from.x - to.x);
          const arcHeight = 30 + dist * 0.55;
          const midX = (from.x + to.x) / 2;
          const midY = nodeY - arcHeight;
          const weight = link.count / maxCount;
          const strokeWidth = 1.5 + weight * 3;
          const colorIndex = index % colors.length;
          return (
            <path
              key={index}
              d={`M ${from.x} ${nodeY} Q ${midX} ${midY} ${to.x} ${nodeY}`}
              fill="none"
              stroke={`url(#arc-${colorIndex})`}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          );
        })}

        {nodes.map((node) => {
          const pos = posMap.get(node.email);
          if (!pos) return null;
          const size = 5 + (node.messageCount / maxMessages) * 7;
          return (
            <g key={node.email}>
              <circle cx={pos.x} cy={nodeY} r={size + 3} fill="none" stroke="#38bdf8" opacity={0.15} />
              <circle cx={pos.x} cy={nodeY} r={size} fill="#0f172a" />
              <text x={pos.x} y={nodeY + size + 14} textAnchor="middle" fontSize="9" fill="#64748b">
                {node.label.split("@")[0]}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flow-legend-row">
        {nodes.slice(0, 4).map((node) => (
          <div key={node.email} className="flow-legend-item">
            <span className="flow-legend-dot" />
            <span>{node.label.split("@")[0]}</span>
            <span className="flow-legend-count">{node.messageCount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StakeholderGraph({
  nodes,
  topics,
  links
}: {
  nodes: Person[];
  topics: Topic[];
  links: { from: string; to: string }[];
}) {
  if (nodes.length === 0 || topics.length === 0) {
    return <p className="empty">No stakeholder dependencies yet.</p>;
  }

  const width = 520;
  const height = 240;
  const leftX = 140;
  const rightX = 380;
  const nodeStep = height / (nodes.length + 1);
  const topicStep = height / (topics.length + 1);

  const nodePositions = new Map(
    nodes.map((node, index) => [
      node.email,
      { x: leftX, y: nodeStep * (index + 1) }
    ])
  );
  const topicPositions = new Map(
    topics.map((topic, index) => [
      topic.topic,
      { x: rightX, y: topicStep * (index + 1) }
    ])
  );

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="stakeholder-graph">
      <defs>
        <linearGradient id="stakeGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      {links.map((link, index) => {
        const from = nodePositions.get(link.from);
        const to = topicPositions.get(link.to);
        if (!from || !to) return null;
        return (
          <path
            key={index}
            d={`M ${from.x} ${from.y} C ${from.x + 80} ${from.y}, ${to.x - 80} ${to.y}, ${to.x} ${to.y}`}
            stroke="url(#stakeGradient)"
            strokeWidth="1.5"
            fill="none"
            opacity={0.35}
          />
        );
      })}
      {nodes.map((node) => {
        const point = nodePositions.get(node.email);
        if (!point) return null;
        return (
          <g key={node.email}>
            <circle cx={point.x} cy={point.y} r={10} fill="#0f172a" />
            <text x={point.x - 12} y={point.y - 12} textAnchor="end" fontSize="10" fill="#475569">
              {node.name?.split(" ")[0] ?? node.email.split("@")[0]}
            </text>
          </g>
        );
      })}
      {topics.map((topic) => {
        const point = topicPositions.get(topic.topic);
        if (!point) return null;
        const color = topic.isConflicting ? "#ef4444" : topic.confidence >= 0.7 ? "#22c55e" : "#f59e0b";
        return (
          <g key={topic.topic}>
            <rect x={point.x - 6} y={point.y - 6} width={12} height={12} rx={3} fill={color} />
            <text x={point.x + 12} y={point.y + 4} textAnchor="start" fontSize="10" fill="#475569">
              {topic.topic}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
