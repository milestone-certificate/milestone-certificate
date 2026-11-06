import { DateSelect } from "@/components/app/DateSelect";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { worksQ, fmtDhakaDateTime, type Work } from "@/lib/works";
import { occQ, ttcQ, lookup, bn } from "@/lib/data";
import { SvpPill } from "@/components/app/WorkBits";
import { ResultCheckButton } from "@/components/app/ResultCheckButton";
import { Button } from "@/components/ui/button";
import brandLogo from "@/assets/brand-logo.jpg";
import cardBg from "@/assets/bg-cosmic-1.webp";

const dhakaDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });

export type ResultShareInfo = {
  name: string;
  passport: string;
  occupation: string;
  ttc: string;
  examAt: string;
  result: string;
  ref: string;
};
type Info = ResultShareInfo;

/** Build share info from a work/submission row; returns null unless the result is PASS/FAIL. */
export function workShareInfo(
  w: Pick<
    Work,
    | "candidate_name"
    | "passport_no"
    | "occupation_id"
    | "ttc_id"
    | "exam_at"
    | "svp_result"
    | "ref_code"
  >,
  occ: (id: string | null) => string | undefined,
  ttc: (id: string | null) => string | undefined,
): ResultShareInfo | null {
  if (w.svp_result !== "PASS" && w.svp_result !== "FAIL") return null;
  return {
    name: w.candidate_name,
    passport: w.passport_no,
    occupation: occ(w.occupation_id) ?? "—",
    ttc: ttc(w.ttc_id) ?? "—",
    examAt: fmtDhakaDateTime(w.exam_at),
    result: w.svp_result,
    ref: w.ref_code,
  };
}

function loadImg(src: string) {
  return new Promise<HTMLImageElement | null>((res) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

function cover(x: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s,
    h = img.height * s;
  x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

async function makeCard(d: Info): Promise<Blob> {
  const W = 1080,
    H = 1350,
    c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  const pass = d.result === "PASS";
  const accent = pass ? "#22c55e" : "#ef4444";
  const accentDark = pass ? "#14532d" : "#7f1d1d";

  // Background photo + dark gradient veil
  const bg = await loadImg(cardBg);
  if (bg) cover(x, bg, W, H);
  else {
    x.fillStyle = "#0b1220";
    x.fillRect(0, 0, W, H);
  }
  const veil = x.createLinearGradient(0, 0, 0, H);
  veil.addColorStop(0, "rgba(6,14,10,0.82)");
  veil.addColorStop(0.5, "rgba(6,14,10,0.88)");
  veil.addColorStop(1, "rgba(6,14,10,0.94)");
  x.fillStyle = veil;
  x.fillRect(0, 0, W, H);

  // Ambient glow orbs
  const orb = (cx: number, cy: number, r: number, col: string) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, col);
    g.addColorStop(1, "transparent");
    x.fillStyle = g;
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fill();
  };
  orb(W - 120, 120, 380, pass ? "rgba(34,197,94,0.28)" : "rgba(239,68,68,0.25)");
  orb(80, H - 140, 420, "rgba(56,189,248,0.16)");

  // Outer frame
  x.strokeStyle = "rgba(255,255,255,0.14)";
  x.lineWidth = 3;
  x.beginPath();
  x.roundRect(34, 34, W - 68, H - 68, 36);
  x.stroke();
  x.strokeStyle = accent;
  x.lineWidth = 2;
  x.globalAlpha = 0.5;
  x.beginPath();
  x.roundRect(46, 46, W - 92, H - 92, 30);
  x.stroke();
  x.globalAlpha = 1;

  // Glass header
  x.fillStyle = "rgba(255,255,255,0.07)";
  x.beginPath();
  x.roundRect(70, 70, W - 140, 190, 28);
  x.fill();
  x.strokeStyle = "rgba(255,255,255,0.16)";
  x.lineWidth = 1.5;
  x.stroke();

  const logo = await loadImg(brandLogo);
  if (logo) {
    x.save();
    x.shadowColor = accent;
    x.shadowBlur = 40;
    x.beginPath();
    x.arc(185, 165, 72, 0, Math.PI * 2);
    x.fillStyle = "#0f172a";
    x.fill();
    x.shadowBlur = 0;
    x.clip();
    x.drawImage(logo, 113, 93, 144, 144);
    x.restore();
    x.strokeStyle = accent;
    x.lineWidth = 4;
    x.beginPath();
    x.arc(185, 165, 72, 0, Math.PI * 2);
    x.stroke();
  }
  x.textAlign = "left";
  x.fillStyle = "#ffffff";
  x.font = "bold 54px sans-serif";
  x.fillText("Milestone Certificate", 290, 150);
  x.fillStyle = "rgba(255,255,255,0.75)";
  x.font = "32px sans-serif";
  x.fillText("Institute · Official SVP Exam Result", 290, 200);

  // Result badge — dynamic rays, shine sweep and depth
  const bx = W / 2,
    by = 450,
    br = 132;
  const bgGlow = x.createRadialGradient(bx, by, br * 0.4, bx, by, br * 2.3);
  bgGlow.addColorStop(0, pass ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)");
  bgGlow.addColorStop(1, "transparent");
  x.fillStyle = bgGlow;
  x.beginPath();
  x.arc(bx, by, br * 2.3, 0, Math.PI * 2);
  x.fill();

  // Sunray burst behind the badge
  x.save();
  x.translate(bx, by);
  for (let i = 0; i < 40; i++) {
    x.rotate(Math.PI / 20);
    x.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.015)";
    x.beginPath();
    x.moveTo(0, 0);
    x.arc(0, 0, br * 2.05, 0, Math.PI / 20);
    x.closePath();
    x.fill();
  }
  x.restore();

  // Badge body — radial gradient with soft drop shadow
  x.save();
  x.shadowColor = accent;
  x.shadowBlur = 60;
  x.shadowOffsetY = 6;
  const badge = x.createRadialGradient(bx - br * 0.35, by - br * 0.45, br * 0.15, bx, by, br);
  badge.addColorStop(0, pass ? "#4ade80" : "#f87171");
  badge.addColorStop(0.55, accent);
  badge.addColorStop(1, accentDark);
  x.fillStyle = badge;
  x.beginPath();
  x.arc(bx, by, br, 0, Math.PI * 2);
  x.fill();
  x.restore();

  // Diagonal shine sweep
  x.save();
  x.beginPath();
  x.arc(bx, by, br, 0, Math.PI * 2);
  x.clip();
  x.translate(bx, by);
  x.rotate(-Math.PI / 7);
  x.translate(-bx, -by);
  const shine = x.createLinearGradient(bx - br, by - br * 1.6, bx + br, by + br * 0.4);
  shine.addColorStop(0, "rgba(255,255,255,0)");
  shine.addColorStop(0.5, "rgba(255,255,255,0.35)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = shine;
  x.fillRect(bx - br * 2, by - br * 2, br * 4, br * 4);
  x.restore();

  // Rings — solid inner + dashed accent outer
  x.strokeStyle = "rgba(255,255,255,0.9)";
  x.lineWidth = 5;
  x.beginPath();
  x.arc(bx, by, br - 10, 0, Math.PI * 2);
  x.stroke();
  x.setLineDash([2, 12]);
  x.lineCap = "round";
  x.strokeStyle = pass ? "rgba(74,222,128,0.9)" : "rgba(248,113,113,0.9)";
  x.lineWidth = 4;
  x.beginPath();
  x.arc(bx, by, br + 16, 0, Math.PI * 2);
  x.stroke();
  x.setLineDash([]);

  // Check mark above the word
  x.strokeStyle = "rgba(255,255,255,0.95)";
  x.lineWidth = 10;
  x.lineCap = "round";
  x.lineJoin = "round";
  x.beginPath();
  x.moveTo(bx - 26, by - 56);
  x.lineTo(bx - 6, by - 36);
  x.lineTo(bx + 34, by - 76);
  x.stroke();

  // Word with drop depth
  x.textAlign = "center";
  x.save();
  x.shadowColor = "rgba(0,0,0,0.45)";
  x.shadowBlur = 12;
  x.shadowOffsetY = 4;
  x.fillStyle = "#ffffff";
  x.font = "bold 96px sans-serif";
  x.fillText(d.result, bx, by + 46);
  x.restore();
  x.fillStyle = "rgba(255,255,255,0.85)";
  x.font = "28px sans-serif";
  x.fillText(pass ? "✓ VERIFIED RESULT" : "✕ RESULT DECLARED", bx, by + br + 56);

  // Info glass panel
  const px = 90,
    py = 660,
    pw = W - 180,
    ph = 470;
  x.fillStyle = "rgba(255,255,255,0.06)";
  x.beginPath();
  x.roundRect(px, py, pw, ph, 26);
  x.fill();
  x.strokeStyle = "rgba(255,255,255,0.14)";
  x.lineWidth = 1.5;
  x.stroke();

  const rows: [string, string][] = [
    ["Name", d.name],
    ["Passport", d.passport],
    ["Occupation", d.occupation],
    ["TTC", d.ttc],
    ["Exam", d.examAt],
    ["Reference", d.ref],
  ];
  let y = py + 62;
  for (const [k, v] of rows) {
    x.textAlign = "left";
    x.fillStyle = "rgba(255,255,255,0.55)";
    x.font = "30px sans-serif";
    x.fillText(k.toUpperCase(), px + 40, y);
    x.fillStyle = "#ffffff";
    x.font = "bold 38px sans-serif";
    let t = v || "—";
    while (x.measureText(t).width > 500 && t.length > 3) t = t.slice(0, -2);
    x.textAlign = "right";
    x.fillText(t, px + pw - 40, y);
    if (k !== "Reference") {
      x.strokeStyle = "rgba(255,255,255,0.1)";
      x.lineWidth = 1.5;
      x.beginPath();
      x.moveTo(px + 40, y + 24);
      x.lineTo(px + pw - 40, y + 24);
      x.stroke();
    }
    y += 68;
  }

  // Footer
  x.textAlign = "center";
  x.fillStyle = "rgba(255,255,255,0.6)";
  x.font = "27px sans-serif";
  x.fillText("Source: Official SVP (svp-international.pacc.sa)", W / 2, H - 105);
  x.fillStyle = "rgba(255,255,255,0.4)";
  x.font = "24px sans-serif";
  x.fillText(
    `Generated: ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })} · milestonecertificate.lovable.app`,
    W / 2,
    H - 68,
  );
  return new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
}

/** Reusable image download + WhatsApp share buttons for a declared (PASS/FAIL) result. */
export function ResultShareActions({ d }: { d: ResultShareInfo }) {
  const download = async () => {
    const blob = await makeCard(d);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Result-${d.passport}-${d.result}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast.success("ছবি ডাউনলোড হয়েছে");
  };
  // Mobile browsers cancel the share sheet if the image is built after the tap,
  // so the image is generated in advance as soon as the result is shown/updated.
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = (typeof navigator !== "undefined" ? navigator : undefined) as
    (Navigator & { canShare?: (x: ShareData) => boolean }) | undefined;
  const key = `${d.passport}|${d.result}|${d.name}|${d.examAt}|${d.occupation}|${d.ttc}`;
  useEffect(() => {
    let alive = true;
    setFile(null);
    const t = setTimeout(async () => {
      try {
        const blob = await makeCard(d);
        if (alive)
          setFile(new File([blob], `Result-${d.passport}-${d.result}.png`, { type: "image/png" }));
      } catch {
        /* built on tap instead */
      }
    }, Math.random() * 1500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const fallback = (f: File) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast.info("এই ডিভাইসে শেয়ার মেনু নেই — ছবি ডাউনলোড হয়েছে");
  };
  const share = async () => {
    let f = file;
    if (!f) {
      setBusy(true);
      try {
        const blob = await makeCard(d);
        f = new File([blob], `Result-${d.passport}-${d.result}.png`, { type: "image/png" });
        setFile(f);
      } finally {
        setBusy(false);
      }
    }
    // Image only — opens the phone's native share sheet (no text/caption).
    if (nav?.share && nav.canShare?.({ files: [f] })) {
      try {
        await nav.share({ files: [f] });
      } catch (err) {
        const n = (err as DOMException)?.name;
        if (n === "NotAllowedError") toast.info("আবার শেয়ার চাপুন");
        else if (n !== "AbortError") fallback(f);
      }
    } else fallback(f);
  };
  return (
    <>
      <Button size="sm" variant="outline" onClick={download}>
        <Download className="mr-1 h-4 w-4" />
        ছবি ডাউনলোড
      </Button>
      <Button size="sm" disabled={busy} onClick={share}>
        <Share2 className="mr-1 h-4 w-4" />
        {busy ? "তৈরি হচ্ছে…" : "শেয়ার"}
      </Button>
    </>
  );
}

export function ResultListShare() {
  const { data: all = [] } = useQuery(worksQ);
  const { data: occ } = useQuery(occQ);
  const { data: ttc } = useQuery(ttcQ);
  const occName = lookup(occ),
    ttcName = lookup(ttc);
  const [date, setDate] = useState(today);
  const [q, setQ] = useState("");
  const s = q.trim().toUpperCase();
  const list = all
    .filter((w) => w.status === "approved" && !!w.exam_at)
    .filter((w) => (date ? dhakaDay(w.exam_at) === date : true))
    .filter(
      (w) =>
        !s || w.passport_no.toUpperCase().includes(s) || w.candidate_name.toUpperCase().includes(s),
    )
    .sort((a, b) => a.exam_at.localeCompare(b.exam_at));

  const info = (w: Work): Info => ({
    name: w.candidate_name,
    passport: w.passport_no,
    occupation: occName(w.occupation_id) ?? "—",
    ttc: ttcName(w.ttc_id) ?? "—",
    examAt: fmtDhakaDateTime(w.exam_at),
    result: w.svp_result,
    ref: w.ref_code,
  });

  const shift = (n: number) => {
    const d = new Date(`${date || today()}T00:00:00`);
    d.setDate(d.getDate() + n);
    setDate(d.toLocaleDateString("en-CA"));
  };

  return (
    <div className="card-surface space-y-3 p-4">
      <h2 className="text-lg font-bold">পরীক্ষার্থীদের তালিকা</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => shift(-1)}>
          ‹
        </Button>
        <DateSelect
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded-lg border bg-card px-2 text-sm"
        />
        <Button size="sm" variant="outline" onClick={() => shift(1)}>
          ›
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDate(today())}>
          আজ
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDate("")}>
          সব তারিখ
        </Button>
      </div>
      <input
        className="h-10 w-full rounded-lg border bg-card px-3 text-sm"
        placeholder="পাসপোর্ট / নাম দিয়ে খুঁজুন"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">মোট {bn(list.length)} জন</p>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
        {list.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            এই তারিখে কোনো পরীক্ষার্থী নেই।
          </p>
        )}
        {list.map((w) => {
          const done = w.svp_result === "PASS" || w.svp_result === "FAIL";
          return (
            <div key={w.id} className="space-y-2 rounded-xl border bg-card p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{w.candidate_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {w.passport_no} · {occName(w.occupation_id) ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">{fmtDhakaDateTime(w.exam_at)}</p>
                </div>
                <SvpPill result={w.svp_result} work={w} />
              </div>
              <div className="flex flex-wrap gap-2">
                <ResultCheckButton w={w} />
                {done && <ResultShareActions d={info(w)} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
