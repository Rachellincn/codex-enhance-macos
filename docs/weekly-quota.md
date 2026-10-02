# Account quota and equivalent usage

The compact quota view shows the account's remaining percentage, reset countdown, and three estimated amounts. Two persistent switches control the local estimate:

- **Include Astra long-context premium** — off by default. When enabled, requests above 272K input tokens use input/cache ×2 and output ×1.5 in the quota estimate.
- **Normalize Fast to Standard allowance** — on by default. Explicit Fast/priority records use the model's published Codex speed factor. Turning it off counts their Standard-speed value.

These settings do not change Codex's model, context or speed settings. They survive companion restarts and recalculate from cached numeric components immediately. API replacement cost is independent of both switches and stays in the collapsed calculation details.

## Price updates

Model rates and their speed/long-context multipliers come from a validated data catalog, including GPT-6.1 Sol's $0.10/M cached-input rate. The companion checks this project's public price catalog at startup and every six hours; the existing Refresh button also checks it. Missing-model observations trigger an earlier bounded check. Downloads contain no account or usage data, execute no code, and retain the last valid catalog when unavailable.

A newer catalog reprices existing token records at the same quota observation cutoff; it does not re-ingest or double-count old requests. Current-period history stores the catalog date used by that aggregate. Previously archived periods keep their recorded components and date. See [price-catalog maintenance](pricing-updates.md).

## Calculation

The quota basis counts uncached input, cached input and output separately. Cache writes use the ordinary input rate, without the API cache-write surcharge. Astra's long-context premium is optional, following the Codex exception documented in the official rate card. Other supported models retain their applicable long-context rates. Published credit rates and API-dollar references are an estimation basis, not an official fixed subscription dollar cap.

For each request, B is the quota basis without Astra's optional surcharge, L is that surcharge (zero for other models), and q is the published subscription speed factor. The selected cost is B + optional L, multiplied by q only when Fast normalization is enabled and the record explicitly identifies Fast.

Total estimate = selected cost / observed used fraction.
Remaining estimate = max(0, total estimate - selected cost).

GPT-6 / GPT-5.6 Fast uses a 2.5 subscription factor; the API Fast price is separately 2. Unknown speeds use the Standard assumption; only the expanded details show their current-window count and the alternative total if all unknown-speed requests were Fast. The UI does not force a $2000 or any other target capacity.

## Account and period

The existing read-only client integration calls account/rateLimits/read and account/read with refreshToken:false. It neither refreshes credentials nor purchases credits, consumes resets or submits model requests. Refresh is normally every 60 seconds.

The codex bucket is selected from rateLimitsByLimitId with the legacy bucket as fallback. Window starts derive from actual reset times and durations, not calendar weeks. Pro omits a 5-hour window; Plus shows the returned windows. Missing windows are not invented.

Cost, request counts and missing-metadata counts all filter request timestamps from the window start through the quota observation time. Records explicitly attributed to another account are excluded. Unattributed records in this interval remain in the local subtotal and are explained only in expanded details. Old conversation creation time does not exclude new requests made this week. The estimator cannot recover usage absent from this device.

## Local ledger

A worker incrementally reads sessions and archived_sessions and writes only the companion cache. Response-ID records take precedence over UI token_count mirrors in the same thread/turn; distinct response IDs remain distinct. Legacy-only turns, mirrored copies, fork boundaries, third-party providers and append checkpoints are handled separately.

Schema 3 rebuilds the derived cache to store timestamped parse issues. Only matching-period, matching-or-unknown-account issues can block that window's estimate. Old and future errors do not enter current-period warnings. Untimed errors stay separately identifiable in details and are not asserted to belong to the current period. An incomplete file scan still withholds the projection.

Prompts, replies, commands, credentials, raw account IDs and full source paths are not stored in the usage cache. IDs use salted hashes. Source logs are never modified.

Indexing, incomplete current-period records, unknown prices/account identity, no usage, utilization below 3%, and a same-window quota rebound withhold projected totals. Normal presentation has no persistent confidence warning; details carry the evidence and assumptions.

## Weekly history

`quota-history.json` is a companion-owned numeric archive, separate from the disposable usage cache. After each complete weekly aggregate it atomically records the paired quota percentage, observation cutoff, real window boundaries, model totals and independent pricing components. It retains up to 26 periods per salted account key (104 total). Incomplete scans cannot replace a valid historical sample. Unknown accounts are not recorded or displayed as another account's history.

At reset the preceding period becomes ended, preserving its last observed pair. An early change of reset window marks the replaced period as adjusted instead of showing two active weeks. Missing end-of-week samples are explicitly identified; the app does not invent a final percentage, reconstruct past weeks without quota observations, or combine post-cutoff usage with an old percentage. Each record uses its stored pricing date/components. Display switches reproject those components without overwriting the archived evidence. Corrupt archive files are preserved instead of silently replaced.

## Feature verification

Node coverage includes the four switch combinations, independent API pricing, cache-write distinction, unknown-speed alternatives, request deduplication, persistent tails, source immutability, and current/old/future/other-account issue and metadata scope. Native checks cover default migration, settings persistence and the same arithmetic combinations. Preview checks exercise the actual switches and expanded details.

## Sources

- [Codex pricing and token rates](https://learn.chatgpt.com/docs/pricing)
- [Codex speed consumption](https://learn.chatgpt.com/docs/agent-configuration/speed)
- [Official rate card and Astra Codex exception](https://help.openai.com/en/articles/20001415-chatgpt-rate-card-enterprise-token-based-pricing)
- [API pricing](https://developers.openai.com/api/docs/pricing)
- [Astra API long-context rates](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Sub2API layout reference](https://github.com/Wei-Shaw/sub2api/blob/main/frontend/src/components/account/AccountUsageCell.vue)

The official Enterprise rate-card exception informs the default; it is not proof of a particular Pro account's fixed USD entitlement. This is an independent local implementation; no Sub2API gateway or forwarding service is installed.
