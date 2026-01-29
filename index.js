
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
async function loadTrainingData() {
    try {
        // Intenta cargar la configuración centralizada (repo)
        const response = await fetch('training.json');
        if (response.ok) {
            const data = await response.json();
            if (data.style_examples) {
                console.log("Cargado entrenamiento centralizado.");
                trainingInput.value = data.style_examples;
                localStorage.setItem('fonatur_style_examples', data.style_examples);
                return; // Prioridad al archivo central
            }
        }
    } catch (e) {
        console.warn("No se pudo cargar training.json (probablemente offline o local file system). Usando caché.", e);
    }

    // Fallback: LocalStorage
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

btnExportTraining.addEventListener('click', () => {
    const data = {
        style_examples: trainingInput.value,
        timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fonatur_estilo_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

inputImportTraining.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (data.style_examples !== undefined) {
                trainingInput.value = data.style_examples;
                localStorage.setItem('fonatur_style_examples', data.style_examples);
                showError("Estilo importado correctamente.", false);
                setTimeout(() => errorBanner.classList.add('hidden'), 2000);
            } else {
                alert("El archivo no tiene el formato correcto.");
            }
        } catch (err) {
            alert("Error al leer el archivo JSON.");
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input to allow re-importing the same file
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
                if (e.target === btn || e.target.parentElement === btn) {
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
        'webm': 'audio/webm', 'mpeg': 'video/mpeg', 'mpg': 'video/mpeg'
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
    } catch (e) { }
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
 ACTÚA COMO:
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
   - Solo atribuye una voz a una persona si el audio lo dice explícitamente (ej. “Soy…”, “La Presidenta…”, “Me acompaña…”),
     o si el archivo/metadata/introducción del audio lo afirma de forma directa.
   - Si NO hay confirmación explícita, usa atribuciones neutrales: “la oradora”, “el orador”, “una funcionaria”, “un funcionario”.
   - Prohibido “reconocer por la voz” sin confirmación textual del propio audio.

ESTILO:
Formal, institucional y periodístico. Redacción clara y sobria. Sin adjetivos promocionales no dichos en el audio.

REGLAS DE FORMATO (CRÍTICAS, VALIDAR ANTES DE ENTREGAR):
A) Salida SIN Markdown (excepto los asteriscos que se indican).
B) ENCABEZADO:
   - Debe ir en una sola línea y llevar EXACTAMENTE un asterisco (*) al inicio y uno al final.
C) FECHA:
   - La fecha DEBE SER EXACTAMENTE: ${systemDate}
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
1) Determina la “escala” del audio por duración y densidad informativa:
   - AUDIO CORTO: <= 45 segundos O contiene 1–2 hechos principales.
   - AUDIO MEDIO: 46 segundos a 2:30 min O contiene 3–5 hechos principales.
   - AUDIO LARGO: > 2:30 min O contiene 6+ hechos principales, múltiples temas, cifras, anuncios o acuerdos.
2) Ajusta la extensión manteniendo el límite de 4 párrafos:
   - AUDIO CORTO: 1–2 párrafos de cuerpo, concisos (2–4 oraciones por párrafo).
   - AUDIO MEDIO: 2–3 párrafos de cuerpo (3–5 oraciones por párrafo).
   - AUDIO LARGO: 3–4 párrafos de cuerpo, desarrollados (4–7 oraciones por párrafo), incorporando la mayor cantidad de hechos verificables del audio sin repetir.
3) Prohibido alargar con relleno:
   - No repitas ideas ni uses frases genéricas para “estirar” el texto.
   - Cada oración debe corresponder a un hecho explícito del audio.

REGLAS DE REDACCIÓN:
1) Precisión: Mantén el orden lógico de lo dicho (qué se informó / detalles verificables / implicaciones inmediatas expresadas en el audio / siguientes pasos mencionados).
2) NOMBRES OFICIALES:
   - Primera mención: nombre completo de instituciones. Después, siglas entre paréntesis.
   - Ejemplo: “Fondo Nacional de Fomento al Turismo (FONATUR)”.
3) Nombres y cargos:
   - Solo incluye nombres/cargos confirmados claramente en el audio.
   - Si no es claro, omítelo o usa genérico sin inventar dependencia.

CONTEXTO DE ENTRENAMIENTO (SI APLICA):
${trainingContext}

PROCESO OBLIGATORIO (INTERNO, PERO APLICAR):
1) Extrae hechos verificables del audio (quién, qué, dónde, cuándo, cifras, acuerdos, acciones y próximos pasos).
2) Clasifica el audio: CORTO / MEDIO / LARGO con base en la regla de longitud adaptativa.
3) Redacta la alerta usando SOLO esos hechos y aplicando la longitud correspondiente.
4) Revisa checklist final:
   - Encabezado con un asterisco al inicio y uno al final.
   - Fecha exactamente ${systemDate} en texto plano.
   - Titular con un asterisco al inicio y uno al final.
   - Cuerpo: máximo 4 párrafos, sin asteriscos, sin listas.
   - Sin datos no confirmados por el audio.

ESTRUCTURA OBLIGATORIA DE SALIDA (COPIAR TAL CUAL):
---
*[ENCABEZADO INSTITUCIONAL SEGÚN EL ORADOR CONFIRMADO O GENÉRICO]*
${systemDate}

*[TITULAR RESUMEN]*

[Cuerpo: 1 a 4 párrafos según escala CORTO/MEDIO/LARGO, texto plano, fiel al audio, sin asteriscos.]

[Cierre institucional sustentado por el audio, texto plano, sin asteriscos.]
---

INSTRUCCIÓN FINAL:
Entrega SOLO el texto final en español, siguiendo la estructura exacta. La fecha debe ser exactamente ${systemDate}.

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
