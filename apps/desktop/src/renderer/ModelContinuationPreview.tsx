import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ArrowRight, LoaderCircle, X } from 'lucide-react';
import type { DesktopModelSelection } from '../shared/contract';
import { inheritancePreflight } from './session-inheritance';
import { record } from './record-utils';
import { PaneDialogLayer, containDialogTab } from './sidebar-dialog';
import './desktop/workbench-task-center.css';

export default function ModelContinuationPreview({anchor,sessionId,sourceModel,target,attachmentCount,onCancel,onContinue}:{anchor:RefObject<HTMLElement|null>;sessionId:string;sourceModel:string;target:DesktopModelSelection;attachmentCount:number;onCancel():void;onContinue():Promise<boolean>}){
  const [fit,setFit]=useState<Record<string,unknown>|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const titleId=useId(),dialog=useRef<HTMLElement>(null);
  useEffect(()=>{let live=true;const previous=document.activeElement as HTMLElement|null;void inheritancePreflight(sessionId,target).then(value=>{if(live){setFit(record(value));setLoading(false);}});dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>{live=false;if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus();};},[sessionId,target]);
  return <PaneDialogLayer anchor={anchor} onClose={()=>{if(!busy)onCancel();}}><section ref={dialog} className="workbench-dialog workbench-model-preview" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={containDialogTab}>
    <header className="workbench-heading"><div><span className="workbench-eyebrow">모델 전환</span><h2 id={titleId}>이 모델로 이어서 작업할까요?</h2></div><button type="button" disabled={busy} onClick={onCancel} aria-label="모델 전환 취소"><X size={16}/></button></header>
    <div className="workbench-panel"><section className="workbench-card workbench-card--hero"><div className="workbench-model-transfer"><b>{sourceModel}</b><ArrowRight size={18}/><b>{target.model}</b></div><p>원본 대화를 보존하고 같은 작업의 새 모델 이력으로 이어갑니다. 현재 초안·첨부 {attachmentCount}개·요청 한도를 함께 유지합니다.</p></section>
      <section className="workbench-card"><h3>전환 전 확인</h3>{loading?<p><LoaderCircle className="workbench-spinner" size={14}/>대상 모델의 대화 수용량을 확인하는 중…</p>:<><p>{fit?.known?fit.fits?'현재 대화를 대상 모델로 이어갈 수 있습니다.':fit.willCompact?'전환 과정에서 대화 압축이 필요합니다. 압축은 별도의 모델 요청과 사용량을 발생시킬 수 있습니다.':'대화가 대상 모델의 컨텍스트에 맞지 않습니다. 먼저 대화를 압축하거나 새 작업을 시작하세요.':'수용량을 사전에 확인하지 못했습니다. 실제 전환 시 런타임이 한 번 더 검사합니다.'}</p>{numberValue(fit?.used)>0&&<small>예상 대화량 {numberValue(fit?.used).toLocaleString()}토큰</small>}<small>기존 대화의 이미지·도구 기록은 대상 공급자의 호환 처리에 따라 달라질 수 있습니다. 이 미리보기는 AI 요청을 하지 않습니다.</small></>}</section>
      {error&&<p className="workbench-callout" role="alert">{error} 기존 대화와 초안은 유지했습니다. 다시 시도하거나 취소할 수 있습니다.</p>}
    </div><footer className="workbench-footer"><button type="button" disabled={busy} onClick={onCancel}>취소</button><button type="button" className="is-primary" disabled={busy||loading||Boolean(fit?.known&&!fit.fits&&!fit.willCompact)} onClick={()=>{setBusy(true);setError('');void onContinue().then(ok=>{if(!ok)setError('모델 전환을 완료하지 못했습니다.');},error=>setError(error.message||String(error))).finally(()=>setBusy(false));}}>{busy?'이어서 준비하는 중…':error?'다시 시도':'이 모델로 이어가기'}</button></footer>
  </section></PaneDialogLayer>;
}
function numberValue(value:unknown){return Math.max(0,Number(value)||0);}
