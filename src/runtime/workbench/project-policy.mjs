import { readFileSync, realpathSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, join, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { resolvePluginData } from '../shared/plugin-paths.mjs';
import { updateJsonAtomic } from '../shared/atomic-file.mjs';
import { normalizeExecutionBudget } from '../shared/execution-budget.mjs';
import { containsSecret } from '../galaxy/secrets.mjs';
import { estimateTokens } from '../agent/orchestrator/session/token-estimate.mjs';

export const workbenchRoot = () => join(resolvePluginData(), 'workbench');
export const policyPath = () => join(workbenchRoot(), 'policy.json');
export const normalizeRoot = value => { if(!value)return '';let path=resolve(String(value));try{path=realpathSync(path);}catch{}path=path.replace(/[\\/]+$/, '').replace(/\\/g, '/');return process.platform==='win32'?path.toLowerCase():path; };
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function readWorkbenchPolicy() {
  try { const value = JSON.parse(readFileSync(policyPath(), 'utf8')); return { version: 1, daily: {}, projects: {}, ...value }; }
  catch(error) { if(error.code === 'ENOENT') return { version: 1, daily: {}, projects: {} }; throw error; }
}
export function projectPolicy(policy, cwd) {
  const path = normalizeRoot(cwd);
  const key = Object.keys(policy.projects || {}).filter(key => path === key || path.startsWith(`${key}/`)).sort((a,b) => b.length-a.length)[0];
  return { root: key || path, ...object(policy.projects?.[key]) };
}
const lines = value => Array.isArray(value) ? [...new Set(value.map(x=>String(x).trim()).filter(Boolean))] : [];
export function normalizeContextRules(value) {
  if(value!=null&&(typeof value!=='object'||Array.isArray(value)))throw new TypeError('컨텍스트 규칙은 객체여야 합니다.');
  const rules = object(value);
  for(const key of ['include','exclude'])if(rules[key]!=null&&(!Array.isArray(rules[key])||!rules[key].every(path=>typeof path==='string')))throw new TypeError('파일 경로 목록이 올바르지 않습니다.');
  if(rules.instructions!=null&&typeof rules.instructions!=='string')throw new TypeError('프로젝트 지침은 텍스트여야 합니다.');
  const include = lines(rules.include), exclude = lines(rules.exclude);
  if(include.length > 12 || exclude.length > 64) throw new TypeError('컨텍스트 규칙이 너무 많습니다. 포함 파일은 최대 12개입니다.');
  for(const path of include) if(isAbsolute(path) || path.split(/[\\/]/).includes('..') || path.includes('\0') || path.length>300) throw new TypeError('프로젝트 안의 상대 파일 경로를 입력하세요.');
  if(exclude.some(x=>x.length>300)) throw new TypeError('제외 경로가 너무 깁니다.');
  const instructions = String(rules.instructions || '');
  if(instructions.length>12000) throw new TypeError('프로젝트 지침은 12,000자 이내로 입력하세요.');
  return { include, exclude, instructions };
}
export async function saveWorkbenchPolicy(cwd, input) {
  const root = normalizeRoot(cwd);
  const value = object(input);
  const limits = normalizeExecutionBudget(value.projectLimit) || {};
  const daily = normalizeExecutionBudget(value.dailyLimit) || {};
  const context = normalizeContextRules(value.context);
  return updateJsonAtomic(policyPath(), current => {
    const policy = { version: 1, daily: {}, projects: {}, ...object(current) };
    policy.daily = daily;
    if(root) policy.projects = { ...policy.projects, [root]: { ...object(policy.projects[root]), limits, context } };
    return policy;
  }, { secret: true });
}
function excluded(path, patterns) {
  if (/(^|\/)(\.git|node_modules|\.env(?:\..*)?|[^/]*\.(?:pem|key|p12|pfx))($|\/)/i.test(path)) return true;
  return patterns.some(pattern => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*\*/g,'\0').replace(/\*/g,'[^/]*').replace(/\0/g,'.*').replace(/\?/g,'.');
    return new RegExp(`^(?:${escaped})(?:/.*)?$`).test(path);
  });
}
export async function projectContextPlan(cwd, suppliedRules) {
  const root = normalizeRoot(cwd);
  const rules = normalizeContextRules(suppliedRules ?? projectPolicy(readWorkbenchPolicy(), root).context);
  const files = []; let total = rules.instructions.length;
  const canonical = root ? await realpath(root) : '';
  for(const name of rules.include) {
    const path = name.replace(/\\/g,'/');
    if(excluded(path, rules.exclude)) { files.push({ path, status:'excluded', tokens:0 }); continue; }
    try {
      const target = await realpath(join(root, path));
      if(!target.startsWith(`${canonical}${sep}`)) throw new Error('프로젝트 밖의 파일입니다.');
      const info = await stat(target);
      if(!info.isFile() || info.size>32000 || total+info.size>64000) { files.push({path,status:'too-large',tokens:0});continue; }
      const bytes = await readFile(target);
      if(bytes.includes(0)) {files.push({path,status:'binary',tokens:0});continue;}
      const text = bytes.toString('utf8');
      if(containsSecret(text)){files.push({path,status:'secret',tokens:0});continue;}
      total += text.length;
      files.push({path,status:'included',tokens:estimateTokens(text),text});
    } catch(error) { files.push({path,status:'unavailable',tokens:0,reason:error.code==='ENOENT'?'파일 없음':error.message}); }
  }
  const included = files.filter(file=>file.status==='included');
  const text = [rules.instructions && `프로젝트 지침:\n${rules.instructions}`, ...included.map(file=>`파일: ${file.path}\n${file.text}`)].filter(Boolean).join('\n\n');
  return {root,rules,files,text,tokens:estimateTokens(text),digest:createHash('sha256').update(text).digest('hex')};
}
/** Stable source blocks are reused until changed, preserving the provider
 * prefix before the changed block. Exclusions apply to automatic references, never to arbitrary
 * history or user-authorized tool access. */
export async function applyProjectContext(state) {
  if(!state.cwd || state.iterations > 0) return;
  const policy = projectPolicy(readWorkbenchPolicy(), state.cwd);
  const prior = [...state.messages].reverse().find(row=>row.meta?.source==='cosmos-project-context');
  const plan = policy.context?.instructions || policy.context?.include?.length
    ? await projectContextPlan(policy.root, policy.context) : {text:'',digest:''};
  if(prior?.meta?.digest===plan.digest) return;
  // Keep only the latest automatic reference block. Removing a rule must also
  // remove its generated context; ordinary conversation history is untouched.
  for(let index=state.messages.length-1;index>=0;index--)if(state.messages[index].meta?.source==='cosmos-project-context')state.messages.splice(index,1);
  if(!plan.text) return;
  const block = {role:'user',content:`[프로젝트 컨텍스트 · 최신 규칙]\n${plan.text}`,meta:{source:'cosmos-project-context',digest:plan.digest}};
  // Keep the user's current instruction last so provider intent and tool
  // selection still address the actual task.
  const last = state.messages.findLastIndex(row=>row.role==='user' && row.meta?.source!=='cosmos-project-context');
  state.messages.splice(last<0?state.messages.length:last,0,block);
}
