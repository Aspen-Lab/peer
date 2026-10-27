# 三层渐进增强架构 — Peer Three-Tier Architecture

> **Source of truth:** https://hermes-admin-eta.vercel.app — the owners' own blueprint site. This doc mirrors it for in-repo reference. If the two ever diverge, the admin site wins.

Every LLM-using feature in Peer must respect this doctrine. The app must work end-to-end with **zero API keys**, and tier up gracefully when keys are added.

---

## The three tiers

Each tier works standalone. Higher tiers add capability without removing the floor.

### Tier 0 — Rule Engine *(the floor; must always work)*

- **零外部模型依赖** — zero external model dependencies
- Pure algorithms: TF-IDF vectorization, regex rules, MinHash deduplication
- Runs in milliseconds, minimal hardware
- This is what `web/src/lib/scoring/` already implements
- **Peer must function fully on Tier 0 — no API keys, no local models, no cloud dependencies**

### Tier 1 — Local Models *(privacy + offline)*

- Builds on Tier 0 with local LLM inference (Ollama, llama.cpp) + sentence-transformers
- Enables semantic similarity ("固态电池" ≈ "全固态电池")
- Fully offline — no data leaves the user's machine
- Not yet implemented in the web app

### Tier 2 — Cloud LLM *(deep reasoning, optional)*

- API-based reasoning ("深度推理"): Anthropic Claude, Google Gemini Vertex, OpenAI, etc.
- **Requires user-provided API keys (BYOK — bring your own key)**
- Token budgets enforced to prevent runaway costs
- **Automatic graceful degradation** back to Tier 1 → Tier 0 when budget exhausted, key invalid, or service down
- Enables the digest, per-paper extraction, and audio briefing

---

## The five-stage pipeline (tier-agnostic)

```
1. Source collection (concurrent async)
2. Relevance scoring  (formula: keyword × 0.4 + semantic × 0.4 + recency × 0.1 + source × 0.1)
3. Deduplication / clustering
4. Content distillation (extraction → generation → personalized)
5. Format output (markdown / email / digest paragraph / audio)
```

Tier choice only affects:
- **Step 2** — TF-IDF only (Tier 0) vs. TF-IDF + semantic embedding (Tier 1+)
- **Step 4** — extractive truncation (Tier 0) vs. LLM synthesis (Tier 1+)

Steps 1, 3, 5 are identical regardless of tier.

---

## Product principles (owners' words)

- **时间效率 > 信息量** — Ten precise items beat 100 noisy ones. *Time efficiency over information volume.*
- **用户意志声明** — User explicitly declares identity and interests via profile/YAML.
- **File over App** — Output is plain markdown, not proprietary lock-in.
- **渐进复杂度** — Five-minute onboarding; unlimited depth for power users.

---

## Engineering rules that follow from the doctrine

When building any feature that uses an LLM or external API, the rules are non-negotiable:

1. **Tier-0 fallback is required.** Every feature must have a graceful no-LLM mode. The digest component hiding itself when `ANTHROPIC_API_KEY` is unset is the correct pattern.

2. **Provider must be swappable.** Code against a thin abstraction — never directly against a single SDK in the request path. Today: Anthropic. Tomorrow: Gemini Vertex, OpenAI, Ollama. Adding a provider should mean writing one new file, not editing many.

3. **Deployed AI is BYOK-only.** A hosted user must supply their own Anthropic / Gemini / OpenAI / Qwen / DeepSeek key. Preview and production never fall back to an operator model account. Server model credentials are allowed only for local `next dev` testing.

4. **Token budgets enforced.** Per-user daily budget; when exhausted, drop to Tier 1 (local) or Tier 0 (rules) — never block the user, never silently overspend their key.

5. **Same UX shape across tiers.** The card grid renders identically. The digest appears or hides. The audio button enables or disables. Tier shifts feel like quality changes, not feature toggles.

---

## Where Peer is on the tier ladder today

- **Tier 0:** Working and the deployed default. Card grid, scoring, dedupe, search, and deterministic reports need no model key.
- **Tier 1:** Working as local/deterministic heuristic reranking; optional user-owned search connectors can broaden discovery.
- **Tier 2:** Working through user BYOK for Anthropic, Gemini, OpenAI, Qwen, and DeepSeek.
- **Local developer provider:** Vertex and other server env credentials work only under local `next dev`; deployed builds reject them.
