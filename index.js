import { GoogleGenAI } from "@google/genai";

// === ESTADO Y ELEMENTOS ===
let mediaRecorder = null;
let audioChunks = [];
let history = [];
let currentAlertText = "";
let progressInterval = null;
let pendingBlob = null;
let pendingFileName = "";

const btnRecord = document.getElementById('btn-record');
const btnStop = document.getElementById('btn-stop');
const fileInput = document.getElementById('file-input');
const alertContent = document.getElementById('alert-content');
const loadingState = document.getElementById('loading-state');
const emptyState = document.getElementById('empty-state');
const resultContainer = document.getElementById('result-container');
const progressBar = document.getElementById('progress-bar');
const progressPercentage = document.getElementById('progress-percentage');
const progressStatus = document.getElementById('progress-status');
const apiModal = document.getElementById('api-modal');
const apiKeyInput = document.getElementById('api-key-input');
const historyList = document.getElementById('history-list');

document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) window.lucide.createIcons();
    loadHistory();
    const key = localStorage.getItem('fonatur_gemini_key');
    if (key) apiKeyInput.value = key;
    const examples = localStorage.getItem('fonatur_style_examples');
    if (examples) document.getElementById('training-input').value = examples;
});

// === CORE: PROCESAMIENTO ===
async function processAudio(blob, fileName = "Audio Institucional") {
    const apiKey = localStorage.getItem('fonatur_gemini_key');
    if (!apiKey) {
        pendingBlob = blob; pendingFileName = fileName;
        apiModal.classList.remove('hidden');
        return;
    }

    setLoading(true);
    const date = new Date();
    const weekdays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const systemDateFormatted = `${weekdays[date.getDay()]} ${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`.replace(/^\w/, c => c.toUpperCase());
    const trainingContext = localStorage.getItem('fonatur_style_examples') || "";

    const genAI = new GoogleGenAI(apiKey);

    try {
        updateProgress(15, "Subiendo audio oficial...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const uploadResult = await model.uploadFile(blob, { mimeType: blob.type || "audio/mpeg", displayName: fileName });

        let file = await model.getFile(uploadResult.name);
        while (file.state === "PROCESSING") {
            await new Promise(r => setTimeout(r, 3000));
            file = await model.getFile(uploadResult.name);
        }

        updateProgress(70, "Generando redacción...");

        const prompt = `ACTÚA COMO: Redactor/a senior de Comunicación Social de FONATUR. 
OBJETIVO: Escuchar el audio y generar una “Alerta de Prensa” fidedigna.
REGLAS: Sin Markdown (solo asteriscos en encabezado/titular). FECHA: ${systemDateFormatted}. Máximo 4 párrafos.
CONTEXTO: ${trainingContext}
INSTRUCCIÓN: Entrega SOLO el texto final. Fecha exacta: ${systemDateFormatted}.`;

        const result = await model.generateContentStream([
            { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
            { text: prompt }
        ]);

        let fullText = "";
        for await (const chunk of result.stream) {
            fullText += chunk.text();
            alertContent.innerText = fullText;
            loadingState.classList.add('hidden');
            resultContainer.classList.remove('hidden');
        }
        saveToHistory(fullText, fileName);
    } catch (err) {
        showError("Error: " + err.message);
    } finally {
        setLoading(false);
    }
}

// === UTILIDADES UI ===
function updateProgress(val, status) {
    progressBar.style.width = val + "%";
    progressPercentage.innerText = val + "%";
    if (status) progressStatus.innerText = status;
}

function setLoading(isLoading) {
    if (isLoading) {
        emptyState.classList.add('hidden');
        resultContainer.classList.add('hidden');
        loadingState.classList.remove('hidden');
        startSimulatedProgress();
    } else {
        loadingState.classList.add('hidden');
        clearInterval(progressInterval);
    }
}

function startSimulatedProgress() {
    let p = 0; clearInterval(progressInterval);
    progressInterval = setInterval(() => { if (p < 95) { p += 1; updateProgress(p); } }, 600);
}

function showError(msg) {
    const banner = document.getElementById('error-banner');
    document.getElementById('error-message').textContent = msg;
    banner.classList.remove('hidden');
    setLoading(false);
}

function loadHistory() {
    const saved = localStorage.getItem('fonatur_alert_history');
    if (saved) {
        history = JSON.parse(saved);
        historyList.innerHTML = "";
        history.forEach(item => {
            const div = document.createElement('div');
            div.className = "w-full p-3 rounded-lg bg-[#13322b]/40 border border-[#1a3d35] mb-2 cursor-pointer";
            div.innerHTML = `<p class="text-[10px] text-[#bd9751] font-bold">${new Date(item.timestamp).toLocaleDateString()}</p><p class="text-sm text-gray-300">${item.audioName}</p>`;
            div.onclick = () => { alertContent.innerText = item.content; emptyState.classList.add('hidden'); resultContainer.classList.remove('hidden'); };
            historyList.appendChild(div);
        });
    }
}

function saveToHistory(content, audioName) {
    const alert = { timestamp: Date.now(), content, audioName };
    history = [alert, ...history].slice(0, 20);
    localStorage.setItem('fonatur_alert_history', JSON.stringify(history));
    loadHistory();
}

// === LISTENERS ===
btnRecord.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            processAudio(new Blob(audioChunks, { type: 'audio/webm' }), "Grabación Directa");
            stream.getTracks().forEach(t => t.stop());
        };
        mediaRecorder.start();
        btnRecord.classList.add('hidden'); btnStop.classList.remove('hidden');
    } catch (e) { showError("Micrófono no detectado."); }
});

btnStop.addEventListener('click', () => { mediaRecorder.stop(); btnStop.classList.add('hidden'); btnRecord.classList.remove('hidden'); });

fileInput.addEventListener('change', e => { if (e.target.files[0]) processAudio(e.target.files[0], e.target.files[0].name); });

document.getElementById('btn-save-key').addEventListener('click', () => {
    localStorage.setItem('fonatur_gemini_key', apiKeyInput.value.trim());
    apiModal.classList.add('hidden');
});

document.getElementById('btn-save-training').addEventListener('click', () => {
    localStorage.setItem('fonatur_style_examples', document.getElementById('training-input').value);
    document.getElementById('training-modal').classList.add('hidden');
});

document.getElementById('btn-settings').onclick = () => apiModal.classList.remove('hidden');
document.getElementById('btn-training').onclick = () => document.getElementById('training-modal').classList.remove('hidden');
document.getElementById('btn-close-training').onclick = () => document.getElementById('training-modal').classList.add('hidden');
document.getElementById('btn-copy').onclick = () => navigator.clipboard.writeText(alertContent.innerText);
