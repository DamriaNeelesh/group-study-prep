"use client";

import { useEffect } from "react";

export function Toast(props: {
  message: string;
  onDismiss: () => void;
  durationMs?: number;
}) {
  const durationMs = props.durationMs ?? 3000;

  useEffect(() => {
    const id = setTimeout(() => props.onDismiss(), durationMs);
    return () => clearTimeout(id);
  }, [durationMs, props]);

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        className="rounded-full border border-white/15 bg-black/70 px-5 py-2 text-sm font-semibold text-white shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur"
      >
        {props.message}
      </div>
    </div>
  );
}
