import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

// 100MB limit
const MAX_SIZE = 100 * 1024 * 1024;

// Use a persistent temp directory inside os.tmpdir() for the lifetime of the process
const UPLOAD_DIR = path.join(os.tmpdir(), "open-app-uploads");

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeFileName(name: string): string {
  const base = (name.split(/[/\\]/).pop() || "").replace(
    /[\u0000-\u001f\u007f]/g,
    "",
  );
  return base.replace(/^\.+/, "").trim().slice(0, 200) || "file";
}

function escapeFileName(name: string): string {
  return name.replace(/["\\\\\\r\\n]/g, "_") || "file";
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const chunk = formData.get("chunk") as File | null;
    const directFile = formData.get("file") as File | null;
    const file = chunk || directFile;

    if (!file) {
      return NextResponse.json(
        { error: "No file content provided" },
        { status: 400 },
      );
    }

    const rawFileId =
      (formData.get("fileId") as string) ||
      "file_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).substring(2, 7);
    const cleanId = rawFileId.replace(/[^a-zA-Z0-9_-]/g, "");

    const chunkIndex = parseInt(
      (formData.get("chunkIndex") as string) || "0",
      10,
    );
    const totalChunks = parseInt(
      (formData.get("totalChunks") as string) || "1",
      10,
    );
    const fileName = sanitizeFileName(
      (formData.get("fileName") as string) || file.name || "uploaded_file",
    );
    const fileSize = parseInt(
      (formData.get("fileSize") as string) || String(file.size),
      10,
    );
    const fileType =
      (formData.get("fileType") as string) ||
      file.type ||
      "application/octet-stream";

    if (fileSize > MAX_SIZE) {
      return NextResponse.json(
        {
          error: `File exceeds maximum allowed size of 100MB (${(fileSize / (1024 * 1024)).toFixed(1)}MB)`,
        },
        { status: 413 },
      );
    }

    const fileDir = path.join(UPLOAD_DIR, cleanId);
    ensureDir(fileDir);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (totalChunks === 1) {
      // Single chunk — write directly
      const filePath = path.join(fileDir, fileName);
      fs.writeFileSync(filePath, buffer);

      const meta = {
        id: cleanId,
        name: fileName,
        size: fileSize,
        type: fileType,
        uploadedAt: Date.now(),
        pathname: filePath,
      };

      // Write meta JSON
      fs.writeFileSync(
        path.join(fileDir, "meta.json"),
        JSON.stringify(meta),
      );

      return NextResponse.json({
        success: true,
        complete: true,
        file: meta,
      });
    }

    // Multi-chunk: write each chunk to disk
    const chunksDir = path.join(fileDir, "_chunks");
    ensureDir(chunksDir);

    const chunkFileName = `chunk_${String(chunkIndex).padStart(5, "0")}`;
    fs.writeFileSync(path.join(chunksDir, chunkFileName), buffer);

    const isComplete = chunkIndex >= totalChunks - 1;

    if (isComplete) {
      // Reassemble all chunks
      const chunks: Buffer[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(
          chunksDir,
          `chunk_${String(i).padStart(5, "0")}`,
        );
        if (!fs.existsSync(chunkPath)) {
          return NextResponse.json(
            { error: `Chunk ${i} not found` },
            { status: 500 },
          );
        }
        chunks.push(fs.readFileSync(chunkPath));
      }

      const combined = Buffer.concat(chunks);
      const finalPath = path.join(fileDir, fileName);
      fs.writeFileSync(finalPath, combined);

      const meta = {
        id: cleanId,
        name: fileName,
        size: combined.length,
        type: fileType,
        uploadedAt: Date.now(),
        pathname: finalPath,
      };

      fs.writeFileSync(
        path.join(fileDir, "meta.json"),
        JSON.stringify(meta),
      );

      // Clean up chunks directory (fire and forget)
      try {
        fs.rmSync(chunksDir, { recursive: true, force: true });
      } catch {}

      return NextResponse.json({
        success: true,
        complete: true,
        file: meta,
      });
    }

    // Intermediate chunk uploaded successfully
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
      { status: 500 },
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
  if (!cleanId) {
    return NextResponse.json({ error: "Invalid fileId" }, { status: 400 });
  }

  const fileDir = path.join(UPLOAD_DIR, cleanId);

  if (!fs.existsSync(fileDir)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // Read meta.json to get the actual filename and type
  const metaPath = path.join(fileDir, "meta.json");
  let meta: { name: string; type: string; pathname: string } | null = null;

  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch {}
  }

  // Fallback: pick first non-meta file
  let filePath: string | null = meta?.pathname || null;
  if (!filePath || !fs.existsSync(filePath)) {
    const files = fs
      .readdirSync(fileDir)
      .filter((f) => f !== "meta.json" && !f.startsWith("_"));
    if (files.length === 0) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    filePath = path.join(fileDir, files[0]);
  }

  const fileName = escapeFileName(path.basename(filePath));
  const contentType = meta?.type || "application/octet-stream";
  const fileBuffer = fs.readFileSync(filePath);

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set(
    "Content-Disposition",
    `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  headers.set("Content-Length", String(fileBuffer.length));
  headers.set("Cache-Control", "no-store");

  return new Response(fileBuffer, { status: 200, headers });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");

  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const cleanId = fileId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleanId) {
    return NextResponse.json({ error: "Invalid fileId" }, { status: 400 });
  }

  const fileDir = path.join(UPLOAD_DIR, cleanId);

  try {
    if (fs.existsSync(fileDir)) {
      fs.rmSync(fileDir, { recursive: true, force: true });
    }
    return NextResponse.json({
      success: true,
      message: `File ${cleanId} deleted`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Delete failed: " + err.message },
      { status: 500 },
    );
  }
}
