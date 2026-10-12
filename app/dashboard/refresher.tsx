"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** docs/06 §7b: refresh the server-rendered dashboard every 30 s (no websocket). */
export function Refresher({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
