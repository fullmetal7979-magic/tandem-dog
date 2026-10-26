export interface WorkbenchLimit { maxTokens?: number; maxCostUsd?: number; maxRequests?: number }
export interface WorkbenchContextRules { include: string[]; exclude: string[]; instructions: string }
export interface WorkbenchRequest {
  action: 'read'|'usage'|'save-policy'|'create-snapshot'|'preview-snapshot'|'restore-snapshot'|'delete-snapshot'|'save-claim'|'release-claim'|'acknowledge-usage';
  projectPath?: string;
  sessionId?: string;
  id?: string;
  label?: string;
  owner?: string;
  paths?: string[];
  note?: string;
  validation?: string[];
  policy?: { dailyLimit: WorkbenchLimit; projectLimit: WorkbenchLimit; context: WorkbenchContextRules };
}
export interface WorkbenchResult extends Record<string, unknown> {
  restored?: { path: string; sessionId?: string; warning?: string };
}
export interface DesktopWorkbenchApi { workbench?(request: WorkbenchRequest): Promise<WorkbenchResult> }
