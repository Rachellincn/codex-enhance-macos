// Public API reference prices checked 2026-09-27. USD per million tokens.
// https://developers.openai.com/api/docs/pricing
// Model .md pages document the >272K full-request long-context adjustment.
export const PRICE_DATE = '2026-09-27';
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
export function subscriptionSpeedFactor(model, tier) {
  if (!['fast', 'priority'].includes(tier)) return 1;
  if (/^gpt-(6-(astra|sol|luna)|5\.6-(sol|terra|luna))$/.test(model) || model === 'gpt-5.5') return 2.5;
  if (model === 'gpt-5.4') return 2;
  return null;
}
export const PRICES = {
  'gpt-6-astra': [10, 1, 12.5, 50, 272000],
  'gpt-6-sol': [2, .2, 2.5, 10, 272000],
  'gpt-6-luna': [.1, .01, .125, .5, 272000],
  'gpt-5.6-sol': [4, .4, 5, 20, 272000],
  'gpt-5.6-terra': [2, .2, 2.5, 12, 272000],
  'gpt-5.6-luna': [.2, .02, .25, 1.2, 272000],
  'gpt-5.5': [5, .5, null, 30, 272000],
  'gpt-5.4': [2.5, .25, null, 15, 272000]
};
export function priceUsage(record) {
  const { input, cached, writes, output, model, tier } = record;
  if (![input, cached, writes, output].every(n => Number.isFinite(n) && n >= 0) || cached + writes > input) return null;
  const rate = PRICES[model];
  if (!rate || (writes > 0 && rate[2] == null)) return null;
  if (tier && !['default', 'standard', 'priority', 'fast'].includes(tier)) return null;
  const fast = ['priority', 'fast'].includes(tier);
  // Fast rates are verified for the GPT-6 / GPT-5.6 families only.
  if (fast && !/^gpt-(6-|5\.6-)/.test(model)) return null;
  const long = input > rate[4], multiplier = fast ? 2 : 1;
  const inputUsd = ((input - cached - writes) * rate[0] + cached * rate[1] + writes * (rate[2] ?? 0)) / 1e6;
  const outputUsd = output * rate[3] / 1e6;
  const standardUsd = inputUsd + outputUsd;
  const withLong = inputUsd * (long ? 2 : 1) + outputUsd * (long ? 1.5 : 1);
  const consumptionFactor = subscriptionSpeedFactor(model, tier);
  // Codex has no separate cache-write surcharge. The Astra long-context
  // exception is documented separately from API pricing:
  // https://help.openai.com/en/articles/20001415
  const quotaInput = ((input - cached) * rate[0] + cached * rate[1]) / 1e6;
  const quotaStandard = quotaInput + outputUsd;
  const quotaLong = long ? quotaInput + outputUsd * .5 : 0;
  const astraPremiumUsd = model === 'gpt-6-astra' ? quotaLong : 0;
  const quotaBaseUsd = quotaStandard + (model === 'gpt-6-astra' ? 0 : quotaLong);
  const quotaFastPremiumUsd = consumptionFactor == null ? null : quotaBaseUsd * (consumptionFactor - 1);
  const astraFastPremiumUsd = consumptionFactor == null ? null : astraPremiumUsd * (consumptionFactor - 1);
  const unknownFactor = !tier ? Math.max(0, (subscriptionSpeedFactor(model, 'fast') ?? 1) - 1) : 0;
  return { usd: withLong * multiplier, standardUsd, longContextPremiumUsd: withLong - standardUsd, fastPremiumUsd: withLong * (multiplier - 1),
    standardModeUsd: withLong, ordinaryQuotaUsd: consumptionFactor == null ? null : quotaBaseUsd * consumptionFactor,
    speedNormalizationUsd: quotaFastPremiumUsd, quotaBaseUsd, astraPremiumUsd, quotaFastPremiumUsd, astraFastPremiumUsd,
    unknownSpeedPremiumUsd: quotaBaseUsd * unknownFactor, astraUnknownSpeedPremiumUsd: astraPremiumUsd * unknownFactor,
    assumedTier: !tier, long, fast };
}
