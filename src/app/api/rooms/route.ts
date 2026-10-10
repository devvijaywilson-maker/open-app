import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { broadcastRoomUpdate } from "@/lib/roomEvents";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
};

export interface ClipboardFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: number;
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

// Ephemeral temporary storage in system temp directory (outside project directory)
const BASE_STORAGE_DIR =
  process.env.TEMP_STORAGE_DIR || path.join(os.tmpdir(), "open-app-temp-storage");
const ROOMS_DIR = path.join(BASE_STORAGE_DIR, "rooms");

function ensureRoomsDir(): string {
  if (!fs.existsSync(ROOMS_DIR)) {
    fs.mkdirSync(ROOMS_DIR, { recursive: true });
  }
  return ROOMS_DIR;
}

function findRoomOnDisk(code: string): { room: RoomData; filePath: string } | null {
  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  ensureRoomsDir();

  // 1. Check direct room path
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

  // 2. Check subfolders (legacy migration from earlier IP-folder structure)
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
          // Migrate to main rooms dir
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
      { headers: NO_CACHE_HEADERS }
    );
  }

  const code = searchParams.get("code")?.toUpperCase().trim();
  if (!code) {
    return NextResponse.json({ error: "Room code required" }, { status: 400 });
  }

  const found = findRoomOnDisk(code);
  if (!found) {
    return NextResponse.json({ error: "Room not found", isNew: true }, { status: 404 });
  }

  const { room, filePath } = found;

  // Check PIN if passcode protected
  const pin = searchParams.get("pin");
  if (room.pin && room.pin !== pin) {
    return NextResponse.json(
      { error: "Passcode required", isProtected: true },
      { status: 401, headers: NO_CACHE_HEADERS }
    );
  }

  // Handle self-destruct (burn after reading)
  if (room.selfDestruct && room.views && room.views >= 1) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return NextResponse.json({ error: "Room self-destructed." }, { status: 410, headers: NO_CACHE_HEADERS });
  }

  room.views = (room.views || 0) + 1;
  fs.writeFileSync(filePath, JSON.stringify(room, null, 2), "utf-8");

  return NextResponse.json(
    {
      code: room.code,
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
    { headers: NO_CACHE_HEADERS }
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
      language = "plaintext",
      pin,
      files = [],
      expiryMinutes = 120, // default 2 hours temporary
      selfDestruct = false,
    } = body;

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
    }

    const cleanCode = code.toUpperCase().trim().replace(/[^A-Z0-9_-]/g, "");
    const found = findRoomOnDisk(cleanCode);
    const existing = found?.room;

    // Validate PIN if passcode is enabled on existing room
    if (existing?.pin && existing.pin !== pin) {
      return NextResponse.json({ error: "Invalid passcode" }, { status: 401, headers: NO_CACHE_HEADERS });
    }

    const now = Date.now();
    let expiresAt: number | null = null;
    if (expiryMinutes > 0) {
      expiresAt = now + expiryMinutes * 60 * 1000;
    }

    const finalKey =
      existing?.roomKey || roomKey || Math.random().toString(36).substring(2, 12);

    const updatedRoom: RoomData = {
      code: cleanCode,
      roomKey: finalKey,
      text: String(text),
      language: String(language),
      pin: pin !== undefined ? (pin || undefined) : existing?.pin,
      files: Array.isArray(files) ? files : existing?.files || [],
      updatedAt: now,
      expiresAt: expiresAt,
      selfDestruct: Boolean(selfDestruct),
      views: existing?.views || 0,
    };

    const targetPath = path.join(ROOMS_DIR, `${cleanCode}.json`);
    fs.writeFileSync(targetPath, JSON.stringify(updatedRoom, null, 2), "utf-8");

    // Instant real-time push to all connected computers & mobile devices in this room
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
      { headers: NO_CACHE_HEADERS }
    );
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to save room: " + err.message }, { status: 500 });
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

  return NextResponse.json({ success: true, message: `Room ${cleanCode} deleted` }, { headers: NO_CACHE_HEADERS });
}
