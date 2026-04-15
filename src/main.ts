import "./style.css";
import { convertChats } from "./converter";
import type { Sample } from "./converter";

// ── DOM refs ──────────────────────────────────────────────
const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector<T>(sel)!;

// Mode tabs
const tabConvert = $<HTMLButtonElement>("#tabConvert");
const tabMerge = $<HTMLButtonElement>("#tabMerge");
const convertMode = $<HTMLElement>("#convertMode");
const mergeMode = $<HTMLElement>("#mergeMode");

// Convert mode
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

// Merge mode
const mergeDropZone = $<HTMLElement>("#mergeDropZone");
const btnPickJsonl = $<HTMLButtonElement>("#btnPickJsonl");
const mergeStatusBar = $<HTMLElement>("#mergeStatusBar");
const mergeFileCountEl = $<HTMLElement>("#mergeFileCount");
const mergeLineCountEl = $<HTMLElement>("#mergeLineCount");
const mergePreviewSection = $<HTMLElement>("#mergePreviewSection");
const mergePreviewEl = $<HTMLPreElement>("#mergePreview");
const mergeActionsSection = $<HTMLElement>("#mergeActionsSection");
const btnMergeDownload = $<HTMLButtonElement>("#btnMergeDownload");
const btnMergeClear = $<HTMLButtonElement>("#btnMergeClear");

// ── State ─────────────────────────────────────────────────
// Convert state: one result per txt file
let loadedTexts: { name: string; content: string }[] = [];
let perFileResults: { name: string; samples: Sample[] }[] = [];
let totalSamples = 0;

// Merge state
let mergedLines: string[] = [];

// ── Helpers ───────────────────────────────────────────────
function show(...els: HTMLElement[]) {
  els.forEach((e) => e.classList.remove("hidden"));
}
function hide(...els: HTMLElement[]) {
  els.forEach((e) => e.classList.add("hidden"));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Tab switching ─────────────────────────────────────────
tabConvert.addEventListener("click", () => {
  tabConvert.classList.add("active");
  tabMerge.classList.remove("active");
  show(convertMode);
  mergeMode.classList.add("hidden");
});
tabMerge.addEventListener("click", () => {
  tabMerge.classList.add("active");
  tabConvert.classList.remove("active");
  show(mergeMode);
  convertMode.classList.add("hidden");
});

// ══════════════════════════════════════════════════════════
//  CONVERT MODE — .txt → .jsonl (one per file)
// ══════════════════════════════════════════════════════════

async function readTxtFiles(files: File[]) {
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

  // Process each file individually
  perFileResults = loadedTexts.map((t) => ({
    name: t.name.replace(/\.txt$/i, ".jsonl"),
    samples: convertChats(t.content, role, prompt),
  }));
  totalSamples = perFileResults.reduce((sum, r) => sum + r.samples.length, 0);

  // Update UI
  fileCountEl.textContent = String(loadedTexts.length);
  sampleCountEl.textContent = String(totalSamples);
  show(statusBar, previewSection, actionsSection);

  // Preview first 5 samples across all files
  const MAX_PREVIEW = 5;
  const MAX_CHARS = 500;
  const allSamples: { file: string; sample: Sample }[] = [];
  for (const r of perFileResults) {
    for (const s of r.samples) {
      allSamples.push({ file: r.name, sample: s });
    }
  }
  const previewLines = allSamples.slice(0, MAX_PREVIEW).map((s) => {
    const json = JSON.stringify(s.sample);
    const line = `// ${s.file}\n${json.length > MAX_CHARS ? json.slice(0, MAX_CHARS) + " …" : json}`;
    return line;
  });
  const suffix =
    allSamples.length > MAX_PREVIEW
      ? `\n\n… and ${allSamples.length - MAX_PREVIEW} more samples`
      : "";
  previewEl.textContent =
    previewLines.join("\n\n") + suffix || "(no valid samples generated)";
}

function downloadAllJsonl() {
  if (perFileResults.length === 0) return;
  // Download one .jsonl per original .txt
  for (const r of perFileResults) {
    if (r.samples.length === 0) continue;
    const content = r.samples.map((s) => JSON.stringify(s)).join("\n");
    const blob = new Blob([content], { type: "application/jsonl" });
    downloadBlob(blob, r.name);
  }
}

function clearConvert() {
  loadedTexts = [];
  perFileResults = [];
  totalSamples = 0;
  hide(statusBar, previewSection, actionsSection);
  previewEl.textContent = "";
}

// Folder/file input helpers
function createFolderInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.setAttribute("webkitdirectory", "");
  input.multiple = true;
  return input;
}

function createFileInput(accept: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = true;
  return input;
}

// Shared directory reading
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

async function resolveDroppedFiles(e: DragEvent): Promise<File[]> {
  const items = e.dataTransfer?.items;
  if (!items) return [];
  const allFiles: File[] = [];
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isFile) {
        allFiles.push(await entryToFile(entry as FileSystemFileEntry));
      } else if (entry.isDirectory) {
        allFiles.push(...(await readDirectory(entry as FileSystemDirectoryEntry)));
      }
    }
  } else if (e.dataTransfer?.files) {
    allFiles.push(...Array.from(e.dataTransfer.files));
  }
  return allFiles;
}

function attachPickerButton(
  btn: HTMLButtonElement,
  inputFactory: () => HTMLInputElement,
  handler: (files: File[]) => void,
) {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const input = inputFactory();
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      if (input.files && input.files.length > 0) handler(Array.from(input.files));
      input.remove();
    });
    input.click();
  });
}

function attachDropZone(
  zone: HTMLElement,
  handler: (files: File[]) => void,
) {
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", () => {
    zone.classList.remove("dragover");
  });
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    const files = await resolveDroppedFiles(e);
    handler(files);
  });
}

// ── Convert mode events ──────────────────────────────────
attachDropZone(dropZone, (files) => readTxtFiles(files));
attachPickerButton(btnPickFolder, createFolderInput, (files) => readTxtFiles(files));
attachPickerButton(btnPickFiles, () => createFileInput(".txt"), (files) => readTxtFiles(files));

systemPrompt.addEventListener("input", () => {
  if (loadedTexts.length) processAll();
});
firstRole.addEventListener("change", () => {
  if (loadedTexts.length) processAll();
});

btnDownload.addEventListener("click", downloadAllJsonl);
btnClear.addEventListener("click", clearConvert);

// ══════════════════════════════════════════════════════════
//  MERGE MODE — multiple .jsonl → one merged .jsonl
// ══════════════════════════════════════════════════════════

async function readJsonlFiles(files: File[]) {
  const jsonlFiles = files.filter((f) => f.name.endsWith(".jsonl"));
  if (jsonlFiles.length === 0) {
    alert("No .jsonl files found. Please upload .jsonl files.");
    return;
  }
  const contents = await Promise.all(jsonlFiles.map((f) => f.text()));

  // Collect all non-empty lines
  mergedLines = contents.flatMap((c) =>
    c.split(/\r?\n/).filter((line) => line.trim().length > 0),
  );

  // Update UI
  mergeFileCountEl.textContent = String(jsonlFiles.length);
  mergeLineCountEl.textContent = String(mergedLines.length);
  show(mergeStatusBar, mergePreviewSection, mergeActionsSection);

  // Preview first 5 lines
  const MAX_PREVIEW = 5;
  const MAX_CHARS = 500;
  const previewLines = mergedLines.slice(0, MAX_PREVIEW).map((line) =>
    line.length > MAX_CHARS ? line.slice(0, MAX_CHARS) + " …" : line,
  );
  const suffix =
    mergedLines.length > MAX_PREVIEW
      ? `\n\n… and ${mergedLines.length - MAX_PREVIEW} more lines`
      : "";
  mergePreviewEl.textContent =
    previewLines.join("\n") + suffix || "(no lines found)";
}

function downloadMergedJsonl() {
  if (mergedLines.length === 0) return;
  const blob = new Blob([mergedLines.join("\n")], { type: "application/jsonl" });
  downloadBlob(blob, "merged.jsonl");
}

function clearMerge() {
  mergedLines = [];
  hide(mergeStatusBar, mergePreviewSection, mergeActionsSection);
  mergePreviewEl.textContent = "";
}

// ── Merge mode events ────────────────────────────────────
attachDropZone(mergeDropZone, (files) => readJsonlFiles(files));
attachPickerButton(btnPickJsonl, () => createFileInput(".jsonl"), (files) => readJsonlFiles(files));

btnMergeDownload.addEventListener("click", downloadMergedJsonl);
btnMergeClear.addEventListener("click", clearMerge);
