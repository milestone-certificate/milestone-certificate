import { DateSelect } from "@/components/app/DateSelect";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2, Check, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Empty, Field, NativeSelect } from "@/components/app/ui-bits";
import { changeMyAdminEmail } from "@/lib/accounts.functions";
import { roleSummary } from "@/lib/roles";
import { syncSvpOccupationCatalogue } from "@/lib/svp.functions";
import {
  occQ,
  ttcQ,
  settingsQ,
  remindersQ,
  candidatesQ,
  fmtDate,
  todayStr,
  useRefreshAll,
  bn,
} from "@/lib/data";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "সেটিংস ও অ্যাডমিন | Milestone Certificate Institute" },
      { name: "description", content: "টিটিসি, পেশা, ব্যবহারকারী ও সেটিংস।" },
      { property: "og:title", content: "সেটিংস ও অ্যাডমিন | Milestone Certificate Institute" },
      { property: "og:description", content: "টিটিসি, পেশা, ব্যবহারকারী ও সেটিংস।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { roles, user } = Route.useRouteContext();
  const admin = roles.includes("admin");
  return (
    <div>
      <PageHeader title={admin ? "সেটিংস ও অ্যাডমিন প্যানেল" : "সেটিংস"} />
      <Tabs defaultValue="notice">
        <TabsList className="mb-4 flex h-auto flex-wrap">
          <TabsTrigger value="notice">এজেন্ট নোটিস</TabsTrigger>
          <TabsTrigger value="ttc">টিটিসি সেন্টার</TabsTrigger>
          <TabsTrigger value="occ">পেশা</TabsTrigger>
          <TabsTrigger value="rem">রিমাইন্ডার</TabsTrigger>
          <TabsTrigger value="users">ব্যবহারকারী</TabsTrigger>
          <TabsTrigger value="gen">সাধারণ</TabsTrigger>
          {admin && <TabsTrigger value="email">অ্যাডমিন ইমেইল</TabsTrigger>}
        </TabsList>
        <TabsContent value="notice">
          <NoticeEditor />
        </TabsContent>
        <TabsContent value="ttc">
          <MasterList table="ttc_centers" withDistrict />
        </TabsContent>
        <TabsContent value="occ">
          <MasterList table="occupations" allowSync={admin} />
        </TabsContent>
        <TabsContent value="rem">
          <Reminders />
        </TabsContent>
        <TabsContent value="users">
          <Users />
        </TabsContent>
        <TabsContent value="gen">
          <General />
        </TabsContent>
        {admin && (
          <TabsContent value="email">
            <AdminEmail currentEmail={user.email ?? ""} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function MasterList({
  table,
  withDistrict,
  allowSync,
}: {
  table: "ttc_centers" | "occupations";
  withDistrict?: boolean;
  allowSync?: boolean;
}) {
  const { data: ttcRows = [] } = useQuery(ttcQ);
  const { data: occRows = [] } = useQuery(occQ);
  const data: { id: string; name: string; district?: string | null; svp_key?: string | null }[] =
    table === "ttc_centers" ? ttcRows : occRows;
  const refresh = useRefreshAll();
  const [name, setName] = useState("");
  const [district, setDistrict] = useState("");
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const syncCatalogue = useServerFn(syncSvpOccupationCatalogue);
  const qc = useQueryClient();
  const visible = data.filter((r) =>
    [r.name, r.district, r.svp_key].some((s) =>
      s?.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  const sync = async () => {
    setSyncing(true);
    try {
      const result = await syncCatalogue();
      if (!result.ok) return toast.error(result.message);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["occ"] }),
        qc.invalidateQueries({ queryKey: ["public-occ"] }),
      ]);
      if (result.conflicts)
        toast.warning(`${bn(result.conflicts)}টি পেশার নাম বা কোড আলাদা আছে—যাচাই করুন।`);
      else
        toast.success(
          result.inserted
            ? `${bn(result.inserted)}টি নতুন পেশা যোগ হয়েছে।`
            : `SVP-এর ${bn(result.official)}টি পেশা আপডেট আছে।`,
        );
    } catch {
      toast.error("পেশার তালিকা sync হয়নি। আবার চেষ্টা করুন।");
    } finally {
      setSyncing(false);
    }
  };
  const add = async () => {
    if (!name.trim()) return;
    const { error } = withDistrict
      ? await supabase
          .from("ttc_centers")
          .insert({ name: name.trim(), district: district || null, active: true })
      : await supabase.from("occupations").insert({ name: name.trim(), active: true });
    if (error) return toast.error(error.code === "23505" ? "এই নাম আগেই আছে" : error.message);
    setName("");
    setDistrict("");
    refresh();
    toast.success("যোগ হয়েছে");
  };
  const del = async (id: string) => {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };
  return (
    <div className="card-surface max-w-2xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">
          মোট {bn(data.length)}টি {table === "occupations" ? "পেশা" : "সেন্টার"}
        </p>
        {table === "occupations" && allowSync && (
          <Button variant="outline" onClick={sync} disabled={syncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "আনা হচ্ছে…" : "SVP থেকে আপডেট"}
          </Button>
        )}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="নাম"
          className="flex-1"
        />
        {withDistrict && (
          <Input
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            placeholder="জেলা"
            className="w-40"
          />
        )}
        <Button onClick={add}>যোগ করুন</Button>
      </div>
      <Input
        aria-label={table === "occupations" ? "পেশা বা SVP কোড খুঁজুন" : "সেন্টার খুঁজুন"}
        placeholder={table === "occupations" ? "পেশা বা SVP কোড খুঁজুন" : "সেন্টার খুঁজুন"}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3"
      />
      <ul className="divide-y">
        {visible.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-2">
            <span>
              {r.name}{" "}
              {r.district && <span className="text-sm text-muted-foreground">· {r.district}</span>}
              {r.svp_key && <span className="ml-2 text-xs text-muted-foreground">{r.svp_key}</span>}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`${r.name} মুছুন`}
              onClick={() => del(r.id)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Reminders() {
  const { data = [] } = useQuery(remindersQ);
  const { data: cands = [] } = useQuery(candidatesQ);
  const refresh = useRefreshAll();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayStr());
  const [cand, setCand] = useState("");
  const add = async () => {
    if (!title.trim()) return;
    const { error } = await supabase
      .from("reminders")
      .insert({ title, due_date: date, candidate_id: cand || null });
    if (error) return toast.error(error.message);
    setTitle("");
    refresh();
  };
  const toggle = async (id: string, done: boolean) => {
    await supabase.from("reminders").update({ done }).eq("id", id);
    refresh();
  };
  return (
    <div className="card-surface max-w-3xl p-4">
      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="যেমন: পুনঃপরীক্ষার তারিখ জানান"
          className="sm:col-span-2"
        />
        <DateSelect value={date} onChange={(e) => setDate(e.target.value)} />
        <NativeSelect value={cand} onChange={(e) => setCand(e.target.value)}>
          <option value="">পরীক্ষার্থী (ঐচ্ছিক)</option>
          {cands.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <Button onClick={add} className="sm:col-span-4">
          রিমাইন্ডার যোগ করুন
        </Button>
      </div>
      {data.length === 0 ? (
        <Empty>কোনো রিমাইন্ডার নেই</Empty>
      ) : (
        <ul className="divide-y">
          {data.map((r) => (
            <li
              key={r.id}
              className={`flex items-center justify-between py-2 ${r.done ? "opacity-50 line-through" : ""}`}
            >
              <span>
                {r.title}{" "}
                <span className="text-sm text-muted-foreground">
                  · {fmtDate(r.due_date)} · {cands.find((c) => c.id === r.candidate_id)?.name ?? ""}
                </span>
              </span>
              <Button size="sm" variant="outline" onClick={() => toggle(r.id, !r.done)}>
                <Check className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Users() {
  const { data } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("user_roles").select("*"),
      ]);
      return (p ?? []).map((x) => ({
        ...x,
        roles: (r ?? []).filter((y) => y.user_id === x.id).map((y) => y.role),
      }));
    },
  });
  return (
    <div className="card-surface max-w-2xl p-4">
      <p className="mb-3 text-sm text-muted-foreground">
        ব্যবহারকারীর নাম, ইমেইল ও অনুমোদিত ভূমিকা।
      </p>
      <ul className="divide-y">
        {data?.map((u) => (
          <li key={u.id} className="flex justify-between py-2">
            <span>
              {u.full_name} <span className="text-sm text-muted-foreground">{u.email}</span>
            </span>
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary">
              {roleSummary(u.roles)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function General() {
  const { data } = useQuery(settingsQ);
  const refresh = useRefreshAll();
  const [org, setOrg] = useState("");
  const [api, setApi] = useState("");
  const [publicPayment, setPublicPayment] = useState("");
  useEffect(() => {
    if (data) {
      setOrg(data.org_name ?? "");
      setApi(data.result_api_url ?? "");
      setPublicPayment(data.public_payment_instructions ?? "");
    }
  }, [data]);
  const save = async () => {
    const { error } = await supabase.from("settings").upsert([
      { key: "org_name", value: org },
      { key: "public_payment_instructions", value: publicPayment },
      { key: "result_api_url", value: api },
    ]);
    if (error) return toast.error(error.message);
    refresh();
    toast.success("সংরক্ষিত হয়েছে");
  };
  return (
    <div className="card-surface max-w-xl space-y-3 p-4">
      <Field label="প্রতিষ্ঠানের নাম">
        <Input value={org} onChange={(e) => setOrg(e.target.value)} />
      </Field>
      <Field label="পরীক্ষার্থীর পেমেন্ট নির্দেশনা (প্রকাশ্য)">
        <textarea
          value={publicPayment}
          onChange={(e) => setPublicPayment(e.target.value)}
          maxLength={2000}
          rows={3}
          className="w-full rounded-lg border bg-background p-3 text-sm"
          placeholder="প্রতিষ্ঠান বা কর্মীদের নাম ও অভ্যন্তরীণ তথ্য ছাড়া প্রয়োজনীয় নির্দেশনা লিখুন"
        />
      </Field>
      <Field label="অফিসিয়াল রেজাল্ট API ঠিকানা (ভবিষ্যতে সংযোগের জন্য)">
        <Input
          value={api}
          onChange={(e) => setApi(e.target.value)}
          placeholder="এখনো সংযুক্ত নয়"
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        অনুমোদিত অফিসিয়াল API পাওয়া গেলে অটোমেটিক রেজাল্ট চেক চালু করা যাবে।
      </p>
      <Button onClick={save}>সংরক্ষণ করুন</Button>
    </div>
  );
}

function AdminEmail({ currentEmail }: { currentEmail: string }) {
  const [email, setEmail] = useState(currentEmail);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await changeMyAdminEmail({ data: { email } });
      if (r.ok) toast.success("ইমেইল পরিবর্তন হয়েছে। পরবর্তীতে নতুন ইমেইল দিয়ে লগইন করুন।");
      else toast.error(r.message);
    } catch {
      toast.error("ইমেইল পরিবর্তন করা যায়নি");
    }
    setBusy(false);
  };
  return (
    <div className="max-w-md space-y-3 rounded-2xl border bg-card p-4">
      <Field label="নতুন অ্যাডমিন ইমেইল">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Button onClick={save} disabled={busy}>
        {busy ? "অপেক্ষা করুন..." : "ইমেইল পরিবর্তন করুন"}
      </Button>
    </div>
  );
}

function NoticeEditor() {
  const [text, setText] = useState("");
  useEffect(() => {
    supabase
      .from("settings")
      .select("value")
      .eq("key", "agent_notice")
      .maybeSingle()
      .then(({ data }) => setText(data?.value ?? ""));
  }, []);
  const save = async (v: string) => {
    const { error } = await supabase
      .from("settings")
      .upsert({ key: "agent_notice", value: v.slice(0, 1000) });
    if (error) return toast.error("সংরক্ষণ করা যায়নি");
    setText(v);
    toast.success(v ? "নোটিস চালু হয়েছে" : "নোটিস বন্ধ করা হয়েছে");
  };
  return (
    <div className="card-surface space-y-3 p-4">
      <p className="text-sm text-muted-foreground">
        এখানে লেখা নোটিস সব এজেন্টের পেজের উপরে চলমান অবস্থায় দেখাবে।
      </p>
      <textarea
        className="min-h-28 w-full rounded-lg border bg-card p-3 text-sm"
        maxLength={1000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="যেমন: আগামীকাল সকাল ১০টার মধ্যে সকল প্রার্থীকে অফিসে পাঠান।"
      />
      <div className="flex gap-2">
        <Button onClick={() => save(text.trim())}>সংরক্ষণ করুন</Button>
        <Button variant="outline" onClick={() => save("")}>
          নোটিস বন্ধ করুন
        </Button>
      </div>
    </div>
  );
}
