import { NextRequest, NextResponse } from "next/server";
import { put, del, list, get } from "@vercel/blob";

// 100MB limit
const MAX_SIZE = 100 * 1024 * 1024;

// Private blobs live on `<storeId>.private.blob.vercel-storage.com` and every read
// requires `authorization: Bearer <BLOB_READ_WRITE_TOKEN>`. The token is resolved
// server-side by the SDK, so blob content must always be streamed through this
// route — raw URLs are never handed to the browser.
const BLOB_ACCESS = "private" as const;

// The blob pathname is the only handle that addresses content in the store, so it is
// treated as a security boundary: no path separators, no traversal, no control chars.
function sanitizeFileName(name: string): string {
  const base = (name.split(/[/\\]/).pop() || "").replace(
    /[\u0000-\u001f\u007f]/g,
    "",
  );
  return base.replace(/^\.+/, "").trim().slice(0, 200) || "file";
}

// Reads a private blob fully into memory. Used for chunk reassembly, where the parts
// must be concatenated before uploading the final object.
async function readBlobBuffer(pathname: string): Promise<Buffer> {
  const result = await get(pathname, { access: BLOB_ACCESS });
  if (!result || !result.stream) {
    throw new Error(`blob not found: ${pathname}`);
  }
  const arrayBuffer = await new Response(
    result.stream as unknown as ReadableStream,
  ).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Reads a blob for streaming to the client. Blobs uploaded before this route switched to
// private access live on the public host, so a failed private read falls back to public.
// Callers must validate the pathname prefix first — this helper does not.
async function readBlobForDownload(pathname: string) {
  try {
    const privateRead = await get(pathname, { access: BLOB_ACCESS });
    if (privateRead && privateRead.stream) {
      return privateRead;
    }
  } catch {
    // Fall through to the legacy public read.
  }

  try {
    const publicRead = await get(pathname, { access: "public" });
    if (publicRead && publicRead.stream) {
      return publicRead;
    }
  } catch {
    // Unreadable either way.
  }

  return null;
}

// Quotes and control characters would break the Content-Disposition header.
function escapeFileName(name: string): string {
  return name.replace(/["\\\r\n]/g, "_") || "file";
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

    if (totalChunks === 1) {
      // Single chunk — upload directly to Vercel Blob as a private object
      const blob = await put(`uploads/${cleanId}/${fileName}`, file, {
        access: BLOB_ACCESS,
        contentType: fileType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });

      const meta = {
        id: cleanId,
        name: fileName,
        size: fileSize,
        type: fileType,
        uploadedAt: Date.now(),
        pathname: blob.pathname,
      };

      return NextResponse.json({
        success: true,
        complete: true,
        file: meta,
      });
    }

    // Multi-chunk: store each chunk as a temporary private blob
    const chunkBlobPath = `uploads/${cleanId}/_chunks/chunk_${String(chunkIndex).padStart(5, "0")}`;
    await put(chunkBlobPath, file, {
      access: BLOB_ACCESS,
      contentType: "application/octet-stream",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    const isComplete = chunkIndex >= totalChunks - 1;

    if (isComplete) {
      // Download all chunks in order and combine them. `get()` attaches the bearer
      // token that private blobs require; a bare fetch() against the blob URL would 401.
      const chunks: Buffer[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = `uploads/${cleanId}/_chunks/chunk_${String(i).padStart(5, "0")}`;
        try {
          chunks.push(await readBlobBuffer(chunkPath));
        } catch (err) {
          return NextResponse.json(
            { error: `Failed to retrieve chunk ${i}` },
            { status: 500 },
          );
        }
      }

      const combinedBuffer = Buffer.concat(chunks);

      // Upload the combined file
      const blob = await put(`uploads/${cleanId}/${fileName}`, combinedBuffer, {
        access: BLOB_ACCESS,
        contentType: fileType,
        addRandomSuffix: false,
        allowOverwrite: true,
        multipart: true,
      });

      // Clean up temporary chunk blobs (fire and forget)
      cleanupChunks(cleanId, totalChunks).catch(() => {});

      const meta = {
        id: cleanId,
        name: fileName,
        size: fileSize,
        type: fileType,
        uploadedAt: Date.now(),
        pathname: blob.pathname,
      };

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

// Clean up temporary chunk blobs after successful assembly.
// `del()` forwards its input verbatim as `urls` to the control plane (it does NOT
// translate pathnames), so the concrete URLs are resolved via `list()` first.
async function cleanupChunks(cleanId: string, totalChunks: number) {
  const urlsToDelete: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = `uploads/${cleanId}/_chunks/chunk_${String(i).padStart(5, "0")}`;
    try {
      const result = await list({ prefix: chunkPath, limit: 1 });
      if (result.blobs.length > 0) {
        urlsToDelete.push(result.blobs[0].url);
      }
    } catch {
      // Ignore individual lookup errors
    }
  }
  if (urlsToDelete.length > 0) {
    await del(urlsToDelete);
  }
}

// Private blobs cannot be redirected to — their host requires a bearer token that must
// never reach the browser. Content is streamed through this handler instead.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");
  const requestedPathname = searchParams.get("pathname");

  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const cleanId = fileId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleanId) {
    return NextResponse.json({ error: "Invalid fileId" }, { status: 400 });
  }

  const allowedPrefix = `uploads/${cleanId}/`;

  // A client-supplied pathname is accepted only when it stays inside this file's own
  // folder. Without that check any object in the store could be read by pathname.
  let pathname: string | null = null;

  if (
    requestedPathname &&
    requestedPathname.startsWith(allowedPrefix) &&
    !requestedPathname.includes("/_chunks/")
  ) {
    pathname = requestedPathname;
  } else {
    try {
      const result = await list({ prefix: allowedPrefix, limit: 10 });
      const mainBlob = result.blobs.find(
        (b) => !b.pathname.includes("/_chunks/"),
      );
      if (mainBlob) {
        pathname = mainBlob.pathname;
      }
    } catch {
      // Fall through to 404
    }
  }

  if (!pathname) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const fetched = await readBlobForDownload(pathname);
    if (!fetched || !fetched.stream) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const downloadName = escapeFileName(
      pathname.split("/").pop() || "download",
    );

    const headers = new Headers();
    headers.set(
      "Content-Type",
      fetched.blob.contentType || "application/octet-stream",
    );
    headers.set(
      "Content-Disposition",
      `attachment; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    );
    headers.set("Cache-Control", "no-store");

    return new Response(fetched.stream as unknown as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Download failed: " + message },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");

  // Deleting by raw URL is intentionally not supported: it would let any caller pass an
  // arbitrary store URL. Everything is scoped to the caller's own file folder prefix.
  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const cleanId = fileId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleanId) {
    return NextResponse.json({ error: "Invalid fileId" }, { status: 400 });
  }

  try {
    const result = await list({ prefix: `uploads/${cleanId}/` });
    if (result.blobs.length > 0) {
      await del(result.blobs.map((b) => b.url));
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
