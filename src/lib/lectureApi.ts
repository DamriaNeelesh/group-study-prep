import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getLectureApiBaseUrl, getLectureApiBaseUrlOrThrow } from "@/lib/lectureConfig";

async function fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    const base = getLectureApiBaseUrlOrThrow();

    let res: Response;
    try {
        res = await fetch(`${base}${path}`, init);
    } catch {
        throw new Error(
            `Cannot reach Lecture API at ${base}. ` +
            "If you're on Vercel, set NEXT_PUBLIC_LECTURE_API_URL to your Render URL and redeploy. " +
            "If you're local, ensure the lecture-server is running."
        );
    }

    const text = await res.text();
    const json = (() => {
        try {
            return text ? JSON.parse(text) : null;
        } catch {
            return null;
        }
    })();

    if (!res.ok) {
        const msg =
            json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
                ? (json as { error: string }).error
                : `Request failed (${res.status})`;
        throw new Error(msg);
    }

    return (json as T) ?? ({} as T);
}

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
        // Extra guard to make misconfig obvious (common on Vercel).
        const base = getLectureApiBaseUrl();
        if (!base) {
            throw new Error(
                "Lecture API URL is missing or points to localhost. " +
                "Set NEXT_PUBLIC_LECTURE_API_URL on Vercel to your Render lecture-server URL and redeploy."
            );
        }

        return fetchJson<RoomState>("/api/rooms/create", {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ roomId, initialVideoId }),
        });
    },

    async joinRoom(roomId: string): Promise<RoomState> {
        return fetchJson<RoomState>(`/api/rooms/${roomId}/join`, {
            method: "POST",
            headers: await getAuthHeaders(),
        });
    },

    async getLiveKitToken(roomId: string): Promise<LiveKitTokenResponse> {
        return fetchJson<LiveKitTokenResponse>("/api/livekit/token", {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ roomId }),
        });
    },

    async promoteUser(roomId: string, targetUserId: string): Promise<void> {
        await fetchJson("/api/livekit/promote", {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ roomId, targetUserId }),
        });
    },

    async demoteUser(roomId: string, targetUserId: string): Promise<void> {
        await fetchJson("/api/livekit/demote", {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ roomId, targetUserId }),
        });
    },
};
