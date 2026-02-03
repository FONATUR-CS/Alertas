import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";

// ==========================================
// GESTIÓN DE ESTADO Y VARIABLES
// ==========================================
let mediaRecorder = null;
let audioChunks = [];
let history = [];
let currentAlertText = "";
let draggedItemIndex = null;
let progressInterval = null;

let pendingBlob = null;
let pendingFileName = "";

// --- DOM Elements ---
const btnRecord = document.getElementById('btn-record');
const btnStop = document.getElementById('btn-stop');
const fileInput = document.getElementById('file-input');
const btnClearHistory = document.getElementById('btn-clear-history');
const btnCopy = document.getElementById('btn-copy');
const btnCopyText = document.getElementById('btn-copy-text');
const btnSettings = document.getElementById('btn-settings');
const btnTraining = document.getElementById('btn-training');

const apiModal = document.getElementById('api-modal');
const apiKeyInput = document.getElementById('api-key-input');
const btnSaveKey = document.getElementById('btn-save-key');
const trainingModal = document.getElementById('training-modal');
const trainingInput = document.getElementById('training-input');
const btnSaveTraining = document.getElementById('btn-save-training');

const emptyState = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');
const progressBar = document.getElementById('progress-bar');
const progressPercentage = document.getElementById('progress-percentage');
const progressStatus = document.getElementById('progress-status');

const resultContainer = document.getElementById('result-container');
const alertContent = document.getElementById('alert-content');
const errorBanner = document.getElementById('error-banner');
const errorMessage = document.getElementById('error-message');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) window.lucide.createIcons();
    loadHistory();
    checkApiKey();
    loadTrainingData();
});

// --- API Key Management ---
function getApiKey() {
    return localStorage.getItem('fonatur_gemini_key') || "";
}

function checkApiKey() {
    const key = getApiKey();
    if (key) apiKeyInput.value = key;
}

function showModal() {
    const key = getApiKey();
    if (key) apiKeyInput.value = key;
    apiModal.classList.remove('hidden');
}

function hideModal() {
    apiModal.classList.add('hidden');
}

btnSaveKey.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key.length > 5) {
        localStorage.setItem('fonatur_gemini_key', key);
        hideModal();
        errorBanner.classList.add('hidden');
        if (pendingBlob) {
            showError("Clave actualizada. Reintentando...", false);
            processAudio(pendingBlob, pendingFileName);
        }
    } else {
        alert("Por favor, ingresa una API Key válida.");
    }
});

btnSettings.addEventListener('click', () => showModal());

// --- Training / Style Management ---
async function loadTrainingData() {
    try {
        const response = await fetch('training.json');
        if (response.ok) {
            const data = await response.json();
            if (data.style_examples) {
                trainingInput.value = data.style_examples;
                localStorage.setItem('fonatur_style_examples', data.style_examples);
                return;
            }
        }
    } catch (e) {
        console.warn("Usando caché local.");
    }
    const examples = localStorage.getItem('fonatur_style_examples');
    if (examples) trainingInput.value = examples;
}

btnSaveTraining.addEventListener('click', () => {
    localStorage.setItem('fonatur_style_examples', trainingInput.value);
    document.getElementById('training-modal').classList.add('hidden');
    showError("Estilo guardado.", false);
    setTimeout(() => errorBanner.classList.add('hidden'), 2000);
});

// --- History & UI Helpers ---
function loadHistory() {
    const saved = localStorage.getItem('fonatur_alert_history');
    if (saved) {
        history = JSON.parse(saved);
        renderHistory();
    }
}

function saveToHistory(content, audioName) {
    const newAlert = { id: Date.now().toString(), timestamp: Date.now(), content, audioName };
    history = [newAlert, ...history].slice(0, 30);
    localStorage.setItem('fonatur_alert_history', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    Array.from(historyList.children).forEach(child => {
        if (child.id !== 'history-empty') historyList.removeChild(child);
    });

    if (history.length === 0) {
        historyEmpty.classList.remove('hidden');
        btnClearHistory.classList.add('hidden');
    } else {
        historyEmpty.classList.add('hidden');
        btnClearHistory.classList.remove('hidden');

        history.forEach((item) => {
            const btn = document.createElement('div');
            btn.className = "w-full cursor-pointer p-3 rounded-lg bg-[#13322b]/40 hover:bg-[#13322b] border border-[#1a3d35] transition-all group mb-2";
            btn.innerHTML = `
                <div>
                    <p class="text-[10px] text-[#bd9751] font-bold mb-1 opacity-70">${new Date(item.timestamp).toLocaleDateString('es-MX')}</p>
                    <p class="text-sm font-medium line-clamp-2 text-gray-300 group-hover:text-white">${item.audioName || "Comunicado"}</p>
                </div>
            `;
            btn.onclick = () => showResult(item.content);
            historyList.appendChild(btn);
        });
    }
}

// --- Progress & States ---
function updateProgress(value, statusText) {
    progressBar.style.width = `${value}%`;
    progressPercentage.innerText = `${Math.round(value)}%`;
    if (statusText) progressStatus.innerText = statusText;
}

function startSimulatedProgress() {
    let current = 0;
    clearInterval(progressInterval);
    updateProgress(0, "Iniciando...");
    progressInterval = setInterval(() => {
        if (current < 90) {
            current += (95 - current) * 0.05;
            updateProgress(current);
        }
    }, 500);
}

function stopProgress(success = true) {
    clearInterval(progressInterval);
    updateProgress(success ? 100 : 0, success ? "Completado" : "Error");
}

function setLoading(isLoading) {
    if (isLoading) {
        emptyState.classList.add('hidden');
        resultContainer.classList.add('hidden');
        loadingState.classList.remove('hidden');
        btnRecord.disabled = true;
        fileInput.disabled = true;
        startSimulatedProgress();
    } else {
        btnRecord.disabled = false;
        fileInput.disabled = false;
        loadingState.classList.add('hidden');
    }
}

function showResult(text) {
    currentAlertText = text;
    alertContent.innerText = text;
    emptyState.classList.add('hidden');
    loadingState.classList.add('hidden');
    resultContainer.classList.remove('hidden');
}

function showError(msg, isError = true) {
    errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
    if (isError) {
        setLoading(false);
        stopProgress(false);
        emptyState.classList.remove('hidden');
    }
}

function parseErrorMessage(err) {
    let raw = err.message || "Error desconocido";
    // Si es un error 404, imprimimos más detalle en consola para ti
    console.error("Detalle del error de Gemini:", err);
    if (raw.includes('404')) return "Modelo no encontrado. Verifica si el nombre 'gemini-1.5-flash' es correcto para tu zona.";
    if (raw.includes('expired') || raw.includes('401')) return "API Key expirada. Por favor renuévala.";
    return raw;
}

function getMimeType(blob, fileName) {
    if (blob.type && blob.type !== 'application/octet-stream') return blob.type;
    const ext = fileName.split('.').pop().toLowerCase();
    const mimeMap = { 'mp3': 'audio/mp3', 'wav': 'audio/wav', 'm4a': 'audio/mp4', 'mp4': 'video/mp4', 'webm': 'audio/webm' };
    return mimeMap[ext] || 'audio/mpeg';
}

function getCurrentDateFormatted() {
    const date = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    let formatted = date.toLocaleDateString('es-MX', options);
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

// ==========================================
// CORE: PROCESAMIENTO CON GEMINI 1.5 FLASH
// ==========================================
async function processAudio(blob, fileName = "Audio Institucional") {
    const apiKey = getApiKey();
    if (!apiKey) {
        pendingBlob = blob;
        pendingFileName = fileName;
        showModal();
        return;
    }

    setLoading(true);
    const systemDate = getCurrentDateFormatted();
    const userExamples = localStorage.getItem('fonatur_style_examples') || "";
    let trainingContext = userExamples.trim().length > 0 ? `\nESTILO DE REFERENCIA:\n${userExamples}\n` : "";

    const ai = new GoogleGenAI({ apiKey });
    const mimeType = getMimeType(blob, fileName);
    let uploadedFile = null;

    try {
        updateProgress(15, "Subiendo audio...");
        uploadedFile = await ai.files.upload({
            file: blob,
            config: { mimeType }
        });

        updateProgress(30, "Esperando procesamiento del servidor...");
        let fileStatus = await ai.files.get({ name: uploadedFile.name });
        
        // Polling para asegurar que el archivo esté ACTIVE
        while (fileStatus.state === "PROCESSING") {
            await new Promise(resolve => setTimeout(resolve, 2500));
            fileStatus = await ai.files.get({ name: uploadedFile.name });
        }

        if (fileStatus.state === "FAILED") throw new Error("Error en procesamiento de archivo.");

        updateProgress(60, "Redactando contenido...");

        // RECUERDA: PEGA AQUÍ TU PROMPT COMPLETO ORIGINAL
        const prompt = `ACTÚA COMO: Redactor/a senior de Comunicación Social de FONATUR. 
        OBJETIVO: Generar una “Alerta de Prensa” fidedigna usando la fecha ${systemDate} y el contexto ${trainingContext}. 
        Sigue las reglas de formato de asteriscos y párrafos que definimos.`;

        // CAMBIO CRÍTICO: Usamos el ID de modelo estándar
        const responseStream = await ai.models.generateContentStream({
            model: 'gemini-1.5-flash', 
            contents: createUserContent([
                createPartFromUri(uploadedFile.uri, fileStatus.mimeType || mimeType),
                prompt
            ])
        });

        let fullText = "";
        let isFirst = true;

        for await (const chunk of responseStream) {
            if (chunk.text) {
                fullText += chunk.text;
                if (isFirst) {
                    stopProgress(true);
                    loadingState.classList.add('hidden');
                    resultContainer.classList.remove('hidden');
                    emptyState.classList.add('hidden');
                    isFirst = false;
                }
                alertContent.innerText = fullText;
            }
        }

        if (fullText) {
            currentAlertText = fullText;
            saveToHistory(fullText, fileName);
            setLoading(false);
            pendingBlob = null;
        }

    } catch (err) {
        const rawErr = parseErrorMessage(err);
        showError("Error de IA: " + rawErr);
        if (rawErr.toLowerCase().includes('key') || rawErr.includes('401')) {
            localStorage.removeItem('fonatur_gemini_key');
            showModal();
        }
    } finally {
        if (uploadedFile?.name) {
            try { await ai.files.delete({ name: uploadedFile.name }); } catch (e) {}
        }
    }
}

// --- Listeners ---
btnRecord.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            processAudio(new Blob(audioChunks, { type: 'audio/webm' }), "Grabación Directa");
            stream.getTracks().forEach(t => t.stop());
        };
        mediaRecorder.start();
        btnRecord.classList.add('hidden');
        btnStop.classList.remove('hidden');
    } catch (err) { showError("Micrófono no disponible."); }
});

btnStop.addEventListener('click', () => {
    if (mediaRecorder?.state !== 'inactive') {
        mediaRecorder.stop();
        btnStop.classList.add('hidden');
        btnRecord.classList.remove('hidden');
    }
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processAudio(file, file.name);
    fileInput.value = '';
});

btnCopy.addEventListener('click', () => {
    if (currentAlertText) {
        navigator.clipboard.writeText(currentAlertText);
        btnCopyText.innerText = "COPIADO";
        setTimeout(() => btnCopyText.innerText = "COPIAR TEXTO", 2000);
    }
});

btnClearHistory.addEventListener('click', () => {
    if (confirm("¿Borrar todo el historial?")) {
        history = [];
        localStorage.removeItem('fonatur_alert_history');
        renderHistory();
    }
});
