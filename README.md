# Story Vista: Knowledge kids can trust. In a voice that feels like home.

Your child asks "why is the sky blue?" at 8pm. You're exhausted. 

**Story Vista has you covered.**

Type the topic. In seconds, it becomes a real story — with real facts, real images, and your voice telling it.

### 🚀 How It Works
Story Vista isn't a simple chatbot. It uses a precision tech stack to bridge the gap between "Generative AI" and "Verified Knowledge":
- **Firecrawl (The Knowledge Hunter):** It crawls and extracts facts only from sources you'd actually trust — *National Geographic Kids, BBC Bitesize, NASA, Khan Academy, Britannica, and Britannica*. It ensures the content is grounded in reality, not AI hallucinations.
- **ElevenLabs (The Emotional Core):** It provides professional-grade voice cloning. Mum's voice. Dad's voice. The class teacher's voice. You record 30 seconds once, and Story Vista narrations feel like home forever.

### ✨ What that looks like in practice:
- **A 5-year-old asks about volcanoes.** They get a story about a mountain that sneezes lava — narrated by Dad, with real NASA photos, every fact sourced via Firecrawl.
- **A teacher needs a photosynthesis lesson by tomorrow.** They get a full plan, narration script, and discussion questions — in their own voice via ElevenLabs — in under a minute.
- **A curious 8-year-old wants to know about the Amazon.** They get a scene-by-scene adventure, age-appropriate language, and Mum reading it at bedtime.

### 🧩 Why This Matters
Most kids' content online is generic, culturally flat, or just made up. Parents and teachers deserve better than hoping an AI didn't hallucinate. Every single thing Story Vista tells a child has a source URL behind it. Every story is written for their age — not dumbed down, not overwhelming. 

**Knowledge kids can trust. In a voice that feels like home.**

---

## Architecture

```
Firecrawl (curated sources)
    ↓
crawler.js  →  raw pages
    ↓
structurer.js  →  Groq (fast pass) → Claude (quality review if score < 0.6)
    ↓
knowledge.js  →  PostgreSQL + pgvector
    ↓
API  →  GET /knowledge, POST /ingest, vector search
```

---

## Ubuntu Setup

### 1. System dependencies

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL 16
sudo apt install -y postgresql postgresql-contrib

# pgvector extension
sudo apt install -y postgresql-16-pgvector

# Redis
sudo apt install -y redis-server
sudo systemctl enable redis-server && sudo systemctl start redis-server
```

### 2. PostgreSQL setup

```bash
sudo -u postgres psql << 'EOF'
CREATE USER storyvista WITH PASSWORD 'your_password_here';
CREATE DATABASE storyvista OWNER storyvista;
GRANT ALL PRIVILEGES ON DATABASE storyvista TO storyvista;
EOF
```

### 3. Clone and install

```bash
git clone <repo>
cd storyvista
npm install
cp .env.example .env
# Edit .env with your API keys and DB credentials
```

### 4. Run migration

```bash
npm run migrate
```

### 5. Start services

**Development:**
```bash
# Terminal 1 — API server
npm run dev

# Terminal 2 — Queue worker
npm run worker
```

**Production (with PM2):**
```bash
npm install -g pm2

pm2 start src/index.js --name storyvista-api
pm2 start src/queue/worker.js --name storyvista-worker
pm2 save
pm2 startup  # follow the printed command to enable on boot
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/sources` | List curated sources |
| POST | `/api/v1/ingest` | Queue an ingestion run |
| GET | `/api/v1/ingest/job/:id` | Check job status |
| GET | `/api/v1/knowledge` | List knowledge blocks |
| GET | `/api/v1/knowledge/search?q=` | Full-text search |
| GET | `/api/v1/knowledge/:id` | Get a specific block |

### Trigger ingestion

```bash
# Ingest all sources
curl -X POST http://localhost:3000/api/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{}'

# Ingest with topic focus
curl -X POST http://localhost:3000/api/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{ "topic": "photosynthesis", "subjects": ["science"] }'

# Ingest specific sources only
curl -X POST http://localhost:3000/api/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{ "sourceIds": ["natgeo-kids", "bbc-bitesize"] }'
```

## Corpus Enrichment & Management

The Story Vista knowledge base (Corpus) can be enriched via three methods:

### 1. Global Ingestion (CLI) 🌍
Crawl and structure data from pre-approved, trusted sources. Support for **Free Fallback mode** is automatic if Firecrawl credits are exhausted.

```powershell
# Specific source (natgeo-kids, nasa-kids, bbc-bitesize, wikimedia, etc.)
npm run ingest -- --sources=natgeo-kids

# By region (e.g. Nigerian sources only)
npm run ingest -- --region=ng

# With specific topic focus
npm run ingest -- --sources=wikipedia-simple --topic="Ancient Civilizations"
```

### 2. Admin Portal (On-Demand) 🛡️
Trigger on-demand ingestion for any topic directly from the UI:
1. Navigate to the **Corpus** tab.
2. Use the **Admin Corpus** panel (requires `ADMIN_API_KEY` as passkey).
3. Topic will be ingested in "Direct Mode" and reflect in the list immediately.

### 3. Personal Corpus (Private Context) 📝
Users can add private, device-specific facts that ground their own stories without global registration.
1. Use the **Personal Content** box in the Corpus view.
2. Facts are "Fingerprinted" to your Device ID.
3. RAG engine will find these facts alongside global ones during story generation.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key (quality review pass) |
| `GROQ_API_KEY` | Groq API key (fast structuring pass) |
| `FIRECRAWL_API_KEY` | Firecrawl API key |
| `ELEVENLABS_API_KEY` | ElevenLabs key (Phase 2) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `GROQ_MODEL` | Groq model (default: llama-3.1-70b-versatile) |
| `CLAUDE_MODEL` | Claude model (default: claude-opus-4-5) |
| `CRAWL_CONCURRENCY` | Parallel crawl jobs (default: 3) |
| `CRAWL_MAX_PAGES` | Max pages per source (default: 20) |

---

## Quality System

Every knowledge block is scored 0–1 based on:
- Number of extracted facts (6+ = higher score)
- Presence of all age-band explanations
- Key concepts and story/lesson elements populated
- High-confidence facts proportion

**Blocks with score < 0.6 are automatically sent for Claude review.**
**Blocks flagged as not child-appropriate are discarded.**

---

## Next Phases

- **Phase 2:** Media layer (Wikimedia Commons + DALL-E generation)
- **Phase 2:** Voice output (ElevenLabs integration)
- **Phase 3:** Story generation (RAG pipeline over knowledge base)
- **Phase 3:** Lesson generation with visual scene descriptions


Jsg8v25XN3O9On5v

DATABASE_URL=postgresql://postgres:Jsg8v25XN3O9On5v@db.wcciouedsknhfkqfiuws.supabase.co:5432/postgres