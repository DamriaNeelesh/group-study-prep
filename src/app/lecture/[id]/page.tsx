"use client";

import { useParams } from "next/navigation";
import { LectureRoom } from "@/components/LectureRoom";

export default function LectureRoomPage() {
    const params = useParams();
    const roomId = params?.id as string | undefined;

    if (!roomId) {
        return (
            <div className="flex h-screen items-center justify-center bg-black">
                <div className="text-white text-xl">Invalid room ID</div>
            </div>
        );
    }

    return <LectureRoom roomId={roomId} />;
}
