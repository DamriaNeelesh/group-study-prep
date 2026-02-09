"use client";

import { useParams } from "next/navigation";
import { LectureRoom } from "@/components/LectureRoom";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";

export default function LectureRoomPage() {
    const params = useParams();
    const roomId = params?.id as string | undefined;
    const auth = useSupabaseAuth();

    if (!roomId) {
        return (
            <div className="flex h-screen items-center justify-center bg-black">
                <div className="text-white text-xl">Invalid room ID</div>
            </div>
        );
    }

    if (auth.error) {
        return (
            <div className="flex h-screen items-center justify-center bg-black">
                <div className="text-red-500 text-xl">{auth.error}</div>
            </div>
        );
    }

    // Ensure every lecture link works in a fresh browser (guests auto-sign-in).
    if (auth.isLoading || !auth.user) {
        return (
            <div className="flex h-screen items-center justify-center bg-black">
                <div className="text-white text-xl">Signing you in...</div>
            </div>
        );
    }

    return <LectureRoom roomId={roomId} />;
}
