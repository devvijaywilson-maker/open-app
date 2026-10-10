"use client";

import React, { useState, useRef } from "react";
import {
  UploadCloud,
  File,
  FileCode,
  FileText,
  Image as ImageIcon,
  Archive,
  Download,
  Trash2,
  FolderOpen,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { ClipboardFile } from "@/app/api/rooms/route";

interface FileTransferProps {
  files: ClipboardFile[];
  onFilesChange: (updatedFiles: ClipboardFile[]) => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

const CHUNK_SIZE = 3 * 1024 * 1024; // 3MB chunks (stays safely under Vercel's 4.5MB serverless payload limit)

export const FileTransfer: React.FC<FileTransferProps> = ({
  files,
  onFilesChange,
  showToast,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number>(0);
  const [currentFileName, setCurrentFileName] = useState<string>("");
  const [uploadStats, setUploadStats] = useState<string>("");
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(1);
  const [totalFilesToUpload, setTotalFilesToUpload] = useState<number>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getFileIcon = (file: ClipboardFile) => {
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    if (type.includes("image") || name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".svg") || name.endsWith(".webp") || name.endsWith(".gif")) {
      return <ImageIcon size={18} />;
    }
    if (type.includes("zip") || name.endsWith(".zip") || name.endsWith(".rar") || name.endsWith(".7z") || name.endsWith(".tar") || name.endsWith(".gz")) {
      return <Archive size={18} />;
    }
    if (name.endsWith(".js") || name.endsWith(".ts") || name.endsWith(".py") || name.endsWith(".java") || name.endsWith(".cpp") || name.endsWith(".sql") || name.endsWith(".json") || name.endsWith(".html") || name.endsWith(".css")) {
      return <FileCode size={18} />;
    }
    if (type.includes("text") || name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".log")) {
      return <FileText size={18} />;
    }
    return <File size={18} />;
  };

  // Upload single file chunk via XMLHttpRequest to accurately track byte progress
  const uploadChunk = (
    chunk: Blob,
    chunkIndex: number,
    totalChunks: number,
    fileId: string,
    fileName: string,
    fileSize: number,
    fileType: string,
    onProgress: (loaded: number) => void
  ): Promise<{ complete: boolean; file?: ClipboardFile }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();

      formData.append("chunk", chunk);
      formData.append("chunkIndex", String(chunkIndex));
      formData.append("totalChunks", String(totalChunks));
      formData.append("fileId", fileId);
      formData.append("fileName", fileName);
      formData.append("fileSize", String(fileSize));
      formData.append("fileType", fileType);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch (err) {
            reject(new Error("Invalid server response"));
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || `Upload failed with status ${xhr.status}`));
          } catch {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error("Network connection error during upload"));
      xhr.open("POST", "/api/upload");
      xhr.send(formData);
    });
  };

  // Upload multiple files sequentially with real-time percentage progress bar
  const uploadFiles = async (fileList: FileList | File[]) => {
    if (!fileList || fileList.length === 0) return;

    setIsUploading(true);
    setTotalFilesToUpload(fileList.length);
    const uploadedNew: ClipboardFile[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setCurrentFileIndex(i + 1);
      setCurrentFileName(file.name);
      setUploadPercent(0);

      // Validate 100MB limit
      const MAX_SIZE = 100 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        showToast(`${file.name} exceeds 100MB maximum limit`, "error");
        continue;
      }

      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      const fileId = "file_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 8);

      let isSuccess = false;
      let finalMeta: ClipboardFile | undefined;

      try {
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const start = chunkIndex * CHUNK_SIZE;
          const end = Math.min(file.size, start + CHUNK_SIZE);
          const chunkBlob = file.slice(start, end);

          const result = await uploadChunk(
            chunkBlob,
            chunkIndex,
            totalChunks,
            fileId,
            file.name,
            file.size,
            file.type,
            (loadedInChunk) => {
              const totalUploaded = start + loadedInChunk;
              const percent = Math.min(99, Math.round((totalUploaded / file.size) * 100));
              setUploadPercent(percent);
              setUploadStats(`${formatFileSize(totalUploaded)} / ${formatFileSize(file.size)}`);
            }
          );

          if (result.complete && result.file) {
            isSuccess = true;
            finalMeta = result.file;
            setUploadPercent(100);
            setUploadStats(`${formatFileSize(file.size)} / ${formatFileSize(file.size)}`);
          }
        }

        if (isSuccess && finalMeta) {
          uploadedNew.push(finalMeta);
        }
      } catch (err: any) {
        showToast(`Failed uploading ${file.name}: ${err.message}`, "error");
      }
    }

    if (uploadedNew.length > 0) {
      const updated = [...files, ...uploadedNew];
      onFilesChange(updated);
      showToast(`Uploaded ${uploadedNew.length} file(s) successfully`, "success");
    }

    setIsUploading(false);
    setUploadPercent(0);
    setCurrentFileName("");
    setUploadStats("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const handleDownload = (file: ClipboardFile) => {
    const url = `/api/upload?fileId=${encodeURIComponent(file.id)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Downloading ${file.name}`, "info");
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/upload?fileId=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {}
    const updated = files.filter((f) => f.id !== id);
    onFilesChange(updated);
    showToast("File removed", "info");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Upload Dropzone */}
      <div
        className={`dropzone ${isDragging ? "active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (!isUploading) {
            fileInputRef.current?.click();
          }
        }}
        style={{ cursor: isUploading ? "wait" : "pointer" }}
      >
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          multiple
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              uploadFiles(e.target.files);
            }
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", width: "100%", maxWidth: "440px", margin: "0 auto" }}>
          {isUploading ? (
            <Loader2 size={32} className="animate-spin" />
          ) : (
            <UploadCloud size={34} />
          )}

          {/* Upload Text or Progress Bar */}
          {isUploading ? (
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.85rem", fontWeight: 600 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "260px" }}>
                  {totalFilesToUpload > 1 ? `(${currentFileIndex}/${totalFilesToUpload}) ` : ""}
                  {currentFileName}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem" }}>
                  {uploadPercent}%
                </span>
              </div>

              {/* Real-time Progress Bar */}
              <div
                style={{
                  width: "100%",
                  height: "8px",
                  backgroundColor: "var(--card-border)",
                  borderRadius: "9999px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${uploadPercent}%`,
                    backgroundColor: "var(--foreground)",
                    borderRadius: "9999px",
                    transition: "width 0.15s ease",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                <span>Uploading...</span>
                <span>{uploadStats}</span>
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: "0.92rem", fontWeight: 600 }}>
                Drop files here or click to upload
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                Supports up to <strong>100MB per file</strong> with real-time chunked transfer
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                style={{ marginTop: "4px" }}
              >
                <FolderOpen size={13} /> Select Files
              </button>
            </>
          )}
        </div>
      </div>

      {/* Uploaded Files Table */}
      {files.length > 0 && (
        <div className="mono-card" style={{ padding: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
              <FolderOpen size={15} /> Attached Files ({files.length})
            </div>
            <button
              onClick={() => {
                if (confirm("Clear all attached files from this room?")) {
                  onFilesChange([]);
                  showToast("Cleared file references", "info");
                }
              }}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: "0.75rem" }}
            >
              Clear All
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {files.map((file) => (
              <div
                key={file.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  background: "var(--gutter-bg)",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--card-border)",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
                  <div style={{ flexShrink: 0 }}>{getFileIcon(file)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.84rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {file.name}
                    </div>
                    <div style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                      {formatFileSize(file.size)} • {new Date(file.uploadedAt || Date.now()).toLocaleTimeString()}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  <button
                    onClick={() => handleDownload(file)}
                    className="btn btn-primary btn-sm"
                    title="Download File"
                  >
                    <Download size={13} /> Download
                  </button>
                  <button
                    onClick={() => handleDelete(file.id)}
                    className="btn btn-danger btn-sm"
                    title="Delete File"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
