import {BUNDLED_PRICING} from './price-catalog.mjs';
// Rates and model-specific multipliers are data, not inferred from model names.
export const PRICE_DATE = BUNDLED_PRICING.verifiedAt;
export function quotaOptions(options = {}) {
  return { includeAstraLongContext: options.includeAstraLongContext === true, normalizeFast: options.normalizeFast !== false };
}
// Components stay independent so display switches can recalculate without
// rereading logs or changing the separately reported API replacement cost.
export function quotaAmount(usage, options) {
  const { includeAstraLongContext: astra, normalizeFast: fast } = quotaOptions(options);
  const base = usage.quotaBaseUsd ?? usage.ordinaryQuotaUsd ?? usage.usd;
  const astraUsd = astra ? usage.astraPremiumUsd ?? 0 : 0;
  const speedUsd = fast ? (usage.quotaFastPremiumUsd ?? 0) + (astra ? usage.astraFastPremiumUsd ?? 0 : 0) : 0;
  const unknownSpeedUsd = fast ? (usage.unknownSpeedPremiumUsd ?? 0) + (astra ? usage.astraUnknownSpeedPremiumUsd ?? 0 : 0) : 0;
  return { ordinaryQuotaUsd: base == null ? null : base + astraUsd + speedUsd, astraAppliedUsd: astraUsd, speedNormalizationUsd: speedUsd, unknownSpeedUsd };
}
// Published ChatGPT credit-consumption factors, distinct from API Fast prices.
// This is a normalization assumption for included usage, not an official USD cap.
// https://learn.chatgpt.com/docs/agent-configuration/speed
export function subscriptionSpeedFactor(model, tier, catalog=BUNDLED_PRICING) {
  if (!['fast', 'priority'].includes(tier)) return 1;
  return catalog.models[model]?.includedFastMultiplier??null;
}
export const PRICES=Object.fromEntries(Object.entries(BUNDLED_PRICING.models).map(([id,rule])=>[id,[...rule.rates,rule.longContext[0]]]));
export function priceUsage(record,catalog=BUNDLED_PRICING) {
  const { input, cached, writes, output, model, tier } = record;
  if (![input, cached, writes, output].every(n => Number.isFinite(n) && n >= 0) || cached + writes > input) return null;
  const rule=catalog.models[model],rate=rule?.rates;
  if (!rate || (writes > 0 && rate[2] == null)) return null;
  if (tier && !['default', 'standard', 'priority', 'fast'].includes(tier)) return null;
  const fast = ['priority', 'fast'].includes(tier);
  if (fast && rule.apiFastMultiplier==null) return null;
  const long = input > rule.longContext[0], multiplier = fast ? rule.apiFastMultiplier : 1;
  const inputUsd = ((input - cached - writes) * rate[0] + cached * rate[1] + writes * (rate[2] ?? 0)) / 1e6;
  const outputUsd = output * rate[3] / 1e6;
  const standardUsd = inputUsd + outputUsd;
  const withLong = inputUsd * (long ? rule.longContext[1] : 1) + outputUsd * (long ? rule.longContext[2] : 1);
  const consumptionFactor = subscriptionSpeedFactor(model, tier,catalog);
  // Codex has no separate cache-write surcharge. The Astra long-context
  // exception is documented separately from API pricing:
  // https://help.openai.com/en/articles/20001415
  const quotaInput = ((input - cached) * rate[0] + cached * rate[1]) / 1e6;
  const quotaStandard = quotaInput + outputUsd;
  const quotaLong = long ? quotaInput * (rule.longContext[1]-1) + outputUsd * (rule.longContext[2]-1) : 0;
  const astraPremiumUsd = rule.optionalLongContext ? quotaLong : 0;
  const quotaBaseUsd = quotaStandard + (rule.optionalLongContext ? 0 : quotaLong);
  const quotaFastPremiumUsd = consumptionFactor == null ? null : quotaBaseUsd * (consumptionFactor - 1);
  const astraFastPremiumUsd = consumptionFactor == null ? null : astraPremiumUsd * (consumptionFactor - 1);
  const unknownFactor = !tier ? Math.max(0, (subscriptionSpeedFactor(model, 'fast',catalog) ?? 1) - 1) : 0;
  return { usd: withLong * multiplier, standardUsd, longContextPremiumUsd: withLong - standardUsd, fastPremiumUsd: withLong * (multiplier - 1),
    standardModeUsd: withLong, ordinaryQuotaUsd: consumptionFactor == null ? null : quotaBaseUsd * consumptionFactor,
    speedNormalizationUsd: quotaFastPremiumUsd, quotaBaseUsd, astraPremiumUsd, quotaFastPremiumUsd, astraFastPremiumUsd,
    unknownSpeedPremiumUsd: quotaBaseUsd * unknownFactor, astraUnknownSpeedPremiumUsd: astraPremiumUsd * unknownFactor,
    assumedTier: !tier, long, fast };
}
