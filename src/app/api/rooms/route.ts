import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { broadcastRoomUpdate } from "@/lib/roomEvents";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export interface ClipboardFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: number;
  // Blob pathname (never a public URL) — private blobs are streamed via /api/upload.
  pathname?: string;
}

export interface RoomData {
  code: string;
  roomKey: string;
  ownerIp?: string;
  text: string;
  language: string;
  pin?: string;
  files: ClipboardFile[];
  updatedAt: number;
  expiresAt: number | null;
  selfDestruct?: boolean;
  views?: number;
}

// Temporary storage located in system temp directory (outside project directory)
const BASE_STORAGE_DIR =
  process.env.TEMP_STORAGE_DIR ||
  path.join(os.tmpdir(), "open-app-temp-storage");
const ROOMS_DIR = path.join(BASE_STORAGE_DIR, "rooms");

function ensureRoomsDir(): string {
  if (!fs.existsSync(ROOMS_DIR)) {
    fs.mkdirSync(ROOMS_DIR, { recursive: true });
  }
  return ROOMS_DIR;
}

// Deterministic topic name for global cross-device synchronization
function getCloudTopic(code: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(code.toUpperCase())
    .digest("hex")
    .substring(0, 16);
  return `openapp_sync_${hash}`;
}

// Push room to global cloud sync (runs asynchronously)
async function pushToCloudSync(room: RoomData): Promise<void> {
  try {
    const topic = getCloudTopic(room.code);
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(room),
      signal: AbortSignal.timeout(3500),
    });
  } catch (err) {
    // Silent fallback to local disk
  }
}

// Pull latest room state from global cloud sync
async function pullFromCloudSync(code: string): Promise<RoomData | null> {
  try {
    const topic = getCloudTopic(code);
    const res = await fetch(`https://ntfy.sh/${topic}/json?poll=1`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const item = JSON.parse(lines[i]);
        if (item && item.message) {
          const room: RoomData = JSON.parse(item.message);
          if (room && room.code === code.toUpperCase()) {
            return room;
          }
        }
      } catch {}
    }
  } catch {}
  return null;
}

function findRoomOnDisk(
  code: string,
): { room: RoomData; filePath: string } | null {
  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  ensureRoomsDir();

  const directPath = path.join(ROOMS_DIR, `${cleanCode}.json`);
  if (fs.existsSync(directPath)) {
    try {
      const raw = fs.readFileSync(directPath, "utf-8");
      const room: RoomData = JSON.parse(raw);
      if (room.expiresAt && room.expiresAt < Date.now()) {
        fs.unlinkSync(directPath);
        return null;
      }
      return { room, filePath: directPath };
    } catch {}
  }

  // Scan subfolders if any
  try {
    const entries = fs.readdirSync(ROOMS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = path.join(ROOMS_DIR, entry.name, `${cleanCode}.json`);
        if (fs.existsSync(subPath)) {
          const raw = fs.readFileSync(subPath, "utf-8");
          const room: RoomData = JSON.parse(raw);
          if (room.expiresAt && room.expiresAt < Date.now()) {
            fs.unlinkSync(subPath);
            return null;
          }
          fs.writeFileSync(directPath, raw, "utf-8");
          try {
            fs.unlinkSync(subPath);
          } catch {}
          return { room, filePath: directPath };
        }
      }
    }
  } catch {}

  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  ensureRoomsDir();

  // Listing rooms: Return all active rooms stored on host disk
  if (searchParams.get("list") === "true") {
    const roomsList: Array<{
      code: string;
      roomKey: string;
      updatedAt: number;
      fileCount: number;
      textLength: number;
      language: string;
      isProtected: boolean;
    }> = [];

    const now = Date.now();

    try {
      const files = fs.readdirSync(ROOMS_DIR);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const filePath = path.join(ROOMS_DIR, file);
          const raw = fs.readFileSync(filePath, "utf-8");
          const room: RoomData = JSON.parse(raw);

          if (room.expiresAt && room.expiresAt < now) {
            fs.unlinkSync(filePath);
            continue;
          }

          roomsList.push({
            code: room.code,
            roomKey: room.roomKey || "",
            updatedAt: room.updatedAt || 0,
            fileCount: room.files?.length || 0,
            textLength: room.text?.length || 0,
            language: room.language || "plaintext",
            isProtected: Boolean(room.pin),
          });
        } catch {}
      }
    } catch {}

    return NextResponse.json(
      { rooms: roomsList.sort((a, b) => b.updatedAt - a.updatedAt) },
      { headers: NO_CACHE_HEADERS },
    );
  }

  const code = searchParams.get("code")?.toUpperCase().trim();
  if (!code) {
    return NextResponse.json({ error: "Room code required" }, { status: 400 });
  }

  let found = findRoomOnDisk(code);

  // If not found on local disk, check global cloud sync (enables multi-computer sync on Vercel)
  if (!found) {
    const cloudRoom = await pullFromCloudSync(code);
    if (cloudRoom) {
      const targetPath = path.join(ROOMS_DIR, `${code}.json`);
      fs.writeFileSync(targetPath, JSON.stringify(cloudRoom, null, 2), "utf-8");
      found = { room: cloudRoom, filePath: targetPath };
    }
  }

  if (!found) {
    // Return 200 with exists:false so browser devtools console has 0 errors
    return NextResponse.json(
      {
        code: code,
        exists: false,
        isNew: true,
        text: "",
        language: "typescript",
        files: [],
        isProtected: false,
        updatedAt: null,
      },
      { headers: NO_CACHE_HEADERS },
    );
  }

  const { room, filePath } = found;

  // Check PIN if passcode protected
  const pin = searchParams.get("pin");
  if (room.pin && room.pin !== pin) {
    return NextResponse.json(
      { error: "Passcode required", isProtected: true, exists: true },
      { status: 401, headers: NO_CACHE_HEADERS },
    );
  }

  // Handle self-destruct (burn after reading)
  if (room.selfDestruct && room.views && room.views >= 1) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return NextResponse.json(
      { error: "Room self-destructed." },
      { status: 410, headers: NO_CACHE_HEADERS },
    );
  }

  room.views = (room.views || 0) + 1;
  fs.writeFileSync(filePath, JSON.stringify(room, null, 2), "utf-8");

  return NextResponse.json(
    {
      code: room.code,
      exists: true,
      roomKey: room.roomKey,
      text: room.text,
      language: room.language,
      isProtected: Boolean(room.pin),
      files: room.files || [],
      updatedAt: room.updatedAt,
      expiresAt: room.expiresAt,
      selfDestruct: room.selfDestruct,
      views: room.views,
    },
    { headers: NO_CACHE_HEADERS },
  );
}

export async function POST(request: NextRequest) {
  try {
    ensureRoomsDir();
    const body = await request.json();
    const {
      code,
      roomKey,
      text = "",
      language = "typescript",
      pin,
      files = [],
      expiryMinutes = 120, // default 2 hours temporary
      selfDestruct = false,
    } = body;

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
    }

    const cleanCode = code
      .toUpperCase()
      .trim()
      .replace(/[^A-Z0-9_-]/g, "");
    let found = findRoomOnDisk(cleanCode);

    if (!found) {
      const cloudRoom = await pullFromCloudSync(cleanCode);
      if (cloudRoom) {
        found = {
          room: cloudRoom,
          filePath: path.join(ROOMS_DIR, `${cleanCode}.json`),
        };
      }
    }

    const existing = found?.room;

    // Validate PIN if passcode is enabled on existing room
    if (existing?.pin && existing.pin !== pin) {
      return NextResponse.json(
        { error: "Invalid passcode" },
        { status: 401, headers: NO_CACHE_HEADERS },
      );
    }

    const now = Date.now();
    let expiresAt: number | null = null;
    if (expiryMinutes > 0) {
      expiresAt = now + expiryMinutes * 60 * 1000;
    }

    const finalKey =
      existing?.roomKey ||
      roomKey ||
      Math.random().toString(36).substring(2, 12);

    const updatedRoom: RoomData = {
      code: cleanCode,
      roomKey: finalKey,
      text: String(text),
      language: String(language || "typescript"),
      pin: pin !== undefined ? pin || undefined : existing?.pin,
      files: Array.isArray(files) ? files : existing?.files || [],
      updatedAt: now,
      expiresAt: expiresAt,
      selfDestruct: Boolean(selfDestruct),
      views: existing?.views || 0,
    };

    // Save locally
    const targetPath = path.join(ROOMS_DIR, `${cleanCode}.json`);
    fs.writeFileSync(targetPath, JSON.stringify(updatedRoom, null, 2), "utf-8");

    // Push to global cloud sync (enables instant cross-computer sync on Vercel)
    pushToCloudSync(updatedRoom);

    // Broadcast via SSE to connected clients
    broadcastRoomUpdate(cleanCode, {
      code: cleanCode,
      roomKey: updatedRoom.roomKey,
      text: updatedRoom.text,
      language: updatedRoom.language,
      files: updatedRoom.files,
      updatedAt: updatedRoom.updatedAt,
      isProtected: Boolean(updatedRoom.pin),
    });

    return NextResponse.json(
      {
        success: true,
        code: cleanCode,
        roomKey: updatedRoom.roomKey,
        updatedAt: updatedRoom.updatedAt,
        expiresAt: updatedRoom.expiresAt,
        fileCount: updatedRoom.files.length,
      },
      { headers: NO_CACHE_HEADERS },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to save room: " + err.message },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.toUpperCase().trim();

  if (!code) {
    return NextResponse.json({ error: "Room code required" }, { status: 400 });
  }

  const cleanCode = code.replace(/[^A-Z0-9_-]/g, "");
  const found = findRoomOnDisk(cleanCode);
  if (found && fs.existsSync(found.filePath)) {
    fs.unlinkSync(found.filePath);
  }

  return NextResponse.json(
    { success: true, message: `Room ${cleanCode} deleted` },
    { headers: NO_CACHE_HEADERS },
  );
}
