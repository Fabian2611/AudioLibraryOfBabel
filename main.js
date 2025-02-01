const BASE = 65536;
const BITRATE = 48000;  // Set the desired bitrate here

function audioBufferToWavFile(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length * numChannels * 2; // 2 bytes per sample
    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);
    
    // Write WAV header
    // "RIFF" chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(view, 8, 'WAVE');
    
    // "fmt " sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // subchunk1 size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, audioBuffer.sampleRate, true);
    view.setUint32(28, audioBuffer.sampleRate * numChannels * 2, true); // byte rate
    view.setUint16(32, numChannels * 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    
    // "data" sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, length, true);
    
    // Write audio data
    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
            view.setInt16(offset, sample * 32767, true);
            offset += 2;
        }
    }
    
    return buffer;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function downloadWav(audioBuffer, filename = 'audio.wav') {
    const wavBuffer = audioBufferToWavFile(audioBuffer);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function playWav(buffer) {
    // If we receive an AudioBuffer, we can play it directly
    if (buffer instanceof AudioBuffer) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start();
        
        source.onended = () => {
            // Audio finished
        };
    } else {
        // If we receive an ArrayBuffer, decode it first
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContext.decodeAudioData(buffer, (audioBuffer) => {
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.start();
            
            source.onended = () => {
                // Audio finished
            };
        });
    }
}

async function resampleToBitrate(audioBuffer, targetSampleRate) {
    if (audioBuffer.sampleRate === targetSampleRate) {
        return audioBuffer;
    }

    const offlineContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.length * targetSampleRate / audioBuffer.sampleRate,
        targetSampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();

    return await offlineContext.startRendering();
}

function normalizeSamples(samples) {
    const maxSample = Math.max(...samples.map(Math.abs));
    if (maxSample === 0) {
        return samples;
    }
    return samples.map(sample => Math.round((sample / maxSample) * 32767));
}

async function stereoToMono(audioBuffer) {
    console.log("Converting stereo audio to mono...");
    if (audioBuffer.numberOfChannels !== 2) {
        throw new Error("Only stereo audio can be converted to mono.");
    }

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const monoBuffer = audioContext.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = audioBuffer.getChannelData(1);
    const monoChannel = monoBuffer.getChannelData(0);

    for (let i = 0; i < leftChannel.length; i++) {
        monoChannel[i] = (leftChannel[i] + rightChannel[i]) / 2;
    }

    return monoBuffer;
}

async function wavToId(buffer) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    try {
        const audioBuffer = await audioContext.decodeAudioData(buffer);

        console.log("Num channels: " + audioBuffer.numberOfChannels);
        console.log("Sample rate: " + audioBuffer.sampleRate);
        console.log("Length: " + audioBuffer.length);

        let finalAudioBuffer = await resampleToBitrate(audioBuffer, BITRATE);
        if (audioBuffer.numberOfChannels === 2) {
            finalAudioBuffer = await stereoToMono(finalAudioBuffer);
        }

        console.log("Final buffer - Num channels: " + finalAudioBuffer.numberOfChannels);
        console.log("Final buffer - Sample rate: " + finalAudioBuffer.sampleRate);
        console.log("Final buffer - Length: " + finalAudioBuffer.length);

        if (finalAudioBuffer.numberOfChannels !== 1 || finalAudioBuffer.sampleRate !== BITRATE || finalAudioBuffer.length !== BITRATE) {
            throw new Error("Invalid WAV file format after processing.");
        }

        const samples = Array.from(finalAudioBuffer.getChannelData(0));
        const normalizedSamples = normalizeSamples(samples);

        let uid = BigInt(0);
        for (let i = 0; i < normalizedSamples.length; i++) {
            uid = uid * BigInt(BASE) + BigInt(normalizedSamples[i] + 32768);
        }

        return { id: uid, audioBuffer: finalAudioBuffer };
    } catch (error) {
        throw new Error("Error processing WAV file: " + error.message);
    }
}

function idToWav(uniqueId) {
    console.log("Converting ID to WAV...");
    const samples = [];
    let remainingId = uniqueId;

    for (let i = 0; i < BITRATE; i++) {
        const sample = Number(remainingId % BigInt(BASE)) - 32768;
        remainingId = remainingId / BigInt(BASE);
        samples.push(sample);
    }

    samples.reverse();

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = audioContext.createBuffer(1, samples.length, BITRATE);
    const channelData = buffer.getChannelData(0);

    for (let i = 0; i < samples.length; i++) {
        channelData[i] = samples[i] / 32767;
    }

    return buffer;
}

function play() {
    const id = BigInt(document.getElementById("idinput").value);
    const buffer = idToWav(id);
    playWav(buffer);
    // Store the buffer for later download
    window.lastGeneratedBuffer = buffer;
    // Enable download of the generated audio
    document.getElementById("download").style.display = "block";
}

function randomplay() {
    const id = BigInt(Math.floor(Math.random() * BASE)) ** BigInt(BITRATE);
    document.getElementById("idinput").value = id.toString();
    play();
}

function download() {
    if (window.lastGeneratedBuffer) {
        downloadWav(window.lastGeneratedBuffer, 'generated_audio.wav');
    }
}

addEventListener("DOMContentLoaded", () => {
    const fileInput = document.getElementById('fileinput');
    fileInput.addEventListener('change', (event) => {
        console.log("File uploaded");
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const arrayBuffer = e.target.result;
                try {
                    const result = await wavToId(arrayBuffer);
                    document.getElementById("idoutput").textContent = result.id.toString();
                    // Store the original audio buffer for download
                    window.lastGeneratedBuffer = result.audioBuffer;
                    // Show download button
                    document.getElementById("download").style.display = "block";
                } catch (error) {
                    console.error(error);
                    document.getElementById("idoutput").textContent = "Error: " + error.message;
                    document.getElementById("download").style.display = "none";
                }
            };
            reader.readAsArrayBuffer(file);
        }
    });
});