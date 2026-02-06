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
      <div className="rounded-full bg-zinc-900/90 px-5 py-2 text-sm text-white shadow-lg">
        {props.message}
      </div>
    </div>
  );
}

