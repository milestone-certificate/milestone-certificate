import { ListLoadStatus } from "@/components/app/ui-bits";
import { DateSelect } from "@/components/app/DateSelect";
import { CandidatePhoto } from "@/components/app/CandidatePhoto";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Camera, CheckCircle2, Copy, FileText, UserCheck, UserX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { worksQ, openTicket, fmtDhakaDateTime, type Work } from "@/lib/works";
import { receiveCandidate } from "@/lib/workflow.functions";
import { ttcQ, occQ, lookup, bn, fmtDhakaDate } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusPill, SvpPill } from "@/components/app/WorkBits";
import { ResultShareActions, workShareInfo } from "@/components/app/ResultListShare";
import { ResultCertificateButton } from "@/components/app/ResultCertificate";
import { useRouteContext } from "@tanstack/react-router";
import { PhotoInput } from "@/components/app/PhotoInput";

export const Route = createFileRoute("/_authenticated/management")({
  head: () => ({
    meta: [
      { title: "পরীক্ষার্থী রিসেপশন | Milestone Certificate Institute" },
      {
        name: "description",
        content: "অনুমোদিত পরীক্ষার্থীর উপস্থিতি, যোগাযোগ, ছবি ও দক্ষতার তথ্য পরিচালনা।",
      },
      { property: "og:title", content: "পরীক্ষার্থী রিসেপশন | Milestone Certificate Institute" },
      { property: "og:description", content: "অনুমোদিত পরীক্ষার্থীর উপস্থিতি ও তথ্য পরিচালনা।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ManagementPage,
});

const ARRIVAL: Record<string, string> = {
  not_arrived: "এখনো আসেননি",
  received: "রিসিভ করা হয়েছে",
  absent: "অনুপস্থিত",
};

function ManagementPage() {
  const qc = useQueryClient();
  const listQuery = useQuery(worksQ);
  const { data = [] } = listQuery;
  const occ = lookup(useQuery(occQ).data);
  const [q, setQ] = useState("");
  const [day, setDay] = useState("all");
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("all");
  const dDay = (iso: string) =>
    new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  const dTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", {
      timeZone: "Asia/Dhaka",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const off = (n: number) =>
    new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  const target =
    day === "today"
      ? off(0)
      : day === "tomorrow"
        ? off(1)
        : day === "day_after"
          ? off(2)
          : day === "date"
            ? date
            : "";
  const s = q.trim().toLowerCase().replace(/^#/, "");
  const works = data
    .filter((work) => work.status !== "rejected")
    .filter((w) => !target || dDay(w.exam_at) === target)
    .filter((w) => slot === "all" || dTime(w.exam_at) === slot)
    .filter(
      (w) =>
        !s ||
        [w.candidate_name, w.passport_no, w.mobile, w.secondary_mobile, occ(w.occupation_id)].some(
          (v) => v?.toLowerCase().includes(s),
        ),
    )
    .sort((a, b) => a.exam_at.localeCompare(b.exam_at));
  const ttc = lookup(useQuery(ttcQ).data);
  const copyText = async () => {
    const groups = new Map<string, typeof works>();
    for (const w of works) {
      const k = `${occ(w.occupation_id) ?? "—"}|${w.exam_at ? fmtDhakaDate(w.exam_at) : "—"}|${w.exam_at ? dTime(w.exam_at) : "—"}`;
      groups.set(k, [...(groups.get(k) ?? []), w]);
    }
    const text = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, ws]) => {
        const [o, d, t] = k.split("|");
        return [o, d, t, "", ...ws.flatMap((w) => [w.candidate_name, w.passport_no, ""])].join(
          "\n",
        );
      })
      .join("\n")
      .trim();
    if (!text) return toast.error("কপি করার মতো কিছু নেই");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${bn(works.length)} জনের তালিকা কপি হয়েছে`);
    } catch {
      toast.error("কপি করা যায়নি");
    }
  };
  const sel = "h-10 rounded-lg border bg-card px-2 text-sm";
  if (listQuery.isLoading || listQuery.isLoadingError)
    return <ListLoadStatus query={listQuery} />;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="font-display text-2xl font-bold">পরীক্ষার্থী রিসেপশন ({bn(works.length)})</h1>
      <div className="grid gap-2 rounded-2xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          className="lg:col-span-2"
          placeholder="নাম / পাসপোর্ট / মোবাইল / পেশা"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={sel} value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="all">সব তারিখ</option>
          <option value="today">আজ</option>
          <option value="tomorrow">আগামীকাল</option>
          <option value="day_after">পরশু</option>
          <option value="date">নির্দিষ্ট তারিখ</option>
        </select>
        <select className={sel} value={slot} onChange={(e) => setSlot(e.target.value)}>
          <option value="all">সব ব্যাচ</option>
          <optgroup label="MORNING">
            <option value="10:00">10:00 AM</option>
            <option value="11:00">11:00 AM</option>
          </optgroup>
          <optgroup label="AFTERNOON">
            <option value="13:00">01:00 PM</option>
            <option value="14:00">02:00 PM</option>
          </optgroup>
        </select>
        {day === "date" && (
          <DateSelect className={sel} value={date} onChange={(e) => setDate(e.target.value)} />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            setDay("all");
            setDate("");
            setSlot("all");
          }}
        >
          সব রিসেট
        </Button>
        <Button variant="secondary" size="sm" onClick={copyText}>
          <Copy className="mr-1 h-4 w-4" /> টেক্সট কপি
        </Button>
      </div>
      {works.length === 0 ? (
        <p className="card-surface p-6 text-center text-muted-foreground">
          কোনো পরীক্ষার্থী পাওয়া যায়নি।
        </p>
      ) : (
        works.map((work) => (
          <ReceptionCard
            key={work.id}
            work={work}
            ttc={ttc}
            occ={occ}
            done={() => qc.invalidateQueries({ queryKey: ["works"] })}
          />
        ))
      )}
    </div>
  );
}

function ReceptionCard({
  work,
  ttc,
  occ,
  done,
}: {
  work: Work;
  ttc: (id: string | null) => string;
  occ: (id: string | null) => string;
  done: () => void;
}) {
  const [mobile, setMobile] = useState(work.secondary_mobile ?? "");
  const [skills, setSkills] = useState(work.skill_details ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (arrivalStatus: "not_arrived" | "received" | "absent") => {
    if (mobile && !/^01[3-9]\d{8}$/.test(mobile))
      return toast.error("অতিরিক্ত মোবাইল নম্বরটি সঠিক নয়");
    setBusy(true);
    try {
      let photoPath = work.candidate_photo_path;
      if (photo) {
        const path = `candidates/${work.id}/${crypto.randomUUID()}.${photo.type.split("/")[1] ?? "jpg"}`;
        const { error } = await supabase.storage
          .from("candidate-photos")
          .upload(path, photo, { contentType: photo.type });
        if (error) throw error;
        photoPath = path;
      }
      await receiveCandidate({
        data: {
          id: work.id,
          arrivalStatus,
          secondaryMobile: mobile || null,
          skillDetails: skills.trim() || null,
          photoPath,
        },
      });
      toast.success("পরীক্ষার্থীর অবস্থা আপডেট হয়েছে");
      done();
    } catch {
      toast.error("তথ্য আপডেট করা যায়নি");
    } finally {
      setBusy(false);
    }
  };
  const { roles } = useRouteContext({ from: "/_authenticated" });
  const receptionOnly =
    roles.includes("management") &&
    !roles.some((r) => ["admin", "staff", "agent", "service_provider"].includes(r));
  return (
    <section
      className={`card-surface space-y-4 border-l-4 p-4 transition-all duration-300 hover:-translate-y-0.5 ${work.svp_result === "PASS" ? "border-l-emerald-500 shadow-[0_0_14px_-4px_rgb(16_185_129/0.6)] hover:shadow-[0_0_22px_-4px_rgb(16_185_129/0.8)]" : "border-l-amber-400 shadow-[0_0_14px_-4px_rgb(251_191_36/0.55)] hover:shadow-[0_0_22px_-4px_rgb(251_191_36/0.8)]"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <CandidatePhoto
            path={work.candidate_photo_path}
            name={work.candidate_name}
            size={52}
            deferUntilVisible
          />
          <div>
            <h2 className="font-semibold">{work.candidate_name}</h2>
            <p className="text-sm text-muted-foreground">
              {work.passport_no} · {work.mobile}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <StatusPill status={work.status} />
          <StatusPill status={work.arrival_status} />
          {work.status === "approved" && <SvpPill result={work.svp_result} work={work} />}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {occ(work.occupation_id)} · {ttc(work.ttc_id)} · {fmtDhakaDateTime(work.exam_at)}
      </p>
      {(() => {
        const d = workShareInfo(work, occ, ttc);
        return d ? (
          <div className="flex flex-wrap gap-2">
            {receptionOnly ? (
              <ResultCertificateButton
                d={{
                  name: d.name,
                  passport: d.passport,
                  occupation: d.occupation,
                  occupationId: work.occupation_id,
                  examAt: d.examAt,
                  result: d.result,
                  ref: d.ref,
                }}
              />
            ) : (
              <ResultShareActions d={d} />
            )}
          </div>
        ) : null;
      })()}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>অতিরিক্ত যোগাযোগ নম্বর</Label>
          <Input
            inputMode="numeric"
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 11))}
          />
        </div>
        <div>
          <Label>পরীক্ষার্থীর ছবি</Label>
          <PhotoInput onFile={setPhoto} />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Label>দক্ষতা সম্পর্কে তথ্য</Label>
          <div className="flex flex-wrap gap-2">
            {[
              "কম্পিউটার পারে",
              "কম্পিউটার জানে না",
              "শিক্ষিত না",
              "অভিজ্ঞতা নাই",
              "পূর্বে ১/২ বার ফেইল করা",
            ].map((t) => {
              const on = skills.split(/,\s*/).includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    !on && setSkills((s) => (s.trim() ? `${s.trim().replace(/,$/, "")}, ${t}` : t))
                  }
                  className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-primary bg-primary/20 text-primary" : "border-border hover:border-primary hover:text-primary"}`}
                >
                  + {t}
                </button>
              );
            })}
          </div>
          <Textarea
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            maxLength={1000}
            rows={2}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => save("received")}>
          <UserCheck className="h-4 w-4" /> রিসিভ করুন
        </Button>
        <Button disabled={busy} variant="destructive" onClick={() => save("absent")}>
          <UserX className="h-4 w-4" /> অনুপস্থিত
        </Button>
        {work.arrival_status !== "not_arrived" && (
          <Button disabled={busy} variant="outline" onClick={() => save("not_arrived")}>
            <CheckCircle2 className="h-4 w-4" /> অপেক্ষমান করুন
          </Button>
        )}
        {work.ticket_path && (
          <Button variant="outline" onClick={() => openTicket(work.ticket_path)}>
            <FileText className="h-4 w-4" /> অ্যাপয়েন্টমেন্ট PDF
          </Button>
        )}
        {photo && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Camera className="h-4 w-4" /> ছবি নির্বাচিত
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        বর্তমান অবস্থা: {ARRIVAL[work.arrival_status] ?? work.arrival_status}
      </p>
    </section>
  );
}
