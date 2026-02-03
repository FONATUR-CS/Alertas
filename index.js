import { GoogleGenAI } from "@google/genai";

// ==========================================
// ESTADO GLOBAL Y VARIABLES
// ==========================================
let mediaRecorder = null;
let audioChunks = [];
let history = [];
let currentAlertText = "";
let draggedItemIndex = null;
let progressInterval = null;

let pendingBlob = null;
let pendingFileName = "";

// --- Elementos DOM ---
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
const btnExportTraining = document.getElementById('btn-export-training');
const inputImportTraining = document.getElementById('input-import-training');
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

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) window.lucide.createIcons();
    loadHistory();
    checkApiKey();
    loadTrainingData();
});

// ==========================================
// GESTIÓN DE CONFIGURACIÓN Y ESTILO
// ==========================================
function getApiKey() { return localStorage.getItem('fonatur_gemini_key') || ""; }
function checkApiKey() { const key = getApiKey(); if (key) apiKeyInput.value = key; }

btnSaveKey.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key.length > 5) {
        localStorage.setItem('fonatur_gemini_key', key);
        apiModal.classList.add('hidden');
        errorBanner.classList.add('hidden');
        if (pendingBlob) processAudio(pendingBlob, pendingFileName);
    }
});

btnSettings.addEventListener('click', () => apiModal.classList.remove('hidden'));

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
    } catch (e) { console.warn("Cargando estilo desde local."); }
    const examples = localStorage.getItem('fonatur_style_examples');
    if (examples) trainingInput.value = examples;
}

btnTraining.addEventListener('click', () => trainingModal.classList.remove('hidden'));
btnCloseTraining.addEventListener('click', () => trainingModal.classList.add('hidden'));
btnSaveTraining.addEventListener('click', () => {
    localStorage.setItem('fonatur_style_examples', trainingInput.value);
    trainingModal.classList.add('hidden');
    showError("Estilo guardado.", false);
});

btnExportTraining.addEventListener('click', () => {
    const data = { style_examples: trainingInput.value, timestamp: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fonatur_estilo.json`;
    a.click();
});

inputImportTraining.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const data = JSON.parse(event.target.result);
        if (data.style_examples) {
            trainingInput.value = data.style_examples;
            localStorage.setItem('fonatur_style_examples', data.style_examples);
            showError("Estilo importado.", false);
        }
    };
    reader.readAsText(file);
});

// ==========================================
// HISTORIAL CON DRAG AND DROP
// ==========================================
function loadHistory() {
    const saved = localStorage.getItem('fonatur_alert_history');
    if (saved) { history = JSON.parse(saved); renderHistory(); }
}

function saveToHistory(content, audioName) {
    const newAlert = { id: Date.now().toString(), timestamp: Date.now(), content, audioName };
    history = [newAlert, ...history].slice(0, 30);
    localStorage.setItem('fonatur_alert_history', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    Array.from(historyList.children).forEach(child => { if (child.id !== 'history-empty') historyList.removeChild(child); });
    if (history.length === 0) {
        historyEmpty.classList.remove('hidden');
        btnClearHistory.classList.add('hidden');
    } else {
        historyEmpty.classList.add('hidden');
        btnClearHistory.classList.remove('hidden');
        history.forEach((item, index) => {
            const btn = document.createElement('div');
            btn.className = "w-full cursor-grab active:cursor-grabbing p-3 rounded-lg bg-[#13322b]/40 hover:bg-[#13322b] border border-[#1a3d35] transition-all mb-2";
            btn.draggable = true;
            btn.innerHTML = `<p class="text-[10px] text-[#bd9751] font-bold">${new Date(item.timestamp).toLocaleDateString('es-MX')}</p>
                             <p class="text-sm text-gray-300 line-clamp-2">${item.audioName || "Sin título"}</p>`;
            
            btn.ondragstart = () => { draggedItemIndex = index; btn.classList.add('opacity-50'); };
            btn.ondragover = (e) => e.preventDefault();
            btn.ondrop = () => {
                const moved = history.splice(draggedItemIndex, 1)[0];
                history.splice(index, 0, moved);
                localStorage.setItem('fonatur_alert_history', JSON.stringify(history));
                renderHistory();
            };
            btn.onclick = () => showResult(item.content);
            historyList.appendChild(btn);
        });
    }
}

// ==========================================
// CORE: PROCESAMIENTO DE AUDIO (VERSIÓN 0.21.0)
// ==========================================
async function processAudio(blob, fileName = "Audio Institucional") {
    const apiKey = getApiKey();
    if (!apiKey) {
        pendingBlob = blob; pendingFileName = fileName;
        apiModal.classList.remove('hidden');
        return;
    }

    setLoading(true);
    // Formatear fecha exacta para el prompt
    const date = new Date();
    const weekdays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const systemDate = `${weekdays[date.getDay()]} ${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`;
    const systemDateFormatted = systemDate.charAt(0).toUpperCase() + systemDate.slice(1);

    const userExamples = localStorage.getItem('fonatur_style_examples') || "";
    let trainingContext = userExamples.trim().length > 0 ? `\nESTILO DE REFERENCIA (IMÍTALO):\n${userExamples}\n` : "";

    const genAI = new GoogleGenAI(apiKey);

    try {
        updateProgress(15, "Subiendo archivo oficial...");
        const uploadResult = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).uploadFile(blob, {
            mimeType: blob.type || "audio/mpeg",
            displayName: fileName
        });

        let file = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).getFile(uploadResult.name);
        
        updateProgress(30, "Analizando transcripción...");
        while (file.state === "PROCESSING") {
            await new Promise(r => setTimeout(r, 3000));
            file = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).getFile(uploadResult.name);
        }

        if (file.state === "FAILED") throw new Error("Error al procesar el audio en el servidor.");

        updateProgress(70, "Generando redacción institucional...");

        // === TU PROMPT ORIGINAL INTEGRADO ===
        const prompt = `ACTÚA COMO:
Redactor/a senior de Comunicación Social de FONATUR.

OBJETIVO:
Escuchar el audio proporcionado y generar una “Alerta de Prensa” fidedigna (solo con información explícita en el audio), con longitud proporcional al tamaño y densidad del audio.

PRINCIPIOS DE VERACIDAD (NO NEGOCIABLES):
1) LEALTAD ABSOLUTA AL AUDIO:
   - No inventes, no completes, no contextualices con conocimientos externos.
   - Si un dato (fecha, lugar, cifra, nombre, cargo, dependencia, acción) no se escucha con claridad, NO lo escribas.
2) INCERTIDUMBRE = OMISIÓN:
   - Si hay fragmentos ambiguos o inaudibles, omite esa información por completo.
   - No uses marcadores tipo [inaudible] en el cuerpo. Simplemente no incluyas lo dudoso.
3) IDENTIFICACIÓN DE VOCES (REGLA ESTRICTA):
   - Solo atribuye una voz a una persona si el audio lo dice explícitamente (ej. “Soy…”, “La Presidenta…”, “Me acompaña…”), o si el archivo/metadata/introducción del audio lo afirma de forma directa.
   - Si NO hay confirmación explícita, usa atribuciones neutrales: “la oradora”, “el orador”, “una funcionaria”, “un funcionario”.
   - Prohibido “reconocer por la voz” sin confirmación textual del propio audio.

ESTILO:
Formal, institucional y periodístico. Redacción clara y sobria. Sin adjetivos promocionales no dichos en el audio.

REGLAS DE FORMATO (CRÍTICAS, VALIDAR ANTES DE ENTREGAR):
A) Salida SIN Markdown (excepto los asteriscos que se indican).
B) ENCABEZADO:
   - Debe ir en una sola línea y llevar EXACTAMENTE un asterisco (*) al inicio y uno al final.
C) FECHA:
   - La fecha DEBE SER EXACTAMENTE: ${systemDateFormatted}
   - Texto plano, sin asteriscos, sin comillas, sin palabras extra.
D) TITULAR:
   - Debe ir en una sola línea y llevar EXACTAMENTE un asterisco (*) al inicio y uno al final.
E) CUERPO:
   - Máximo 4 párrafos.
   - Texto plano: NO usar asteriscos, NO viñetas, NO numeración, NO encabezados internos.
F) CIERRE INSTITUCIONAL:
   - Un último renglón o párrafo breve, solo si está sustentado por el audio.
   - Texto plano, sin asteriscos.

REGLA DE LONGITUD ADAPTATIVA (SEGÚN AUDIO):
1) Determina la “escala” del audio por duración y densidad informativa (CORTO/MEDIO/LARGO).
2) Ajusta la extensión manteniendo el límite de 4 párrafos.
3) Prohibido alargar con relleno.

CONTEXTO DE ENTRENAMIENTO (SI APLICA):
${trainingContext}

PROCESO OBLIGATORIO:
1) Extrae hechos verificables. 
2) Clasifica escala. 
3) Redacta usando SOLO esos hechos. 
4) Revisa checklist final (Encabezado con *, Fecha exacta ${systemDateFormatted}, Titular con *).

ESTRUCTURA OBLIGATORIA DE SALIDA:
---
*[ENCABEZADO INSTITUCIONAL SEGÚN EL ORADOR CONFIRMADO O GENÉRICO]*
${systemDateFormatted}

*[TITULAR RESUMEN]*

[Cuerpo: 1 a 4 párrafos, texto plano, fiel al audio, sin asteriscos.]

[Cierre institucional sustentado por el audio, texto plano, sin asteriscos.]
---

INSTRUCCIÓN FINAL: Entrega SOLO el texto final en español. La fecha debe ser exactamente ${systemDateFormatted}.`;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContentStream([
            { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
            { text: prompt }
        ]);

        let fullText = "";
        let isFirst = true;

        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            fullText += chunkText;
            if (isFirst) {
                loadingState.classList.add('hidden');
                resultContainer.classList.remove('hidden');
                isFirst = false;
            }
            alertContent.innerText = fullText;
        }

        currentAlertText = fullText;
        saveToHistory(fullText, fileName);
        setLoading(false);

    } catch (err) {
        console.error(err);
        showError("Error de IA: " + (err.message || "Fallo en la conexión"));
    }
}

// ==========================================
// UTILIDADES UI Y LISTENERS
// ==========================================
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
        errorBanner.classList.add('hidden');
        startSimulatedProgress();
    } else { loadingState.classList.add('hidden'); clearInterval(progressInterval); }
}

function startSimulatedProgress() {
    let p = 0; clearInterval(progressInterval);
    progressInterval = setInterval(() => { if (p < 95) { p += 1; updateProgress(p); } }, 600);
}

function showResult(text) {
    currentAlertText = text; alertContent.innerText = text;
    emptyState.classList.add('hidden'); loadingState.classList.add('hidden');
    resultContainer.classList.remove('hidden');
}

function showError(msg, isError = true) {
    errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
    if (isError) setLoading(false);
    else setTimeout(() => errorBanner.classList.add('hidden'), 3000);
}

// Grabación
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
        btnRecord.classList.add('hidden'); btnStop.classList.remove('hidden');
    } catch (e) { showError("Error al acceder al micrófono."); }
});

btnStop.addEventListener('click', () => {
    if (mediaRecorder) { mediaRecorder.stop(); btnStop.classList.add('hidden'); btnRecord.classList.remove('hidden'); }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) processAudio(e.target.files[0], e.target.files[0].name);
    e.target.value = '';
});

btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(currentAlertText);
    btnCopyText.innerText = "COPIADO";
    setTimeout(() => btnCopyText.innerText = "COPIAR TEXTO", 2000);
});

btnClearHistory.addEventListener('click', () => {
    if (confirm("¿Borrar historial?")) { history = []; localStorage.removeItem('fonatur_alert_history'); renderHistory(); }
});
