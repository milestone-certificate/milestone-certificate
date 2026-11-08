import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { askPortalAssistant } from "@/lib/portal-ai.functions";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "আমার পরীক্ষার ফল কী?",
  "আমি কি সার্টিফিকেট পাব?",
  "অফিসিয়াল রেজাল্ট কীভাবে যাচাই করব?",
];

export function PortalAssistant() {
  const ask = useServerFn(askPortalAssistant);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    const next = [...msgs, { role: "user" as const, content: text }];
    setMsgs(next);
    setInput("");
    setErr(null);
    setBusy(true);
    try {
      const r = await ask({ data: { messages: next.slice(-20) } });
      if ("answer" in r && r.answer) setMsgs([...next, { role: "assistant", content: r.answer }]);
      else setErr(("error" in r && r.error) || "উত্তর পাওয়া যায়নি।");
    } catch {
      setErr("উত্তর তৈরি করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="font-semibold">প্রশ্ন করুন</h2>
      <p className="text-sm text-muted-foreground">
        আপনার ফলাফল ও সার্টিফিকেট নিয়ে যেকোনো প্রশ্ন করুন।
      </p>

      <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border px-3 py-1.5 text-xs hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <p
              className={`whitespace-pre-wrap text-sm leading-relaxed ${
                m.role === "user"
                  ? "max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-primary-foreground"
                  : ""
              }`}
            >
              {m.content}
            </p>
          </div>
        ))}
        {busy && <p className="animate-pulse text-sm text-muted-foreground">উত্তর তৈরি হচ্ছে…</p>}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          placeholder="আপনার প্রশ্ন লিখুন…"
          className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          পাঠান
        </button>
      </form>
    </section>
  );
}
