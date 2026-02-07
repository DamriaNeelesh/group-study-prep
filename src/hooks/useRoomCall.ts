"use client";

import type {
  RealtimeChannel,
  RealtimePresenceState,
} from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  channel: RealtimeChannel | null;
  participants: CallParticipant[];
  camOn: boolean;
  micOn: boolean;
  localStream: MediaStream | null;
  remoteStreams: RemoteStream[];
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

function participantsFromState(state: RealtimePresenceState<CallPresenceMeta>) {
  const users: CallParticipant[] = [];
  for (const [key, metas] of Object.entries(state)) {
    const meta = metas[0];
    users.push({
      peerId: meta?.peerId ?? key,
      userId: meta?.userId ?? "",
      displayName: meta?.displayName ?? null,
      camOn: Boolean(meta?.camOn),
      micOn: Boolean(meta?.micOn),
      connections: metas.length,
    });
  }
  users.sort((a, b) => {
    const ak = (a.displayName || a.userId || a.peerId).toLowerCase();
    const bk = (b.displayName || b.userId || b.peerId).toLowerCase();
    return ak.localeCompare(bk);
  });
  return users;
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
  const missingEnvError = supabase
    ? null
    : "Missing env: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY";

  const [state, setState] = useState<State>({
    isReady: false,
    error: missingEnvError,
    channel: null,
    participants: [],
    camOn: false,
    micOn: false,
    localStream: null,
    remoteStreams: [],
  });

  const localPeerIdRef = useRef<string>(createPeerId());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const presenceMetaRef = useRef<CallPresenceMeta | null>(null);
  const startOfferRef = useRef<(remotePeerId: string) => void>(() => void 0);

  const send = useCallback(async (event: string, payload: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (!channel) return;
    await channel.send({ type: "broadcast", event, payload });
  }, []);

  const updatePresenceMeta = useCallback(async (patch: Partial<CallPresenceMeta>) => {
    const channel = channelRef.current;
    const meta = presenceMetaRef.current;
    if (!channel || !meta) return;
    const next = { ...meta, ...patch };
    presenceMetaRef.current = next;
    await channel.track(next);
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
      const current = localStreamRef.current ?? new MediaStream();

      for (const t of current.getVideoTracks()) {
        try {
          t.stop();
        } catch {
          // ignore
        }
        current.removeTrack(t);
      }

      if (track) current.addTrack(track);
      localStreamRef.current = current;
      // Create a new MediaStream instance for React state to guarantee re-render.
      setState((s) => ({
        ...s,
        localStream: new MediaStream(current.getTracks()),
      }));
      await replaceTrackEverywhere("video", track);
    },
    [replaceTrackEverywhere],
  );

  const setLocalAudioTrack = useCallback(
    async (track: MediaStreamTrack | null) => {
      const current = localStreamRef.current ?? new MediaStream();

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
    [replaceTrackEverywhere],
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
        video: { facingMode: "user" },
        audio: false,
      });
      const track = stream.getVideoTracks()[0] ?? null;
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
        if (!already) remoteStream.addTrack(ev.track);
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
      const ls = localStreamRef.current;
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
    [args.roomId, args.userId, closePeer, send],
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
    const roomId = args.roomId;
    const userId = args.userId;
    if (!roomId || !userId) return;

    const localPeerId = localPeerIdRef.current;
    let ignore = false;
    const peers = peersRef.current;

    const channel = supabase.channel(`call:${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: localPeerId },
      },
    });
    channelRef.current = channel;

    presenceMetaRef.current = {
      peerId: localPeerId,
      userId,
      displayName: args.displayName || null,
      camOn: false,
      micOn: false,
    };

    channel
      .on("presence", { event: "sync" }, () => {
        const p = participantsFromState(
          channel.presenceState() as RealtimePresenceState<CallPresenceMeta>,
        );
        setState((s) => ({ ...s, participants: p }));
      })
      .on("presence", { event: "join" }, () => {
        const p = participantsFromState(
          channel.presenceState() as RealtimePresenceState<CallPresenceMeta>,
        );
        setState((s) => ({ ...s, participants: p }));
      })
      .on("presence", { event: "leave" }, () => {
        const p = participantsFromState(
          channel.presenceState() as RealtimePresenceState<CallPresenceMeta>,
        );
        setState((s) => ({ ...s, participants: p }));
      })
      .on("broadcast", { event: "webrtc:offer" }, async ({ payload }) => {
        if (ignore) return;
        const toPeerId = String(payload?.toPeerId ?? "");
        if (toPeerId !== localPeerId) return;
        const fromPeerId = String(payload?.fromPeerId ?? "");
        if (!fromPeerId) return;
        const sdp = payload?.sdp as RTCSessionDescriptionInit | undefined;
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
      })
      .on("broadcast", { event: "webrtc:answer" }, async ({ payload }) => {
        if (ignore) return;
        const toPeerId = String(payload?.toPeerId ?? "");
        if (toPeerId !== localPeerId) return;
        const fromPeerId = String(payload?.fromPeerId ?? "");
        if (!fromPeerId) return;
        const sdp = payload?.sdp as RTCSessionDescriptionInit | undefined;
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
      })
      .on("broadcast", { event: "webrtc:candidate" }, async ({ payload }) => {
        if (ignore) return;
        const toPeerId = String(payload?.toPeerId ?? "");
        if (toPeerId !== localPeerId) return;
        const fromPeerId = String(payload?.fromPeerId ?? "");
        if (!fromPeerId) return;
        const candidate = payload?.candidate as RTCIceCandidateInit | undefined;
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
      })
      .on("broadcast", { event: "webrtc:renegotiate" }, async ({ payload }) => {
        if (ignore) return;
        const toPeerId = String(payload?.toPeerId ?? "");
        if (toPeerId !== localPeerId) return;
        const fromPeerId = String(payload?.fromPeerId ?? "");
        if (!fromPeerId) return;

        // Only the deterministic initiator should send offers.
        if (!isOfferInitiator(localPeerId, fromPeerId)) return;
        startOfferRef.current(fromPeerId);
      });

    channel.subscribe(async (status) => {
      setState((s) => ({ ...s, channel, isReady: false, error: null }));
      if (status !== "SUBSCRIBED") return;
      setState((s) => ({ ...s, isReady: true }));
      const meta = presenceMetaRef.current;
      if (meta) {
        try {
          await channel.track(meta);
        } catch {
          // ignore
        }
      }
    });

    return () => {
      ignore = true;
      presenceMetaRef.current = null;
      channelRef.current = null;

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

      setState((s) => ({
        ...s,
        channel: null,
        isReady: false,
        participants: [],
        camOn: false,
        micOn: false,
        localStream: null,
        remoteStreams: [],
      }));
      void supabase.removeChannel(channel);
    };
  }, [
    args.displayName,
    args.roomId,
    args.userId,
    closePeer,
    ensurePeer,
    flushPendingCandidates,
    send,
    supabase,
  ]);

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

    for (const remotePeerId of remotes) {
      if (!peersRef.current.has(remotePeerId)) {
        void ensurePeer(remotePeerId).then((peer) => {
          if (!peer) return;
          if (isOfferInitiator(localPeerId, remotePeerId)) {
            void startOffer(remotePeerId);
          }
        });
      }
    }

    for (const existing of Array.from(peersRef.current.keys())) {
      if (!remotes.includes(existing)) closePeer(existing);
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
