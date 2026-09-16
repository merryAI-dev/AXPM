export type Evidence = { id: string; source: string; sheet: string; cell: string; detail: string };
export type Company = {
  id: string; name: string; email: string; campus: string; mentor: string; category: string;
  active: boolean; regular: number; specialty: boolean; specialtyCount: number; requested: boolean; assigned: boolean;
  rounds: { round: number; complete: boolean; report: string; evidenceId: string }[];
  specialtyReport: string; evidenceId: string;
};
export type Appointment = {
  id: string; company: string; companyId: string | null; mentor: string;
  date: string; time: string; status: 'scheduled' | 'review' | 'completed' | 'cancelled';
  evidenceId: string; note: string; kind: 'dedicated' | 'specialty';
};
export type Finding = { id: string; severity: 'high' | 'medium' | 'info'; title: string; companyId: string | null; evidenceIds: string[]; detail: string };
export type Snapshot = {
  id: string; importedAt: string; companies: Company[]; appointments: Appointment[];
  evidence: Evidence[]; findings: Finding[]; sources: { role: string; name: string; sha256: string; sheets: number }[];
  policy: { targetPerCompany: number; targetBasis: string; excludedCategories: string[] };
};
export type Settings = { gmailQuery: string; monitoringEnabled: boolean; targetPerCompany: number };
export type Proposal = {
  id: string; kind: 'email' | 'calendar' | 'ticket'; title: string; reason: string; evidenceIds: string[];
  companyId: string; to: string; subject: string; body: string; start: string; end: string;
  status: 'pending' | 'rejected' | 'executing' | 'done' | 'uncertain'; createdAt: string;
  externalId?: string; error?: string;
  ticketKind?: 'dedicated' | 'specialty'; ticketDelta?: number; hoursDelta?: number;
  ticketMode?: 'set' | 'adjust'; snapshotId?: string; ticketRevision?: number;
};
