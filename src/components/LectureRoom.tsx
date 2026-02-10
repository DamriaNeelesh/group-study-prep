"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import {
    LiveKitRoom,
    RoomAudioRenderer,
    useTracks,
    ParticipantTile,
    TrackToggle,
    DisconnectButton,
    useLocalParticipant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";

import { useLectureSocket } from "@/hooks/useLectureSocket";
import { lectureApi } from "@/lib/lectureApi";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Toast } from "@/components/Toast";

interface LectureRoomProps {
    roomId: string;
}

type WindowWithYT = Window & {
    YT?: typeof YT;
};

function shortId(id: string) {
    const trimmed = id.trim();
    if (trimmed.length <= 14) return trimmed;
    return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

export function LectureRoom({ roomId }: LectureRoomProps) {
    const [livekitToken, setLivekitToken] = useState<string | null>(null);
    const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [showNameModal, setShowNameModal] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    // Socket.IO connection
    const {
        isConnected,
        roomState,
        messages,
        handQueue,
        myRole,
        setMyRole,
        sendChat,
        raiseHand,
        youtubeLoad,
        youtubePlay,
        youtubePause,
        youtubeSeek,
        youtubeRate,
    } = useLectureSocket(roomId);

    const role = myRole;
    const canPublish = role === "host" || role === "speaker";

    const roomLink = useMemo(() => {
        if (typeof window === "undefined") return `/lecture/${roomId}`;
        return `${window.location.origin}/lecture/${roomId}`;
    }, [roomId]);

    async function copy(text: string, okMessage: string) {
        try {
            await navigator.clipboard?.writeText(text);
            setToast(okMessage);
        } catch {
            setToast("Copy failed");
        }
    }

    async function shareRoom() {
        try {
            if (navigator.share) {
                await navigator.share({ title: "Lecture Room", url: roomLink });
                return;
            }
        } catch {
            // ignore
        }
        await copy(roomLink, "Room link copied");
    }

    // Join room and get LiveKit token
    useEffect(() => {
        if (!roomId) return;

        const supabase = getSupabaseBrowserClient();

        async function init() {
            try {
                setLoading(true);
                setError(null);

                // 1. Check Auth & Profile
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) {
                    // Anonymous or not logged in? 
                    // If we allow anon, they have a user object still? 
                    // Supabase anon auth gives a user.
                    // If not, maybe redirect? Assuming middleware handles it or we rely on anon.
                }

                if (user) {
                    setUserId(user.id);
                    const { data: profile } = await supabase
                        .from("profiles")
                        .select("display_name")
                        .eq("id", user.id)
                        .single();

                    if (!profile?.display_name) {
                        setLoading(false);
                        setShowNameModal(true);
                        return; // Wait for name
                    }
                }

                await joinRoomSequence();

            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to join room");
                setLoading(false);
            }
        }

        init();
    }, [roomId, setMyRole]);

    async function joinRoomSequence() {
        try {
            setLoading(true);
            // Join room
            const joined = await lectureApi.joinRoom(roomId);
            setMyRole(joined.role);

            // Get LiveKit token
            const lkToken = await lectureApi.getLiveKitToken(roomId);
            setLivekitToken(lkToken.token);
            setLivekitUrl(lkToken.livekitUrl);
            setMyRole(lkToken.role);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to join room");
        } finally {
            setLoading(false);
        }
    }

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
                <div className="flex min-w-0 items-center gap-3">
                    <h1 className="text-lg font-bold text-white">Lecture Room</h1>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${role === "host" ? "bg-purple-500/20 text-purple-400" :
                        role === "speaker" ? "bg-green-500/20 text-green-400" :
                            "bg-gray-500/20 text-gray-400"
                        }`}>
                        {role.toUpperCase()}
                    </span>
                    <span className="hidden sm:inline font-mono text-xs font-bold text-white/60">
                        {shortId(roomId)}
                    </span>
                </div>

                <div className="flex items-center gap-2 text-sm text-white/60">
                    <button
                        onClick={() => void shareRoom()}
                        className="inline-flex rounded-md bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15"
                        title="Invite (share room link)"
                    >
                        Invite
                    </button>
                    <button
                        onClick={() => void copy(roomLink, "Room link copied")}
                        className="hidden sm:inline-flex rounded-md bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15"
                        title="Copy room link"
                    >
                        Copy Link
                    </button>
                    <button
                        onClick={() => void copy(roomId, "Room ID copied")}
                        className="hidden sm:inline-flex rounded-md bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15"
                        title="Copy room ID"
                    >
                        Copy ID
                    </button>

                    <span className="hidden sm:inline text-white/30">|</span>
                    <span>{roomState?.memberCount || 0} members</span>
                    {isConnected ? (
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                    ) : (
                        <span className="h-2 w-2 rounded-full bg-red-500" />
                    )}
                </div>
            </header>



            {/* Main content */}
            <div className="flex flex-1 flex-col lg:flex-row overflow-hidden">
                {/* Left: Video player */}
                <div className="flex-1 p-0 lg:p-0 min-h-[30vh] lg:min-h-0 bg-black flex flex-col justify-center">
                    <YouTubePlayer
                        videoId={roomState?.videoId || null}
                        isPlaying={roomState?.isPlaying || false}
                        timeSec={roomState?.timeSec || 0}
                        playbackRate={roomState?.playbackRate || 1}
                        isHost={role === "host"}
                        onPlay={youtubePlay}
                        onPause={youtubePause}
                        onSeek={youtubeSeek}
                        onRate={youtubeRate}
                        onLoad={youtubeLoad}
                    />
                </div>

                {/* Right: Stage + Chat */}
                <div className="flex w-full lg:w-80 flex-col border-t lg:border-t-0 lg:border-l border-white/10 bg-black/30 h-[60vh] lg:h-auto">
                    {/* Stage Grid (LiveKit) */}
                    <div className="flex-1 overflow-hidden min-h-0">
                        <LiveKitRoom
                            serverUrl={livekitUrl}
                            token={livekitToken}
                            connect={true}
                            // Don't prompt for camera/mic on page load. Users opt-in via the toggles below.
                            audio={false}
                            video={false}
                            onDisconnected={() => console.log("[LiveKit] Disconnected")}
                        >
                            <StageGrid
                                isHost={role === "host"}
                                canPublish={canPublish}
                                handQueue={handQueue}
                                onApprove={async (uid) => {
                                    await lectureApi.promoteUser(roomId, uid);
                                }}
                            />
                            <RoomAudioRenderer />
                        </LiveKitRoom>
                    </div>

                    {/* Raise Hand / Controls */}
                    <div className="border-t border-white/10 p-3 shrink-0">
                        {role === "audience" && (
                            <button
                                onClick={() => raiseHand()}
                                className="w-full rounded-lg bg-yellow-500/20 px-4 py-2 text-sm font-bold text-yellow-400 hover:bg-yellow-500/30"
                            >
                                Raise Hand
                            </button>
                        )}
                        {(role === "speaker" || role === "host") && canPublish && (
                            <div className="text-center text-sm text-white/60">
                                You can turn on your camera/mic
                            </div>
                        )}
                    </div>

                    {/* Chat */}
                    <div className="h-48 lg:h-auto lg:flex-1 min-h-[12rem] shrink-0 border-t border-white/10">
                        <ChatPanel
                            messages={messages}
                            onSend={sendChat}
                        />
                    </div>
                </div>
            </div>

            {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}

            {
                showNameModal && userId && (
                    <GuestNameModal
                        userId={userId}
                        onSubmit={async () => {
                            setShowNameModal(false);
                            await joinRoomSequence();
                        }}
                    />
                )
            }
        </div >
    );
}

// ============ GUEST NAME MODAL ============
interface GuestNameModalProps {
    userId: string;
    onSubmit: (name: string) => void;
}

function GuestNameModal({ userId, onSubmit }: GuestNameModalProps) {
    const [name, setName] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        setSubmitting(true);
        try {
            const { error } = await getSupabaseBrowserClient()
                .from("profiles")
                .upsert({ id: userId, display_name: name.trim() }, { onConflict: "id" });

            if (error) throw error;
            onSubmit(name.trim());
        } catch (err) {
            console.error("Failed to save name", err);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-xl bg-[#1a1a1f] border border-white/10 p-6 shadow-2xl">
                <h2 className="text-xl font-bold text-white mb-2">Welcome!</h2>
                <p className="text-white/60 mb-6 text-sm">
                    Please enter your name to join the study room.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-white/40 uppercase mb-1">
                            Display Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full rounded-lg bg-black/50 border border-white/10 px-4 py-3 text-white placeholder:text-white/20 focus:border-purple-500 focus:outline-none"
                            placeholder="e.g. Alex Smith"
                            autoFocus
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={!name.trim() || submitting}
                        className="w-full rounded-lg bg-purple-600 py-3 font-bold text-white transition-colors hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? "Joining..." : "Join Room"}
                    </button>
                </form>
            </div>
        </div>
    );
}

// ============ STAGE GRID ============
function StageGrid({
    isHost,
    canPublish,
    handQueue,
    onApprove,
}: {
    isHost: boolean;
    canPublish: boolean;
    handQueue: string[];
    onApprove: (userId: string) => void;
}) {
    const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
        onlySubscribed: false,
    });

    // Only show participants who are allowed to publish (host/speakers).
    // Include local participant if they can publish, even before they turn on video.
    const stageTracks = cameraTracks
        .filter(
            (t) =>
                Boolean(t.participant.permissions?.canPublish) ||
                (t.participant.isLocal && canPublish),
        )
        .slice(0, 7);

    return (
        <div className="flex h-full flex-col">
            <div className="border-b border-white/10 px-3 py-2">
                <h3 className="text-sm font-bold text-white">Stage ({stageTracks.length})</h3>
            </div>

            {/* Video Grid */}
            <div className="flex-1 overflow-auto p-2">
                {stageTracks.length === 0 ? (
                    <div className="flex h-full items-center justify-center rounded-lg border border-white/10 bg-black/20 p-3 text-center text-xs font-semibold text-white/60">
                        No one is on stage yet.
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {stageTracks.map((trackRef) => {
                            const key =
                                "publication" in trackRef && trackRef.publication
                                    ? `${trackRef.participant.identity}:${trackRef.publication.trackSid}`
                                    : `${trackRef.participant.identity}:${trackRef.source}:placeholder`;
                            return (
                                <ParticipantTile
                                    key={key}
                                    trackRef={trackRef}
                                    className="aspect-video overflow-hidden rounded-lg bg-black"
                                />
                            );
                        })}
                    </div>
                )}

                {/* Controls for local participant */}
                {canPublish ? (
                    <LocalControls />
                ) : (
                    <div className="mt-3 text-center text-[11px] font-semibold text-white/50">
                        Audience can&apos;t publish camera/mic. Raise your hand to request speaker.
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
    onRate,
    onLoad,
}: {
    videoId: string | null;
    isPlaying: boolean;
    timeSec: number;
    playbackRate: number;
    isHost: boolean;
    onPlay: (t: number) => void | Promise<void>;
    onPause: (t: number) => void | Promise<void>;
    onSeek: (t: number) => void | Promise<void>;
    onRate: (r: number) => void | Promise<void>;
    onLoad: (v: string) => void | Promise<void>;
}) {
    const playerRef = useRef<YT.Player | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [inputVideoId, setInputVideoId] = useState("");
    const [isBuffering, setIsBuffering] = useState(false);
    const [isPlayerReady, setIsPlayerReady] = useState(false);
    const suppressEmit = useRef(false);
    const latestRef = useRef({ isPlaying, timeSec, playbackRate });
    const callbacksRef = useRef({ onPlay, onPause, onSeek, onRate });
    const isHostRef = useRef(isHost);
    const lastTimeRef = useRef(0);
    const lastSeekEmitMsRef = useRef(0);
    const lastRateEmitMsRef = useRef(0);
    const playerStateRef = useRef<number | null>(null);

    useEffect(() => {
        latestRef.current = { isPlaying, timeSec, playbackRate };
    }, [isPlaying, timeSec, playbackRate]);

    useEffect(() => {
        callbacksRef.current = { onPlay, onPause, onSeek, onRate };
    }, [onPlay, onPause, onSeek, onRate]);

    useEffect(() => {
        isHostRef.current = isHost;
    }, [isHost]);

    // Load YouTube IFrame API
    useEffect(() => {
        if (typeof window === "undefined") return;
        const w = window as WindowWithYT;
        if (w.YT) return;

        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
    }, []);

    // Create player when videoId changes
    useEffect(() => {
        if (!videoId || !containerRef.current) return;
        const w = window as WindowWithYT;
        if (typeof w.YT === "undefined") {
            // Wait for API
            const interval = setInterval(() => {
                if (w.YT?.Player) {
                    clearInterval(interval);
                    createPlayer();
                }
            }, 100);
            return () => clearInterval(interval);
        } else {
            createPlayer();
        }

        function createPlayer() {
            const yt = w.YT;
            if (!yt?.Player) return;
            const el = containerRef.current;
            if (!el) return;
            const vid = videoId;
            if (!vid) return;
            if (playerRef.current) {
                playerRef.current.destroy();
            }

            playerRef.current = new yt.Player(el, {
                videoId: vid,
                playerVars: {
                    autoplay: 0,
                    controls: 1, // Allow everyone to control playback
                    modestbranding: 1,
                    rel: 0,
                },
                events: {
                    onReady: (e: YT.PlayerEvent) => {
                        setIsPlayerReady(true);
                        const latest = latestRef.current;

                        // Avoid echoing initial setup back into the room sync.
                        suppressEmit.current = true;

                        try {
                            e.target.setPlaybackRate(latest.playbackRate);
                        } catch {
                            // ignore
                        }
                        try {
                            e.target.seekTo(latest.timeSec, true);
                        } catch {
                            // ignore
                        }

                        if (latest.isPlaying) {
                            e.target.playVideo();
                        } else {
                            e.target.pauseVideo();
                        }

                        lastTimeRef.current = latest.timeSec;
                    },
                    onStateChange: (e: YT.OnStateChangeEvent) => {
                        const state = e.data;
                        playerStateRef.current = state;
                        setIsBuffering(state === 3); // 3 = Buffering

                        // Ignore unstarted (-1) or cued (5) for events
                        const currentTime = e.target.getCurrentTime();
                        if (suppressEmit.current) {
                            suppressEmit.current = false;
                            lastTimeRef.current = currentTime;
                            return;
                        }

                        if (state === 1) { // Playing
                            lastTimeRef.current = currentTime;
                            void callbacksRef.current.onPlay(currentTime);
                            return;
                        }
                        if (state === 2) { // Paused
                            lastTimeRef.current = currentTime;
                            void callbacksRef.current.onPause(currentTime);
                            return;
                        }

                        // Buffering is a strong signal of a seek/scrub (esp. with native controls).
                        if (state === 3) {
                            const prev = lastTimeRef.current;
                            const delta = Math.abs(currentTime - prev);
                            lastTimeRef.current = currentTime;

                            const now = Date.now();
                            if (delta > 1.25 && now - lastSeekEmitMsRef.current > 800) {
                                lastSeekEmitMsRef.current = now;
                                void callbacksRef.current.onSeek(currentTime);
                            }
                        }
                    },
                    onPlaybackRateChange: (e: YT.OnPlaybackRateChangeEvent) => {
                        const now = Date.now();
                        if (now - lastRateEmitMsRef.current < 600) return;
                        lastRateEmitMsRef.current = now;
                        void callbacksRef.current.onRate(e.data);
                    },
                },
            });
        }
    }, [videoId, isHost]);

    // Some seeks don't reliably trigger BUFFERING across browsers; poll for large jumps.
    useEffect(() => {
        const interval = setInterval(() => {
            const p = playerRef.current;
            if (!p) return;

            const state = playerStateRef.current;
            if (state !== 1 && state !== 2) return;

            const currentTime = p.getCurrentTime();
            const prev = lastTimeRef.current;
            lastTimeRef.current = currentTime;

            const delta = Math.abs(currentTime - prev);
            const threshold = state === 1 ? 3.0 : 1.25;
            const now = Date.now();
            if (delta > threshold && now - lastSeekEmitMsRef.current > 800) {
                lastSeekEmitMsRef.current = now;
                void callbacksRef.current.onSeek(currentTime);
            }
        }, 700);

        return () => clearInterval(interval);
    }, []);

    // Sync playback state for everyone (host included)
    useEffect(() => {
        const player = playerRef.current;
        if (!player || !player.getPlayerState) return;

        // If I am the one interacting, suppressEmit should be handled by the fact that
        // socket events come back. But to be safe, when WE apply a change from Props (Server),
        // we set suppressEmit = true so `onStateChange` triggers don't re-emit.

        // Fix race condition: check if we actually need to change state.
        // If we call pauseVideo() when already paused, onStateChange DOES NOT FIRE,
        // and suppressEmit stays true forever (blocking future events).

        const currentState = player.getPlayerState();
        let didAction = false;

        if (isPlaying) {
            const current = player.getCurrentTime();
            if (Math.abs(current - timeSec) > 1.25) {
                player.seekTo(timeSec, true);
                // seek triggers checking, so correct there.
            }

            // If not playing and not buffering, then play
            if (currentState !== 1 && currentState !== 3) {
                suppressEmit.current = true;
                player.playVideo();
                didAction = true;
            }
        } else {
            // If playing or buffering, then pause
            if (currentState === 1 || currentState === 3) {
                suppressEmit.current = true;
                player.pauseVideo();
                didAction = true;
            }
            // Don't seek repeatedly if paused, unless moved
            const current = player.getCurrentTime();
            if (Math.abs(current - timeSec) > 1.25) {
                player.seekTo(timeSec, true);
            }
        }

        if (player.getPlaybackRate() !== playbackRate) {
            player.setPlaybackRate(playbackRate);
        }

        // If we didn't trigger an action that fires an event, we shouldn't leave
        // suppressEmit on (though strictly we only turn it on IF we do an action).
        // My logic above only sets suppressEmit = true IF we call play/pause.
        // What about Seek? seekTo fires events? Yes.

    }, [isPlaying, timeSec, playbackRate]);
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
            <div className="relative flex-1 rounded-xl bg-black overflow-hidden group">
                {videoId ? (
                    <>
                        <div ref={containerRef} className="absolute inset-0" />
                        {(!isPlayerReady || isBuffering) && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                <div className="flex flex-col items-center gap-2">
                                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-purple-500" />
                                    <span className="text-sm font-medium text-white/80">
                                        {isBuffering ? "Buffering..." : "Loading Video..."}
                                    </span>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex h-full items-center justify-center">
                        <div className="text-white/40 text-center">
                            <div className="text-sm font-semibold">
                                {isHost ? "Load a video to start" : "Waiting for host to load a video..."}
                            </div>
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

// ============ LOCAL CONTROLS ============
function LocalControls() {
    const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

    // Fallback if hook doesn't return flags directly in this version
    const camOn = isCameraEnabled ?? localParticipant?.isCameraEnabled ?? false;
    const micOn = isMicrophoneEnabled ?? localParticipant?.isMicrophoneEnabled ?? false;

    return (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button
                onClick={() => localParticipant?.setCameraEnabled(!camOn)}
                className={`rounded-lg px-4 py-2 text-sm font-bold text-white transition-colors ${camOn ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-700 hover:bg-gray-600"
                    }`}
            >
                {camOn ? "Cam On" : "Cam Off"}
            </button>
            <button
                onClick={() => localParticipant?.setMicrophoneEnabled(!micOn)}
                className={`rounded-lg px-4 py-2 text-sm font-bold text-white transition-colors ${micOn ? "bg-purple-600 hover:bg-purple-700" : "bg-gray-700 hover:bg-gray-600"
                    }`}
            >
                {micOn ? "Mic On" : "Mic Off"}
            </button>
            <DisconnectButton className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 transition-colors">
                Leave
            </DisconnectButton>
        </div>
    );
}
