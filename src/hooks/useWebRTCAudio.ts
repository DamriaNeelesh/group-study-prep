"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import Peer from "simple-peer";
import { useEffect, useMemo, useRef, useState } from "react";

type SignalPayload = {
  to: string;
  from: string;
  signalData: SignalData;
};

type PeerInstance = InstanceType<typeof Peer>;
type SignalData = Parameters<PeerInstance["signal"]>[0];

function asSignalPayload(x: unknown): SignalPayload | null {
  if (!x || typeof x !== "object") return null;
  const anyX = x as Record<string, unknown>;
  const to = typeof anyX.to === "string" ? anyX.to : null;
  const from = typeof anyX.from === "string" ? anyX.from : null;
  const signalData = anyX.signalData as SignalData | undefined;
  if (!to || !from || !signalData) return null;
  return { to, from, signalData };
}

export function useWebRTCAudio(args: {
  channel: RealtimeChannel | null;
  selfUserId: string | null;
  localStream: MediaStream | null;
  remoteAudioUserIds: string[];
}) {
  const channel = args.channel;
  const selfUserId = args.selfUserId;
  const localStream = args.localStream;
  const localStreamRef = useRef<MediaStream | null>(null);

  const desiredRemoteIdsKey = useMemo(() => {
    const ids = [...args.remoteAudioUserIds].filter(Boolean).sort();
    return JSON.stringify(ids);
  }, [args.remoteAudioUserIds]);

  const peersRef = useRef<Map<string, PeerInstance>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>(
    {},
  );
  const [peerCount, setPeerCount] = useState(0);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    if (!channel || !selfUserId) return;

    let cancelled = false;

    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      if (cancelled) return;
      const msg = asSignalPayload(payload);
      if (!msg) return;
      if (msg.to !== selfUserId) return;
      if (msg.from === selfUserId) return;
      const localStreamNow = localStreamRef.current;
      if (!localStreamNow) return;

      let peer = peersRef.current.get(msg.from);
      if (!peer) {
        peer = new Peer({
          initiator: false,
          trickle: false,
          stream: localStreamNow,
        });
        peersRef.current.set(msg.from, peer);
        setPeerCount(peersRef.current.size);

        peer.on("signal", (signalData) => {
          void channel.send({
            type: "broadcast",
            event: "signal",
            payload: { to: msg.from, from: selfUserId, signalData } satisfies SignalPayload,
          });
        });

        peer.on("stream", (stream) => {
          setRemoteStreams((s) => ({ ...s, [msg.from]: stream }));
        });

        const cleanup = () => {
          try {
            peer?.destroy();
          } catch {
            // ignore
          }
          peersRef.current.delete(msg.from);
          setPeerCount(peersRef.current.size);
          setRemoteStreams((s) => {
            const next = { ...s };
            delete next[msg.from];
            return next;
          });
        };

        peer.on("close", cleanup);
        peer.on("error", cleanup);
      }

      try {
        peer.signal(msg.signalData);
      } catch {
        // ignore
      }
    });

    return () => {
      cancelled = true;
    };
  }, [channel, selfUserId]);

  useEffect(() => {
    if (!channel || !selfUserId || !localStream) return;

    const desired = new Set<string>(
      JSON.parse(desiredRemoteIdsKey).filter((id: string) => id !== selfUserId),
    );

    // Create missing peers.
    for (const otherId of desired) {
      if (peersRef.current.has(otherId)) continue;

      const initiator = selfUserId.localeCompare(otherId) < 0;
      const peer = new Peer({
        initiator,
        trickle: false,
        stream: localStream,
      });
      peersRef.current.set(otherId, peer);
      setPeerCount(peersRef.current.size);

      peer.on("signal", (signalData) => {
        void channel.send({
          type: "broadcast",
          event: "signal",
          payload: { to: otherId, from: selfUserId, signalData } satisfies SignalPayload,
        });
      });

      peer.on("stream", (stream) => {
        setRemoteStreams((s) => ({ ...s, [otherId]: stream }));
      });

      const cleanup = () => {
        try {
          peer.destroy();
        } catch {
          // ignore
        }
        peersRef.current.delete(otherId);
        setPeerCount(peersRef.current.size);
        setRemoteStreams((s) => {
          const next = { ...s };
          delete next[otherId];
          return next;
        });
      };

      peer.on("close", cleanup);
      peer.on("error", cleanup);
    }

    // Remove peers no longer desired.
    for (const [otherId, peer] of peersRef.current.entries()) {
      if (desired.has(otherId)) continue;
      try {
        peer.destroy();
      } catch {
        // ignore
      }
      peersRef.current.delete(otherId);
      setPeerCount(peersRef.current.size);
      setRemoteStreams((s) => {
        const next = { ...s };
        delete next[otherId];
        return next;
      });
    }
  }, [channel, desiredRemoteIdsKey, localStream, selfUserId]);

  // If localStream goes away, teardown all peers.
  useEffect(() => {
    if (localStream) return;
    const peers = [...peersRef.current.values()];
    peersRef.current.clear();
    for (const peer of peers) {
      try {
        peer.destroy();
      } catch {
        // ignore
      }
    }
  }, [localStream]);

  return {
    remoteStreams,
    peerCount,
  };
}
