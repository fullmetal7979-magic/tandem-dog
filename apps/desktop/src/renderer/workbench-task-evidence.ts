import { record } from './record-utils';
export type TaskEvidence = { label: string; status: 'passed'|'failed'|'unknown'; id: string };
export function taskEvidence(items: readonly unknown[]): TaskEvidence[] {
  return items.flatMap((raw,index)=>{
    const row=record(raw), args=record(row.args), result=record(row.result);
    const command=String(args.command||args.cmd||row.command||'');
    if(!/\b(test|pytest|vitest|jest|tsc|typecheck|build)\b/.test(command))return [];
    const rawResult=record(row.rawResult);
    const header=String(row.rawResult??row.result??'').split('\n').slice(0,6).join('\n');
    const marker=/^\s*(?:\[session:[^\n]*\]\s*\n)?(?:Error:\s*)?(?:\[shell-run-failed\]\s*)?\[exit code:\s*(\d+)\]/i.exec(header);
    const interrupted=/\[timeout:|\[signal:|aborted|interrupted/i.test(header);
    const exit=interrupted?null:result.exitCode??result.exit_code??rawResult.exitCode??rawResult.exit_code??row.exitCode??(marker?Number(marker[1]):null);
    const status: TaskEvidence['status']=row.isError===true || (typeof exit==='number'&&exit!==0)?'failed':exit===0&&row.streaming!==true?'passed':'unknown';
    return [{label:command.slice(0,240),status,id:String(row.id||index)}];
  }).slice(-30);
}
function redact(value:string):string {
  return value.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]+)\b/g,'[비밀값 제외]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi,'$1[비밀값 제외]');
}
export function buildHandoffCard({goal,note,changes,evidence,provider,model,project}:{goal:string;note:string;changes:string;evidence:TaskEvidence[];provider:string;model:string;project:string}):string {
  return redact([`# 작업 인계`, `프로젝트: ${project||'폴더 없는 작업'}`,`모델: ${provider} / ${model}`,`\n## 목표\n${goal||'목표를 입력하세요.'}`,
    `\n## 변경 파일\n${changes||'확인된 변경 없음'}`,`\n## 검증\n${evidence.length?evidence.map(row=>`- [${row.status==='passed'?'통과':row.status==='failed'?'실패':'확인 필요'}] ${row.label}`).join('\n'):'실행 결과가 확인된 검증 없음'}`,
    `\n## 남은 작업·주의사항\n${note||'직접 기록하세요.'}`].join('\n'));
}
