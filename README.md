# Open App - Real-Time Code & File Sync

An IDE-grade real-time clipboard and temporary file transfer platform built with Next.js, Server-Sent Events (SSE), and system-level IP room isolation.

## Features

- **IDE Code Workspace**: Monospaced gutter line numbers, language syntax tags, instant copy, and clean typography.
- **Monochrome Next.js Aesthetic**: Clean high-contrast black & white design inspired by Geist.
- **Dynamic Isolated Rooms**: System-wise IP isolation ensures rooms created on your computer are isolated, with secure QR code sharing for LAN and remote devices.
- **Fast File Transfer**: Drag-and-drop file sharing supporting files up to 100MB stored outside project directory.
- **Real-Time Cross-Device Sync**: Sub-50ms live synchronization using persistent Server-Sent Events (SSE).
- **Temporary & Zero Footprint**: Ephemeral storage in system temporary directories (`os.tmpdir()`), keeping git repositories clean.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.
