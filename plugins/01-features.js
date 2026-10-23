module.exports=({app,db,io,need,A,S,bcrypt,crypto,friends,blocked,chatFor,rateLimit})=>{
 const add=(t,c,d)=>{try{db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`)}catch{}};
 add('users','bio',"TEXT DEFAULT ''");add('users','avatar',"TEXT DEFAULT '🙂'");add('messages','edited_at','INTEGER');
 db.exec(`CREATE TABLE IF NOT EXISTS reactions(message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,emoji TEXT NOT NULL,PRIMARY KEY(message_id,user_id));
 CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER,revoked INTEGER DEFAULT 0,created_at INTEGER DEFAULT(strftime('%s','now')));`);
 const lim=rateLimit({windowMs:15*60e3,limit:30});
 // profile & privacy
 app.get('/api/profile',need,A((q,r)=>{const u=db.prepare('SELECT username,display_name,bio,avatar,allow_requests,allow_search FROM users WHERE id=?').get(q.session.uid);r.json({...u,allow_requests:!!u.allow_requests,allow_search:!!u.allow_search})}));
 app.post('/api/profile',need,A((q,r)=>{const d=S(q.body.display_name,40);if(!d)return r.status(400).json({error:'Name required.'});
  db.prepare('UPDATE users SET display_name=?,bio=?,avatar=?,allow_requests=?,allow_search=? WHERE id=?').run(d,S(q.body.bio,160),S(q.body.avatar,8)||'🙂',q.body.allow_requests?1:0,q.body.allow_search?1:0,q.session.uid);r.json({ok:true})}));
 app.get('/api/blocks',need,A((q,r)=>r.json(db.prepare('SELECT u.username,u.display_name FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=?').all(q.session.uid))));
 app.post('/api/account/delete',need,lim,A((q,r)=>{const u=db.prepare('SELECT * FROM users WHERE id=?').get(q.session.uid);
  if(!bcrypt.compareSync(String(q.body.password||''),u.password_hash))return r.status(401).json({error:'Incorrect password.'});
  db.prepare('DELETE FROM chats WHERE user1_id=? OR user2_id=?').run(u.id,u.id);db.prepare('DELETE FROM users WHERE id=?').run(u.id);q.session.destroy(()=>r.json({ok:true}))}));
 // sidebar summary: avatar, unread, last message
 app.get('/api/summary',need,A((q,r)=>{const me=q.session.uid,out={};
  db.prepare('SELECT u.username,u.avatar FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester_id=? THEN f.receiver_id ELSE f.requester_id END WHERE f.requester_id=? OR f.receiver_id=?').all(me,me,me).forEach(u=>out[u.username]={avatar:u.avatar||'🙂',unread:0,last:null});
  db.prepare('SELECT u.username,c.id,c.lock_hash FROM chats c JOIN users u ON u.id=CASE WHEN c.user1_id=? THEN c.user2_id ELSE c.user1_id END WHERE c.user1_id=? OR c.user2_id=?').all(me,me,me).forEach(c=>{
   const o=out[c.username];if(!o)return;
   o.unread=db.prepare('SELECT COUNT(*) n FROM messages WHERE chat_id=? AND sender_id<>? AND read_at IS NULL AND deleted_at IS NULL').get(c.id,me).n;
   if(c.lock_hash)o.last='🔒 Private chat';else{const m=db.prepare('SELECT text,deleted_at FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 1').get(c.id);if(m)o.last=m.deleted_at?'Message deleted':(m.text||'').slice(0,40)}});
  r.json(out)}));
 // thread (with edited flag + reactions), search, edit, react
 app.get('/api/chats/:uid/thread',need,A((q,r)=>{const x=chatFor(q,r);if(!x)return;const me=q.session.uid,before=+q.query.before||1e15;
  db.prepare("UPDATE messages SET read_at=strftime('%s','now') WHERE chat_id=? AND sender_id<>? AND read_at IS NULL").run(x.c.id,me);
  const rows=db.prepare('SELECT m.id,m.text,m.created_at,m.read_at,m.edited_at,m.deleted_at,m.sender_id=? AS mine,(SELECT text FROM messages WHERE id=m.reply_to AND deleted_at IS NULL) AS reply_text FROM messages m WHERE chat_id=? AND id<? ORDER BY id DESC LIMIT 100').all(me,x.c.id,before).reverse();
  const ids=rows.map(m=>m.id),rx={};
  if(ids.length)db.prepare(`SELECT message_id,emoji,user_id FROM reactions WHERE message_id IN(${ids.map(()=>'?').join(',')})`).all(...ids).forEach(e=>{(rx[e.message_id]=rx[e.message_id]||[]).push({emoji:e.emoji,mine:e.user_id===me})});
  rows.forEach(m=>{if(m.deleted_at)m.text=null;m.reactions=rx[m.id]||[]});r.json({messages:rows})}));
 app.get('/api/chats/:uid/search',need,A((q,r)=>{const x=chatFor(q,r);if(!x)return;const s=S(q.query.q,50);if(s.length<2)return r.json({results:[]});
  r.json({results:db.prepare('SELECT id,text,created_at,sender_id=? AS mine FROM messages WHERE chat_id=? AND deleted_at IS NULL AND instr(lower(text),lower(?))>0 ORDER BY id DESC LIMIT 30').all(q.session.uid,x.c.id,s)})}));
 // note: the 'deleted' socket event is reused by the client as a generic "refresh this chat" signal
 app.post('/api/chats/:uid/messages/:id/edit',need,A((q,r)=>{const x=chatFor(q,r);if(!x)return;const t=S(q.body.text,4000);if(!t)return r.status(400).json({error:'Empty message.'});
  const ok=db.prepare("UPDATE messages SET text=?,edited_at=strftime('%s','now') WHERE id=? AND chat_id=? AND sender_id=? AND deleted_at IS NULL").run(t,+q.params.id,x.c.id,q.session.uid).changes;
  if(ok)io.to('u:'+x.other).emit('deleted',{chat:x.c.uid});r.json({ok:!!ok})}));
 app.post('/api/chats/:uid/messages/:id/react',need,A((q,r)=>{const x=chatFor(q,r);if(!x)return;const e=S(q.body.emoji,8);
  if(!['❤️','👍','😂','😮','😢','🙏'].includes(e))return r.status(400).json({error:'Bad reaction.'});
  const m=db.prepare('SELECT id FROM messages WHERE id=? AND chat_id=? AND deleted_at IS NULL').get(+q.params.id,x.c.id);if(!m)return r.status(404).json({error:'Not found.'});
  const cur=db.prepare('SELECT emoji FROM reactions WHERE message_id=? AND user_id=?').get(m.id,q.session.uid);
  if(cur&&cur.emoji===e)db.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=?').run(m.id,q.session.uid);else db.prepare('INSERT OR REPLACE INTO reactions VALUES(?,?,?)').run(m.id,q.session.uid,e);
  io.to('u:'+x.other).emit('deleted',{chat:x.c.uid});r.json({ok:true})}));
 // invite links
 app.post('/api/invites',need,lim,A((q,r)=>{const h=Math.min(+q.body.hours||24,720),t=crypto.randomBytes(18).toString('base64url');
  db.prepare('INSERT INTO invites(token,owner_id,expires_at) VALUES(?,?,?)').run(t,q.session.uid,Math.floor(Date.now()/1000)+h*3600);r.json({token:t})}));
 app.get('/api/invites',need,A((q,r)=>r.json(db.prepare("SELECT token,expires_at FROM invites WHERE owner_id=? AND revoked=0 AND expires_at>strftime('%s','now')").all(q.session.uid))));
 app.delete('/api/invites/:t',need,A((q,r)=>{db.prepare('UPDATE invites SET revoked=1 WHERE token=? AND owner_id=?').run(S(q.params.t,60),q.session.uid);r.json({ok:true})}));
 app.post('/api/invites/:t/accept',need,lim,A((q,r)=>{const me=q.session.uid,i=db.prepare("SELECT * FROM invites WHERE token=? AND revoked=0 AND expires_at>strftime('%s','now')").get(S(q.params.t,60));
  if(!i||i.owner_id===me||blocked(me,i.owner_id))return r.status(404).json({error:'Invite is invalid or expired.'});
  if(!friends(me,i.owner_id)){db.prepare('DELETE FROM friendships WHERE (requester_id=? AND receiver_id=?) OR (requester_id=? AND receiver_id=?)').run(me,i.owner_id,i.owner_id,me);
   db.prepare("INSERT INTO friendships(requester_id,receiver_id,status) VALUES(?,?,'accepted')").run(i.owner_id,me);io.to('u:'+i.owner_id).emit('friends')}
  r.json({ok:true,username:db.prepare('SELECT username FROM users WHERE id=?').get(i.owner_id).username})}));
 app.get('/invite/:t',(q,r)=>r.redirect('/#invite='+encodeURIComponent(q.params.t)));
 // admin (set ADMIN_USERNAME in Render env, or is_admin=1 in DB). No message content is exposed.
 const adm=(q,r,n)=>{const u=db.prepare('SELECT username,is_admin FROM users WHERE id=?').get(q.session.uid),a=(process.env.ADMIN_USERNAME||'').toLowerCase();
  u&&(u.is_admin||(a&&u.username===a))?n():r.status(403).json({error:'Forbidden'})};
 app.get('/api/admin/stats',need,adm,A((q,r)=>{const c=t=>db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  r.json({users:c('users'),online:[...io.sockets.adapter.rooms.keys()].filter(k=>k.startsWith('u:')).length,chats:c('chats'),messages:c('messages'),
   pending:db.prepare("SELECT COUNT(*) n FROM friendships WHERE status='pending'").get().n,reports:db.prepare("SELECT COUNT(*) n FROM reports WHERE status='open'").get().n})}));
 app.get('/api/admin/reports',need,adm,A((q,r)=>r.json(db.prepare('SELECT r.id,a.username reporter,b.username reported,r.reason,r.description,r.status,r.created_at FROM reports r LEFT JOIN users a ON a.id=r.reporter_id LEFT JOIN users b ON b.id=r.reported_id ORDER BY r.id DESC LIMIT 100').all())));
 app.post('/api/admin/reports/:id/resolve',need,adm,A((q,r)=>{db.prepare("UPDATE reports SET status='resolved' WHERE id=?").run(+q.params.id);r.json({ok:true})}));
};
