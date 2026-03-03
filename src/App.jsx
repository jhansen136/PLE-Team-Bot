import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const WELCOME = "Hey! I'm your team's knowledge bot 👋 Ask me anything, or tell me something to update — like *\"Update the ECD to May 28\"* — and I'll confirm before saving.";

function Spinner() {
  return (
    <div style={{display:"flex",gap:4,alignItems:"center",padding:"8px 0"}}>
      {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#6ee7b7",animation:"bounce 1.2s infinite",animationDelay:`${i*0.2}s`}}/>)}
    </div>
  );
}

function fileToBase64(file) {
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});
}

function ConfirmCard({pending, onConfirm, onCancel}) {
  const isEdit = pending.type==="edit";
  return (
    <div style={{marginTop:8,background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"12px 14px",fontSize:13,border:"1px solid rgba(110,231,183,0.3)"}}>
      <div style={{fontWeight:700,color:"#6ee7b7",marginBottom:8,fontSize:11,textTransform:"uppercase",letterSpacing:"0.8px"}}>
        {isEdit?"✏️ Edit KB Entry":"➕ New KB Entry"}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"80px 1fr",gap:"5px 10px",marginBottom:10}}>
        <span style={{color:"#4b5563",fontSize:12}}>Category</span><span style={{color:"#e2e8f0"}}>{pending.entry.category}</span>
        <span style={{color:"#4b5563",fontSize:12}}>Question</span><span style={{color:"#e2e8f0"}}>{pending.entry.question}</span>
        {isEdit&&pending.oldAnswer&&<><span style={{color:"#4b5563",fontSize:12}}>Before</span><span style={{color:"#fca5a5",textDecoration:"line-through"}}>{pending.oldAnswer}</span></>}
        {isEdit&&<><span style={{color:"#4b5563",fontSize:12}}>After</span><span style={{color:"#6ee7b7"}}>{pending.newSnippet||pending.entry.answer}</span></>}
        {!isEdit&&<><span style={{color:"#4b5563",fontSize:12}}>Answer</span><span style={{color:"#6ee7b7"}}>{pending.entry.answer}</span></>}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onConfirm} style={{background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",border:"none",borderRadius:7,padding:"6px 16px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:12,color:"#0d1117"}}>✓ Confirm</button>
        <button onClick={onCancel} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.12)",borderRadius:7,padding:"6px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:"#94a3b8"}}>✕ Cancel</button>
      </div>
    </div>
  );
}

export default function TeamBot() {
  const [tab, setTab] = useState("chat");
  const [messages, setMessages] = useState([{role:"assistant",content:WELCOME}]);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [knowledge, setKnowledge] = useState([]);
  const [newEntry, setNewEntry] = useState({category:"",question:"",answer:"",addedBy:""});
  const [addingNew, setAddingNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [editId, setEditId] = useState(null);
  const [editEntry, setEditEntry] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [debugLog, setDebugLog] = useState([]);
  const [showDebug, setShowDebug] = useState(false);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const knowledgeRef = useRef(knowledge);
  useEffect(()=>{knowledgeRef.current=knowledge;},[knowledge]);

  function log(msg) {
    console.log("[TeamBot]", msg);
    setDebugLog(prev=>[...prev.slice(-19), `${new Date().toLocaleTimeString()} ${msg}`]);
  }

  useEffect(()=>{
    (async()=>{
      try {
        const {data,error} = await supabase.from("knowledge_base").select("*").order("created_at");
        if(error) throw error;
        const mapped = data.map(r=>({id:r.id,category:r.category,question:r.question,answer:r.answer,addedBy:r.added_by,date:r.date}));
        setKnowledge(mapped);
        log("KB loaded: "+mapped.length+" entries");
      } catch(e) { log("KB load error: "+e.message); }
    })();
  },[]);

  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading]);

  async function persistKnowledge(kb) {
    setKnowledge(kb);
    knowledgeRef.current=kb;
  }

  async function saveEntryToSupabase(entry) {
    const {error} = await supabase.from("knowledge_base").upsert({
      id: entry.id,
      category: entry.category,
      question: entry.question,
      answer: entry.answer,
      added_by: entry.addedBy,
      date: entry.date
    });
    if(error) throw error;
  }

  async function deleteEntryFromSupabase(id) {
    const {error} = await supabase.from("knowledge_base").delete().eq("id",id);
    if(error) throw error;
  }

  function buildContext(kb) {
    if(!kb.length) return "No entries yet.";
    return kb.map(e=>`[id:${e.id}][${e.category||"General"}] Q: ${e.question}\nA: ${e.answer}`).join("\n\n");
  }

  async function handlePaste(e) {
    const items=e.clipboardData?.items; if(!items) return;
    for(const item of items){if(item.type.startsWith("image/")){e.preventDefault();await attachImage(item.getAsFile());return;}}
  }
  async function handleFileChange(e){const f=e.target.files?.[0];if(!f)return;await attachImage(f);e.target.value="";}
  async function attachImage(file){try{const b=await fileToBase64(file);setPendingImage({base64:b,mediaType:file.type,previewUrl:URL.createObjectURL(file)});}catch(e){}}
  function removePendingImage(){if(pendingImage?.previewUrl)URL.revokeObjectURL(pendingImage.previewUrl);setPendingImage(null);}
  function clearChat(){setMessages([{role:"assistant",content:WELCOME}]);log("Chat cleared");}

  async function callClaude(system, userContent, maxTokens=400) {
    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: typeof userContent === "string" ? userContent : JSON.stringify(userContent) }]
    };
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    });
    if(!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    const data = await res.json();
    return data.content?.map(b=>b.text||"").join("").trim()||"";
  }

  async function sendMessage() {
    if((!input.trim()&&!pendingImage)||loading) return;
    const userText=input.trim()||"What can you tell me about this image?";
    const contentBlocks=[];
    if(pendingImage) contentBlocks.push({type:"image",source:{type:"base64",media_type:pendingImage.mediaType,data:pendingImage.base64}});
    contentBlocks.push({type:"text",text:userText});

    const displayMsg={role:"user",content:userText,imagePreview:pendingImage?.previewUrl??null};
    const updatedDisplay=[...messages,displayMsg];
    setMessages(updatedDisplay);
    setInput(""); removePendingImage(); setLoading(true);

    try {
      const recentContext=updatedDisplay.slice(-4).map(m=>`${m.role}: ${m.content}`).join("\n");

      log("Classifying: "+userText.slice(0,60));
      const classifyAnswer = await callClaude(
        `You decide if the conversation is heading toward ADDING or UPDATING information in a team knowledge base.
Reply only "YES" if the user clearly wants to record, update, add, or change a fact/date/value — including short confirmations like "yes" or "sure" that follow a bot proposing a KB change.
Reply only "NO" for questions, greetings, or general conversation with no pending KB change.`,
        recentContext, 10
      );
      log("Classifier result: "+classifyAnswer);
      const isKbUpdate = classifyAnswer.toUpperCase().includes("YES");

      if(isKbUpdate) {
        log("Extracting KB update...");
        const kbSummary=knowledgeRef.current.map(e=>`id:${e.id} | [${e.category||"General"}] Q: ${e.question} | A: ${e.answer.slice(0,80)}...`).join("\n");

        // Find the most relevant existing entry and send its FULL raw answer
        // so the extractor can pick an oldSnippet guaranteed to exist verbatim
        const recentConv=updatedDisplay.slice(-4).map(m=>`${m.role}: ${m.content}`).join("\n");
        const bestMatchEntry = knowledgeRef.current.find(e=>
          recentConv.toLowerCase().includes(e.question.toLowerCase().slice(0,20)) ||
          recentConv.toLowerCase().includes((e.category||"").toLowerCase())
        ) || knowledgeRef.current[0];

        const extractAnswer = await callClaude(
          `Extract a KB update from the conversation and output ONLY a raw JSON object — no markdown, no backticks, no explanation, just JSON starting with {.

KB entries (id | category | question | answer preview):
${kbSummary}

Most relevant existing entry (FULL raw answer text — use this to find an exact oldSnippet):
ID: ${bestMatchEntry?.id}
Answer: ${bestMatchEntry?.answer}

Recent conversation:
${recentConv}

Output format — pick one:

For a NEW entry:
{"type":"add","entry":{"category":"...","question":"...","answer":"..."}}

For an EDIT to one specific value inside an existing entry:
{"type":"edit","id":"<exact id>","oldSnippet":"<copy exact characters from the Full raw answer above>","newSnippet":"<replacement text>"}

CRITICAL: oldSnippet must be copied CHARACTER FOR CHARACTER from the Full raw answer text above. Do not add or change any formatting, bold markers, or whitespace.`,
          userText, 200
        );
        log("Extractor raw: "+extractAnswer.slice(0,120));

        const cleanJson=extractAnswer.replace(/^```[\w]*\n?/,"").replace(/\n?```$/,"").trim();
        let parsed=null;
        try{parsed=JSON.parse(cleanJson);}catch(e){log("JSON parse failed: "+e.message);}

        if(parsed?.type==="edit") {
          const existing=knowledgeRef.current.find(e=>e.id===parsed.id);
          if(existing) {
            const snippetFound = parsed.oldSnippet && existing.answer.includes(parsed.oldSnippet);
            if(!snippetFound) log("WARNING: oldSnippet not found: "+parsed.oldSnippet?.slice(0,60));
            const updatedAnswer = snippetFound
              ? existing.answer.replace(parsed.oldSnippet, parsed.newSnippet)
              : existing.answer;
            parsed={type:"edit",id:parsed.id,oldAnswer:parsed.oldSnippet,newSnippet:parsed.newSnippet,entry:{...existing,answer:updatedAnswer}};
            log(snippetFound ? "Snippet replace ready" : "Snippet not found — answer unchanged");
          }
        }

        if(parsed&&(parsed.type==="add"||parsed.type==="edit")) {
          log("Showing confirm card");
          setMessages([...updatedDisplay,{role:"assistant",content:"I'd like to make the following change to the Knowledge Base — please confirm:",pending:parsed}]);
          setLoading(false);
          return;
        } else {
          log("Extraction failed, falling through to chat");
        }
      }

      log("Normal chat response");
      const chatHistory=updatedDisplay.map(m=>({role:m.role,content:m.content}));
      chatHistory[chatHistory.length-1]={role:"user",content:contentBlocks};
      const res=await fetch(ANTHROPIC_API,{
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",max_tokens:1000,
          system:`You are a helpful team knowledge assistant. Answer questions using the knowledge base below. Be concise and friendly. Never mention JSON, KB mechanics, or your own update process.\n\nKNOWLEDGE BASE:\n${buildContext(knowledgeRef.current)}`,
          messages:chatHistory
        })
      });
      const data=await res.json();
      const reply=data.content?.map(b=>b.text||"").join("")||"Sorry, couldn't get a response.";
      setMessages([...updatedDisplay,{role:"assistant",content:reply}]);
    } catch(e) {
      log("Error: "+e.message);
      setMessages(prev=>[...prev,{role:"assistant",content:`⚠️ Error: ${e.message}`}]);
    }
    setLoading(false);
  }

  async function confirmKbUpdate(msgIndex, pending) {
    log("Confirming KB update type="+pending.type);
    const today=new Date().toISOString().slice(0,10);
    const kb=knowledgeRef.current;
    let updatedKb;
    try {
      if(pending.type==="add") {
        const entry={id:Date.now().toString(),category:pending.entry.category||"General",question:pending.entry.question,answer:pending.entry.answer,addedBy:"Chat",date:today};
        await saveEntryToSupabase(entry);
        updatedKb=[...kb,entry];
      } else if(pending.type==="edit") {
        const updated={...pending.entry,date:today};
        await saveEntryToSupabase(updated);
        updatedKb=kb.map(e=>e.id===pending.id?updated:e);
      }
      await persistKnowledge(updatedKb);
      const newMsgs=messages.map((m,i)=>i===msgIndex?{...m,pending:null,confirmed:true}:m);
      newMsgs.push({role:"assistant",content:`✅ Done! KB has been ${pending.type==="add"?"updated with a new entry":"updated"}. Switch to the Knowledge Base tab to verify.`});
      setMessages(newMsgs);
      log("KB saved to Supabase");
    } catch(e) {
      log("Supabase save error: "+e.message);
      setMessages(prev=>[...prev,{role:"assistant",content:"⚠️ Failed to save to database: "+e.message}]);
    }
  }

  function cancelKbUpdate(msgIndex) {
    const newMsgs=messages.map((m,i)=>i===msgIndex?{...m,pending:null}:m);
    newMsgs.push({role:"assistant",content:"No problem, no changes made."});
    setMessages(newMsgs);
  }

  async function addEntry() {
    if(!newEntry.question.trim()||!newEntry.answer.trim()) return;
    setSaving(true);
    const entry={id:Date.now().toString(),category:newEntry.category||"General",question:newEntry.question.trim(),answer:newEntry.answer.trim(),addedBy:newEntry.addedBy||"Anonymous",date:new Date().toISOString().slice(0,10)};
    try {
      await saveEntryToSupabase(entry);
      await persistKnowledge([...knowledge,entry]);
      setNewEntry({category:"",question:"",answer:"",addedBy:""});
      setAddingNew(false);
      setSaveMsg("Entry added!");
      setTimeout(()=>setSaveMsg(""),2500);
    } catch(e) { log("Add error: "+e.message); }
    setSaving(false);
  }

  async function deleteEntry(id) {
    try {
      await deleteEntryFromSupabase(id);
      await persistKnowledge(knowledge.filter(e=>e.id!==id));
    } catch(e) { log("Delete error: "+e.message); }
  }

  async function saveEdit(id) {
    try {
      const entry=knowledge.find(e=>e.id===id);
      const updated={...entry,...editEntry};
      await saveEntryToSupabase(updated);
      await persistKnowledge(knowledge.map(e=>e.id===id?updated:e));
      setEditId(null);
      setSaveMsg("Entry updated!");
      setTimeout(()=>setSaveMsg(""),2500);
    } catch(e) { log("Edit error: "+e.message); }
  }

  function startEdit(e){setEditId(e.id);setEditEntry({...e});}
  const filtered=knowledge.filter(e=>!searchTerm||[e.question,e.answer,e.category||""].some(v=>v.toLowerCase().includes(searchTerm.toLowerCase())));

  const s={
    root:{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:"#0d1117",minHeight:"100vh",display:"flex",flexDirection:"column",color:"#e2e8f0"},
    header:{background:"linear-gradient(135deg,#0d1f2d 0%,#111827 100%)",borderBottom:"1px solid rgba(110,231,183,0.12)",padding:"16px 24px",display:"flex",alignItems:"center",justifyContent:"space-between"},
    logoWrap:{display:"flex",alignItems:"center",gap:11},
    logoIcon:{width:36,height:36,borderRadius:9,background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,color:"#0d1117",fontWeight:"bold"},
    logoText:{fontSize:17,fontWeight:700,color:"#f0fdf4",letterSpacing:"-0.2px"},
    logoSub:{fontSize:11,color:"#6ee7b7",marginTop:1},
    tabs:{display:"flex",gap:3,background:"rgba(255,255,255,0.05)",borderRadius:10,padding:3},
    tab:(a)=>({padding:"7px 16px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,transition:"all 0.2s",background:a?"linear-gradient(135deg,#6ee7b7,#3b82f6)":"transparent",color:a?"#0d1117":"#94a3b8"}),
    badge:{background:"#6ee7b7",color:"#0d1117",borderRadius:20,padding:"1px 7px",fontSize:11,fontWeight:700,marginLeft:5},
    main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"},
    chatArea:{flex:1,overflowY:"auto",padding:"20px 24px",display:"flex",flexDirection:"column",gap:14,maxWidth:740,width:"100%",margin:"0 auto",boxSizing:"border-box"},
    bubble:(r)=>({maxWidth:"78%",alignSelf:r==="user"?"flex-end":"flex-start",background:r==="user"?"linear-gradient(135deg,#2563eb,#1d4ed8)":"rgba(255,255,255,0.05)",border:r==="user"?"none":"1px solid rgba(255,255,255,0.08)",borderRadius:r==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"11px 15px",fontSize:14,lineHeight:1.6,color:r==="user"?"#fff":"#e2e8f0"}),
    inputWrap:{padding:"12px 24px 18px",borderTop:"1px solid rgba(255,255,255,0.07)",maxWidth:740,width:"100%",margin:"0 auto",boxSizing:"border-box"},
    previewWrap:{display:"flex",alignItems:"center",gap:9,marginBottom:8,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(110,231,183,0.2)",borderRadius:9,padding:"7px 10px"},
    previewImg:{width:52,height:52,objectFit:"cover",borderRadius:6},
    previewLabel:{flex:1,fontSize:12,color:"#6ee7b7"},
    removeBtn:{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:6,padding:"3px 9px",cursor:"pointer",fontSize:12,color:"#fca5a5",fontFamily:"inherit"},
    inputRow:{display:"flex",gap:9},
    chatInput:{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:11,padding:"11px 15px",color:"#e2e8f0",fontFamily:"inherit",fontSize:14,outline:"none",resize:"none"},
    uploadBtn:{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:11,padding:"11px 14px",cursor:"pointer",fontSize:17,display:"flex",alignItems:"center",justifyContent:"center",color:"#94a3b8"},
    sendBtn:{background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",border:"none",borderRadius:11,padding:"11px 18px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:14,color:"#0d1117",whiteSpace:"nowrap"},
    hint:{fontSize:11,color:"#374151",marginTop:6,textAlign:"center"},
    debugBox:{background:"#0a0a0a",border:"1px solid #1f2937",borderRadius:8,padding:"10px 12px",marginTop:8,fontSize:11,color:"#4b5563",fontFamily:"monospace",maxHeight:120,overflowY:"auto"},
    kbWrap:{flex:1,overflowY:"auto",padding:"20px 24px",maxWidth:800,width:"100%",margin:"0 auto",boxSizing:"border-box"},
    kbTop:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,gap:10,flexWrap:"wrap"},
    kbTitle:{fontSize:19,fontWeight:700,color:"#f0fdf4"},
    searchInput:{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:9,padding:"8px 13px",color:"#e2e8f0",fontFamily:"inherit",fontSize:13,outline:"none",width:190},
    addBtn:{background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",border:"none",borderRadius:9,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:13,color:"#0d1117"},
    card:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:13,padding:"15px 18px",marginBottom:10},
    cardCat:{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1.2,color:"#6ee7b7",marginBottom:5},
    cardQ:{fontSize:14,fontWeight:600,color:"#f0fdf4",marginBottom:5},
    cardA:{fontSize:13,color:"#94a3b8",lineHeight:1.6},
    cardMeta:{fontSize:11,color:"#4b5563",marginTop:9},
    cardActions:{display:"flex",gap:7,marginTop:10},
    editBtn:{background:"rgba(59,130,246,0.12)",border:"1px solid rgba(59,130,246,0.25)",borderRadius:7,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:"#93c5fd"},
    deleteBtn:{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:7,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:"#fca5a5"},
    saveBtn:{background:"rgba(110,231,183,0.12)",border:"1px solid rgba(110,231,183,0.25)",borderRadius:7,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:"#6ee7b7"},
    formCard:{background:"rgba(110,231,183,0.04)",border:"1px solid rgba(110,231,183,0.18)",borderRadius:13,padding:"18px",marginBottom:14},
    formTitle:{fontSize:13,fontWeight:700,color:"#6ee7b7",marginBottom:12},
    formRow:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9},
    fInput:{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"8px 11px",color:"#e2e8f0",fontFamily:"inherit",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"},
    fTextarea:{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"8px 11px",color:"#e2e8f0",fontFamily:"inherit",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box",resize:"vertical",minHeight:75},
    formBtns:{display:"flex",gap:7,marginTop:11,justifyContent:"flex-end"},
    cancelBtn:{background:"transparent",border:"1px solid rgba(255,255,255,0.09)",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:13,color:"#94a3b8"},
    successMsg:{background:"rgba(110,231,183,0.08)",border:"1px solid rgba(110,231,183,0.2)",borderRadius:8,padding:"7px 13px",fontSize:13,color:"#6ee7b7",marginBottom:11},
    empty:{textAlign:"center",color:"#4b5563",padding:"50px 20px",fontSize:14},
  };

  function md(t){return t.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/\n/g,'<br/>');}
  const iconBtn={background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:8,padding:"7px 11px",cursor:"pointer",fontSize:12,color:"#6b7280",fontFamily:"inherit"};

  return (
    <div style={s.root}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap'); @keyframes bounce{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}} ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:rgba(110,231,183,0.18);border-radius:3px} input:focus,textarea:focus{border-color:rgba(110,231,183,0.35)!important}`}</style>
      <header style={s.header}>
        <div style={s.logoWrap}>
          <div style={s.logoIcon}>⚡</div>
          <div><div style={s.logoText}>TeamBot</div><div style={s.logoSub}>{knowledge.length} knowledge entries</div></div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={s.tabs}>
            <button style={s.tab(tab==="chat")} onClick={()=>setTab("chat")}>💬 Chat</button>
            <button style={s.tab(tab==="kb")} onClick={()=>setTab("kb")}>📚 Knowledge Base<span style={s.badge}>{knowledge.length}</span></button>
          </div>
          {tab==="chat"&&<>
            <button onClick={()=>setShowDebug(v=>!v)} style={iconBtn}>🔍</button>
            <button onClick={clearChat} style={iconBtn}>🗑</button>
          </>}
        </div>
      </header>

      <div style={s.main}>
        {tab==="chat"&&<>
          <div style={s.chatArea}>
            {messages.map((m,i)=>(
              <div key={i} style={{...s.bubble(m.role),display:"flex",flexDirection:"column",gap:m.imagePreview?8:0}}>
                {m.imagePreview&&<img src={m.imagePreview} alt="uploaded" style={{maxWidth:"100%",maxHeight:200,borderRadius:8,objectFit:"contain"}}/>}
                <span dangerouslySetInnerHTML={{__html:md(m.content)}}/>
                {m.pending&&<ConfirmCard pending={m.pending} onConfirm={()=>confirmKbUpdate(i,m.pending)} onCancel={()=>cancelKbUpdate(i)}/>}
              </div>
            ))}
            {loading&&<div style={s.bubble("assistant")}><Spinner/></div>}
            <div ref={chatEndRef}/>
          </div>
          <div style={s.inputWrap}>
            {showDebug&&<div style={s.debugBox}>{debugLog.length===0?"No logs yet.":[...debugLog].reverse().map((l,i)=><div key={i}>{l}</div>)}</div>}
            {pendingImage&&<div style={s.previewWrap}><img src={pendingImage.previewUrl} alt="preview" style={s.previewImg}/><span style={s.previewLabel}>📎 Image attached</span><button style={s.removeBtn} onClick={removePendingImage}>✕</button></div>}
            <div style={s.inputRow}>
              <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleFileChange}/>
              <button style={s.uploadBtn} onClick={()=>fileInputRef.current?.click()}>📎</button>
              <textarea style={s.chatInput} rows={1} placeholder="Ask something, or say what to update…" value={input} onChange={e=>setInput(e.target.value)} onPaste={handlePaste} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}}/>
              <button style={{...s.sendBtn,opacity:loading?0.6:1}} onClick={sendMessage} disabled={loading}>Send →</button>
            </div>
            <div style={s.hint}>Try: "Update the ECD to May 28" · 📎 upload or paste image</div>
          </div>
        </>}

        {tab==="kb"&&<div style={s.kbWrap}>
          <div style={s.kbTop}>
            <div style={s.kbTitle}>Knowledge Base</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input style={s.searchInput} placeholder="Search..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/>
              <button style={s.addBtn} onClick={()=>{setAddingNew(true);setEditId(null);}}>+ Add Entry</button>
            </div>
          </div>
          {saveMsg&&<div style={s.successMsg}>✓ {saveMsg}</div>}
          {addingNew&&<div style={s.formCard}>
            <div style={s.formTitle}>New Knowledge Entry</div>
            <div style={s.formRow}>
              <input style={s.fInput} placeholder="Category" value={newEntry.category} onChange={e=>setNewEntry({...newEntry,category:e.target.value})}/>
              <input style={s.fInput} placeholder="Your name" value={newEntry.addedBy} onChange={e=>setNewEntry({...newEntry,addedBy:e.target.value})}/>
            </div>
            <input style={{...s.fInput,marginTop:9}} placeholder="Question" value={newEntry.question} onChange={e=>setNewEntry({...newEntry,question:e.target.value})}/>
            <textarea style={{...s.fTextarea,marginTop:9}} placeholder="Answer..." value={newEntry.answer} onChange={e=>setNewEntry({...newEntry,answer:e.target.value})}/>
            <div style={s.formBtns}>
              <button style={s.cancelBtn} onClick={()=>setAddingNew(false)}>Cancel</button>
              <button style={s.addBtn} onClick={addEntry} disabled={saving}>{saving?"Saving...":"Save Entry"}</button>
            </div>
          </div>}
          {filtered.length===0&&!addingNew&&<div style={s.empty}><div style={{fontSize:38,marginBottom:10}}>🧠</div>{searchTerm?"No entries match.":"No entries yet. Click '+ Add Entry' to start!"}</div>}
          {filtered.map(entry=><div key={entry.id} style={s.card}>
            {editId===entry.id?<>
              <div style={s.formTitle}>Editing Entry</div>
              <div style={s.formRow}>
                <input style={s.fInput} value={editEntry.category} onChange={e=>setEditEntry({...editEntry,category:e.target.value})}/>
                <input style={s.fInput} value={editEntry.addedBy} onChange={e=>setEditEntry({...editEntry,addedBy:e.target.value})}/>
              </div>
              <input style={{...s.fInput,marginTop:9}} value={editEntry.question} onChange={e=>setEditEntry({...editEntry,question:e.target.value})}/>
              <textarea style={{...s.fTextarea,marginTop:9}} value={editEntry.answer} onChange={e=>setEditEntry({...editEntry,answer:e.target.value})}/>
              <div style={s.formBtns}>
                <button style={s.cancelBtn} onClick={()=>setEditId(null)}>Cancel</button>
                <button style={s.saveBtn} onClick={()=>saveEdit(entry.id)}>Save Changes</button>
              </div>
            </>:<>
              <div style={s.cardCat}>{entry.category||"General"}</div>
              <div style={s.cardQ}>{entry.question}</div>
              <div style={s.cardA}>{entry.answer}</div>
              <div style={s.cardMeta}>Added by {entry.addedBy||"Anonymous"} · {entry.date}</div>
              <div style={s.cardActions}>
                <button style={s.editBtn} onClick={()=>startEdit(entry)}>Edit</button>
                <button style={s.deleteBtn} onClick={()=>deleteEntry(entry.id)}>Delete</button>
              </div>
            </>}
          </div>)}
        </div>}
      </div>
    </div>
  );
}
