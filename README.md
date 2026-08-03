# A+ Foundry

**Don't build an AI image generator. Build the production system behind one.**

Amazon rejects A+ Content for reasons that have nothing to do with whether the
image looks good: wrong canvas dimensions, text inside the mobile safe zone, a
promotional badge, a competitor mark. And when a marketplace or a client asks
where an image came from, "our AI made it" is not an answer.

A+ Foundry generates Amazon A+ Content imagery and then does the part everyone
skips — audits it against a real compliance rubric, retries what fails, records
every attempt, and stores the evidence so anyone can verify it later without an
account.

Built on [Genblaze](https://pypi.org/project/genblaze-core/) and
[Backblaze B2](https://www.backblaze.com/cloud-storage).

---

## What it does

| | |
|---|---|
| **Generates** | Amazon A+ modules at their real canvas sizes (970×600 header, 970×300 banner, 300×300 card, 150×150 comparison cell, 135×135 grid tile) |
| **Audits** | Deterministic checks (dimensions, aspect, colour mode, file size, sharpness) plus a vision judge for pricing claims, superlatives, competitor marks, contact info, and mobile-safe-zone text |
| **Retries** | A rejected asset triggers a new generation linked to the one it replaces, so the failure and the fix both stay on the record |
| **Falls back** | Four image vendors in one chain; a vendor outage moves to the next *company*, not the next retry |
| **Scores** | Listing readiness — five merchandising properties measured from the pixels, separate from the pass/fail verdict |
| **Stores** | Two B2 key layouts simultaneously, with Object Lock on the provenance record |
| **Proves** | A public verify page reads the manifest embedded inside an exported image. No account needed |

---

## AI providers and models

Image generation runs through a single ordered fallback chain. Every link is
free-tier, which is why total metered spend across every run in the shipped
database is **$0.00**.

| # | Slot | Model | Vendor | Role |
|---|---|---|---|---|
| 0 | `hf-together` | `black-forest-labs/FLUX.1-schnell` | Together AI | primary |
| 1 | `hf-fal-ai` | `black-forest-labs/FLUX.1-schnell` | fal.ai | fallback |
| 2 | `pollinations-flux` | `flux` | Pollinations | fallback |
| 3 | `pollinations-sana` | `sana` | Pollinations | fallback |
| 4 | `local-mock` | `local-mock-v1` | — | last resort |

Slots 0 and 1 are reached through **Hugging Face Inference Providers**, which
brokers rather than hosts: one token routes to separate companies running their
own hardware. That is what makes the chain multi-*vendor* rather than
multi-model — every Pollinations slot shares one operator and therefore one
failure domain.

**Compliance judging** — vision models, called through an OpenAI-compatible
endpoint:

| Judge | Model | Role |
|---|---|---|
| AgentRouter | `gpt-5.6-sol` | primary |
| Groq | `meta-llama/llama-4-scout-17b-16e-instruct` | fallback |

Two vision calls run in parallel per asset: one reads the whole frame for
policy violations, one reads a crop of the bottom strip for safe-zone text.
A judge that returns 401/402/403/429 is circuit-broken for the process.

### Providers wired but disabled

Left in the codebase, excluded from the chain via `DISABLED_PROVIDERS`, because
an unfunded account fails every attempt and those failures would be recorded as
reliability data — misreporting a billing problem as an outage.

| Provider | Model | Why disabled |
|---|---|---|
| GMI Cloud | Seedream | sponsor credits never arrived (`402`) |
| Cloudflare Workers AI | Lucid Origin, Phoenix 1.0, FLUX-1-schnell | daily free allocation exhausted (`429`) |
| Replicate | `black-forest-labs/flux-schnell` | `402`; credit is per-account, not per-key |
| NVIDIA NIM | `black-forest-labs/flux.1-schnell` | tested and dropped — 300s with zero bytes returned at every supported size |

---

## How this uses Genblaze

Genblaze is the generation and provenance layer. Not a thin wrapper — the
pipeline, the storage key strategies, the manifest format, the Object Lock
config and the manifest embedding are all Genblaze primitives.

**`genblaze-core`**

- `Pipeline` / `Step` / `Modality` / `PipelineResult` — every generation is a
  pipeline run. Retries use `.from_result(parent)` so a corrected asset is
  linked to the one it replaces.
- `SyncProvider`, `ProviderCapabilities`, `ProviderErrorCode`, `Asset` — three
  custom providers written against this interface:
  [`hf_provider.py`](app/services/hf_provider.py),
  [`pollinations_provider.py`](app/services/pollinations_provider.py),
  [`cloudflare_provider.py`](app/services/cloudflare_provider.py).
- `ObjectStorageSink` + `KeyStrategy.HIERARCHICAL` and
  `KeyStrategy.CONTENT_ADDRESSABLE` — the dual B2 layout below.
- `ObjectLockConfig` — GOVERNANCE retention applied to manifests only.
- `ParquetSink` — a structured run index written alongside each manifest.
- `Manifest` + `canonical_hash` — provenance record and its tamper check.
- `SmartEmbedder` / `SidecarHandler` — embeds the manifest *inside* the exported
  PNG, with a sidecar JSON fallback for formats that cannot carry it.

**`genblaze-s3`** — `S3StorageBackend.for_backblaze()` is the B2 connection,
with `preflight=True` so bad credentials fail at construction with a clear
message instead of mid-upload after a paid generation.

**`genblaze-gmicloud` / `-openai` / `-replicate` / `-nvidia`** — adapters wired
for the disabled providers above.

---

## How this uses Backblaze B2

One bucket, **three key layouts**, because there are three different questions.

```
aplusplus/runs/{asin}/{date}/{run_id}/assets/{uuid}.png
aplusplus/runs/{asin}/{date}/{run_id}/manifest.json        ← Object Lock
aplusplus/assets/{ab}/{cd}/{sha256}.png
aplusplus/manifests/{run_id}.json                          ← Object Lock
```

**`runs/` — "what happened for this product?"**
Hierarchical, partitioned by ASIN then date then run. Holds *every* attempt
including rejected ones. This is the tree an audit walks.

**`assets/` — "have we produced these exact bytes before?"**
Content-addressable: the key *is* the SHA-256, sharded two levels. Identical
output from two different ASINs collapses onto one key, so the library is
deduplicated by construction rather than by a nightly job. In the shipped data,
49 run assets resolve to 36 unique objects.

**`manifests/` — "prove it."**
The provenance record for the content-addressed copy.

### Object Lock

GOVERNANCE-mode retention, 7 days, applied to **manifests only** — never to
assets. Bucket-wide COMPLIANCE retention would make every object in the bucket
undeletable by anyone including the account root for the whole window,
development junk included. Locking just the manifest gives the same
tamper-evidence for provenance while leaving images manageable.

```
manifest.json  →  mode: GOVERNANCE, retain until +7d
asset.png      →  no lock
```

The bucket is **private**. Object URLs return 401 in a browser, so the API
serves assets through an authenticated `/asset?key=` proxy.

---

## Running it locally

### Requirements

Python 3.11, Node 18+, and a Backblaze B2 bucket with Object Lock enabled.

### 1. Backend

```bash
git clone https://github.com/austinjeremiah/Aplus.git
cd Aplus

python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt

cp .env.example .env      # then fill it in — see below
```

Minimum `.env` for a working system:

```ini
# Backblaze B2 — bucket must have Object Lock enabled at creation
B2_KEY_ID=...
B2_APP_KEY=...
B2_BUCKET=your-bucket-name
B2_REGION=us-east-005
MANIFEST_RETENTION_DAYS=7
STORAGE_PREFIX=aplusplus

# Image generation — one free token, four vendors
# https://huggingface.co/settings/tokens  (needs Inference permissions)
HF_API_KEY=hf_...
HF_PROVIDERS=together,fal-ai
HF_IMAGE_MODEL=black-forest-labs/FLUX.1-schnell

# Compliance judge — either one works
AGENTROUTER_API_KEY=...
AGENTROUTER_VISION_MODEL=gpt-5.6-sol
GROQ_API_KEY=...

# Providers with unfunded accounts or exhausted free tiers
DISABLED_PROVIDERS=gmicloud,cloudflare,cf,replicate
```

Every credential is optional. With none set, the system starts and degrades to
the local renderer rather than failing — `/health` reports exactly what is
configured and what is missing.

### 2. Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```ini
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-oauth-client-id
```

The Google client ID is a public identifier — no secret, no callback URL, no
server-side session.

### 3. Run both

```bash
./run.sh          # API on :8000, web on :3000
./run.sh api      # backend only, with reload
./run.sh web      # frontend only
./run.sh stop     # stop both
```

Open **http://localhost:3000**.

### 4. Verify the storage layer

```bash
PYTHONPATH=. .venv/bin/python scripts/smoke_storage.py
```

Exercises both key strategies against the real bucket and verifies the manifest
hash round-trips.

---

## Deploying

**Backend** — [`render.yaml`](render.yaml) is a Render blueprint. Secrets are
declared `sync: false`, so Render prompts on first deploy and nothing lands in
the repo.

**Frontend** — Vercel, with **Root Directory set to `frontend`**. The repo root
is a Python project; without that setting Vercel builds nothing and every route
404s. Set `NEXT_PUBLIC_API_URL` to the Render URL *before* building —
`NEXT_PUBLIC_*` is inlined at build time.

`data/aplusplus.db` ships with the repo so a fresh deploy has run history
immediately. An empty database renders blank galleries and blank analytics, and
that history is the evidence behind every reliability claim the app makes.

---

## Layout

```
app/
  main.py                   FastAPI app, /health, /asset B2 proxy
  config.py                 pydantic-settings; every credential optional
  rubric/
    aplus_rules.py          deterministic checks
    readiness.py            5 pixel-measured merchandising metrics
    modules.json            Amazon A+ module specs
  services/
    providers.py            the fallback chain
    pipeline.py             chain walk, circuit breaker, dual B2 write
    orchestrator.py         generate → judge → retry loop
    compliance.py           deterministic + vision, parallel calls
    vision.py               pluggable judges with circuit breaking
    storage.py              Genblaze sinks, Object Lock, B2 backend
    manifest.py             embed manifest into the exported file
    hf_provider.py          4 vendors via HF Inference Providers
    pollinations_provider.py
    cloudflare_provider.py
  routers/                  generate, runs, gallery, asin, verify
frontend/
  app/                      landing, dashboard, generate, runs,
                            review, gallery, analytics, asin, verify
scripts/
  smoke_storage.py                    verify both key strategies
  backfill_content_addressable.py     mirror pre-existing runs
  backfill_readiness.py               score pre-existing assets
```

---

## Design decisions worth knowing

**Prohibitions live in the negative prompt, never the positive one.** Diffusion
models do not process negation — writing *"no discount badges"* into the prompt
reliably produces discount badges. The first version listed the rules inline and
every generation came back with the exact overlays the rubric then rejected.

**The prompt never names a marketplace.** *"Professional Amazon product
photography"* made the model emboss "amazon" onto the product, which the rubric
then correctly rejected as a brand mark.

**`needs_review` is a distinct status from `failed`.** "We found no violations"
and "we could not check" must never collapse into the same verdict. A degraded
report — judge unreachable — is never reported as a pass.

**Vision flags require quotable evidence.** A safe-zone flag without a
`words_read` field is dropped. Without that rule the judge rejected every image
with prose like *"the bottom strip shows the base of the bottle"* — an
observation, not a violation.

**Readiness is not a predicted click-through rate.** There is no impression or
sales data behind this system, so any such figure would be invented. Every
readiness metric reports the measurement that produced it, reproducible by
anyone holding the file.

**Pass rate counts only attempts that reached the rubric.** A provider that
errored has no pass rate — "breaks Amazon's rules" and "the endpoint was down"
are different failures with different fixes.
