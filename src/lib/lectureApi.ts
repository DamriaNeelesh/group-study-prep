import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const API_BASE = process.env.NEXT_PUBLIC_LECTURE_API_URL || "http://localhost:4000";

async function getAuthHeaders(): Promise<HeadersInit> {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase?.auth.getSession() ?? { data: null };
    const token = data?.session?.access_token;

    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

export interface RoomState {
    room_id: string;
    role: "host" | "speaker" | "audience";
    host_user_id: string;
    video_id: string | null;
    is_playing: boolean;
    time_sec: number;
    playback_rate: number;
}

export interface LiveKitTokenResponse {
    token: string;
    livekitUrl: string;
    role: "host" | "speaker" | "audience";
    canPublish: boolean;
}

export const lectureApi = {
    async createRoom(roomId?: string, initialVideoId?: string): Promise<RoomState> {
        const res = await fetch(`${API_BASE}/api/rooms/create`, {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ roomId, initialVideoId }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to create room");
        }

        return res.json();
    },

    async joinRoom(roomId: string): Promise<RoomState> {
        const res = await fetch(`${API_BASE}/api/rooms/${roomId}/join`, {
            method: "POST",
            headers: await getAuthHeaders(),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to join room");
        }

        return res.json();
    },

    async getLiveKitToken(roomId: string): Promise<LiveKitTokenResponse> {
        const res = await fetch(`${API_BASE}/api/livekit/token`, {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ roomId }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to get LiveKit token");
        }

        return res.json();
    },

    async promoteUser(roomId: string, targetUserId: string): Promise<void> {
        const res = await fetch(`${API_BASE}/api/livekit/promote`, {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ roomId, targetUserId }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to promote user");
        }
    },

    async demoteUser(roomId: string, targetUserId: string): Promise<void> {
        const res = await fetch(`${API_BASE}/api/livekit/demote`, {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ roomId, targetUserId }),
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Failed to demote user");
        }
    },
};
