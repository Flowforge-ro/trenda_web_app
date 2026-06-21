// backend/src/modules/analytics/analytics.config.ts
// Conservative, hard-coded calibration. Under-promise on savings.
export const ANALYTICS_CONFIG = {
  minutesPerEmailSent: 3,
  minutesPerReplyParsed: 4,
  hourlyRateRon: 35,
  usdToRon: 4.6,
} as const;
