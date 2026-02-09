import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { Redis } from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";

// ============ CONFIG ============
const PORT = parseInt(process.env.PORT || "4000", 10);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const REDIS_URL = "redis://127.0.0.1:6379";
const SUPABASE_URL = "https://avtmohfcixlzriichofq.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2dG1vaGZjaXhsenJpaWNob2ZxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDM3NzgyOSwiZXhwIjoyMDg1OTUzODI5fQ.Bw7zszpLR5G3PtlBKLJ-uxL2EIPHYuqSBApE_NRcxQU";
const LIVEKIT_URL = "wss://study-room-0wty6g75.livekit.cloud";
const LIVEKIT_API_KEY = "APIbX9NoYEYiDiL";
const LIVEKIT_API_SECRET = "CZXBgwbaIeqbq9KsQCStLeofHg4Pa51Y6B64eCPSysyD";

// ============ CLIENTS ============
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const livekit = new RoomServiceClient(
    LIVEKIT_URL.replace("wss://", "https://"),
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET
);

// ============ EXPRESS ============
const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

const httpServer = createServer(app);

// ============ SOCKET.IO WITH REDIS ============
const io = new Server(httpServer, {
    cors: { origin: CLIENT_ORIGIN, credentials: true },
    // Keep polling for compatibility; sticky sessions required at LB
    transports: ["polling", "websocket"],
});

// Redis adapter for horizontal scaling
let redisReady = false;

// Robust Redis setup: Try to connect, but fallback to memory if it fails
(async () => {
    try {
        const pubClient = new Redis(REDIS_URL, {
            lazyConnect: true,
            retryStrategy: (times) => {
                if (times > 3) return null; // Stop retrying after 3 attempts
                return Math.min(times * 50, 2000);
            }
        });
        const subClient = pubClient.duplicate();

        // Handle errors gracefully to prevent crash
        const handleRedisError = (err: any) => {
            console.warn("[Redis] Connection failed (using in-memory):", err.message);
            pubClient.disconnect();
            subClient.disconnect();
        };

        pubClient.on("error", handleRedisError);
        subClient.on("error", handleRedisError);

        await Promise.all([pubClient.connect(), subClient.connect()]);

        io.adapter(createAdapter(pubClient, subClient));
        redisReady = true;
        console.log("[Redis] Adapter connected successfully");
    } catch (err) {
        console.warn("[Redis] Initialization failed, running in single-node mode (memory only)");
    }
})();

// ============ AUTH MIDDLEWARE ============
async function authenticateToken(
    authHeader: string | undefined
): Promise<{ userId: string; email?: string } | null> {
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;

    return { userId: data.user.id, email: data.user.email };
}

// ============ REST ENDPOINTS ============

// Health check
app.get("/api/health", (_, res) => {
    res.json({ status: "ok", redis: redisReady });
});

// Create room
app.post("/api/rooms/create", async (req, res) => {
    try {
        const auth = await authenticateToken(req.headers.authorization);
        if (!auth) return res.status(401).json({ error: "Unauthorized" });

        const { roomId, initialVideoId } = req.body;

        // Call RPC
        const { data, error } = await supabase.rpc("rpc_create_room", {
            p_room_id: roomId || null,
            p_initial_video_id: initialVideoId || null,
        });

        if (error) return res.status(400).json({ error: error.message });
        res.json(data);
    } catch (err) {
        console.error("[/api/rooms/create]", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Join room
app.post("/api/rooms/:roomId/join", async (req, res) => {
    try {
        const auth = await authenticateToken(req.headers.authorization);
        if (!auth) return res.status(401).json({ error: "Unauthorized" });

        const { roomId } = req.params;

        const { data, error } = await supabase.rpc("rpc_join_room", {
            p_room_id: roomId,
        });

        if (error) return res.status(400).json({ error: error.message });
        res.json(data);
    } catch (err) {
        console.error("[/api/rooms/:roomId/join]", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Get LiveKit token
app.post("/api/livekit/token", async (req, res) => {
    try {
        const auth = await authenticateToken(req.headers.authorization);
        if (!auth) return res.status(401).json({ error: "Unauthorized" });

        const { roomId } = req.body;
        if (!roomId) return res.status(400).json({ error: "roomId required" });

        // Get user's role
        const { data: member, error } = await supabase
            .from("room_participants")
            .select("role")
            .eq("room_id", roomId)
            .eq("user_id", auth.userId)
            .single();

        if (error || !member) {
            return res.status(403).json({ error: "Not a member of this room" });
        }

        const role = member.role as "host" | "speaker" | "audience";
        const canPublish = role === "host" || role === "speaker";

        // Create LiveKit token
        const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity: auth.userId,
            name: auth.email || auth.userId,
        });

        token.addGrant({
            room: roomId,
            roomJoin: true,
            canPublish,
            canSubscribe: true,
            canPublishData: true,
        });

        res.json({
            token: await token.toJwt(),
            livekitUrl: LIVEKIT_URL,
            role,
            canPublish,
        });
    } catch (err) {
        console.error("[/api/livekit/token]", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Promote user to speaker
app.post("/api/livekit/promote", async (req, res) => {
    try {
        const auth = await authenticateToken(req.headers.authorization);
        if (!auth) return res.status(401).json({ error: "Unauthorized" });

        const { roomId, targetUserId } = req.body;
        if (!roomId || !targetUserId) {
            return res.status(400).json({ error: "roomId and targetUserId required" });
        }

        // Verify caller is host (RPC will also verify)
        const { data: room, error: roomError } = await supabase
            .from("rooms")
            .select("host_user_id")
            .eq("id", roomId)
            .single();

        if (roomError || !room) {
            return res.status(404).json({ error: "Room not found" });
        }
        if (room.host_user_id !== auth.userId) {
            return res.status(403).json({ error: "Only host can promote" });
        }

        // Update Supabase
        const { error: rpcError } = await supabase.rpc("rpc_promote", {
            p_room_id: roomId,
            p_target_user: targetUserId,
        });
        if (rpcError) return res.status(400).json({ error: rpcError.message });

        // Update LiveKit permissions
        try {
            await livekit.updateParticipant(roomId, targetUserId, undefined, {
                canPublish: true,
                canSubscribe: true,
                canPublishData: true,
            });
        } catch (lkErr) {
            console.warn("[LiveKit] UpdateParticipant failed (user may not be connected):", lkErr);
        }

        // Broadcast role update via Socket.IO
        io.to(`room:${roomId}`).emit("role:updated", {
            userId: targetUserId,
            newRole: "speaker",
        });

        res.json({ success: true, newRole: "speaker" });
    } catch (err) {
        console.error("[/api/livekit/promote]", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Demote user to audience
app.post("/api/livekit/demote", async (req, res) => {
    try {
        const auth = await authenticateToken(req.headers.authorization);
        if (!auth) return res.status(401).json({ error: "Unauthorized" });

        const { roomId, targetUserId } = req.body;
        if (!roomId || !targetUserId) {
            return res.status(400).json({ error: "roomId and targetUserId required" });
        }

        // Verify caller is host
        const { data: room, error: roomError } = await supabase
            .from("rooms")
            .select("host_user_id")
            .eq("id", roomId)
            .single();

        if (roomError || !room) {
            return res.status(404).json({ error: "Room not found" });
        }
        if (room.host_user_id !== auth.userId) {
            return res.status(403).json({ error: "Only host can demote" });
        }

        // Update Supabase
        const { error: rpcError } = await supabase.rpc("rpc_demote", {
            p_room_id: roomId,
            p_target_user: targetUserId,
        });
        if (rpcError) return res.status(400).json({ error: rpcError.message });

        // Update LiveKit permissions (revoke publish)
        try {
            await livekit.updateParticipant(roomId, targetUserId, undefined, {
                canPublish: false,
                canSubscribe: true,
                canPublishData: true,
            });
        } catch (lkErr) {
            console.warn("[LiveKit] UpdateParticipant failed:", lkErr);
        }

        // Broadcast
        io.to(`room:${roomId}`).emit("role:updated", {
            userId: targetUserId,
            newRole: "audience",
        });

        res.json({ success: true, newRole: "audience" });
    } catch (err) {
        console.error("[/api/livekit/demote]", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============ SOCKET.IO EVENTS ============

// Hand raise queue (in-memory, use Redis in production)
const handQueues = new Map<string, string[]>();

io.on("connection", (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    let currentRoomId: string | null = null;
    let currentUserId: string | null = null;

    // Join room
    socket.on("room:join", async ({ roomId, token }) => {
        const auth = await authenticateToken(`Bearer ${token}`);
        if (!auth) {
            socket.emit("error", { message: "Unauthorized" });
            return;
        }

        currentRoomId = roomId;
        currentUserId = auth.userId;

        // Join socket room
        socket.join(`room:${roomId}`);
        console.log(`[Socket] ${auth.userId} joined room:${roomId}`);

        // Get room state
        const { data: room } = await supabase
            .from("rooms")
            .select("*")
            .eq("id", roomId)
            .single();

        const { data: members } = await supabase
            .from("room_participants")
            .select("user_id, role")
            .eq("room_id", roomId);

        const speakers = members?.filter((m) => m.role === "speaker" || m.role === "host") || [];
        const handQueue = handQueues.get(roomId) || [];

        socket.emit("room:state", {
            hostId: room?.host_user_id,
            videoId: room?.current_video_id,
            isPlaying: !room?.is_paused,
            timeSec: room?.playback_position_seconds,
            playbackRate: room?.playback_rate,
            speakers: speakers.map((s) => s.user_id),
            memberCount: members?.length || 0,
            handQueue,
        });

        // Notify others
        socket.to(`room:${roomId}`).emit("member:joined", { userId: auth.userId });
    });

    // Chat
    socket.on("chat:send", async ({ roomId, message, token }) => {
        const auth = await authenticateToken(`Bearer ${token}`);
        if (!auth) return;

        // Get display name
        const { data: profile } = await supabase
            .from("profiles")
            .select("display_name")
            .eq("id", auth.userId)
            .single();

        const chatMessage = {
            userId: auth.userId,
            displayName: profile?.display_name || "Anonymous",
            message,
            timestamp: Date.now(),
        };

        io.to(`room:${roomId}`).emit("chat:message", chatMessage);

        // Persist asynchronously
        supabase
            .from("chat_messages")
            .insert({ room_id: roomId, user_id: auth.userId, message })
            .then(() => { });
    });

    // Raise hand
    socket.on("hand:raise", ({ roomId }) => {
        if (!currentUserId) return;

        let queue = handQueues.get(roomId);
        if (!queue) {
            queue = [];
            handQueues.set(roomId, queue);
        }

        if (!queue.includes(currentUserId)) {
            queue.push(currentUserId);
            io.to(`room:${roomId}`).emit("hand:queue", { queue });
        }
    });

    // Lower hand
    socket.on("hand:lower", ({ roomId }) => {
        if (!currentUserId) return;

        const queue = handQueues.get(roomId);
        if (queue) {
            const idx = queue.indexOf(currentUserId);
            if (idx !== -1) {
                queue.splice(idx, 1);
                io.to(`room:${roomId}`).emit("hand:queue", { queue });
            }
        }
    });

    // YouTube sync events (host only)
    socket.on("youtube:load", async ({ roomId, videoId, token }) => {
        const auth = await authenticateToken(`Bearer ${token}`);
        if (!auth) return;

        // Verify host
        const { data: room } = await supabase
            .from("rooms")
            .select("host_user_id")
            .eq("id", roomId)
            .single();

        if (room?.host_user_id !== auth.userId) return;

        // Update DB
        await supabase.rpc("rpc_set_playback", {
            p_room_id: roomId,
            p_video_id: videoId,
            p_is_playing: false,
            p_time_sec: 0,
        });

        io.to(`room:${roomId}`).emit("youtube:loaded", {
            videoId,
            timeSec: 0,
            serverTimestampMs: Date.now(),
        });
    });

    socket.on("youtube:play", async ({ roomId, timeSec, token }) => {
        const auth = await authenticateToken(`Bearer ${token}`);
        if (!auth) return;

        const { data: room } = await supabase
            .from("rooms")
            .select("host_user_id")
            .eq("id", roomId)
            .single();

        if (room?.host_user_id !== auth.userId) return;

        await supabase.rpc("rpc_set_playback", {
            p_room_id: roomId,
            p_is_playing: true,
            p_time_sec: timeSec,
        });

        io.to(`room:${roomId}`).emit("youtube:played", {
            timeSec,
            serverTimestampMs: Date.now(),
        });
    });

    socket.on("youtube:pause", async ({ roomId, timeSec, token }) => {
        const auth = await authenticateToken(`Bearer ${token}`);
        if (!auth) return;

        const { data: room } = await supabase
            .from("rooms")
            .select("host_user_id")
            .eq("id", roomId)
            .single();

        if (room?.host_user_id !== auth.userId) return;

        await supabase.rpc("rpc_set_playback", {
            p_room_id: roomId,
            p_is_playing: false,
            p_time_sec: timeSec,
        });

        io.to(`room:${roomId}`).emit("youtube:paused", {
            timeSec,
            serverTimestampMs: Date.now(),
        });
    });

    socket.on("youtube:seek", async ({ roomId, timeSec, token }) => {
        const auth = await authenticateToken(`Bearer ${token}`);
        if (!auth) return;

        const { data: room } = await supabase
            .from("rooms")
            .select("host_user_id")
            .eq("id", roomId)
            .single();

        if (room?.host_user_id !== auth.userId) return;

        await supabase.rpc("rpc_set_playback", {
            p_room_id: roomId,
            p_time_sec: timeSec,
        });

        io.to(`room:${roomId}`).emit("youtube:seeked", {
            timeSec,
            serverTimestampMs: Date.now(),
        });
    });

    socket.on("youtube:rate", async ({ roomId, rate, token }) => {
        const auth = await authenticateToken(`Bearer ${token}`);
        if (!auth) return;

        const { data: room } = await supabase
            .from("rooms")
            .select("host_user_id")
            .eq("id", roomId)
            .single();

        if (room?.host_user_id !== auth.userId) return;

        await supabase.rpc("rpc_set_playback", {
            p_room_id: roomId,
            p_playback_rate: rate,
        });

        io.to(`room:${roomId}`).emit("youtube:rateChanged", {
            rate,
            serverTimestampMs: Date.now(),
        });
    });

    // Disconnect
    socket.on("disconnect", () => {
        console.log(`[Socket] Disconnected: ${socket.id}`);

        if (currentRoomId && currentUserId) {
            // Remove from hand queue
            const queue = handQueues.get(currentRoomId);
            if (queue) {
                const idx = queue.indexOf(currentUserId);
                if (idx !== -1) {
                    queue.splice(idx, 1);
                    io.to(`room:${currentRoomId}`).emit("hand:queue", { queue });
                }
            }

            socket.to(`room:${currentRoomId}`).emit("member:left", { userId: currentUserId });
        }
    });
});

// ============ START ============
httpServer.listen(PORT, () => {
    console.log(`
========================================
  Lecture Server running on port ${PORT}
  Redis: ${redisReady ? "Connected" : "Not available (single-node)"}
========================================
  `);
});
