import { GoogleGenAI } from "@google/genai";

// ==========================================
// ⚠️ CONFIGURACIÓN OBLIGATORIA ⚠️
// ==========================================
// Para que la app funcione en GitHub Pages, debes pegar tu API Key aquí abajo.
// 1. Ve a https://aistudio.google.com/app/apikey
// 2. Copia tu clave (empieza con "AIza...")
// 3. Reemplaza el texto 'PEGAR_AQUI_TU_CLAVE' con tu clave real.
// ==========================================
const CLAVE_GOOGLE = 'AIzaSyCsIgT2eRSDOvrDxtnk27CdyoYSG8Q7qgc'; 
// ==========================================


// Configuración del entorno (compatible con Local y GitHub Pages)
const API_KEY = (typeof process !== 'undefined' && process.env && process.env.API_KEY) 
    ? process.env.API_KEY 
    : CLAVE_GOOGLE;

let mediaRecorder = null;
let audioChunks = [];
let history = [];
let currentAlertText = "";

// --- DOM Elements ---
const btnRecord = document.getElementById('btn-record');
const btnStop = document.getElementById('btn-stop');
const fileInput = document.getElementById('file-input');
const btnClearHistory = document.getElementById('btn-clear-history');
const btnCopy = document.getElementById('btn-copy');
const btnCopyText = document.getElementById('btn-copy-text');

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
        // Nota: No ocultamos loadingState aquí directamente si estamos en streaming, 
        // lo hacemos cuando llega el primer chunk.
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

function showError(msg) {
    errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
    setLoading(false); // Reset buttons
    loadingState.classList.add('hidden');
    emptyState.classList.remove('hidden'); // Go back to start
    
    setTimeout(() => {
        errorBanner.classList.add('hidden');
    }, 5000);
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
    setLoading(true);
    const systemDate = getCurrentDateFormatted();

    try {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const base64Data = reader.result.split(',')[1];
            
            // Validar API Key antes de llamar
            if (!API_KEY || API_KEY === 'PEGAR_AQUI_TU_CLAVE') {
                showError("⚠️ FALTA TU API KEY. Abre index.js y pega tu clave en la línea 11.");
                return;
            }

            const ai = new GoogleGenAI({ apiKey: API_KEY });
            const prompt = `
              Actúa como un redactor senior de Comunicación Social. Tu tarea es escuchar el audio adjunto y generar una 'Alerta de Prensa' de alta calidad periodística.

              REGLA DE ORO DE IDENTIFICACIÓN:
              1. Debes reconocer primordialmente si quien habla es la Presidenta Claudia Sheinbaum Pardo (o si el audio corresponde a su conferencia de prensa matutina).
              2. Si es ella, el encabezado DEBE ser: "Alerta de conferencia de prensa de la Presidenta Claudia Sheinbaum Pardo".
              3. Si es cualquier otro funcionario o un comunicado general de la institución, usa: "Alerta de prensa de FONATUR".

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
                // USAR STREAMING PARA MEJOR VELOCIDAD PERCIBIDA
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
                            // Al recibir el primer byte, ocultar loading y mostrar el papel
                            loadingState.classList.add('hidden');
                            resultContainer.classList.remove('hidden');
                            emptyState.classList.add('hidden');
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                            isFirstChunk = false;
                        }
                        
                        // Actualizar texto en tiempo real
                        alertContent.innerText = fullText;
                    }
                }

                if (fullText) {
                    currentAlertText = fullText;
                    saveToHistory(fullText, fileName);
                    // Habilitar botones de nuevo
                    setLoading(false); // Esto resetea botones y textos
                    // Asegurarnos que la vista correcta se mantiene
                    loadingState.classList.add('hidden');
                    resultContainer.classList.remove('hidden');
                } else {
                    throw new Error("El modelo no generó texto.");
                }

            } catch (err) {
                console.error(err);
                showError("Error de IA: " + (err.message || "No se pudo conectar"));
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
            // Usar webm para mayor compatibilidad
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
    // Reset input so same file can be selected again
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
