'use client';
import {useState} from 'react';
import {api} from '@/lib/client';
export default function BridgeSettings(){
  const [key,setKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function action(revoke=false){setBusy(true);setError('');try{if(revoke){await api('bridge/revoke',{});setKey('');}else{const result=await api('bridge/key',{});setKey(result.key);}}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="panel"><div className="panelTitle"><h2>Hermes · Claude MCP 연결</h2><span className="badge">모델 교체 가능</span></div><p className="hint">외부 에이전트가 같은 운영 도구를 사용합니다. 키는 24시간 유효하며 조회·제안만 가능하고 승인·발송 권한은 없습니다.</p><div className="actions"><button className="secondary" disabled={busy} onClick={()=>action(true)}>연결 키 전체 폐기</button><button className="primary" disabled={busy} onClick={()=>action()}>MCP 연결 키 발급</button></div>{key&&<label>AXPM_BRIDGE_KEY · 비공개로 보관<input readOnly value={key} onFocus={e=>e.target.select()}/><small>키는 이 화면에 한 번 표시됩니다. Git 또는 채팅에 붙이지 마세요.</small></label>}{error&&<p className="error" role="alert">{error}</p>}<p className="hint">연결 방법과 스킬: 저장소 docs/HERMES.md · .claude/skills</p></section>;
}
