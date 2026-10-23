(()=>{
const st=document.createElement('style');
st.textContent=`html[data-theme=dark]{--bg:#0e0f13;--card:#181a21;--tx:#eceef5;--mut:#9096a8;--in:#242733;--bd:#2a2d3a}html[data-theme=light]{--bg:#f5f6fa;--card:#fff;--tx:#14151a;--mut:#6b7080;--in:#e9ebf3;--bd:#e2e4ee}
#pcm{position:fixed;inset:0;background:#0008;z-index:50;display:flex;align-items:center;justify-content:center;padding:12px}#pcm .card{width:100%;max-width:420px;max-height:90dvh;overflow:auto;display:grid;gap:10px}
.bd{background:#ef4444;color:#fff;border-radius:99px;padding:1px 8px;font-size:12px;margin-left:6px}.sm{font-size:12px;color:var(--mut)}.ms{cursor:pointer}
.tb{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}.tb button{padding:4px 8px;min-height:28px;font-size:13px}.rx{font-size:13px;margin-top:3px}`;
document.head.append(st);
const setTheme=t=>{localStorage.setItem('pc-theme',t);t==='auto'?document.documentElement.removeAttribute('data-theme'):document.documentElement.dataset.theme=t};
setTheme(localStorage.getItem('pc-theme')||'auto');
const close=()=>{const m=document.getElementById('pcm');if(m)m.remove()};
const mk=()=>{close();const m=el('div');m.id='pcm';m.onclick=e=>{if(e.target===m)close()};const c=el('div',null,'card');m.append(c);document.body.append(m);return c};
const inp=(v,ph,max)=>{const i=document.createElement('input');i.value=v||'';i.placeholder=ph;i.maxLength=max;return i};
const chk=(l,v)=>{const w=el('label',null,'row'),i=document.createElement('input');i.type='checkbox';i.checked=v;i.style.width='auto';w.append(el('span',l),i);return[w,i]};
const date=t=>new Date(t*1000).toLocaleString();
async function settings(){try{
 const p=await api('profile'),bl=await api('blocks'),iv=await api('invites'),c=mk();
 c.append(el('h3','Settings'));
 const nm=inp(p.display_name,'Display name',40),bio=inp(p.bio,'Bio',160),av=inp(p.avatar,'Avatar emoji',8);
 const[w1,ar]=chk('Allow friend requests',p.allow_requests),[w2,as]=chk('Allow username search',p.allow_search);
 const sv=el('button','Save profile & privacy');
 sv.onclick=async()=>{try{await api('profile','POST',{display_name:nm.value,bio:bio.value,avatar:av.value,allow_requests:ar.checked,allow_search:as.checked});close();init()}catch(e){alert(e.message)}};
 c.append(nm,bio,av,w1,w2,sv);
 const tr=el('div',null,'row');tr.append(el('span','Theme'));
 ['auto','light','dark'].forEach(t=>{const b=el('button',t,'g');b.onclick=()=>setTheme(t);tr.append(b)});c.append(tr);
 c.append(el('h4','Invite links'));
 const nb=el('button','Create invite link (24h)','g');
 nb.onclick=async()=>{const r=await api('invites','POST',{hours:24}),u=location.origin+'/invite/'+r.token;try{await navigator.clipboard.writeText(u)}catch{}alert('Link copied:\n'+u);settings()};c.append(nb);
 iv.forEach(i=>{const r=el('div',null,'row');r.append(el('span','…'+i.token.slice(-6)+' · expires '+date(i.expires_at),'sm'));
  const b=el('button','Revoke','g');b.onclick=async()=>{await api('invites/'+i.token,'DELETE');settings()};r.append(b);c.append(r)});
 c.append(el('h4','Blocked users'));if(!bl.length)c.append(el('span','None','sm'));
 bl.forEach(u=>{const r=el('div',null,'row');r.append(el('span','@'+u.username));
  const b=el('button','Unblock','g');b.onclick=async()=>{await api('friends/'+u.username+'/unblock','POST');settings();load()};r.append(b);c.append(r)});
 const dl=el('button','Delete my account','g');dl.style.color='#ef4444';
 dl.onclick=async()=>{const pw=prompt('Enter your password to permanently delete your account:');
  if(pw&&confirm('This cannot be undone. Delete?'))try{await api('account/delete','POST',{password:pw});location.reload()}catch(e){alert(e.message)}};
 const cl=el('button','Close','g');cl.onclick=close;c.append(dl,cl);
}catch(e){alert(e.message)}}
async function admin(){try{
 const s=await api('admin/stats'),rp=await api('admin/reports'),c=mk();
 c.append(el('h3','Admin'));
 c.append(el('div','Users '+s.users+' · Online '+s.online+' · Chats '+s.chats+' · Messages '+s.messages+' · Pending requests '+s.pending+' · Open reports '+s.reports,'sm'));
 c.append(el('h4','Reports'));if(!rp.length)c.append(el('span','No reports.','sm'));
 rp.forEach(x=>{const r=el('div',null,'row');r.append(el('span','#'+x.id+' @'+x.reporter+' → @'+x.reported+' · '+x.reason+(x.description?' · '+x.description:'')+' · '+x.status));
  if(x.status==='open'){const b=el('button','Resolve','g');b.onclick=async()=>{await api('admin/reports/'+x.id+'/resolve','POST');admin()};r.append(b)}c.append(r)});
 const cl=el('button','Close','g');cl.onclick=close;c.append(cl);
}catch(e){alert(e.message)}}
const bar=el('div',null,'row'),sb=el('button','⚙️ Settings','g');sb.onclick=settings;bar.append(sb);$('side').prepend(bar);
// invite link handling + admin button (after login)
if(location.hash.startsWith('#invite=')){sessionStorage.setItem('pc-invite',decodeURIComponent(location.hash.slice(8)));history.replaceState(null,'',location.pathname)}
let adminChecked=false;
setInterval(()=>{if($('app').classList.contains('hide'))return;
 const t=sessionStorage.getItem('pc-invite');
 if(t){sessionStorage.removeItem('pc-invite');api('invites/'+encodeURIComponent(t)+'/accept','POST').then(r=>{alert('You are now friends with @'+r.username);load()}).catch(e=>alert(e.message))}
 if(!adminChecked){adminChecked=true;api('admin/stats').then(()=>{const b=el('button','🛠 Admin','g');b.onclick=admin;bar.append(b)}).catch(()=>{})}},1000);
})();
