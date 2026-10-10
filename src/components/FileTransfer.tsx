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
  Eye,
  FolderOpen,
  Loader2,
  HardDrive,
} from "lucide-react";
import { ClipboardFile } from "@/app/api/rooms/route";

interface FileTransferProps {
  files: ClipboardFile[];
  onFilesChange: (updatedFiles: ClipboardFile[]) => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const FileTransfer: React.FC<FileTransferProps> = ({
  files,
  onFilesChange,
  showToast,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [previewFile, setPreviewFile] = useState<ClipboardFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getFileIcon = (file: ClipboardFile) => {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    if (type.includes("image")) return <ImageIcon size={18} />;
    if (type.includes("zip") || name.endsWith(".zip") || name.endsWith(".rar") || name.endsWith(".7z") || name.endsWith(".tar") || name.endsWith(".gz"))
      return <Archive size={18} />;
    if (name.endsWith(".js") || name.endsWith(".ts") || name.endsWith(".py") || name.endsWith(".java") || name.endsWith(".cpp") || name.endsWith(".sql") || name.endsWith(".json") || name.endsWith(".html") || name.endsWith(".css"))
      return <FileCode size={18} />;
    if (type.includes("text") || name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".log"))
      return <FileText size={18} />;
    return <File size={18} />;
  };

  const uploadFiles = async (fileList: FileList | File[]) => {
    if (!fileList || fileList.length === 0) return;
    setIsUploading(true);

    const uploadedNew: ClipboardFile[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];

      // Check client-side 100MB limit
      if (file.size > 100 * 1024 * 1024) {
        showToast(`${file.name} exceeds 100MB limit`, "error");
        continue;
      }

      setUploadProgress(`Uploading ${file.name} (${formatFileSize(file.size)})...`);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Upload failed");
        }

        const data = await res.json();
        if (data.file) {
          uploadedNew.push(data.file);
        }
      } catch (err: any) {
        showToast(`Failed to upload ${file.name}: ${err.message}`, "error");
      }
    }

    if (uploadedNew.length > 0) {
      const updated = [...files, ...uploadedNew];
      onFilesChange(updated);
      showToast(`Uploaded ${uploadedNew.length} file(s)`, "success");
    }

    setIsUploading(false);
    setUploadProgress("");
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
    if (e.dataTransfer.files) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const handleDownload = (file: ClipboardFile) => {
    const url = `/api/upload?fileId=${encodeURIComponent(file.id)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    showToast(`Downloading ${file.name}`, "info");
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/upload?fileId=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {}
    const updated = files.filter((f) => f.id !== id);
    onFilesChange(updated);
    showToast("File deleted", "info");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Upload Zone (Supports 100MB) */}
      <div
        className={`dropzone ${isDragging ? "active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          multiple
          onChange={(e) => e.target.files && uploadFiles(e.target.files)}
        />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
          {isUploading ? (
            <Loader2 size={28} className="animate-spin" />
          ) : (
            <UploadCloud size={30} />
          )}
          <div style={{ fontSize: "0.92rem", fontWeight: 600 }}>
            {isUploading ? uploadProgress || "Uploading..." : "Drop files here or click to upload"}
          </div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Up to <strong>100MB per file</strong> (scripts, archives, images, documents)
          </div>
          <button className="btn btn-secondary btn-sm" style={{ marginTop: "4px" }}>
            <FolderOpen size={13} /> Select Files
          </button>
        </div>
      </div>

      {/* Files List Table */}
      {files.length > 0 && (
        <div className="mono-card" style={{ padding: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
              <FolderOpen size={15} /> Attached Files ({files.length})
            </div>
            <button
              onClick={() => {
                onFilesChange([]);
                showToast("Cleared file references", "info");
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
