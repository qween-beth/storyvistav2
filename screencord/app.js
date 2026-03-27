'use strict';

let mediaRecorder;
let recordedChunks = [];
let startTime;
let timerInterval;

const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const status = document.getElementById('status');
const timer = document.getElementById('timer');
const preview = document.getElementById('preview');

startBtn.addEventListener('click', async () => {
    try {
        status.textContent = 'Requesting Microphone access...';
        
        // 1. Get Microphone FIRST (prevents permission popups from layering behind screen share)
        let micStream;
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            console.warn("Microphone access denied or not found");
        }

        status.textContent = 'Select the Window/Tab to record...';

        // 2. Get Screen & System Audio
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            audio: true
        });

        // 3. Mix Audio (if both exist)
        const audioContext = new AudioContext();
        const mixedAudioStream = audioContext.createMediaStreamDestination();

        if (screenStream.getAudioTracks().length > 0) {
            audioContext.createMediaStreamSource(screenStream).connect(mixedAudioStream);
        }
        if (micStream && micStream.getAudioTracks().length > 0) {
            audioContext.createMediaStreamSource(micStream).connect(mixedAudioStream);
        }

        // 4. Combine Video + Mixed Audio
        const combinedStream = new MediaStream([
            ...screenStream.getVideoTracks(),
            ...mixedAudioStream.stream.getAudioTracks()
        ]);

        mediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm;codecs=vp9' });
        recordedChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            clearInterval(timerInterval);
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            
            preview.src = url;
            preview.style.display = 'block';

            const a = document.createElement('a');
            a.href = url;
            a.download = `screencord_recording_${new Date().getTime()}.webm`;
            a.click();

            status.textContent = 'Recording saved!';
            startBtn.style.display = 'flex';
            stopBtn.style.display = 'none';
            timer.style.display = 'none';
            
            // Cleanup
            screenStream.getTracks().forEach(t => t.stop());
            if (micStream) micStream.getTracks().forEach(t => t.stop());
            audioContext.close();
        };

        mediaRecorder.start();
        startBtn.style.display = 'none';
        stopBtn.style.display = 'flex';
        status.textContent = 'Recording (Screen + Mic)...';
        
        timer.style.display = 'block';
        startTime = Date.now();
        updateTimer();
        timerInterval = setInterval(updateTimer, 1000);

    } catch (err) {
        console.error(err);
        if (err.name === 'NotAllowedError') {
            status.textContent = 'Permission denied. Please click start again.';
        } else {
            alert("Recording failed: Ensure you click the 'Share System Audio' checkbox in the browser popup!");
            status.textContent = 'Ready to capture';
        }
    }
});

stopBtn.addEventListener('click', () => {
    mediaRecorder.stop();
});

function updateTimer() {
    const elapsed = Date.now() - startTime;
    const h = Math.floor(elapsed / 3600000).toString().padStart(2, '0');
    const m = Math.floor((elapsed % 3600000) / 60000).toString().padStart(2, '0');
    const s = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
    timer.textContent = `${h}:${m}:${s}`;
}
