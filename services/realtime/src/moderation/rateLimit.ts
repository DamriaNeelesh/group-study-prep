import type { RedisClientType } from "redis";

type ConsumeResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

const LUA_TOKEN_BUCKET = `
-- KEYS[1] = key
-- ARGV[1] = nowMs
-- ARGV[2] = capacity
-- ARGV[3] = refillPerSec
-- ARGV[4] = ttlMs
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillPerSec = tonumber(ARGV[3])
local ttlMs = tonumber(ARGV[4])

local data = redis.call("HMGET", key, "tokens", "ts")
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then tokens = capacity end
if ts == nil then ts = nowMs end

local elapsed = nowMs - ts
if elapsed < 0 then elapsed = 0 end

local refill = (elapsed / 1000.0) * refillPerSec
tokens = math.min(capacity, tokens + refill)

if tokens < 1.0 then
  -- How long until we have 1 token?
  local missing = 1.0 - tokens
  local retryAfterMs = math.ceil((missing / refillPerSec) * 1000.0)
  redis.call("HMSET", key, "tokens", tokens, "ts", nowMs)
  redis.call("PEXPIRE", key, ttlMs)
  return {0, retryAfterMs}
end

tokens = tokens - 1.0
redis.call("HMSET", key, "tokens", tokens, "ts", nowMs)
redis.call("PEXPIRE", key, ttlMs)
return {1, 0}
`;

export async function consumeTokenBucket(
  redis: RedisClientType<any, any, any>,
  key: string,
  opts: { nowMs: number; capacity: number; refillPerSec: number; ttlMs: number },
): Promise<ConsumeResult> {
  const res = (await redis.eval(LUA_TOKEN_BUCKET, {
    keys: [key],
    arguments: [
      String(opts.nowMs),
      String(opts.capacity),
      String(opts.refillPerSec),
      String(opts.ttlMs),
    ],
  })) as unknown as [number, number];

  const allowed = Number(res?.[0] ?? 0) === 1;
  const retryAfterMs = Number(res?.[1] ?? 0);
  return allowed ? { allowed: true } : { allowed: false, retryAfterMs };
}
