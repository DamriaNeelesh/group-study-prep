"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
    LiveKitRoom,
    VideoConference,
    RoomAudioRenderer,
    useParticipants,
    useLocalParticipant,
    useTracks,
    TrackToggle,
    DisconnectButton,
} from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import "@livekit/components-styles";

import { useLectureSocket } from "@/hooks/useLectureSocket";
import { lectureApi } from "@/lib/lectureApi";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface LectureRoomProps {
    roomId: string;
}

export function LectureRoom({ roomId }: LectureRoomProps) {
    const [userId, setUserId] = useState<string | null>(null);
    const [livekitToken, setLivekitToken] = useState<string | null>(null);
    const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
    const [role, setRole] = useState<"host" | "speaker" | "audience">("audience");
    const [canPublish, setCanPublish] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Socket.IO connection
    const socket = useLectureSocket(roomId);

    // Get current user
    useEffect(() => {
        const supabase = getSupabaseBrowserClient();
        supabase?.auth.getUser().then(({ data }) => {
            if (data?.user) {
                setUserId(data.user.id);
            }
        });
    }, []);

    // Join room and get LiveKit token
    useEffect(() => {
        if (!roomId) return;

        async function init() {
            try {
                setLoading(true);
                setError(null);

                // Join room
                const roomState = await lectureApi.joinRoom(roomId);
                setRole(roomState.role);
                socket.setMyRole(roomState.role);

                // Get LiveKit token
                const lkToken = await lectureApi.getLiveKitToken(roomId);
                setLivekitToken(lkToken.token);
                setLivekitUrl(lkToken.livekitUrl);
                setCanPublish(lkToken.canPublish);
                setRole(lkToken.role);

            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to join room");
            } finally {
                setLoading(false);
            }
        }

        init();
    }, [roomId]);

    // Listen for role updates
    useEffect(() => {
        setRole(socket.myRole);
        setCanPublish(socket.myRole === "host" || socket.myRole === "speaker");
    }, [socket.myRole]);

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-black">
                <div className="text-white text-xl">Joining room...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-screen items-center justify-center bg-black">
                <div className="text-red-500 text-xl">{error}</div>
            </div>
        );
    }

    if (!livekitToken || !livekitUrl) {
        return (
            <div className="flex h-screen items-center justify-center bg-black">
                <div className="text-white text-xl">Connecting to LiveKit...</div>
            </div>
        );
    }

    return (
        <div className="flex h-screen flex-col bg-[#0a0a0f]">
            {/* Header */}
            <header className="flex h-14 items-center justify-between border-b border-white/10 bg-black/50 px-4">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-bold text-white">Lecture Room</h1>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${role === "host" ? "bg-purple-500/20 text-purple-400" :
                        role === "speaker" ? "bg-green-500/20 text-green-400" :
                            "bg-gray-500/20 text-gray-400"
                        }`}>
                        {role.toUpperCase()}
                    </span>
                </div>

                <div className="flex items-center gap-2 text-sm text-white/60">
                    <span>{socket.roomState?.memberCount || 0} members</span>
                    {socket.isConnected ? (
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                    ) : (
                        <span className="h-2 w-2 rounded-full bg-red-500" />
                    )}
                </div>
            </header>

            {/* Main content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left: Video player */}
                <div className="flex-1 p-4">
                    <YouTubePlayer
                        videoId={socket.roomState?.videoId || null}
                        isPlaying={socket.roomState?.isPlaying || false}
                        timeSec={socket.roomState?.timeSec || 0}
                        playbackRate={socket.roomState?.playbackRate || 1}
                        isHost={role === "host"}
                        onPlay={(t) => socket.youtubePlay(t)}
                        onPause={(t) => socket.youtubePause(t)}
                        onSeek={(t) => socket.youtubeSeek(t)}
                        onLoad={(v) => socket.youtubeLoad(v)}
                    />
                </div>

                {/* Right: Stage + Chat */}
                <div className="flex w-80 flex-col border-l border-white/10 bg-black/30">
                    {/* Stage Grid (LiveKit) */}
                    <div className="flex-1 overflow-hidden">
                        <LiveKitRoom
                            serverUrl={livekitUrl}
                            token={livekitToken}
                            connect={true}
                            audio={canPublish}
                            video={canPublish}
                            onDisconnected={() => console.log("[LiveKit] Disconnected")}
                        >
                            <StageGrid
                                isHost={role === "host"}
                                canPublish={canPublish}
                                roomId={roomId}
                                handQueue={socket.handQueue}
                                onApprove={async (uid) => {
                                    await lectureApi.promoteUser(roomId, uid);
                                }}
                            />
                            <RoomAudioRenderer />
                        </LiveKitRoom>
                    </div>

                    {/* Raise Hand / Controls */}
                    <div className="border-t border-white/10 p-3">
                        {role === "audience" && (
                            <button
                                onClick={() => socket.raiseHand()}
                                className="w-full rounded-lg bg-yellow-500/20 px-4 py-2 text-sm font-bold text-yellow-400 hover:bg-yellow-500/30"
                            >
                                ✋ Raise Hand
                            </button>
                        )}
                        {(role === "speaker" || role === "host") && canPublish && (
                            <div className="text-center text-sm text-white/60">
                                You can turn on your camera/mic
                            </div>
                        )}
                    </div>

                    {/* Chat */}
                    <ChatPanel
                        messages={socket.messages}
                        onSend={socket.sendChat}
                    />
                </div>
            </div>
        </div>
    );
}

// ============ STAGE GRID ============
function StageGrid({
    isHost,
    canPublish,
    roomId,
    handQueue,
    onApprove,
}: {
    isHost: boolean;
    canPublish: boolean;
    roomId: string;
    handQueue: string[];
    onApprove: (userId: string) => void;
}) {
    const participants = useParticipants();
    const { localParticipant } = useLocalParticipant();
    const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone]);

    // Filter to only speakers/host (those who can publish)
    const speakers = participants.filter(p =>
        p.permissions?.canPublish || p.identity === localParticipant?.identity
    ).slice(0, 7); // Max 7 on stage (host + 6 speakers)

    return (
        <div className="flex h-full flex-col">
            <div className="border-b border-white/10 px-3 py-2">
                <h3 className="text-sm font-bold text-white">Stage ({speakers.length})</h3>
            </div>

            {/* Video Grid */}
            <div className="flex-1 overflow-auto p-2">
                <div className="grid grid-cols-2 gap-2">
                    {speakers.map((participant: { identity: string }) => (
                        <div key={participant.identity} className="relative aspect-video overflow-hidden rounded-lg bg-black">
                            <VideoConference />
                        </div>
                    ))}
                </div>

                {/* Controls for local participant */}
                {canPublish && localParticipant && (
                    <div className="mt-3 flex justify-center gap-2">
                        <TrackToggle source={Track.Source.Camera} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20" />
                        <TrackToggle source={Track.Source.Microphone} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20" />
                    </div>
                )}
            </div>

            {/* Hand Queue (host only) */}
            {isHost && handQueue.length > 0 && (
                <div className="border-t border-white/10 p-2">
                    <div className="text-xs font-bold text-white/60 mb-2">Raised Hands ({handQueue.length})</div>
                    <div className="flex flex-col gap-1 max-h-24 overflow-auto">
                        {handQueue.map((uid) => (
                            <div key={uid} className="flex items-center justify-between rounded bg-white/5 px-2 py-1">
                                <span className="text-xs text-white/80 truncate">{uid.slice(0, 8)}...</span>
                                <button
                                    onClick={() => onApprove(uid)}
                                    className="rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-400 hover:bg-green-500/30"
                                >
                                    Approve
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ============ YOUTUBE PLAYER ============
function YouTubePlayer({
    videoId,
    isPlaying,
    timeSec,
    playbackRate,
    isHost,
    onPlay,
    onPause,
    onSeek,
    onLoad,
}: {
    videoId: string | null;
    isPlaying: boolean;
    timeSec: number;
    playbackRate: number;
    isHost: boolean;
    onPlay: (t: number) => void;
    onPause: (t: number) => void;
    onSeek: (t: number) => void;
    onLoad: (v: string) => void;
}) {
    const playerRef = useRef<YT.Player | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [inputVideoId, setInputVideoId] = useState("");
    const suppressEmit = useRef(false);

    // Load YouTube IFrame API
    useEffect(() => {
        if (typeof window === "undefined") return;
        if ((window as any).YT) return;

        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
    }, []);

    // Create player when videoId changes
    useEffect(() => {
        if (!videoId || !containerRef.current) return;
        if (typeof (window as any).YT === "undefined") {
            // Wait for API
            const interval = setInterval(() => {
                if ((window as any).YT?.Player) {
                    clearInterval(interval);
                    createPlayer();
                }
            }, 100);
            return () => clearInterval(interval);
        } else {
            createPlayer();
        }

        function createPlayer() {
            if (playerRef.current) {
                playerRef.current.destroy();
            }

            playerRef.current = new (window as any).YT.Player(containerRef.current, {
                videoId,
                playerVars: {
                    autoplay: 0,
                    controls: isHost ? 1 : 0,
                    modestbranding: 1,
                    rel: 0,
                },
                events: {
                    onReady: (e: any) => {
                        e.target.seekTo(timeSec, true);
                        if (isPlaying) e.target.playVideo();
                        e.target.setPlaybackRate(playbackRate);
                    },
                    onStateChange: (e: any) => {
                        if (!isHost) return;
                        if (suppressEmit.current) {
                            suppressEmit.current = false;
                            return;
                        }

                        const state = e.data;
                        const currentTime = e.target.getCurrentTime();

                        if (state === 1) { // Playing
                            onPlay(currentTime);
                        } else if (state === 2) { // Paused
                            onPause(currentTime);
                        }
                    },
                },
            });
        }
    }, [videoId, isHost]);

    // Sync playback state for audience
    useEffect(() => {
        if (!playerRef.current || isHost) return;

        suppressEmit.current = true;

        if (isPlaying) {
            playerRef.current.seekTo(timeSec, true);
            playerRef.current.playVideo();
        } else {
            playerRef.current.pauseVideo();
            playerRef.current.seekTo(timeSec, true);
        }

        playerRef.current.setPlaybackRate(playbackRate);
    }, [isPlaying, timeSec, playbackRate, isHost]);

    return (
        <div className="flex flex-col h-full">
            {/* Video Input (host only) */}
            {isHost && (
                <div className="mb-3 flex gap-2">
                    <input
                        type="text"
                        value={inputVideoId}
                        onChange={(e) => setInputVideoId(e.target.value)}
                        placeholder="YouTube Video ID or URL"
                        className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40"
                    />
                    <button
                        onClick={() => {
                            const id = extractVideoId(inputVideoId);
                            if (id) onLoad(id);
                        }}
                        className="rounded-lg bg-purple-500 px-4 py-2 text-sm font-bold text-white hover:bg-purple-600"
                    >
                        Load
                    </button>
                </div>
            )}

            {/* Player */}
            <div className="relative flex-1 rounded-xl bg-black overflow-hidden">
                {videoId ? (
                    <div ref={containerRef} className="absolute inset-0" />
                ) : (
                    <div className="flex h-full items-center justify-center">
                        <div className="text-white/40 text-center">
                            <div className="text-4xl mb-2">📺</div>
                            <div>{isHost ? "Load a video to start" : "Waiting for host to load a video..."}</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function extractVideoId(input: string): string | null {
    // Already an ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

    // URL formats
    const match = input.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

// ============ CHAT PANEL ============
function ChatPanel({
    messages,
    onSend,
}: {
    messages: { userId: string; displayName: string; message: string; timestamp: number }[];
    onSend: (msg: string) => void;
}) {
    const [input, setInput] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    return (
        <div className="flex h-48 flex-col border-t border-white/10">
            <div className="border-b border-white/10 px-3 py-2">
                <h3 className="text-sm font-bold text-white">Chat</h3>
            </div>

            <div className="flex-1 overflow-auto p-2 space-y-2">
                {messages.map((msg, i) => (
                    <div key={i} className="text-sm">
                        <span className="font-bold text-purple-400">{msg.displayName}: </span>
                        <span className="text-white/80">{msg.message}</span>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-2">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (input.trim()) {
                            onSend(input.trim());
                            setInput("");
                        }
                    }}
                    className="flex gap-2"
                >
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Send a message..."
                        className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40"
                    />
                    <button
                        type="submit"
                        className="rounded-lg bg-purple-500 px-3 py-2 text-sm font-bold text-white hover:bg-purple-600"
                    >
                        Send
                    </button>
                </form>
            </div>
        </div>
    );
}
