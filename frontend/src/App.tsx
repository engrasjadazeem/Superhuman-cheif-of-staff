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
  const [showReasoning, setShowReasoning] = useState(true);
  const [showCommunication, setShowCommunication] = useState(true);

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

    const uniqueEmails = Array.from(
      new Set([
        ...people.map((person) => person.email),
        ...flows.map((flow) => flow.from),
        ...flows.map((flow) => flow.to)
      ])
    );

    const nodes = uniqueEmails.map((email, index) => {
      const person = people.find((item) => item.email === email);
      return {
        email,
        label: person?.name ?? email,
        messageCount: person?.messageCount ?? 0,
        index
      };
    });

    const linkMap = new Map<string, number>();
    for (const flow of flows) {
      const key = `${flow.from}->${flow.to}`;
      linkMap.set(key, (linkMap.get(key) ?? 0) + 1);
    }

    const links = Array.from(linkMap.entries()).map(([key, count]) => {
      const [from, to] = key.split("->");
      return { from, to, count };
    });

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

  const topicDistribution = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (const person of people) {
      for (const topic of person.topics) {
        buckets[topic] = (buckets[topic] ?? 0) + 1;
      }
    }
    return Object.entries(buckets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [people]);

  const summarySignals = useMemo(() => {
    const stable = topics.filter((topic) => !topic.isConflicting && topic.confidence >= 0.7).length;
    const updated = topics.filter((topic) => topic.isNew || topic.confidence < 0.7).length;
    return { stable, updated };
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
    const topicNodes = topics.slice(0, 8);
    const links = nodes.flatMap((person) =>
      person.topics.slice(0, 3).map((topic) => ({
        from: person.email,
        to: topic
      }))
    );
    return { nodes, topicNodes, links };
  }, [people, topics]);

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
              <div className="pill-row">
                <span className="pill stable">Stable</span>
                <span className="pill updated">Updated</span>
                <span className="pill conflict">Conflicted</span>
              </div>
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
            <h2>🧠 Agent Reasoning Flow</h2>
            <span className="subtle">Latest batch routing and agent outputs</span>
          </div>
          <div className="flow-layout">
            <div className="flow-graph">
              <AgentFlowGraph agents={agentGraph} onSelect={setSelectedAgent} />
              <div className="flow-toggle">
                <button
                  className={showReasoning ? "active" : ""}
                  type="button"
                  onClick={() => setShowReasoning((prev) => !prev)}
                >
                  Show agent reasoning
                </button>
                <button
                  className={showCommunication ? "active" : ""}
                  type="button"
                  onClick={() => setShowCommunication((prev) => !prev)}
                >
                  Show communication flow
                </button>
              </div>
              <div className="overlay-stack">
                {showReasoning && <AgentFlowOverlay agents={agentGraph} />}
                {showCommunication && <CommunicationOverlay nodes={flowGraph.nodes} links={flowGraph.links} />}
              </div>
            </div>
            <div className="flow-details">
              <div className="triage-box">
                <h3>Triage Reasoning</h3>
                <details open>
                  <summary>Why these agents ran</summary>
                  <p>{agentRuns?.triageReasoning ?? "No triage reasoning yet."}</p>
                  <div className="triage-meta">
                    <span>Ran: {agentRuns?.selectedAgents.join(", ") || "None"}</span>
                    <span>Skipped: {agentRuns?.skippedAgents.join(", ") || "None"}</span>
                  </div>
                </details>
              </div>
              <div className="agent-output">
                <h3>Agent Output</h3>
                {selectedAgent ? (
                  <>
                    <div className="agent-header">
                      <strong>{selectedAgent.name}</strong>
                      <span className={`agent-status ${selectedAgent.status}`}>{selectedAgent.status}</span>
                    </div>
                    <p className="agent-explanation">{selectedAgent.explanation}</p>
                    <pre>{JSON.stringify(selectedAgent.output ?? {}, null, 2)}</pre>
                  </>
                ) : (
                  <p className="empty">Click an agent node to inspect its output.</p>
                )}
              </div>
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
            <span className="subtle">Edges scale by interaction frequency</span>
          </div>
          <FlowGraph nodes={flowGraph.nodes} links={flowGraph.links} />
          <div className="insight">
            High-frequency links are bolded. Isolated nodes fade. Large nodes indicate heavy message load.
          </div>
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
              {topics.map((topic) => {
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
            <ChartCard title="Knowledge Updates Over Time">
              <LineChart points={updatesOverTime} />
            </ChartCard>
            <ChartCard title="Topics by Stakeholder">
              <DistributionChart entries={topicDistribution} />
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

        <section className="panel timeline">
          <div className="panel-header">
            <h2>Reasoning Timeline</h2>
            <span className="subtle">Step-by-step agentic reasoning</span>
          </div>
          {agentRuns?.timeline?.length ? (
            <ol className="timeline-list">
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

function LineChart({ points }: { points: { x: number; y: number }[] }) {
  const width = 240;
  const height = 120;
  const maxY = Math.max(...points.map((point) => point.y), 1);
  const path = points
    .map((point, index) => {
      const x = (point.x / (points.length - 1 || 1)) * (width - 20) + 10;
      const y = height - (point.y / maxY) * (height - 20) - 10;
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="line-chart">
      <path d={path} fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" />
      {points.map((point, index) => {
        const x = (point.x / (points.length - 1 || 1)) * (width - 20) + 10;
        const y = height - (point.y / maxY) * (height - 20) - 10;
        return <circle key={index} cx={x} cy={y} r="3" fill="#0f172a" />;
      })}
    </svg>
  );
}

function DistributionChart({ entries }: { entries: [string, number][] }) {
  if (entries.length === 0) {
    return <p className="empty">No data yet.</p>;
  }
  const total = entries.reduce((sum, entry) => sum + entry[1], 0) || 1;
  return (
    <div className="distribution">
      {entries.map(([label, value]) => (
        <div key={label} className="distribution-row">
          <span>{label}</span>
          <div className="pill">
            <div style={{ width: `${clamp((value / total) * 100, 5, 100)}%` }} />
          </div>
          <span className="value">{value}</span>
        </div>
      ))}
    </div>
  );
}

function AgentFlowGraph({
  agents,
  onSelect
}: {
  agents: AgentRunInfo[];
  onSelect: (agent: AgentRunInfo) => void;
}) {
  if (!agents.length) {
    return <p className="empty">No agent run data yet.</p>;
  }
  return (
    <div className="agent-nodes">
      {agents.map((agent) => (
        <button
          key={agent.name}
          type="button"
          className={`agent-node ${agent.status}`}
          onClick={() => onSelect(agent)}
        >
          <span>{agent.name}</span>
          <small>{agent.status}</small>
        </button>
      ))}
    </div>
  );
}

function AgentFlowOverlay({ agents }: { agents: AgentRunInfo[] }) {
  if (!agents.length) return null;
  return (
    <div className="agent-flow-overlay">
      {agents.map((agent, index) => (
        <div
          key={`${agent.name}-${index}`}
          className={`flow-edge ${agent.status}`}
          style={{
            top: 24 + index * 44
          }}
        />
      ))}
    </div>
  );
}

function CommunicationOverlay({
  nodes,
  links
}: {
  nodes: { email: string; label: string; index: number; messageCount: number }[];
  links: { from: string; to: string; count: number }[];
}) {
  if (nodes.length === 0) return null;
  const maxCount = Math.max(...links.map((link) => link.count), 1);
  return (
    <svg viewBox="0 0 300 220" className="comm-overlay">
      {links.map((link, index) => {
        const fromIndex = nodes.findIndex((node) => node.email === link.from);
        const toIndex = nodes.findIndex((node) => node.email === link.to);
        const fromX = 40 + (fromIndex % 4) * 70;
        const fromY = 40 + Math.floor(fromIndex / 4) * 60;
        const toX = 40 + (toIndex % 4) * 70;
        const toY = 40 + Math.floor(toIndex / 4) * 60;
        const strokeWidth = 1 + (link.count / maxCount) * 4;
        return (
          <line
            key={index}
            x1={fromX}
            y1={fromY}
            x2={toX}
            y2={toY}
            stroke="#60a5fa"
            strokeWidth={strokeWidth}
            opacity={0.4}
          />
        );
      })}
      {nodes.map((node, index) => {
        const x = 40 + (index % 4) * 70;
        const y = 40 + Math.floor(index / 4) * 60;
        const r = 6 + Math.min(node.messageCount, 6);
        return (
          <g key={node.email}>
            <circle cx={x} cy={y} r={r} fill="#1e3a8a" opacity={0.75} />
            <text x={x} y={y + 18} textAnchor="middle" fontSize="8" fill="#1f2937">
              {node.label.split("@")[0]}
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

  const radius = 115;
  const center = 150;
  const angleStep = (Math.PI * 2) / nodes.length;
  const maxCount = Math.max(...links.map((link) => link.count), 1);
  const maxMessages = Math.max(...nodes.map((node) => node.messageCount), 1);
  const minMessages = Math.min(...nodes.map((node) => node.messageCount), 0);

  const positions = new Map(
    nodes.map((node, index) => {
      const angle = index * angleStep - Math.PI / 2;
      return [
        node.email,
        {
          x: center + radius * Math.cos(angle),
          y: center + radius * Math.sin(angle)
        }
      ];
    })
  );

  return (
    <svg viewBox="0 0 300 300" className="flow-graph">
      <defs>
        <linearGradient id="flowGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      {links.map((link, index) => {
        const from = positions.get(link.from);
        const to = positions.get(link.to);
        if (!from || !to) return null;
        const strokeWidth = 1 + (link.count / maxCount) * 5;
        return (
          <line
            key={index}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="url(#flowGradient)"
            strokeWidth={strokeWidth}
            opacity={0.55}
          />
        );
      })}
      {nodes.map((node) => {
        const point = positions.get(node.email);
        if (!point) return null;
        const size = 8 + (node.messageCount / maxMessages) * 10;
        const opacity = node.messageCount <= minMessages + 1 ? 0.5 : 1;
        return (
          <g key={node.email} opacity={opacity}>
            <circle cx={point.x} cy={point.y} r={size} fill="#0f172a" />
            <circle cx={point.x} cy={point.y} r={size + 4} fill="none" stroke="#38bdf8" opacity={0.3} />
            <text x={point.x} y={point.y + size + 14} textAnchor="middle" fontSize="10" fill="#475569">
              {node.label.split("@")[0]}
            </text>
          </g>
        );
      })}
    </svg>
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
