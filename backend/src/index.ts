import "dotenv/config";
import "./env-setup.js";
import express from "express";
import cors from "cors";
import {
  getConflicts,
  getLatestAgentRuns,
  getPeople,
  getStatus,
  getTopics,
  getUpdates,
  startProcessing
} from "./processor.js";
import { logInfo } from "./logger.js";

const app = express();
const PORT = Number(process.env.PORT ?? "3001");

app.use(cors());
app.use(express.json());

app.post("/api/start", async (_req, res) => {
  const status = await startProcessing();
  res.json(status);
});

app.get("/api/status", (_req, res) => {
  res.json(getStatus());
});

app.get("/api/intelligence/people", (_req, res) => {
  res.json(getPeople());
});

app.get("/api/intelligence/topics", (_req, res) => {
  res.json(getTopics());
});

app.get("/api/intelligence/updates", (_req, res) => {
  res.json(getUpdates());
});

app.get("/api/intelligence/conflicts", (_req, res) => {
  res.json(getConflicts());
});

app.get("/api/agent-runs/latest", (_req, res) => {
  res.json(getLatestAgentRuns());
});

app.listen(PORT, () => {
  logInfo("Backend started", { port: PORT });
});
