import "server-only";
import { env } from "./env";
import { polar } from "./polar";

/**
 * Usage-based billing is opt-in via BILLING_ENABLED. When it is off every gate
 * opens, metering is skipped entirely, and the UI is told the org is in good
 * standing -- the disabled path is a genuine no-op, not a stubbed error.
 */
export const billingEnabled = env.BILLING_ENABLED && polar !== null;

export type BillingStatus = {
  hasActiveSubscription: boolean;
  customerId: string | null;
  estimatedCostCents: number;
};

const UNMETERED: BillingStatus = {
  hasActiveSubscription: true,
  customerId: null,
  estimatedCostCents: 0,
};

export async function getBillingStatus(orgId: string): Promise<BillingStatus> {
  if (!billingEnabled || !polar) return UNMETERED;

  try {
    const state = await polar.customers.getStateExternal({ externalId: orgId });

    let estimatedCostCents = 0;
    for (const sub of state.activeSubscriptions ?? []) {
      for (const meter of sub.meters ?? []) {
        estimatedCostCents += meter.amount ?? 0;
      }
    }

    return {
      hasActiveSubscription: (state.activeSubscriptions ?? []).length > 0,
      customerId: state.id,
      estimatedCostCents,
    };
  } catch {
    // Customer does not exist in Polar yet.
    return { hasActiveSubscription: false, customerId: null, estimatedCostCents: 0 };
  }
}

/** True when the org may consume paid actions. Always true while billing is off. */
export async function hasActiveSubscription(orgId: string): Promise<boolean> {
  if (!billingEnabled) return true;
  return (await getBillingStatus(orgId)).hasActiveSubscription;
}

/** Fire-and-forget usage metering. Never rejects -- metering must not break a request. */
export function recordUsage(
  orgId: string,
  meter: string,
  metadata: Record<string, string | number | boolean> = {},
): void {
  if (!billingEnabled || !polar) return;

  void polar.events
    .ingest({
      events: [
        {
          name: meter,
          externalCustomerId: orgId,
          metadata,
          timestamp: new Date(),
        },
      ],
    })
    .catch(() => {
      // Silently ignore - metering failures must not affect the user.
    });
}

export const METERS = {
  voiceCreation: env.POLAR_METER_VOICE_CREATION,
  ttsGeneration: env.POLAR_METER_TTS_GENERATION,
  ttsProperty: env.POLAR_METER_TTS_PROPERTY,
} as const;
