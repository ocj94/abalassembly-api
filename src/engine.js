/**
 * Moteur Abalone — extrait du moteur client (abalone8.html, AI_WORKER_CODE +
 * parseur ABA-PRO), pour la VÉRIFICATION SERVEUR des parties soumises par le
 * Labo distribué. Toute mutation d'état (board, captures) est enfermée dans
 * `createEngine()` : chaque appel obtient sa propre instance isolée — aucune
 * variable de module partagée, donc sûr sous requêtes concurrentes (Fastify).
 *
 * Ne contient QUE la légalité des coups + application, pas la recherche IA
 * (searchBestMove/evaluateBoard) : le serveur vérifie qu'une partie soumise
 * est une suite de coups légaux menant au résultat annoncé, il ne rejoue pas
 * la réflexion de l'IA elle-même (trop coûteux pour re-vérifier en masse).
 *
 * Généré à partir du code source du jeu — resynchroniser si le moteur client
 * change (recherche "AI_WORKER_CODE" dans index.html du dépôt Abalassembly).
 */

export function createEngine() {
  let board = {};
  let capturedByBlack = 0, capturedByWhite = 0;

  
  const ROWS = [5,6,7,8,9,8,7,6,5];
  const AX_DIRS=[{q:1,r:0},{q:-1,r:0},{q:0,r:-1},{q:1,r:-1},{q:0,r:1},{q:-1,r:1}];
  const akey=(r,c)=>r+','+c;
  function rcToAxial(row,col){ return {q: row<=4?col-row:col-4, r:row-4}; }
  function axialToRc(q,rAx){ const row=rAx+4; if(row<0||row>8)return null; let col=row<=4?q+row:q+4; if(col<0||col>=ROWS[row])return null; return {r:row,c:col}; }
  // board/capturedByBlack/capturedByWhite déclarés dans createEngine()
  let EVAL_W={center:6,cohesion:4,edge:8,mob:2,iso:18,dng:14};   // poids d'éval, adaptés au style adverse
  
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
  function evaluateBoard(color){
    let myCount=0,enCount=0,myCenter=0,enCenter=0,myCoh=0,enCoh=0,myEdge=0,enEdge=0,myMob=0,enMob=0,myIso=0,enIso=0,myDng=0,enDng=0;
    for(const k in board){const v=board[k];if(!v)continue;
      const p=k.split(',');const ax=rcToAxial(+p[0],+p[1]);const dist=axHexDist(ax,EVAL_CENTER);const isEdge=dist>=4;
      let allies=0,emptyN=0;for(const d of AX_DIRS){const n=axialToRc(ax.q+d.q,ax.r+d.r);if(!n)continue;const nv=board[akey(n.r,n.c)];if(nv===v)allies++;else if(!nv)emptyN++;}
      const iso=allies===0;const dng=isEdge&&allies<=1;
      if(v===color){myCount++;myCenter+=(4-dist);myCoh+=allies;if(isEdge)myEdge++;myMob+=emptyN;if(iso)myIso++;if(dng)myDng++;}
      else{enCount++;enCenter+=(4-dist);enCoh+=allies;if(isEdge)enEdge++;enMob+=emptyN;if(iso)enIso++;if(dng)enDng++;}}
    return (myCount-enCount)*1000+(myCenter-enCenter)*EVAL_W.center+(myCoh-enCoh)*EVAL_W.cohesion+(enEdge-myEdge)*EVAL_W.edge
      +((color==='white'?(capturedByWhite-capturedByBlack):(capturedByBlack-capturedByWhite))*1000)
      +(myMob-enMob)*EVAL_W.mob+(enIso-myIso)*EVAL_W.iso+(enDng-myDng)*EVAL_W.dng;
  }
  function _rand32(){return(Math.random()*0xFFFFFFFF)>>>0;}
  const ZOBRIST={};for(let r=0;r<9;r++)for(let c=0;c<ROWS[r];c++)ZOBRIST[akey(r,c)]={black:_rand32(),white:_rand32()};
  function hashBoard(){let h=0;for(const k in board){const v=board[k];if(v==='black')h^=ZOBRIST[k].black;else if(v==='white')h^=ZOBRIST[k].white;}return h>>>0;}
  let TT=new Map();const TT_EXACT=0,TT_LOWER=1,TT_UPPER=2;
  let killerMoves={},historyTable={};
  function moveKey(m){return m.cells.map(c=>c.r+','+c.c).sort().join('|')+'>'+m.dir.q+','+m.dir.r;}
  function orderMoves(moves,depth,ttMove){
    return moves.map(m=>{let score=0;const mk=moveKey(m);
      if(ttMove&&mk===ttMove)score+=100000;score+=(10-(m.code||9))*1000;
      if(killerMoves[depth]&&killerMoves[depth].indexOf(mk)!==-1)score+=500;score+=(historyTable[mk]||0);
      return{m,score};}).sort((a,b)=>b.score-a.score).map(x=>x.m);
  }
  function quiescence(alpha,beta,pov,maxi,qd){
    if(capturedByWhite>=6)return pov==='white'?100000:-100000;
    if(capturedByBlack>=6)return pov==='black'?100000:-100000;
    const sp=evaluateBoard(pov);if(qd<=0)return sp;
    if(maxi){if(sp>=beta)return beta;if(sp>alpha)alpha=sp;}else{if(sp<=alpha)return alpha;if(sp<beta)beta=sp;}
    const mc=maxi?pov:(pov==='white'?'black':'white');
    const moves=getAllMovesForColor(mc).filter(m=>m.eject);
    for(const m of moves){const u=applyMove(m,mc);const s=quiescence(alpha,beta,pov,!maxi,qd-1);undoMove(u);
      if(maxi){if(s>alpha)alpha=s;if(alpha>=beta)break;}else{if(s<beta)beta=s;if(beta<=alpha)break;}}
    return maxi?alpha:beta;
  }
  let _nodes=0,_ttLk=0,_ttHit=0,_metrics=null;
  function search(depth,alpha,beta,maxi,pov){
    _nodes++;
    const ao=alpha;
    if(capturedByWhite>=6)return pov==='white'?100000:-100000;
    if(capturedByBlack>=6)return pov==='black'?100000:-100000;
    const h=hashBoard();const tt=TT.get(h);_ttLk++;
    if(tt&&tt.depth>=depth){_ttHit++;if(tt.flag===TT_EXACT)return tt.value;
      if(tt.flag===TT_LOWER&&tt.value>alpha)alpha=tt.value;else if(tt.flag===TT_UPPER&&tt.value<beta)beta=tt.value;
      if(alpha>=beta)return tt.value;}
    if(depth===0)return quiescence(alpha,beta,pov,maxi,4);
    const mc=maxi?pov:(pov==='white'?'black':'white');
    let moves=getAllMovesForColor(mc);if(!moves.length)return maxi?-99999:99999;
    moves=orderMoves(moves,depth,tt?tt.move:null);
    let best=maxi?-Infinity:Infinity,bestMove=null;
    for(const m of moves){const u=applyMove(m,mc);const s=search(depth-1,alpha,beta,!maxi,pov);undoMove(u);
      if(maxi){if(s>best){best=s;bestMove=m;}if(best>alpha)alpha=best;}else{if(s<best){best=s;bestMove=m;}if(best<beta)beta=best;}
      if(alpha>=beta){const mk=moveKey(m);if(!killerMoves[depth])killerMoves[depth]=[];
        if(killerMoves[depth].indexOf(mk)===-1){killerMoves[depth].unshift(mk);if(killerMoves[depth].length>2)killerMoves[depth].pop();}
        historyTable[mk]=(historyTable[mk]||0)+depth*depth;break;}}
    let flag=TT_EXACT;if(best<=ao)flag=TT_UPPER;else if(best>=beta)flag=TT_LOWER;
    TT.set(h,{depth,value:best,flag,move:bestMove?moveKey(bestMove):null});
    return best;
  }
  function _repKeyOf(bd){let s='';for(let r=0;r<9;r++){for(let c=0;c<ROWS[r];c++){const v=bd[r+','+c];s+=v?(v==='black'?'b':'w'):'-';}}return s;}
  function _repCountMap(h){if(!h||!h.length)return null;const m=new Map();for(const k of h)m.set(k,(m.get(k)||0)+1);return m;}
  function searchBestMove(pov,maxDepth,timeLimit,hist){
    const start=Date.now();let bestMove=null,reached=0,lastRoots=null;
    killerMoves={};historyTable={};TT.clear();_nodes=0;_ttLk=0;_ttHit=0;
    const repCount=_repCountMap(hist);
    for(let d=1;d<=maxDepth;d++){
      let moves=getAllMovesForColor(pov);if(!moves.length)break;
      moves=orderMoves(moves,d,null);
      let lb=null,ls=-Infinity,alpha=-Infinity,roots=[],cut=false;
      for(const m of moves){const u=applyMove(m,pov);let s=search(d-1,-Infinity,Infinity,false,pov);
        if(repCount){const rc=repCount.get(_repKeyOf(board));if(rc)s-=140*rc*rc;}
        undoMove(u);
        roots.push({cells:m.cells,dir:m.dir,type:m.type,eject:m.eject,score:s});
        if(s>ls){ls=s;lb=m;}if(s>alpha)alpha=s;if(Date.now()-start>timeLimit){cut=true;break;}}
      if(lb){bestMove=lb;reached=d;if(!cut)lastRoots=roots;}if(Date.now()-start>timeLimit)break;}
    const top=lastRoots?lastRoots.slice().sort((a,b)=>b.score-a.score).slice(0,5):null;
    _metrics={nodes:_nodes,depth:reached,time:Date.now()-start,ttHit:_ttLk?Math.round(100*_ttHit/_ttLk):0,rootMoves:top};
    return bestMove;
  }
  function analyzePosition(pov,depth,played){
    killerMoves={};historyTable={};TT.clear();
    function sig(c,dir){return c.map(function(x){return x.r+','+x.c;}).sort().join('|')+'>'+dir.q+','+dir.r;}
    const pSig=played?sig(played.cells,played.dir):null;
    const moves=orderMoves(getAllMovesForColor(pov),depth,null);
    let best=-Infinity,bestM=null,playedScore=null;const scored=[];
    for(const m of moves){const u=applyMove(m,pov);const s=search(depth-1,-Infinity,Infinity,false,pov);undoMove(u);
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
  function _snapCompact(){ var b={}; for(var k in board){ b[k]=(board[k]==='black'?'b':'w'); } return {b:b,cb:capturedByBlack,cw:capturedByWhite}; }
  function replayFromMoves(colorA, seed, moves){
    var col='black', i, m, frames=[];
    _duelSetup();
    var rnd=_mb32(seed||1);
    for(i=0;i<6;i++){ var ms=getAllMovesForColor(col).filter(function(x){return !x.eject;}); if(!ms.length)break;
      m=ms[Math.floor(rnd()*ms.length)]; applyMove(m,col); col=(col==='black'?'white':'black'); }
    frames.push(_snapCompact());
    for(i=0;i<moves.length;i++){
      var mv=moves[i];
      var info=validateMove(mv.cells, mv.dir, mv.col);   // reconstruit le coup complet (avec .info push/ejection)
      if(info && info.valid){ applyMove({cells:mv.cells, dir:mv.dir, info:info, type:info.type, eject:info.ejection}, mv.col); }
      frames.push(_snapCompact());
    }
    return {frames:frames};
  }
  var _recMoves=null;
  function playDuelGame(wA,wB,colorA,seed,msPerMove,maxPlies,drawWin){
    msPerMove=msPerMove||400; maxPlies=maxPlies||60; drawWin=(typeof drawWin==='number')?drawWin:400;
    var hist=[], col='black', plies=0, i, m, t, balanced=false;
    // Ouverture equilibree : re-tire la graine tant que la position de depart est deja gagnee/perdue
    for(t=0;t<10;t++){
      _duelSetup(); hist=[]; col='black'; plies=0;
      var rnd=_mb32((seed||1)+t*1000003);
      for(i=0;i<6;i++){ var ms=getAllMovesForColor(col).filter(function(x){return !x.eject;}); if(!ms.length)break;
        m=ms[Math.floor(rnd()*ms.length)]; applyMove(m,col); hist.push(_repKeyOf(board)); col=(col==='black'?'white':'black'); plies++; }
      EVAL_W=wB; var e0=evaluateBoard('black');
      if(e0>-600 && e0<600){ balanced=true; break; }
    }
    for(i=0;i<maxPlies;i++){
      EVAL_W = (col===colorA)? wA : wB;
      m=searchBestMove(col,2,msPerMove||400,hist.slice(-60));
      if(!m) return {winner:(col===colorA?'B':'A'),plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'noMove'};
      if(_recMoves) _recMoves.push({cells:m.cells.map(function(x){return {r:x.r,c:x.c};}),dir:{q:m.dir.q,r:m.dir.r},col:col});
      applyMove(m,col); hist.push(_repKeyOf(board)); plies++;
      if(capturedByBlack>=6) return {winner:(colorA==='black'?'A':'B'),plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'6capt'};
      if(capturedByWhite>=6) return {winner:(colorA==='white'?'A':'B'),plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'6capt'};
      var diff=capturedByBlack-capturedByWhite;
      if(diff>=3||diff<=-3){ var wn=(diff>0?'black':'white'); return {winner:(wn===colorA?'A':'B'),plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'adj3'}; }
      col=(col==='black'?'white':'black');
    }
    var d2=capturedByBlack-capturedByWhite;
    if(d2!==0){ var w2=(d2>0?'black':'white'); return {winner:(w2===colorA?'A':'B'),plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'adjCap'}; }
    EVAL_W=wA; var ev=evaluateBoard(colorA);
    if(ev>drawWin) return {winner:'A',plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'adjEval'};
    if(ev<-drawWin) return {winner:'B',plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'adjEval'};
    return {winner:'D',plies:plies,cb:capturedByBlack,cw:capturedByWhite,why:'draw'};
  }

  const ABAPRO_ROWS = ['a','b','c','d','e','f','g','h','i'];
  function abaproToRc(cell) {
    if (!cell || cell.length < 2) return null;
    const letter = cell[0].toLowerCase();
    const num = parseInt(cell.slice(1), 10);
    if (isNaN(num)) return null;
    const idx = ABAPRO_ROWS.indexOf(letter);   // position de la lettre dans a..i
    if (idx < 0) return null;
    const r = 8 - idx;                          // r interne (r=0 haut)
    const offset = r < 4 ? (4 - r) : 0;
    const c = num - 1 - offset;
    if (r < 0 || r > 8 || c < 0 || c >= ROWS[r]) return null;
    return { r: r, c: c };
  }
  function resolveAbaProToken(token,color){
    const legal=getAllMovesForColor(color);
    const m=legal.filter(function(mv){ return abaproOfficialLabels(mv).indexOf(token)!==-1; });
    if(!m.length)return null;
    m.sort(function(a,b){ return b.cells.length-a.cells.length; });  // ligne maximale si ambigu
    return m[0];
  }
  function moveToABAPRO(sel, dir, type) {
    if (!sel || !sel.length || !dir) return '?';
    if (type === 'broadside') {
      // Coup en flèche : 2 extrémités de la rangée + position finale de la première bille
      // (notation en ordre alphanumérique, ex: e6e8f6)
      const coords = sel.map(function(s){ return { rc:s, notation: coordToABAPRO(s.r,s.c) }; });
      coords.sort(function(a,b){ return a.notation < b.notation ? -1 : 1; });
      const first = coords[0].rc;
      const last = coords[coords.length-1].rc;
      const firstAx = rcToAxial(first.r, first.c);
      const firstDest = axialToRc(firstAx.q + dir.q, firstAx.r + dir.r);
      const fromA = coordToABAPRO(first.r, first.c);
      const fromB = coordToABAPRO(last.r, last.c);
      const toA = firstDest ? coordToABAPRO(firstDest.r, firstDest.c) : '';
      return fromA + fromB + toA;  // ex: e6e8f6
    } else {
      /* Coup en ligne : depart et arrivee de la bille de QUEUE (ex: e5e6).
         L'Aba-Pro decrit le deplacement de la bille arriere du groupe, qui se
         deplace toujours d'une seule case — c'est ce qui distingue cette
         notation du Nacre, lequel note la queue puis la DESTINATION DE LA TETE
         (donc une distance egale a la taille du groupe).
         Ce code utilisait la bille de tete pour les deux extremites : tous les
         coups en ligne de plus d'une bille etaient donc faux. Corrige cote jeu
         le 21/07/2026 contre les sequences de reference de Saab, la correction
         n'avait jamais ete reportee ici. Pour un groupe [a1,a2] avance vers a3,
         l'Aba-Pro correct est « a1a2 » et non « a2a3 ». Sur une bille seule,
         queue et tete se confondent : rien ne change. */
      const ax = sel.map(function(s){ return rcToAxial(s.r,s.c); });
      const sorted = ax.slice().sort(function(a,b){ return (a.q*dir.q+a.r*dir.r)-(b.q*dir.q+b.r*dir.r); });
      const tail = sorted[0];
      const tailRc = axialToRc(tail.q, tail.r);
      const tailDest = axialToRc(tail.q + dir.q, tail.r + dir.r);
      const from = tailRc ? coordToABAPRO(tailRc.r, tailRc.c) : '';
      const to = tailDest ? coordToABAPRO(tailDest.r, tailDest.c) : '';
      return from + to;  // ex: e5e6
    }
  }
  function coordToABAPRO(r, c) {
    // Notation officielle Abalone : lettres A-I (rangées, A en bas, I en haut),
    // chiffres 1-9 (diagonales nord-ouest/sud-est, alignées en bas-droite).
    // Interne : r=0 = haut (rangée I), r=8 = bas (rangée A).
    const letter = ABAPRO_ROWS[8 - r];
    // Les rangées au-dessus du milieu (r<4) sont décalées sur les diagonales :
    // leur première case ne commence pas à 1 mais à (1 + décalage).
    const offset = r < 4 ? (4 - r) : 0;
    const num = c + 1 + offset;
    return letter + num;
  }
  function abaproOfficialLabels(mv){
    const dir=mv.dir, cells=mv.cells;
    const ax=cells.map(function(c){ return {c:c, a:rcToAxial(c.r,c.c)}; });
    const type=(mv.info&&mv.info.type)||mv.type;
    function proj(a){ return a.q*dir.q + a.r*dir.r; }
    if(type==='broadside'){
      const s=ax.slice().sort(function(p,q){ return (p.a.q-q.a.q)||(p.a.r-q.a.r); });
      const e1=s[0].c, e2=s[s.length-1].c;
      const d1=axialToRc(rcToAxial(e1.r,e1.c).q+dir.q, rcToAxial(e1.r,e1.c).r+dir.r);
      const d2=axialToRc(rcToAxial(e2.r,e2.c).q+dir.q, rcToAxial(e2.r,e2.c).r+dir.r);
      const L=[];
      if(d1)L.push(coordToABAPRO(e1.r,e1.c)+coordToABAPRO(e2.r,e2.c)+coordToABAPRO(d1.r,d1.c));
      if(d2)L.push(coordToABAPRO(e2.r,e2.c)+coordToABAPRO(e1.r,e1.c)+coordToABAPRO(d2.r,d2.c));
      return L;
    }
    const s=ax.slice().sort(function(p,q){ return proj(p.a)-proj(q.a); });
    const tail=s[0].c;
    const td=axialToRc(rcToAxial(tail.r,tail.c).q+dir.q, rcToAxial(tail.r,tail.c).r+dir.r);
    if(!td)return [];
    return [coordToABAPRO(tail.r,tail.c)+coordToABAPRO(td.r,td.c)];
  }

  return {
    setBoard(cells) { board = cells; },
    getBoard() { return board; },
    get capturedByBlack() { return capturedByBlack; },
    get capturedByWhite() { return capturedByWhite; },
    getAllMovesForColor,
    applyMove,
    undoMove,
    resolveAbaProToken,
    moveToABAPRO,
    abaproOfficialLabels,
    abaproToRc,
    coordToABAPRO,
    rcToAxial,
    axialToRc,
    AX_DIRS,
  };
}
