import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { hasActiveSubscription, recordUsage, METERS } from "@/lib/billing";
import { generateSpeech } from "@/lib/tts";
import { prisma } from "@/lib/db";
import { uploadAudio, getSignedAudioUrl } from "@/lib/storage";
import { TEXT_MAX_LENGTH } from "@/features/text-to-speech/data/constants";
import { createTRPCRouter, orgProcedure } from "../init";

export const generationsRouter = createTRPCRouter({
  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const generation = await prisma.generation.findUnique({
        where: { id: input.id, orgId: ctx.orgId },
        omit: {
          orgId: true,
          objectKey: true,
        },
      });

      if (!generation) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return {
        ...generation,
        audioUrl: `/api/audio/${generation.id}`,
      };
    }),

  getAll: orgProcedure.query(async ({ ctx }) => {
    const generations = await prisma.generation.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      omit: {
        orgId: true,
        objectKey: true,
      },
    });

    return generations;
  }),

  create: orgProcedure
    .input(
      z.object({
        text: z.string().min(1).max(TEXT_MAX_LENGTH),
        voiceId: z.string().min(1),
        temperature: z.number().min(0).max(2).default(0.8),
        exaggeration: z.number().min(0.25).max(2).default(0.5),
        cfgWeight: z.number().min(0).max(1).default(0.5),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // No-op while billing is gated off.
      if (!(await hasActiveSubscription(ctx.orgId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "SUBSCRIPTION_REQUIRED",
        });
      }

      const voice = await prisma.voice.findUnique({
        where: {
          id: input.voiceId,
          OR: [
            { variant: "SYSTEM" },
            { variant: "CUSTOM", orgId: ctx.orgId, }
          ],
        },
        select: {
          id: true,
          name: true,
          objectKey: true,
        },
      });

      if (!voice) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Voice not found",
        });
      }

      if (!voice.objectKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Voice audio not available",
        });
      }

      Sentry.logger.info("Generation started", {
        orgId: ctx.orgId,
        voiceId: input.voiceId,
        textLength: input.text.length,
      });

      // The Space fetches the reference clip itself, so hand it a short-lived
      // presigned URL rather than shipping the bytes through this process.
      const voiceUrl = await getSignedAudioUrl(voice.objectKey, 600);

      let buffer: Buffer;
      try {
        buffer = await generateSpeech({
          text: input.text,
          voiceUrl,
          temperature: input.temperature,
          exaggeration: input.exaggeration,
          cfgWeight: input.cfgWeight,
        });
      } catch (error) {
        Sentry.captureException(error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate audio",
        });
      }

      let generationId: string | null = null;
      let objectKey: string | null = null;

      try {
        const generation = await prisma.generation.create({
          data: {
            orgId: ctx.orgId,
            text: input.text,
            voiceName: voice.name,
            voiceId: voice.id,
            temperature: input.temperature,
            exaggeration: input.exaggeration,
            cfgWeight: input.cfgWeight,
          },
          select: {
            id: true,
          },
        });

        generationId = generation.id;
        objectKey = `generations/orgs/${ctx.orgId}/${generation.id}`;

        await uploadAudio({ buffer, key: objectKey });

        await prisma.generation.update({
          where: {
            id: generation.id,
          },
          data: {
            objectKey,
          },
        });

        Sentry.logger.info("Audio generated", {
          orgId: ctx.orgId,
          generationId: generation.id,
        });
      } catch {
        if (generationId) {
          await prisma.generation
            .delete({
              where: {
                id: generationId,
              },
            })
            .catch(() => {});
        }

        Sentry.logger.error("Generation failed", {
          orgId: ctx.orgId,
          voiceId: input.voiceId,
        });

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to store generated audio",
        });
      }

      recordUsage(ctx.orgId, METERS.ttsGeneration, {
        [METERS.ttsProperty]: input.text.length,
      });

      return {
        id: generationId,
      };
    }),
});
