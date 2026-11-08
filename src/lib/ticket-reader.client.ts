import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  emptyTicket,
  hasAppointmentIdentity,
  MAX_TICKET_BYTES,
  parseAppointmentText,
  ticketMime,
  type TicketExtraction,
} from "./ticket-extraction";

export type ReadProgress = (message: string) => void;
const stopped = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
};

async function recognize(
  image: Blob | HTMLCanvasElement,
  signal: AbortSignal,
  progress: ReadProgress,
): Promise<{ text: string; confidence: number }> {
  const { createWorker } = await import("tesseract.js");
  stopped(signal);
  progress("ছবির লেখা পড়ার প্রস্তুতি চলছে…");
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let rejectAbort: (reason: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => rejectAbort(new DOMException("Cancelled", "AbortError"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    const creating = createWorker("eng", 1, {
      workerPath: new URL("/ocr/worker.min.js", location.origin).href,
      corePath: new URL("/ocr/tesseract-core-lstm.wasm.js", location.origin).href,
      langPath: new URL("/ocr", location.origin).href,
      workerBlobURL: false,
      logger: (message) => {
        if (message.status === "recognizing text")
          progress(`ছবির লেখা পড়া হচ্ছে… ${Math.round(message.progress * 100)}%`);
      },
    });
    void creating.then(
      (instance) => {
        if (signal.aborted) void instance.terminate();
      },
      () => {},
    );
    worker = await Promise.race([creating, cancelled]);
    stopped(signal);
    const result = await Promise.race([worker.recognize(image), cancelled]);
    stopped(signal);
    return {
      text: result.data.text,
      confidence: Math.min(0.98, Math.max(0, result.data.confidence / 100)),
    };
  } finally {
    signal.removeEventListener("abort", abort);
    if (worker) await worker.terminate();
  }
}

/** Reads ordinary PDFs directly; scans are recognized locally with bundled OCR assets. */
export async function readAppointment(
  file: File,
  signal: AbortSignal,
  progress: ReadProgress,
): Promise<{ file: File; extraction: TicketExtraction }> {
  if (!file.size || file.size > MAX_TICKET_BYTES) throw new Error("৮ MB-এর মধ্যে PDF বা ছবি দিন।");
  const bytes = new Uint8Array(await file.arrayBuffer());
  stopped(signal);
  const mime = ticketMime(bytes);
  if (!mime) throw new Error("সঠিক PDF, JPG, PNG বা WEBP ফাইল দিন।");
  const normalized =
    file.type === mime
      ? file
      : new File([file], file.name, { type: mime, lastModified: file.lastModified });
  if (mime !== "application/pdf") {
    const result = await recognize(normalized, signal, progress);
    return { file: normalized, extraction: parseAppointmentText(result.text, result.confidence) };
  }
  progress("PDF-এর লেখা পড়া হচ্ছে…");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    standardFontDataUrl: new URL("/ocr/fonts/", location.origin).href,
    cMapUrl: new URL("/ocr/cmaps/", location.origin).href,
    cMapPacked: true,
    wasmUrl: new URL("/ocr/pdf-wasm/", location.origin).href,
  });
  const cancel = () => {
    void task.destroy();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const pdf = await task.promise;
    stopped(signal);
    if (pdf.numPages > 10) throw new Error("একজন পরীক্ষার্থীর সর্বোচ্চ ১০ পৃষ্ঠার টিকিট দিন।");
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      stopped(signal);
      // Preserve PDF rows and label/value columns rather than joining unrelated fields.
      const rows: { y: number; items: { x: number; text: string }[] }[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = item.transform[5];
        let row = rows.find((r) => Math.abs(r.y - y) < 3);
        if (!row) {
          row = { y, items: [] };
          rows.push(row);
        }
        row.items.push({ x: item.transform[4], text: item.str });
      }
      pages.push(
        rows
          .sort((a, b) => b.y - a.y)
          .map((r) =>
            r.items
              .sort((a, b) => a.x - b.x)
              .map((i) => i.text)
              .join("  "),
          )
          .join("\n"),
      );
    }
    const text = pages.join("\n");
    const extracted = parseAppointmentText(text);
    if (hasAppointmentIdentity(extracted) || extracted.candidate_count > 1)
      return { file: normalized, extraction: extracted };
    // Rasterize a scan at a bounded resolution for OCR. Reuse one worker per page and release it.
    let scanText = "",
      confidence = 0.98;
    for (let index = 1; index <= Math.min(pdf.numPages, 3); index++) {
      stopped(signal);
      const page = await pdf.getPage(index);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 2200 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      stopped(signal);
      const result = await recognize(canvas, signal, progress);
      canvas.width = canvas.height = 0;
      scanText += `\n${result.text}`;
      confidence = Math.min(confidence, result.confidence);
    }
    const scanned = parseAppointmentText(scanText, confidence);
    const combined = emptyTicket();
    for (const key of [
      "candidate_name",
      "passport_no",
      "occupation",
      "exam_date",
      "exam_time",
      "center",
      "booking_no",
      "agency_name",
      "mobile",
    ] as const)
      combined[key] = (extracted[key]?.value ? extracted[key] : scanned[key]) ?? {
        value: null,
        confidence: 0,
      };
    combined.candidate_count = Math.max(extracted.candidate_count, scanned.candidate_count);
    combined.ambiguities = [...new Set([...extracted.ambiguities, ...scanned.ambiguities])].filter(
      (w) => !w.includes("তারিখ ও সময়") || !combined.exam_date.value || !combined.exam_time.value,
    );
    return { file: normalized, extraction: combined };
  } finally {
    signal.removeEventListener("abort", cancel);
    await task.destroy();
  }
}
