"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "../lib/supabaseClient";
import {
  dbUpsertSettings,
  dbFetchAll,
  dbInsertUnit,
  dbDeleteUnit,
  dbInsertTenant,
  dbToggleTenantActive,
  dbDeleteTenant,
  dbInsertUtility,
  dbDeleteUtility,
  dbInsertInvoice,
  dbDeleteInvoice,
  dbInsertPayment,
  dbDeletePayment,
  fetchJodIlsRate,
} from "../lib/db";

type Currency = "JOD" | "ILS";
type UnitKind = "apartment" | "shop";
type UtilityType = "water" | "electricity";

type Settings = {
  baseCurrency: Currency; // العملة الرئيسية لعرض الإجمالي
  jodToIlsRate: number; // 1 دينار = كم شيكل
};

type Unit = {
  id: string;
  name: string; // اسم الوحدة
  kind: UnitKind; // شقة / محل
  rentAmount: number;
  rentCurrency: Currency; // عملة العقد
};

type Tenant = {
  id: string;
  name: string;
  phone?: string;
  unitId: string;
  startDate: string; // YYYY-MM-DD
  active: boolean;
};

type UtilityCharge = {
  id: string;
  unitId: string;
  period: string; // YYYY-MM للشهري أو YYYY للسنة
  type: UtilityType;
  amount: number;
  currency: Currency;
};

type Invoice = {
  id: string;
  unitId: string;
  tenantId: string;
  period: string; // YYYY-MM أو YYYY
  scope: "monthly" | "yearly";
  rentBase: number; // بعد التحويل للعملة الرئيسية
  utilitiesBase: number; // بعد التحويل للعملة الرئيسية
  totalBase: number; // الإجمالي بالعملة الرئيسية
};

type Payment = {
  id: string;
  tenantId: string;
  unitId: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: Currency;
  period?: string; // لتسوية فترة معينة
  note?: string;
};

type AppData = {
  settings: Settings;
  units: Unit[];
  tenants: Tenant[];
  utilities: UtilityCharge[];
  invoices: Invoice[];
  payments: Payment[];
};

const DEFAULT_DATA: AppData = {
  settings: { baseCurrency: "JOD", jodToIlsRate: 5 },
  units: [],
  tenants: [],
  utilities: [],
  invoices: [],
  payments: [],
};

function uid(prefix: string = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function convertToBase(amount: number, from: Currency, settings: Settings): number {
  const rate = settings.jodToIlsRate || 5;
  if (settings.baseCurrency === "JOD") {
    return from === "JOD" ? amount : amount / rate;
  }
  // base ILS
  return from === "ILS" ? amount : amount * rate;
}

function formatCurrency(amount: number, settings: Settings): string {
  const currency = settings.baseCurrency === "JOD" ? "دينار" : "شيكل";
  const formatter = new Intl.NumberFormat("ar-JO", { maximumFractionDigits: 2 });
  return `${formatter.format(amount)} ${currency}`;
}

type TabKey = "home" | "settings" | "units" | "tenants" | "utilities" | "invoices" | "payments";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [data, setData] = useState<AppData>(DEFAULT_DATA);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [loginEmail, setLoginEmail] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);

  // Initial load from Supabase (fallback to local cache)
  useEffect(() => {
    (async () => {
      // initialize auth state
      try {
        const supabase = getSupabaseClient();
        const { data: s } = await supabase.auth.getSession();
        const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
        const emailOk = s.session?.user?.email && (!adminEmail || s.session.user.email === adminEmail);
        setIsAuthed(Boolean(s.session) && Boolean(emailOk));
        supabase.auth.onAuthStateChange((_event, sess) => {
          const ok = sess?.user?.email && (!adminEmail || sess.user.email === adminEmail);
          setIsAuthed(Boolean(sess) && Boolean(ok));
        });
      } catch {}

      try {
        const all = await dbFetchAll();
        setData((prev) => ({
          ...prev,
          settings: all.settings
            ? { baseCurrency: all.settings.base_currency as Currency, jodToIlsRate: all.settings.jod_to_ils_rate }
            : prev.settings,
          units: all.units.map((u) => ({ id: u.id, name: u.name, kind: u.kind as UnitKind, rentAmount: u.rent_amount, rentCurrency: u.rent_currency as Currency })),
          tenants: all.tenants.map((t) => ({ id: t.id, name: t.name, phone: t.phone || undefined, unitId: t.unit_id, startDate: t.start_date, active: t.active })),
          utilities: all.utilities.map((u) => ({ id: u.id, unitId: u.unit_id, period: u.period, type: u.type as UtilityType, amount: u.amount, currency: u.currency as Currency })),
          invoices: all.invoices.map((i) => ({ id: i.id, unitId: i.unit_id, tenantId: i.tenant_id, period: i.period, scope: i.scope as "monthly" | "yearly", rentBase: i.rent_base, utilitiesBase: i.utilities_base, totalBase: i.total_base })),
          payments: all.payments.map((p) => ({ id: p.id, tenantId: p.tenant_id, unitId: p.unit_id, date: p.date, amount: p.amount, currency: p.currency as Currency, period: p.period || undefined, note: p.note || undefined })),
        }));
      } catch {
        try {
          const raw = localStorage.getItem("zc_data_v1");
          if (raw) setData({ ...DEFAULT_DATA, ...(JSON.parse(raw) as AppData) });
        } catch {}
      }
    })();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("zc_data_v1", JSON.stringify(data));
    } catch {}
  }, [data]);

  const unitsById = useMemo(() => {
    const m = new Map<string, Unit>();
    data.units.forEach((u) => m.set(u.id, u));
    return m;
  }, [data.units]);

  const tenantsByUnit = useMemo(() => {
    const m = new Map<string, Tenant[]>();
    data.tenants.forEach((t) => {
      const arr = m.get(t.unitId) || [];
      arr.push(t);
      m.set(t.unitId, arr);
    });
    return m;
  }, [data.tenants]);

  // Daily auto-update of exchange rate (once per 24h on first load)
  useEffect(() => {
    (async () => {
      const key = "zc_rate_last";
      try {
        const last = Number(localStorage.getItem(key) || "0");
        const now = Date.now();
        if (!last || now - last > 24 * 60 * 60 * 1000) {
          const rate = await fetchJodIlsRate();
          await dbUpsertSettings({ base_currency: data.settings.baseCurrency, jod_to_ils_rate: rate });
          setData((d) => ({ ...d, settings: { ...d.settings, jodToIlsRate: rate } }));
          localStorage.setItem(key, String(now));
        }
      } catch {}
    })();
  }, [data.settings.baseCurrency]);

  async function backupToSupabase() {
    setSyncMsg(null);
    setSyncing(true);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("backups").insert({ payload: data });
      if (error) throw error;
      setSyncMsg("تم النسخ الاحتياطي بنجاح إلى Supabase.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "فشل النسخ الاحتياطي. تحقق من الإعدادات.";
      setSyncMsg(message);
    } finally {
      setSyncing(false);
    }
  }

  async function restoreFromSupabase() {
    setSyncMsg(null);
    setSyncing(true);
    try {
      const supabase = getSupabaseClient();
      const { data: rows, error } = await supabase
        .from("backups")
        .select("payload, created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      if (!rows || rows.length === 0) throw new Error("لا توجد نسخة احتياطية.");
      const latest = rows[0].payload as AppData;
      setData({ ...DEFAULT_DATA, ...latest });
      setSyncMsg("تمت الاستعادة من أحدث نسخة بنجاح.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "فشلت عملية الاستعادة.";
      setSyncMsg(message);
    } finally {
      setSyncing(false);
    }
  }

  async function updateBaseCurrency(next: Currency) {
    setData((d) => ({ ...d, settings: { ...d.settings, baseCurrency: next } }));
    try {
      await dbUpsertSettings({ base_currency: next, jod_to_ils_rate: data.settings.jodToIlsRate });
    } catch (e) {
      // noop UI
    }
  }

  async function updateExchangeRate(next: number) {
    const rate = next || 0;
    setData((d) => ({ ...d, settings: { ...d.settings, jodToIlsRate: rate } }));
    try {
      await dbUpsertSettings({ base_currency: data.settings.baseCurrency, jod_to_ils_rate: rate });
    } catch (e) {
      // noop UI
    }
  }

  async function autoFetchRate() {
    setSyncMsg(null);
    setSyncing(true);
    try {
      const rate = await fetchJodIlsRate();
      await dbUpsertSettings({ base_currency: data.settings.baseCurrency, jod_to_ils_rate: rate });
      setData((d) => ({ ...d, settings: { ...d.settings, jodToIlsRate: rate } }));
      setSyncMsg("تم تحديث سعر الصرف تلقائياً.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "تعذر تحديث سعر الصرف.";
      setSyncMsg(message);
    } finally {
      setSyncing(false);
    }
  }

  async function signIn() {
    setAuthError(null);
    try {
      const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
      if (adminEmail && loginEmail.trim() !== adminEmail) {
        setAuthError("البريد غير مسموح");
        return;
      }
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPassword });
      if (error) throw error;
    } catch (e) {
      const message = e instanceof Error ? e.message : "فشل تسجيل الدخول";
      setAuthError(message);
    }
  }

  async function signOut() {
    try {
      const supabase = getSupabaseClient();
      await supabase.auth.signOut();
    } catch {}
  }

  return (
    <div dir="rtl" className="min-h-screen bg-white text-black dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-6xl p-4 sm:p-8">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold">نظام محاسبة المجمع</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-neutral-500">العملة الرئيسية: {data.settings.baseCurrency === "JOD" ? "دينار أردني" : "شيكل"}</span>
            {isAuthed ? (
              <button onClick={signOut} className="text-sm rounded-md border px-3 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-900">تسجيل الخروج</button>
            ) : null}
          </div>
        </header>

        {!isAuthed ? (
          <section className="max-w-md mx-auto p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
            <h2 className="font-medium mb-4">تسجيل الدخول</h2>
            <div className="space-y-3">
              <input
                placeholder="البريد الإلكتروني"
                className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
              />
              <input
                type="password"
                placeholder="كلمة المرور"
                className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
              <button onClick={signIn} className="w-full rounded-md bg-blue-600 text-white px-4 py-2">دخول</button>
              {authError && <div className="text-sm text-red-600">{authError}</div>}
              {process.env.NEXT_PUBLIC_ADMIN_EMAIL ? (
                <p className="text-xs text-neutral-500">البريد المسموح: {process.env.NEXT_PUBLIC_ADMIN_EMAIL}</p>
              ) : (
                <p className="text-xs text-neutral-500">لم يتم ضبط البريد المسموح. سيتم قبول أي بريد مسجّل في Supabase.</p>
              )}
            </div>
          </section>
        ) : (
          <>
            <nav className="flex flex-wrap gap-2 mb-6 tab-scroll">
              {[
                { key: "home", label: "الرئيسية" },
                { key: "settings", label: "الإعدادات" },
                { key: "units", label: "الوحدات" },
                { key: "tenants", label: "المستأجرون" },
                { key: "utilities", label: "المرافق" },
                { key: "invoices", label: "الفواتير" },
                { key: "payments", label: "المدفوعات" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key as TabKey)}
                  className={`btn ${
                    activeTab === t.key
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-transparent border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {activeTab === "home" && (
              <HomeTab data={data} settings={data.settings} />
            )}

            {activeTab === "settings" && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
                <h2 className="font-medium mb-3">العملة الرئيسية</h2>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="baseCurrency"
                      checked={data.settings.baseCurrency === "JOD"}
                      onChange={() => updateBaseCurrency("JOD")}
                    />
                    دينار أردني
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="baseCurrency"
                      checked={data.settings.baseCurrency === "ILS"}
                      onChange={() => updateBaseCurrency("ILS")}
                    />
                    شيكل
                  </label>
                </div>
              </div>

              <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
                <h2 className="font-medium mb-3">سعر الصرف</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm mb-1">1 دينار = كم شيكل؟</label>
                    <input
                      type="number"
                      step="0.0001"
                      className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white text-black px-3 py-2 select-light"
                      value={Number(data.settings.jodToIlsRate.toFixed(6))}
                      onChange={(e) => updateExchangeRate(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">1 شيكل ≈ كم دينار؟</label>
                    <input
                      type="text"
                      readOnly
                      className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white text-black px-3 py-2 select-light"
                      value={(1 / (data.settings.jodToIlsRate || 1)).toFixed(6)}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <button onClick={autoFetchRate} disabled={syncing} className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm disabled:opacity-60">
                    {syncing ? "جارٍ التحديث..." : "تحديث تلقائي"}
                  </button>
                  <span className="text-xs text-neutral-500">آخر قيمة: {data.settings.jodToIlsRate.toFixed(6)} شيكل/دينار</span>
                </div>
                <p className="text-xs text-neutral-500 mt-2">تؤثر على تحويل العملات في الإجماليات.</p>
              </div>

              <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
                <h2 className="font-medium mb-3">معلومة</h2>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">يمكنك تغيير العملة المعروضة وسعر الصرف في أي وقت.</p>
              </div>
            </div>
            <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
              <h2 className="font-medium mb-3">النسخ الاحتياطي والاستعادة (Supabase)</h2>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={backupToSupabase}
                  disabled={syncing}
                  className="rounded-md bg-emerald-600 text-white px-4 py-2 disabled:opacity-60"
                >
                  {syncing ? "جارٍ الحفظ..." : "نسخ احتياطي الآن"}
                </button>
                <button
                  onClick={restoreFromSupabase}
                  disabled={syncing}
                  className="rounded-md bg-amber-600 text-white px-4 py-2 disabled:opacity-60"
                >
                  {syncing ? "جارٍ الاستعادة..." : "استعادة أحدث نسخة"}
                </button>
                {syncMsg && <span className="text-sm text-neutral-600 dark:text-neutral-400">{syncMsg}</span>}
              </div>
              <p className="text-xs text-neutral-500 mt-2">قم بإضافة مفاتيح Supabase في ملف البيئة لتفعيل هذه الأزرار.</p>
            </div>
          </section>
        )}

        {activeTab === "units" && (
          <UnitsTab data={data} setData={setData} tenantsByUnit={tenantsByUnit} />
        )}

        {activeTab === "tenants" && (
          <TenantsTab data={data} setData={setData} unitsById={unitsById} />
        )}

        {activeTab === "utilities" && (
          <UtilitiesTab data={data} setData={setData} unitsById={unitsById} settings={data.settings} />
        )}

        {activeTab === "invoices" && (
          <InvoicesTab data={data} setData={setData} unitsById={unitsById} settings={data.settings} />
        )}

        {activeTab === "payments" && (
          <PaymentsTab data={data} setData={setData} unitsById={unitsById} settings={data.settings} />
        )}
          </>
        )}
      </div>
    </div>
  );
}

function HomeTab({ data, settings }: { data: AppData; settings: Settings }) {
  const cards = [
    { label: "عدد الوحدات", value: data.units.length },
    { label: "عدد المستأجرين", value: data.tenants.length },
    { label: "عدد الفواتير", value: data.invoices.length },
    { label: "عدد الدفعات", value: data.payments.length },
  ];
  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="text-sm text-neutral-500">{c.label}</div>
            <div className="text-2xl font-semibold mt-1">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
        <h2 className="font-medium mb-2">معلومات عامة</h2>
        <div className="text-sm text-neutral-600 dark:text-neutral-400">العملة الرئيسية: {settings.baseCurrency === "JOD" ? "دينار أردني" : "شيكل"}</div>
        <div className="text-sm text-neutral-600 dark:text-neutral-400">سعر الصرف الحالي: 1 دينار = {settings.jodToIlsRate} شيكل</div>
      </div>
    </section>
  );
}

function UnitsTab({
  data,
  setData,
  tenantsByUnit,
}: {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  tenantsByUnit: Map<string, Tenant[]>;
}) {
  const [form, setForm] = useState<{ name: string; kind: UnitKind; rentAmount: string; rentCurrency: Currency }>(
    { name: "", kind: "apartment", rentAmount: "", rentCurrency: "JOD" }
  );

  async function addUnit() {
    if (!form.name || !form.rentAmount) return;
    const unit: Unit = {
      id: uid("unit"),
      name: form.name.trim(),
      kind: form.kind,
      rentAmount: Number(form.rentAmount),
      rentCurrency: form.rentCurrency,
    };
    setData((d) => ({ ...d, units: [unit, ...d.units] }));
    try {
      await dbInsertUnit({ id: unit.id, name: unit.name, kind: unit.kind, rent_amount: unit.rentAmount, rent_currency: unit.rentCurrency });
    } catch {}
    setForm({ name: "", kind: "apartment", rentAmount: "", rentCurrency: "JOD" });
  }

  async function removeUnit(id: string) {
    setData((d) => ({
      ...d,
      units: d.units.filter((u) => u.id !== id),
      tenants: d.tenants.filter((t) => t.unitId !== id),
      utilities: d.utilities.filter((u) => u.unitId !== id),
      invoices: d.invoices.filter((i) => i.unitId !== id),
      payments: d.payments.filter((p) => p.unitId !== id),
    }));
    try { await dbDeleteUnit(id); } catch {}
  }

  return (
    <section className="space-y-6">
      <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
        <h2 className="font-medium mb-4">إضافة وحدة جديدة</h2>
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          <input
            placeholder="اسم الوحدة (مثال: شقة 3A)"
            className="sm:col-span-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <select
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as UnitKind }))}
          >
            <option value="apartment">شقة (أجار شهري)</option>
            <option value="shop">محل (أجار سنوي)</option>
          </select>
          <input
            type="number"
            placeholder="قيمة الأجار"
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.rentAmount}
            onChange={(e) => setForm((f) => ({ ...f, rentAmount: e.target.value }))}
          />
          <select
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white text-black px-3 py-2 select-light"
            value={form.rentCurrency}
            onChange={(e) => setForm((f) => ({ ...f, rentCurrency: e.target.value as Currency }))}
          >
            <option value="JOD">دينار</option>
            <option value="ILS">شيكل</option>
          </select>
          <button onClick={addUnit} className="rounded-md bg-blue-600 text-white px-4 py-2">حفظ</button>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="text-right border-b border-neutral-200 dark:border-neutral-800">
            <tr className="text-neutral-500">
              <th className="py-2">الاسم</th>
              <th className="py-2">النوع</th>
              <th className="py-2">الأجار</th>
              <th className="py-2">عدد المستأجرين</th>
              <th className="py-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {data.units.map((u) => (
              <tr key={u.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-2">{u.name}</td>
                <td className="py-2">{u.kind === "apartment" ? "شقة" : "محل"}</td>
                <td className="py-2">{u.rentAmount} {u.rentCurrency === "JOD" ? "دينار" : "شيكل"}</td>
                <td className="py-2">{(tenantsByUnit.get(u.id) || []).length}</td>
                <td className="py-2">
                  <button className="text-red-600 hover:underline" onClick={() => removeUnit(u.id)}>حذف</button>
                </td>
              </tr>
            ))}
            {data.units.length === 0 && (
              <tr>
                <td className="py-6 text-center text-neutral-500" colSpan={5}>لا توجد وحدات بعد</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TenantsTab({
  data,
  setData,
  unitsById,
}: {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  unitsById: Map<string, Unit>;
}) {
  const [form, setForm] = useState<{ name: string; phone: string; unitId: string; startDate: string; active: boolean }>(
    { name: "", phone: "", unitId: "", startDate: new Date().toISOString().slice(0, 10), active: true }
  );

  async function addTenant() {
    if (!form.name || !form.unitId) return;
    const tenant: Tenant = {
      id: uid("tenant"),
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      unitId: form.unitId,
      startDate: form.startDate,
      active: form.active,
    };
    setData((d) => ({ ...d, tenants: [tenant, ...d.tenants] }));
    try {
      await dbInsertTenant({ id: tenant.id, name: tenant.name, phone: tenant.phone || null, unit_id: tenant.unitId, start_date: tenant.startDate, active: tenant.active });
    } catch {}
    setForm({ name: "", phone: "", unitId: "", startDate: new Date().toISOString().slice(0, 10), active: true });
  }

  async function toggleActive(id: string) {
    setData((d) => ({
      ...d,
      tenants: d.tenants.map((t) => (t.id === id ? { ...t, active: !t.active } : t)),
    }));
    const next = !(data.tenants.find((t) => t.id === id)?.active ?? true);
    try { await dbToggleTenantActive(id, next); } catch {}
  }

  async function removeTenant(id: string) {
    setData((d) => ({
      ...d,
      tenants: d.tenants.filter((t) => t.id !== id),
      invoices: d.invoices.filter((i) => i.tenantId !== id),
      payments: d.payments.filter((p) => p.tenantId !== id),
    }));
    try { await dbDeleteTenant(id); } catch {}
  }

  return (
    <section className="space-y-6">
      <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
        <h2 className="font-medium mb-4">إضافة مستأجر</h2>
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          <input
            placeholder="الاسم"
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            placeholder="رقم الهاتف"
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <select
            className="sm:col-span-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.unitId}
            onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))}
          >
            <option value="">اختر الوحدة</option>
            {data.units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <input
            type="date"
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            نشط
          </label>
          <button onClick={addTenant} className="rounded-md bg-blue-600 text-white px-4 py-2">حفظ</button>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="text-right border-b border-neutral-200 dark:border-neutral-800">
            <tr className="text-neutral-500">
              <th className="py-2">الاسم</th>
              <th className="py-2">الوحدة</th>
              <th className="py-2">تاريخ البدء</th>
              <th className="py-2">الحالة</th>
              <th className="py-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {data.tenants.map((t) => (
              <tr key={t.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-2">{t.name}</td>
                <td className="py-2">{unitsById.get(t.unitId)?.name || "-"}</td>
                <td className="py-2">{t.startDate}</td>
                <td className="py-2">{t.active ? "نشط" : "متوقف"}</td>
                <td className="py-2 flex gap-3">
                  <button className="text-blue-600 hover:underline" onClick={() => toggleActive(t.id)}>{t.active ? "إيقاف" : "تنشيط"}</button>
                  <button className="text-red-600 hover:underline" onClick={() => removeTenant(t.id)}>حذف</button>
                </td>
              </tr>
            ))}
            {data.tenants.length === 0 && (
              <tr>
                <td className="py-6 text-center text-neutral-500" colSpan={5}>لا يوجد مستأجرون</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UtilitiesTab({
  data,
  setData,
  unitsById,
  settings,
}: {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  unitsById: Map<string, Unit>;
  settings: Settings;
}) {
  const [form, setForm] = useState<{ unitId: string; period: string; type: UtilityType; amount: string; currency: Currency }>(
    { unitId: "", period: new Date().toISOString().slice(0, 7), type: "water", amount: "", currency: "JOD" }
  );

  async function addUtility() {
    if (!form.unitId || !form.period || !form.amount) return;
    const u: UtilityCharge = {
      id: uid("util"),
      unitId: form.unitId,
      period: form.period,
      type: form.type,
      amount: Number(form.amount),
      currency: form.currency,
    };
    setData((d) => ({ ...d, utilities: [u, ...d.utilities] }));
    try { await dbInsertUtility({ id: u.id, unit_id: u.unitId, period: u.period, type: u.type, amount: u.amount, currency: u.currency }); } catch {}
    setForm({ unitId: "", period: new Date().toISOString().slice(0, 7), type: "water", amount: "", currency: form.currency });
  }

  async function removeUtility(id: string) {
    setData((d) => ({ ...d, utilities: d.utilities.filter((u) => u.id !== id) }));
    try { await dbDeleteUtility(id); } catch {}
  }

  return (
    <section className="space-y-6">
      <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
        <h2 className="font-medium mb-4">إضافة فاتورة مرافق</h2>
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          <select
            className="sm:col-span-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.unitId}
            onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))}
          >
            <option value="">اختر الوحدة</option>
            {Array.from(unitsById.values()).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <input
            type="month"
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.period}
            onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
          />
          <select
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white text-black px-3 py-2 select-light"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as UtilityType }))}
          >
            <option value="water">مياه</option>
            <option value="electricity">كهرباء</option>
          </select>
          <input
            type="number"
            placeholder="المبلغ"
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <select
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white text-black px-3 py-2 select-light"
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as Currency }))}
          >
            <option value="JOD">دينار</option>
            <option value="ILS">شيكل</option>
          </select>
          <button onClick={addUtility} className="rounded-md bg-blue-600 text-white px-4 py-2">حفظ</button>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="text-right border-b border-neutral-200 dark:border-neutral-800">
            <tr className="text-neutral-500">
              <th className="py-2">الوحدة</th>
              <th className="py-2">الفترة</th>
              <th className="py-2">النوع</th>
              <th className="py-2">المبلغ</th>
              <th className="py-2">بالعملة الرئيسية</th>
              <th className="py-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {data.utilities.map((u) => {
              const unit = unitsById.get(u.unitId);
              const base = convertToBase(u.amount, u.currency, settings);
              return (
                <tr key={u.id} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className="py-2">{unit?.name || "-"}</td>
                  <td className="py-2">{u.period}</td>
                  <td className="py-2">{u.type === "water" ? "مياه" : "كهرباء"}</td>
                  <td className="py-2">{u.amount} {u.currency === "JOD" ? "دينار" : "شيكل"}</td>
                  <td className="py-2">{formatCurrency(base, settings)}</td>
                  <td className="py-2"><button className="text-red-600 hover:underline" onClick={() => removeUtility(u.id)}>حذف</button></td>
                </tr>
              );
            })}
            {data.utilities.length === 0 && (
              <tr>
                <td className="py-6 text-center text-neutral-500" colSpan={6}>لا توجد بيانات مرافق</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InvoicesTab({
  data,
  setData,
  unitsById,
  settings,
}: {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  unitsById: Map<string, Unit>;
  settings: Settings;
}) {
  const [scope, setScope] = useState<"monthly" | "yearly">("monthly");
  const [period, setPeriod] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [tenantFilter, setTenantFilter] = useState<string>("");

  function eligibleTenants() {
    const list = data.tenants.filter((t) => t.active);
    const filtered = list.filter((t) => {
      const unit = unitsById.get(t.unitId);
      if (!unit) return false;
      if (scope === "monthly" && unit.kind !== "apartment") return false;
      if (scope === "yearly" && unit.kind !== "shop") return false;
      return true;
    });
    if (tenantFilter) return filtered.filter((t) => t.id === tenantFilter);
    return filtered;
  }

  function sumUtilitiesBase(unitId: string, periodStr: string, scopeSel: "monthly" | "yearly") {
    const periodFilter = (u: UtilityCharge) => {
      if (scopeSel === "monthly") return u.period === periodStr;
      // yearly: match year
      const year = periodStr.slice(0, 4);
      return u.period.startsWith(year);
    };
    return data.utilities
      .filter((u) => u.unitId === unitId)
      .filter(periodFilter)
      .reduce((acc, u) => acc + convertToBase(u.amount, u.currency, settings), 0);
  }

  async function generateInvoices() {
    const tenants = eligibleTenants();
    const scopePeriod = scope === "monthly" ? period : period.slice(0, 4);
    const newInvoices: Invoice[] = tenants.map((t) => {
      const unit = unitsById.get(t.unitId)!;
      const rentBase = convertToBase(unit.rentAmount, unit.rentCurrency, settings) * (scope === "yearly" ? 1 : 1);
      const utilitiesBase = sumUtilitiesBase(unit.id, period, scope);
      const totalBase = rentBase + utilitiesBase;
      return {
        id: uid("inv"),
        unitId: unit.id,
        tenantId: t.id,
        period: scopePeriod,
        scope,
        rentBase,
        utilitiesBase,
        totalBase,
      };
    });
    setData((d) => ({ ...d, invoices: [...newInvoices, ...d.invoices] }));
    try {
      await Promise.all(newInvoices.map((i) => dbInsertInvoice({ id: i.id, unit_id: i.unitId, tenant_id: i.tenantId, period: i.period, scope: i.scope, rent_base: i.rentBase, utilities_base: i.utilitiesBase, total_base: i.totalBase })));
    } catch {}
  }

  async function removeInvoice(id: string) {
    setData((d) => ({ ...d, invoices: d.invoices.filter((i) => i.id !== id) }));
    try { await dbDeleteInvoice(id); } catch {}
  }

  return (
    <section className="space-y-6">
      <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
        <h2 className="font-medium mb-4">إنشاء فواتير</h2>
        <div className="grid grid-cols-1 sm:grid-cols-7 gap-3">
          <select
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={scope}
            onChange={(e) => setScope(e.target.value as "monthly" | "yearly")}
          >
            <option value="monthly">شهري (الشقق)</option>
            <option value="yearly">سنوي (المحلات)</option>
          </select>
          {scope === "monthly" ? (
            <input
              type="month"
              className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          ) : (
            <input
              type="number"
              min={2000}
              className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
              value={period.slice(0, 4)}
              onChange={(e) => setPeriod(`${e.target.value}-01`)}
            />
          )}
          <select
            className="sm:col-span-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white text-black px-3 py-2 select-light"
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
          >
            <option value="">كل المستأجرين</option>
            {data.tenants
              .filter((t) => t.active)
              .filter((t) => {
                const u = unitsById.get(t.unitId);
                if (!u) return false;
                return scope === "monthly" ? u.kind === "apartment" : u.kind === "shop";
              })
              .map((t) => {
                const u = unitsById.get(t.unitId);
                return (
                  <option key={t.id} value={t.id}>{t.name} — {u?.name}</option>
                );
              })}
          </select>
          <button onClick={generateInvoices} className="rounded-md bg-blue-600 text-white px-4 py-2">توليد</button>
        </div>
        <p className="text-xs text-neutral-500 mt-2">تُحسب القيم بالعملة الرئيسية باستخدام سعر الصرف الحالي.</p>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="text-right border-b border-neutral-200 dark:border-neutral-800">
            <tr className="text-neutral-500">
              <th className="py-2">الفترة</th>
              <th className="py-2">المستأجر</th>
              <th className="py-2">الوحدة</th>
              <th className="py-2">الأجار</th>
              <th className="py-2">المرافق</th>
              <th className="py-2">الإجمالي</th>
              <th className="py-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.map((inv) => {
              const unit = unitsById.get(inv.unitId);
              const tenant = data.tenants.find((t) => t.id === inv.tenantId);
              return (
                <tr key={inv.id} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className="py-2">{inv.scope === "monthly" ? inv.period : `سنة ${inv.period}`}</td>
                  <td className="py-2">{tenant?.name || "-"}</td>
                  <td className="py-2">{unit?.name || "-"}</td>
                  <td className="py-2">{formatCurrency(inv.rentBase, settings)}</td>
                  <td className="py-2">{formatCurrency(inv.utilitiesBase, settings)}</td>
                  <td className="py-2 font-medium">{formatCurrency(inv.totalBase, settings)}</td>
                  <td className="py-2"><button className="text-red-600 hover:underline" onClick={() => removeInvoice(inv.id)}>حذف</button></td>
                </tr>
              );
            })}
            {data.invoices.length === 0 && (
              <tr>
                <td className="py-6 text-center text-neutral-500" colSpan={7}>لا توجد فواتير بعد</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PaymentsTab({
  data,
  setData,
  unitsById,
  settings,
}: {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  unitsById: Map<string, Unit>;
  settings: Settings;
}) {
  const [form, setForm] = useState<{ tenantId: string; date: string; amount: string; currency: Currency; period: string; note: string }>(
    { tenantId: "", date: new Date().toISOString().slice(0, 10), amount: "", currency: "JOD", period: new Date().toISOString().slice(0, 7), note: "" }
  );

  async function addPayment() {
    if (!form.tenantId || !form.amount) return;
    const tenant = data.tenants.find((t) => t.id === form.tenantId);
    if (!tenant) return;
    const payment: Payment = {
      id: uid("pay"),
      tenantId: form.tenantId,
      unitId: tenant.unitId,
      date: form.date,
      amount: Number(form.amount),
      currency: form.currency,
      period: form.period,
      note: form.note.trim() || undefined,
    };
    setData((d) => ({ ...d, payments: [payment, ...d.payments] }));
    try { await dbInsertPayment({ id: payment.id, tenant_id: payment.tenantId, unit_id: payment.unitId, date: payment.date, amount: payment.amount, currency: payment.currency, period: payment.period || null, note: payment.note || null }); } catch {}
    setForm({ tenantId: "", date: new Date().toISOString().slice(0, 10), amount: "", currency: form.currency, period: new Date().toISOString().slice(0, 7), note: "" });
  }

  async function removePayment(id: string) {
    setData((d) => ({ ...d, payments: d.payments.filter((p) => p.id !== id) }));
    try { await dbDeletePayment(id); } catch {}
  }

  return (
    <section className="space-y-6">
      <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
        <h2 className="font-medium mb-4">إضافة دفعة</h2>
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          <select
            className="sm:col-span-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white text-black px-3 py-2 select-light"
            value={form.tenantId}
            onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value }))}
          >
            <option value="">اختر المستأجر</option>
            {data.tenants.map((t) => {
              const unit = unitsById.get(t.unitId);
              return (
                <option key={t.id} value={t.id}>{t.name} — {unit?.name}</option>
              );
            })}
          </select>
          <input
            type="date"
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
          <input
            type="number"
            placeholder="المبلغ"
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <select
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as Currency }))}
          >
            <option value="JOD">دينار</option>
            <option value="ILS">شيكل</option>
          </select>
          <input
            type="month"
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.period}
            onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
          />
          <input
            placeholder="ملاحظة (اختياري)"
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
          <button onClick={addPayment} className="rounded-md bg-blue-600 text-white px-4 py-2">حفظ</button>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="text-right border-b border-neutral-200 dark:border-neutral-800">
            <tr className="text-neutral-500">
              <th className="py-2">التاريخ</th>
              <th className="py-2">المستأجر</th>
              <th className="py-2">الفترة</th>
              <th className="py-2">المبلغ</th>
              <th className="py-2">بالعملة الرئيسية</th>
              <th className="py-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {data.payments.map((p) => {
              const tenant = data.tenants.find((t) => t.id === p.tenantId);
              const unit = tenant ? unitsById.get(tenant.unitId) : undefined;
              const base = convertToBase(p.amount, p.currency, settings);
              return (
                <tr key={p.id} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className="py-2">{p.date}</td>
                  <td className="py-2">{tenant ? `${tenant.name} — ${unit?.name}` : "-"}</td>
                  <td className="py-2">{p.period || "-"}</td>
                  <td className="py-2">{p.amount} {p.currency === "JOD" ? "دينار" : "شيكل"}</td>
                  <td className="py-2">{formatCurrency(base, settings)}</td>
                  <td className="py-2"><button className="text-red-600 hover:underline" onClick={() => removePayment(p.id)}>حذف</button></td>
                </tr>
              );
            })}
            {data.payments.length === 0 && (
              <tr>
                <td className="py-6 text-center text-neutral-500" colSpan={6}>لا توجد مدفوعات</td>
              </tr>
            )}
          </tbody>
        </table>
    </div>
    </section>
  );
}


