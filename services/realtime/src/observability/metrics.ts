import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export type Metrics = {
  registry: Registry;
  connectionsTotal: Counter<"result">;
  socketsConnected: Gauge;
  commandsTotal: Counter<"type">;
  authVerifyDurationMs: Histogram;
  roomStateFetchDurationMs: Histogram;
  redisOpDurationMs: Histogram<"op">;
};

export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const connectionsTotal = new Counter({
    name: "studyroom_connections_total",
    help: "Total socket connection attempts",
    labelNames: ["result"] as const,
    registers: [registry],
  });

  const socketsConnected = new Gauge({
    name: "studyroom_sockets_connected",
    help: "Current connected sockets",
    registers: [registry],
  });

  const commandsTotal = new Counter({
    name: "studyroom_room_commands_total",
    help: "Total room commands processed",
    labelNames: ["type"] as const,
    registers: [registry],
  });

  const authVerifyDurationMs = new Histogram({
    name: "studyroom_auth_verify_duration_ms",
    help: "JWT verify duration (ms)",
    buckets: [1, 2, 5, 10, 20, 50, 100, 250, 500, 1000],
    registers: [registry],
  });

  const roomStateFetchDurationMs = new Histogram({
    name: "studyroom_room_state_fetch_duration_ms",
    help: "Room state fetch duration (ms) (Redis + DB fallback)",
    buckets: [1, 2, 5, 10, 20, 50, 100, 250, 500, 1000],
    registers: [registry],
  });

  const redisOpDurationMs = new Histogram({
    name: "studyroom_redis_op_duration_ms",
    help: "Redis operation duration (ms)",
    labelNames: ["op"] as const,
    buckets: [0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500],
    registers: [registry],
  });

  return {
    registry,
    connectionsTotal,
    socketsConnected,
    commandsTotal,
    authVerifyDurationMs,
    roomStateFetchDurationMs,
    redisOpDurationMs,
  };
}

