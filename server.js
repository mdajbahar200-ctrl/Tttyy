require('dotenv').config();
const crypto=require('crypto'),express=require('express'),session=require('express-session'),helmet=require('helmet'),
rateLimit=require('express-rate-limit'),bcrypt=require('bcryptjs'),Database=require('better-sqlite3');
if(!process.env.SESSION_SECRET){console.error('Set SESSION_SECRET in .env');process.exit(1);}
const db=new Database('data.db');db.pragma('foreign_keys=ON');db.pragma('journal_mode=WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,email TEXT,
 password_hash TEXT NOT NULL,friend_code TEXT UNIQUE NOT NULL,allow_requests INTEGER DEFAULT 1,allow_search INTEGER DEFAULT 1,
 is_admin INTEGER DEFAULT 0,last_seen INTEGER,created_at INTEGER DEFAULT(strftime('%s','now')));
CREATE TABLE IF NOT EXISTS friendships(id INTEGER PRIMARY KEY,requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN('pending','accepted')),
 created_at INTEGER DEFAULT(strftime('%s','now')),UNIQUE(requester_id,receiver_id),CHECK(requester_id<>receiver_id));
CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY,uid TEXT UNIQUE NOT NULL,user1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 user2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,lock_hash TEXT,UNIQUE(user1_id,user2_id),CHECK(user1_id<user2_id));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
 sender_id INTEGER NOT NULL REFERENCES users(id),text TEXT,reply_to INTEGER REFERENCES messages(id),created_at INTEGER DEFAULT(strftime('%s','now')),
 read_at INTEGER,deleted_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_msg ON messages(chat_id,id);
CREATE TABLE IF NOT EXISTS blocks(blocker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,blocked_id INTEGER REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(blocker_id,blocked_id));
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY,reporter_id INTEGER,reported_id INTEGER,message_id INTEGER,reason TEXT,description TEXT,status TEXT DEFAULT'open',created_at INTEGER DEFAULT(strftime('%s','now')));
`);
const app=express(),http=require('http').createServer(app),io=require('socket.io')(http);
app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{...helmet.contentSecurityPolicy.getDefaultDirectives(),"script-src":["'self'","'unsafe-inline'"],"script-src-attr":["'unsafe-inline'"]}}}));
app.use(express.json({limit:'20kb'}));
const sess=session({name:'pc.sid',secret:process.env.SESSION_SECRET,resave:false,saveUninitialized:false,
 cookie:{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:7*864e5}});
app.use(sess);io.engine.use(sess);
// CSRF: SameSite=strict cookie + custom header required on writes
app.use('/api',(q,r,n)=>q.method!=='GET'&&q.get('x-requested-with')!=='pc'?r.status(403).json({error:'Forbidden'}):n());
const authLimit=rateLimit({windowMs:15*60e3,limit:20,message:{error:'Too many attempts. Try later.'}});
const apiLimit=rateLimit({windowMs:60e3,limit:200});app.use('/api',apiLimit);
const A=(f)=>(q,r)=>{try{f(q,r)}catch(e){console.error(e);r.status(500).json({error:'Something went wrong. Please try again.'})}};
const need=(q,r,n)=>q.session.uid?n():r.status(401).json({error:'Please log in.'});
const S=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
const code=()=>'PC-'+crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase();
const pub=u=>({username:u.username,display_name:u.display_name,online:io.sockets.adapter.rooms.has('u:'+u.id)});
const blocked=(a,b)=>!!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(a,b,b,a);
const friends=(a,b)=>!!db.prepare("SELECT 1 FROM friendships WHERE status='accepted' AND ((requester_id=? AND receiver_id=?) OR (requester_id=? AND receiver_id=?))").get(a,b,b,a);
const userBy=n=>db.prepare('SELECT * FROM users WHERE username=?').get(S(n,30).toLowerCase());
// ---- auth
app.post('/api/signup',authLimit,A((q,r)=>{
 const u=S(q.body.username,20).toLowerCase(),d=S(q.body.display_name,40),p=q.body.password;
 if(!/^[a-z0-9_]{3,20}$/.test(u))return r.status(400).json({error:'Username: 3-20 letters, numbers or _'});
 if(!d||typeof p!=='string'||p.length<8||p.length>100)return r.status(400).json({error:'Name required; password 8+ characters.'});
 if(userBy(u))return r.status(400).json({error:'Username already taken.'});
 let c;do c=code();while(db.prepare('SELECT 1 FROM users WHERE friend_code=?').get(c));
 const id=db.prepare('INSERT INTO users(username,display_name,email,password_hash,friend_code) VALUES(?,?,?,?,?)').run(u,d,S(q.body.email,100)||null,bcrypt.hashSync(p,12),c).lastInsertRowid;
 q.session.regenerate(()=>{q.session.uid=id;r.json({ok:true})});}));
const DUMMY=bcrypt.hashSync('x',12);
app.post('/api/login',authLimit,A((q,r)=>{
 const u=userBy(q.body.username),ok=bcrypt.compareSync(String(q.body.password||''),u?u.password_hash:DUMMY);
 if(!u||!ok)return r.status(401).json({error:'Incorrect username or password.'});
 q.session.regenerate(()=>{q.session.uid=u.id;r.json({ok:true})});}));
app.post('/api/logout',(q,r)=>q.session.destroy(()=>r.json({ok:true})));
app.get('/api/me',need,A((q,r)=>{const u=db.prepare('SELECT * FROM users WHERE id=?').get(q.session.uid);
 r.json({...pub(u),friend_code:u.friend_code,allow_requests:!!u.allow_requests,allow_search:!!u.allow_search});}));
app.post('/api/settings',need,A((q,r)=>{db.prepare('UPDATE users SET allow_requests=?,allow_search=? WHERE id=?').run(q.body.allow_requests?1:0,q.body.allow_search?1:0,q.session.uid);r.json({ok:true})}));
// ---- friends
app.get('/api/friends',need,A((q,r)=>{const me=q.session.uid;
 const rows=db.prepare(`SELECT f.status,f.requester_id,u.* FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester_id=? THEN f.receiver_id ELSE f.requester_id END
  WHERE (f.requester_id=? OR f.receiver_id=?) AND u.id NOT IN(SELECT blocked_id FROM blocks WHERE blocker_id=?)`).all(me,me,me,me);
 r.json({friends:rows.filter(x=>x.status==='accepted').map(pub),
  incoming:rows.filter(x=>x.status==='pending'&&x.requester_id!==me).map(pub),outgoing:rows.filter(x=>x.status==='pending'&&x.requester_id===me).map(pub)});}));
app.post('/api/friends/request',need,A((q,r)=>{const me=q.session.uid,t=S(q.body.target,30);
 const u=/^PC-/i.test(t)?db.prepare('SELECT * FROM users WHERE friend_code=?').get(t.toUpperCase()):(()=>{const x=userBy(t);return x&&x.allow_search?x:null})();
 if(!u||u.id===me||blocked(me,u.id))return r.status(404).json({error:'Friend not found.'});
 if(!u.allow_requests)return r.status(403).json({error:"This user isn't accepting friend requests."});
 if(db.prepare('SELECT 1 FROM friendships WHERE (requester_id=? AND receiver_id=?) OR (requester_id=? AND receiver_id=?)').get(me,u.id,u.id,me))return r.status(400).json({error:'Request already exists.'});
 db.prepare("INSERT INTO friendships(requester_id,receiver_id,status) VALUES(?,?,'pending')").run(me,u.id);io.to('u:'+u.id).emit('friends');r.json({ok:true});}));
app.post('/api/friends/:name/:act',need,A((q,r)=>{const me=q.session.uid,u=userBy(q.params.name);if(!u)return r.status(404).json({error:'Friend not found.'});
 const a=q.params.act,tx=u.id;
 if(a==='accept'){if(!db.prepare("UPDATE friendships SET status='accepted' WHERE requester_id=? AND receiver_id=? AND status='pending'").run(tx,me).changes)return r.status(404).json({error:'No request.'});}
 else if(a==='decline'||a==='cancel'||a==='remove')db.prepare('DELETE FROM friendships WHERE (requester_id=? AND receiver_id=?) OR (requester_id=? AND receiver_id=?)').run(me,tx,tx,me);
 else if(a==='block'){db.prepare('DELETE FROM friendships WHERE (requester_id=? AND receiver_id=?) OR (requester_id=? AND receiver_id=?)').run(me,tx,tx,me);db.prepare('INSERT OR IGNORE INTO blocks VALUES(?,?)').run(me,tx);}
 else if(a==='unblock')db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(me,tx);
 else return r.status(400).json({error:'Bad action.'});
 io.to('u:'+tx).emit('friends');r.json({ok:true});}));
app.post('/api/report',need,A((q,r)=>{const u=userBy(q.body.username);if(!u)return r.status(404).json({error:'Not found.'});
 db.prepare('INSERT INTO reports(reporter_id,reported_id,message_id,reason,description) VALUES(?,?,?,?,?)').run(q.session.uid,u.id,+q.body.message_id||null,S(q.body.reason,30),S(q.body.description,500));r.json({ok:true});}));
// ---- chats (every access passes through chatFor: membership + friendship + block + lock)
function chatFor(q,r,needUnlock=true){const me=q.session.uid;
 const c=db.prepare('SELECT * FROM chats WHERE uid=? AND (user1_id=? OR user2_id=?)').get(S(q.params.uid,40),me,me);
 if(!c){r.status(403).json({error:"You don't have permission to access this conversation."});return null}
 const other=c.user1_id===me?c.user2_id:c.user1_id;
 if(!friends(me,other)||blocked(me,other)){r.status(403).json({error:"You don't have permission to access this conversation."});return null}
 if(needUnlock&&c.lock_hash&&!(q.session.unlocked||{})[c.uid]){r.status(423).json({error:'This chat is locked.',locked:true});return null}
 return{c,other};}
app.post('/api/chats/open',need,A((q,r)=>{const me=q.session.uid,u=userBy(q.body.username);
 if(!u||!friends(me,u.id)||blocked(me,u.id))return r.status(403).json({error:'Only friends can chat.'});
 const [a,b]=[me,u.id].sort((x,y)=>x-y);
 let c=db.prepare('SELECT * FROM chats WHERE user1_id=? AND user2_id=?').get(a,b);
 if(!c){const uid=crypto.randomBytes(16).toString('hex');db.prepare('INSERT INTO chats(uid,user1_id,user2_id) VALUES(?,?,?)').run(uid,a,b);c={uid,lock_hash:null}}
 r.json({uid:c.uid,locked:!!c.lock_hash&&!(q.session.unlocked||{})[c.uid]});}));
const chatLimit=rateLimit({windowMs:15*60e3,limit:10,message:{error:'Too many attempts. Try later.'}});
app.post('/api/chats/:uid/unlock',need,chatLimit,A((q,r)=>{const x=chatFor(q,r,false);if(!x)return;
 if(!x.c.lock_hash||!bcrypt.compareSync(String(q.body.pin||''),x.c.lock_hash))return r.status(401).json({error:'Incorrect chat password.'});
 q.session.unlocked={...(q.session.unlocked||{}),[x.c.uid]:1};r.json({ok:true});}));
app.post('/api/chats/:uid/lock',need,A((q,r)=>{const x=chatFor(q,r,true);if(!x)return;const pin=q.body.pin;
 if(x.c.lock_hash&&q.body.current===undefined&&pin)return r.status(400).json({error:'Provide current password to change.'});
 if(x.c.lock_hash&&!bcrypt.compareSync(String(q.body.current||''),x.c.lock_hash))return r.status(401).json({error:'Incorrect chat password.'});
 if(pin){if(typeof pin!=='string'||pin.length<4||pin.length>64)return r.status(400).json({error:'Password must be 4+ characters.'});
  db.prepare('UPDATE chats SET lock_hash=? WHERE id=?').run(bcrypt.hashSync(pin,12),x.c.id);q.session.unlocked={...(q.session.unlocked||{}),[x.c.uid]:1};}
 else{db.prepare('UPDATE chats SET lock_hash=NULL WHERE id=?').run(x.c.id);}r.json({ok:true});}));
app.post('/api/chats/:uid/relock',need,A((q,r)=>{if(q.session.unlocked)delete q.session.unlocked[S(q.params.uid,40)];r.json({ok:true})}));
app.get('/api/chats/:uid/messages',need,A((q,r)=>{const x=chatFor(q,r);if(!x)return;const me=q.session.uid,before=+q.query.before||1e15;
 db.prepare('UPDATE messages SET read_at=strftime(\'%s\',\'now\') WHERE chat_id=? AND sender_id<>? AND read_at IS NULL').run(x.c.id,me);
 const rows=db.prepare(`SELECT m.id,m.text,m.created_at,m.read_at,m.deleted_at,m.sender_id=? AS mine,m.reply_to,(SELECT text FROM messages WHERE id=m.reply_to AND deleted_at IS NULL) AS reply_text
  FROM messages m WHERE chat_id=? AND id<? ORDER BY id DESC LIMIT 50`).all(me,x.c.id,before).reverse();
 rows.forEach(m=>{if(m.deleted_at)m.text=null});r.json({messages:rows});}));
app.post('/api/chats/:uid/messages',need,A((q,r)=>{const x=chatFor(q,r);if(!x)return;const text=S(q.body.text,4000);if(!text)return r.status(400).json({error:'Empty message.'});
 const rt=q.body.reply_to&&db.prepare('SELECT id FROM messages WHERE id=? AND chat_id=?').get(+q.body.reply_to,x.c.id);
 const id=db.prepare('INSERT INTO messages(chat_id,sender_id,text,reply_to) VALUES(?,?,?,?)').run(x.c.id,q.session.uid,text,rt?rt.id:null).lastInsertRowid;
 const m=db.prepare('SELECT id,text,created_at,reply_to FROM messages WHERE id=?').get(id);
 io.to('u:'+x.other).emit('message',{chat:x.c.uid,message:{...m,mine:0},from:db.prepare('SELECT username FROM users WHERE id=?').get(q.session.uid).username});
 r.json({message:{...m,mine:1}});}));
app.delete('/api/chats/:uid/messages/:id',need,A((q,r)=>{const x=chatFor(q,r);if(!x)return;
 const ok=db.prepare('UPDATE messages SET deleted_at=strftime(\'%s\',\'now\'),text=NULL WHERE id=? AND chat_id=? AND sender_id=?').run(+q.params.id,x.c.id,q.session.uid).changes;
 if(ok)io.to('u:'+x.other).emit('deleted',{chat:x.c.uid,id:+q.params.id});r.json({ok:!!ok})}));
// ---- realtime: authenticated via the same session; users only join their own room
io.use((s,n)=>s.request.session&&s.request.session.uid?n():n(new Error('unauthorized')));
io.on('connection',s=>{const me=s.request.session.uid;s.join('u:'+me);
 s.on('typing',uid=>{const c=db.prepare('SELECT * FROM chats WHERE uid=? AND (user1_id=? OR user2_id=?)').get(String(uid).slice(0,40),me,me);
  if(c&&friends(c.user1_id,c.user2_id)&&!blocked(c.user1_id,c.user2_id))io.to('u:'+(c.user1_id===me?c.user2_id:c.user1_id)).emit('typing',{chat:c.uid});});
 s.on('disconnect',()=>db.prepare("UPDATE users SET last_seen=strftime('%s','now') WHERE id=?").run(me));});
app.use(express.static('public'));
http.listen(process.env.PORT||3000,()=>console.log('PrivateConnect running on :'+(process.env.PORT||3000)));
