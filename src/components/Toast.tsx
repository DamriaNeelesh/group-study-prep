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
        className="rounded-full px-5 py-2 text-sm font-semibold text-white shadow-lg"
        style={{ background: "rgba(77, 77, 77, 0.92)" }}
      >
        {props.message}
      </div>
    </div>
  );
}
