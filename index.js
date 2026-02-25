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

        const prompt = `ACTÚA COMO:
Redactor/a senior de Comunicación Social de FONATUR.

OBJETIVO:
Escuchar el audio proporcionado y redactar una “Alerta de Prensa” fidedigna, formal e institucional, basada EXCLUSIVAMENTE en la información explícita del audio.

FECHA OFICIAL:
${systemDateFormatted}

REGLAS DE SALIDA (FORMATO):
- No usar Markdown, listas, tablas ni viñetas.
- ÚNICAMENTE se permiten asteriscos para encabezados/titular, con este formato:
*[ENCABEZADO]*
*[TITULAR]*
- Redactar en español.
- Mantener tono formal, institucional y claro.

CONTEXTO DE ESTILO (NO FACTUAL):
${trainingContext}
IMPORTANTE: El contexto anterior solo sirve para estilo, tono, terminología institucional y formato. NO puede usarse como fuente de hechos, nombres, cargos, fechas, lugares, cifras ni acciones si esos datos no aparecen explícitamente en el audio.

PRINCIPIOS NO NEGOCIABLES (ANTI-ALUCINACIÓN):
1) LEALTAD ABSOLUTA AL AUDIO:
   - Usa únicamente información que se escuche de forma explícita y suficientemente clara.
   - No inventes, no completes, no deduzcas, no “corrijas” con conocimiento externo.

2) INCERTIDUMBRE = OMISIÓN:
   - Si un dato no se entiende con claridad (nombre, cargo, cifra, fecha, lugar, dependencia, acción), OMÍTelo.
   - No uses texto entre corchetes tipo [inaudible], [posible], [pendiente].
   - No sustituyas con aproximaciones (“aparentemente”, “probablemente”, etc.).

3) PROHIBIDO USAR CONOCIMIENTO EXTERNO:
   - No agregues contexto histórico, político, técnico o institucional que no esté dicho en el audio.
   - No completes nombres de instituciones/personas por inferencia.

4) ATRIBUCIÓN ESTRICTA DE VOCES Y DECLARACIONES:
   - Solo atribuye una declaración a una persona/cargo si el audio lo dice explícitamente.
   - Si se escucha una declaración pero no está claramente identificada la persona, redacta sin atribución personal.

5) CIFRAS, FECHAS Y LUGARES:
   - Conserva exactamente lo que se escucha.
   - Si una cifra/fecha/lugar es dudosa o incompleta, omítela.
   - No conviertas ni normalices datos si no fueron expresados con claridad.

6) SIN CITAS TEXTUALES INVENTADAS:
   - No uses comillas para “citas” a menos que el contenido sea claramente audible y fiel.
   - Si hay duda, parafrasea sin atribuir.

7) SIN RELLENO:
   - No agregues antecedentes, explicaciones o conclusiones que no estén en el audio.
   - El texto final debe ser proporcional a la cantidad de información realmente disponible.

CRITERIO DE LONGITUD (PROPORCIONAL AL AUDIO):
- Audio corto o con poca densidad informativa: 1 a 3 párrafos.
- Audio medio: 3 a 6 párrafos.
- Audio extenso y claro: hasta 12 párrafos máximo.
- Nunca escribir de más “para completar”.

PROCESO INTERNO OBLIGATORIO (NO MOSTRAR):
Antes de redactar, verifica mentalmente cada dato del borrador:
- ¿Se escucha explícitamente?
- ¿Es claro y no ambiguo?
- ¿Estoy usando contexto externo o inferencia?
Si alguna respuesta genera duda, elimina ese dato.

ESTRUCTURA OBLIGATORIA DE LA RESPUESTA:
*[ENCABEZADO]*
FONATUR | Alerta de Prensa

${systemDateFormatted}

*[TITULAR]*
(Titular breve, factual y fiel al audio; sin sensacionalismo, sin agregar datos no confirmados)

(Cuerpo de la alerta: máximo 12 párrafos, pueden ser menos según la densidad real del audio)

(Cierre institucional breve y neutro, solo si el audio aporta elementos para ello; si no, omitir)

MODO DE CONTINGENCIA (SI EL AUDIO ES INSUFICIENTE O MUY AMBIGUO):
Si el audio no contiene información suficientemente clara para una alerta fidedigna, responde únicamente con una versión mínima:
*[ENCABEZADO]*
FONATUR | Alerta de Prensa

${systemDateFormatted}

*[TITULAR]*
Información insuficiente para emitir una alerta de prensa fidedigna

No se identificó contenido suficientemente claro y verificable en el audio para redactar una alerta de prensa sin riesgo de imprecisión.`;

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
