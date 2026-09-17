export type Proposal = {
  id: string;
  kind: "master_reversal";
  title: string;
  reason: string;
  evidenceIds: string[];
  status:
    | "pending"
    | "rejected"
    | "executing"
    | "done"
    | "uncertain"
    | "obsolete";
  createdAt: string;
  error?: string;
  masterEventId?: string;
  fileId?: string;
  fileName?: string;
  tab?: string;
  round?: number;
  invalidHash?: string;
  sourceVersion?: string;
};
