import { GoogleGenAI } from "@google/genai";

// ==========================================
// SEGURIDAD: GESTIÓN DE API KEY
// ==========================================
// Ya NO hay claves hardcodeadas aquí.
// La clave se pide al usuario y se guarda en localStorage.
// ==========================================

let mediaRecorder = null;
let audioChunks = [];
let history = [];
let currentAlertText = "";

// Variables para "recordar" el archivo si falta la clave
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

// Modal Elements (API Key)
const apiModal = document.getElementById('api-modal');
const apiKeyInput = document.getElementById('api-key-input');
const btnSaveKey = document.getElementById('btn-save-key');

// Modal Elements (Training)
const trainingModal = document.getElementById('training-modal');
const trainingInput = document.getElementById('training-input');
const btnSaveTraining = document.getElementById('btn-save-training');
const btnCloseTraining = document.getElementById('btn-close-training');

const emptyState = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');
const resultContainer = document.getElementById('result-container');
const alertContent = document.getElementById('alert-content');
const errorBanner = document.getElementById('error-banner');
const errorMessage = document.getElementById('error-message');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar iconos de Lucide
    if (window.lucide) {
        window.lucide.createIcons();
    }
    loadHistory();
    checkApiKey();
    loadTrainingData();
});

// --- API Key Management ---
function getApiKey() {
    return localStorage.getItem('fonatur_gemini_key');
}

function checkApiKey() {
    const key = getApiKey();
    if (!key) {
        // No mostramos el modal de inmediato al cargar para no ser invasivos,
        // solo cuando se intenta una acción o se hace clic en settings.
        // Pero si el input está vacío, lo limpiamos.
        apiKeyInput.value = "";
    } else {
        apiKeyInput.value = key;
    }
}

function showModal() {
    const key = getApiKey();
    if (key) apiKeyInput.value = key; // Mostrar la clave actual si existe
    apiModal.classList.remove('hidden');
}

function hideModal() {
    apiModal.classList.add('hidden');
}

btnSaveKey.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key.length > 10) { // Validación básica
        localStorage.setItem('fonatur_gemini_key', key);
        hideModal();
        errorBanner.classList.add('hidden');
        
        // REANUDAR OPERACIÓN PENDIENTE
        if (pendingBlob) {
            showError("Reanudando procesamiento...", false); // Mensaje temporal
            processAudio(pendingBlob, pendingFileName);
            // Limpiar pendientes
            pendingBlob = null;
            pendingFileName = "";
        } else {
            showError("Clave guardada. Ahora puedes subir tu archivo.", false);
        }
    } else {
        alert("Por favor, ingresa una API Key válida.");
    }
});

btnSettings.addEventListener('click', () => {
    showModal();
});

// --- Training / Style Management ---
function loadTrainingData() {
    const examples = localStorage.getItem('fonatur_style_examples');
    if (examples) {
        trainingInput.value = examples;
    }
}

btnTraining.addEventListener('click', () => {
    trainingModal.classList.remove('hidden');
});

btnCloseTraining.addEventListener('click', () => {
    trainingModal.classList.add('hidden');
});

btnSaveTraining.addEventListener('click', () => {
    const examples = trainingInput.value;
    localStorage.setItem('fonatur_style_examples', examples);
    trainingModal.classList.add('hidden');
    showError("Ejemplos de estilo guardados.", false);
    setTimeout(() => errorBanner.classList.add('hidden'), 2000);
});

// Cerrar modal al hacer clic fuera
trainingModal.addEventListener('click', (e) => {
    if (e.target === trainingModal) {
        trainingModal.classList.add('hidden');
    }
});


// --- History Management ---
function loadHistory() {
    const saved = localStorage.getItem('fonatur_alert_history');
    if (saved) {
        history = JSON.parse(saved);
        renderHistory();
    }
}

function saveToHistory(content, audioName) {
    const newAlert = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        content,
        audioName
    };
    history = [newAlert, ...history].slice(0, 20); // Keep last 20
    localStorage.setItem('fonatur_alert_history', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    // Clear list except the empty state div
    Array.from(historyList.children).forEach(child => {
        if (child.id !== 'history-empty') historyList.removeChild(child);
    });

    if (history.length === 0) {
        historyEmpty.classList.remove('hidden');
        btnClearHistory.classList.add('hidden');
    } else {
        historyEmpty.classList.add('hidden');
        btnClearHistory.classList.remove('hidden');
        
        history.forEach(item => {
            const btn = document.createElement('button');
            btn.className = "w-full text-left p-3 rounded-lg bg-[#13322b]/40 hover:bg-[#13322b] border border-[#1a3d35] transition-all group mb-2";
            btn.onclick = () => showResult(item.content);
            
            const dateStr = new Date(item.timestamp).toLocaleDateString('es-MX');
            const title = item.audioName || "Comunicado Generado";

            btn.innerHTML = `
                <p class="text-[10px] text-[#bd9751] font-bold mb-1 opacity-70">${dateStr}</p>
                <p class="text-sm font-medium line-clamp-2 text-gray-300 group-hover:text-white">${title}</p>
            `;
            historyList.appendChild(btn);
        });
    }
}

// --- UI Transitions ---
function setLoading(isLoading) {
    if (isLoading) {
        emptyState.classList.add('hidden');
        resultContainer.classList.add('hidden');
        loadingState.classList.remove('hidden');
        btnRecord.disabled = true;
        fileInput.disabled = true;
        
        // Actualizar texto de carga
        const loadingText = loadingState.querySelector('h3');
        if (loadingText) loadingText.textContent = "Subiendo y analizando...";
    } else {
        btnRecord.disabled = false;
        fileInput.disabled = false;
        const loadingText = loadingState.querySelector('h3');
        if (loadingText) loadingText.textContent = "Generando Síntesis...";
    }
}

function showResult(text) {
    currentAlertText = text;
    alertContent.innerText = text;
    emptyState.classList.add('hidden');
    loadingState.classList.add('hidden');
    resultContainer.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showError(msg, isError = true) {
    errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
    
    if (isError) {
        setLoading(false); // Reset buttons
        loadingState.classList.add('hidden');
        emptyState.classList.remove('hidden'); // Go back to start
    }
    
    // Auto ocultar solo si no es un error crítico
    if (!isError || msg.includes('guardada')) {
        setTimeout(() => {
            errorBanner.classList.add('hidden');
        }, 5000);
    }
}

// --- Audio & AI Logic ---
function getCurrentDateFormatted() {
    const date = new Date();
    const formatted = date.toLocaleDateString('es-MX', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

async function processAudio(blob, fileName = "Audio Institucional") {
    const apiKey = getApiKey();
    
    // Si no hay API Key, guardamos el intento y pedimos la clave
    if (!apiKey) {
        pendingBlob = blob;
        pendingFileName = fileName;
        showModal();
        return;
    }

    setLoading(true);
    const systemDate = getCurrentDateFormatted();
    
    const userExamples = localStorage.getItem('fonatur_style_examples') || "";
    let trainingContext = "";
    if (userExamples.trim().length > 0) {
        trainingContext = `
        IMPORTANTE - REFERENCIAS DE ESTILO:
        A continuación se presentan ejemplos de redacción aprobados. 
        Analiza el tono, la estructura de los párrafos y el vocabulario institucional de estos ejemplos e IMITA este estilo en tu respuesta:
        
        """
        ${userExamples}
        """
        `;
    }

    try {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const base64Data = reader.result.split(',')[1];

            const ai = new GoogleGenAI({ apiKey: apiKey });
            
            const prompt = `
              Actúa como un redactor senior de Comunicación Social. Tu tarea es escuchar el audio adjunto y generar una 'Alerta de Prensa' de alta calidad periodística.

              REGLA DE ORO DE IDENTIFICACIÓN:
              1. Debes reconocer primordialmente si quien habla es la Presidenta Claudia Sheinbaum Pardo (o si el audio corresponde a su conferencia de prensa matutina).
              2. Si es ella, el encabezado DEBE ser: "Alerta de conferencia de prensa de la Presidenta Claudia Sheinbaum Pardo".
              3. Si es cualquier otro funcionario o un comunicado general de la institución, usa: "Alerta de prensa de FONATUR".

              ${trainingContext}

              DEBES seguir estrictamente este formato:
              
              ---
              [ENCABEZADO DETERMINADO POR EL HABLANTE]
              ${systemDate}

              [TITULAR EN NEGRITA QUE RESUMA LA NOTICIA O ANUNCIO PRINCIPAL]
              [Primer párrafo: Resumen ejecutivo. Si es la Presidenta, comienza con "La Presidenta Claudia Sheinbaum Pardo explicó que..." o similar. Identifica claramente al actor principal.]

              [Párrafos siguientes: Detalles específicos, datos técnicos, mención de otras dependencias (Secretaría de Economía, Hacienda, etc.) y contexto relevante.]
              
              [Párrafo de cierre: Próximos pasos, equipos de trabajo mencionados o cierre institucional.]
              ---

              Instrucciones adicionales:
              1. LA FECHA DEL TÍTULO DEBE SER EXACTAMENTE: ${systemDate}.
              2. Identifica con precisión nombres propios y cargos.
              3. Mantén un tono formal, periodístico, institucional y asertivo.
              4. No agregues introducciones, conclusiones ni comentarios personales. Entrega directamente el texto de la alerta.
              5. El idioma debe ser Español.
            `;

            try {
                const responseStream = await ai.models.generateContentStream({
                    model: 'gemini-3-flash-preview',
                    contents: {
                        parts: [
                            { inlineData: { data: base64Data, mimeType: blob.type || 'audio/webm' } },
                            { text: prompt }
                        ]
                    }
                });

                let fullText = "";
                let isFirstChunk = true;

                for await (const chunk of responseStream) {
                    const chunkText = chunk.text;
                    if (chunkText) {
                        fullText += chunkText;

                        if (isFirstChunk) {
                            loadingState.classList.add('hidden');
                            resultContainer.classList.remove('hidden');
                            emptyState.classList.add('hidden');
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                            isFirstChunk = false;
                        }
                        
                        alertContent.innerText = fullText;
                    }
                }

                if (fullText) {
                    currentAlertText = fullText;
                    saveToHistory(fullText, fileName);
                    setLoading(false);
                    loadingState.classList.add('hidden');
                    resultContainer.classList.remove('hidden');
                } else {
                    throw new Error("El modelo no generó texto.");
                }

            } catch (err) {
                console.error(err);
                
                // MEJORA EN EL MANEJO DE ERRORES:
                // No borramos la clave automáticamente, para que el usuario pueda revisarla.
                let msg = "Error de IA: " + (err.message || "Desconocido");
                
                if (err.message && (err.message.includes('403') || err.message.includes('API key') || err.message.includes('permission'))) {
                    msg = "Error de Autorización (403): Verifica que tu API Key sea correcta y que tengas permisos para usar el modelo Gemini.";
                    showModal(); // Volvemos a mostrar el modal para que corrijan
                } else if (err.message && err.message.includes('429')) {
                    msg = "Límite de cuota excedido (429). Espera unos minutos.";
                } else if (err.message && err.message.includes('503')) {
                    msg = "El servicio está saturado temporalmente (503). Intenta de nuevo.";
                }

                showError(msg);
            }
        };
    } catch (err) {
        showError("Error procesando archivo: " + err.message);
    }
}

// --- Event Listeners ---
btnRecord.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            processAudio(blob, "Grabación Fonatur");
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        btnRecord.classList.add('hidden');
        btnStop.classList.remove('hidden');
    } catch (err) {
        showError("No se pudo acceder al micrófono. Verifique permisos.");
    }
});

btnStop.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        btnStop.classList.add('hidden');
        btnRecord.classList.remove('hidden');
    }
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        processAudio(file, file.name);
    }
    fileInput.value = '';
});

btnCopy.addEventListener('click', () => {
    if (currentAlertText) {
        navigator.clipboard.writeText(currentAlertText);
        const originalText = btnCopyText.innerText;
        btnCopyText.innerText = "COPIADO";
        setTimeout(() => {
            btnCopyText.innerText = originalText;
        }, 2000);
    }
});

btnClearHistory.addEventListener('click', () => {
    if (confirm("¿Estás seguro de borrar todo el historial?")) {
        history = [];
        localStorage.removeItem('fonatur_alert_history');
        renderHistory();
    }
});
