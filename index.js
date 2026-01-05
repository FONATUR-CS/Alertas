
import { GoogleGenAI } from "@google/genai";

// ==========================================
// SEGURIDAD: GESTIÓN DE API KEY
// ==========================================
let mediaRecorder = null;
let audioChunks = [];
let history = [];
let currentAlertText = "";
let draggedItemIndex = null;
let progressInterval = null;

// Variables para "recordar" el archivo si falta la clave o falla la auth
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

// Modal Elements
const apiModal = document.getElementById('api-modal');
const apiKeyInput = document.getElementById('api-key-input');
const btnSaveKey = document.getElementById('btn-save-key');
const trainingModal = document.getElementById('training-modal');
const trainingInput = document.getElementById('training-input');
const btnSaveTraining = document.getElementById('btn-save-training');
const btnCloseTraining = document.getElementById('btn-close-training');

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
    if (window.lucide) {
        window.lucide.createIcons();
    }
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
    if (!key) {
        apiKeyInput.value = "";
    } else {
        apiKeyInput.value = key;
    }
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
function loadTrainingData() {
    const examples = localStorage.getItem('fonatur_style_examples');
    if (examples) trainingInput.value = examples;
}

btnTraining.addEventListener('click', () => trainingModal.classList.remove('hidden'));
btnCloseTraining.addEventListener('click', () => trainingModal.classList.add('hidden'));

btnSaveTraining.addEventListener('click', () => {
    localStorage.setItem('fonatur_style_examples', trainingInput.value);
    trainingModal.classList.add('hidden');
    showError("Estilo guardado.", false);
    setTimeout(() => errorBanner.classList.add('hidden'), 2000);
});

// --- History & Drag and Drop ---
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
        
        history.forEach((item, index) => {
            const btn = document.createElement('div');
            btn.className = "w-full cursor-grab active:cursor-grabbing p-3 rounded-lg bg-[#13322b]/40 hover:bg-[#13322b] border border-[#1a3d35] transition-all group mb-2 relative";
            btn.draggable = true;
            
            btn.ondragstart = (e) => {
                draggedItemIndex = index;
                e.dataTransfer.effectAllowed = 'move';
                btn.classList.add('opacity-50', 'border-[#bd9751]');
            };

            btn.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            };

            btn.ondrop = (e) => {
                e.preventDefault();
                if (draggedItemIndex !== null && draggedItemIndex !== index) {
                    const movedItem = history.splice(draggedItemIndex, 1)[0];
                    history.splice(index, 0, movedItem);
                    localStorage.setItem('fonatur_alert_history', JSON.stringify(history));
                    renderHistory();
                }
                draggedItemIndex = null;
            };

            btn.ondragend = () => {
                btn.classList.remove('opacity-50', 'border-[#bd9751]');
            };

            const dateStr = new Date(item.timestamp).toLocaleDateString('es-MX');
            const title = item.audioName || "Comunicado";

            btn.innerHTML = `
                <div class="pointer-events-none">
                    <p class="text-[10px] text-[#bd9751] font-bold mb-1 opacity-70">${dateStr}</p>
                    <p class="text-sm font-medium line-clamp-2 text-gray-300 group-hover:text-white">${title}</p>
                </div>
            `;
            
            btn.onclick = (e) => {
                if(e.target === btn || e.target.parentElement === btn) {
                    showResult(item.content);
                }
            };
            
            historyList.appendChild(btn);
        });
    }
}

// --- Loading State & Progress Management ---
function updateProgress(value, statusText) {
    progressBar.style.width = `${value}%`;
    progressPercentage.innerText = `${Math.round(value)}%`;
    if (statusText) progressStatus.innerText = statusText;
}

function startSimulatedProgress() {
    let current = 0;
    clearInterval(progressInterval);
    updateProgress(0, "Cargando archivo...");
    
    progressInterval = setInterval(() => {
        if (current < 40) {
            current += 1.5;
            updateProgress(current, "Subiendo audio a la nube...");
        } else if (current < 85) {
            current += 0.4;
            updateProgress(current, "Analizando transcripción...");
        } else if (current < 95) {
            current += 0.05;
            updateProgress(current, "Generando redacción institucional...");
        }
    }, 200);
}

function stopProgress(success = true) {
    clearInterval(progressInterval);
    if (success) {
        updateProgress(100, "Completado");
    } else {
        updateProgress(0, "Error");
    }
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
    
    // Desplazar el área de trabajo al inicio del resultado
    const workspace = document.querySelector('.flex-1.overflow-y-auto');
    if (workspace) workspace.scrollTo({ top: 0, behavior: 'smooth' });
}

function showError(msg, isError = true) {
    errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
    if (isError) {
        setLoading(false); 
        stopProgress(false);
        loadingState.classList.add('hidden');
        emptyState.classList.remove('hidden'); 
    }
    if (!isError) setTimeout(() => errorBanner.classList.add('hidden'), 5000);
}

// --- Helpers ---
function getMimeType(blob, fileName) {
    if (blob.type && blob.type !== 'application/octet-stream') return blob.type;
    const ext = fileName.split('.').pop().toLowerCase();
    const mimeMap = {
        'mp3': 'audio/mp3', 'wav': 'audio/wav', 'm4a': 'audio/mp4', 'mp4': 'video/mp4',
        'webm': 'audio/webm', 'mpeg': 'audio/mpeg', 'mpg': 'audio/mpeg'
    };
    return mimeMap[ext] || 'audio/mpeg';
}

function getCurrentDateFormatted() {
    const date = new Date();
    const weekdays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    
    const dayName = weekdays[date.getDay()];
    const dayNum = date.getDate();
    const monthName = months[date.getMonth()];
    const year = date.getFullYear();
    
    const formatted = `${dayName} ${dayNum} de ${monthName} de ${year}`;
    // Capitalizar solo la primera letra del día de la semana
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function parseErrorMessage(err) {
    let raw = err.message || "Error desconocido";
    try {
        if (raw.includes('{')) {
            const start = raw.indexOf('{');
            const parsed = JSON.parse(raw.substring(start));
            return parsed.error?.message || raw;
        }
    } catch (e) {}
    return raw;
}

// --- Audio & AI Logic ---
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
    let trainingContext = userExamples.trim().length > 0 ? `\nESTILO DE REFERENCIA (IMÍTALO):\n${userExamples}\n` : "";

    try {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const base64Data = reader.result.split(',')[1];
            const mimeType = getMimeType(blob, fileName);
            const ai = new GoogleGenAI({ apiKey });
            
            const prompt = `
              Actúa como un redactor senior de Comunicación Social de FONATUR. Tu tarea es escuchar el audio y generar una 'Alerta de Prensa' fidedigna.

              REGLAS DE ORO (VERACIDAD):
              1. **LEALTAD AL AUDIO**: NO agregues información, datos o contexto que no aparezcan en el audio. Si el audio no lo menciona, tú no lo escribes.
              2. **IDENTIFICACIÓN DE VOZ**: Identifica con precisión a la Presidenta Claudia Sheinbaum Pardo y a otros funcionarios si son reconocibles por su voz.
              3. **ESTILO**: Formal, institucional y periodístico.

              REGLAS DE FORMATO CRÍTICAS:
              1. **ENCABEZADO**: El encabezado (Ej: *Alerta de prensa de la Presidenta Claudia Sheinbaum Pardo*) debe llevar exactamente un asterisco (*) al inicio y uno al final. 
              2. **FECHA**: La fecha DEBE SER EXACTAMENTE: ${systemDate}. NO debe llevar asteriscos ni ningún otro formato. Texto plano únicamente.
              3. **TITULAR**: El titular resumen debe llevar un asterisco (*) al inicio y uno al final (Ej: *México impulsa el desarrollo ferroviario*).
              4. **CUERPO DE LA ALERTA**: Los párrafos de desarrollo NO deben contener ningún asterisco ni formato Markdown. Texto plano.

              ${trainingContext}

              ESTRUCTURA OBLIGATORIA:
              ---
              *[ENCABEZADO INSTITUCIONAL SEGÚN EL ORADOR]*
              ${systemDate}

              *[TITULAR RESUMEN]*

              [Cuerpo de la alerta: Texto plano sin asteriscos, organizado en párrafos claros, fiel al audio].

              [Cierre institucional basado en el audio, sin asteriscos].
              ---

              Instrucciones Finales: Entrega solo el texto resultante en español. La fecha debe ser exactamente la que te proporcioné. No inventes nada.
            `;

            try {
                const responseStream = await ai.models.generateContentStream({
                    model: 'gemini-3-flash-preview',
                    contents: {
                        parts: [
                            { inlineData: { data: base64Data, mimeType: mimeType } },
                            { text: prompt }
                        ]
                    }
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
                if (rawErr.includes('403') || rawErr.includes('key')) {
                    pendingBlob = blob;
                    pendingFileName = fileName;
                }
            }
        };
    } catch (err) {
        showError("Error al procesar: " + err.message);
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
    if (file) {
        if (file.size > 15 * 1024 * 1024) {
            showError("Archivo muy grande (>15MB).", true);
            return;
        }
        processAudio(file, file.name);
    }
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
