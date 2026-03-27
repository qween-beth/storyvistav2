# Screencord

**Screencord** is a premium, privacy-first screen recording and live collaboration platform that runs entirely in your browser. With a focus on high-fidelity performance and an immersive, fluid UI, Screencord allows you to seamlessly switch between capturing video locally, streaming your display live to viewers with near-zero latency, and hosting synchronized watch parties.

![Screencord Interface](./screencord_hero_placeholder) *Replace with actual screenshot or banner*

## 🌟 Key Features

*   **High-Fidelity Screen Recording:** Capture any screen, application window, or browser tab. Mixing internal system audio and microphone inputs simultaneously is natively supported.
*   **Live WebRTC Broadcasting:** Switch to the "Live" tab, share your screen, and easily generate a low-latency WebRTC Access Code. Your viewers experience your live desktop without needing to install anything.
*   **Watch Parties:** Turn any previously recorded video into a real-time event. Send viewers an access code, and the video playback is synced and streamed directly to them.
*   **Persistent Local Library:** Built with `IndexedDB`, your recordings are safely stored natively inside your browser and persist across sessions.
*   **P2P Live Chat:** Every session—whether a Live stream or Watch Party—includes a built-in, real-time decentralized chat channel so viewers and hosts can interact safely.
*   **Dynamic Premium UI:** A meticulously crafted interface featuring animated glassmorphism, responsive transitions, and a seamless toggle between beautiful Dark and Light modes based on your system preference.

## 🚀 How to Run Locally

Screencord relies heavily on privacy-focused HTML5 Web APIs (like `getDisplayMedia`, `getUserMedia`, and `IndexedDB`). Thus, it must be run via a local HTTP server securely to work properly.

### Quick Start (Python)
If you have Python installed, you can simply spin up a server in this directory:
```bash
python -m http.server 8000
```
Then navigate to `http://localhost:8000` in your web browser.

### Quick Start (Node.js/npm)
You can use `http-server` or any standard live-server:
```bash
npx http-server -p 8000
```

## 🏗️ Architecture Stack

Screencord is completely frontend-driven—your data and recordings never touch an external cloud backend unless you explicitly stream it P2P to a peer.

*   **Core Logic:** Vanilla HTML5 / JavaScript (ES6+).
*   **Styling:** Custom fluid CSS with semantic CSS Variables for deep theming.
*   **Storage Framework:** `IndexedDB` wrapper handles saving and querying high-resolution `WebM` blobs locally for playback.
*   **Network & Signaling:** [PeerJS](https://peerjs.com/) (`v1.5.4`) handles the heavy lifting of WebRTC session signaling, stream routing, and peer-to-peer data channels for the real-time chat.
*   **Media Processing:** The `MediaRecorder` API captures merged `AudioContext` tracks, while the `captureStream()` API seamlessly powers the Watch Party functionality.

## 👥 Usage Guide

1. **Recording:**
   - Click **Share Screen** to prep your stage. You will see a preview.
   - When ready, hit **Start Recording**. A countdown timer begins tracking.
   - Click Stop. You will be prompted with a modal to name and save your file locally.
   
2. **Library / Watch Parties:**
   - Browse to your **Recordings** tab to see your local saved library.
   - Click **Share** on any recording. You will get an Access Code for your friends.
   - When your friends load in (using your requested access code), hit **Play** on your screen to stream the movie directly to them.
   
3. **Live Desktop Streaming:**
   - Go to the **Live** tab, and prep your screen.
   - Click **Go Live** and send your generated Room Code.
   - Wait for your `Viewers Count` to go up!

---

*Crafted for speed, privacy, and immersive collaboration.*
