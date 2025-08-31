import { getSupabaseClient } from "./supabaseClient";

export type DbCurrency = "JOD" | "ILS";
export type DbUnitKind = "apartment" | "shop";

async function getCurrentUserId(): Promise<string> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error("غير مسجل دخول");
  return data.user.id;
}

export async function dbUpsertSettings(settings: { base_currency: DbCurrency; jod_to_ils_rate: number }) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("settings").upsert({
    owner_id: ownerId,
    base_currency: settings.base_currency,
    jod_to_ils_rate: settings.jod_to_ils_rate,
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_id" });
  if (error) throw error;
}

export async function dbFetchSettings() {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { data, error } = await supabase.from("settings").select("base_currency, jod_to_ils_rate").eq("owner_id", ownerId).maybeSingle();
  if (error) throw error;
  return data as { base_currency: DbCurrency; jod_to_ils_rate: number } | null;
}

export async function dbInsertUnit(unit: { id: string; name: string; kind: DbUnitKind; rent_amount: number; rent_currency: DbCurrency }) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("units").insert({ ...unit, owner_id: ownerId });
  if (error) throw error;
}

export async function dbDeleteUnit(id: string) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("units").delete().eq("id", id).eq("owner_id", ownerId);
  if (error) throw error;
}

export async function dbInsertTenant(tenant: { id: string; name: string; phone: string | null; unit_id: string; start_date: string; active: boolean }) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("tenants").insert({ ...tenant, owner_id: ownerId });
  if (error) throw error;
}

export async function dbToggleTenantActive(id: string, active: boolean) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("tenants").update({ active }).eq("id", id).eq("owner_id", ownerId);
  if (error) throw error;
}

export async function dbDeleteTenant(id: string) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("tenants").delete().eq("id", id).eq("owner_id", ownerId);
  if (error) throw error;
}

export async function dbInsertUtility(util: { id: string; unit_id: string; period: string; type: "water" | "electricity"; amount: number; currency: DbCurrency }) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("utilities").insert({ ...util, owner_id: ownerId });
  if (error) throw error;
}

export async function dbDeleteUtility(id: string) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("utilities").delete().eq("id", id).eq("owner_id", ownerId);
  if (error) throw error;
}

export async function dbInsertInvoice(inv: { id: string; unit_id: string; tenant_id: string; period: string; scope: "monthly" | "yearly"; rent_base: number; utilities_base: number; total_base: number }) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("invoices").insert({ ...inv, owner_id: ownerId });
  if (error) throw error;
}

export async function dbDeleteInvoice(id: string) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("invoices").delete().eq("id", id).eq("owner_id", ownerId);
  if (error) throw error;
}

export async function dbInsertPayment(pay: { id: string; tenant_id: string; unit_id: string; date: string; amount: number; currency: DbCurrency; period: string | null; note: string | null }) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("payments").insert({ ...pay, owner_id: ownerId });
  if (error) throw error;
}

export async function dbDeletePayment(id: string) {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId();
  const { error } = await supabase.from("payments").delete().eq("id", id).eq("owner_id", ownerId);
  if (error) throw error;
}

export type FetchAllResult = {
  settings: { base_currency: DbCurrency; jod_to_ils_rate: number } | null;
  units: Array<{ id: string; name: string; kind: DbUnitKind; rent_amount: number; rent_currency: DbCurrency }>;
  tenants: Array<{ id: string; name: string; phone: string | null; unit_id: string; start_date: string; active: boolean }>;
  utilities: Array<{ id: string; unit_id: string; period: string; type: "water" | "electricity"; amount: number; currency: DbCurrency }>;
  invoices: Array<{ id: string; unit_id: string; tenant_id: string; period: string; scope: "monthly" | "yearly"; rent_base: number; utilities_base: number; total_base: number }>;
  payments: Array<{ id: string; tenant_id: string; unit_id: string; date: string; amount: number; currency: DbCurrency; period: string | null; note: string | null }>;
};

export async function dbFetchAll(): Promise<FetchAllResult> {
  const supabase = getSupabaseClient();
  const ownerId = await getCurrentUserId().catch(() => null);
  if (!ownerId) {
    return { settings: null, units: [], tenants: [], utilities: [], invoices: [], payments: [] };
  }
  const [settings, units, tenants, utilities, invoices, payments] = await Promise.all([
    supabase.from("settings").select("base_currency, jod_to_ils_rate").eq("owner_id", ownerId).maybeSingle(),
    supabase.from("units").select("id, name, kind, rent_amount, rent_currency").eq("owner_id", ownerId).order("name"),
    supabase.from("tenants").select("id, name, phone, unit_id, start_date, active").eq("owner_id", ownerId).order("name"),
    supabase.from("utilities").select("id, unit_id, period, type, amount, currency").eq("owner_id", ownerId).order("period", { ascending: false }),
    supabase.from("invoices").select("id, unit_id, tenant_id, period, scope, rent_base, utilities_base, total_base").eq("owner_id", ownerId).order("period", { ascending: false }),
    supabase.from("payments").select("id, tenant_id, unit_id, date, amount, currency, period, note").eq("owner_id", ownerId).order("date", { ascending: false }),
  ]);

  if (settings.error) throw settings.error;
  if (units.error) throw units.error;
  if (tenants.error) throw tenants.error;
  if (utilities.error) throw utilities.error;
  if (invoices.error) throw invoices.error;
  if (payments.error) throw payments.error;

  return {
    settings: settings.data as { base_currency: DbCurrency; jod_to_ils_rate: number } | null,
    units: (units.data || []) as Array<{ id: string; name: string; kind: DbUnitKind; rent_amount: number; rent_currency: DbCurrency }>,
    tenants: (tenants.data || []) as Array<{ id: string; name: string; phone: string | null; unit_id: string; start_date: string; active: boolean }>,
    utilities: (utilities.data || []) as Array<{ id: string; unit_id: string; period: string; type: "water" | "electricity"; amount: number; currency: DbCurrency }>,
    invoices: (invoices.data || []) as Array<{ id: string; unit_id: string; tenant_id: string; period: string; scope: "monthly" | "yearly"; rent_base: number; utilities_base: number; total_base: number }>,
    payments: (payments.data || []) as Array<{ id: string; tenant_id: string; unit_id: string; date: string; amount: number; currency: DbCurrency; period: string | null; note: string | null }>,
  };
}

export async function fetchJodIlsRate(): Promise<number> {
  const apiKey = process.env.NEXT_PUBLIC_CURRENCYAPI_KEY;
  if (!apiKey) throw new Error("مفقود مفتاح currencyapi. أضف NEXT_PUBLIC_CURRENCYAPI_KEY");
  const url = `https://api.currencyapi.com/v3/latest?base_currency=JOD&currencies=ILS&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("فشل جلب سعر الصرف من currencyapi");
  const json = await res.json();
  const rate = json?.data?.ILS?.value;
  if (typeof rate !== "number") throw new Error("بيانات غير صالحة لسعر الصرف");
  return rate;
}


