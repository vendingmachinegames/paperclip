import type {
  Company,
  CompanyPortabilityExportRequest,
  CompanyPortabilityExportPreviewResult,
  CompanyPortabilityExportResult,
  CompanyPortabilityImportRequest,
  CompanyPortabilityImportResult,
  CompanyPortabilityPreviewRequest,
  CompanyPortabilityPreviewResult,
  Issue,
  UpdateCompanyBranding,
} from "@paperclipai/shared";
import { api } from "./client";

export type CompanyStats = Record<string, { agentCount: number; issueCount: number }>;

export interface BoardroomCard {
  id: string;
  companyId: string;
  issueId: string;
  commentId: string;
  createdByAgentId: string | null;
  kind: string;
  state: "pending" | "accepted" | "rejected";
  payload: Record<string, unknown>;
  resultPayload: Record<string, unknown> | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const companiesApi = {
  list: () => api.get<Company[]>("/companies"),
  get: (companyId: string) => api.get<Company>(`/companies/${companyId}`),
  stats: () => api.get<CompanyStats>("/companies/stats"),
  create: (data: {
    name: string;
    description?: string | null;
    budgetMonthlyCents?: number;
  }) =>
    api.post<Company>("/companies", data),
  createDraft: (data?: { name?: string }) =>
    api.post<Company>("/companies/draft", data ?? {}),
  getBySlug: (slug: string) =>
    api.get<{ company: Company; redirectedFromSlug: string | null }>(
      `/companies/by-slug/${encodeURIComponent(slug)}`,
    ),
  getBoardroom: (companyId: string) =>
    api.get<{ boardroom: Issue }>(`/companies/${companyId}/boardroom`),
  listBoardroomCards: (companyId: string) =>
    api.get<{ cards: BoardroomCard[] }>(`/companies/${companyId}/boardroom/cards`),
  acceptBoardroomCard: (companyId: string, cardId: string) =>
    api.post<{ card: BoardroomCard }>(
      `/companies/${companyId}/boardroom/cards/${cardId}/accept`,
      {},
    ),
  rejectBoardroomCard: (companyId: string, cardId: string) =>
    api.post<{ card: BoardroomCard }>(
      `/companies/${companyId}/boardroom/cards/${cardId}/reject`,
      {},
    ),
  update: (
    companyId: string,
    data: Partial<
      Pick<
        Company,
        | "name"
        | "description"
        | "status"
        | "budgetMonthlyCents"
        | "requireBoardApprovalForNewAgents"
        | "feedbackDataSharingEnabled"
        | "brandColor"
        | "logoAssetId"
      >
    >,
  ) => api.patch<Company>(`/companies/${companyId}`, data),
  updateBranding: (companyId: string, data: UpdateCompanyBranding) =>
    api.patch<Company>(`/companies/${companyId}/branding`, data),
  archive: (companyId: string) => api.post<Company>(`/companies/${companyId}/archive`, {}),
  remove: (companyId: string) => api.delete<{ ok: true }>(`/companies/${companyId}`),
  exportBundle: (
    companyId: string,
    data: CompanyPortabilityExportRequest,
  ) =>
    api.post<CompanyPortabilityExportResult>(`/companies/${companyId}/export`, data),
  exportPreview: (
    companyId: string,
    data: CompanyPortabilityExportRequest,
  ) =>
    api.post<CompanyPortabilityExportPreviewResult>(`/companies/${companyId}/exports/preview`, data),
  exportPackage: (
    companyId: string,
    data: CompanyPortabilityExportRequest,
  ) =>
    api.post<CompanyPortabilityExportResult>(`/companies/${companyId}/exports`, data),
  importPreview: (data: CompanyPortabilityPreviewRequest) =>
    api.post<CompanyPortabilityPreviewResult>("/companies/import/preview", data),
  importBundle: (data: CompanyPortabilityImportRequest) =>
    api.post<CompanyPortabilityImportResult>("/companies/import", data),
};
