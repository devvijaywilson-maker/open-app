// In-memory event subscriber registry for Server-Sent Events (SSE)

type Listener = (data: any) => void;

declare global {
  // Use globalThis to persist subscribers across module reloads in Next.js dev server
  var __roomSubscribers: Map<string, Set<Listener>> | undefined;
}

if (!globalThis.__roomSubscribers) {
  globalThis.__roomSubscribers = new Map<string, Set<Listener>>();
}

const roomSubscribers = globalThis.__roomSubscribers;

export function subscribeToRoom(code: string, listener: Listener): () => void {
  const cleanCode = code.toUpperCase().trim();
  if (!roomSubscribers.has(cleanCode)) {
    roomSubscribers.set(cleanCode, new Set());
  }

  roomSubscribers.get(cleanCode)!.add(listener);

  return () => {
    const listeners = roomSubscribers.get(cleanCode);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        roomSubscribers.delete(cleanCode);
      }
    }
  };
}

export function broadcastRoomUpdate(code: string, payload: any) {
  const cleanCode = code.toUpperCase().trim();
  const listeners = roomSubscribers.get(cleanCode);
  if (listeners) {
    listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.error("Error in room event listener:", err);
      }
    });
  }
}
