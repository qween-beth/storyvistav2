/**
 * Screencord — Main Application v3
 * High-performance screen recording, live sharing & collaborative chat.
 * Added: Resources Library & Native Chat Polls, Global Sidebar UI.
 */

// ─── State ───
let mediaRecorder = null;
let recordedChunks = [];
let startTime = 0;
let timerInterval = null;
let isRecording = false;
let micEnabled = true;
let systemAudioEnabled = true;
let currentView = 'record';
let tempRecordingBlob = null;
let isStreamReady = false;
let currentStream = null;
let activePolls = {};

// ─── Elements ───
const $ = (s) => document.querySelector(s);
const el = {
    // Navigation
    navLinks: document.querySelectorAll('.nav__link'),
    views: document.querySelectorAll('.view'),
    
    // Recorder View
    shareScreenBtn: $('#share-screen-btn'),
    startBtn: $('#start-btn'),
    stopBtn: $('#stop-btn'),
    preview: $('#preview'),
    placeholder: $('#placeholder'),
    timerH: $('#timer-h'),
    timerM: $('#timer-m'),
    timerS: $('#timer-s'),
    statusText: $('#status-text'),
    statusBadge: $('#status-badge'),
    recBadge: $('#rec-badge'),
    micToggle: $('#mic-toggle'),
    audioToggle: $('#audio-toggle'),
    
    // Recordings View
    recordingsGrid: $('#recordings-grid'),
    emptyRecordings: $('#empty-recordings'),
    
    // Live View
    liveShareBtn: $('#live-share-btn'),
    liveStartBtn: $('#live-start-btn'),
    liveStopBtn: $('#live-stop-btn'),
    livePreview: $('#live-preview'),
    livePlaceholder: $('#live-placeholder'),
    liveRoomInfo: $('#live-room-info'),
    liveRoomCode: $('#live-room-code'),
    
    // Watch View
    watchPreview: $('#watch-preview'),
    watchStatus: $('#watch-status'),
    
    // Share Playback View
    sharePlaybackVideo: $('#share-playback-video'),
    playbackRoomCode: $('#playback-room-code'),
    
    // Modals & Extras
    saveModal: $('#save-modal'),
    saveName: $('#save-name'),
    savePreviewVideo: $('#save-preview-video'),
    joinModal: $('#join-modal'),
    joinCode: $('#join-code'),
    joinName: $('#join-name'),
    shareModal: $('#share-modal'),
    shareRoomCode: $('#share-room-code'),
    shareStatus: $('#share-status'),
    
    toastContainer: $('#toast-container'),

    // Global Sidebar
    globalSidebar: $('#global-sidebar'),
    globalChatMessages: $('#global-chat-messages'),
    globalChatInput: $('#global-chat-input'),
    globalChatSend: $('#global-chat-send'),
    globalViewerCount: $('#global-viewer-count'),
    emojiPicker: $('#emoji-picker'),
    btnEmoji: $('#btn-emoji'),
    hostResourceControls: $('#host-resource-controls'),
    resourcesList: $('#resources-list'),
};

// ─── Initialization ───
window.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    navigate('record');
    await ScreencordDB.init();
    
    // Event Listeners
    el.micToggle.addEventListener('click', toggleMic);
    el.audioToggle.addEventListener('click', toggleAudio);
    
    if (el.shareScreenBtn) el.shareScreenBtn.addEventListener('click', setupRecordStream);
    if (el.startBtn) el.startBtn.addEventListener('click', startRecording);
    if (el.stopBtn) el.stopBtn.addEventListener('click', stopRecording);
    
    if (el.liveShareBtn) el.liveShareBtn.addEventListener('click', setupLiveStream);
    if (el.liveStartBtn) el.liveStartBtn.addEventListener('click', startLiveSession);
    if (el.liveStopBtn) el.liveStopBtn.addEventListener('click', stopLiveSession);
    
    // Global Sidebar Bindings
    if (el.globalChatSend) el.globalChatSend.addEventListener('click', window.sendGlobalChat);
    if (el.globalChatInput) el.globalChatInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') window.sendGlobalChat(); });
    if (el.btnEmoji) {
        el.btnEmoji.addEventListener('click', () => {
            el.emojiPicker.style.display = el.emojiPicker.style.display === 'none' ? 'flex' : 'none';
        });
    }

    // Tab Navigation for Sidebar
    document.querySelectorAll('.sidebar-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.sidebar-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.sidebar-pane').forEach(p => p.classList.remove('active'));
            
            const target = e.currentTarget.getAttribute('data-target');
            e.currentTarget.classList.add('active');
            $(`#${target}`).classList.add('active');
        });
    });

    // Auto-populate join name
    const savedName = localStorage.getItem('screencord_user_name');
    if (savedName && el.joinName) el.joinName.value = savedName;
});

// ─── Theme Logic ───
function initTheme() {
    const savedTheme = localStorage.getItem('screencord_theme');
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    if (savedTheme === 'light' || (!savedTheme && prefersLight)) {
        document.documentElement.setAttribute('data-theme', 'light');
    }
}

window.toggleTheme = function() {
    const root = document.documentElement;
    if (root.getAttribute('data-theme') === 'light') {
        root.removeAttribute('data-theme');
        localStorage.setItem('screencord_theme', 'dark');
    } else {
        root.setAttribute('data-theme', 'light');
        localStorage.setItem('screencord_theme', 'light');
    }
}

// ─── Navigation & Global Sidebar Injection ───
window.navigate = function(viewId) {
    currentView = viewId;
    el.views.forEach(v => v.style.display = 'none');
    const targetView = $(`#view-${viewId}`);
    if (targetView) targetView.style.display = 'block';

    el.navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('data-nav') === viewId);
    });

    if (viewId === 'recordings') loadRecordings();
    
    if (viewId !== 'live' && viewId !== 'watch' && viewId !== 'share-playback') {
        if (window.ScreencordShare) ScreencordShare.destroy();
    }

    // Inject Sidebar Logic
    if (el.globalSidebar) {
        if (['live', 'watch', 'share-playback'].includes(viewId)) {
            const panel = targetView.querySelector('.live-panel');
            if (panel) panel.appendChild(el.globalSidebar);
            el.globalSidebar.style.display = 'flex';
            
            // Show host controls in resources if host
            if (el.hostResourceControls) {
                el.hostResourceControls.style.display = (viewId === 'live' || viewId === 'share-playback') ? 'block' : 'none';
            }
        } else {
            el.globalSidebar.style.display = 'none';
            document.body.appendChild(el.globalSidebar); // Park it freely in body when hidden to prevent layout breaks
        }
    }
}

// ─── Stream Preparation ───
async function createMixedStream() {
    try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 60 }, cursor: 'always' },
            audio: systemAudioEnabled
        });

        let micStream = null;
        if (micEnabled) {
            try {
                micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (err) {
                showToast('Microphone not available', 'error');
            }
        }

        const combinedStream = new MediaStream();
        displayStream.getVideoTracks().forEach(t => combinedStream.addTrack(t));

        if (systemAudioEnabled || micStream) {
            const audioCtx = new AudioContext();
            const dest = audioCtx.createMediaStreamDestination();

            if (displayStream.getAudioTracks().length > 0) {
                const sysSrc = audioCtx.createMediaStreamSource(new MediaStream([displayStream.getAudioTracks()[0]]));
                sysSrc.connect(dest);
            }

            if (micStream) {
                const micSrc = audioCtx.createMediaStreamSource(micStream);
                micSrc.connect(dest);
            }

            if (dest.stream.getAudioTracks().length > 0) {
                dest.stream.getAudioTracks().forEach(t => combinedStream.addTrack(t));
            }
        }
        return combinedStream;
    } catch (err) {
        if (err.name !== 'NotAllowedError') showToast('Failed to start stream', 'error');
        return null;
    }
}

async function setupRecordStream() {
    const stream = await createMixedStream();
    if (!stream) return;
    currentStream = stream;

    el.preview.srcObject = currentStream;
    el.preview.play();
    el.preview.classList.add('active');
    el.placeholder.style.display = 'none';

    el.shareScreenBtn.style.display = 'none';
    el.startBtn.style.display = 'flex';
    el.stopBtn.style.display = 'none';
    
    currentStream.getVideoTracks()[0].onended = () => {
        if (isRecording) stopRecording();
        resetStreamMode();
    };
    showToast('Screen shared successfully. Click "Record" when ready.', 'success');
}

async function setupLiveStream() {
    const stream = await createMixedStream();
    if (!stream) return;
    currentStream = stream;

    el.livePreview.srcObject = currentStream;
    el.livePreview.play();
    el.livePreview.classList.add('active');
    el.livePlaceholder.style.display = 'none';

    el.liveShareBtn.style.display = 'none';
    el.liveStartBtn.style.display = 'flex';
    el.liveStopBtn.style.display = 'none';
    
    currentStream.getVideoTracks()[0].onended = () => {
        if (window.ScreencordShare && ScreencordShare.peer) stopLiveSession();
        resetLiveMode();
    };
    showToast('Screen ready. Click "Go Live" to get your code.', 'info');
}

function resetStreamMode() {
    currentStream = null;
    if (el.preview.srcObject) {
         el.preview.srcObject.getTracks().forEach(t => t.stop());
    }
    el.preview.srcObject = null;
    el.preview.classList.remove('active');
    el.placeholder.style.display = 'flex';
    
    el.shareScreenBtn.style.display = 'flex';
    el.startBtn.style.display = 'none';
    el.stopBtn.style.display = 'none';
}

function resetLiveMode() {
    currentStream = null;
    if (el.livePreview.srcObject) {
         el.livePreview.srcObject.getTracks().forEach(t => t.stop());
    }
    el.livePreview.srcObject = null;
    el.livePreview.classList.remove('active');
    el.livePlaceholder.style.display = 'flex';
    
    el.liveShareBtn.style.display = 'flex';
    el.liveStartBtn.style.display = 'none';
    el.liveStopBtn.style.display = 'none';
}

// ─── Recording Logic ───
async function toggleMic() {
    micEnabled = !micEnabled;
    el.micToggle.classList.toggle('active', micEnabled);
}

async function toggleAudio() {
    systemAudioEnabled = !systemAudioEnabled;
    el.audioToggle.classList.toggle('active', systemAudioEnabled);
}

function startRecording() {
    if (!currentStream) return showToast('Please share your screen first.', 'error');

    try {
        mediaRecorder = new MediaRecorder(currentStream, {
            mimeType: 'video/webm;codecs=vp9,opus'
        });

        recordedChunks = [];
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = showSaveRecordingModal;
        mediaRecorder.start();

        setRecordingUI(true);
        startTimer();

    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    mediaRecorder.stop();
    setRecordingUI(false);
    stopTimer();
    resetStreamMode();
}

function setRecordingUI(active) {
    isRecording = active;
    el.startBtn.style.display = 'none';
    el.shareScreenBtn.style.display = 'none';
    el.stopBtn.style.display = active ? 'flex' : 'none';
    
    el.statusBadge.classList.toggle('recording', active);
    el.statusText.textContent = active ? 'Recording' : 'Ready';
    el.recBadge.classList.toggle('active', active);
}

// ─── Timer Logic ───
function startTimer() {
    startTime = Date.now();
    el.timerH.textContent = '00';
    el.timerM.textContent = '00';
    el.timerS.textContent = '00';
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const h = Math.floor(elapsed / 3600000);
        const m = Math.floor((elapsed % 3600000) / 60000);
        const s = Math.floor((elapsed % 60000) / 1000);
        el.timerH.textContent = h.toString().padStart(2, '0');
        el.timerM.textContent = m.toString().padStart(2, '0');
        el.timerS.textContent = s.toString().padStart(2, '0');
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

// ─── Save Modal ───
function showSaveRecordingModal() {
    tempRecordingBlob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(tempRecordingBlob);
    
    el.savePreviewVideo.src = url;
    el.saveName.value = 'Recording ' + new Date().toLocaleString();
    el.saveModal.style.display = 'flex';
}

window.closeSaveModal = function() {
    el.saveModal.style.display = 'none';
    el.savePreviewVideo.src = '';
    tempRecordingBlob = null;
}

window.discardRecording = function() {
    if (confirm('Are you sure you want to discard this recording?')) {
        closeSaveModal();
    }
}

window.confirmSaveRecording = async function() {
    const name = el.saveName.value || 'Untitled Recording';
    
    try {
        await window.ScreencordDB.saveRecording({
            id: 'rec_' + Date.now(),
            name: name,
            blob: tempRecordingBlob,
            size: tempRecordingBlob.size,
            duration: el.timerH.textContent + ':' + el.timerM.textContent + ':' + el.timerS.textContent
        });
        
        showToast('Recording saved successfully!', 'success');
        closeSaveModal();
        navigate('recordings');
    } catch (err) {
        showToast('Failed to save recording', 'error');
    }
}

// ─── Recordings Library ───
async function loadRecordings() {
    try {
        const recordings = await window.ScreencordDB.getAllRecordings();
        el.recordingsGrid.innerHTML = '';
        
        if (recordings.length === 0) {
            el.emptyRecordings.style.display = 'flex';
            return;
        }

        el.emptyRecordings.style.display = 'none';
        recordings.forEach(rec => addRecordingToGrid(rec));
    } catch (err) {
        console.error(err);
    }
}

function addRecordingToGrid(rec) {
    const url = URL.createObjectURL(rec.blob);
    const card = document.createElement('div');
    card.className = 'recording-card';
    card.innerHTML = `
        <div class="recording-card__thumb">
            <video src="${url}"></video>
            <div class="recording-card__play">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
        </div>
        <div class="recording-card__info">
            <h3 class="recording-card__name">${rec.name}</h3>
            <div class="recording-card__meta">
                <span>${rec.duration}</span>
                <span>${(rec.size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
        </div>
        <div class="recording-card__actions">
            <button class="btn btn--ghost btn--sm" onclick="event.stopPropagation(); shareExistingRecording('${rec.id}')">
                Share
            </button>
            <button class="btn btn--danger btn--sm" onclick="event.stopPropagation(); deleteRecording('${rec.id}')">
                Delete
            </button>
        </div>
    `;
    card.onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.click();
    };
    el.recordingsGrid.appendChild(card);
}

window.deleteRecording = async function(id) {
    if (confirm('Delete this recording forever?')) {
        await window.ScreencordDB.deleteRecording(id);
        loadRecordings();
    }
}

// ─── Live Session Logic ───
async function startLiveSession() {
    if (!currentStream) return showToast('Please share your screen first.', 'error');

    resetGlobalSidebar();
    try {
        ScreencordShare.roomType = 'live';
        const code = await ScreencordShare.initSession(true);
        el.liveRoomCode.textContent = code;
        el.liveRoomInfo.style.display = 'flex';
        el.liveStartBtn.style.display = 'none';
        el.liveStopBtn.style.display = 'flex';
        
        el.globalChatInput.disabled = false;
        el.globalChatSend.disabled = false;
        
        ScreencordShare.startStreaming(currentStream);
        setupSessionHandlers();

        showToast('Live session started! Share your code.', 'success');
        
        const liveBadge = $('#live-rec-badge');
        if(liveBadge) liveBadge.classList.add('active');

    } catch (err) {
        showToast('Could not start live: ' + err.message, 'error');
    }
}

function stopLiveSession() {
    ScreencordShare.destroy();
    resetLiveMode();
    el.liveRoomInfo.style.display = 'none';
    el.globalChatInput.disabled = true;
    el.globalChatSend.disabled = true;
    
    const liveBadge = $('#live-rec-badge');
    if(liveBadge) liveBadge.classList.remove('active');
    
    showToast('Live session ended', 'info');
}

// ─── Join Logic ───
window.showJoinModal = function() { el.joinModal.style.display = 'flex'; }
window.closeJoinModal = function() { el.joinModal.style.display = 'none'; }

window.joinSession = async function() {
    const code = el.joinCode.value.toUpperCase();
    const name = el.joinName.value || 'Viewer';
    
    if (!code) return showToast('Please enter a code', 'error');
    
    // Pre-join: Update UI immediately so user knows something is happening
    const originalText = el.joinCode.value;
    el.joinCode.disabled = true;
    el.joinName.disabled = true;
    
    try {
        // Initialise state but wait for connection before navigating
        showToast('Connecting to session...', 'info');
        
        await ScreencordShare.initSession(false, code);
        await ScreencordShare.connectToHost(code, name);
        
        // Success: Now navigate
        localStorage.setItem('screencord_user_name', name);
        navigate('watch');
        closeJoinModal();
        resetGlobalSidebar();

        ScreencordShare.onStreamReceived = (stream) => {
            el.watchPreview.srcObject = stream;
            el.watchPreview.play();
            el.watchPreview.classList.add('active');
            if(el.watchPlaceholder) el.watchPlaceholder.style.display = 'none';
        };

        setupSessionHandlers();
        
        if (el.globalChatInput) el.globalChatInput.disabled = false;
        if (el.globalChatSend) el.globalChatSend.disabled = false;
        showToast('Joined session successfully!', 'success');
        
    } catch (err) {
        el.joinCode.disabled = false;
        el.joinName.disabled = false;
        showToast('Could not join: Session not found or connection failed', 'error');
    }
}

// ─── Share Existing Recording ───
window.shareExistingRecording = async function(id) {
    const rec = await ScreencordDB.getRecording(id);
    if (!rec) return;

    navigate('share-playback');
    resetGlobalSidebar();
    
    const url = URL.createObjectURL(rec.blob);
    el.sharePlaybackVideo.src = url;
    if (el.playbackRoomCode) el.playbackRoomCode.textContent = '...';
    
    try {
        ScreencordShare.roomType = 'playback';
        const code = await ScreencordShare.initSession(true);
        if (el.playbackRoomCode) el.playbackRoomCode.textContent = code;
        
        const videoEl = el.sharePlaybackVideo;
        if (videoEl.captureStream || videoEl.mozCaptureStream) {
            const stream = videoEl.captureStream ? videoEl.captureStream() : videoEl.mozCaptureStream();
            ScreencordShare.startStreaming(stream);
            setupSessionHandlers();
            
            if (el.globalChatInput) el.globalChatInput.disabled = false;
            if (el.globalChatSend) el.globalChatSend.disabled = false;
            
            showToast('Watch party ready! Attendees will see the playback when you press play.', 'success');
        } else {
            showToast('Your browser does not support stream capture for watch parties.', 'error');
        }
    } catch (err) {
        showToast('Error setting up watch party: ' + err.message, 'error');
    }
}

// ─── Global Interaction & Sidebar Logic ───

function resetGlobalSidebar() {
    activePolls = {};
    if (el.globalChatMessages) el.globalChatMessages.innerHTML = '<div class="chat-system-msg">Connected to Session.</div>';
    if (el.resourcesList) el.resourcesList.innerHTML = '<div class="chat-system-msg" style="width:100%; text-align:center;">No resources shared yet.</div>';
    if (el.globalViewerCount) el.globalViewerCount.textContent = '0';
}

function setupSessionHandlers() {
    ScreencordShare.onViewerUpdate = (count) => {
        if (el.globalViewerCount) el.globalViewerCount.textContent = count;
    };

    ScreencordShare.onMessage = (msg) => {
        if (msg.type === 'room_info') {
            const badge = $('#watch-rec-badge');
            if (badge) {
                if (msg.roomType === 'playback') {
                    badge.innerHTML = '<div class="rec-badge__dot" style="background: currentColor;"></div>WATCH PARTY';
                    badge.style.color = 'var(--purple)';
                } else {
                    badge.innerHTML = '<div class="rec-badge__dot"></div>LIVE';
                    badge.style.color = '';
                }
            }
            return;
        }
        
        if (msg.type === 'chat') {
            renderMessage(msg, false);
        } else if (msg.type === 'resource') {
            renderResource(msg, false);
            showToast('A new resource was shared!', 'info');
        } else if (msg.type === 'poll') {
            renderPoll(msg, false);
            showToast('A new poll was posted!', 'info');
        } else if (msg.type === 'poll_vote' && ScreencordShare.isHost) {
            updatePollVotes(msg.pollId, msg.optionId);
        } else if (msg.type === 'poll_results') {
            syncPollResults(msg.pollId, msg.results);
        }
    };
}

window.sendGlobalChat = function() {
    if(!el.globalChatInput || el.globalChatInput.disabled) return;
    const text = el.globalChatInput.value.trim();
    if (!text) return;
    const name = localStorage.getItem('screencord_user_name') || 'Host';
    const msg = ScreencordShare.sendMessage({ type: 'chat', text, name });
    renderMessage(msg, true);
    el.globalChatInput.value = '';
    el.emojiPicker.style.display = 'none'; // hide emoji picker if open
}

window.addEmoji = function(emoji) {
    if (el.globalChatInput && !el.globalChatInput.disabled) {
        el.globalChatInput.value += emoji;
        el.globalChatInput.focus();
        el.emojiPicker.style.display = 'none';
    }
}

window.addResource = function() {
    const title = $('#res-title').value.trim();
    const url = $('#res-url').value.trim();
    if (!title || !url) return showToast('Please enter both a title and a valid URL.', 'error');
    
    const resMsg = ScreencordShare.sendMessage({
        type: 'resource', title, url, sender: 'Host'
    });
    
    renderResource(resMsg, true);
    $('#res-title').value = '';
    $('#res-url').value = '';
    showToast('Resource logic shared!', 'success');
}

window.createPoll = function() {
    const q = $('#poll-q').value.trim();
    const o1 = $('#poll-o1').value.trim();
    const o2 = $('#poll-o2').value.trim();
    if (!q || (!o1 && !o2)) return showToast('Please enter a question and at least two options.', 'error');
    
    const pollId = 'poll_' + Date.now();
    const options = [
        { id: 'o1', text: o1, votes: 0 },
        { id: 'o2', text: o2, votes: 0 }
    ].filter(o => o.text !== '');
    
    const pollMsg = ScreencordShare.sendMessage({
        type: 'poll', id: pollId, question: q, options
    });
    
    renderPoll(pollMsg, true);
    $('#poll-q').value = '';
    $('#poll-o1').value = '';
    $('#poll-o2').value = '';
    showToast('Poll sent!', 'success');
}

function renderMessage(msg, isSelf = false) {
    if (!el.globalChatMessages) return;
    const div = document.createElement('div');
    div.className = `chat-msg ${isSelf ? 'chat-msg--self' : ''}`;
    div.innerHTML = `
        <div class="chat-msg__header">
            <span class="chat-msg__name">${msg.name}</span>
            <span class="chat-msg__time">${msg.time}</span>
        </div>
        <div class="chat-msg__text">${msg.text}</div>
    `;
    el.globalChatMessages.appendChild(div);
    el.globalChatMessages.scrollTop = el.globalChatMessages.scrollHeight;
}

function renderResource(msg, isSelf) {
    if (!el.resourcesList) return;
    const emptyMsg = el.resourcesList.querySelector('.chat-system-msg');
    if (emptyMsg) emptyMsg.remove();
    
    const a = document.createElement('a');
    a.href = msg.url;
    a.target = '_blank';
    a.className = 'resource-card';
    a.innerHTML = `
        <div class="resource-card__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </div>
        <div class="resource-card__info">
            <span class="resource-card__title">${msg.title}</span>
            <span class="resource-card__url">${msg.url}</span>
        </div>
    `;
    el.resourcesList.appendChild(a);
}

function renderPoll(msg, isSelf) {
    if (isSelf) activePolls[msg.id] = msg;
    
    if (!el.globalChatMessages) return;
    const div = document.createElement('div');
    div.className = `chat-poll`;
    div.id = msg.id;
    
    let optionsHtml = '';
    msg.options.forEach(o => {
        optionsHtml += `
            <div class="chat-poll__opt" onclick="window.votePoll('${msg.id}', '${o.id}')">
                <span class="chat-poll__opt-text">${o.text} <span id="pct-${msg.id}-${o.id}" style="float:right; opacity:0.6; font-size:0.8rem;">0% (0)</span></span>
                <div class="chat-poll__bar" id="bar-${msg.id}-${o.id}"></div>
            </div>
        `;
    });

    div.innerHTML = `
        <div class="chat-poll__q">${msg.question}</div>
        <div style="display:flex; flex-direction:column; gap:8px;">
            ${optionsHtml}
        </div>
    `;
    
    el.globalChatMessages.appendChild(div);
    el.globalChatMessages.scrollTop = el.globalChatMessages.scrollHeight;
}

window.votePoll = function(pollId, optionId) {
    ScreencordShare.sendMessage({ type: 'poll_vote', pollId, optionId });
    const opts = document.querySelectorAll(`#${pollId} .chat-poll__opt`);
    opts.forEach(opt => {
        opt.style.pointerEvents = 'none';
        opt.style.opacity = '0.7';
    });
}

function updatePollVotes(pollId, optionId) {
    if (!activePolls[pollId]) return;
    const opt = activePolls[pollId].options.find(o => o.id === optionId);
    if (opt) opt.votes++;
    
    ScreencordShare.sendMessage({
        type: 'poll_results', pollId, results: activePolls[pollId].options
    });
    
    syncPollResults(pollId, activePolls[pollId].options);
}

function syncPollResults(pollId, results) {
    const totalVotes = results.reduce((sum, o) => sum + o.votes, 0);
    results.forEach(opt => {
        const bar = document.querySelector(`#${pollId} #bar-${pollId}-${opt.id}`);
        const pctText = document.querySelector(`#${pollId} #pct-${pollId}-${opt.id}`);
        if(bar && pctText) {
            const pct = totalVotes === 0 ? 0 : Math.round((opt.votes / totalVotes) * 100);
            bar.style.width = pct + '%';
            pctText.textContent = `${pct}% (${opt.votes})`;
        }
    });
}

// Global modal handlers
window.copyRoomCode = function(id) {
    const codeElement = $(`#${id}`);
    if(!codeElement) return;
    navigator.clipboard.writeText(codeElement.textContent);
    showToast('Code copied to clipboard!', 'success');
}
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        if(el.saveModal) el.saveModal.style.display = 'none';
        if(el.joinModal) el.joinModal.style.display = 'none';
        if(el.shareModal) el.shareModal.style.display = 'none';
        if (tempRecordingBlob) window.closeSaveModal();
    }
});