"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Copy,
  ClipboardPaste,
  Save,
  RefreshCw,
  QrCode,
  Download,
  Trash2,
  FileCode,
  Folder,
  Shield,
  History,
  Check,
  Sparkles,
  Lock,
  Code2,
  Plus,
  HardDrive,
  Wifi,
  Laptop,
} from "lucide-react";

import { ClipboardFile } from "./api/rooms/route";
import { Toast, ToastMessage } from "@/components/Toast";
import { QRCodeModal } from "@/components/QRCodeModal";
import { FileTransfer } from "@/components/FileTransfer";
import { SecuritySettingsModal } from "@/components/SecuritySettingsModal";

const SUPPORTED_LANGUAGES = [
  { id: "plaintext", name: "Plain Text", ext: "txt" },
  { id: "javascript", name: "JavaScript", ext: "js" },
  { id: "typescript", name: "TypeScript", ext: "ts" },
  { id: "python", name: "Python", ext: "py" },
  { id: "java", name: "Java", ext: "java" },
  { id: "cpp", name: "C++", ext: "cpp" },
  { id: "csharp", name: "C#", ext: "cs" },
  { id: "sql", name: "SQL", ext: "sql" },
  { id: "json", name: "JSON", ext: "json" },
  { id: "html", name: "HTML", ext: "html" },
  { id: "css", name: "CSS", ext: "css" },
  { id: "bash", name: "Bash", ext: "sh" },
];

interface HostRoomInfo {
  code: string;
  updatedAt: number;
  fileCount: number;
  textLength: number;
  language: string;
  isProtected: boolean;
}

function createRandomRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let res = "";
  for (let i = 0; i < 7; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

export default function Home() {
  // Room state
  const [roomCode, setRoomCode] = useState<string>("");
  const [inputCode, setInputCode] = useState<string>("");
  const [roomKey, setRoomKey] = useState<string>("");
  const [roomPin, setRoomPin] = useState<string>("");
  const [expiryMinutes, setExpiryMinutes] = useState<number>(60);
  const [selfDestruct, setSelfDestruct] = useState<boolean>(false);
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null);

  // Content state
  const [text, setText] = useState<string>("");
  const [language, setLanguage] = useState<string>("typescript");
  const [files, setFiles] = useState<ClipboardFile[]>([]);
  const [requiresPinModal, setRequiresPinModal] = useState<boolean>(false);
  const [enteredPin, setEnteredPin] = useState<string>("");

  // Rooms state
  const [hostRooms, setHostRooms] = useState<HostRoomInfo[]>([]);

  // Editor cursor pos
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  // UI state
  const [activeTab, setActiveTab] = useState<"code" | "files" | "rooms">("code");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [autoSync, setAutoSync] = useState<boolean>(true);
  const [showQRModal, setShowQRModal] = useState<boolean>(false);
  const [showSecurityModal, setShowSecurityModal] = useState<boolean>(false);
  const [copiedSuccess, setCopiedSuccess] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // Toast feedback
  const showToast = useCallback((text: string, type: "success" | "error" | "info" = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Fetch all rooms stored on this host machine
  const fetchHostRooms = useCallback(async () => {
    try {
      const res = await fetch("/api/rooms?list=true");
      if (res.ok) {
        const data = await res.json();
        setHostRooms(data.rooms || []);
      }
    } catch {}
  }, []);

  // Generate random room code
  const generateRandomCode = () => {
    const res = createRandomRoomCode();
    setRoomCode(res);
    setInputCode(res);
    setText("");
    setFiles([]);
    if (typeof window !== "undefined") {
      const newUrl = `${window.location.pathname}?code=${encodeURIComponent(res)}`;
      window.history.replaceState(null, "", newUrl);
    }
    fetchRoom(res);
    showToast(`New room: ${res}`, "info");
  };

  // Pull room data with IP/System verification & localStorage caching
  const fetchRoom = useCallback(
    async (codeToFetch: string, pinToUse: string = roomPin, keyToUse?: string) => {
      if (!codeToFetch) return;
      setIsLoading(true);
      try {
        const storedKey =
          keyToUse ||
          roomKey ||
          (typeof window !== "undefined"
            ? localStorage.getItem(`system_key_${codeToFetch}`) || ""
            : "");
        const pinParam = pinToUse ? `&pin=${encodeURIComponent(pinToUse)}` : "";
        const keyParam = storedKey ? `&key=${encodeURIComponent(storedKey)}` : "";
        const res = await fetch(
          `/api/rooms?code=${encodeURIComponent(codeToFetch)}${pinParam}${keyParam}&_t=${Date.now()}`,
          {
            cache: "no-store",
            headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
          }
        );

        if (res.status === 403) {
          setIsLoading(false);
          showToast("Access restricted: This room belongs to another computer system", "error");
          return;
        }

        if (res.status === 401) {
          setRequiresPinModal(true);
          setIsLoading(false);
          showToast("Passcode required for room", "error");
          return;
        }

        if (res.status === 404) {
          setRequiresPinModal(false);
          setIsLoading(false);
          // Restore draft from local storage if available on this system
          if (typeof window !== "undefined") {
            const localDraft = localStorage.getItem(`system_draft_${codeToFetch}`);
            if (localDraft) setText(localDraft);
          }
          return;
        }

        if (res.status === 410) {
          showToast("Room was burned after reading", "error");
          setText("");
          setFiles([]);
          setIsLoading(false);
          fetchHostRooms();
          return;
        }

        if (res.ok) {
          const data = await res.json();
          setText(data.text || "");
          if (data.language) setLanguage(data.language);
          if (data.files) setFiles(data.files);
          if (data.roomKey) {
            setRoomKey(data.roomKey);
            try {
              localStorage.setItem(`system_key_${codeToFetch}`, data.roomKey);
            } catch {}
          }
          setRequiresPinModal(false);
          if (data.updatedAt) {
            setLastSavedTime(new Date(data.updatedAt));
          }
        }
      } catch (err: any) {
        showToast("Error: " + err.message, "error");
      } finally {
        setIsLoading(false);
      }
    },
    [roomPin, roomKey, showToast, fetchHostRooms]
  );

  // Save / push room data (persists to temporary host storage & client localStorage)
  const saveRoom = async (overrideText?: string, overrideFiles?: ClipboardFile[]) => {
    if (!roomCode) {
      showToast("Room code cannot be empty", "error");
      return;
    }

    setIsSaving(true);
    try {
      const activeText = overrideText !== undefined ? overrideText : text;
      const currentStoredKey =
        roomKey ||
        (typeof window !== "undefined"
          ? localStorage.getItem(`system_key_${roomCode}`) || undefined
          : undefined);

      const payload = {
        code: roomCode,
        roomKey: currentStoredKey,
        text: activeText,
        language: language,
        pin: roomPin || undefined,
        files: overrideFiles !== undefined ? overrideFiles : files,
        expiryMinutes: expiryMinutes,
        selfDestruct: selfDestruct,
      };

      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 403) {
        showToast("Access denied: Cannot overwrite another computer's room", "error");
        setIsSaving(false);
        return;
      }

      if (res.status === 401) {
        showToast("Incorrect passcode", "error");
        setIsSaving(false);
        return;
      }

      if (!res.ok) throw new Error("Save failed");

      const data = await res.json();
      if (data.roomKey) {
        setRoomKey(data.roomKey);
        try {
          localStorage.setItem(`system_key_${roomCode}`, data.roomKey);
        } catch {}
      }

      // Save to client-side localStorage
      try {
        localStorage.setItem(`system_draft_${roomCode}`, activeText);
        const myRooms = JSON.parse(localStorage.getItem("system_my_rooms") || "[]");
        if (!myRooms.includes(roomCode)) {
          localStorage.setItem("system_my_rooms", JSON.stringify([roomCode, ...myRooms].slice(0, 20)));
        }
      } catch {}

      setLastSavedTime(new Date());
      fetchHostRooms();
      showToast(`Saved (${roomCode})`, "success");
    } catch (err: any) {
      showToast("Error saving: " + err.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleJoinRoom = (targetCode?: string) => {
    const code = (targetCode || inputCode).trim().toUpperCase();
    if (!code) return;
    setRoomCode(code);
    setInputCode(code);
    if (typeof window !== "undefined") {
      const newUrl = `${window.location.pathname}?code=${encodeURIComponent(code)}`;
      window.history.replaceState(null, "", newUrl);
    }
    fetchRoom(code);
  };

  const handleDeleteRoom = async (codeToDelete: string) => {
    if (!confirm(`Permanently delete room ${codeToDelete} from host storage?`)) return;
    try {
      const res = await fetch(`/api/rooms?code=${encodeURIComponent(codeToDelete)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        showToast(`Room ${codeToDelete} deleted`, "info");
        fetchHostRooms();
        if (roomCode === codeToDelete) {
          generateRandomCode();
        }
      }
    } catch {
      showToast("Failed to delete room", "error");
    }
  };

  // Initial load
  useEffect(() => {
    fetchHostRooms();

    const urlParams = new URLSearchParams(window.location.search);
    const codeFromUrl = urlParams.get("code")?.trim().toUpperCase();
    if (codeFromUrl) {
      setRoomCode(codeFromUrl);
      setInputCode(codeFromUrl);
      fetchRoom(codeFromUrl);
    } else {
      const freshCode = createRandomRoomCode();
      setRoomCode(freshCode);
      setInputCode(freshCode);
      if (typeof window !== "undefined") {
        const newUrl = `${window.location.pathname}?code=${encodeURIComponent(freshCode)}`;
        window.history.replaceState(null, "", newUrl);
      }
      fetchRoom(freshCode);
    }
  }, [fetchHostRooms, fetchRoom]);

  // Real-time EventSource communication channel for instantaneous cross-device sync
  useEffect(() => {
    if (!roomCode || requiresPinModal) return;

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`/api/rooms/events?code=${encodeURIComponent(roomCode)}`);

      eventSource.addEventListener("update", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.code === roomCode) {
            setText(data.text ?? "");
            if (data.language) setLanguage(data.language);
            if (data.files) setFiles(data.files);
            if (data.updatedAt) setLastSavedTime(new Date(data.updatedAt));
            showToast("Instant update received from connected device", "info");
          }
        } catch (e) {
          console.error("SSE parse error:", e);
        }
      });
    } catch (err) {
      console.error("SSE setup error:", err);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [roomCode, requiresPinModal, showToast]);

  // Periodic Auto-Sync fallback (every 3 seconds)
  useEffect(() => {
    if (!autoSync || requiresPinModal) return;
    const interval = setInterval(() => {
      fetchRoom(roomCode);
    }, 3000);
    return () => clearInterval(interval);
  }, [autoSync, roomCode, requiresPinModal, fetchRoom]);

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveRoom();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveRoom]);

  // Sync gutter scrolling
  const handleEditorScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Update cursor position
  const handleEditorCursor = () => {
    if (!textareaRef.current) return;
    const pos = textareaRef.current.selectionStart;
    const lines = text.substring(0, pos).split("\n");
    setCursorPos({
      line: lines.length,
      col: lines[lines.length - 1].length + 1,
    });
  };

  // Copy Code
  const handleCopyCode = async () => {
    if (!text) {
      showToast("Editor is empty", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSuccess(true);
      const linesCount = text.split("\n").length;
      showToast(`Copied ${linesCount} lines to clipboard`, "success");
      setTimeout(() => setCopiedSuccess(false), 2000);
    } catch {
      if (textareaRef.current) {
        textareaRef.current.select();
        document.execCommand("copy");
        setCopiedSuccess(true);
        showToast("Copied to clipboard", "success");
        setTimeout(() => setCopiedSuccess(false), 2000);
      }
    }
  };

  // Paste Code
  const handlePasteCode = async () => {
    try {
      const clipboardContent = await navigator.clipboard.readText();
      if (clipboardContent) {
        setText(clipboardContent);
        showToast("Pasted from clipboard", "success");
      }
    } catch {
      showToast("Use Ctrl+V / Cmd+V in editor to paste", "info");
      textareaRef.current?.focus();
    }
  };

  // Format Code / JSON
  const handleFormatCode = () => {
    if (!text.trim()) return;
    try {
      if (language === "json" || text.trim().startsWith("{") || text.trim().startsWith("[")) {
        const parsed = JSON.parse(text);
        setText(JSON.stringify(parsed, null, 2));
        setLanguage("json");
        showToast("Formatted JSON", "success");
      } else {
        showToast("Indented lines", "info");
      }
    } catch {
      showToast("Invalid JSON syntax", "error");
    }
  };

  // Download Code directly as file
  const handleDownloadCode = () => {
    if (!text) {
      showToast("Editor is empty", "info");
      return;
    }
    const currentLang = SUPPORTED_LANGUAGES.find((l) => l.id === language) || SUPPORTED_LANGUAGES[0];
    const filename = `workspace_${roomCode.toLowerCase()}.${currentLang.ext}`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${filename}`, "success");
  };

  const lineCount = Math.max(1, text.split("\n").length);
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);
  const currentExt = SUPPORTED_LANGUAGES.find((l) => l.id === language)?.ext || "txt";

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--background)" }}>
      <Toast toasts={toasts} onDismiss={dismissToast} />

      <QRCodeModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        roomCode={roomCode}
        roomKey={roomKey}
        showToast={showToast}
      />

      <SecuritySettingsModal
        isOpen={showSecurityModal}
        onClose={() => setShowSecurityModal(false)}
        pin={roomPin}
        onPinChange={setRoomPin}
        expiryMinutes={expiryMinutes}
        onExpiryChange={setExpiryMinutes}
        selfDestruct={selfDestruct}
        onSelfDestructChange={setSelfDestruct}
        showToast={showToast}
      />

      {/* PIN Unlock Modal */}
      {requiresPinModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div className="mono-card" style={{ maxWidth: "360px", width: "100%", padding: "20px", textAlign: "center" }}>
            <div style={{ margin: "0 auto 10px auto", width: "36px", height: "36px", borderRadius: "50%", background: "var(--gutter-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Lock size={18} />
            </div>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "4px" }}>Passcode Required</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "14px" }}>
              Room <strong>{roomCode}</strong> is protected with a PIN:
            </p>
            <input
              type="password"
              className="input-field"
              placeholder="PIN"
              value={enteredPin}
              onChange={(e) => setEnteredPin(e.target.value)}
              style={{ textAlign: "center", letterSpacing: "3px", fontSize: "1rem", marginBottom: "12px" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setRoomPin(enteredPin);
                  fetchRoom(roomCode, enteredPin);
                }
              }}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => {
                  generateRandomCode();
                  setRequiresPinModal(false);
                }}
              >
                New Room
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => {
                  setRoomPin(enteredPin);
                  fetchRoom(roomCode, enteredPin);
                }}
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Header: Next.js Black & White Minimalist Style */}
      <header
        style={{
          borderBottom: "1px solid var(--card-border)",
          background: "var(--background)",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        {/* Left: Tool Name + Room Control */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, fontSize: "0.92rem" }}>
            <Code2 size={17} />
            <span>Sync</span>
          </div>

          <div style={{ height: "14px", width: "1px", background: "var(--card-border)" }} />

          {/* Room Switcher */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Room:</span>
            <input
              type="text"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleJoinRoom();
              }}
              style={{
                width: "90px",
                padding: "4px 8px",
                border: "1px solid var(--card-border)",
                borderRadius: "var(--radius)",
                fontSize: "0.82rem",
                fontWeight: 600,
                textTransform: "uppercase",
                background: "var(--background)",
                color: "var(--foreground)",
                outline: "none",
              }}
            />
            <button
              onClick={() => handleJoinRoom()}
              className="btn btn-secondary btn-sm"
              title="Open room"
            >
              Join
            </button>
            <button
              onClick={generateRandomCode}
              className="btn btn-secondary btn-sm"
              title="Create new room"
            >
              <Plus size={13} /> New
            </button>
          </div>
        </div>

        {/* Right Actions Bar (Mobile scroll friendly) */}
        <div className="header-actions" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            onClick={() => saveRoom()}
            disabled={isSaving}
            className="btn btn-primary btn-sm"
            title="Save to host disk (Ctrl+S)"
          >
            <Save size={13} />
            {isSaving ? "Saving..." : "Save"}
          </button>

          <button
            onClick={handleCopyCode}
            className="btn btn-secondary btn-sm"
            title="Copy code"
          >
            {copiedSuccess ? <Check size={13} /> : <Copy size={13} />}
            {copiedSuccess ? "Copied" : "Copy"}
          </button>

          <button
            onClick={handlePasteCode}
            className="btn btn-secondary btn-sm"
            title="Paste code"
          >
            <ClipboardPaste size={13} /> Paste
          </button>

          <button
            onClick={() => fetchRoom(roomCode)}
            disabled={isLoading}
            className="btn btn-secondary btn-sm"
            title="Pull latest sync"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} /> Sync
          </button>

          <button
            onClick={() => setShowQRModal(true)}
            className="btn btn-secondary btn-sm"
            title="Mobile QR Connect"
          >
            <QrCode size={13} /> Mobile
          </button>

          <button
            onClick={() => setShowSecurityModal(true)}
            className={`btn btn-sm ${roomPin ? "btn-primary" : "btn-secondary"}`}
            title="Passcode Settings"
          >
            <Shield size={13} /> {roomPin ? "PIN On" : "Lock"}
          </button>
        </div>
      </header>


      {/* Main Workspace */}
      <div style={{ flex: 1, padding: "14px 16px", maxWidth: "1380px", margin: "0 auto", width: "100%" }}>
        {/* Tab Navigation */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", borderBottom: "1px solid var(--card-border)", marginBottom: "-1px" }}>
          <div style={{ display: "flex", gap: "2px" }}>
            <button
              onClick={() => setActiveTab("code")}
              className={`tab-item ${activeTab === "code" ? "active" : ""}`}
            >
              <FileCode size={13} />
              <span>workspace.{currentExt}</span>
            </button>
            <button
              onClick={() => setActiveTab("files")}
              className={`tab-item ${activeTab === "files" ? "active" : ""}`}
            >
              <Folder size={13} />
              <span>Files ({files.length})</span>
            </button>
            <button
              onClick={() => {
                setActiveTab("rooms");
                fetchHostRooms();
              }}
              className={`tab-item ${activeTab === "rooms" ? "active" : ""}`}
            >
              <History size={13} />
              <span>Rooms ({hostRooms.length})</span>
            </button>
          </div>

          {/* Code options toolbar */}
          {activeTab === "code" && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingBottom: "6px", overflowX: "auto" }}>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                style={{
                  background: "var(--background)",
                  border: "1px solid var(--card-border)",
                  borderRadius: "var(--radius)",
                  padding: "4px 8px",
                  fontSize: "0.76rem",
                  color: "var(--foreground)",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.name} (.{lang.ext})
                  </option>
                ))}
              </select>

              <button
                onClick={handleFormatCode}
                className="btn btn-secondary btn-sm"
                title="Format JSON/Code"
                style={{ padding: "4px 8px", fontSize: "0.75rem" }}
              >
                <Sparkles size={12} /> Format
              </button>

              <button
                onClick={handleDownloadCode}
                className="btn btn-secondary btn-sm"
                title="Download code file"
                style={{ padding: "4px 8px", fontSize: "0.75rem" }}
              >
                <Download size={12} /> .{currentExt}
              </button>

              <button
                onClick={() => {
                  if (confirm("Clear editor content?")) setText("");
                }}
                className="btn btn-danger btn-sm"
                title="Clear content"
                style={{ padding: "4px 8px", fontSize: "0.75rem" }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>

        {/* TAB 1: Code & Text Editor */}
        {activeTab === "code" && (
          <div className="mono-card" style={{ overflow: "hidden", borderTopLeftRadius: 0 }}>
            <div className="editor-wrapper">
              <div ref={gutterRef} className="editor-gutter">
                {lineNumbers.map((num) => (
                  <div key={num}>{num}</div>
                ))}
              </div>

              <textarea
                ref={textareaRef}
                className="editor-textarea"
                placeholder="// Type or paste code here... (Ctrl+S to save)"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  try {
                    localStorage.setItem(`system_draft_${roomCode}`, e.target.value);
                  } catch {}
                }}
                onScroll={handleEditorScroll}
                onClick={handleEditorCursor}
                onKeyUp={handleEditorCursor}
                spellCheck={false}
              />
            </div>

            {/* Status Bar */}
            <div className="editor-statusbar">
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <span>
                  Ln {cursorPos.line}, Col {cursorPos.col}
                </span>
                <span>{lineCount} lines</span>
                <span>{text.length} chars</span>
                <span>UTF-8</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <span style={{ textTransform: "capitalize" }}>{language}</span>
                <label style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={(e) => setAutoSync(e.target.checked)}
                    style={{ accentColor: "var(--foreground)", width: "12px", height: "12px" }}
                  />
                  <span>Auto-Sync</span>
                </label>
                <span>Room: <strong>{roomCode}</strong></span>
                {lastSavedTime && <span>Synced {lastSavedTime.toLocaleTimeString()}</span>}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: File Transfer (100MB) */}
        {activeTab === "files" && (
          <div style={{ marginTop: "12px" }}>
            <FileTransfer
              files={files}
              onFilesChange={(newFiles) => {
                setFiles(newFiles);
                saveRoom(undefined, newFiles);
              }}
              showToast={showToast}
            />
          </div>
        )}

        {/* TAB 3: Host Storage Rooms List */}
        {activeTab === "rooms" && (
          <div className="mono-card" style={{ padding: "18px", marginTop: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>Host Storage Rooms</h3>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  All rooms stored on this system's disk ({hostRooms.length} active)
                </p>
              </div>

              <button onClick={generateRandomCode} className="btn btn-primary btn-sm">
                <Plus size={13} /> Create New Room
              </button>
            </div>

            {hostRooms.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.82rem", padding: "16px 0" }}>
                No saved rooms yet on this host disk. Click "Create New Room" to add one.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "10px" }}>
                {hostRooms.map((r) => (
                  <div
                    key={r.code}
                    style={{
                      border: "1px solid var(--card-border)",
                      borderRadius: "var(--radius)",
                      padding: "12px 14px",
                      background: r.code === roomCode ? "var(--gutter-bg)" : "var(--background)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "10px",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, fontSize: "0.95rem", letterSpacing: "1px" }}>{r.code}</span>
                        {r.code === roomCode && (
                          <span style={{ fontSize: "0.7rem", fontWeight: 600, background: "var(--foreground)", color: "var(--background)", padding: "2px 6px", borderRadius: "4px" }}>
                            Active
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                        {r.fileCount} file(s) • {r.textLength} chars • {r.language}
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "var(--text-subtle)", marginTop: "2px" }}>
                        Updated: {new Date(r.updatedAt).toLocaleTimeString()}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        onClick={() => {
                          handleJoinRoom(r.code);
                          setActiveTab("code");
                        }}
                        className="btn btn-secondary btn-sm"
                        style={{ flex: 1 }}
                      >
                        Open
                      </button>
                      <button
                        onClick={() => handleDeleteRoom(r.code)}
                        className="btn btn-danger btn-sm"
                        title="Delete from host disk"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
