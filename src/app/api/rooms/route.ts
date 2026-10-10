import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { broadcastRoomUpdate } from "@/lib/roomEvents";
import { getClientIp, getSafeIpDir } from "@/lib/clientIp";

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
  ownerIp: string;
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
  process.env.TEMP_STORAGE_DIR || path.join(os.tmpdir(), "open-app-temp-storage");
const ROOMS_DIR = path.join(BASE_STORAGE_DIR, "rooms");

function ensureRoomsDir(safeIp: string): string {
  const ipDir = path.join(ROOMS_DIR, safeIp);
  if (!fs.existsSync(ipDir)) {
    fs.mkdirSync(ipDir, { recursive: true });
  }
  return ipDir;
}

function findRoomOnDisk(code: string, currentSafeIp: string): { room: RoomData; ipDir: string } | null {
  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9_-]/g, "");

  // 1. Check current IP directory first
  const currentIpDir = path.join(ROOMS_DIR, currentSafeIp);
  const currentPath = path.join(currentIpDir, `${cleanCode}.json`);
  if (fs.existsSync(currentPath)) {
    try {
      const raw = fs.readFileSync(currentPath, "utf-8");
      const room: RoomData = JSON.parse(raw);
      if (room.expiresAt && room.expiresAt < Date.now()) {
        fs.unlinkSync(currentPath);
        return null;
      }
      return { room, ipDir: currentIpDir };
    } catch {}
  }

  // 2. Search across other IP directories to see if room exists on another system
  if (!fs.existsSync(ROOMS_DIR)) return null;
  const ipDirs = fs.readdirSync(ROOMS_DIR);
  for (const ipFolder of ipDirs) {
    if (ipFolder === currentSafeIp) continue;
    const testPath = path.join(ROOMS_DIR, ipFolder, `${cleanCode}.json`);
    if (fs.existsSync(testPath)) {
      try {
        const raw = fs.readFileSync(testPath, "utf-8");
        const room: RoomData = JSON.parse(raw);
        if (room.expiresAt && room.expiresAt < Date.now()) {
          fs.unlinkSync(testPath);
          continue;
        }
        return { room, ipDir: path.join(ROOMS_DIR, ipFolder) };
      } catch {}
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const safeIp = getSafeIpDir(clientIp);
  const { searchParams } = new URL(request.url);

  // Listing rooms: ONLY return rooms belonging to THIS computer system's IP!
  if (searchParams.get("list") === "true") {
    const ipDir = path.join(ROOMS_DIR, safeIp);
    const roomsList: Array<{
      code: string;
      roomKey: string;
      updatedAt: number;
      fileCount: number;
      textLength: number;
      language: string;
      isProtected: boolean;
    }> = [];

    if (fs.existsSync(ipDir)) {
      const files = fs.readdirSync(ipDir);
      const now = Date.now();
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const filePath = path.join(ipDir, file);
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
    }

    return NextResponse.json(
      { rooms: roomsList.sort((a, b) => b.updatedAt - a.updatedAt) },
      { headers: NO_CACHE_HEADERS }
    );
  }

  const code = searchParams.get("code")?.toUpperCase().trim();
  if (!code) {
    return NextResponse.json({ error: "Room code required" }, { status: 400 });
  }

  const found = findRoomOnDisk(code, safeIp);
  if (!found) {
    return NextResponse.json({ error: "Room not found", isNew: true }, { status: 404 });
  }

  const { room, ipDir } = found;

  // System-wise IP authorization check:
  // If the room was created on a different computer / IP:
  // Allow access ONLY if the request contains the valid roomKey (e.g. from QR code or direct share link)
  const providedKey = searchParams.get("key");
  const isSameIp = room.ownerIp === clientIp || room.ownerIp === "127.0.0.1" || clientIp === "127.0.0.1";
  const hasValidKey = room.roomKey && providedKey === room.roomKey;

  if (!isSameIp && !hasValidKey) {
    return NextResponse.json(
      {
        error: "Access restricted: This room belongs to another computer system.",
        isSystemRestricted: true,
      },
      { status: 403, headers: NO_CACHE_HEADERS }
    );
  }

  // Check PIN if protected
  const pin = searchParams.get("pin");
  if (room.pin && room.pin !== pin) {
    return NextResponse.json(
      { error: "Passcode required", isProtected: true },
      { status: 401, headers: NO_CACHE_HEADERS }
    );
  }

  // Handle self-destruct
  if (room.selfDestruct && room.views && room.views >= 1) {
    const filePath = path.join(ipDir, `${code}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return NextResponse.json({ error: "Room self-destructed." }, { status: 410, headers: NO_CACHE_HEADERS });
  }

  room.views = (room.views || 0) + 1;
  const filePath = path.join(ipDir, `${code}.json`);
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
    const clientIp = getClientIp(request);
    const safeIp = getSafeIpDir(clientIp);

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

    const cleanCode = code.toUpperCase().trim();
    const found = findRoomOnDisk(cleanCode, safeIp);

    // If room exists on a different IP, check key authorization
    if (found && found.room.ownerIp !== clientIp && clientIp !== "127.0.0.1" && found.room.ownerIp !== "127.0.0.1") {
      if (!found.room.roomKey || roomKey !== found.room.roomKey) {
        return NextResponse.json(
          { error: "Access denied: Cannot overwrite another computer's room" },
          { status: 403, headers: NO_CACHE_HEADERS }
        );
      }
    }

    const existing = found?.room;

    if (existing?.pin && existing.pin !== pin) {
      return NextResponse.json({ error: "Invalid passcode" }, { status: 401, headers: NO_CACHE_HEADERS });
    }

    const now = Date.now();
    let expiresAt: number | null = null;
    if (expiryMinutes > 0) {
      expiresAt = now + expiryMinutes * 60 * 1000;
    }

    // Save under the creator's IP folder
    const targetIpDir = found?.ipDir || ensureRoomsDir(safeIp);

    // Generate or preserve security roomKey
    const finalKey =
      existing?.roomKey || roomKey || Math.random().toString(36).substring(2, 12);

    const updatedRoom: RoomData = {
      code: cleanCode,
      roomKey: finalKey,
      ownerIp: existing?.ownerIp || clientIp,
      text: String(text),
      language: String(language),
      pin: pin !== undefined ? (pin || undefined) : existing?.pin,
      files: Array.isArray(files) ? files : existing?.files || [],
      updatedAt: now,
      expiresAt: expiresAt,
      selfDestruct: Boolean(selfDestruct),
      views: existing?.views || 0,
    };

    const targetPath = path.join(targetIpDir, `${cleanCode}.json`);
    fs.writeFileSync(targetPath, JSON.stringify(updatedRoom, null, 2), "utf-8");

    // Instant real-time push to all connected devices in this room
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
  const clientIp = getClientIp(request);
  const safeIp = getSafeIpDir(clientIp);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.toUpperCase().trim();

  if (!code) {
    return NextResponse.json({ error: "Room code required" }, { status: 400 });
  }

  const found = findRoomOnDisk(code, safeIp);
  if (found) {
    const filePath = path.join(found.ipDir, `${code}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  return NextResponse.json({ success: true, message: `Room ${code} deleted` }, { headers: NO_CACHE_HEADERS });
}
