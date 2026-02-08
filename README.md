# AI Chief of Staff (Full-Stack TypeScript)

This project streams a large CSV of emails, batches the first 100 records, and extracts organizational intelligence using the OpenAI Agents SDK. The UI presents a Chief of Staff dashboard that highlights stakeholders, knowledge updates, conflicts, and who should be informed.

**Stack**
- Backend: Node.js + Express (TypeScript)
- Frontend: React + TypeScript (Vite)
- AI: OpenAI Agents SDK for JavaScript/TypeScript
- CSV: streaming via `csv-parser`

## Project Structure
- `/Users/asjadazeem/Documents/playground/backend` - Express API + streaming CSV + OpenAI Agents SDK
- `/Users/asjadazeem/Documents/playground/frontend` - React dashboard UI

## Backend Setup

```bash
cd /Users/asjadazeem/Documents/playground/backend
npm install
```

Create an `.env` file or export env vars:

```bash
export OPENAI_API_KEY="your_key_here"
export CSV_PATH="/Users/asjadazeem/Downloads/emails.csv"
export BATCH_INTERVAL_SECONDS=30
```

Run the API:

```bash
npm run dev
```

The backend listens on `http://localhost:3001` by default.

## Frontend Setup

```bash
cd /Users/asjadazeem/Documents/playground/frontend
npm install
npm run dev
```

Open `http://localhost:5173` in the browser.

Set a custom API base if needed:

```bash
export VITE_API_BASE="http://localhost:3001"
```

## API Endpoints
- `POST /api/start` Start CSV processing (first 100 records)
- `GET /api/status` Status/progress
- `GET /api/intelligence/people` People index
- `GET /api/intelligence/topics` Topics with latest summaries + conflict flags
- `GET /api/intelligence/updates` Knowledge updates, decisions, recommendations
- `GET /api/intelligence/conflicts` Conflicts detected

## Batching Behavior
- The backend streams the CSV from `CSV_PATH` and reads only the first 100 rows.
- Records are placed into an in-memory queue.
- A batch runs every `BATCH_INTERVAL_SECONDS` (default: 30 seconds).
- Each batch processes up to `BATCH_SIZE` records (default: 10).
- Each batch is analyzed by the AI Chief of Staff agent, and results are stored in memory.

## Configuration
Environment variables:
- `OPENAI_API_KEY` (required)
- `CSV_PATH` (default: `/Users/asjadazeem/Downloads/emails.csv`)
- `CSV_RECORD_LIMIT` (default: `100`)
- `DEMO_MAX_RECORDS` (default: `200`) hard cap for demos
- `BATCH_INTERVAL_SECONDS` (default: `30`)
- `BATCH_SIZE` (default: `10`)
- `PORT` (default: `3001`)

## Observability
- Structured JSON logs include: startup, CSV stream start/end, batch start/end, agent run start/end, knowledge updates applied, conflicts detected, and decisions.
- Agent logs include token usage (when available).

## Notes
- The CSV is streamed; the file is never loaded fully into memory.
- Easy to extend beyond the first 100 records by increasing `CSV_RECORD_LIMIT` or removing the limit.
