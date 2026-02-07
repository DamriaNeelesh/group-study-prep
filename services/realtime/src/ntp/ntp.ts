export type NtpPing = { t0: number };
export type NtpPong = { t0: number; t1: number; t2: number };

export function makeNtpPong(ping: NtpPing, nowMs: number): NtpPong {
  // For app-layer NTP we treat both receive/send times on server as "now".
  // If you want to be pedantic, capture two timestamps around your compute work.
  return { t0: ping.t0, t1: nowMs, t2: nowMs };
}

