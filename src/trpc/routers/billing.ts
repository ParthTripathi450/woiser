import { TRPCError } from "@trpc/server";
import { polar } from "@/lib/polar";
import { billingEnabled, getBillingStatus } from "@/lib/billing";
import { env } from "@/lib/env";
import { createTRPCRouter, orgProcedure } from "../init";

function requirePolar() {
  if (!billingEnabled || !polar || !env.POLAR_PRODUCT_ID) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "BILLING_DISABLED",
    });
  }
  return polar;
}

export const billingRouter = createTRPCRouter({
  createCheckout: orgProcedure.mutation(async ({ ctx }) => {
    const client = requirePolar();

    const result = await client.checkouts.create({
      products: [env.POLAR_PRODUCT_ID!],
      externalCustomerId: ctx.orgId,
      successUrl: env.APP_URL,
    });

    if (!result.url) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create checkout session",
      });
    }

    return { checkoutUrl: result.url };
  }),

  createPortalSession: orgProcedure.mutation(async ({ ctx }) => {
    const client = requirePolar();

    const result = await client.customerSessions.create({
      externalCustomerId: ctx.orgId,
    });

    if (!result.customerPortalUrl) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create customer portal session",
      });
    }

    return { portalUrl: result.customerPortalUrl };
  }),

  getStatus: orgProcedure.query(async ({ ctx }) => {
    return {
      ...(await getBillingStatus(ctx.orgId)),
      billingEnabled,
    };
  }),
});
