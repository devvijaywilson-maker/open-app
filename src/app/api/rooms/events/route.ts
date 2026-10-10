import { NextRequest } from "next/server";
import { subscribeToRoom } from "@/lib/roomEvents";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.toUpperCase().trim();

  if (!code) {
    return new Response("Room code required", { status: 400 });
  }

  let cleanup: (() => void) | null = null;
  let isClosed = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connected event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ status: "connected", code })}\n\n`)
      );

      // Heartbeat ping every 15s to keep mobile connection alive through firewalls/proxies
      heartbeatTimer = setInterval(() => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          isClosed = true;
        }
      }, 15000);

      // Subscribe to real-time room updates
      cleanup = subscribeToRoom(code, (data) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          isClosed = true;
        }
      });
    },
    cancel() {
      isClosed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform, no-store, must-revalidate",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disables proxy buffering
    },
  });
}
