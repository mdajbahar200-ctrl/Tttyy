const fs=require('fs'),path=require('path');
module.exports=ctx=>{
 const {app,express}=ctx,sp=path.join(__dirname,'plugins'),wp=path.join(__dirname,'webplugins');
 const list=d=>fs.existsSync(d)?fs.readdirSync(d).filter(f=>f.endsWith('.js')).sort():[];
 list(sp).forEach(f=>require(path.join(sp,f))(ctx));
 app.use('/wp',express.static(wp));
 app.get('/plugins.js',(q,r)=>r.type('js').send(`${JSON.stringify(list(wp))}.forEach(n=>{const s=document.createElement('script');s.src='/wp/'+n;s.async=false;document.body.append(s)});`));
};
