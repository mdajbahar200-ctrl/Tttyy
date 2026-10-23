(()=>{
let sum={};
const lists='#fl .row,#inc .row,#out .row';
function deco(){document.querySelectorAll(lists).forEach(r=>{
 if(r.dataset.d)return;r.dataset.d='1';
 const n=r.firstChild,m=n&&n.textContent.match(/@([a-z0-9_]+)/),i=m&&sum[m[1]];if(!i)return;
 n.prepend(el('span',i.avatar+' '));
 if(i.unread)n.append(el('span',String(i.unread),'bd'));
 if(i.last)n.append(el('br'),el('span',i.last,'sm'))})}
async function refresh(){try{sum=await api('summary')}catch{return}deco()}
let t;new MutationObserver(()=>{if(document.querySelector(lists.split(',').map(s=>s+':not([data-d])').join(',')))clearTimeout(t),t=setTimeout(refresh,150)})
 .observe($('side'),{childList:true,subtree:true});
function toolbar(e,m){const old=e.querySelector('.tb');document.querySelectorAll('.tb').forEach(x=>x.remove());if(old)return;
 const tb=el('div',null,'tb'),B=(l,f)=>{const b=el('button',l,'g');b.onclick=ev=>{ev.stopPropagation();f()};tb.append(b)};
 B('↩ Reply',()=>{replyTo=m.id;$('rp').textContent='Replying: '+m.text.slice(0,60);$('rp').classList.remove('hide');tb.remove()});
 B('Copy',()=>{navigator.clipboard.writeText(m.text);tb.remove()});
 ['❤️','👍','😂','😮','😢','🙏'].forEach(x=>B(x,async()=>{try{await api('chats/'+cur+'/messages/'+m.id+'/react','POST',{emoji:x});loadMsgs()}catch(er){alert(er.message)}}));
 if(m.mine){
  B('Edit',async()=>{const v=prompt('Edit message:',m.text);if(v&&v.trim())try{await api('chats/'+cur+'/messages/'+m.id+'/edit','POST',{text:v});loadMsgs()}catch(er){alert(er.message)}});
  B('Delete',async()=>{if(confirm('Delete this message?')){await api('chats/'+cur+'/messages/'+m.id,'DELETE');loadMsgs()}})}
 e.append(tb)}
window.loadMsgs=async function(){
 try{const d=await api('chats/'+cur+'/thread');hideLock();const b=$('msgs');b.replaceChildren();
  d.messages.forEach(m=>{const e=el('div',null,'m ms'+(m.mine?' me':''));
   if(m.reply_text)e.append(el('div',m.reply_text.slice(0,80),'q'));
   e.append(m.deleted_at?el('i','This message was deleted.'):el('span',m.text));
   const tm=new Date(m.created_at*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
   e.append(el('small',tm+(m.edited_at?' · edited':'')+(m.mine?(m.read_at?' ✓✓':' ✓'):'')));
   if(m.reactions.length){const c={};m.reactions.forEach(x=>c[x.emoji]=(c[x.emoji]||0)+1);e.append(el('div',Object.entries(c).map(([k,v])=>k+(v>1?v:'')).join(' '),'rx'))}
   if(!m.deleted_at)e.onclick=()=>toolbar(e,m);
   b.append(e)});
  b.scrollTop=b.scrollHeight}catch(e){if(e.locked)showLock();else alert(e.message)}};
const lb=document.querySelector('#chatv button[onclick="lockUI()"]'),sb=el('button','🔍','g');
sb.onclick=async()=>{const s=prompt('Search this chat (2+ letters):');if(!s||!cur)return;
 try{const d=await api('chats/'+cur+'/search?q='+encodeURIComponent(s)),b=$('msgs');b.replaceChildren();
  const back=el('button','← Back to chat','g');back.onclick=()=>loadMsgs();b.append(back);
  if(!d.results.length)b.append(el('div','No results.','sm'));
  d.results.forEach(m=>{const e=el('div',null,'m'+(m.mine?' me':''));e.append(el('span',m.text),el('small',new Date(m.created_at*1000).toLocaleString()));b.append(e)})
 }catch(er){alert(er.message)}};
if(lb)lb.before(sb);
})();
