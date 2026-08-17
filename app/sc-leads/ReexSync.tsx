"use client";

// Auto-sync bookmarklet: click once on the logged-in RepostExchange tab and it
// keeps syncing every 20 min while the tab stays open (steady gold-sifting when
// the computer is on). Click again to stop. Token (15-min TTL) never leaves the
// browser — the live session refreshes it. A live status widget shows state.
const BOOKMARKLET = `javascript:(()=>{if(window.__ndTimer){clearInterval(window.__ndTimer);window.__ndTimer=null;if(window.__ndWidget)window.__ndWidget.remove();return}const W=document.createElement('div');W.style.cssText='position:fixed;bottom:20px;right:20px;z-index:99999;background:#111;color:#fff;padding:12px 16px;border-radius:12px;font:600 13px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.4);border:1px solid #22c55e';document.body.appendChild(W);window.__ndWidget=W;const sync=async()=>{W.textContent='🥷 Синхронізую…';try{let t=localStorage.getItem('accessToken');try{if(t&&t[0]==='{')t=JSON.parse(t).accessToken||t}catch(e){}const H={'Content-Type':'application/json','Authorization':'Bearer '+t};let o=0,all=[],T=null;for(let i=0;i<80;i++){const r=await fetch('https://api.repostexchange.com/api/repost-campaigns/active/search',{method:'POST',headers:H,credentials:'include',body:JSON.stringify({Offset:o,Fetch:50})});if(!r.ok)break;const d=await r.json();T=d.Total;(d.Results||[]).forEach(x=>x.Submitter&&all.push(x.Submitter));o+=(d.Results||[]).length;if(!d.Results||!d.Results.length||o>=d.Total)break}const s=new Set(),u=[];all.forEach(x=>{if(x.ExternalId&&!s.has(x.ExternalId)){s.add(x.ExternalId);u.push(x)}});let up=0;for(let i=0;i<u.length;i+=80){const r=await fetch('https://ninja-digger.vercel.app/api/internal/soundcloud/ingest-campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submitters:u.slice(i,i+80),totalActive:T})}).then(x=>x.json()).catch(()=>({}));up+=r.upserted||0}const ts=new Date().toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'});W.innerHTML='🥷 Авто-синхр УВІМК<br>'+T+' кампаній · +'+up+' у базу<br><span style=opacity:.6>оновлено '+ts+' · клікни закладку ще раз щоб зупинити</span>'}catch(e){W.textContent='⚠️ Помилка синхр (перезайди на Re-Ex)'}};sync();window.__ndTimer=setInterval(sync,1200000)})()`;

export function ReexSync({ today, yesterday }: { today: number | null; yesterday: number | null }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">RepostExchange — активні кампанії</h2>
        {today != null && (
          <div className="text-right">
            <span className="text-2xl font-bold tabular-nums text-[var(--accent)]">{today}</span>
            {yesterday != null && (
              <span className={`ml-2 text-xs ${today >= yesterday ? "text-green-400" : "text-red-400"}`}>
                {today >= yesterday ? "▲" : "▼"} {Math.abs(today - yesterday)} vs вчора
              </span>
            )}
          </div>
        )}
      </div>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Артисти, що прямо зараз платять за промо — найвищий намір купити просування. Синхронізуй одним кліком: перетягни кнопку в панель закладок, потім відкрий RepostExchange і натисни її.
      </p>
      <a
        href={BOOKMARKLET}
        onClick={(e) => { e.preventDefault(); }}
        draggable
        className="inline-flex cursor-grab items-center gap-2 rounded-xl border border-dashed border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-2.5 text-sm font-semibold text-[var(--accent)] active:cursor-grabbing"
        title="Перетягни мене в панель закладок"
      >
        Sync Re-Ex → Ninja Digger
      </a>
      <p className="mt-2 text-[10px] text-[var(--text-muted)]">Токен Re-Ex живе 15 хв і оновлюється лише в браузері, тому синхронізація йде звідти, а не з сервера.</p>
    </div>
  );
}
