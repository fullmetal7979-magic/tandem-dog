import type { DesktopSessionSummary } from '../shared/contract';

export function collapseModelContinuations(rows: DesktopSessionSummary[], selectedId = ''): DesktopSessionSummary[] {
  const latest = new Map<string, DesktopSessionSummary>();
  for (const row of rows) {
    if (row.archived) continue;
    const task = row.taskId || row.id;
    const prior = latest.get(task);
    if (!prior || row.id === selectedId || (prior.id !== selectedId && (row.activityAt || row.updatedAt) > (prior.activityAt || prior.updatedAt))) latest.set(task, row);
  }
  return rows.filter(row => row.archived || row.working || row.leadWorking || row.agentWorking || latest.get(row.taskId || row.id)?.id === row.id);
}
