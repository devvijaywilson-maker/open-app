import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

// Temporary storage located in system temp directory (outside project directory)
const BASE_STORAGE_DIR = process.env.TEMP_STORAGE_DIR || path.join(os.tmpdir(), "open-app-temp-storage");
const FILES_DIR = path.join(BASE_STORAGE_DIR, "files");

function ensureFilesDir() {
  if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
  }
}


export async function POST(request: NextRequest) {
  try {
    ensureFilesDir();
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Check size limit: 100MB
    const MAX_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `File exceeds maximum allowed size of 100MB (${(file.size / (1024 * 1024)).toFixed(1)}MB)` },
        { status: 413 }
      );
    }

    const fileId = "file_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 7);
    const filePath = path.join(FILES_DIR, fileId);
    const metaPath = path.join(FILES_DIR, `${fileId}.meta.json`);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    fs.writeFileSync(filePath, buffer);

    const meta = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      uploadedAt: Date.now(),
    };

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      file: meta,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Upload failed: " + err.message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");

  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const cleanId = fileId.replace(/[^a-zA-Z0-9_-]/g, "");
  const filePath = path.join(FILES_DIR, cleanId);
  const metaPath = path.join(FILES_DIR, `${cleanId}.meta.json`);

  if (!fs.existsSync(filePath) || !fs.existsSync(metaPath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const metaRaw = fs.readFileSync(metaPath, "utf-8");
  const meta = JSON.parse(metaRaw);

  const fileBuffer = fs.readFileSync(filePath);
  const uint8Array = new Uint8Array(fileBuffer);

  return new NextResponse(uint8Array, {
    headers: {
      "Content-Type": meta.type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(meta.name)}"`,
      "Content-Length": meta.size.toString(),
    },
  });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");

  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const cleanId = fileId.replace(/[^a-zA-Z0-9_-]/g, "");
  const filePath = path.join(FILES_DIR, cleanId);
  const metaPath = path.join(FILES_DIR, `${cleanId}.meta.json`);

  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);

  return NextResponse.json({ success: true });
}
