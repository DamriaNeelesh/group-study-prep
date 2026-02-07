import { z } from "zod";

export const roomCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("video:set"), videoId: z.string().min(1).max(32).nullable() }),
  z.object({ type: z.literal("video:play") }),
  z.object({ type: z.literal("video:pause") }),
  z.object({
    type: z.literal("video:seek"),
    positionSeconds: z.number().finite().min(0).max(60 * 60 * 24),
  }),
  z.object({
    type: z.literal("video:rate"),
    playbackRate: z.number().finite().min(0.25).max(2),
  }),
  z.object({ type: z.literal("hand:raise") }),
]);

export type RoomCommand = z.infer<typeof roomCommandSchema>;

export type RoomAction = {
  seq: number;
  execAtMs: number;
  serverNowMs: number;
  command: RoomCommand;
  patch: {
    videoId: string | null;
    playbackState: "playing" | "paused";
    videoTimeAtRef: number;
    referenceTimeMs: number;
    playbackRate: number;
    audienceDelaySeconds: number;
    controllerUserId: string | null;
  };
};

