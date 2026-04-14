import "./style.css";
import { convertChats } from "./converter";
import type { Sample } from "./converter";

// ── DOM refs ──────────────────────────────────────────────
const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector<T>(sel)!;

const dropZone = $<HTMLElement>("#dropZone");
const btnPickFolder = $<HTMLButtonElement>("#btnPickFolder");
const btnPickFiles = $<HTMLButtonElement>("#btnPickFiles");
const btnDownload = $<HTMLButtonElement>("#btnDownload");
const btnClear = $<HTMLButtonElement>("#btnClear");
const systemPrompt = $<HTMLTextAreaElement>("#systemPrompt");
const firstRole = $<HTMLSelectElement>("#firstRole");
const statusBar = $<HTMLElement>("#statusBar");
const fileCountEl = $<HTMLElement>("#fileCount");
const sampleCountEl = $<HTMLElement>("#sampleCount");
const previewSection = $<HTMLElement>("#previewSection");
const previewEl = $<HTMLPreElement>("#preview");
const actionsSection = $<HTMLElement>("#actionsSection");

// ── State ─────────────────────────────────────────────────
let loadedTexts: { name: string; content: string }[] = [];
let samples: Sample[] = [];

// ── Helpers ───────────────────────────────────────────────
function show(...els: HTMLElement[]) {
  els.forEach((e) => e.classList.remove("hidden"));
}
function hide(...els: HTMLElement[]) {
  els.forEach((e) => e.classList.add("hidden"));
}

async function readFiles(files: File[]) {
  const txtFiles = files.filter((f) => f.name.endsWith(".txt"));
  if (txtFiles.length === 0) {
    alert("No .txt files found. Please upload .txt chat exports.");
    return;
  }
  const results = await Promise.all(
    txtFiles.map(async (f) => ({ name: f.name, content: await f.text() })),
  );
  loadedTexts = results;
  processAll();
}

function processAll() {
  const role = firstRole.value as "assistant" | "user";
  const prompt = systemPrompt.value.trim() || undefined;
  samples = convertChats(
    loadedTexts.map((t) => t.content),
    role,
    prompt,
  );
  // Update UI
  fileCountEl.textContent = String(loadedTexts.length);
  sampleCountEl.textContent = String(samples.length);
  show(statusBar, previewSection, actionsSection);

  // Preview first 5
  const preview = samples
    .slice(0, 5)
    .map((s) => JSON.stringify(s))
    .join("\n");
  previewEl.textContent = preview || "(no valid samples generated)";
}

function downloadJsonl() {
  if (samples.length === 0) return;
  const blob = new Blob([samples.map((s) => JSON.stringify(s)).join("\n")], {
    type: "application/jsonl",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "finetune.jsonl";
  a.click();
  URL.revokeObjectURL(url);
}

function clearAll() {
  loadedTexts = [];
  samples = [];
  hide(statusBar, previewSection, actionsSection);
  previewEl.textContent = "";
}

// ── Folder picker (webkitdirectory) ──────────────────────
function createFolderInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.setAttribute("webkitdirectory", "");
  input.multiple = true;
  return input;
}

function createFileInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt";
  input.multiple = true;
  return input;
}

// ── Events ───────────────────────────────────────────────

// Drag & drop
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});
dropZone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");

  const items = e.dataTransfer?.items;
  if (!items) return;

  const allFiles: File[] = [];

  // Try to read directories via webkitGetAsEntry
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await entryToFile(entry as FileSystemFileEntry);
        allFiles.push(file);
      } else if (entry.isDirectory) {
        const files = await readDirectory(entry as FileSystemDirectoryEntry);
        allFiles.push(...files);
      }
    }
  } else if (e.dataTransfer?.files) {
    allFiles.push(...Array.from(e.dataTransfer.files));
  }

  await readFiles(allFiles);
});

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function readDirectory(dir: FileSystemDirectoryEntry): Promise<File[]> {
  const reader = dir.createReader();
  const files: File[] = [];

  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  let batch = await readBatch();
  while (batch.length > 0) {
    for (const entry of batch) {
      if (entry.isFile) {
        files.push(await entryToFile(entry as FileSystemFileEntry));
      } else if (entry.isDirectory) {
        files.push(...(await readDirectory(entry as FileSystemDirectoryEntry)));
      }
    }
    batch = await readBatch();
  }
  return files;
}

// Folder picker button
btnPickFolder.addEventListener("click", (e) => {
  e.stopPropagation();
  e.preventDefault();
  const input = createFolderInput();
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    if (input.files && input.files.length > 0)
      readFiles(Array.from(input.files));
    input.remove();
  });
  input.click();
});

// File picker button
btnPickFiles.addEventListener("click", (e) => {
  e.stopPropagation();
  e.preventDefault();
  const input = createFileInput();
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    if (input.files && input.files.length > 0)
      readFiles(Array.from(input.files));
    input.remove();
  });
  input.click();
});

// Re-process when config changes
systemPrompt.addEventListener("input", () => {
  if (loadedTexts.length) processAll();
});
firstRole.addEventListener("change", () => {
  if (loadedTexts.length) processAll();
});

// Download & clear
btnDownload.addEventListener("click", downloadJsonl);
btnClear.addEventListener("click", clearAll);
