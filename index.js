import { GoogleGenAI } from "@google/genai";

// === VARIABLES Y ESTADO ===
let mediaRecorder = null;
let audioChunks = [];
let progressInterval = null;

const btnRecord = document.getElementById('btn-record');
const btnStop = document.getElementById('btn-stop');
const fileInput = document.getElementById('file-input');
const alertContent = document.getElementById('alert-content');
const loadingState = document.getElementById('loading-state');
const emptyState = document.getElementById('empty-state');
const resultContainer = document.getElementById('result-container');
const progressBar = document.getElementById('progress-bar');
const progressStatus = document.getElementById('progress-status');
const apiModal = document.getElementById('api-modal');
const apiKeyInput = document.getElementById('api-key-input');
const historyList = document.getElementById('history-list');

document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) window.lucide.createIcons();
    loadHistory();
    apiKeyInput.value = localStorage.getItem('fonatur_gemini_key') || "";
    document.getElementById('training-input').value = localStorage.getItem('fonatur_style_examples') || "";
});

// === CORE: PROCESAMIENTO ===
async function processAudio(blob, fileName = "Audio Institucional") {
    const apiKey = localStorage.getItem('fonatur_gemini_key');
    if (!apiKey) { apiModal.classList.remove('hidden'); return; }

    setLoading(true);
    const date = new Date();
    const systemDateFormatted = `${date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`.replace(/^\w/, c => c.toUpperCase());
    const trainingContext = localStorage.getItem('fonatur_style_examples') || "";

    const genAI = new GoogleGenAI(apiKey);

    try {
        updateProgress(15, "Subiendo audio oficial...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // Carga de archivo
        const uploadResult = await model.uploadFile(blob, { mimeType: blob.type || "audio/mpeg", displayName: fileName });
        
        // Polling de estado
        let file = await model.getFile(uploadResult.name);
        while (file.state === "PROCESSING") {
            updateProgress(35, "Gemini analizando audio...");
            await new Promise(r => setTimeout(r, 3000));
            file = await model.getFile(uploadResult.name);
        }

        if (file.state === "FAILED") throw new Error("Fallo en procesamiento de audio.");

        updateProgress(70, "Generando redacción institucional...");

        const prompt = `ACTÚA COMO: Redactor/a senior de Comunicación Social de FONATUR. 
OBJETIVO: Escuchar el audio y generar una “Alerta de Prensa” fidedigna. 
REGLAS: Sin Markdown (solo asteriscos en encabezado/titular). FECHA: ${systemDateFormatted}.
PRINCIPIOS: Lealtad absoluta al audio, incertidumbre = omisión.
ESTILO: Formal e institucional.
CONTEXTO: ${trainingContext}
ESTRUCTURA:
*[ENCABEZADO]*
${systemDateFormatted}
*[TITULAR]*
[Cuerpo máx 4 párrafos]
[Cierre]`;

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
        showError("Error técnico: " + err.message);
    } finally {
        setLoading(false);
    }
}

// === INTERFAZ ===
function updateProgress(val, status) {
    progressBar.style.width = val + "%";
    if (status) progressStatus.innerText = status;
}

function setLoading(isLoading) {
    if (isLoading) {
        emptyState.classList.add('hidden'); resultContainer.classList.add('hidden');
        loadingState.classList.remove('hidden'); startSimulatedProgress();
    } else { loadingState.classList.add('hidden'); clearInterval(progressInterval); }
}

function startSimulatedProgress() {
    let p = 0; clearInterval(progressInterval);
    progressInterval = setInterval(() => { if (p < 95) { p += 1; updateProgress(p); } }, 600);
}

function showError(msg) {
    document.getElementById('error-message').innerText = msg;
    document.getElementById('error-banner').classList.remove('hidden');
    setLoading(false);
}

function loadHistory() {
    const saved = JSON.parse(localStorage.getItem('fonatur_alert_history') || "[]");
    historyList.innerHTML = "";
    saved.forEach(item => {
        const div = document.createElement('div');
        div.className = "p-3 rounded bg-[#13322b]/40 border border-[#1a3d35] mb-2 cursor-pointer hover:bg-[#13322b]";
        div.innerHTML = `<p class="text-[10px] text-[#bd9751] font-bold">${new Date(item.timestamp).toLocaleDateString()}</p><p class="text-xs text-gray-400">${item.audioName}</p>`;
        div.onclick = () => { alertContent.innerText = item.content; emptyState.classList.add('hidden'); resultContainer.classList.remove('hidden'); };
        historyList.appendChild(div);
    });
}

function saveToHistory(content, audioName) {
    const saved = JSON.parse(localStorage.getItem('fonatur_alert_history') || "[]");
    saved.unshift({ timestamp: Date.now(), content, audioName });
    localStorage.setItem('fonatur_alert_history', JSON.stringify(saved.slice(0, 10)));
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
    } catch (e) { showError("Micrófono no permitido."); }
});

btnStop.onclick = () => { mediaRecorder.stop(); btnStop.classList.add('hidden'); btnRecord.classList.remove('hidden'); };
fileInput.onchange = e => { if (e.target.files[0]) processAudio(e.target.files[0], e.target.files[0].name); e.target.value = ''; };
document.getElementById('btn-save-key').onclick = () => { localStorage.setItem('fonatur_gemini_key', apiKeyInput.value.trim()); apiModal.classList.add('hidden'); };
document.getElementById('btn-save-training').onclick = () => { localStorage.setItem('fonatur_style_examples', document.getElementById('training-input').value); document.getElementById('training-modal').classList.add('hidden'); };
document.getElementById('btn-settings').onclick = () => apiModal.classList.remove('hidden');
document.getElementById('btn-training').onclick = () => document.getElementById('training-modal').classList.remove('hidden');
document.getElementById('btn-copy').onclick = () => { navigator.clipboard.writeText(alertContent.innerText); alert('Texto copiado'); };
document.getElementById('btn-clear-history').onclick = () => { localStorage.removeItem('fonatur_alert_history'); loadHistory(); };
