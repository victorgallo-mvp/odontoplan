import type { ClinicorpClient } from "./ClinicorpClient.js";
import type {
  ClinicorpAppointment,
  ClinicorpClinic,
  ClinicorpDentist,
  ClinicorpEstimate,
  ClinicorpPatient,
  ClinicorpPayment,
  ClinicorpProcedure,
  DateRange,
} from "./types.js";
import {
  dedupeEstimates,
  mapAppointment,
  mapClinic,
  mapDentist,
  mapEstimate,
  mapPayment,
  patientsFrom,
  proceduresFromEstimates,
  type RawAppointment,
  type RawBusiness,
  type RawEstimate,
  type RawPayment,
  type RawProfessional,
  type RawStatus,
  type StatusTypeById,
} from "./mapping.js";

export interface ClinicorpCredentials {
  apiUser: string; // "Usuário API" (Gerenciar Assinatura → Acesso Externo e Integrações)
  apiToken: string; // "Token API"
  subscriberId?: string; // id do assinante (query `subscriber_id`); default = apiUser
  baseUrl?: string; // default https://api.clinicorp.com/rest/v1
  tzOffset?: string; // fuso da clínica p/ horários da agenda; default -03:00
  businessId?: string; // filtra uma unidade quando a conta tem várias
}

export class ClinicorpHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(
      status === 429
        ? `Clinicorp ${path}: limite de requisições atingido (padrão 25/hora). Aguarde e tente de novo.`
        : status === 401 || status === 403
          ? `Clinicorp ${path}: credenciais recusadas (HTTP ${status}). Confira CLINICORP_API_USER / CLINICORP_API_TOKEN.`
          : `Clinicorp ${path}: HTTP ${status} ${body.slice(0, 200)}`,
    );
  }
}

const DAY = 86_400_000;
const MAX_WINDOW_DAYS = 31; // limite do /estimates/list
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Client HTTP da API REST do Clinicorp.
 *
 * A API é limitada (25 req/hora por padrão) e não tem endpoints de "listar
 * pacientes" nem preços no catálogo. Por isso o client baixa cada recurso do
 * período UMA vez e guarda em memória; pacientes e procedimentos são derivados
 * desse cache (ver ./mapping.ts). Um client = um sync; não reutilize entre syncs.
 *
 * Chamadas por sync de até 31 dias: professionals 1, status_list 1,
 * estimates 1, appointments 1, payments 2 (recebidos + lançados), business 1.
 */
export class RealClinicorpClient implements ClinicorpClient {
  readonly source = "clinicorp" as const;
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly subscriberId: string;
  private readonly tzOffset: string;
  private readonly businessId?: string;
  private readonly cache = new Map<string, Promise<unknown>>();
  requestCount = 0;

  constructor(creds: ClinicorpCredentials) {
    this.baseUrl = (creds.baseUrl ?? "https://api.clinicorp.com/rest/v1").replace(/\/$/, "");
    this.authHeader = "Basic " + Buffer.from(`${creds.apiUser}:${creds.apiToken}`).toString("base64");
    this.subscriberId = creds.subscriberId ?? creds.apiUser;
    this.tzOffset = creds.tzOffset ?? "-03:00";
    this.businessId = creds.businessId;
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  protected async get<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    url.searchParams.set("subscriber_id", this.subscriberId);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
    this.requestCount++;
    const res = await fetch(url, { headers: { Authorization: this.authHeader, Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) throw new ClinicorpHttpError(res.status, path, text);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Clinicorp ${path}: resposta não é JSON (${text.slice(0, 120)})`);
    }
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    let p = this.cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load();
      this.cache.set(key, p);
      p.catch(() => this.cache.delete(key)); // erro não fica cacheado
    }
    return p;
  }

  /** Quebra o período em janelas de ≤31 dias (inclusive nas duas pontas). */
  static windows(range: DateRange): { from: string; to: string }[] {
    const out: { from: string; to: string }[] = [];
    let start = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate()));
    const end = new Date(Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth(), range.to.getUTCDate()));
    while (start <= end) {
      const stop = new Date(Math.min(start.getTime() + (MAX_WINDOW_DAYS - 1) * DAY, end.getTime()));
      out.push({ from: ymd(start), to: ymd(stop) });
      start = new Date(stop.getTime() + DAY);
    }
    return out;
  }

  private async windowed<T>(path: string, range: DateRange, extra: Record<string, string | undefined> = {}): Promise<T[]> {
    const parts = await Promise.all(RealClinicorpClient.windows(range).map((w) => this.get<T[] | { list?: T[] }>(path, { from: w.from, to: w.to, ...extra })));
    return parts.flatMap((p) => (Array.isArray(p) ? p : (p?.list ?? [])));
  }

  // ── Recursos brutos (cacheados) ────────────────────────────────────────────

  private rawBusinesses() {
    return this.cached("business", () => this.get<RawBusiness[]>("/business/list"));
  }

  private rawProfessionals() {
    return this.cached("professionals", () => this.get<RawProfessional[]>("/professional/list_all_professionals"));
  }

  private rawStatusTypes(): Promise<StatusTypeById> {
    return this.cached("status", async () => {
      const r = await this.get<{ list?: RawStatus[] } | RawStatus[]>("/appointment/status_list");
      const list = Array.isArray(r) ? r : (r.list ?? []);
      return new Map(list.map((s) => [String(s.id), s.Type]));
    });
  }

  private rawEstimates(range: DateRange) {
    return this.cached(`estimates:${ymd(range.from)}:${ymd(range.to)}`, async () => {
      const rows = await this.windowed<RawEstimate>("/estimates/list", range, { clinic_id: this.businessId });
      return dedupeEstimates(rows.filter((e) => !this.businessId || String(e.BusinessId) === this.businessId));
    });
  }

  private rawAppointments(range: DateRange) {
    return this.cached(`appointments:${ymd(range.from)}:${ymd(range.to)}`, async () => {
      const rows = await this.windowed<RawAppointment>("/appointment/list", range, { includeCanceled: "X", businessId: this.businessId });
      return rows.filter((a) => !this.businessId || String(a.Clinic_BusinessId) === this.businessId);
    });
  }

  private rawPayments(range: DateRange) {
    return this.cached(`payments:${ymd(range.from)}:${ymd(range.to)}`, async () => {
      // Padrão filtra por data de recebimento (parcelas pagas no período);
      // postDate traz as parcelas lançadas no período (inclui pendentes/atrasadas).
      const [received, posted] = await Promise.all([
        this.windowed<RawPayment>("/payment/list", range),
        this.windowed<RawPayment>("/payment/list", range, { date_type: "postDate" }),
      ]);
      const byId = new Map<number, RawPayment>();
      for (const p of [...posted, ...received]) byId.set(p.id, p); // recebido sobrescreve lançado
      return [...byId.values()];
    });
  }

  // ── ClinicorpClient ────────────────────────────────────────────────────────

  async getClinic(): Promise<ClinicorpClinic | null> {
    const list = await this.rawBusinesses();
    const b = this.businessId ? list.find((x) => String(x.id) === this.businessId) : list[0];
    return b ? mapClinic(b) : null;
  }

  async listClinics(): Promise<ClinicorpClinic[]> {
    return (await this.rawBusinesses()).map(mapClinic);
  }

  async listDentists(): Promise<ClinicorpDentist[]> {
    return (await this.rawProfessionals()).map(mapDentist);
  }

  async listProcedures(range: DateRange): Promise<ClinicorpProcedure[]> {
    return proceduresFromEstimates(await this.rawEstimates(range));
  }

  async listPatients(range: DateRange): Promise<ClinicorpPatient[]> {
    const [estimates, appointments, payments] = await Promise.all([this.rawEstimates(range), this.rawAppointments(range), this.rawPayments(range)]);
    return patientsFrom({ estimates, appointments, payments });
  }

  async listAppointments(range: DateRange): Promise<ClinicorpAppointment[]> {
    const [rows, statusTypes] = await Promise.all([this.rawAppointments(range), this.rawStatusTypes()]);
    const now = new Date();
    return rows.map((a) => mapAppointment(a, { tzOffset: this.tzOffset, statusTypes, now })).filter((a): a is ClinicorpAppointment => !!a);
  }

  async listEstimates(range: DateRange): Promise<ClinicorpEstimate[]> {
    return (await this.rawEstimates(range)).map(mapEstimate).filter((e): e is ClinicorpEstimate => !!e);
  }

  async listPayments(range: DateRange): Promise<ClinicorpPayment[]> {
    const now = new Date();
    return (await this.rawPayments(range)).map((p) => mapPayment(p, now)).filter((p): p is ClinicorpPayment => !!p);
  }
}
