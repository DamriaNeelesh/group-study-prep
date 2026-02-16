"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { extractRoomIdFromInput } from "@/lib/roomId";

export default function LectureRoomPage() {
  const params = useParams<{ id?: string | string[] }>();
  const router = useRouter();
  const rawId = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";
  const roomId = extractRoomIdFromInput(rawId) ?? rawId;

  useEffect(() => {
    if (!roomId) return;
    router.replace(`/room/${roomId}`);
  }, [roomId, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--background)]">
      <div className="rounded-full border border-black/10 bg-white/85 px-5 py-3 text-lg font-semibold text-[var(--foreground)] shadow-[0_16px_36px_rgba(17,24,39,0.12)] backdrop-blur-xl">
        Opening room...
      </div>
    </div>
  );
}
