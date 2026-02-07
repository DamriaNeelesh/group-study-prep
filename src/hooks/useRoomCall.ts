"use client";

import type {
  RealtimeChannel,
  RealtimePresenceState,
} from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type CallPresenceMeta = {
  userId: string;
  displayName: string | null;
  camOn: boolean;
  micOn: boolean;
};

export type CallParticipant = CallPresenceMeta & {
  connections: number;
};

type RemoteStream = {
  userId: string;
  stream: MediaStream;
};

type Peer = {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  videoTx: RTCRtpTransceiver;
  audioTx: RTCRtpTransceiver;
  pendingCandidates: RTCIceCandidateInit[];
  remoteDescSet: boolean;
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

function participantsFromState(state: RealtimePresenceState<CallPresenceMeta>) {
  const users: CallParticipant[] = [];
  for (const [key, metas] of Object.entries(state)) {
    const meta = metas[0];
    users.push({
      userId: meta?.userId ?? key,
      displayName: meta?.displayName ?? null,
      camOn: Boolean(meta?.camOn),
      micOn: Boolean(meta?.micOn),
      connections: metas.length,
    });
  }
  users.sort((a, b) => a.userId.localeCompare(b.userId));
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

  const channelRef = useRef<RealtimeChannel | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const presenceMetaRef = useRef<CallPresenceMeta | null>(null);

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

  const closePeer = useCallback((remoteUserId: string) => {
    const peer = peersRef.current.get(remoteUserId);
    if (!peer) return;
    peersRef.current.delete(remoteUserId);
    try {
      peer.pc.onicecandidate = null;
      peer.pc.ontrack = null;
      peer.pc.close();
    } catch {
      // ignore
    }
    setState((s) => ({
      ...s,
      remoteStreams: s.remoteStreams.filter((r) => r.userId !== remoteUserId),
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      const track = stream.getVideoTracks()[0] ?? null;
      await setLocalVideoTrack(track);
      setState((s) => ({ ...s, camOn: Boolean(track), error: null }));
      await updatePresenceMeta({ camOn: Boolean(track) });
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, [setLocalVideoTrack, updatePresenceMeta]);

  const disableCamera = useCallback(async () => {
    await setLocalVideoTrack(null);
    setState((s) => ({ ...s, camOn: false }));
    await updatePresenceMeta({ camOn: false });
  }, [setLocalVideoTrack, updatePresenceMeta]);

  const enableMic = useCallback(async () => {
    try {
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
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, [setLocalAudioTrack, updatePresenceMeta]);

  const disableMic = useCallback(async () => {
    await setLocalAudioTrack(null);
    setState((s) => ({ ...s, micOn: false }));
    await updatePresenceMeta({ micOn: false });
  }, [setLocalAudioTrack, updatePresenceMeta]);

  const createPeer = useCallback(
    async (remoteUserId: string) => {
      const localUserId = args.userId;
      if (!localUserId) return null;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
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
      };
      peersRef.current.set(remoteUserId, peer);

      pc.ontrack = (ev) => {
        // Some browsers provide streams; some only provide tracks. Prefer track-based.
        const already = remoteStream
          .getTracks()
          .some((t) => t.id === ev.track.id);
        if (!already) remoteStream.addTrack(ev.track);
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "failed" || s === "disconnected" || s === "closed") {
          closePeer(remoteUserId);
        }
      };

      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return;
        void send("webrtc:candidate", {
          roomId: args.roomId,
          from: localUserId,
          to: remoteUserId,
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
        const next = [...s.remoteStreams.filter((r) => r.userId !== remoteUserId)];
        next.push({ userId: remoteUserId, stream: remoteStream });
        next.sort((x, y) => x.userId.localeCompare(y.userId));
        return { ...s, remoteStreams: next };
      });

      return peer;
    },
    [args.roomId, args.userId, closePeer, send],
  );

  const ensurePeer = useCallback(
    async (remoteUserId: string) => {
      const existing = peersRef.current.get(remoteUserId);
      if (existing) return existing;
      return await createPeer(remoteUserId);
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
    async (remoteUserId: string) => {
      const localUserId = args.userId;
      if (!localUserId) return;
      const peer = await ensurePeer(remoteUserId);
      if (!peer) return;
      try {
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        const sdp = peer.pc.localDescription;
        if (!sdp) return;
        await send("webrtc:offer", {
          roomId: args.roomId,
          from: localUserId,
          to: remoteUserId,
          sdp,
        });
      } catch (e: unknown) {
        setState((s) => ({
          ...s,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    },
    [args.roomId, args.userId, ensurePeer, send],
  );

  useEffect(() => {
    if (!supabase) return;
    const roomId = args.roomId;
    const userId = args.userId;
    if (!roomId || !userId) return;

    let ignore = false;
    const peers = peersRef.current;

    const channel = supabase.channel(`call:${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: userId },
      },
    });
    channelRef.current = channel;

    presenceMetaRef.current = {
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
        const to = String(payload?.to ?? "");
        if (to !== userId) return;
        const from = String(payload?.from ?? "");
        if (!from) return;
        const sdp = payload?.sdp as RTCSessionDescriptionInit | undefined;
        if (!sdp?.type || !sdp?.sdp) return;

        const peer = await ensurePeer(from);
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
            from: userId,
            to: from,
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
        const to = String(payload?.to ?? "");
        if (to !== userId) return;
        const from = String(payload?.from ?? "");
        if (!from) return;
        const sdp = payload?.sdp as RTCSessionDescriptionInit | undefined;
        if (!sdp?.type || !sdp?.sdp) return;

        const peer = await ensurePeer(from);
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
        const to = String(payload?.to ?? "");
        if (to !== userId) return;
        const from = String(payload?.from ?? "");
        if (!from) return;
        const candidate = payload?.candidate as RTCIceCandidateInit | undefined;
        if (!candidate?.candidate) return;

        const peer = await ensurePeer(from);
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
    const localUserId = args.userId;
    if (!state.isReady || !localUserId) return;

    const remotes = state.participants
      .map((p) => p.userId)
      .filter((id) => id && id !== localUserId);

    for (const remoteUserId of remotes) {
      if (!peersRef.current.has(remoteUserId)) {
        void ensurePeer(remoteUserId).then((peer) => {
          if (!peer) return;
          if (isOfferInitiator(localUserId, remoteUserId)) {
            void startOffer(remoteUserId);
          }
        });
      }
    }

    for (const existing of Array.from(peersRef.current.keys())) {
      if (!remotes.includes(existing)) closePeer(existing);
    }
  }, [args.userId, closePeer, ensurePeer, startOffer, state.isReady, state.participants]);

  return {
    ...state,
    enableCamera,
    disableCamera,
    enableMic,
    disableMic,
  };
}
