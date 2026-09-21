# Nodus — AI Brainstorming Harness

Nodus is not a chatbot. Multiple AI agents **freely debate** one topic, the
discussion is visualized as an evolving **Idea Graph**, and you can **fork a new
branch from any node** to explore a different direction.

```
topic → free AI debate → snapshot every N turns → idea graph
  → pick a node → "여기부터 다시 토론" → new branch → diverge
```

Nodus is a place to **explore possibilities with AI**, not a place where AI
hands you the answer.

## Features

- Free multi-agent debate (2–5 agents, no fixed speaking order, weighted scheduler)
- Streaming responses via SSE (`agent_start` / `token` / `agent_message` / …)
- Silent moderator (only surfaces repetition, drift, deadlock, conflicts, decisions)
- Incremental idea graph (typed nodes/edges, LLM structured output + Pydantic validation + retry)
- Branching: fork from any graph node, context + graph inherited, parent untouched
- User can interject anytime (user messages never count as AI turns)
- PostgreSQL persistence, Docker Compose one-command run
- Offline demo mode: without an `LLM_API_KEY`, a built-in mock provider keeps
  debate + graph + branching fully usable
- Light/dark theme: follows the OS by default, toggle in the top bar, choice
  remembered per browser

## Architecture

```
frontend (React + React Flow, SSE client)
   │  REST + SSE
backend (FastAPI)
   ├── Debate Engine → Scheduler → LLM Provider (OpenAI-compatible / mock)
   ├── Moderator (heuristic + LLM, silent unless triggered)
   ├── Graph Extractor (structured JSON) → Graph Manager (incremental merge)
   └── Branch Manager (+ Context Builder) → PostgreSQL
```

## Tech Stack

Frontend: React, TypeScript, Vite, React Flow, plain CSS.
Backend: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async), httpx, SSE.
Infra: Docker, Docker Compose, PostgreSQL 16.

## Getting Started

### Docker (recommended)

```bash
cp .env.example .env        # fill in LLM_API_KEY to use a real model
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8000 (`GET /api/health`)
- Postgres: localhost:5432 (user/password/db: `nodus`)

Without `LLM_API_KEY`, the backend runs in mock mode — everything works, no network needed.

### Windows one-click (`run.bat`)

Once the backend venv and `frontend/node_modules` exist (see below), double-click
`run.bat`: it starts the backend (:8000) and the frontend (:5173) inside a single
console window, waits until both answer, then opens http://localhost:5173.
Close that window to stop both. Backend and frontend logs share the one window.

### Local development

Backend:

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate   # Windows
pip install -r requirements.txt
cp .env.example .env                              # sqlite default works out of the box
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                                       # http://localhost:5173
```

## Environment Variables

| Var | Meaning | Default |
| --- | --- | --- |
| `DATABASE_URL` | SQLAlchemy async URL (postgres `postgresql+asyncpg://…` or sqlite `sqlite+aiosqlite://…`) | sqlite file |
| `LLM_API_KEY` | API key (backend only, never exposed to frontend). Empty = mock mode | "" |
| `LLM_BASE_URL` | OpenAI-compatible base URL | `https://api.openai.com/v1` |
| `LLM_MODEL` | Default model | `gpt-4o-mini` |
| `LLM_DEBATE_MODEL` / `LLM_GRAPH_MODEL` / `LLM_MODERATOR_MODEL` | Per-role overrides | fall back to `LLM_MODEL` |
| `CORS_ORIGINS` | Allowed frontend origins | localhost dev ports |

## How Debate Works

- 1 turn = 1 AI message. User messages and moderator notes never count.
- `POST /api/discussions/{id}/start {"turns": N}` runs N turns in the background.
- Each turn: scheduler picks a speaker (penalizes repeats, favors unheard voices) →
  agent streams tokens over SSE → message persisted with its turn number.
- Agent system prompts carry only a *tendency* (ideation, critique, alternatives,
  feasibility, wildcards) — never a script or order.

## How Graph Works

- Every `graph_interval` AI turns (user setting: 5/10/20/30/50/custom), the backend
  sends recent messages + existing nodes to the graph model as structured output.
- Output is validated with Pydantic (`GraphSnapshot`); failures retry, then repair-parse.
- Merging is incremental: matching nodes (by id, then label) are updated, edges are
  added, nothing is ever deleted — superseded ideas become `refined`/`merged`/`dropped`.
- Node types: `idea question objection problem decision conclusion`.
  Edge types: `supports contradicts refines derives_from related_to duplicates`.

## How Branching Works

- Click a node → detail panel (description, related nodes, source messages) →
  **"여기부터 다시 토론"** → `POST /api/discussions/{id}/branches`.
- The child branch copies: settings, conversation up to the fork turn, and the full
  graph state (with fresh ids). The parent is never modified.
- Branches nest arbitrarily (`Main → A → A-1 …`). Each branch debates independently
  with its own turn counter and snapshots; switch via the branch chips.

## API (minimal)

```
POST /api/projects                        create project (+ root branch)
GET  /api/projects                        list
GET  /api/projects/{id}                   detail + branches
POST /api/projects/{id}/discussions       extra root discussion
GET  /api/discussions/{id}                branch detail (messages + graph)
POST /api/discussions/{id}/start          run N turns (SSE streams progress)
POST /api/discussions/{id}/stop           request stop
POST /api/discussions/{id}/message        user interjection
GET  /api/discussions/{id}/stream         SSE event stream
GET  /api/discussions/{id}/graph          current graph
POST /api/discussions/{id}/branches       fork from node
GET  /api/branches/{id}                   branch detail
GET  /api/health                           health + llm status
```

## Project structure

See `frontend/src` (`components/ graph/ chat/ settings/ api/ hooks/ types/`) and
`backend/app` (`api/ agents/ graph/ branching/ llm/ models/`) as specified.
