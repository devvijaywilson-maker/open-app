import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

// Ephemeral temporary storage in system temp directory (outside project directory)
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
    const chunk = formData.get("chunk") as File | null;
    const directFile = formData.get("file") as File | null;
    const file = chunk || directFile;

    if (!file) {
      return NextResponse.json({ error: "No file content provided" }, { status: 400 });
    }

    const rawFileId = (formData.get("fileId") as string) || ("file_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 7));
    const cleanId = rawFileId.replace(/[^a-zA-Z0-9_-]/g, "");

    const chunkIndex = parseInt((formData.get("chunkIndex") as string) || "0", 10);
    const totalChunks = parseInt((formData.get("totalChunks") as string) || "1", 10);
    const fileName = (formData.get("fileName") as string) || file.name || "uploaded_file";
    const fileSize = parseInt((formData.get("fileSize") as string) || String(file.size), 10);
    const fileType = (formData.get("fileType") as string) || file.type || "application/octet-stream";

    // 100MB limit validation
    const MAX_SIZE = 100 * 1024 * 1024;
    if (fileSize > MAX_SIZE) {
      return NextResponse.json(
        { error: `File exceeds maximum allowed size of 100MB (${(fileSize / (1024 * 1024)).toFixed(1)}MB)` },
        { status: 413 }
      );
    }

    const filePath = path.join(FILES_DIR, cleanId);
    const metaPath = path.join(FILES_DIR, `${cleanId}.meta.json`);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (chunkIndex === 0) {
      fs.writeFileSync(filePath, buffer);
    } else {
      fs.appendFileSync(filePath, buffer);
    }

    const isComplete = chunkIndex >= totalChunks - 1;

    if (isComplete) {
      const meta = {
        id: cleanId,
        name: fileName,
        size: fileSize,
        type: fileType,
        uploadedAt: Date.now(),
      };

      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

      return NextResponse.json({
        success: true,
        complete: true,
        file: meta,
      });
    }

    return NextResponse.json({
      success: true,
      complete: false,
      chunkIndex,
      totalChunks,
      fileId: cleanId,
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

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }

  if (fs.existsSync(metaPath)) {
    try {
      fs.unlinkSync(metaPath);
    } catch {}
  }

  return NextResponse.json({ success: true, message: `File ${cleanId} deleted` });
}
