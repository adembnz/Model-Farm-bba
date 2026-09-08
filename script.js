document.addEventListener('DOMContentLoaded',()=>{
 const hamburger=document.getElementById('hamburger'),mobilePanel=document.getElementById('mobilePanel');
 if(hamburger&&mobilePanel){hamburger.addEventListener('click',()=>{const open=mobilePanel.classList.toggle('is-open');hamburger.classList.toggle('is-open',open);hamburger.setAttribute('aria-expanded',String(open));});mobilePanel.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{mobilePanel.classList.remove('is-open');hamburger.classList.remove('is-open');hamburger.setAttribute('aria-expanded','false')}));}
 const revealEls=document.querySelectorAll('.reveal');if('IntersectionObserver'in window){const o=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');o.unobserve(e.target)}}),{threshold:.15});revealEls.forEach(e=>o.observe(e));}else revealEls.forEach(e=>e.classList.add('is-visible'));
 loadImages();
 const form=document.getElementById('bookingForm');if(!form)return;const confirmBox=document.getElementById('confirmBox');
 const rules={fullName:v=>v.trim().length>=2&&v.trim().length<=100,phone:v=>/^[0-9+\s()\-]{8,20}$/.test(v.trim()),visitors:v=>Number.isInteger(Number(v))&&Number(v)>0&&Number(v)<=1000,bookingType:v=>v.trim().length>0,date:v=>/^\d{4}-\d{2}-\d{2}$/.test(v),time:v=>/^\d{2}:\d{2}$/.test(v)};
 const showError=(n,e)=>{const w=form.querySelector(`[data-field="${n}"]`);if(w)w.classList.toggle('has-error',e)};
 const setMinDate=()=>{const d=document.getElementById('date');if(d){const x=new Date();d.min=`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`}};setMinDate();
 form.addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form).entries());let valid=true;Object.keys(rules).forEach(k=>{const ok=rules[k](data[k]||'');showError(k,!ok);if(!ok)valid=false});if(!valid){form.querySelector('.has-error input,.has-error select')?.focus();return}
   const btn=form.querySelector('button[type=submit]');if(btn)btn.disabled=true;
   try{const r=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(data)});const out=await r.json().catch(()=>({}));if(!r.ok)throw new Error(out.error||'تعذر إرسال طلب الحجز.');confirmBox?.classList.add('is-visible');form.reset();Object.keys(rules).forEach(k=>showError(k,false));confirmBox?.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>confirmBox?.classList.remove('is-visible'),6000);}
   catch(err){alert(err.message||'تعذر إرسال طلب الحجز.');}finally{if(btn)btn.disabled=false}
 });
 Object.keys(rules).forEach(k=>form.elements[k]?.addEventListener('input',()=>showError(k,false)));
});
async function loadImages(){try{const images=await getPublicImages();document.querySelectorAll('[data-img-slot]').forEach(img=>{const url=images[img.dataset.imgSlot];if(url){img.src=url;img.loading=img.dataset.imgSlot==='hero'?'eager':'lazy';}})}catch(e){console.warn(e)}}
