import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DF = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const rand = a => a[Math.floor(Math.random() * a.length)];
const pad2 = n => String(n).padStart(2, "0");

function getNudges(tasks) {
  const n = [];
  const pending = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);
  const big = /build|create|design|develop|launch|ship|plan|write|redesign|migrate|refactor|overhaul|implement|organize|prepare|set up/i;
  if (!pending.length && done.length) return [{ text: "all clear." }];
  if (!pending.length && !done.length) return [];
  pending.forEach(t => {
    if (big.test(t.text) && t.text.split(/\s+/).length >= 3)
      n.push({ text: `"${t.text.substring(0, 30)}${t.text.length > 30 ? "..." : ""}" — big task. break it down?`, action: { type: "break", id: t.id } });
  });
  if (pending.length > 7) n.push({ text: `${pending.length} tasks. too many. pick 3.` });
  if (done.length >= 3 && pending.length) n.push({ text: `${done.length} done. keep going.` });
  return n.slice(0, 2);
}

function getDayLabel(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return DF[d.getDay()] + " " + MN[d.getMonth()] + " " + d.getDate();
  return MN[d.getMonth()] + " " + d.getDate();
}

function groupDoneByDay(tasks) {
  const done = tasks.filter(t => t.done && t.done_at);
  const groups = {};
  done.forEach(t => {
    const label = getDayLabel(t.done_at);
    if (!groups[label]) groups[label] = [];
    groups[label].push(t);
  });
  tasks.filter(t => t.done && !t.done_at).forEach(t => {
    if (!groups["earlier"]) groups["earlier"] = [];
    groups["earlier"].push(t);
  });
  return groups;
}

function getStaleDays(task) {
  if (!task.created_date) return 0;
  const created = new Date(task.created_date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.floor((today - created) / 86400000);
}

// ─── AUTH SCREEN ───
function AuthScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleLogin = async () => {
    setLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div style={S.shell}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 400, margin: "0 auto", padding: "80px 24px" }}>
        <div style={{ color: G, fontFamily: "'Orbitron',sans-serif", fontSize: 28, fontWeight: 900, letterSpacing: ".12em", marginBottom: 8 }}>DUMP</div>
        <div style={{ color: "#666", fontSize: 12, marginBottom: 40 }}>get it out of your head.</div>
        {!sent ? (
          <>
            <div style={{ color: "#999", fontSize: 12, marginBottom: 12 }}>sign in with magic link</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={S.modalInput}
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && email.includes("@")) handleLogin(); }}
              />
              <button style={S.btnGreen} className="btn-g" onClick={handleLogin} disabled={loading || !email.includes("@")}>
                {loading ? "..." : "go"}
              </button>
            </div>
            {error && <div style={{ color: R, fontSize: 11, marginTop: 8 }}>{error}</div>}
          </>
        ) : (
          <div style={{ color: G, fontSize: 13 }}>check your email — click the link to sign in.</div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN APP ───
export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [input, setInput] = useState("");
  const [toast, setToast] = useState(null);
  const [noteId, setNoteId] = useState(null);
  const [noteVal, setNoteVal] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [aiLoading, setAiLoading] = useState(null);
  const [aiPanel, setAiPanel] = useState(null);
  const [workPanel, setWorkPanel] = useState(null);
  const [workInput, setWorkInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [showDone, setShowDone] = useState(false);
  const inputRef = useRef(null);

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  // Load tasks
  const loadTasks = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase.from("tasks").select("*").order("sort_order", { ascending: true });
    if (data) setTasks(data);
  }, [session]);
  useEffect(() => { loadTasks(); }, [loadTasks]);

  // API key from localStorage (device-specific is fine)
  useEffect(() => { try { const k = localStorage.getItem("dump-api-key"); if (k) setApiKey(k); } catch {} }, []);

  const flash = m => { setToast(m); setTimeout(() => setToast(null), 1600); };

  // ─── DB ops ───
  const addTasks = async (texts) => {
    if (!session) return;
    const minSort = tasks.length ? Math.min(...tasks.filter(t => !t.done).map(t => t.sort_order), 0) - 1 : 0;
    const rows = texts.map((text, i) => ({
      user_id: session.user.id, text,
      sort_order: minSort - texts.length + i + 1,
      created_date: new Date().toISOString().split("T")[0],
    }));
    await supabase.from("tasks").insert(rows);
    flash(`+ ${texts.length} task${texts.length > 1 ? "s" : ""}`);
    loadTasks();
  };

  const toggleTask = async (id) => {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    if (!t.done) flash("done ✓");
    await supabase.from("tasks").update({ done: !t.done, done_at: !t.done ? new Date().toISOString() : null }).eq("id", id);
    loadTasks();
  };

  const deleteTask = async (id) => { await supabase.from("tasks").delete().eq("id", id); loadTasks(); };

  const updateNote = async (id, note) => { await supabase.from("tasks").update({ note }).eq("id", id); loadTasks(); };

  const reorderTasks = async (fromIdx, toIdx) => {
    const pend = tasks.filter(t => !t.done);
    const item = pend[fromIdx]; const r = [...pend]; r.splice(fromIdx, 1); r.splice(toIdx, 0, item);
    await Promise.all(r.map((t, i) => supabase.from("tasks").update({ sort_order: i }).eq("id", t.id)));
    loadTasks();
  };

  const clearDone = async () => {
    const ids = tasks.filter(t => t.done).map(t => t.id);
    if (!ids.length) return;
    await supabase.from("tasks").delete().in("id", ids);
    setShowDone(false); flash("cleared"); loadTasks();
  };

  // ─── Drag ───
  const handleDragStart = i => setDragIdx(i);
  const handleDragOver = (e, i) => { e.preventDefault(); setDragOverIdx(i); };
  const handleDrop = i => {
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setDragOverIdx(null); return; }
    reorderTasks(dragIdx, i); setDragIdx(null); setDragOverIdx(null);
  };

  // ─── Input ───
  const dump = () => {
    if (!input.trim()) return;
    addTasks(input.split(/\n/).map(l => l.trim()).filter(Boolean).map(l => l.replace(/^[-•*]\s*/, "")));
    setInput(""); inputRef.current?.focus();
  };

  // ─── Notes ───
  const openNote = id => { setNoteVal(tasks.find(x => x.id === id)?.note || ""); setNoteId(id); };
  const saveNotePopup = () => { if (noteId) updateNote(noteId, noteVal); setNoteId(null); setNoteVal(""); };

  // ─── AI ───
  const callClaude = async prompt => {
    if (!apiKey) { flash("no api key — open config"); setShowSettings(true); return null; }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    if (data.error) { flash("api error"); return null; }
    return data.content?.map(b => b.text || "").join("\n") || null;
  };

  const aiBreak = async (id, text) => {
    setAiLoading(id);
    try {
      const raw = await callClaude(`Break this task into 3-5 concrete sub-tasks. Return ONLY a JSON array of strings.\n\nTask: "${text}"`);
      if (raw) setAiPanel({ pid: id, ptxt: text, items: JSON.parse(raw.replace(/```json|```/g, "").trim()).map(t => ({ text: t, keep: true })) });
    } catch { flash("parse error"); }
    setAiLoading(null);
  };

  const confirmAi = async () => {
    if (!aiPanel) return;
    const kept = aiPanel.items.filter(i => i.keep).map(i => i.text);
    await deleteTask(aiPanel.pid);
    await addTasks(kept);
    setAiPanel(null);
  };

  const aiWork = async (id, text, extra) => {
    setWorkPanel({ id, text, output: "", loading: true });
    try {
      const note = tasks.find(t => t.id === id)?.note;
      const prompt = extra
        ? `Task: "${text}"\nPrevious:\n${workPanel?.output || ""}\nRefine: "${extra}"\nImproved output, no preamble:`
        : `Produce the deliverable for this task. Be direct, high quality, no preamble.${note ? `\n\nContext: ${note}` : ""}\n\nTask: "${text}"`;
      const raw = await callClaude(prompt);
      setWorkPanel(p => ({ ...p, output: raw || "error", loading: false }));
    } catch { setWorkPanel(p => ({ ...p, output: "failed", loading: false })); }
  };

  const openInClaude = () => {
    if (!workPanel) return;
    const note = tasks.find(t => t.id === workPanel.id)?.note;
    const prompt = `Help me work on this task: "${workPanel.text}"${note ? `\n\nContext: ${note}` : ""}${workPanel.output ? `\n\nHere's what we have so far:\n${workPanel.output}` : ""}`;
    navigator.clipboard.writeText(prompt); window.open("https://claude.ai/new", "_blank"); flash("copied → paste in claude");
  };

  const saveKey = () => { setApiKey(keyInput.trim()); try { localStorage.setItem("dump-api-key", keyInput.trim()); } catch {} setShowSettings(false); flash("saved"); };
  const signOut = async () => { await supabase.auth.signOut(); setSession(null); setTasks([]); };

  const pending = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);
  const pct = tasks.length ? Math.round(done.length / tasks.length * 100) : 0;
  const nudges = getNudges(tasks);

  if (authLoading) return <div style={S.shell}><style>{CSS}</style><div style={{padding:40,color:"#555",fontFamily:"'Fira Code',monospace"}}>loading...</div></div>;
  if (!session) return <AuthScreen />;

  return (
    <div style={S.shell}>
      <style>{CSS}</style>

      <div style={S.header}>
        <span style={S.logo}>dump</span>
        <span style={S.sep}>·</span>
        <span style={S.date}>{DF[TODAY.getDay()]} {MN[TODAY.getMonth()]} {TODAY.getDate()}</span>
        <div style={{flex:1}}/>
        {tasks.length > 0 && <span style={S.score}><span style={S.scoreHi}>{done.length}</span><span style={S.scoreDim}>/{tasks.length}</span></span>}
        <button style={S.cfgBtn} onClick={() => { setKeyInput(apiKey); setShowSettings(true); }}>config</button>
        <button style={S.cfgBtn} onClick={signOut}>sign out</button>
      </div>

      {tasks.length > 0 && (
        <div style={S.progRow}>
          <span style={S.progFill}>{"█".repeat(Math.round(pct / 5))}</span>
          <span style={S.progTrack}>{"░".repeat(20 - Math.round(pct / 5))}</span>
          <span style={S.progPct}>{pct}%</span>
        </div>
      )}

      <div style={S.main}>
        <div style={S.inputCard}>
          <div style={S.inputRow}>
            <span style={S.prompt}>›</span>
            <textarea ref={inputRef} style={S.inputTa} placeholder="type a task..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); dump(); } }} rows={1} />
            <button style={{...S.addBtn, ...(!input.trim()?{opacity:.3}:{})}} className="btn-g" onClick={dump} disabled={!input.trim()}>add</button>
          </div>
          <div style={S.inputHint}>enter = add · shift+enter = new line</div>
        </div>

        {nudges.map((n, i) => (
          <div key={i} style={{...S.nudge, ...(n.action?{cursor:"pointer"}:{})}} className="nudge-row" onClick={() => { if (n.action?.type === "break") aiBreak(n.action.id, tasks.find(t => t.id === n.action.id)?.text); }}>
            <span style={S.nudgeTag}>tip</span><span style={S.nudgeTxt}>{n.text}</span>{n.action && <span style={S.nudgeGo}>[go]</span>}
          </div>
        ))}

        {pending.length > 0 && <div style={S.secHead}>tasks ({pending.length})</div>}

        {pending.map((t, i) => {
          const isDragOver = dragOverIdx === i && dragIdx !== null && dragIdx !== i;
          const hasNote = t.note && t.note.trim();
          return (
            <div key={t.id} style={{...S.task, ...(isDragOver?S.taskDrag:{}), ...(i===0&&pending.length>1?S.taskNow:{})}} className="task-card"
              draggable onDragStart={()=>handleDragStart(i)} onDragOver={e=>handleDragOver(e,i)} onDrop={()=>handleDrop(i)} onDragEnd={()=>{setDragIdx(null);setDragOverIdx(null)}}>
              <div style={S.taskRow}>
                <span style={S.taskNum}>{pad2(i+1)}</span>
                <button style={S.ck} onClick={()=>toggleTask(t.id)}>[ ]</button>
                <span style={S.taskTxt}>{t.text}</span>
                {i===0&&pending.length>1&&<span style={S.nowTag}>now</span>}
                {(()=>{const d=getStaleDays(t);return d>=2?<span style={S.staleTag}>{d}d</span>:null})()}
              </div>
              {hasNote && <div style={S.notePreview} onClick={()=>openNote(t.id)}># {t.note.length>60?t.note.substring(0,60)+"...":t.note}</div>}
              <div style={S.taskBtns}>
                <button style={{...S.btn,...(hasNote?S.btnActive:{})}} className="btn-s" onClick={()=>openNote(t.id)}>{hasNote?"edit note":"note"}</button>
                <button style={S.btn} className="btn-s" onClick={()=>aiBreak(t.id,t.text)}>{aiLoading===t.id?"...":"split"}</button>
                <button style={S.btn} className="btn-s" onClick={()=>aiWork(t.id,t.text)}>ai</button>
                <div style={{flex:1}}/>
                <button style={S.btnX} className="btn-x" onClick={()=>deleteTask(t.id)}>×</button>
              </div>
            </div>
          );
        })}

        {done.length > 0 && (
          <div style={S.logSection}>
            <div style={S.logBar}>
              <button style={S.logToggle} onClick={()=>setShowDone(!showDone)}>log ({done.length}) {showDone?"▾":"▸"}</button>
              <button style={S.btnX} className="btn-x" onClick={clearDone}>clear all</button>
            </div>
            {showDone && (()=>{
              const groups = groupDoneByDay(tasks);
              return Object.entries(groups).map(([label, items]) => (
                <div key={label} style={S.logGroup}>
                  <div style={S.logDay}>{label}</div>
                  {items.map(t => <div key={t.id} style={S.logItem} onClick={()=>toggleTask(t.id)}><span style={S.logCheck}>[x]</span><span style={S.logTxt}>{t.text}</span></div>)}
                </div>
              ));
            })()}
          </div>
        )}

        {tasks.length === 0 && (
          <div style={S.empty}><pre style={S.emptyArt}>{`
  ┌──────────────────────────┐
  │                          │
  │    nothing here yet.     │
  │    type above to start.  │
  │                          │
  └──────────────────────────┘`}</pre></div>
        )}
      </div>

      {/* Modals */}
      {noteId && (
        <div style={S.overlay} onClick={saveNotePopup}>
          <div style={S.notePopup} onClick={e=>e.stopPropagation()}>
            <div style={S.notePopHead}><span style={S.notePopTitle}>note</span><span style={S.notePopSub}>"{tasks.find(t=>t.id===noteId)?.text}"</span></div>
            <textarea style={S.notePopTa} value={noteVal} onChange={e=>setNoteVal(e.target.value)} placeholder="context, links, details..." rows={5} autoFocus />
            <div style={S.notePopBtns}><button style={S.btn} className="btn-s" onClick={()=>{setNoteId(null);setNoteVal("")}}>cancel</button><button style={S.btnGreen} className="btn-g" onClick={saveNotePopup}>save</button></div>
          </div>
        </div>
      )}

      {showSettings && (
        <div style={S.overlay} onClick={()=>setShowSettings(false)}>
          <div style={S.modal} onClick={e=>e.stopPropagation()}>
            <div style={S.modalHead}>config</div>
            <div style={S.modalBody}>
              <div style={S.fieldLabel}>api_key</div><div style={S.fieldSub}>for ai features · console.anthropic.com</div>
              <input style={S.modalInput} type="password" placeholder="sk-ant-..." value={keyInput} onChange={e=>setKeyInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveKey()}} />
              {apiKey && <div style={S.keyOk}>✓ key stored</div>}
              <div style={S.modalBtns}><button style={S.btn} className="btn-s" onClick={()=>setShowSettings(false)}>cancel</button><button style={S.btnGreen} className="btn-g" onClick={saveKey}>save</button></div>
            </div>
          </div>
        </div>
      )}

      {aiPanel && (
        <div style={S.overlay} onClick={()=>setAiPanel(null)}>
          <div style={S.modal} onClick={e=>e.stopPropagation()}>
            <div style={S.modalHead}>split: "{aiPanel.ptxt}"</div>
            <div style={S.modalBody}>
              {aiPanel.items.map((it,i) => (
                <div key={i} style={{...S.splitItem,...(!it.keep?{opacity:.2}:{})}} onClick={()=>setAiPanel(p=>({...p,items:p.items.map((x,j)=>j===i?{...x,keep:!x.keep}:x)}))}>
                  <span style={S.splitCk}>[{it.keep?"x":" "}]</span><span>{it.text}</span>
                </div>
              ))}
              <div style={S.modalBtns}><button style={S.btn} className="btn-s" onClick={()=>setAiPanel(null)}>cancel</button><button style={S.btnGreen} className="btn-g" onClick={confirmAi}>add {aiPanel.items.filter(i=>i.keep).length}</button></div>
            </div>
          </div>
        </div>
      )}

      {workPanel && (
        <div style={S.overlay} onClick={()=>{setWorkPanel(null);setWorkInput("")}}>
          <div style={{...S.modal,maxWidth:560}} onClick={e=>e.stopPropagation()}>
            <div style={S.modalHead}>{workPanel.loading?"working...":"output"}</div>
            <div style={S.modalSub}>"{workPanel.text}"</div>
            <div style={S.modalBody}>
              {workPanel.loading ? <div style={S.loadTxt}>generating...</div> : <pre style={S.aiOut}>{workPanel.output}</pre>}
              {!workPanel.loading && (
                <>
                  <div style={{display:"flex",gap:8,marginTop:12}}>
                    <input style={{...S.modalInput,flex:1}} placeholder="refine..." value={workInput} onChange={e=>setWorkInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&workInput.trim()){aiWork(workPanel.id,workPanel.text,workInput);setWorkInput("")}}} />
                    <button style={S.btnGreen} className="btn-g" onClick={()=>{if(workInput.trim()){aiWork(workPanel.id,workPanel.text,workInput);setWorkInput("")}}}>go</button>
                  </div>
                  <div style={S.modalBtns}>
                    <button style={S.btn} className="btn-s" onClick={openInClaude}>open in claude</button>
                    <button style={S.btn} className="btn-s" onClick={()=>{navigator.clipboard.writeText(workPanel.output);flash("copied")}}>copy</button>
                    <button style={S.btnGreen} className="btn-g" onClick={()=>{toggleTask(workPanel.id);setWorkPanel(null);setWorkInput("")}}>mark done</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

const G = "#00FF41";
const A = "#FFB840";
const R = "#FF5555";
const BG = "#0B0B0B";
const CARD = "#141414";
const BORDER = "#2A2A2A";
const BORDER_L = "#363636";
const TXT = "#E8E8E8";
const TXT_DIM = "#999";
const TXT_XDIM = "#666";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Orbitron:wght@700;900&display=swap');
@keyframes toast{0%{transform:translateX(-50%) translateY(12px);opacity:0}15%{transform:translateX(-50%) translateY(0);opacity:1}80%{opacity:1}100%{transform:translateX(-50%) translateY(-4px);opacity:0}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${BG}}::-webkit-scrollbar-thumb{background:#333}
textarea::placeholder,input::placeholder{color:#555}
::selection{background:${G};color:#000}
.task-card{transition:background .1s}.task-card:hover{background:#191919 !important}
.btn-s{transition:all .08s}.btn-s:hover{background:#2A2A2A !important;color:#fff !important;border-color:#444 !important}
.btn-g{transition:all .08s}.btn-g:hover{filter:brightness(1.15)}
.btn-x{transition:all .08s}.btn-x:hover{color:${R} !important;border-color:${R}44 !important;background:#1A1214 !important}
.nudge-row{transition:background .1s}.nudge-row:hover{background:#161616 !important}
`;

const S = {
  shell: { minHeight: "100vh", background: BG, fontFamily: "'Fira Code',monospace", color: TXT, fontSize: 13 },
  header: { display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", borderBottom: `1px solid ${BORDER}`, flexWrap: "wrap" },
  logo: { color: G, fontWeight: 900, fontSize: 20, fontFamily: "'Orbitron',sans-serif", letterSpacing: ".12em", textTransform: "uppercase" },
  sep: { color: "#444" },
  date: { color: TXT_XDIM, fontSize: 12 },
  score: { fontSize: 14 },
  scoreHi: { color: G, fontWeight: 700 },
  scoreDim: { color: TXT_XDIM },
  cfgBtn: { background: CARD, border: `1px solid ${BORDER}`, color: TXT_DIM, padding: "5px 14px", fontSize: 11, cursor: "pointer", fontFamily: "'Fira Code',monospace", borderRadius: 3 },
  progRow: { padding: "10px 24px", borderBottom: "1px solid #1A1A1A", display: "flex", alignItems: "center", gap: 8 },
  progFill: { color: G, letterSpacing: "1px", fontSize: 11 },
  progTrack: { color: "#252525", letterSpacing: "1px", fontSize: 11 },
  progPct: { color: TXT_DIM, fontSize: 11, marginLeft: 4 },
  main: { maxWidth: 640, margin: "0 auto", padding: "0 24px 60px" },
  inputCard: { marginTop: 20, marginBottom: 18, padding: 16, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 4 },
  inputRow: { display: "flex", alignItems: "flex-start", gap: 10 },
  prompt: { color: G, fontWeight: 700, fontSize: 18, marginTop: -1 },
  inputTa: { flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 15, fontFamily: "'Fira Code',monospace", resize: "none", lineHeight: 1.5, caretColor: G },
  addBtn: { background: G, color: "#000", border: "none", padding: "7px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Fira Code',monospace", flexShrink: 0, borderRadius: 3 },
  inputHint: { marginTop: 10, fontSize: 10, color: TXT_XDIM },
  nudge: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 4, background: CARD, border: "1px solid #1E1E1E", borderRadius: 3, fontSize: 12 },
  nudgeTag: { color: A, fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" },
  nudgeTxt: { color: "#ccc", flex: 1 },
  nudgeGo: { color: G, fontWeight: 700 },
  secHead: { marginTop: 22, fontSize: 11, color: TXT_XDIM, borderBottom: "1px solid #1E1E1E", paddingBottom: 8, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".08em" },
  task: { padding: "16px 14px", marginBottom: 3, background: CARD, border: "1px solid #1E1E1E", borderRadius: 4, cursor: "grab" },
  taskDrag: { borderColor: `${G}66`, borderStyle: "dashed" },
  taskNow: { borderLeft: `3px solid ${G}` },
  taskRow: { display: "flex", alignItems: "flex-start", gap: 10 },
  taskNum: { color: TXT_XDIM, fontSize: 11, fontWeight: 600, minWidth: 20, marginTop: 2 },
  ck: { background: "none", border: "none", color: TXT_DIM, cursor: "pointer", fontSize: 13, fontFamily: "'Fira Code',monospace", padding: 0 },
  taskTxt: { flex: 1, color: "#F0F0F0", fontSize: 14, lineHeight: 1.6 },
  nowTag: { color: G, fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 4, background: `${G}15`, padding: "2px 8px", borderRadius: 2 },
  staleTag: { color: A, fontSize: 9, fontWeight: 700, flexShrink: 0, marginTop: 4, background: `${A}15`, padding: "2px 6px", borderRadius: 2 },
  notePreview: { marginTop: 8, marginLeft: 30, fontSize: 11, color: TXT_DIM, cursor: "pointer", lineHeight: 1.5, borderLeft: `2px solid ${BORDER}`, paddingLeft: 10 },
  taskBtns: { display: "flex", gap: 6, marginTop: 12, marginLeft: 30, alignItems: "center" },
  btn: { background: "#1A1A1A", border: `1px solid ${BORDER}`, color: TXT_DIM, padding: "5px 14px", fontSize: 10, cursor: "pointer", fontFamily: "'Fira Code',monospace", borderRadius: 3 },
  btnActive: { borderColor: `${G}44`, color: G },
  btnGreen: { background: G, border: `1px solid ${G}`, color: "#000", padding: "5px 16px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "'Fira Code',monospace", borderRadius: 3 },
  btnX: { background: "transparent", border: `1px solid ${BORDER}`, color: "#555", padding: "5px 12px", fontSize: 14, cursor: "pointer", fontFamily: "'Fira Code',monospace", borderRadius: 3 },
  logSection: { marginTop: 24, borderTop: "1px solid #1E1E1E", paddingTop: 14 },
  logBar: { display: "flex", alignItems: "center", gap: 12 },
  logToggle: { background: "none", border: "none", color: TXT_XDIM, fontSize: 12, cursor: "pointer", fontFamily: "'Fira Code',monospace" },
  logGroup: { marginTop: 12 },
  logDay: { fontSize: 10, color: G, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4, paddingBottom: 4, borderBottom: "1px solid #1A1A1A" },
  logItem: { display: "flex", alignItems: "center", gap: 10, padding: "6px 0 6px 12px", cursor: "pointer", opacity: .5 },
  logCheck: { color: G, fontSize: 12 },
  logTxt: { color: TXT_DIM, textDecoration: "line-through", fontSize: 12 },
  empty: { marginTop: 40 },
  emptyArt: { color: "#444", fontSize: 12, lineHeight: 1.6, fontFamily: "'Fira Code',monospace", margin: 0 },
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.8)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center" },
  notePopup: { background: "#181818", border: `1px solid ${BORDER_L}`, borderRadius: 6, width: 440, maxWidth: "92vw", padding: 20, boxShadow: "0 12px 40px rgba(0,0,0,.6)" },
  notePopHead: { marginBottom: 14 },
  notePopTitle: { color: G, fontWeight: 700, fontSize: 14 },
  notePopSub: { color: TXT_XDIM, fontSize: 11, marginTop: 4, fontStyle: "italic", display: "block" },
  notePopTa: { width: "100%", background: "#111", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "12px 14px", color: "#eee", fontSize: 13, fontFamily: "'Fira Code',monospace", outline: "none", resize: "vertical", lineHeight: 1.6, caretColor: G },
  notePopBtns: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 },
  modal: { background: "#151515", border: `1px solid ${BORDER_L}`, borderRadius: 6, width: 460, maxWidth: "92vw", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,.6)" },
  modalHead: { padding: "16px 20px", borderBottom: "1px solid #222", color: G, fontWeight: 700, fontSize: 14 },
  modalSub: { padding: "8px 20px 0", fontSize: 11, color: TXT_DIM, fontStyle: "italic" },
  modalBody: { padding: "16px 20px 22px", overflowY: "auto" },
  fieldLabel: { fontSize: 11, color: A, fontWeight: 700, marginBottom: 4 },
  fieldSub: { fontSize: 10, color: TXT_XDIM, marginBottom: 12 },
  modalInput: { width: "100%", background: "#111", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "9px 12px", color: "#fff", fontSize: 12, fontFamily: "'Fira Code',monospace", outline: "none" },
  keyOk: { marginTop: 8, fontSize: 10, color: G },
  modalBtns: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 },
  splitItem: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid #1E1E1E", cursor: "pointer", fontSize: 12, color: "#ddd" },
  splitCk: { color: G, fontWeight: 700, flexShrink: 0 },
  loadTxt: { padding: "30px 0", textAlign: "center", color: TXT_XDIM, animation: "pulse 1.5s ease-in-out infinite" },
  aiOut: { color: "#ddd", fontSize: 12, lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: "'Fira Code',monospace", margin: 0, maxHeight: "45vh", overflowY: "auto" },
  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: G, color: "#000", padding: "7px 24px", fontSize: 11, fontWeight: 700, zIndex: 80, animation: "toast 1.6s ease both", fontFamily: "'Fira Code',monospace", borderRadius: 3 },
};
