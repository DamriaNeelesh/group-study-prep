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
    <div className="flex h-screen items-center justify-center bg-[#111]">
      <div className="text-lg font-semibold text-white/90">
        Opening room...
      </div>
    </div>
  );
}
