"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import msgpackParser from "socket.io-msgpack-parser";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type CallPresenceMeta = {
  peerId: string;
  userId: string;
  displayName: string | null;
  camOn: boolean;
  micOn: boolean;
};

export type CallParticipant = CallPresenceMeta & {
  connections: number;
};

export type CallPeerDebug = {
  peerId: string;
  connectionState: RTCPeerConnectionState;
  signalingState: RTCSignalingState;
  iceConnectionState: RTCIceConnectionState;
  outboundAudioBytes: number;
  outboundVideoBytes: number;
  inboundAudioBytes: number;
  inboundVideoBytes: number;
};

type RemoteStream = {
  peerId: string;
  stream: MediaStream;
};

type Peer = {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  videoTx: RTCRtpTransceiver;
  audioTx: RTCRtpTransceiver;
  pendingCandidates: RTCIceCandidateInit[];
  remoteDescSet: boolean;
  makingOffer: boolean;
  pendingOffer: boolean;
};

type State = {
  isReady: boolean;
  error: string | null;
  participants: CallParticipant[];
  camOn: boolean;
  micOn: boolean;
  localStream: MediaStream | null;
  remoteStreams: RemoteStream[];
  debugPeers: CallPeerDebug[];
};

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function iceServersFromEnv(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS;
  if (!raw) return DEFAULT_ICE_SERVERS;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as RTCIceServer[];
  } catch {
    // ignore
  }

  return DEFAULT_ICE_SERVERS;
}

function isOfferInitiator(localId: string, remoteId: string) {
  // Deterministic initiator to avoid offer glare without implementing "perfect negotiation".
  return localId.localeCompare(remoteId) < 0;
}

function toCandidateInit(c: RTCIceCandidate) {
  return {
    candidate: c.candidate,
    sdpMid: c.sdpMid ?? null,
    sdpMLineIndex: c.sdpMLineIndex ?? null,
    usernameFragment: c.usernameFragment ?? null,
  } satisfies RTCIceCandidateInit;
}

function createPeerId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `peer_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function formatGetUserMediaError(kind: "camera" | "microphone", e: unknown) {
  const err = e as { name?: string; message?: string } | null;
  const name = String(err?.name ?? "");

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return `Permission denied. Allow ${kind} access in your browser settings and try again.`;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return `No ${kind} device found.`;
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return `Your ${kind} is busy or blocked by another app. Close other apps using it and try again.`;
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return `Your device can't satisfy the requested ${kind} constraints. Try a different camera/mic.`;
  }
  if (name === "SecurityError") {
    return `${kind[0]?.toUpperCase()}${kind.slice(1)} requires HTTPS (or localhost).`;
  }

  const message = err?.message ? String(err.message) : "";
  return message || `Failed to access ${kind}.`;
}

export function useRoomCall(args: {
  roomId: string;
  userId: string | null;
  displayName: string;
}) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const realtimeUrl = (process.env.NEXT_PUBLIC_REALTIME_URL || "").trim();
  const missingEnvError = supabase
    ? realtimeUrl
      ? null
      : "Missing env: NEXT_PUBLIC_REALTIME_URL"
    : "Missing env: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY";

  const [state, setState] = useState<State>({
    isReady: false,
    error: missingEnvError,
    participants: [],
    camOn: false,
    micOn: false,
    localStream: null,
    remoteStreams: [],
    debugPeers: [],
  });

  const localPeerIdRef = useRef<string>(createPeerId());
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const presenceMetaRef = useRef<CallPresenceMeta | null>(null);
  const startOfferRef = useRef<(remotePeerId: string) => void>(() => void 0);
  const dummyVideoRef = useRef<{
    canvas: HTMLCanvasElement;
    stream: MediaStream;
    track: MediaStreamTrack;
  } | null>(null);

  const getOrCreateDummyVideoTrack = useCallback((): MediaStreamTrack | null => {
    // Client-only: keep all DOM usage inside callbacks/effects.
    if (typeof document === "undefined") return null;

    const existing = dummyVideoRef.current?.track ?? null;
    if (existing && existing.readyState !== "ended") return existing;

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // A visible placeholder pattern so we can tell "dummy video" vs real camera.
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    g.addColorStop(0, "#0b1220");
    g.addColorStop(1, "#0f3d2e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(255,255,255,0.10)";
    for (let x = 0; x < canvas.width; x += 18) {
      ctx.fillRect(x, 0, 2, canvas.height);
    }
    for (let y = 0; y < canvas.height; y += 18) {
      ctx.fillRect(0, y, canvas.width, 2);
    }

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CAMERA OFF", canvas.width / 2, canvas.height / 2);

    const stream = canvas.captureStream?.(1);
    const track = stream?.getVideoTracks?.()[0] ?? null;
    if (!track) return null;

    dummyVideoRef.current = { canvas, stream, track };
    return track;
  }, []);

  const ensureLocalStream = useCallback(() => {
    const current = localStreamRef.current ?? new MediaStream();
    localStreamRef.current = current;

    // Keep a dummy video track in the stream so SDP always has a video sender.
    const dummy = getOrCreateDummyVideoTrack();
    if (dummy) {
      const hasDummy = current.getVideoTracks().some((t) => t === dummy);
      const hasAnyVideo = current.getVideoTracks().length > 0;
      if (!hasAnyVideo && !hasDummy) current.addTrack(dummy);
    }

    return current;
  }, [getOrCreateDummyVideoTrack]);

  const send = useCallback(async (event: string, payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(id);
        socket.off("disconnect", onDisconnect);
        resolve();
      };
      const onDisconnect = () => finish();
      const id = window.setTimeout(finish, 1500);
      socket.on("disconnect", onDisconnect);
      socket.emit("call:signal", { event, payload }, () => finish());
    });
  }, []);

  const updatePresenceMeta = useCallback(async (patch: Partial<CallPresenceMeta>) => {
    const socket = socketRef.current;
    const meta = presenceMetaRef.current;
    if (!socket || !socket.connected || !meta) return;
    const next = { ...meta, ...patch };
    presenceMetaRef.current = next;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(id);
        socket.off("disconnect", onDisconnect);
        resolve();
      };
      const onDisconnect = () => finish();
      const id = window.setTimeout(finish, 1500);
      socket.on("disconnect", onDisconnect);
      socket.emit("call:presence:update", next, () => finish());
    });
  }, []);

  const requestRenegotiate = useCallback(
    async (remotePeerId: string) => {
      const localUserId = args.userId;
      if (!localUserId) return;
      const localPeerId = localPeerIdRef.current;

      // Only the deterministic initiator should create offers to avoid glare.
      if (isOfferInitiator(localPeerId, remotePeerId)) {
        startOfferRef.current(remotePeerId);
        return;
      }

      await send("webrtc:renegotiate", {
        roomId: args.roomId,
        fromPeerId: localPeerId,
        toPeerId: remotePeerId,
        fromUserId: localUserId,
      });
    },
    [args.roomId, args.userId, send],
  );

  const renegotiateAllPeers = useCallback(async () => {
    const remotes = Array.from(peersRef.current.keys());
    await Promise.all(remotes.map((id) => requestRenegotiate(id)));
  }, [requestRenegotiate]);

  const closePeer = useCallback((remotePeerId: string) => {
    const peer = peersRef.current.get(remotePeerId);
    if (!peer) return;
    peersRef.current.delete(remotePeerId);
    try {
      peer.pc.onicecandidate = null;
      peer.pc.ontrack = null;
      peer.pc.onsignalingstatechange = null;
      peer.pc.close();
    } catch {
      // ignore
    }
    setState((s) => ({
      ...s,
      remoteStreams: s.remoteStreams.filter((r) => r.peerId !== remotePeerId),
    }));
  }, []);

  const replaceTrackEverywhere = useCallback(
    async (kind: "video" | "audio", track: MediaStreamTrack | null) => {
      const promises: Promise<void>[] = [];
      for (const peer of peersRef.current.values()) {
        const sender =
          kind === "video" ? peer.videoTx.sender : peer.audioTx.sender;
        promises.push(
          sender
            .replaceTrack(track)
            .then(() => void 0)
            .catch(() => void 0),
        );
      }
      await Promise.all(promises);
    },
    [],
  );

  const setLocalVideoTrack = useCallback(
    async (track: MediaStreamTrack | null) => {
      const current = ensureLocalStream();
      const dummy = getOrCreateDummyVideoTrack();

      for (const t of current.getVideoTracks()) {
        // Don't stop the dummy track; we can reuse it when camera is off.
        if (dummy && t === dummy) {
          current.removeTrack(t);
          continue;
        }
        try {
          t.stop();
        } catch {
          // ignore
        }
        current.removeTrack(t);
      }

      const nextTrack = track ?? dummy;
      if (nextTrack) current.addTrack(nextTrack);
      localStreamRef.current = current;
      // Create a new MediaStream instance for React state to guarantee re-render.
      setState((s) => ({
        ...s,
        localStream: new MediaStream(current.getTracks()),
      }));
      await replaceTrackEverywhere("video", nextTrack ?? null);
    },
    [ensureLocalStream, getOrCreateDummyVideoTrack, replaceTrackEverywhere],
  );

  const setLocalAudioTrack = useCallback(
    async (track: MediaStreamTrack | null) => {
      const current = ensureLocalStream();

      for (const t of current.getAudioTracks()) {
        try {
          t.stop();
        } catch {
          // ignore
        }
        current.removeTrack(t);
      }

      if (track) current.addTrack(track);
      localStreamRef.current = current;
      setState((s) => ({
        ...s,
        localStream: new MediaStream(current.getTracks()),
      }));
      await replaceTrackEverywhere("audio", track);
    },
    [ensureLocalStream, replaceTrackEverywhere],
  );

  const enableCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your browser does not support camera access.");
      }
      if (typeof window !== "undefined" && !window.isSecureContext) {
        throw new Error("Camera requires HTTPS (or localhost).");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        // Conservative defaults to improve reliability on lower-end phones.
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 20, max: 30 },
        },
        audio: false,
      });
      const track = stream.getVideoTracks()[0] ?? null;
      if (track) {
        try {
          track.contentHint = "motion";
        } catch {
          // ignore
        }
      }
      await setLocalVideoTrack(track);
      setState((s) => ({ ...s, camOn: Boolean(track), error: null }));
      await updatePresenceMeta({ camOn: Boolean(track) });
      await renegotiateAllPeers();
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        error: formatGetUserMediaError("camera", e),
      }));
    }
  }, [renegotiateAllPeers, setLocalVideoTrack, updatePresenceMeta]);

  const disableCamera = useCallback(async () => {
    await setLocalVideoTrack(null);
    setState((s) => ({ ...s, camOn: false }));
    await updatePresenceMeta({ camOn: false });
    await renegotiateAllPeers();
  }, [renegotiateAllPeers, setLocalVideoTrack, updatePresenceMeta]);

  const enableMic = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your browser does not support microphone access.");
      }
      if (typeof window !== "undefined" && !window.isSecureContext) {
        throw new Error("Microphone requires HTTPS (or localhost).");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const track = stream.getAudioTracks()[0] ?? null;
      await setLocalAudioTrack(track);
      setState((s) => ({ ...s, micOn: Boolean(track), error: null }));
      await updatePresenceMeta({ micOn: Boolean(track) });
      await renegotiateAllPeers();
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        error: formatGetUserMediaError("microphone", e),
      }));
    }
  }, [renegotiateAllPeers, setLocalAudioTrack, updatePresenceMeta]);

  const disableMic = useCallback(async () => {
    await setLocalAudioTrack(null);
    setState((s) => ({ ...s, micOn: false }));
    await updatePresenceMeta({ micOn: false });
    await renegotiateAllPeers();
  }, [renegotiateAllPeers, setLocalAudioTrack, updatePresenceMeta]);

  const createPeer = useCallback(
    async (remotePeerId: string) => {
      const localUserId = args.userId;
      if (!localUserId) return null;
      const localPeerId = localPeerIdRef.current;

      const pc = new RTCPeerConnection({
        iceServers: iceServersFromEnv(),
      });

      const remoteStream = new MediaStream();

      const videoTx = pc.addTransceiver("video", { direction: "sendrecv" });
      const audioTx = pc.addTransceiver("audio", { direction: "sendrecv" });

      // Prefer H264 first (iOS/WebKit interop), then fall back to browser defaults.
      try {
        const caps = RTCRtpSender.getCapabilities?.("video");
        const codecs = caps?.codecs ?? [];
        if (typeof videoTx.setCodecPreferences === "function" && codecs.length > 0) {
          const isH264 = (c: { mimeType?: string }) =>
            c.mimeType?.toLowerCase?.() === "video/h264";
          const preferred = [...codecs.filter(isH264), ...codecs.filter((c) => !isH264(c))];
          videoTx.setCodecPreferences(preferred);
        }
      } catch {
        // ignore
      }

      const peer: Peer = {
        pc,
        remoteStream,
        videoTx,
        audioTx,
        pendingCandidates: [],
        remoteDescSet: false,
        makingOffer: false,
        pendingOffer: false,
      };
      peersRef.current.set(remotePeerId, peer);

      pc.ontrack = (ev) => {
        // Some browsers provide streams; some only provide tracks. Prefer track-based.
        const already = remoteStream
          .getTracks()
          .some((t) => t.id === ev.track.id);
        if (!already) {
          remoteStream.addTrack(ev.track);

          // Force a state update to ensure the UI re-renders with the new track
          setState((s) => {
            const nextStreams = s.remoteStreams.map((rs) =>
              rs.peerId === remotePeerId
                ? { ...rs, stream: new MediaStream(remoteStream.getTracks()) }
                : rs
            );
            return { ...s, remoteStreams: nextStreams };
          });
        }
      };

      pc.onsignalingstatechange = () => {
        if (!peer.pendingOffer) return;
        if (pc.signalingState !== "stable") return;
        peer.pendingOffer = false;
        startOfferRef.current(remotePeerId);
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        // `disconnected` can be transient on mobile networks; don't tear down aggressively.
        if (s === "failed") {
          setState((prev) => ({
            ...prev,
            error:
              prev.error ??
              "Call connection failed. If devices are on different networks, configure a TURN server (NEXT_PUBLIC_WEBRTC_ICE_SERVERS) for reliable WebRTC.",
          }));
          closePeer(remotePeerId);
          return;
        }
        if (s === "closed") closePeer(remotePeerId);
      };

      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return;
        void send("webrtc:candidate", {
          roomId: args.roomId,
          fromPeerId: localPeerId,
          toPeerId: remotePeerId,
          fromUserId: localUserId,
          candidate: toCandidateInit(ev.candidate),
        });
      };

      // Attach any current local tracks.
      const ls = ensureLocalStream();

      // Associate senders with a stream id (helps some browsers with msid/track routing).
      try {
        (videoTx.sender as unknown as { setStreams?: (...s: MediaStream[]) => void }).setStreams?.(ls);
      } catch {
        // ignore
      }
      try {
        (audioTx.sender as unknown as { setStreams?: (...s: MediaStream[]) => void }).setStreams?.(ls);
      } catch {
        // ignore
      }

      const v = ls?.getVideoTracks()[0] ?? null;
      const a = ls?.getAudioTracks()[0] ?? null;
      try {
        await videoTx.sender.replaceTrack(v);
      } catch {
        // ignore
      }
      try {
        await audioTx.sender.replaceTrack(a);
      } catch {
        // ignore
      }

      setState((s) => {
        const next = [...s.remoteStreams.filter((r) => r.peerId !== remotePeerId)];
        next.push({ peerId: remotePeerId, stream: remoteStream });
        next.sort((x, y) => x.peerId.localeCompare(y.peerId));
        return { ...s, remoteStreams: next };
      });

      return peer;
    },
    [args.roomId, args.userId, closePeer, ensureLocalStream, send],
  );

  const ensurePeer = useCallback(
    async (remotePeerId: string) => {
      const existing = peersRef.current.get(remotePeerId);
      if (existing) return existing;
      return await createPeer(remotePeerId);
    },
    [createPeer],
  );

  const flushPendingCandidates = useCallback(async (peer: Peer) => {
    if (!peer.remoteDescSet) return;
    const pending = peer.pendingCandidates.splice(0, peer.pendingCandidates.length);
    for (const c of pending) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        // ignore
      }
    }
  }, []);

  const startOffer = useCallback(
    async (remotePeerId: string) => {
      const localUserId = args.userId;
      if (!localUserId) return;
      const localPeerId = localPeerIdRef.current;
      const peer = await ensurePeer(remotePeerId);
      if (!peer) return;
      if (peer.makingOffer) {
        peer.pendingOffer = true;
        return;
      }
      if (peer.pc.signalingState !== "stable") {
        peer.pendingOffer = true;
        return;
      }
      peer.makingOffer = true;
      try {
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        const sdp = peer.pc.localDescription;
        if (!sdp) return;
        await send("webrtc:offer", {
          roomId: args.roomId,
          fromPeerId: localPeerId,
          toPeerId: remotePeerId,
          fromUserId: localUserId,
          sdp,
        });
      } catch (e: unknown) {
        setState((s) => ({
          ...s,
          error: e instanceof Error ? e.message : String(e),
        }));
      } finally {
        peer.makingOffer = false;
      }
    },
    [args.roomId, args.userId, ensurePeer, send],
  );

  // Allow event handlers to trigger offer creation without needing to depend on `startOffer`.
  startOfferRef.current = (remotePeerId: string) => {
    void startOffer(remotePeerId);
  };

  useEffect(() => {
    if (!supabase) return;
    if (!realtimeUrl) return;
    const roomId = args.roomId;
    const userId = args.userId;
    if (!roomId || !userId) return;

    const localPeerId = localPeerIdRef.current;
    let ignore = false;
    const peers = peersRef.current;

    const socket = io(realtimeUrl, {
      autoConnect: false,
      transports: ["websocket"],
      reconnection: false,
      parser: msgpackParser,
      auth: { token: "", displayName: args.displayName },
    });
    socketRef.current = socket;
    let reconnectTimer: number | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = (delayMs: number) => {
      if (ignore) return;
      clearReconnectTimer();
      reconnectTimer = window.setTimeout(() => {
        void connectWithFreshToken();
      }, Math.max(250, delayMs));
    };

    presenceMetaRef.current = {
      peerId: localPeerId,
      userId,
      displayName: args.displayName || null,
      camOn: false,
      micOn: false,
    };

    const handleSignal = async (event: string, payload: unknown) => {
      if (ignore || !isRecord(payload)) return;
      const toPeerId = String(payload.toPeerId ?? "");
      if (toPeerId !== localPeerId) return;
      const fromPeerId = String(payload.fromPeerId ?? "");
      if (!fromPeerId) return;

      if (event === "webrtc:offer") {
        const sdp = payload.sdp as RTCSessionDescriptionInit | undefined;
        if (!sdp?.type || !sdp?.sdp) return;
        const peer = await ensurePeer(fromPeerId);
        if (!peer) return;
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
          peer.remoteDescSet = true;
          await flushPendingCandidates(peer);

          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          const localDesc = peer.pc.localDescription;
          if (!localDesc) return;
          await send("webrtc:answer", {
            roomId,
            fromPeerId: localPeerId,
            toPeerId: fromPeerId,
            fromUserId: userId,
            sdp: localDesc,
          });
        } catch (e: unknown) {
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : String(e),
          }));
        }
        return;
      }

      if (event === "webrtc:answer") {
        const sdp = payload.sdp as RTCSessionDescriptionInit | undefined;
        if (!sdp?.type || !sdp?.sdp) return;
        const peer = await ensurePeer(fromPeerId);
        if (!peer) return;
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
          peer.remoteDescSet = true;
          await flushPendingCandidates(peer);
        } catch (e: unknown) {
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : String(e),
          }));
        }
        return;
      }

      if (event === "webrtc:candidate") {
        const candidate = payload.candidate as RTCIceCandidateInit | undefined;
        if (!candidate?.candidate) return;
        const peer = await ensurePeer(fromPeerId);
        if (!peer) return;

        if (!peer.remoteDescSet) {
          peer.pendingCandidates.push(candidate);
          return;
        }
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // ignore
        }
        return;
      }

      if (event === "webrtc:renegotiate") {
        if (!isOfferInitiator(localPeerId, fromPeerId)) return;
        startOfferRef.current(fromPeerId);
      }
    };

    const connectWithFreshToken = async () => {
      if (ignore) return;
      if (socket.connected) return;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? "";
        if (!token) {
          scheduleReconnect(1000);
          return;
        }
        socket.auth = { token, displayName: args.displayName };
      } catch {
        scheduleReconnect(1000);
        return;
      }

      try {
        socket.connect();
      } catch {
        scheduleReconnect(1000);
      }
    };

    socket.on("call:presence", (payload: unknown) => {
      if (!isRecord(payload)) return;
      if (String(payload.roomId ?? "") !== roomId) return;
      const list = Array.isArray(payload.participants) ? payload.participants : [];
      const participants = list
        .map((raw) => {
          if (!isRecord(raw)) return null;
          const peerId = typeof raw.peerId === "string" ? raw.peerId : "";
          const uid = typeof raw.userId === "string" ? raw.userId : "";
          if (!peerId || !uid) return null;
          return {
            peerId,
            userId: uid,
            displayName:
              typeof raw.displayName === "string" ? raw.displayName : null,
            camOn: Boolean(raw.camOn),
            micOn: Boolean(raw.micOn),
            connections:
              typeof raw.connections === "number"
                ? Math.max(1, Math.trunc(raw.connections))
                : 1,
          } satisfies CallParticipant;
        })
        .filter(Boolean) as CallParticipant[];

      participants.sort((a, b) => {
        const ak = (a.displayName || a.userId || a.peerId).toLowerCase();
        const bk = (b.displayName || b.userId || b.peerId).toLowerCase();
        return ak.localeCompare(bk);
      });

      setState((s) => ({ ...s, participants }));
    });

    socket.on("call:signal", (msg: unknown) => {
      if (!isRecord(msg)) return;
      const event = typeof msg.event === "string" ? msg.event : "";
      if (!event) return;
      void handleSignal(event, msg.payload);
    });

    socket.on("connect", () => {
      if (ignore) return;
      setState((s) => ({ ...s, isReady: false, error: null }));

      // Ensure we have a local stream with at least a dummy video track
      // BEFORE joining call presence so peers can negotiate immediately.
      ensureLocalStream();

      const meta = presenceMetaRef.current;
      socket.emit(
        "call:join",
        {
          roomId,
          peerId: localPeerId,
          displayName: meta?.displayName ?? args.displayName ?? null,
          camOn: Boolean(meta?.camOn),
          micOn: Boolean(meta?.micOn),
        },
        (res: unknown) => {
          if (ignore) return;
          if (isRecord(res) && res.ok === true) {
            setState((s) => ({ ...s, isReady: true, error: null }));
            return;
          }
          const err =
            isRecord(res) && typeof res.error === "string"
              ? res.error
              : "call_join_failed";
          setState((s) => ({ ...s, isReady: false, error: err }));
        },
      );
    });

    socket.on("disconnect", () => {
      if (ignore) return;
      setState((s) => ({
        ...s,
        isReady: false,
        error: s.error ?? "Meet disconnected. Reconnecting...",
      }));
      scheduleReconnect(1000);
    });

    socket.on("connect_error", (err: unknown) => {
      if (ignore) return;
      const msg =
        isRecord(err) && typeof err.message === "string"
          ? err.message
          : "meet_connect_failed";
      setState((s) => ({ ...s, isReady: false, error: msg }));
      scheduleReconnect(1500);
    });

    void connectWithFreshToken();

    return () => {
      ignore = true;
      clearReconnectTimer();
      presenceMetaRef.current = null;

      try {
        socket.emit("call:leave", {});
      } catch {
        // ignore
      }
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
      socketRef.current = null;

      for (const k of Array.from(peers.keys())) closePeer(k);
      const ls = localStreamRef.current;
      if (ls) {
        for (const t of ls.getTracks()) {
          try {
            t.stop();
          } catch {
            // ignore
          }
        }
      }
      localStreamRef.current = null;

      const dummy = dummyVideoRef.current?.track ?? null;
      if (dummy) {
        try {
          dummy.stop();
        } catch {
          // ignore
        }
      }
      dummyVideoRef.current = null;

      setState((s) => ({
        ...s,
        isReady: false,
        participants: [],
        camOn: false,
        micOn: false,
        localStream: null,
        remoteStreams: [],
        debugPeers: [],
      }));
    };
  }, [
    args.displayName,
    args.roomId,
    args.userId,
    closePeer,
    ensurePeer,
    ensureLocalStream,
    flushPendingCandidates,
    realtimeUrl,
    send,
    supabase,
  ]);

  // Lightweight peer diagnostics for debugging real-world device issues.
  useEffect(() => {
    if (!state.isReady) return;
    let cancelled = false;

    const sample = async () => {
      const entries = Array.from(peersRef.current.entries());
      const next = await Promise.all(
        entries.map(async ([peerId, peer]) => {
          let outboundAudioBytes = 0;
          let outboundVideoBytes = 0;
          let inboundAudioBytes = 0;
          let inboundVideoBytes = 0;

          try {
            const stats = await peer.pc.getStats();
            stats.forEach((r) => {
              const rec = r as unknown as Record<string, unknown>;
              const type = typeof rec.type === "string" ? rec.type : "";
              const kind =
                (typeof rec.kind === "string" ? rec.kind : null) ??
                (typeof rec.mediaType === "string" ? rec.mediaType : "");
              const isRemote = Boolean(rec.isRemote);
              const bytesSent = typeof rec.bytesSent === "number" ? rec.bytesSent : 0;
              const bytesReceived =
                typeof rec.bytesReceived === "number" ? rec.bytesReceived : 0;

              if (type === "outbound-rtp" && !isRemote) {
                if (kind === "audio") outboundAudioBytes += bytesSent;
                if (kind === "video") outboundVideoBytes += bytesSent;
              }
              if (type === "inbound-rtp" && !isRemote) {
                if (kind === "audio") inboundAudioBytes += bytesReceived;
                if (kind === "video") inboundVideoBytes += bytesReceived;
              }
            });
          } catch {
            // ignore
          }

          return {
            peerId,
            connectionState: peer.pc.connectionState,
            signalingState: peer.pc.signalingState,
            iceConnectionState: peer.pc.iceConnectionState,
            outboundAudioBytes,
            outboundVideoBytes,
            inboundAudioBytes,
            inboundVideoBytes,
          } satisfies CallPeerDebug;
        }),
      );

      if (cancelled) return;
      setState((s) => ({ ...s, debugPeers: next }));
    };

    void sample();
    const id = window.setInterval(() => void sample(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state.isReady]);

  // Keep display name in call presence (best-effort).
  useEffect(() => {
    const userId = args.userId;
    if (!userId) return;
    if (!state.isReady) return;
    void updatePresenceMeta({ displayName: args.displayName || null });
  }, [args.displayName, args.userId, state.isReady, updatePresenceMeta]);

  // When call presence changes, ensure we have peers for everyone currently in the call channel.
  useEffect(() => {
    const localPeerId = localPeerIdRef.current;
    if (!state.isReady) return;

    const remotes = state.participants
      .map((p) => p.peerId)
      .filter((id) => id && id !== localPeerId);

    // Create peer connections for new participants
    for (const remotePeerId of remotes) {
      if (!peersRef.current.has(remotePeerId)) {
        // Create the peer connection immediately (this also adds it to the ref)
        void ensurePeer(remotePeerId).then((peer) => {
          if (!peer) return;

          // Only initiate the offer if we are the designated initiator
          // This prevents both sides from trying to create offers simultaneously
          if (isOfferInitiator(localPeerId, remotePeerId)) {
            // Small delay to ensure the peer is fully set up
            setTimeout(() => {
              void startOffer(remotePeerId);
            }, 100);
          }
        });
      }
    }

    // Clean up peer connections for participants who left
    for (const existing of Array.from(peersRef.current.keys())) {
      if (!remotes.includes(existing)) {
        closePeer(existing);
      }
    }
  }, [closePeer, ensurePeer, startOffer, state.isReady, state.participants]);

  return {
    ...state,
    peerId: localPeerIdRef.current,
    enableCamera,
    disableCamera,
    enableMic,
    disableMic,
  };
}
