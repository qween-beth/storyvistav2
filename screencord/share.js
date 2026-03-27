/**
 * Screencord — Real-time Sharing (PeerJS)
 * Handles P2P video streaming, audio mixed with microphone, chat, polls, and resources.
 */

const share = {
    peer: null,
    isHost: false,
    roomCode: null,
    roomType: 'live', // 'live' or 'playback'
    connections: [],
    viewerCount: 0,
    activeStream: null,
    onMessage: null,
    onViewerUpdate: null,
    onStreamReceived: null,

    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 7; i++) {
            if (i === 3) code += '-';
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    },

    async initSession(isHost = true, overrideCode = null) {
        this.isHost = isHost;
        this.roomCode = overrideCode || this.generateRoomCode();
        this.connections = [];
        this.viewerCount = 0;

        this.peer = new Peer(`sc-${this.roomCode}`, {
            debug: (isHost ? 1 : 2)
        });

        return new Promise((resolve, reject) => {
            this.peer.on('open', (id) => {
                if (isHost) this.setupHostHandlers();
                resolve(this.roomCode);
            });

            this.peer.on('error', (err) => {
                console.error('PeerJS error:', err);
                if (err.type === 'unavailable-id' && isHost) {
                    resolve(this.initSession(true));
                } else {
                    reject(err);
                }
            });
        });
    },

    setupHostHandlers() {
        this.peer.on('connection', (conn) => {
            this.connections.push(conn);
            this.viewerCount = this.connections.length;
            if (this.onViewerUpdate) this.onViewerUpdate(this.viewerCount);

            conn.on('open', () => {
                conn.send({ type: 'room_info', roomType: this.roomType || 'live' });
            });

            if (this.activeStream) {
                this.peer.call(conn.peer, this.activeStream);
            }

            conn.on('data', (data) => {
                // SECURITY ENFORCEMENT
                // Viewers are only permitted to send specific data types
                const allowedViewerTypes = ['chat', 'poll_vote'];
                if (!data || !allowedViewerTypes.includes(data.type)) {
                    console.warn(`[Security] Dropped unauthorized packet type '${data?.type}' from peer ${conn.peer}`);
                    return;
                }

                // Host receives data from a viewer
                // Broadcast it out to all *other* viewers so everyone sees it
                this.broadcast(data, conn.peer);
                // Also trigger host's local UI update
                if (this.onMessage) this.onMessage(data);
            });

            conn.on('close', () => {
                this.connections = this.connections.filter(c => c !== conn);
                this.viewerCount = this.connections.length;
                if (this.onViewerUpdate) this.onViewerUpdate(this.viewerCount);
            });
        });

        this.peer.on('call', (call) => {
            if (this.activeStream) {
                call.answer(this.activeStream);
            }
        });
    },

    async connectToHost(code, name) {
        this.isHost = false;
        this.roomCode = code.toUpperCase();
        
        this.peer = new Peer(`sc-viewer-${Math.floor(Math.random() * 999999)}`, { debug: 1 });

        return new Promise((resolve, reject) => {
            this.peer.on('open', () => {
                const conn = this.peer.connect(`sc-${this.roomCode}`, {
                    metadata: { name }
                });

                conn.on('open', () => {
                    this.connections.push(conn);
                    resolve();
                });

                conn.on('data', (data) => {
                    if (this.onMessage) this.onMessage(data);
                });

                conn.on('error', reject);

                this.peer.on('call', (call) => {
                    call.answer(); 
                    call.on('stream', (remoteStream) => {
                        this.activeStream = remoteStream;
                        if (this.onStreamReceived) this.onStreamReceived(remoteStream);
                    });
                });
            });
        });
    },

    startStreaming(stream) {
        this.activeStream = stream;
        this.connections.forEach(conn => {
            this.peer.call(conn.peer, stream);
        });
    },

    stopStreaming() {
        this.activeStream = null;
    },

    broadcast(data, excludePeerId = null) {
        this.connections.forEach(conn => {
            if (conn.peer !== excludePeerId) {
                conn.send(data);
            }
        });
    },

    sendMessage(payload) {
        if (!payload.id) payload.id = Date.now();
        if (!payload.time) payload.time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        if (this.isHost) {
            this.broadcast(payload);
        } else {
            this.connections[0]?.send(payload);
        }
        return payload;
    },

    destroy() {
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.connections = [];
        this.activeStream = null;
    }
};

window.ScreencordShare = share;
