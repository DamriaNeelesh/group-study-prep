"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getLectureApiBaseUrl } from "@/lib/lectureConfig";

export interface RoomState {
    hostId: string | null;
    videoId: string | null;
    isPlaying: boolean;
    timeSec: number;
    playbackRate: number;
    speakers: string[];
    memberCount: number;
    handQueue: string[];
}

export interface ChatMessage {
    userId: string;
    displayName: string;
    message: string;
    timestamp: number;
}

export function useLectureSocket(roomId: string | null) {
    const socketRef = useRef<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    const socketUrl = useMemo(() => getLectureApiBaseUrl(), []);
    const configError = socketUrl
        ? null
        : "Lecture API URL is missing or points to localhost. Set NEXT_PUBLIC_LECTURE_API_URL on Vercel to your deployed lecture-server URL and redeploy.";

    const [connectionError, setConnectionError] = useState<string | null>(configError);
    const [roomState, setRoomState] = useState<RoomState | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [handQueue, setHandQueue] = useState<string[]>([]);
    const [myRole, setMyRole] = useState<"host" | "speaker" | "audience">("audience");

    // Get auth token
    const getToken = useCallback(async () => {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase?.auth.getSession() ?? { data: null };
        return data?.session?.access_token || null;
    }, []);

    useEffect(() => {
        if (!roomId) return;
        if (!socketUrl) return;

        const socket = io(socketUrl, {
            transports: ["websocket", "polling"],
            withCredentials: true,
        });

        socketRef.current = socket;

        socket.on("connect", async () => {
            console.log("[Socket] Connected");
            setIsConnected(true);
            setConnectionError(null);

            const token = await getToken();
            if (token) {
                socket.emit("room:join", { roomId, token });
            }
        });

        socket.on("connect_error", (err) => {
            setConnectionError(err?.message || "Socket connection failed");
            setIsConnected(false);
        });

        socket.on("disconnect", () => {
            console.log("[Socket] Disconnected");
            setIsConnected(false);
        });

        socket.on("room:state", (state: RoomState) => {
            console.log("[Socket] room:state", state);
            setRoomState(state);
            setHandQueue(state.handQueue);
        });

        socket.on("chat:message", (msg: ChatMessage) => {
            setMessages((prev) => [...prev, msg]);
        });

        socket.on("hand:queue", ({ queue }: { queue: string[] }) => {
            setHandQueue(queue);
        });

        socket.on("role:updated", async ({ userId, newRole }: { userId: string; newRole: string }) => {
            const supabase = getSupabaseBrowserClient();
            const { data } = await supabase?.auth.getUser() ?? { data: null };
            if (data?.user?.id === userId) {
                setMyRole(newRole as "host" | "speaker" | "audience");
            }
        });

        socket.on("youtube:loaded", ({ videoId }: { videoId: string }) => {
            setRoomState((prev) => prev ? { ...prev, videoId, timeSec: 0, isPlaying: false } : prev);
        });

        socket.on("youtube:played", ({ timeSec }: { timeSec: number }) => {
            setRoomState((prev) => prev ? { ...prev, isPlaying: true, timeSec } : prev);
        });

        socket.on("youtube:paused", ({ timeSec }: { timeSec: number }) => {
            setRoomState((prev) => prev ? { ...prev, isPlaying: false, timeSec } : prev);
        });

        socket.on("youtube:seeked", ({ timeSec }: { timeSec: number }) => {
            setRoomState((prev) => prev ? { ...prev, timeSec } : prev);
        });

        socket.on("youtube:rateChanged", ({ rate }: { rate: number }) => {
            setRoomState((prev) => prev ? { ...prev, playbackRate: rate } : prev);
        });

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [roomId, socketUrl, getToken]);

    // Actions
    const sendChat = useCallback(async (message: string) => {
        const token = await getToken();
        socketRef.current?.emit("chat:send", { roomId, message, token });
    }, [roomId, getToken]);

    const raiseHand = useCallback(() => {
        socketRef.current?.emit("hand:raise", { roomId });
    }, [roomId]);

    const lowerHand = useCallback(() => {
        socketRef.current?.emit("hand:lower", { roomId });
    }, [roomId]);

    const youtubeLoad = useCallback(async (videoId: string) => {
        const token = await getToken();
        socketRef.current?.emit("youtube:load", { roomId, videoId, token });
    }, [roomId, getToken]);

    const youtubePlay = useCallback(async (timeSec: number) => {
        const token = await getToken();
        socketRef.current?.emit("youtube:play", { roomId, timeSec, token });
    }, [roomId, getToken]);

    const youtubePause = useCallback(async (timeSec: number) => {
        const token = await getToken();
        socketRef.current?.emit("youtube:pause", { roomId, timeSec, token });
    }, [roomId, getToken]);

    const youtubeSeek = useCallback(async (timeSec: number) => {
        const token = await getToken();
        socketRef.current?.emit("youtube:seek", { roomId, timeSec, token });
    }, [roomId, getToken]);

    const youtubeRate = useCallback(async (rate: number) => {
        const token = await getToken();
        socketRef.current?.emit("youtube:rate", { roomId, rate, token });
    }, [roomId, getToken]);

    return {
        isConnected,
        connectionError,
        roomState,
        messages,
        handQueue,
        myRole,
        setMyRole,
        sendChat,
        raiseHand,
        lowerHand,
        youtubeLoad,
        youtubePlay,
        youtubePause,
        youtubeSeek,
        youtubeRate,
    };
}
