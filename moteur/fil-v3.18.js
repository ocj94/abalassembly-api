
const ROWS = [5,6,7,8,9,8,7,6,5];
const AX_DIRS=[{q:1,r:0},{q:-1,r:0},{q:0,r:-1},{q:1,r:-1},{q:0,r:1},{q:-1,r:1}];
const akey=(r,c)=>r+','+c;
function rcToAxial(row,col){ return {q: row<=4?col-row:col-4, r:row-4}; }
function axialToRc(q,rAx){ const row=rAx+4; if(row<0||row>8)return null; let col=row<=4?q+row:q+4; if(col<0||col>=ROWS[row])return null; return {r:row,c:col}; }
let board={}, capturedByBlack=0, capturedByWhite=0;
let EVAL_W={center:6,cohesion:4,edge:8,mob:2,iso:18,dng:14,chain:10,fortress:20};   // poids d'éval, adaptés au style adverse
const EVAL_AXES=[[0,1],[2,4],[3,5]];   // les 3 axes hexagonaux, en paires de directions opposees (AX_DIRS)

function selectionLine(sel){
  if(sel.length===1)return{dir:null,ordered:sel.slice()};
  if(sel.length>3)return null;
  const ax=sel.map(s=>rcToAxial(s.r,s.c));
  for(const d of AX_DIRS){
    const sorted=ax.slice().sort((a,b)=>(a.q*d.q+a.r*d.r)-(b.q*d.q+b.r*d.r));
    let ok=true;
    for(let i=1;i<sorted.length;i++){if(sorted[i].q!==sorted[i-1].q+d.q||sorted[i].r!==sorted[i-1].r+d.r){ok=false;break;}}
    if(ok)return{dir:d,ordered:sorted.map(a=>axialToRc(a.q,a.r))};
  }
  return null;
}
function validateMove(sel,dir,me){
  /* Garde de direction : AX_DIRS contient les 6 seules directions
     hexagonales legitimes. Sans ce controle, validateMove acceptait
     n'importe quel vecteur -- (99,99), (5,-3), voire (0,0) qui ne bouge
     pas. Non exploitable en jouant (l'interface ne propose que les 6),
     mais un coup VENU DE L'EXTERIEUR pouvait passer : notation Aba-Pro
     malformee, code de partie corrompu, ou coup renvoye par un moteur
     externe via le duel -- ou la revalidation systematique etait pourtant
     annoncee. Trouve en ecrivant l'audit des puzzles multi-coups. */
  if (!dir || !AX_DIRS.some(function(d){ return d.q === dir.q && d.r === dir.r; })) {
    return { valid:false, reason:'Direction invalide' };
  }

  const opp=me==='black'?'white':'black';
  const line=selectionLine(sel); if(!line)return{valid:false};
  const ax=sel.map(s=>rcToAxial(s.r,s.c));
  const lineDir=line.dir;
  const isInline=sel.length===1||(lineDir&&((dir.q===lineDir.q&&dir.r===lineDir.r)||(dir.q===-lineDir.q&&dir.r===-lineDir.r)));
  if(isInline){
    const sorted=ax.slice().sort((a,b)=>(a.q*dir.q+a.r*dir.r)-(b.q*dir.q+b.r*dir.r));
    const head=sorted[sorted.length-1];
    const front={q:head.q+dir.q,r:head.r+dir.r};
    const frontRc=axialToRc(front.q,front.r);
    if(!frontRc)return{valid:false};
    const frontCell=board[akey(frontRc.r,frontRc.c)];
    if(!frontCell)return{valid:true,type:'move',dir};
    if(frontCell===me)return{valid:false};
    let oppCount=0,cur={q:front.q,r:front.r};
    while(true){const rc=axialToRc(cur.q,cur.r);if(!rc)break;if(board[akey(rc.r,rc.c)]===opp){oppCount++;cur={q:cur.q+dir.q,r:cur.r+dir.r};}else break;}
    if(oppCount>=sel.length)return{valid:false};
    const afterRc=axialToRc(cur.q,cur.r);
    if(afterRc){if(board[akey(afterRc.r,afterRc.c)])return{valid:false};return{valid:true,type:'push',push:oppCount,ejection:false,dir,oppStart:front};}
    return{valid:true,type:'push',push:oppCount,ejection:true,dir,oppStart:front};
  }else{
    for(const a of ax){const t=axialToRc(a.q+dir.q,a.r+dir.r);if(!t)return{valid:false};if(board[akey(t.r,t.c)])return{valid:false};}
    return{valid:true,type:'broadside',dir};
  }
}
function abApplyMove(sel,dir,me,info){
  const opp=me==='black'?'white':'black';
  if(info.type==='push'){
    const oppCells=[];let cur={q:info.oppStart.q,r:info.oppStart.r};
    for(let i=0;i<info.push;i++){oppCells.push({q:cur.q,r:cur.r});cur={q:cur.q+dir.q,r:cur.r+dir.r};}
    oppCells.forEach(o=>{const rc=axialToRc(o.q,o.r);if(rc)delete board[akey(rc.r,rc.c)];});
    for(let i=oppCells.length-1;i>=0;i--){const dest={q:oppCells[i].q+dir.q,r:oppCells[i].r+dir.r};const rc=axialToRc(dest.q,dest.r);if(rc)board[akey(rc.r,rc.c)]=opp;}
  }
  const ax=sel.map(s=>rcToAxial(s.r,s.c));
  const sorted=ax.slice().sort((a,b)=>(b.q*dir.q+b.r*dir.r)-(a.q*dir.q+a.r*dir.r));
  sorted.forEach(a=>{const rc=axialToRc(a.q,a.r);if(rc)delete board[akey(rc.r,rc.c)];});
  sorted.forEach(a=>{const d=axialToRc(a.q+dir.q,a.r+dir.r);if(d)board[akey(d.r,d.c)]=me;});
}
function getAllMovesForColor(color){
  const pieces=Object.entries(board).filter(e=>e[1]===color).map(e=>{const p=e[0].split(',');return{r:+p[0],c:+p[1]};});
  const moves=[],seen=new Set(),groups=[];
  pieces.forEach(p=>groups.push([p]));
  pieces.forEach(p=>{const pAx=rcToAxial(p.r,p.c);
    AX_DIRS.forEach(d=>{const c2=axialToRc(pAx.q+d.q,pAx.r+d.r);
      if(c2&&board[akey(c2.r,c2.c)]===color){groups.push([p,c2]);
        const c3=axialToRc(pAx.q+2*d.q,pAx.r+2*d.r);
        if(c3&&board[akey(c3.r,c3.c)]===color)groups.push([p,c2,c3]);}});});
  groups.forEach(cells=>{AX_DIRS.forEach(dir=>{
    const info=validateMove(cells,dir,color);if(!info.valid)return;
    const ck=cells.map(c=>c.r+','+c.c).sort().join('|')+'>'+dir.q+','+dir.r;
    if(seen.has(ck))return;seen.add(ck);
    let code=9;
    if(info.type==='push')code=info.ejection?(cells.length===3?1:3):(cells.length===3?4:6);
    else if(info.type==='broadside')code=8;
    moves.push({cells:cells.slice(),dir,info,code,type:info.type,eject:!!(info.type==='push'&&info.ejection)});
  });});
  return moves;
}
function applyMove(move,color){
  const touched=new Set();
  move.cells.forEach(c=>{touched.add(akey(c.r,c.c));const ax=rcToAxial(c.r,c.c);const d=axialToRc(ax.q+move.dir.q,ax.r+move.dir.r);if(d)touched.add(akey(d.r,d.c));});
  if(move.info.type==='push'){let cur={q:move.info.oppStart.q,r:move.info.oppStart.r};for(let i=0;i<=move.info.push+1;i++){const rc=axialToRc(cur.q,cur.r);if(rc)touched.add(akey(rc.r,rc.c));cur={q:cur.q+move.dir.q,r:cur.r+move.dir.r};}}
  const undo=[];touched.forEach(k=>undo.push({k,v:board[k]}));undo.__captured=null;
  if(move.info.type==='push'&&move.info.ejection){if(color==='white'){capturedByWhite++;undo.__captured='white';}else{capturedByBlack++;undo.__captured='black';}}
  abApplyMove(move.cells,move.dir,color,move.info);
  return undo;
}
function undoMove(undo){
  if(undo.__captured==='white')capturedByWhite--;else if(undo.__captured==='black')capturedByBlack--;
  undo.forEach(e=>{if(e.v===undefined)delete board[e.k];else board[e.k]=e.v;});
}
const EVAL_CENTER={q:0,r:0};
function axHexDist(a,b){return(Math.abs(a.q-b.q)+Math.abs(a.q+a.r-b.q-b.r)+Math.abs(a.r-b.r))/2;}
/* ── Criteres de KAAH (demande d'ocj94 : « les integrer au moteur, tests au
   Labo »). Reimplementes ici d'apres leurs DEFINITIONS (le code de KAAH, sans
   licence, n'est pas recopie) :
     scGain / scPerte : la k-ieme ejection vaut k-1 fois le poids de plus ;
     cases  : une valeur par type de case, negative sur les 2 couronnes
              exterieures (b : -5 ; a : -10, coin -12), fois le poids ;
     compac : distance moyenne entre ses billes, comparee a l'adversaire ;
     sumito : poussees possibles (2/1, 3/1, 3/2) ; menace : celles qui ejectent ;
     fourch : chaque poussee au-dela de la premiere ;
     piege  : billes des 2 couronnes exterieures sans aucun pas vers le centre.
   Chacun compte pour soi, contre l'adversaire. Poids ABSENT = 0 = non calcule :
   l'IA habituelle (poids sans ces cles) joue exactement comme avant, sans le
   moindre surcout ; les duels du Labo remplacent EVAL_W en entier, donc un camp
   sans ces cles ne les herite jamais de l'autre. */
const _KC=(function(){const T={};for(let r=0;r<9;r++)for(let c=0;c<ROWS[r];c++){const a=rcToAxial(r,c);T[akey(r,c)]={a:a,ring:axHexDist(a,EVAL_CENTER)};}
  const opp=AX_DIRS.map(d=>AX_DIRS.findIndex(e=>e.q===-d.q&&e.r===-d.r));
  for(const k in T){const a=T[k].a;T[k].nb=AX_DIRS.map(d=>{const rc=axialToRc(a.q+d.q,a.r+d.r);return rc?akey(rc.r,rc.c):null;});
    const q=a.q-EVAL_CENTER.q,r=a.r-EVAL_CENTER.r,coin=Math.min(Math.abs(q),Math.abs(r),Math.abs(q+r));
    T[k].val=T[k].ring===3?-5:(T[k].ring===4?(coin===0?-12:-10):0);}
  return {T:T,opp:opp};})();
function _sumitosKaah(c){const o=c==='white'?'black':'white',T=_KC.T,OP=_KC.opp;let n=0,ej=0;
  for(const k in board){if(board[k]!==c)continue;const nb=T[k].nb;
    for(let d=0;d<6;d++){const t=nb[d];if(!t||board[t]!==o)continue;
      let g=1,b=nb[OP[d]];while(g<3&&b&&board[b]===c){g++;b=T[b].nb[OP[d]];}if(g<2)continue;
      let m=0,x=t;while(x&&board[x]===o&&m<3){m++;x=T[x].nb[d];}
      if(m>=g)continue;if(x&&board[x])continue;n++;if(!x)ej++;}}
  return {n:n,ej:ej};}
function _peutAvancerKaah(k,d,c){const T=_KC.T,OP=_KC.opp,o=c==='white'?'black':'white';
  let dev=0,x=T[k].nb[d];while(x&&board[x]===c&&dev<3){dev++;x=T[x].nb[d];}if(dev>=3)return false;
  let der=0,y=T[k].nb[OP[d]];while(y&&board[y]===c&&der<2-dev){der++;y=T[y].nb[OP[d]];}
  const grp=1+dev+der;if(!x)return false;if(!board[x])return true;if(board[x]!==o)return false;
  let adv=0,z=x;while(z&&board[z]===o&&adv<4){adv++;z=T[z].nb[d];}if(grp<=adv)return false;return !z||!board[z];}
function _bloqueesKaah(c){const T=_KC.T;let n=0;for(const k in board){if(board[k]!==c||T[k].ring<3)continue;const ring=T[k].ring,nb=T[k].nb;let libre=false;
  for(let d=0;d<6&&!libre;d++){const v=nb[d];if(v&&T[v].ring<ring&&_peutAvancerKaah(k,d,c))libre=true;}if(!libre)n++;}return n;}
function _compacKaah(c){const T=_KC.T,p=[];for(const k in board)if(board[k]===c)p.push(T[k].a);let s=0,n=0;
  for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){s+=axHexDist(p[i],p[j]);n++;}return n?s/n:0;}
function _termesKaah(color){const W=EVAL_W,o=color==='white'?'black':'white',R={};
  const myCap=color==='white'?capturedByWhite:capturedByBlack,thCap=color==='white'?capturedByBlack:capturedByWhite;
  R.scGain=(W.scGain||0)*myCap*(myCap-1)/2;R.scPerte=-(W.scPerte||0)*thCap*(thCap-1)/2;
  if(W.cases){let s=0;const T=_KC.T;for(const k in board){const v=board[k];if(!v)continue;s+=(v===color?1:-1)*T[k].val;}R.cases=W.cases*s;}else R.cases=0;
  R.compac=W.compac?W.compac*(_compacKaah(o)-_compacKaah(color)):0;
  if(W.sumito||W.menace||W.fourch){const a=_sumitosKaah(color),b=_sumitosKaah(o);
    R.sumito=(W.sumito||0)*(a.n-b.n);R.menace=(W.menace||0)*(a.ej-b.ej);R.fourch=(W.fourch||0)*(Math.max(0,a.n-1)-Math.max(0,b.n-1));}
  else{R.sumito=0;R.menace=0;R.fourch=0;}
  R.piege=W.piege?W.piege*(_bloqueesKaah(o)-_bloqueesKaah(color)):0;
  return R;}
function _kaahActif(){const W=EVAL_W;return !!(W.scGain||W.scPerte||W.cases||W.compac||W.sumito||W.menace||W.fourch||W.piege);}
function _kaahTotal(color){const R=_termesKaah(color);return R.scGain+R.scPerte+R.cases+R.compac+R.sumito+R.menace+R.fourch+R.piege;}
function evaluateBoard(color){
  let myCount=0,enCount=0,myCenter=0,enCenter=0,myCoh=0,enCoh=0,myEdge=0,enEdge=0,myMob=0,enMob=0,myIso=0,enIso=0,myDng=0,enDng=0,myChain=0,enChain=0,myFort=0,enFort=0;
  for(const k in board){const v=board[k];if(!v)continue;
    const p=k.split(',');const ax=rcToAxial(+p[0],+p[1]);const dist=axHexDist(ax,EVAL_CENTER);const isEdge=dist>=4;
    let allies=0,emptyN=0;for(const d of AX_DIRS){const n=axialToRc(ax.q+d.q,ax.r+d.r);if(!n)continue;const nv=board[akey(n.r,n.c)];if(nv===v)allies++;else if(!nv)emptyN++;}
    const iso=allies===0;const dng=isEdge&&allies<=1;const fort=allies>=4;
    let chainLinks=0;
    for(const[fwd,bwd] of EVAL_AXES){
      const bd=AX_DIRS[bwd];const bn=axialToRc(ax.q+bd.q,ax.r+bd.r);
      if(bn&&board[akey(bn.r,bn.c)]===v)continue;   // pas la queue de la chaine sur cet axe
      const fd=AX_DIRS[fwd];let aq=ax.q,ar=ax.r,len=1;
      while(true){aq+=fd.q;ar+=fd.r;const nrc=axialToRc(aq,ar);if(!nrc)break;if(board[akey(nrc.r,nrc.c)]!==v)break;len++;}
      if(len>=2)chainLinks+=(len-1);
    }
    if(v===color){myCount++;myCenter+=(4-dist);myCoh+=allies;if(isEdge)myEdge++;myMob+=emptyN;if(iso)myIso++;if(dng)myDng++;if(fort)myFort++;myChain+=chainLinks;}
    else{enCount++;enCenter+=(4-dist);enCoh+=allies;if(isEdge)enEdge++;enMob+=emptyN;if(iso)enIso++;if(dng)enDng++;if(fort)enFort++;enChain+=chainLinks;}}
  return (myCount-enCount)*1000+(myCenter-enCenter)*EVAL_W.center+(myCoh-enCoh)*EVAL_W.cohesion+(enEdge-myEdge)*EVAL_W.edge
    +((color==='white'?(capturedByWhite-capturedByBlack):(capturedByBlack-capturedByWhite))*1000)
    +(myMob-enMob)*EVAL_W.mob+(enIso-myIso)*EVAL_W.iso+(enDng-myDng)*EVAL_W.dng
    +(myChain-enChain)*EVAL_W.chain+(myFort-enFort)*EVAL_W.fortress
    +(_kaahActif()?_kaahTotal(color):0);
}
function evalDetail(color){
  let myCount=0,enCount=0,myCenter=0,enCenter=0,myCoh=0,enCoh=0,myEdge=0,enEdge=0,myMob=0,enMob=0,myIso=0,enIso=0,myDng=0,enDng=0,myChain=0,enChain=0,myFort=0,enFort=0;
  for(const k in board){const v=board[k];if(!v)continue;
    const p=k.split(',');const ax=rcToAxial(+p[0],+p[1]);const dist=axHexDist(ax,EVAL_CENTER);const isEdge=dist>=4;
    let allies=0,emptyN=0;for(const d of AX_DIRS){const n=axialToRc(ax.q+d.q,ax.r+d.r);if(!n)continue;const nv=board[akey(n.r,n.c)];if(nv===v)allies++;else if(!nv)emptyN++;}
    const iso=allies===0;const dng=isEdge&&allies<=1;const fort=allies>=4;
    let chainLinks=0;
    for(const[fwd,bwd] of EVAL_AXES){
      const bd=AX_DIRS[bwd];const bn=axialToRc(ax.q+bd.q,ax.r+bd.r);
      if(bn&&board[akey(bn.r,bn.c)]===v)continue;   // pas la queue de la chaine sur cet axe
      const fd=AX_DIRS[fwd];let aq=ax.q,ar=ax.r,len=1;
      while(true){aq+=fd.q;ar+=fd.r;const nrc=axialToRc(aq,ar);if(!nrc)break;if(board[akey(nrc.r,nrc.c)]!==v)break;len++;}
      if(len>=2)chainLinks+=(len-1);
    }
    if(v===color){myCount++;myCenter+=(4-dist);myCoh+=allies;if(isEdge)myEdge++;myMob+=emptyN;if(iso)myIso++;if(dng)myDng++;if(fort)myFort++;myChain+=chainLinks;}
    else{enCount++;enCenter+=(4-dist);enCoh+=allies;if(isEdge)enEdge++;enMob+=emptyN;if(iso)enIso++;if(dng)enDng++;if(fort)enFort++;enChain+=chainLinks;}}
  // Gain/Perte : ce moteur compte chaque ejection deux fois (ecart de billes + ecart de captures),
  // soit 2000 ; base = l'ecart de billes au depart (0 a armees egales), pour que la somme reste exacte.
  const myCap=color==='white'?capturedByWhite:capturedByBlack,thCap=color==='white'?capturedByBlack:capturedByWhite;
  const matCap=(myCount-enCount)*1000+(myCap-thCap)*1000,K=_kaahActif()?_termesKaah(color):{scGain:0,scPerte:0,cases:0,compac:0,sumito:0,menace:0,fourch:0,piege:0};
  return {gain:2000*myCap,perte:-2000*thCap,base:matCap-2000*(myCap-thCap),scGain:K.scGain,scPerte:K.scPerte,
    centre:(myCenter-enCenter)*EVAL_W.center,cases:K.cases,coh:(myCoh-enCoh)*EVAL_W.cohesion,compac:K.compac,
    bordM:-myEdge*EVAL_W.edge,bordA:enEdge*EVAL_W.edge,sumito:K.sumito,menace:K.menace,fourch:K.fourch,piege:K.piege,
    mob:(myMob-enMob)*EVAL_W.mob,iso:(enIso-myIso)*EVAL_W.iso,dng:(enDng-myDng)*EVAL_W.dng,chaine:(myChain-enChain)*EVAL_W.chain,fort:(myFort-enFort)*EVAL_W.fortress};
}
/* Tableau « Reflexion IA » (demande d'ocj94, sur le modele de KAAH) : evalDetail
   est une copie EXACTE de evaluateBoard ci-dessus, qui renvoie chaque critere
   pondere au lieu du total (leur somme = evaluateBoard). La suite prevue suit les
   meilleurs coups gardes dans la table de transposition (cle : billes et camp au
   trait, depuis la v3.11) ; chaque coup reste verifie LEGAL pour le camp
   attendu, sinon la suite s'arrete -- jamais de suite inventee. */
function _pvEtTermes(cle,pov,plis){
  const opp=c=>c==='white'?'black':'white';
  const m0=getAllMovesForColor(pov).find(x=>moveKey(x)===cle);if(!m0)return null;
  const us=[applyMove(m0,pov)],pv=[];let side=opp(pov);
  for(let i=0;i<plis;i++){
    if(capturedByWhite>=6||capturedByBlack>=6)break;
    const tt=TT.get(hashPos(side));if(!tt||!tt.move)break;
    const mv=getAllMovesForColor(side).find(x=>moveKey(x)===tt.move);if(!mv)break;
    pv.push({cells:mv.cells,dir:mv.dir,c:side});us.push(applyMove(mv,side));side=opp(side);
  }
  const terms=evalDetail(pov);
  for(let i=us.length-1;i>=0;i--)undoMove(us[i]);
  return {pv:pv,terms:terms};
}
/* v3.18 : les cles de hachage sortent d'une graine fixe (avant : Math.random, d'autres cles dans
   chaque fil). La force du jeu ne change pas ; mais deux fils, ou deux appareils, cherchent
   maintenant exactement pareil : une partie du Labo a profondeur fixe se refait coup pour coup,
   ce qui permet a l'ordonnanceur du serveur de verifier celles que rendent les executants. */
let _zGraine=0x2545F491;function _rand32(){_zGraine=_zGraine+0x6D2B79F5|0;let t=Math.imul(_zGraine^_zGraine>>>15,1|_zGraine);t=t+Math.imul(t^t>>>7,61|t)^t;return (t^t>>>14)>>>0;}
const ZOBRIST={};for(let r=0;r<9;r++)for(let c=0;c<ROWS[r];c++)ZOBRIST[akey(r,c)]={black:_rand32(),white:_rand32()};
function hashBoard(){let h=0;for(const k in board){const v=board[k];if(v==='black')h^=ZOBRIST[k].black;else if(v==='white')h^=ZOBRIST[k].white;}return h>>>0;}
/* Cle de la table de transposition : les billes ET le camp au trait. Avant, les billes seules :
   la meme disposition atteinte avec l'autre camp au trait (un camp qui joue en deux coups ce
   que l'autre chemin fait en un) relisait la valeur calculee pour l'autre camp. Mesure sur trois
   departs belges a la profondeur 3 : 118 notes de coups racine sur 203 fausses, jusqu'a 1957 points. */
const ZTRAIT=(_rand32()|1)>>>0;function hashPos(c){return (hashBoard()^(c==='white'?ZTRAIT:0))>>>0;}
let TT=new Map();const TT_EXACT=0,TT_LOWER=1,TT_UPPER=2;
const TT_MAX=(function(){const gb=(typeof navigator!=='undefined'&&navigator.deviceMemory)?navigator.deviceMemory:4;const budgetBytes=gb*1024*1024*1024*0.05;const bytesPerEntry=200;return Math.max(50000,Math.floor(budgetBytes/bytesPerEntry));})();
let killerMoves={},historyTable={},counterMove={};
function moveKey(m){return m.cells.map(c=>c.r+','+c.c).sort().join('|')+'>'+m.dir.q+','+m.dir.r;}
function orderMoves(moves,depth,ttMove,prevKey){
  const cm=prevKey?counterMove[prevKey]:null;
  return moves.map(m=>{let score=0;const mk=moveKey(m);
    if(ttMove&&mk===ttMove)score+=100000;score+=(10-(m.code||9))*1000;
    if(killerMoves[depth]&&killerMoves[depth].indexOf(mk)!==-1)score+=500;
    if(cm&&mk===cm)score+=300;
    score+=(historyTable[mk]||0);
    return{m,score};}).sort((a,b)=>b.score-a.score).map(x=>x.m);
}
// ---- Tables de finale 2v2/3v2 (copie identique au thread principal, module AbaTB) ----
var AbaTB = (function () {
  'use strict';

  // ---------- geometrie : 61 cases, rangees 5..9..5 ----------
  var L = [5, 6, 7, 8, 9, 8, 7, 6, 5], N = 61;
  var IDX = [], RC = [], i, r, c;
  (function () { var k = 0; for (r = 0; r < 9; r++) { IDX[r] = []; for (c = 0; c < L[r]; c++) { IDX[r][c] = k; RC[k] = [r, c]; k++; } } })();
  function cell(r, c) { return (r < 0 || r > 8 || c < 0 || c >= L[r]) ? -1 : IDX[r][c]; }
  var NB = new Int32Array(N * 6).fill(-1);
  for (i = 0; i < N; i++) {
    r = RC[i][0]; c = RC[i][1];
    var dn = (r < 4) ? [cell(r + 1, c), cell(r + 1, c + 1)] : [cell(r + 1, c - 1), cell(r + 1, c)];
    var up = (r <= 4) ? [cell(r - 1, c - 1), cell(r - 1, c)] : [cell(r - 1, c), cell(r - 1, c + 1)];
    NB[i * 6] = cell(r, c + 1); NB[i * 6 + 1] = dn[1]; NB[i * 6 + 2] = dn[0];
    NB[i * 6 + 3] = cell(r, c - 1); NB[i * 6 + 4] = up[0]; NB[i * 6 + 5] = up[1];
  }

  // ---------- les 12 symetries (D6) ----------
  var CUBE = [], CIDX = {};
  for (i = 0; i < N; i++) { var z = RC[i][0] - 4, x = RC[i][1] + Math.max(-4, -4 - z); CUBE[i] = [x, -x - z, z]; CIDX[CUBE[i].join(',')] = i; }
  var SYM = [];
  (function () {
    function rot(v) { return [-v[2], -v[0], -v[1]]; }
    function ref(v) { return [v[0], v[2], v[1]]; }
    for (var m = 0; m < 2; m++) for (var k = 0; k < 6; k++) {
      var p = new Int8Array(N);
      for (var i = 0; i < N; i++) { var v = CUBE[i].slice(); if (m) v = ref(v); for (var t = 0; t < k; t++) v = rot(v); p[i] = CIDX[v.join(',')]; }
      SYM.push(p);
    }
  })();

  // ---------- index des paires / triplets ----------
  var PAIRS = [], PIDX = new Int32Array(N * N).fill(-1);
  for (i = 0; i < N; i++) for (var j = i + 1; j < N; j++) { PIDX[i * N + j] = PAIRS.length; PAIRS.push([i, j]); }
  var NP = PAIRS.length;
  function pid(a, b) { return a < b ? PIDX[a * N + b] : PIDX[b * N + a]; }
  var TIDX = new Int32Array(N * N * N).fill(-1), NT = 0;
  for (i = 0; i < N; i++) for (var j2 = i + 1; j2 < N; j2++) for (var k2 = j2 + 1; k2 < N; k2++) TIDX[(i * N + j2) * N + k2] = NT++;
  function tid(a, b, cc) { var t, x = a, y = b, z = cc; if (x > y) { t = x; x = y; y = t; } if (y > z) { t = y; y = z; z = t; } if (x > y) { t = x; x = y; y = t; } return TIDX[(x * N + y) * N + z]; }

  var canonG = new Int8Array(NP), canonRep = new Int32Array(NP), REPS = null;
  function buildCanon(reps) {
    REPS = reps; var rank = {}; for (var q = 0; q < reps.length; q++) rank[reps[q]] = q;
    for (var p = 0; p < NP; p++) {
      var a = PAIRS[p][0], b = PAIRS[p][1], best = p, bg = 0;
      for (var g = 0; g < 12; g++) { var u = pid(SYM[g][a], SYM[g][b]); if (u < best) { best = u; bg = g; } }
      canonRep[p] = rank[best]; canonG[p] = bg;
    }
  }

  // ---------- generateur de coups (lisible ; appele une fois par coup) ----------
  function genMoves(occ, me) {
    var opp = me === 1 ? 2 : 1, out = [], own = [], i;
    for (i = 0; i < N; i++) if (occ[i] === me) own.push(i);
    var groups = [];
    for (i = 0; i < own.length; i++) groups.push({ g: [own[i]], a: -1 });
    for (i = 0; i < own.length; i++) for (var a = 0; a < 3; a++) {
      var p = own[i], q = NB[p * 6 + a];
      if (q === -1 || occ[q] !== me) continue;
      groups.push({ g: [p, q], a: a });
      var s = NB[q * 6 + a];
      if (s !== -1 && occ[s] === me) groups.push({ g: [p, q, s], a: a });
    }
    for (var gi = 0; gi < groups.length; gi++) {
      var G = groups[gi].g, ax = groups[gi].a, n = G.length;
      for (var d = 0; d < 6; d++) {
        var inline = (n === 1) || (d === ax) || (d === (ax + 3) % 6);
        if (inline) {
          var head = (n === 1) ? G[0] : (d === ax ? G[n - 1] : G[0]);
          var tail = (n === 1) ? G[0] : (d === ax ? G[0] : G[n - 1]);
          var front = NB[head * 6 + d];
          if (front === -1 || occ[front] === me) continue;
          if (occ[front] === 0) { out.push({ cells: G.slice(), d: d, k: 0, tail: tail, front: front }); continue; }
          var k = 0, p2 = front;
          while (p2 !== -1 && occ[p2] === opp && k < 3) { k++; p2 = NB[p2 * 6 + d]; }
          if (k >= n || k > 2) continue;
          if (p2 !== -1 && occ[p2] !== 0) continue;
          out.push({ cells: G.slice(), d: d, k: k, tail: tail, front: front });
        } else {
          var ok = true;
          for (var z2 = 0; z2 < n; z2++) { var t2 = NB[G[z2] * 6 + d]; if (t2 === -1 || occ[t2] !== 0) { ok = false; break; } }
          if (ok) out.push({ cells: G.slice(), d: d, k: 0, tail: null, front: null });
        }
      }
    }
    return out;
  }
  function applyMove(occ, mv, me) {
    var b = Int8Array.from(occ), opp = me === 1 ? 2 : 1, ejected = false, i;
    if (mv.k > 0) {
      var pushed = [], q = mv.front;
      for (i = 0; i < mv.k; i++) { pushed.push(q); q = NB[q * 6 + mv.d]; }
      for (i = pushed.length - 1; i >= 0; i--) {
        var to = NB[pushed[i] * 6 + mv.d];
        b[pushed[i]] = 0;
        if (to === -1) ejected = true; else b[to] = opp;
      }
    }
    for (i = 0; i < mv.cells.length; i++) b[mv.cells[i]] = 0;
    for (i = 0; i < mv.cells.length; i++) b[NB[mv.cells[i] * 6 + mv.d]] = me;
    return { occ: b, eject: ejected };
  }

  // ---------- tables ----------
  var T22 = null, T32 = null;
  function toMap(json) { var m = new Map(); for (var i = 0; i < json.entries.length; i++) m.set(json.entries[i][0], json.entries[i]); return m; }

  function loadFrom(j22, j32) {
    T22 = toMap(j22); T32 = toMap(j32); buildCanon(j32.orbit_reps);
    return { '2v2': T22.size, '3v2': T32.size };
  }

  // ---------- conversion depuis le plateau du jeu ----------
  function fromBoard(board) {
    var occ = new Int8Array(N);
    for (var key in board) {
      var v = board[key]; if (v !== 'black' && v !== 'white') continue;
      var p = key.split(','), idx = cell(+p[0], +p[1]);
      if (idx !== -1) occ[idx] = (v === 'black') ? 1 : 2;
    }
    return occ;
  }
  function cellsOf(occ, col) { var a = []; for (var i = 0; i < N; i++) if (occ[i] === col) a.push(i); return a; }
  function rc(i) { return RC[i][0] + ',' + RC[i][1]; }

  // ---------- consultation ----------
  // renvoie la valeur pour le camp au trait : 1 gain, 2 perte, 0 nulle ; ou null hors table
  function lookup(occ, me) {
    var B = cellsOf(occ, 1), W = cellsOf(occ, 2);
    var mine = me === 1 ? B : W, his = me === 1 ? W : B;
    if (mine.length === 2 && his.length === 2) {
      if (!T22) return null;
      var idx = (pid(B[0], B[1]) * NP + pid(W[0], W[1])) * 2 + (me === 1 ? 0 : 1);
      var e = T22.get(idx);
      return e ? { v: e[1], dtw: e[2] } : { v: 0, dtw: 0 };
    }
    var strong = (B.length === 3 && W.length === 2) ? B : (W.length === 3 && B.length === 2) ? W : null;
    if (!strong) return null;
    if (!T32) return null;
    var weak = (strong === B) ? W : B;
    var turn = (mine === strong) ? 0 : 1;
    var wp = pid(weak[0], weak[1]), g = canonG[wp], S = SYM[g];
    var idx2 = (canonRep[wp] * NT + tid(S[strong[0]], S[strong[1]], S[strong[2]])) * 2 + turn;
    var e2 = T32.get(idx2);
    return e2 ? { v: e2[1], dtw: e2[2] } : { v: 0, dtw: 0 };
  }

  // consultation publique + meilleurs coups (par comparaison des positions filles)
  function probe(board, color) {
    var me = (color === 'black') ? 1 : 2, occ = fromBoard(board);
    var here = lookup(occ, me);
    if (!here) return null;
    var moves = genMoves(occ, me), best = [], bestRank = null;
    for (var i = 0; i < moves.length; i++) {
      var res = applyMove(occ, moves[i], me), rank;
      if (res.eject) rank = { v: 1, dtw: 1 };                       // ejection : voir RESULTS.md
      else {
        var ch = lookup(res.occ, me === 1 ? 2 : 1);
        if (!ch) continue;
        rank = (ch.v === 2) ? { v: 1, dtw: ch.dtw + 1 } : (ch.v === 1) ? { v: 2, dtw: ch.dtw + 1 } : { v: 0, dtw: 0 };
      }
      // preference : gain (0) > nulle (1) > perte (2) ; gain le plus court, perte la plus longue
      rank.pref = (rank.v === 1) ? 0 : (rank.v === 0) ? 1 : 2;
      rank.after = res.occ;
      var better = !bestRank || rank.pref < bestRank.pref ||
        (rank.pref === bestRank.pref && (rank.pref === 0 ? rank.dtw < bestRank.dtw : rank.dtw > bestRank.dtw));
      if (better) { bestRank = rank; best = [{ m: moves[i], r: rank }]; }
      else if (rank.pref === bestRank.pref && rank.dtw === bestRank.dtw) best.push({ m: moves[i], r: rank });
    }
    return {
      wdl: here.v === 1 ? 'WIN' : here.v === 2 ? 'LOSS' : 'DRAW',
      dtw: here.dtw,
      moves: best.map(function (e) {
        var m = e.m, after = {};
        for (var q = 0; q < N; q++) if (e.r.after[q]) after[rc(q)] = (e.r.after[q] === 1) ? 'black' : 'white';
        return {
          from: m.cells.map(rc),
          to: m.cells.map(function (x) { return rc(NB[x * 6 + m.d]); }),
          push: m.k,
          eject: (m.k > 0 && NB[m.front * 6 + m.d] === -1) || (m.k === 2 && NB[NB[m.front * 6 + m.d] * 6 + m.d] === -1),
          after: after            // plateau resultant : sert a apparier avec le coup du moteur
        };
      })
    };
  }

  return { loadFrom: loadFrom, probe: probe, _internals: { fromBoard: fromBoard, lookup: lookup, RC: RC, PAIRS: PAIRS, SYM: SYM } };
})();
  var D22 = "zwQRbhECEWwR8BoRcBFqEWwRsBYR1gMRcBHUARFqEcgVEXYR4AIRcBG8AhFoEeIUEboEEQwR7AQRmhMR1gMR9hgR1gMRcBGGGBHWAxFwEYYYEdYDEXARhhgR1gMRcBHKARGUBhGoEBHGBBHeBBGGBRGiDhHWAxFwEYYYEdYDEfYYEdYDEXARhhgR1gMRcBGGGBHWAxFwEYYYEdYDEXAR+AYR8AURngsR1gMRcBHUCRHoBBHKCRHWAxFwEYYYEdYDEXARhhgR1gMRcBGGGBHWAxFwEYYYEdYDEXARhhgR1gMRcBGGGBHWAxFwEZAMEZgFEd4GEdYDEXARiAQRpAoR5gMR9AUR1gMRcBGGGBHWAxFwEYYYEdYDEXARhhgR1gMRcBGGGBHWAxFwEYYYEdYDEXARhhgR1gMRcBGGGBHWAxFwEbgIEaoIEeIDEcIDEdYDEXAR4gkR1AgR0AUR1gMRcBGGGBHWAxFwEYYYEdYDEXARhhgR1gMRcBGGGBHWAxFwEYYYEdYDEXARhhgR1gMRcBHqDBGABxGcBBHWAxFwEfwOEYIGEYgDEdYDEXARhhgR1gMRcBGGGBHWAxFwEYYYEdYDEXARhhgR1gMRcBGGGBHWAxFwEfIQEeYEEa4CEdYDEXAR8hIRwgMR0gER1gMRcBGGGBHWAxFwEYYYEdYDEXARhhgR1gMRcBGGGBHWAxFwEfgTEd4CEbABEdYDEXAR6BQRQBHaARGEARHWAxFwEYoVETwRwAIR1gMRcBGqFRE4EaQCEdYDEXARyBURNBGKAhHWAxFwEeQVETARdBEJEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEccEEWwRAhFqEfQaEW4RaBFqEb4WEc4DEW4R0AERaBGcGREKEW4RgAQRzBgR3hsRzBwRbhHeGxFuEd4bEW4RXhGUBhHsFBFuEfIDEYYFEdQTEd4bEW4R3hsRzBwRbhHeGxFuEd4bEW4RjAYR8AUR4g8RbhHoCBHoBBGODhFuEd4bEW4R3hsRbhHeGxFuEd4bEW4R3hsRbhHeGxFuEaQLEZgFEaILEW4RnAMRpAoR5gMRuAoRbhHeGxFuEd4bEW4R3hsRbhHeGxFuEd4bEW4R3hsRbhHeGxFuEcwHEaoIEeIDEYYIEW4R9ggR1AgRlAoRbhHeGxFuEd4bEW4R3hsRbhHeGxFuEd4bEW4R3hsRbhH+CxGABxHgCBFuEZAOEYIGEcwHEW4R3hsRbhHeGxFuEd4bEW4R3hsRbhHeGxFuEYYQEeYEEfIGEW4RhhIRwgMRlgYRbhHeGxFuEd4bEW4R3hsRbhHeGxFuEYwTEd4CEfQFEW4R/BMRQBHaARHIBRFuEZ4UETwRhAcRbhG+FBE4EegGEW4R3BQRNBHOBhFuEfgUETARdBELEXYR2AIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHnARFqEQIRaBH4GhFsEWYRaBGcGRF2EWwRlgMRyhgRbBHMHBHgGxHMHBFsEeAbEWARDBGIBhHYFRFsEYgDEYYFEdITEWwRzBwR4BsRbBHgGxHMHBFsEeAbEWwRogUR8AURzhARbBH+BxHoBBH6DhFsEeAbEWwR4BsRbBHgGxFsEeAbEWwR4BsRbBHgGxFsEboKEZgFEY4MEWwRsgIRpAoR5gMRpAsRbBHgGxFsEeAbEWwR4BsRbBHgGxFsEeAbEWwR4BsRbBHgGxFsEeIGEaoIEeIDEfIIEWwRjAgR1AgRgAsRbBHgGxFsEeAbEWwR4BsRbBHgGxFsEeAbEWwR4BsRbBGUCxGABxHMCRFsEaYNEYIGEbgIEWwR4BsRbBHgGxFsEeAbEWwR4BsRbBHgGxFsEZwPEeYEEd4HEWwRnBERwgMRggcRbBHgGxFsEeAbEWwR4BsRbBHgGxFsEaISEd4CEeAGEWwRkhMRQBHaARG0BhFsEbQTETwR8AcRbBHUExE4EdQHEWwR8hMRNBG6BxFsEY4UETARdBGYBxFoEQIRZhGcGRHgARFqEa4CEbQZEWoR4hsRahHMHBHiGxHCHBEKEWoRoAURwhYRahGgAhGGBRG8FBFqEeIbEWoRzBwR4hsRahHiGxHMHBFqEboEEfAFEbgREWoRlgcR6AQR5A8RahHiGxFqEeIbEWoR4hsRahHiGxFqEeIbEWoR4hsRahHSCRGYBRH4DBFqEcoBEaQKEeYDEY4MEWoR4hsRahHiGxFqEeIbEWoR4hsRahHiGxFqEeIbEWoR4hsRahH6BRGqCBHiAxHcCRFqEaQHEdQIEeoLEWoR4hsRahHiGxFqEeIbEWoR4hsRahHiGxFqEeIbEWoRrAoRgAcRtgoRahG+DBGCBhGiCRFqEeIbEWoR4hsRahHiGxFqEeIbEWoR4hsRahG0DhHmBBHICBFqEbQQEcIDEewHEWoR4hsRahHiGxFqEeIbEWoR4hsRahG6ERHeAhHKBxFqEaoSEUAR2gERngcRahHMEhE8EdoIEWoR7BIROBG+CBFqEYoTETQRpAgRahGmExEwEXQR9AERxAMRyAIRaBHIARGQFBGMBhFoEdgVEYwGEWgR2BURjAYRaBHYFRH0BhHYFRGaBRFyEaIFEZ4REYwGEWgRugERhgURmA8RjAYRaBHYFRGMBhFoEdgVEYwGEWgR2BUR9AYR2BURjAYRaBHYFRGMBhG8BBHwBRGUDBGMBhFoEbAGEegEEcAKEYwGEWgR2BURjAYRaBHYFRGMBhFoEdgVEYwGEWgR2BURjAYRaBHYFRGMBhFoEdgVEYwGEWgR7AgRmAUR1AcRjAYRaBFkEaQKEeYDEeoGEYwGEWgR2BURjAYRaBHYFRGMBhFoEdgVEYwGEWgR2BURjAYRaBHYFRGMBhFoEdgVEYwGEWgR2BURjAYRaBGUBRGqCBHiAxG4BBGMBhFoEb4GEdQIEcYGEYwGEWgR2BURjAYRaBHYFRGMBhFoEdgVEYwGEWgR2BURjAYRaBHYFRGMBhFoEdgVEYwGEWgRxgkRgAcRkgURjAYRaBHYCxGCBhH+AxGMBhFoEdgVEYwGEWgR2BURjAYRaBHYFRGMBhFoEdgVEYwGEWgR2BURjAYRaBHODRHmBBGkAxGMBhFoEc4PEcIDEcgCEYwGEWgR2BURjAYRaBHYFRGMBhFoEdgVEYwGEWgR2BURjAYRaBHUEBHeAhGmAhGMBhFoEcQREUAR2gER+gERjAYRaBHmERE8EbYDEYwGEWgRhhIROBGaAxGMBhFoEaQSETQRgAMRjAYRaBHAEhEwEXQRsAoRzBwR1BcR+AQR1BcR+AQR1BcR1gERogMR8gIRrw8RAhECEQIRBBECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRvQQR6gQRDhH4BBHcEhHMHBH4BBHUFxH4BBHUFxH4BBHUFxH4BBHUFxH4BBGMAhHwBRHYDxH4BBHoBBHoBBGEDhH4BBHUFxHMHBH4BBHUFxH4BBHUFxH4BBHUFxH4BBHUFxH4BBGkBxGYBRGYCxGUBBFkEcAJEeYDEa4KEfgEEdQXEfgEEdQXEfgEEdQXEfgEEdQXEfgEEdQXEfgEEdQXEfgEEdQXEfgEEcwDEaoIEeIDEfwHEfgEEfYEEdQIEYoKEfgEEdQXEfgEEdQXEfgEEdQXEfgEEdQXEfgEEdQXEfgEEdQXEfgEEf4HEYAHEdYIEfgEEZAKEYIGEcIHEfgEEdQXEfgEEdQXEfgEEdQXEfgEEdQXEfgEEdQXEfgEEYYMEeYEEegGEfgEEYYOEcIDEYwGEfgEEdQXEfgEEdQXEfgEEdQXEfgEEdQXEfgEEYwPEd4CEeoFEfgEEfwPEUAR2gERvgUR+AQRnhARPBH6BhH4BBG+EBE4Ed4GEfgEEdwQETQRxAYR+AQR+BARMBF0EQ0RdhF0EXIRcBF0EQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRvVcRlAYRzBkRhgURqQ0ReBECEQIRAhEEEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR4BoRAhECEQIRAhEEEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR8X0R8AURuBkR6AQR6MUBEZgFEawPEaQKEeYDEYbbARGqCBHiAxHqERHUCBHIwgERgAcR3hcRggYRvKcBEeYEEeYZEcIDEcCMARHeAhHeGhFAEdoBEdQaETwRsBwROBGyHBE0EbQcETARdBGmQBGUBhHMGRGGBRH3KRF2EXYRAhECEQIRBBECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHsGRF4EQIRAhECEQIRBBECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGvYBHwBRG4GRHoBBHoxQERmAURrA8RpAoR5gMRhtsBEaoIEeIDEeoREdQIEcjCARGABxHeFxGCBhG8pwER5gQR5hkRwgMRwIwBEd4CEd4aEUAR2gER1BoRPBGwHBE4EbIcETQRtBwRMBF0ERcRdhF0EXIRcBFuEWwRahG0AhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEbEgEcwZEYYFEcVGEXYRdBF0EQIRAhECEQQRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEfwYEXYRdhECEQIRAhECEQQRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEe9CEfAFEbgZEegEEejFARGYBRGsDxGkChHmAxGG2wERqggR4gMR6hER1AgRyMIBEYAHEd4XEYIGEbynARHmBBHmGRHCAxHAjAER3gIR3hoRQBHaARHUGhE8EbAcETgRshwRNBG0HBEwEXQRog0RzBkRhgURk2MRdhF0EXIRchECEQIRAhEEEQIRAhECEQIRBBEC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mAURtBcRmAURtBcRmAURtBcRmAURtBcR4gQRNhGwBBGEExGYBRHKARHCAxGoEhGYBRG0FxGYBRG0FxGYBRG0FxGYBRG0FxGYBRHQAhHeAhGGEhGYBRHAAxFAEdoBEdoREZgFEeIDETwRlhMRmAURggQROBH6EhGYBRGgBBE0EeASEZgFEbwEETARdBHMCRGKDhHCDhGKDhHCDhGkChHmAxHCDhGkChHmAxHCDhGkChHmAxHCDhGkChHmAxHCDhGkChHmAxHCDhGwBBH0BRG2AhGwARGyAhGQDBHaBRHKBBGKBBGeDhGkChHmAxHCDhGkChHmAxHCDhGkChHmAxHCDhGkChHmAxHCDhGkChHmAxHCDhGkChHmAxHCDhHiCBHCARHmAxHYARHqDBGkChFQEYIGEdYLEaQKEeYDEcIOEaQKEeYDEcIOEaQKEeYDEcIOEaQKEeYDEcIOEaQKEeYDEcIOEaQKEcYCEaABEcYDEfwKEaQKEeYDEWARwgMRoAoRpAoR5gMRwg4RpAoR5gMRwg4RpAoR5gMRwg4RpAoR5gMRwg4RpAoR5gMR5gER3gIR/gkRpAoR5gMR1gIRQBHaARHSCRGkChHmAxH4AhE8EY4LEaQKEeYDEZgDETgR8goRpAoR5gMRtgMRNBHYChGkChHmAxHSAxEwEXQRNxF2EXQRchFwEW4RbBFqEWgRZhFkEWIRYBFeEVwRWhFYEVYRVBFSEVARThFMEUoRSBFGEUoRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHXpQERqggR4gMRvhoR+QQRdhF0EXIRcBFuEWwRahFoEWYRZBFiEWARXhFcEVoRWBFWEVYRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR4a4BEYAHEd4XEYIGEbynARHmBBHmGRHCAxHAjAER3gIR3hoRQBHaARHUGhE8EbAcETgRshwRNBG0HBEwEXQR+JwBEaoIEeIDEeoREdQIEasFEXYRdBFyEXARbhFsEWoRaBFmEWQRYhFgEV4RXBFaEVgRVhFUEVIRUBFOEUwRShFIEUYRRBFCEX4RPBE6ETgRNhE0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EVIRUBFOEUwRShFIEUYRRBFCEUARPhE8EToROBE2ETQRMhEwES4RLBEqESgRJhEkESIRIBEeERwRGhEYERYRGhECEQIRAhECEQIRAhECEatTEd4CEd4aEZoCEZAbEbAcETgRshwRNBG0HBEwEXQR1FIR3gIR3hoRQBHaARHUGhGkHRGyHBE0EbQcETARdBFxEXYRdBFyEXARbhFsEWoRaBFmEWQRYhFgEV4RXBFaEVgRVhFUEVIRUBFOEUwRShFIEUYRRBFCEUARPhE8EToROBE2ETQRMhEwES4RLBEqESgRJhEkESIRIBEeERwRGhEYERYRFBESERARJhECEQIRAhECEc0ZEbwdEUAR2gER1BoRPBGwHBGeHRG0HBEwEXQRvBkRvB0RQBHaARHUGhE8EbAcETgRshwRmB0RdBG8GRFwEUARrgERLBHCGRGSARE8EZABEe4ZEbIBETgRdBHuGRHQARE0EVoR7hkR7AERchEyEawaESIRHhEeEe4bEUARAhE4EdIbEUARIBE0EYYBEbIaEUARPBEwEW4RBhFzEXYRdBFyEXARbhFsEWoRaBFmEWQRYhFgEV4RXBFaEVgRVhFUEVIRUBFOEUwRShFIEUYRRBFCEUARPhE8EToROBE2ETQRMhEwES4RLBEqESgRJhEkESIRFxEJERcRBxEVEQcRFREFERgRFhEUERIREBEOEQwRChEOEQIR1xoRPBECETQR2hsRPBEeETARdBF7EXYRdBFyEXARbhFsEWoRaBFmEWQRYhFgEV4RXBFaEVgRVhFUEVIRUBFOEUwRShFIEUYRRBFCEUARPhE8EToROBE2ETQRMhEwES4RLBEqESgRJhEkESIRIBEPEQ8RDxENEQ0RDRENEQsRFhEUERIREBEOEQwRChEIEQYR8RoROBECETARgBwRHBEYERgR";
  var D32 = "sjYRBBfoARFkEwIVCBECEQIVahGcFxFkFwoRAhFsEawWEW4RAhFsEaIWFQIXBhECEQIRAhVeFwYRAhMCEwIRYhFmEWQRZBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEwIVXhXQERUBJgEXBBUCEQEkAREBIgERASQBFQgVAhMCEwIVThcGEQIRAhMCFWARAhFiEQIRYBECEWARASIBEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEBJAERAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhUKFQITAhWqAxNSE1AVmAwXBhUCEwIRZhFkEWIRXhMCEQoVAhNSEQwVAhNQEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEcQSF2AXiEsVChMEE1oV6BAXDBXIrAIRAhUCFWAVChUCEQEkARUMFQIVUBcIFwIRAhVmFwQRiAMVDhVSFQ4VpiwRcBFqEWwRwhURcBFqEWwRwBURBBFmEQITAhFkEQIXAhcEEV4RZBFkEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIXAhVeFdARFQgTAhEBIgETDBMCE1YXAhEBJgETAhEKFwIXVhFkEWAXAhFgEQEmARUMFwIXUBEBJAERAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhUKFQITrAMXUhVQFaAMEQIXAhFiEWQRYhFgEQIXDBNSEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR/hARZBFiEVwXBBEKF1QRDBdQEVwRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEfZIFQoXBBdaFfQQFeqpAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gERcBHUARFqEbwWEXAR1AERahHSLRFwEdQBEWoR2BQRBBFmEWgRBhFgEQoRWhFkEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEbwSEWgRAhFkEQYRXhFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEf4QEWoR2BQRBBFgEWIRYBFeEV4RAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRohARYhFgEV4RXBFaEVoRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHs7wIRASIDEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRCBMCE+QBEXARYBNqE3IRaBHsExECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEXwRcBG8AhFoEeQUEWQTDBFgE9wBEWgR+isRBBFmEWgRZhEIEVwRDBFYEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEbISEwoRaBFmEQQRYBEIEVoRYBFgEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR9BATchFoEfQTEWgR8hMRBBFeEWARXhFcEVwRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEcgPEWARXhFcEVoRWBFYEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEYTcAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gER6hkR+BgRiBgR8BgRaBFmEWQRZBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHmKBUCE5gDFcJgE7AWEYqlAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gERcBH6GBFwEYgYEXARmBcRcBGWFxEEEc4BEWYRZBFkEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEaQTEWYRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECERAVgLADEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHuARFwEfoYEXARiBgRcBGYFxFwEZYXEQQRZhHOARFkEWQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRvBIRzgERZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZCwAxECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gERcBH6GBFwEYgYEXARmBcRcBGWFxEEEWYRaBHKARFkEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEbwSEWgRygERYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGQsAMRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEe4BEXARygERlAYRnBERcBHKARGUBhGqEBFwEcoBEZQGEboPEXARygERlAYRuA8RBBFmEWQRBBFmEcgBEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEYIDEboPEWARCBFmEcYBEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEcQBEbAPEZQGEbIPEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRyAQR9hMRwiUR0BER8hARlhARvA8Rug8RVBFSEVARThFMEUwRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRgvUBEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHuARHqGRH4GBGIGBGGGBFqEWgRZhFkEWQRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEfzHAxECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gERcBH6GBFwEYgYEXARmBcRcBGWFxEEEWYRaBFmEWQRZBECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRvBIRaBFmEWQRYhFgEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRkLADEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHuARFwEfoYEXARiBgRcBGYFxFwEZYXEQQRZhFoEWYRZBFkEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhG8EhFoEWYRZBFiEWARYBEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGQsAMRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEe4BEXAR+hgRcBGIGBFwEZgXEXARlhcRBBFmEWgRZhFkEWQRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEbwSEWgRZhFkEWIRYBFgEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZCwAxECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gERcBH4BhHwBRGSDBFwEfgGEfAFEaALEXAR+AYR8AURsAoRcBH4BhHwBRGuChEEEWYRaBFmEWQRZBECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRnAIR8AURsAoRaBFmEWQRYhFgEWARAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRXhHwBRHUDxHwBRHsDhHwBRGGDhHwBRGiDRHwBRHADBHwBRHgCxHwBRGCCxHwBRGmChHwBRGoChECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHABBHkDhHIGxHoDBGYDBHKCxH+ChG0ChGyChFEEUIRQBE+ETwROhE6EQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZKRARECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gERcBH6GBFwEYgYEXARmBcRcBGWFxEEEWYRaBFmEWQRZBECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRvBIRaBFmEWQRYhFgEWARAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRkLADEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHuARFwEfoYEXARiBgRcBGYFxFwEZYXEQQRZhFoEWYRZBFkEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhG8EhFoEWYRZBFiEWARYBECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGQsAMRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEe4BEXAR+hgRcBGIGBFwEZgXEXARlhcRBBFmEWgRZhFkEWQRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEbwSEWgRZhFkEWIRYBFgEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZCwAxECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gERcBH6GBFwEYgYEXARmBcRcBGWFxEEEWYRaBFmEWQRZBECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRvBIRaBFmEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRkLADEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHuARFwEZAMEZgFEdIHEXARkAwRmAUR4AYRcBGQDBGYBRHwBRFwEZAMEZgFEe4FEQQRZhFoEWYRZBFkEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhG0BxGYBRHwBRFoEWYRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH2BRGYBRGsEBGYBRHEDxGYBRHeDhGYBRH6DRGYBRGYDRGYBRG4DBGYBRHaCxGYBRH+ChGYBRGkChGYBRHMCRGYBRH2CBGYBRGiCBGYBRHQBxGYBRGABxGYBRGyBhGYBRHmBRGYBRHoBRECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEYgEEewJEYgSEaAIEeAHEaIHEeYGEawGEfQFEfIFETIRMBEuESwRKhEoESgRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRhkwRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEe4BEXAR+hgRcBGIGBFwEZgXEXARlhcRBBFmEWgRZhFkEWQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEbwSEWgRZhFkEWIRYBFgEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZCwAxECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gERcBH6GBFwEYgYEXARmBcRcBGWFxEEEWYRaBFmEWQRZBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRvBIRaBFmEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRkLADEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHuARFwEfoYEXARiBgRcBGYFxFwEZYXEQQRZhFoEWYRZBFkEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhG8EhFoEWYRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGQsAMRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEe4BEXAR+hgRcBGIGBFwEZgXEXARlhcRBBFmEWgRZhFkEWQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEbwSEWgRZhFkEWIRYBFgEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZCwAxECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gERcBG4CBGqCBHiAxG2BBFwEbgIEaoIEeIDEcQDEXARuAgRqggR4gMR1AIRcBG4CBGqCBHiAxHSAhEEEWYRaBFmEWQRZBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR3AMRqggR4gMR1AIRaBFmEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRngIRqggR4gMRuAkRqggR4gMR0AgRqggR4gMR6gcRqggR4gMRhgcRqggR4gMRpAYRqggR4gMRxAURqggR4gMR5gQRqggR4gMRigQRqggR4gMRsAMRqggR4gMR2AIRqggR4gMR1gIRUhFQEU4RTBFKEUgRSBECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH8AhHiAxHYCRHiAxGGCRHiAxG2CBHiAxHoBxHiAxGcBxHiAxHSBhHiAxGKBhHiAxHEBRHiAxGABRHiAxG+BBHiAxH+AxHiAxHAAxHiAxGEAxHiAxHKAhHiAxHMAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEfYCEb4FEeIJEagEEfoDEc4DEaQDEfwCEdYCEdQCESARHhEcERoRGBEYEQIRAhECEQIRAhECEQIRAhECEQIRpCkRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEe4BEXAR+hgRcBGIGBFwEZgXEXARlhcRBBFmEWgRZhFkEWQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEbwSEWgRZhFkEWIRYBFgEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZCwAxECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gERcBH6GBFwEYgYEXARmBcRcBGWFxEEEWYRaBFmEWQRZBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRvBIRaBFmEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRkLADEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHuARFwEfoYEXARiBgRcBGYFxFwEZYXEQQRZhFoEWYRZBFkEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhG8EhFoEWYRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGQsAMRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEe4BEXAR6gwRgAcRkAURcBHqDBGABxGeBBFwEeoMEYAHEa4DEXAR6gwRgAcRrAMRBBFmEWgRZhFkEWQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEY4IEYAHEa4DEWgRZhFkEWIRYBFgEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEdAGEYAHEcQOEYAHEdwNEYAHEfYMEYAHEZIMEYAHEbALEYAHEdAKEYAHEfIJEYAHEZYJEYAHEbwIEYAHEeQHEYAHEY4HEYAHEboGEYAHEegFEYAHEZgFEYAHEcoEEYAHEf4DEYAHEbQDEYAHEbIDEUQRQhFAET4RPBE6ETgROBECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZwCEaYJEeIIEaAIEeAHEaIHEeYGEawGEfQFEb4FEYoFEdgEEagEEfoDEc4DEaQDEaYDEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGUMBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIR7gERcBH6GBFwEYgYEXARmBcRcBGWFxEEEWYRaBFmEWQRZBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRvBIRaBFmEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRkLADEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhHuARFwEfoYEXARiBgRcBGYFxFwEZYXEQQRZhFoEWYRZBFkEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhG8EhFoEWYRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhGQsAMRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEe4BEXAR8hAR5gQRogMRcBHyEBHmBBGwAhFwEfIQEeYEEcABEXAR8hAR5gQRvgERBBFmEWgRZhFkEWQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEZYMEeYEEcABEWgRZhFkEWIRYBFgEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEdgKEeYEEd4QEeYEEfYPEeYEEZAPEeYEEawOEeYEEcoNEeYEEeoMEeYEEYwMEeYEEbALEeYEEdYKEeYEEf4JEeYEEagJEeYEEdQIEeYEEYIIEeYEEbIHEeYEEeQGEeYEEZgGEeYEEc4FEeYEEYYFEeYEEcAEEeYEEfwDEeYEEboDEeYEEfoCEeYEEbwCEeYEEYACEeYEEcYBEeYEEcQBETQRMhEwES4RLBEqESgRKBECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRogERvgURigUR2AQRqAQR+gMRzgMRpAMR/AIR1gIRsgIRkAIR8AER0gERtgERuAERAhECEQIRAhECEQIRAhECEQIRAhGWIRECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIR7gERcBH6GBFwEYgYEXARmBcRcBGWFxEEEWYRaBFmEWQRZBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRvBIRaBFmEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRkLADEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhHuARFwEfgTEd4CEaQCEXAR+BMR3gIRsgERcBH4ExHeAhFCEXAR+BMR3gIRQBEEEWYRaBFmEWQRZBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRnA8R3gIRQhFoEWYRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhHeDRHeAhHmEhHeAhH+ERHeAhGYERHeAhG0EBHeAhHSDxHeAhHyDhHeAhGUDhHeAhG4DRHeAhHeDBHeAhGGDBHeAhGwCxHeAhHcChHeAhGKChHeAhG6CRHeAhHsCBHeAhGgCBHeAhHWBxHeAhGOBxHeAhHIBhHeAhGEBhHeAhHCBRHeAhGCBRHeAhHEBBHeAhGIBBHeAhHOAxHeAhGWAxHeAhHgAhHeAhGsAhHeAhH6ARHeAhHKARHeAhGcARHeAhFwEd4CEUYR3gIRRBEkESIRIBEeERwRGhEaEQIRAhECEQIRAhEEEQIRAhECEQIRThHWAhGyAhGQAhHwARHSARG2ARGcARGEARFuEVoRSBE4EToRAhECEQIRAhG6HBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR8AERcBHkFREwEXQR8gERcBHkFREwEXQRgAERcBHkFREwEXQREBFwEeQVETARdBEOEQQRZhFoEWYRZBFkEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGKEREwEXQREBFoEWYRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHMDxEwEXQRoBQRMBF0EbgTETARdBHSEhEwEXQR7hERMBF0EYwRETARdBGsEBEwEXQRzg8RMBF0EfIOETARdBGYDhEwEXQRwA0RMBF0EeoMETARdBGWDBEwEXQRxAsRMBF0EfQKETARdBGmChEwEXQR2gkRMBF0EZAJETARdBHICBEwEXQRgggRMBF0Eb4HETARdBH8BhEwEXQRvAYRMBF0Ef4FETARdBHCBREwEXQRiAURMBF0EdAEETARdBGaBBEwEXQR5gMRMBF0EbQDETARdBGEAxEwEXQR1gIRMBF0EaoCETARdBGAAhEwEXQR2AERMBF0EbIBETARdBGOAREwEXQRbBEwEXQRTBEwEXQRLhEwEXQREhEwEXQREBEWEQIREhESERARDhEOEQIRAhECEQIRHBEQEXQRDhESERARDhEMEQwRAhECEQIREhFaEUgROBEqER4RFBEMEQYRzAQRbBECEWoR6EsRbBECEWoRsBYRbBECEWoRwhURbBECEWoRuBUVCBECEQIRZBECFQQRYBFkEWIRYhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhPWERUCEQEkARECEQoVAhVWEQIRYhECEWARAhFeEQIRXhEBIgERAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGwAxNQE54MFQQRZBFiEWARXBMCEQoVUhEMFVARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEcZaFQoTBBPWkgIRbhFoEWoRiDIRbhFoEWoRwC4RbhFoEWoR2hQRbhFoEWoR2BQRBBFkEQITAhFiEQgRXBFiEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEdoREwIRASIBEwwTAhNWEQITAhFgEWIRYBFeEV4RAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRDhOSEBEEEWARYhFgEV4RDhNQEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEaIQEWIRYBFeEVwRWhFaEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR0tgCEQoRahMEEYAEEdAvEQITCBEEE2oRgAQRgBQRChFuEYAEEZATEQoRbhGABBG8KRECEQIRAhECEQEiARECEQEiARECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEIEQQTAhNgEWQRYhEOEwITUhECEQIRAhECEQIRAhECEQEiARECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEwwTAhNeE6oDExATUhPeDBMEEWYRZBFiEV4TAhEKEwIRUhEME1IRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR0hIR9hMRkhMRsBIRohITDBFcEVoRWBFWEVQRUhFSEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEeyfAhHINBH4GBGIGBGaFxHWLBMEEWYRZBFiEWARXhEOE1ARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRul4TlgQRuA0V2JICEcg0EfgYEYgYEZoXEYAYEWYRZBFiEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEa4qFdZcE8QVEZb9ARFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBHKARFkEWIRYhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRwhIRZBFiEWARXhFeEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEeCCAxFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBFkEcoBEWIRYhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR3BERygERYhFgEV4RXhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHgggMRbhFeEZQGEegsEW4RXhGUBhGYERFuEV4RlAYRqBARbhFeEZQGEboPEW4RXhGUBhG4DxEEEV4RBhFmEcYBEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEaICEbAPEQoRZhHGARFgEV4RXhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhFoEbIPEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRyAQR9hMRwiUR0BER8hARlhARvA8Rug8RVBFSEVARThFMEUwRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR/NwBFQwTahFqFQQR8gMRhgUR4ioRbhHyAxGGBRGSDxFuEfIDEYYFEaIOEW4R8gMRhgURqg0VChECE2gVBBHyAxGGBRGyDREBJAEVAhEKFQIVWBFmEWQRxAERASIBEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhMKEwITigQTEBFCE+4MFQQRZhFkEcABEQIRChVUEQwVUhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHuAhHWDxGGBRHwDhGGBRGMDhGGBRHaHxECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEcoDEfIQEZYQEbwPEeQOEY4OEboNEbgNEU4RTBFKEUgRRhFEEUIRQhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEdyzARHINBH4GBGIGBGaFxGuFhHSBBP4BBPiDBFmEWQRYhG+ARFeEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEeCCAxFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBFkEWYRZBFiEWQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHcERFmEWQRYhFgEbwBEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEeCCAxHINBH4GBGIGBGaFxGYFxFoEWYRZBFiEWIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHemQMRbhHaMxFuEYoYEW4RmhcRbhGsFhFuEaoWEQQRZBFmEWQRYhFiEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR3BERZhFkEWIRYBFeEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEeCCAxFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBFkEWYRZBFiEWIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHcERFmEWQRYhFgEV4RXhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR4IIDEW4RjAYR8AUR3icRbhGMBhHwBRGODBFuEYwGEfAFEZ4LEW4RjAYR8AURsAoRbhGMBhHwBRGuChEEEWQRZhFkEWIRYhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEbwBEfAFEbAKEWYRZBFiEWARXhFeEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEfAFEewOEfAFEYYOEfAFEaINEfAFEcAMEfAFEeALEfAFEYILEfAFEaYKEfAFEagKEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEcAEEeQOEcgbEegMEZgMEcoLEf4KEbQKEbIKEUQRQhFAET4RPBE6EToRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRgnoRbhHaMxFuEYoYEW4RmhcRbhGsFhFuEaoWEQQRZBFmEWQRYhFiEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR3BERZhFkEWIRYBFeEV4RAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEeCCAxFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBFkEWYRZBFiEWIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHcERFmEWQRYhFgEV4RXhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR4IIDEW4R2jMRbhGKGBFuEZoXEW4RrBYRbhGqFhEEEWQRZhFkEWIRYhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEdwREWYRZBFiEWARXhFeEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHgggMRbhHaMxFuEYoYEW4RmhcRbhGsFhFuEaoWEQQRZBFmEWQRYhFiEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR3BERZhFkEWIRYBFeEV4RAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEeCCAxFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBFkEWYRZBFiEWIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHcERFmEWQRYhFgEV4RXhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR4IIDEW4R2jMRbhGKGBFuEZoXEW4RrBYRbhGqFhEEEWQRZhFkEWIRYhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEdwREWYRZBFiEWARXhFeEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHgggMRbhGkCxGYBRGeIxFuEaQLEZgFEc4HEW4RpAsRmAUR3gYRbhGkCxGYBRHwBRFuEaQLEZgFEe4FEQQRZBFmEWQRYhFiEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR1AYRmAUR8AURZhFkEWIRYBFeEV4RAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZoFEZgFEcQPEZgFEd4OEZgFEfoNEZgFEZgNEZgFEbgMEZgFEdoLEZgFEf4KEZgFEaQKEZgFEcwJEZgFEfYIEZgFEaIIEZgFEdAHEZgFEYAHEZgFEbIGEZgFEeYFEZgFEegFEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRiAQR7AkRiBIRoAgR4AcRogcR5gYRrAYR9AUR8gURMhEwES4RLBEqESgRKBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH2NBFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBFkEWYRZBFiEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHcERFmEWQRYhFgEV4RXhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR4IIDEW4R2jMRbhGKGBFuEZoXEW4RrBYRbhGqFhEEEWQRZhFkEWIRYhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEdwREWYRZBFiEWARXhFeEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHgggMRbhHaMxFuEYoYEW4RmhcRbhGsFhFuEaoWEQQRZBFmEWQRYhFiEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR3BERZhFkEWIRYBFeEV4RAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEeCCAxFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBFkEWYRZBFiEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHcERFmEWQRYhFgEV4RXhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR4IIDEW4R2jMRbhGKGBFuEZoXEW4RrBYRbhGqFhEEEWQRZhFkEWIRYhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEdwREWYRZBFiEWARXhFeEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHgggMRbhHaMxFuEYoYEW4RmhcRbhGsFhFuEaoWEQQRZBFmEWQRYhFiEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR3BERZhFkEWIRYBFeEV4RAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEeCCAxFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBFkEWYRZBFiEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHcERFmEWQRYhFgEV4RXhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR4IIDEW4R9ggR1AgRkCIRbhH2CBHUCBHABhFuEfYIEdQIEdAFEW4R9ggR1AgR4gQRbhH2CBHUCBHgBBEEEWQRZhFkEWIRYhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEaYEEdQIEeIEEWYRZBFiEWARXhFeEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHsAhHUCBGIDBHUCBGiCxHUCBG+ChHUCBHcCRHUCBH8CBHUCBGeCBHUCBHCBxHUCBHoBhHUCBGQBhHUCBG6BRHUCBHmBBHUCBHkBBFOEUwRShFIEUYRRBFEEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRygMRmAwRygsR/goRtAoR7AkRpgkR4ggRoAgR4AcRogcR5gYRrAYR9AURvgURigURsAkRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGQKBFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBFkEWYRZBFiEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHcERFmEWQRYhFgEV4RXhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR4IIDEW4R2jMRbhGKGBFuEZoXEW4RrBYRbhGqFhEEEWQRZhFkEWIRYhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEdwREWYRZBFiEWARXhFeEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHgggMRbhHaMxFuEYoYEW4RmhcRbhGsFhFuEaoWEQQRZBFmEWQRYhFiEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR3BERZhFkEWIRYBFeEV4RAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEeCCAxFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBFkEWYRZBFiEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHcERFmEWQRYhFgEV4RXhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR4IIDEW4R2jMRbhGKGBFuEZoXEW4RrBYRbhGqFhEEEWQRZhFkEWIRYhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEdwREWYRZBFiEWARXhFeEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhEC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AhECEeCCAxFuEdozEW4RihgRbhGaFxFuEawWEW4RqhYRBBFkEWYRZBFiEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHcERFmEWQRYhFgEV4RXhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR4IIDEW4R2jMRbhGKGBFuEZoXEW4RrBYRbhGqFhEEEWQRZhFkEWIRYhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEdwREWYRZBFiEWARXhFeEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhHgggMRbhHaMxFuEYoYEW4RmhcRbhGsFhFuEaoWEQQRZBFmEWQRYhFiEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIR3BERZhFkEWIRYBFeEV4RAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEeCCAxFuEYYQEeYEEe4eEW4RhhAR5gQRngMRbhGGEBHmBBGuAhFuEYYQEeYEEcABEW4RhhAR5gQRvgERBBFkEWYRZBFiEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhG2CxHmBBHAARFmEWQRYhFgEV4RXhECEQIR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EdYCEbICEZACEfABEdIBEbYBEZwBEYQBEW4RWhFIETgROhECEQIRAhECEaoFEW4RnhQRPBGAHxFuEZ4UETwRsAMRbhGeFBE8EcACEW4RnhQRPBHSARFuEZ4UETwR0AERBBFkEWYRZBFiEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhHODxE8EdIBEWYRZBFiEWARXhFeEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhGUDhE8EaAUETwRuhMRPBHWEhE8EfQRETwRlBERPBG2EBE8EdoPETwRgA8RPBGoDhE8EdINETwR/gwRPBGsDBE8EdwLETwRjgsRPBHCChE8EfgJETwRsAkRPBHqCBE8EaYIETwR5AcRPBGkBxE8EeYGETwRqgYRPBHwBRE8EbgFETwRggURPBHOBBE8EZwEETwR7AMRPBG+AxE8EZIDETwR6AIRPBHAAhE8EZoCETwR9gERPBHUARE8EdIBERwRAhEYERgRFhEUERQRAhECEQIRAhEEEQIRAhFUEdABERgRFhEUERIREhECEQIRAhEEEQIRAhHWChFuEb4UETgR5B4RbhG+FBE4EZQDEW4RvhQROBGkAhFuEb4UETgRtgERbhG+FBE4EbQBEQQRZBFmEWQRYhFiEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIR7g8ROBG2ARFmEWQRYhFgEV4RXhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRtA4ROBGkFBE4Eb4TETgR2hIROBH4ERE4EZgRETgRuhAROBHeDxE4EYQPETgRrA4ROBHWDRE4EYINETgRsAwROBHgCxE4EZILETgRxgoROBH8CRE4EbQJETgR7ggROBGqCBE4EegHETgRqAcROBHqBhE4Ea4GETgR9AUROBG8BRE4EYYFETgR0gQROBGgBBE4EfADETgRwgMROBGWAxE4EewCETgRxAIROBGeAhE4EfoBETgR2AEROBG4ARE4EbYBERoRAhEWERYRFBESERIRAhECEQIRAhEEEQIRRBG0AREWERQREhEQERARAhECEQIRBBECEawJEW4R3BQRNBHKHhFuEdwUETQR+gIRbhHcFBE0EYoCEW4R3BQRNBGcARFuEdwUETQRmgERBBFkEWYRZBFiEWIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBGMEBE0EZwBEWYRZBFiEWARXhFeEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBHSDhE0EagUETQRwhMRNBHeEhE0EfwRETQRnBERNBG+EBE0EeIPETQRiA8RNBGwDhE0EdoNETQRhg0RNBG0DBE0EeQLETQRlgsRNBHKChE0EYAKETQRuAkRNBHyCBE0Ea4IETQR7AcRNBGsBxE0Ee4GETQRsgYRNBH4BRE0EcAFETQRigURNBHWBBE0EaQEETQR9AMRNBHGAxE0EZoDETQR8AIRNBHIAhE0EaICETQR/gERNBHcARE0EbwBETQRngERNBGcAREYEQIRFBEUERIREBEQEQIRAhECEQIRBBE2EZoBERQREhEQEQ4RDhECEQIRAhEEEYgJEWwR8hkRbBH2AxWALhFsEZwXEWwRrhYRbBHsKxUCEQQRYhFkEWIRYBFgEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR/hARZBFiEWARXhEMF1ARXBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRhEkXzhEVsJQCEd4aEeIyEYgYEZoXEa4WEYYrEWQRYhFgEV4RXBFcEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHUWhOKBBG4jwIRbBGIAxGGBRH4EBNsEWwRiAMRhgUR6CkRbBGIAxGGBRGODxFsEYgDEYYFEaoNE3YRbBGIAxGGBRGyDRMCEWwRiAMRhgURsg0RBBFiEWQRwgERASIBEwwTAhNQEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRugMTEBFCE/IMEWQRvgERAhMCEV4RXBFcEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGUAhHwDhGGBRGMDhGGBRHaHxECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQ4TvAMR8hARlhARvA8R5A4Rjg4Rug0RuA0RThFMEUoRSBFGEUQRQhFCEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR2rMBEWwR8hkRbBH2MRFsEZwXEWwRrhYRbBHCFRFsEcAVEQQRYhFkEWIRwAERAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH+EBFkEWIRvgERXBFcEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGC7wIR3hoR4jIRiBgRmhcRrhYRxBURwhURZBFiEWARugERXBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRlu4CEWwR8hkRbBH2MRFsEZwXEWwRrhYRbBHCFRFsEcAVEQQRYhFkEWIRYBFiEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEf4QEWQRYhFgEV4RuAERAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZbuAhFsEfIZEWwR9jERbBGcFxFsEa4WEWwRwhURbBHAFREEEWIRZBFiEWARYBECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH+EBFkEWIRYBFeEVwRXBECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZbuAhFsEfIZEWwR9jERbBGcFxFsEa4WEWwRwhURbBHAFREEEWIRZBFiEWARYBECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH+EBFkEWIRYBFeEVwRXBECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZbuAhFsEfIZEWwR9jERbBGcFxFsEa4WEWwRwhURbBHAFREEEWIRZBFiEWARYBECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH+EBFkEWIRYBFeEVwRXBECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZbuAhFsEfIZEWwR9jERbBGcFxFsEa4WEWwRwhURbBHAFREEEWIRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH+EBFkEWIRYBFeEVwRXBECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZbuAhFsEfIZEWwR9jERbBGcFxFsEa4WEWwRwhURbBHAFREEEWIRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH+EBFkEWIRYBFeEVwRXBECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZbuAhFsEfIZEWwR9jERbBGcFxFsEa4WEWwRwhURbBHAFREEEWIRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH+EBFkEWIRYBFeEVwRXBECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZbuAhFsEfIZEWwR9jERbBGcFxFsEa4WEWwRwhURbBHAFREEEWIRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH+EBFkEWIRYBFeEVwRXBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZbuAhFsEfIZEWwR9jERbBGcFxFsEa4WEWwRwhURbBHAFREEEWIRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH+EBFkEWIRYBFeEVwRXBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZbuAhFsEfIZEWwR9jERbBGcFxFsEa4WEWwRwhURbBHAFREEEWIRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH+EBFkEWIRYBFeEVwRXBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZbuAhFsEfIZEWwR9jERbBGcFxFsEa4WEWwRwhURbBHAFREEEWIRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhH+EBFkEWIRYBFeEVwRXBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEZbuAhFsEaYNEYIGEcoGEWwRpg0RggYRzh4RbBGmDRGCBhH0AxFsEaYNEYIGEYYDEWwRpg0RggYRmgIRbBGmDRGCBhGYAhEEEWIRZBFiEWARYBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhHiCBGCBhGaAhFkEWIRYBFeEVwRXBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEawHEYIGEfQNEYIGEZANEYIGEa4MEYIGEc4LEYIGEfAKEYIGEZQKEYIGEboJEYIGEeIIEYIGEYwIEYIGEbgHEYIGEeYGEYIGEZYGEYIGEcgFEYIGEfwEEYIGEbIEEYIGEeoDEYIGEaQDEYIGEeACEYIGEZ4CEYIGEZwCETwROhE4ETYRNBEyETIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGaAhGiBxHmBhGsBhH0BRG+BRGKBRHYBBGoBBH6AxHOAxGkAxH8AhHWAhGyAhGgBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR5A8RbBHyGRFsEfYxEWwRnBcRbBGuFhFsEcIVEWwRwBURBBFiEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR/hARZBFiEWARXhFcEVwRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGW7gIRbBHyGRFsEfYxEWwRnBcRbBGuFhFsEcIVEWwRwBURBBFiEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR/hARZBFiEWARXhFcEVwRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGW7gIRbBHyGRFsEfYxEWwRnBcRbBGuFhFsEcIVEWwRwBURBBFiEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIR/hARZBFiEWARXhFcEVwRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhGW7gIRbBHyGRFsEfYxEWwRnBcRbBGuFhFsEcIVEWwRwBURBBFiEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEQIRAhECEQIRAhECEQIR/hARZBFiEWARXhFcEVwRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIRAhGW7gIRbBHyGRFsEfYxEWwRnBcRbBGuFhFsEcIVEWwRwBURBBFiEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRAhECEQIRAhECEQIR/hARZBFiEWARXhFcEVwRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQQRAhECEQIRAhECEQIRAhGW7gIRbBHUExE4EeYFEWwR1BMROBHqHRFsEdQTETgRkAMRbBHUExE4EaICEWwR1BMROBG2ARFsEdQTETgRtAERBBFiEWQRYhFgEWARAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhEEEQIRkA8ROBG2ARFkEWIRYBFeEVwRXBECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRAhECEQIRBBECEdoNETgRvhMROBHaEhE4EfgRETgRmBEROBG6EBE4Ed4PETgRhA8ROBGsDhE4EdYNETgRgg0ROBGwDBE4EeALETgRkgsROBHGChE4EfwJETgRtAkROBHuCBE4EaoIETgR6AcROBGoBxE4EeoGETgRrgYROBH0BRE4EbwFETgRhgUROBHSBBE4EaAEETgR8AMROBHCAxE4EZYDETgR7AIROBHEAhE4EZ4CETgR+gEROBHYARE4EbgBETgRtgERGhECERYRFhEUERIREhECEQIRAhECEQQRAhFEEbQBERYRFBESERAREBECEQIRAhEEEQIR";
  var REPS = [0,1,2,3,5,6,7,8,9,12,13,14,15,16,20,21,22,23,24,29,30,31,32,33,38,39,40,41,46,47,48,53,54,59,60,61,63,64,65,66,67,68,69,70,71,72,73,74,75,77,78,79,80,81,82,83,85,86,87,88,89,90,91,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,109,110,111,112,113,115,116,117,122,123,127,128,129,130,135,136,137,143,144,145,146,152,153,154,159,160,161,162,167,168,174,345,346,347,351,352,353,354,359,360,361,362,368,369,370,371,377,378,379,385,386,392,399,403,404,405,406,407,411,412,413,414,415,419,420,421,422,423,427,428,429,430,431,432,436,437,438,439,443,444,702,703,709,710,711,718,719,720,727,728,735,754,755,763,764,771,772,780,1050,1058,1059,1067];
  function unpack(b64) {
    var raw = atob(b64), n = raw.length, out = [], i = 0, prev = 0;
    while (i < n) {
      var d = 0, s = 0, c;
      do { c = raw.charCodeAt(i++); d |= (c & 127) << s; s += 7; } while (c & 128);
      prev += d;
      var p = raw.charCodeAt(i++);
      out.push([prev, p >> 4, p & 15]);
    }
    return out;
  }
  AbaTB.loadFrom({ entries: unpack(D22) }, { entries: unpack(D32), orbit_reps: REPS });
  AbaTB.ready = true;

// Probe des tables de finale 2v2/3v2 (mode Decouverte) pendant la recherche.
// mc = camp au trait a ce noeud, pov = camp pour lequel le score est rendu
// (meme convention que tout search()/quiescence() : score positif = bon pour pov).
function probeTablebase(mc,pov){
  if(typeof AbaTB==='undefined'||!AbaTB.ready)return null;
  let total=0;for(const k in board)if(board[k])total++;
  if(total>5)return null;
  const r=AbaTB.probe(board,mc);
  if(!r)return null;
  if(r.wdl==='DRAW')return 0;
  const forPov=(r.wdl==='WIN')===(mc===pov);
  return forPov?(100000-r.dtw):-(100000-r.dtw);
}
function quiescence(alpha,beta,pov,maxi,qd){
  if(capturedByWhite>=6)return pov==='white'?100000:-100000;
  if(capturedByBlack>=6)return pov==='black'?100000:-100000;
  const mc=maxi?pov:(pov==='white'?'black':'white');
  const tbv0=probeTablebase(mc,pov);if(tbv0!==null)return tbv0;
  const sp=evaluateBoard(pov);if(qd<=0)return sp;
  if(maxi){if(sp>=beta)return beta;if(sp>alpha)alpha=sp;}else{if(sp<=alpha)return alpha;if(sp<beta)beta=sp;}
  const moves=getAllMovesForColor(mc).filter(m=>m.eject);
  for(const m of moves){const u=applyMove(m,mc);const s=quiescence(alpha,beta,pov,!maxi,qd-1);undoMove(u);
    if(maxi){if(s>alpha)alpha=s;if(alpha>=beta)break;}else{if(s<beta)beta=s;if(beta<=alpha)break;}}
  return maxi?alpha:beta;
}
let _nodes=0,_ttLk=0,_ttHit=0,_metrics=null,_cuts=0;
/* Observatoire IA (v3.05) : quand la page le demande (message { observe: ms }), le fil envoie des
   mesures PENDANT le calcul. Rien de ce qui suit ne change un choix du moteur : un compteur de
   coupures, et des envois de mesures espaces (au moins _obs ms) entre deux coups racine, ou tous
   les 8192 noeuds. Sans demande, _obs vaut null et le seul cout est un test par noeud. */
let _obs=null,_obsT=0,_obsCtx=null;
function _obsEnvoie(fin){
  if(!_obs||!_obsCtx||typeof self==='undefined'||typeof self.postMessage!=='function')return;
  const now=Date.now();if(!fin&&now-_obsT<_obs)return;_obsT=now;
  const c=_obsCtx;
  self.postMessage({progress:1,w:c.w,d:c.d,max:c.max,i:c.i,n:c.n,cur:c.cur,nodes:_nodes,cuts:_cuts,
    tt:_ttLk?Math.round(100*_ttHit/_ttLk):0,ms:now-c.t0,fin:fin?1:0,roots:c.roots,depths:c.depths,pv:fin&&c.pv?c.pv:null});
}
function search(depth,alpha,beta,maxi,pov,prevKey){
  _nodes++;
  if(_obs&&(_nodes&8191)===0)_obsEnvoie(false);
  const ao=alpha;
  if(capturedByWhite>=6)return pov==='white'?100000:-100000;
  if(capturedByBlack>=6)return pov==='black'?100000:-100000;
  const mc=maxi?pov:(pov==='white'?'black':'white');
  const tbv=probeTablebase(mc,pov);if(tbv!==null)return tbv;
  const h=hashPos(mc);const tt=TT.get(h);_ttLk++;
  if(tt&&tt.depth>=depth){_ttHit++;if(tt.flag===TT_EXACT)return tt.value;
    if(tt.flag===TT_LOWER&&tt.value>alpha)alpha=tt.value;else if(tt.flag===TT_UPPER&&tt.value<beta)beta=tt.value;
    if(alpha>=beta)return tt.value;}
  if(depth===0)return quiescence(alpha,beta,pov,maxi,4);
  let moves=getAllMovesForColor(mc);if(!moves.length)return maxi?-99999:99999;
  moves=orderMoves(moves,depth,tt?tt.move:null,prevKey);
  let best=maxi?-Infinity:Infinity,bestMove=null;
  for(const m of moves){const mk=moveKey(m);const u=applyMove(m,mc);const s=search(depth-1,alpha,beta,!maxi,pov,mk);undoMove(u);
    if(maxi){if(s>best){best=s;bestMove=m;}if(best>alpha)alpha=best;}else{if(s<best){best=s;bestMove=m;}if(best<beta)beta=best;}
    if(alpha>=beta){_cuts++;if(!killerMoves[depth])killerMoves[depth]=[];
      if(killerMoves[depth].indexOf(mk)===-1){killerMoves[depth].unshift(mk);if(killerMoves[depth].length>2)killerMoves[depth].pop();}
      historyTable[mk]=(historyTable[mk]||0)+depth*depth;
      if(prevKey)counterMove[prevKey]=mk;
      break;}}
  let flag=TT_EXACT;if(best<=ao)flag=TT_UPPER;else if(best>=beta)flag=TT_LOWER;
  if(TT.size<TT_MAX)TT.set(h,{depth,value:best,flag,move:bestMove?moveKey(bestMove):null});
  return best;
}
function _repKeyOf(bd){let s='';for(let r=0;r<9;r++){for(let c=0;c<ROWS[r];c++){const v=bd[r+','+c];s+=v?(v==='black'?'b':'w'):'-';}}return s;}
function _repCountMap(h){if(!h||!h.length)return null;const m=new Map();for(const k of h)m.set(k,(m.get(k)||0)+1);return m;}
/* Aller-retour (v2.60) : meme regle que _allerRetourRef cote page (voir son commentaire) --
   un coup qui remet MES billes comme avant mon coup precedent coute 140*n*n, n <= 3. */
function _mesBillesCle(k,pov){return k.replace(pov==='black'?/w/g:/b/g,'-');}
function _allerRetourRef(hist,pov){if(!hist||hist.length<3)return null;const D=[];
  for(let i=hist.length-1;i>=0&&D.length<8;i-=2)D.push(_mesBillesCle(hist[i],pov));
  let n=1;for(let k=0;k+2<D.length&&D[k]===D[k+2]&&n<3;k++)n++;return {cle:D[1],n:n};}
function searchBestMove(pov,maxDepth,timeLimit,hist,workerIndex,workerCount){
  const start=Date.now();let bestMove=null,bestScore=-Infinity,reached=0,lastRoots=null,lastRootsDepth=0;
  const rootsByDepth={},ejCache={},opp=(pov==='black'?'white':'black');
  const depthInfo={},posTerms=evalDetail(pov);   // tableau « Reflexion IA » : bilan par profondeur, criteres de la position
  killerMoves={};historyTable={};counterMove={};TT.clear();_nodes=0;_ttLk=0;_ttHit=0;_cuts=0;
  if(_obs)_obsCtx={w:workerIndex||0,d:0,max:maxDepth,i:0,n:0,cur:null,t0:start,roots:[],depths:[]};
  const repCount=_repCountMap(hist),ar=_allerRetourRef(hist,pov);
  const split=(workerCount>1);   // partage des racines entre plusieurs workers (voir requestAIMovePooled)
  for(let d=1;d<=maxDepth;d++){
    let moves=getAllMovesForColor(pov);if(!moves.length)break;
    /* Le partage par index doit porter sur un ordre STABLE.
       getAllMovesForColor parcourt board avec Object.entries, donc dans
       l'ordre d'INSERTION des cles -- et applyMove/undoMove font delete puis
       reaffectation, ce qui renvoie les cles touchees a la fin. Le CONTENU du
       plateau est bien restaure (verifie separement : undoMove n'est pas en
       cause), mais son ordre de cles ne l'est pas. Des la profondeur 2 chaque
       worker regenere donc une liste ordonnee differemment, et le filtre
       idx%workerCount cesse d'etre une partition : certains coups sont
       cherches par plusieurs workers, d'autres par aucun. Mesure sur une
       Belgian Daisy reelle : 33 des 52 coups changent d'index apres un seul
       aller-retour applyMove/undoMove, et avec 3 workers 11 coups sur 52
       n'etaient examines par AUCUN worker. L'IA pouvait donc etre
       structurellement aveugle a son meilleur coup, sans aucun signe visible
       -- pas de plantage, pas de message, juste un choix parfois moins bon.
       Le tri par moveKey (canonique : cases triees + direction) rend le
       partage deterministe et reellement disjoint a toutes les profondeurs.
       N'affecte pas l'ordonnancement alpha-beta : orderMoves passe apres. */
    if(split){moves=moves.slice().sort(function(a,b){const ka=moveKey(a),kb=moveKey(b);return ka<kb?-1:(ka>kb?1:0);}).filter(function(m,idx){return idx%workerCount===workerIndex;});if(!moves.length)break;}
    moves=orderMoves(moves,d,null);
    /* v2.60 -- profondeur coupee par le minuteur : le coup rendu etait le meilleur
       des SEULS coups deja examines a cette profondeur, souvent le premier de la
       liste, meme bien pire que le meilleur de la profondeur precedente. Mesure
       sur 132 recherches coupees a la profondeur 3 (positions de vraies parties,
       horloge factice pour couper toujours au meme endroit) : 61 rendaient un
       coup pire que le meilleur de la profondeur 2, jusqu'a 2010 points (une
       bille) ; apres correction, aucun. Et la penalite d'aller-retour ne compte
       que si les autres coups ont ete examines.
       Le meilleur coup de la profondeur precedente est donc examine EN PREMIER :
       une profondeur coupee rend un coup au moins aussi bon que lui a cette
       profondeur. A score egal, l'ordre d'avant decide (meme choix qu'avant
       quand la profondeur va au bout). */
    const rang=new Map();moves.forEach(function(m,i){rang.set(m,i);});
    if(bestMove){const bk=moveKey(bestMove);const ip=moves.findIndex(function(m){return moveKey(m)===bk;});if(ip>0)moves.unshift(moves.splice(ip,1)[0]);}
    let lb=null,ls=-Infinity,alpha=-Infinity,roots=[],cut=false;const _nd0=_nodes,_td0=Date.now(),_cu0=_cuts;
    if(_obsCtx){_obsCtx.d=d;_obsCtx.n=moves.length;_obsCtx.i=0;_obsCtx.roots=[];}
    for(const m of moves){const mk=moveKey(m);const _n0=_nodes,_t0=Date.now();if(_obsCtx)_obsCtx.cur=mk;const u=applyMove(m,pov);let s=search(d-1,-Infinity,Infinity,false,pov,mk);
      const ck=(repCount||ar)?_repKeyOf(board):null;
      if(repCount){const rc=repCount.get(ck);if(rc)s-=140*rc*rc;}
      if(ar&&_mesBillesCle(ck,pov)===ar.cle)s-=140*ar.n*ar.n;
      /* Menace adverse IMMEDIATE apres ce coup : compte exact des ejections
         dont dispose l'adversaire au pli suivant. Un fait verifiable a 1 pli,
         pas une projection -- ce moteur n'enregistre aucune variante
         principale, donc toute phrase du type "ejection dans 3 coups" serait
         inventee. Calcule ici, board encore dans l'etat POST-coup (avant
         undoMove), et mis en cache par coup : une seule generation de coups
         par racine pour toute la recherche, pas une par profondeur. Si le
         coup termine la partie (6e capture), l'adversaire n'a pas de reponse
         du tout : 0, et non le nombre de coups d'une position deja finie. */
      if(ejCache[mk]===undefined){
        if(capturedByWhite>=6||capturedByBlack>=6){ejCache[mk]=0;}
        else{const og=getAllMovesForColor(opp);let ne=0;for(let i=0;i<og.length;i++)if(og[i].eject)ne++;ejCache[mk]=ne;}
      }
      undoMove(u);
      roots.push({cells:m.cells,dir:m.dir,type:m.type,eject:m.eject,score:s,oppEject:ejCache[mk],key:mk,k:_nodes-_n0,ms:Date.now()-_t0,t:Date.now()-start});
      if(_obsCtx){_obsCtx.i++;_obsCtx.roots.push([mk,s,_nodes-_n0,ejCache[mk]|0]);_obsEnvoie(false);}
      if(s>ls||(s===ls&&lb&&rang.get(m)<rang.get(lb))){ls=s;lb=m;}if(s>alpha)alpha=s;if(Date.now()-start>timeLimit){cut=true;break;}}
    // bestScore=ls (pas lastRoots[0].score) : correct meme si cette profondeur a
    // ete coupee par le minuteur avant d'explorer tous les coups — lastRoots ne
    // change alors pas (garde la profondeur precedente, complete), donc le lire
    // pour "le score du coup choisi" donnerait un score d'une AUTRE profondeur
    // que celle qui a reellement produit bestMove. Trouve et corrige en testant
    // le partage multi-worker (requestAIMovePooled) : le meme coup rapportait
    // deux scores differents (0 vs 38) selon qu'il venait d'une recherche coupee
    // ou complete — pas un bug de calcul, un bug de RAPPORT du score correct.
    if(lb){bestMove=lb;bestScore=ls;reached=d;if(!cut){lastRoots=roots;lastRootsDepth=d;rootsByDepth[d]=roots;
      // profondeur complete : bilan, puis suite prevue et criteres de ses 10 meilleurs coups
      depthInfo[d]={nodes:_nodes-_nd0,ms:Date.now()-_td0,fin:Date.now()-start,cuts:_cuts-_cu0};
      const _top10=roots.slice().sort((a,b)=>b.score-a.score).slice(0,10);
      _top10.forEach(function(r){const x=_pvEtTermes(r.key,pov,d-1);if(x){r.pv=x.pv;r.terms=x.terms;}});
      /* v3.17 : le message « profondeur terminee » emporte la suite prevue de ses 10 meilleurs coups
         (calculee juste avant, comme avant : rien ne change dans la recherche), pour l'arbre en direct */
      if(_obsCtx){_obsCtx.depths.push([d,_nodes-_nd0,Date.now()-_td0,_cuts-_cu0,Math.round(ls)]);
        _obsCtx.pv={};_top10.forEach(function(r){if(r.pv)_obsCtx.pv[r.key]=r.pv;});_obsEnvoie(true);_obsCtx.pv=null;}}}
    if(Date.now()-start>timeLimit)break;}
  const top=lastRoots?lastRoots.slice().sort((a,b)=>b.score-a.score).slice(0,5):null;
  /* rootsByDepth : liste COMPLETE des coups racine de ce worker, rangee par
     profondeur. Indispensable en multi-worker : chaque worker ne recoit que
     1/N des coups racine (filtre idx%workerCount ci-dessus), donc son "top 5"
     local n'est PAS le top 5 de la position. requestAIMovePooled fusionne ces
     listes a la profondeur commune la plus grande -- melanger des scores
     obtenus a des profondeurs differentes ne voudrait rien dire. */
  _metrics={nodes:_nodes,cuts:_cuts,depth:reached,time:Date.now()-start,ttHit:_ttLk?Math.round(100*_ttHit/_ttLk):0,rootMoves:top,rootsByDepth:rootsByDepth,rootDepth:lastRootsDepth,bestScore:bestScore,
    depthInfo:depthInfo,posTerms:posTerms,poids:Object.assign({},EVAL_W)};
  return bestMove;
}
function analyzePosition(pov,depth,played){
  killerMoves={};historyTable={};counterMove={};TT.clear();
  function sig(c,dir){return c.map(function(x){return x.r+','+x.c;}).sort().join('|')+'>'+dir.q+','+dir.r;}
  const pSig=played?sig(played.cells,played.dir):null;
  const moves=orderMoves(getAllMovesForColor(pov),depth,null);
  let best=-Infinity,bestM=null,playedScore=null;const scored=[];
  for(const m of moves){const mk=moveKey(m);const u=applyMove(m,pov);const s=search(depth-1,-Infinity,Infinity,false,pov,mk);undoMove(u);
    scored.push(s);if(s>best){best=s;bestM=m;}
    if(pSig && sig(m.cells,m.dir)===pSig) playedScore=s;}
  let better=0;if(playedScore!==null){for(const s of scored){if(s>playedScore)better++;}}
  return {bestScore:best,playedScore:playedScore,rank:(playedScore!==null?better+1:null),total:scored.length,
    bestMove:bestM?{cells:bestM.cells,dir:bestM.dir,type:bestM.type,eject:bestM.eject}:null};
}

function _mb32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
var _AB=['a','b','c','d','e','f','g','h','i'];
function _dA2rc(cc){var r=8-_AB.indexOf(cc[0]);var off=r<4?4-r:0;return{r:r,c:parseInt(cc.slice(1),10)-1-off};}
function _duelSetup(){board={};capturedByBlack=0;capturedByWhite=0;
 var parts='0a1a2a3a4a5b1b2b3b4b5b6c3c4c5,0g5g6g7h4h5h6h7h8h9i5i6i7i8i9'.split(',');
 for(var i=0;i<2;i++){var cells=parts[i].slice(1).match(/[a-i][1-9]/g)||[];for(var j=0;j<cells.length;j++){var x=_dA2rc(cells[j]);board[x.r+','+x.c]=(i?'white':'black');}}}
/* v2.70 : depart depuis une vraie position du corpus (42-labo-positions.js) :
   { s : 61 caracteres '.', 'b', 'w' rang par rang, t : camp au trait, cb, cw } */
function _duelDepart(dep){board={};var i=0;for(var r=0;r<9;r++)for(var c=0;c<ROWS[r];c++,i++){var x=dep.s.charAt(i);if(x==='b')board[r+','+c]='black';else if(x==='w')board[r+','+c]='white';}
 capturedByBlack=dep.cb|0;capturedByWhite=dep.cw|0;}
function _snapCompact(){ var b={}; for(var k in board){ b[k]=(board[k]==='black'?'b':'w'); } return {b:b,cb:capturedByBlack,cw:capturedByWhite}; }
/* Rejeu d'une partie du Labo. Les coups enregistres CONTIENNENT l'ouverture tiree au
   sort (ajoutee pour le book du Labo) : on rejoue donc tout depuis la position de
   depart. Avant, le rejeu tirait l'ouverture une 2e fois PUIS rejouait les coups
   enregistres, ouverture comprise : position fausse des le 7e coup, coups illegaux
   sautes en silence, captures differentes de la vraie partie (trouve en comparant la
   position finale du rejeu a celle de la partie). Les entrees plus anciennes, sans
   l'ouverture, se rejouent encore comme avant (repli si un coup est illegal). */
function _rejouerCoups(moves, seed, avecTirage, depart){
  var col='black', i, m, frames=[];
  if(depart){ _duelDepart(depart); col=depart.t||'black'; avecTirage=false; } else _duelSetup();
  if(avecTirage){ var rnd=_mb32(seed||1);
    for(i=0;i<6;i++){ var ms=getAllMovesForColor(col).filter(function(x){return !x.eject;}); if(!ms.length)break;
      m=ms[Math.floor(rnd()*ms.length)]; applyMove(m,col); col=(col==='black'?'white':'black'); } }
  frames.push(_snapCompact());
  for(i=0;i<moves.length;i++){
    var mv=moves[i];
    var info=validateMove(mv.cells, mv.dir, mv.col);   // reconstruit le coup complet (avec .info push/ejection)
    if(!info || !info.valid) return null;
    applyMove({cells:mv.cells, dir:mv.dir, info:info, type:info.type, eject:info.ejection}, mv.col);
    frames.push(_snapCompact());
  }
  return frames;
}
function replayFromMoves(colorA, seed, moves, depart){
  var frames=depart ? _rejouerCoups(moves, seed, false, depart) : (_rejouerCoups(moves, seed, false) || _rejouerCoups(moves, seed, true));
  if(!frames) throw new Error('partie impossible a rejouer');
  return {frames:frames};
}
var _recMoves=null;
/* v2.70 : chaque camp peut avoir sa propre facon de jouer (cfgA, cfgB) :
     absent            -> recherche de profondeur 2, msPerMove par coup (le Labo, comme avant) ;
     {depth, ms}       -> recherche de cette profondeur et de ce temps (les niveaux 2 a 10) ;
     {mode:'hasard'}   -> le niveau 1 : tire au sort parmi les 4 premiers coups classes par sorte
                          (ejections, poussees, deplacements) ;
     {mode:'clone', beta} -> joue comme un modele de joueur : un coup tire au sort, d'autant plus
                          souvent que son evaluation a un coup est bonne (« comme les humains »). */
function _duelChoisir(col,cfg,msDefaut,hist,rnd){
  if(!cfg) return searchBestMove(col,2,msDefaut||400,hist.slice(-60));
  if(cfg.mode==='hasard'||cfg.mode==='clone'){
    var ms=getAllMovesForColor(col); if(!ms.length) return null;
    if(cfg.mode==='hasard'){ ms.sort(function(a,b){return (a.code||9)-(b.code||9);}); var L=ms.slice(0,4); return L[Math.floor(rnd()*L.length)]; }
    var sc=[],mx=-Infinity,k,u;
    for(k=0;k<ms.length;k++){ u=applyMove(ms[k],col); sc.push(evaluateBoard(col)); undoMove(u); if(sc[k]>mx) mx=sc[k]; }
    var tot=0,b=(typeof cfg.beta==='number'&&cfg.beta>0)?cfg.beta:0.002;
    for(k=0;k<ms.length;k++){ sc[k]=Math.exp(b*(sc[k]-mx)); tot+=sc[k]; }
    var x=rnd()*tot; for(k=0;k<ms.length;k++){ x-=sc[k]; if(x<=0) return ms[k]; }
    return ms[ms.length-1];
  }
  return searchBestMove(col,cfg.depth||2,cfg.ms||msDefaut||400,hist.slice(-60));
}
// ecart de billes (sur le plateau et ejectees) vu du camp color, en points d'evaluation : la part « materielle » de evaluateBoard
function _materiel(color){var me=0,en=0;for(var k in board){var v=board[k];if(!v)continue;if(v===color)me++;else en++;}
  var cap=color==='white'?(capturedByWhite-capturedByBlack):(capturedByBlack-capturedByWhite);return (me-en)*1000+cap*1000;}
function playDuelGame(wA,wB,colorA,seed,msPerMove,maxPlies,drawWin,ouverture,equilibre,opts){
  opts=opts||{};
  msPerMove=msPerMove||400; maxPlies=(typeof maxPlies==='number' && maxPlies>=0)?maxPlies:60; drawWin=(typeof drawWin==='number')?drawWin:400;
  // reglages du Labo « Ouverture : demi-coups » et « fenetre d'equilibre » : affiches depuis
  // longtemps, mais jamais transmis au moteur (6 et 600 etaient ecrits en dur) -- branches
  var nOuv=(typeof ouverture==='number' && ouverture>=0) ? Math.min(20, ouverture|0) : 6;
  var fen=(typeof equilibre==='number' && equilibre>0) ? equilibre : 600;
  var hist=[], col='black', plies=0, i, m, t, balanced=false, openingMoves=[];
  /* v3.18, verification d'une mission rendue par un executant (ordonnanceur du serveur) :
     opts.forces = les coups de la partie, ouverture comprise ; ils sont joues au lieu d'etre
     cherches (un coup illegal arrete tout). opts.verifier = numeros de demi-coups ou le moteur
     cherche AUSSI son coup, avec les memes poids, la meme profondeur et le meme historique :
     un coup different va dans ecarts. Meme fin de partie, meme arbitrage que la partie jouee. */
  var F=opts.forces||null, V=opts.verifier||null, nF=0, ecarts=[];
  /* Les billes du plateau sont rangees dans un objet : chaque recherche en retire et en remet, ce qui
     change l'ordre des cles, donc l'ordre de generation des coups, donc le choix entre deux coups de
     meme note. Le coup cherche dependait ainsi des recherches precedentes (mesure : un coup recalcule
     seul differait du coup joue dans la partie). Avant chaque recherche, le plateau est remis dans
     l'ordre des cases : le coup ne depend plus que de la position, des poids et de l'historique. */
  var canon=function(){ var b={}; for(var r=0;r<9;r++) for(var c=0;c<ROWS[r];c++){ var k=r+','+c; if(board[k]) b[k]=board[k]; } board=b; };
  var _cle=function(x){return x.cells.map(function(c){return c.r+','+c.c;}).sort().join('|')+'>'+x.dir.q+','+x.dir.r;};
  var fin=function(r){ if(F){ r.forces=nF; r.ecarts=ecarts; if(nF<F.length && r.why!=='illegal'){ r.winner='?'; r.why='apresLaFin'; } } return r; };
  if(opts.depart){
    // v2.70 : une vraie position du corpus, jouee telle quelle (les deux parties d'une paire en partent)
    _duelDepart(opts.depart); col=opts.depart.t||'black'; hist=[_repKeyOf(board)]; balanced=true;
  } else
  // Ouverture equilibree : re-tire la graine tant que la position de depart est deja gagnee/perdue
  for(t=0;t<10;t++){
    _duelSetup(); hist=[]; col='black'; plies=0;
    var rnd=_mb32((seed||1)+t*1000003);
    openingMoves=[];       // coups d'ouverture ALEATOIRES de CETTE tentative (la derniere est gardee)
    for(i=0;i<nOuv;i++){ var ms=getAllMovesForColor(col).filter(function(x){return !x.eject;}); if(!ms.length)break;
      m=ms[Math.floor(rnd()*ms.length)];
      openingMoves.push({cells:m.cells.map(function(x){return{r:x.r,c:x.c};}),dir:{q:m.dir.q,r:m.dir.r},col:col});
      applyMove(m,col); hist.push(_repKeyOf(board)); col=(col==='black'?'white':'black'); plies++; }
    EVAL_W=wA; var e0a=evaluateBoard('black'); EVAL_W=wB; var e0=evaluateBoard('black');
    if(e0>-fen && e0<fen && e0a>-fen && e0a<fen){ balanced=true; break; }
  }
  // l'ouverture jouee est enregistree meme si aucune des 10 tentatives n'etait equilibree :
  // avant, la partie partait alors d'une ouverture absente de l'enregistrement (rejeu faux)
  if(_recMoves){ for(var oi=0;oi<openingMoves.length;oi++) _recMoves.push(openingMoves[oi]); }
  if(F){ for(var fo=0;fo<openingMoves.length;fo++){ if(!F[fo] || _cle(F[fo])!==_cle(openingMoves[fo])) return {winner:'?',plies:fo,cb:capturedByBlack,cw:capturedByWhite,why:'ouverture',forces:fo,ecarts:ecarts}; } nF=openingMoves.length; }
  var rndJeu=_mb32(((seed||1)*2654435761+(colorA==='white'?7:3))|0);
  for(i=0;i<maxPlies;i++){
    EVAL_W = (col===colorA)? wA : wB;
    if(F){
      if(nF>=F.length) return fin({winner:'?',plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'inacheve',forces:nF,ecarts:ecarts});
      var fk=_cle(F[nF]); m=getAllMovesForColor(col).find(function(x){return _cle(x)===fk;});
      if(!m) return fin({winner:'?',plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'illegal'});
      if(V && V.indexOf(nF)>=0){ canon(); var mm=_duelChoisir(col,(col===colorA)?opts.cfgA:opts.cfgB,msPerMove,hist,rndJeu); if(!mm || _cle(mm)!==fk) ecarts.push(nF); }
      nF++;
    } else {
    canon(); m=_duelChoisir(col,(col===colorA)?opts.cfgA:opts.cfgB,msPerMove,hist,rndJeu); }
    if(!m) return fin({winner:(col===colorA?'B':'A'),plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'noMove'});
    if(_recMoves) _recMoves.push({cells:m.cells.map(function(x){return {r:x.r,c:x.c};}),dir:{q:m.dir.q,r:m.dir.r},col:col});
    applyMove(m,col); hist.push(_repKeyOf(board)); plies++;
    if(capturedByBlack>=6) return fin({winner:(colorA==='black'?'A':'B'),plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'6capt'});
    if(capturedByWhite>=6) return fin({winner:(colorA==='white'?'A':'B'),plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'6capt'});
    var diff=capturedByBlack-capturedByWhite;
    if(diff>=3||diff<=-3){ var wn=(diff>0?'black':'white'); return fin({winner:(wn===colorA?'A':'B'),plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'adj3'}); }
    col=(col==='black'?'white':'black');
  }
  var d2=capturedByBlack-capturedByWhite;
  /* v2.70 (arbitrage 2) : dans les 4 580 vraies parties, le camp qui mene d'UNE bille au
     66e demi-coup ne gagne que 66 % du temps (deux billes : 78 %, trois : 94 %). Une bille
     d'avance ne suffit donc plus : elle ne compte que si les deux evaluations, billes mises
     a part, ne voient pas l'autre camp mieux place ; sinon, nulle. */
  if(opts.arbitrage===2 && (d2===1||d2===-1)){
    var mene=(d2>0?'black':'white');
    EVAL_W=wA; var pA=evaluateBoard(mene)-_materiel(mene); EVAL_W=wB; var pB=evaluateBoard(mene)-_materiel(mene);
    if(pA>=0 && pB>=0) return fin({winner:(mene===colorA?'A':'B'),plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'adjCap1'});
    return fin({winner:'D',plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'draw1'});
  }
  if(d2!==0){ var w2=(d2>0?'black':'white'); return fin({winner:(w2===colorA?'A':'B'),plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'adjCap'}); }
  /* Arbitrage par CONSENSUS (comme les bancs d'essai des moteurs d'echecs) : chaque camp
     evalue la position avec SES poids, du point de vue de A ; la victoire n'est donnee que
     s'ils sont d'accord. Avant, seule l'evaluation de A tranchait : dans le Labo, A est le
     mutant -- il arbitrait ses propres parties, et des poids qui gonflent sa propre
     evaluation lui donnaient des victoires. */
  EVAL_W=wA; var evA=evaluateBoard(colorA); EVAL_W=wB; var evB=evaluateBoard(colorA);
  if(evA>drawWin && evB>drawWin) return fin({winner:'A',plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'adjEval'});
  if(evA<-drawWin && evB<-drawWin) return fin({winner:'B',plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'adjEval'});
  return fin({winner:'D',plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'draw'});
}
/* ── v2.70 : les termes de l'evaluation, pour la methode Texel et « comme les humains » ──
   evaluateBoard est lineaire en ses poids : materiel + somme des poids x termes. Avec un
   poids de 1 sur chaque critere, evalDetail donne donc chaque terme tel quel. */
var _TX_TERMES={center:function(d){return d.centre;},cohesion:function(d){return d.coh;},edge:function(d){return d.bordM+d.bordA;},
  mob:function(d){return d.mob;},iso:function(d){return d.iso;},dng:function(d){return d.dng;},chain:function(d){return d.chaine;},fortress:function(d){return d.fort;},
  scGain:function(d){return d.scGain;},scPerte:function(d){return d.scPerte;},cases:function(d){return d.cases;},compac:function(d){return d.compac;},
  sumito:function(d){return d.sumito;},menace:function(d){return d.menace;},fourch:function(d){return d.fourch;},piege:function(d){return d.piege;}};
function _txPoidsUn(cles){var w={center:0,cohesion:0,edge:0,mob:0,iso:0,dng:0,chain:0,fortress:0};for(var i=0;i<cles.length;i++)w[cles[i]]=1;return w;}
function _txTermes(color,cles,f,o){var d=evalDetail(color);for(var j=0;j<cles.length;j++)f[o+j]=_TX_TERMES[cles[j]](d);return d.gain+d.perte+d.base;}
// pour chaque position : les termes vus du camp au trait, et l'ecart materiel
function texelTermes(positions,cles){
  var K=cles.length,n=positions.length,f=new Float32Array(n*K),mat=new Float32Array(n);
  EVAL_W=_txPoidsUn(cles);
  for(var i=0;i<n;i++){_duelDepart(positions[i]);mat[i]=_txTermes(positions[i].t,cles,f,i*K);}
  return {f:f,m:mat};
}
// pour chaque position : chaque coup legal, les termes APRES le coup vus du joueur, et le rang du coup joue
function coupsTermes(positions,coups,cles){
  var K=cles.length,nb=[],joue=[],F=[],M=[];
  EVAL_W=_txPoidsUn(cles);
  for(var i=0;i<positions.length;i++){
    _duelDepart(positions[i]);var col=positions[i].t,ms=getAllMovesForColor(col),r=-1;
    for(var k=0;k<ms.length;k++){
      if(_coupCode(ms[k])===coups[i]) r=k;
      var u=applyMove(ms[k],col),f=new Float32Array(K);M.push(_txTermes(col,cles,f,0));undoMove(u);F.push(f);
    }
    nb.push(ms.length);joue.push(r);
  }
  var tout=new Float32Array(F.length*K);for(var q=0;q<F.length;q++)tout.set(F[q],q*K);
  return {nb:nb,joue:joue,f:tout,m:new Float32Array(M)};
}
// code d'un coup (42-labo-positions.js) : premiere case, derniere case, direction
var _CP_DIRS=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]],_CP_IDX=(function(){var t={},i=0;for(var r=0;r<9;r++)for(var c=0;c<ROWS[r];c++)t[r+','+c]=i++;return t;})();
function _coupCode(m){var a=m.cells.map(function(x){return _CP_IDX[x.r+','+x.c];}).sort(function(p,q){return p-q;});var d=-1;
  for(var j=0;j<6;j++)if(_CP_DIRS[j][0]===m.dir.q&&_CP_DIRS[j][1]===m.dir.r)d=j;return a[0]|(a[a.length-1]<<6)|((d<0?7:d)<<12);}
// le coup que choisirait une facon de jouer (niveau, poids) sur chaque position
function choixCoups(positions,w,cfg,seed){
  var out=[],rnd=_mb32(seed||1);
  for(var i=0;i<positions.length;i++){_duelDepart(positions[i]);EVAL_W=w;var m=_duelChoisir(positions[i].t,cfg,(cfg&&cfg.ms)||300,[_repKeyOf(board)],rnd);out.push(m?_coupCode(m):-1);}
  return out;
}
/* ═══════════════════════════════════════════
   MODES MOTEUR EXPERIMENTAUX (NNUE) — testes hors-ligne avant integration
   avec de vraies parties issues du corpus (voir le detail complet donne a
   l'utilisateur : 2 victoires / 8 defaites / 5 nulles sur 15 parties
   equitables pour le mode evaluation seule, et resultat identique pour le
   mode combine). Exposes ici comme options EXPLICITEMENT etiquetees
   "experimental, plus faible selon nos tests" -- pas comme une
   amelioration, par honnetete envers le joueur qui les choisit.
   evaluateBoard_actuel/orderMoves_actuel gardent une reference vers les
   fonctions d'origine pour permettre de revenir dessus a chaque requete
   (le worker persiste entre plusieurs coups, il ne faut jamais le laisser
   dans un etat "commute" pour la requete suivante par erreur). */
const evaluateBoard_actuel = evaluateBoard;
const orderMoves_actuel = orderMoves;
let NNUE_W = null;
function nnueLoad(w){ NNUE_W = w; }
function nnueRelu(v){ return v.map(function(x){ return x > 0 ? x : 0; }); }
function nnueMatVec(mat, vec){
  const nOut = mat[0].length;
  const out = new Array(nOut).fill(0);
  for (let i = 0; i < vec.length; i++){
    const vi = vec[i];
    if (vi === 0) continue;
    const row = mat[i];
    for (let j = 0; j < nOut; j++) out[j] += vi * row[j];
  }
  return out;
}
function nnueAddBias(v, b){ return v.map(function(x,i){ return x + b[i]; }); }
function nnueForward(features){
  const W = NNUE_W;
  let z1 = nnueAddBias(nnueMatVec(W.W1, features), W.b1);
  let a1 = nnueRelu(z1);
  let z2 = nnueAddBias(nnueMatVec(W.W2, a1), W.b2);
  let a2 = nnueRelu(z2);
  let z3 = nnueAddBias(nnueMatVec(W.W3.map(function(w){return [w];}), a2), W.b3);
  return Math.tanh(z3[0]);
}
function encodeBoardForNNUE(color){
  const feat = new Array(61*2 + 3).fill(0);
  let idx = 0;
  for (let r = 0; r < ROWS.length; r++){
    for (let c = 0; c < ROWS[r]; c++){
      const v = board[r+','+c];
      if (v === 'black') feat[idx] = 1;
      else if (v === 'white') feat[61+idx] = 1;
      idx++;
    }
  }
  feat[122] = color === 'black' ? 1 : 0;
  feat[123] = capturedByBlack / 6;
  feat[124] = capturedByWhite / 6;
  return feat;
}
function evaluateBoard_nnue(color){ return nnueForward(encodeBoardForNNUE(color)) * 2000; }
function orderMoves_nnue_full(moves, depth, ttMove, prevKey){
  const cm = prevKey ? counterMove[prevKey] : null;
  return moves.map(function(m){
    let score = 0; const mk = moveKey(m);
    if (ttMove && mk === ttMove) score += 100000;
    score += (10 - (m.code || 9)) * 1000;
    if (killerMoves[depth] && killerMoves[depth].indexOf(mk) !== -1) score += 500;
    if (cm && mk === cm) score += 300;
    score += (historyTable[mk] || 0);
    const moverColor = board[akey(m.cells[0].r, m.cells[0].c)];
    const u = applyMove(m, moverColor);
    score += nnueForward(encodeBoardForNNUE(moverColor)) * 2000;
    undoMove(u);
    return { m: m, score: score };
  }).sort(function(a,b){ return b.score - a.score; }).map(function(x){ return x.m; });
}
/* Applique le mode moteur demande AVANT chaque recherche -- remet toujours
   explicitement evaluateBoard/orderMoves a leur valeur (NNUE ou originale),
   jamais un simple "si demande, alors commute" qui laisserait le worker
   pollue pour la requete suivante. */
function applyEngineMode(mode, weights){
  if (mode === 'nnue-eval' || mode === 'nnue-both') {
    if (weights) nnueLoad(weights);
    evaluateBoard = evaluateBoard_nnue;
  } else {
    evaluateBoard = evaluateBoard_actuel;
  }
  if (mode === 'nnue-order' || mode === 'nnue-both') {
    if (weights) nnueLoad(weights);
    orderMoves = orderMoves_nnue_full;
  } else {
    orderMoves = orderMoves_actuel;
  }
}
self.onmessage=function(e){
  const d=e.data;
  if(d.ping){ self.postMessage({pong:1}); return; }
  if(d.replayGame){
    try{ var rr=replayFromMoves(d.colorA,d.seed,d.moves||[],d.depart||null); self.postMessage({replayGame:true,id:d.id,frames:rr.frames,result:d.result||null}); }
    catch(err){ self.postMessage({replayGame:true,id:d.id,error:String(err&&err.message||err)}); }
    return; }
  if(d.duelGame){
    try{ _recMoves=[]; var r=playDuelGame(d.wA,d.wB,d.colorA,d.seed,d.msPerMove,d.maxPlies,d.drawWin,d.ouverture,d.equilibre,
          {depart:d.depart||null,cfgA:d.cfgA||null,cfgB:d.cfgB||null,arbitrage:d.arbitrage||1,forces:d.forces||null,verifier:d.verifier||null}); var mv=_recMoves; _recMoves=null; self.postMessage({duelGame:true,id:d.id,result:r,moves:mv}); }
    catch(err){ _recMoves=null; self.postMessage({duelGame:true,id:d.id,error:String(err&&err.message||err)}); }
    return; }
  // v2.70, outils du Labo : termes d'evaluation (Texel, comme les humains) et choix de coups (niveaux)
  if(d.texelTermes){
    try{ var tx=texelTermes(d.positions,d.cles); self.postMessage({texelTermes:true,id:d.id,f:tx.f,m:tx.m},[tx.f.buffer,tx.m.buffer]); }
    catch(err){ self.postMessage({texelTermes:true,id:d.id,error:String(err&&err.message||err)}); }
    return; }
  if(d.coupsTermes){
    try{ var ct=coupsTermes(d.positions,d.coups,d.cles); self.postMessage({coupsTermes:true,id:d.id,nb:ct.nb,joue:ct.joue,f:ct.f,m:ct.m},[ct.f.buffer,ct.m.buffer]); }
    catch(err){ self.postMessage({coupsTermes:true,id:d.id,error:String(err&&err.message||err)}); }
    return; }
  if(d.choixCoups){
    try{ self.postMessage({choixCoups:true,id:d.id,coups:choixCoups(d.positions,d.w,d.cfg||null,d.seed)}); }
    catch(err){ self.postMessage({choixCoups:true,id:d.id,error:String(err&&err.message||err)}); }
    return; }
  board=d.board;capturedByWhite=d.capturedByWhite;capturedByBlack=d.capturedByBlack;
  if(d.weights)EVAL_W=d.weights;
  applyEngineMode(d.engineMode||null, d.nnueWeights||null);
  if(d.analyze){
    const r=analyzePosition(d.color, d.depth||3, d.played);
    self.postMessage({analyze:true,index:d.index,best:r.bestScore,played:r.playedScore,rank:r.rank,total:r.total,bestMove:r.bestMove});
    return;
  }
  if(d.singleMove){
    /* Mode "vol de travail" : calcule UN SEUL coup racine, puis rend la main
       immediatement -- le thread principal redistribue le coup suivant a
       n'importe quel worker libre, au lieu d'un lot fige au depart (voir
       requestAIMovePooledStealing). resetTables une seule fois par worker
       pour TOUTE la session de reflexion (TT/killer/historique restent
       utiles d'un coup racine a l'autre ET d'une profondeur a l'autre,
       exactement comme searchBestMove qui ne les videait qu'une fois avant
       sa boucle de profondeur) -- mais _nodes/_ttLk/_ttHit sont TOUJOURS
       remis a zero, sinon le compteur rapporte pour "ce coup" serait en
       realite le cumul de tous les coups precedents traites par ce worker.
       Aucun element de la fenetre alpha-beta n'est partage entre coups
       racine ici -- verifie avant de construire que ce n'etait deja PAS le
       cas dans searchBestMove (chaque coup racine y est deja cherche avec
       une fenetre pleine -Infinity,+Infinity, la variable alpha locale
       n'etait jamais reinjectee) : cette restructuration ne perd donc aucun
       elagage croise qui existait avant. */
    if(d.resetTables){killerMoves={};historyTable={};counterMove={};TT.clear();}
    _nodes=0;_ttLk=0;_ttHit=0;
    const repCount=_repCountMap(d.hist);
    const mk=moveKey(d.move);
    const u=applyMove(d.move,d.color);
    let s=search(d.depth-1,-Infinity,Infinity,false,d.color,mk);
    if(repCount){const rc=repCount.get(_repKeyOf(board));if(rc)s-=140*rc*rc;}
    undoMove(u);
    self.postMessage({move:d.move,score:s,nodes:_nodes});
    return;
  }
  _obs=(d.observe>0)?d.observe:null;_obsT=0;_obsCtx=null;   // Observatoire IA : mesures en cours de calcul, seulement si demande
  let move;try{move=searchBestMove(d.color, d.depth, d.time, d.hist, d.workerIndex, d.workerCount);}finally{_obs=null;_obsCtx=null;}
  self.postMessage({move:move, metrics:_metrics});
};
