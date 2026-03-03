import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const WELCOME = "Hey! I'm your team's knowledge bot 👋 Ask me anything, or tell me something to update — like *\"Update the ECD to May 28\"* — and I'll confirm before saving.";

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

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

function groupThreads(threads) {
  const now = new Date();
  const today = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const week = new Date(today); week.setDate(week.getDate()-7);
  const groups = {Today:[],Yesterday:[],"Past 7 Days":[],"Older":[]};
  threads.forEach(t=>{
    const d = new Date(t.updated_at);
    if(d>=today) groups.Today.push(t);
    else if(d>=yesterday) groups.Yesterday.push(t);
    else if(d>=week) groups["Past 7 Days"].push(t);
    else groups.Older.push(t);
  });
  return groups;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [tab, setTab] = useState("chat");
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [messages, setMessages] = useState([{role:"assistant",content:WELCOME}]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
  const textareaRef = useRef(null);
  const knowledgeRef = useRef(knowledge);
  const messagesRef = useRef(messages);
  const activeThreadRef = useRef(activeThreadId);
  useEffect(()=>{knowledgeRef.current=knowledge;},[knowledge]);
  useEffect(()=>{messagesRef.current=messages;},[messages]);
  useEffect(()=>{activeThreadRef.current=activeThreadId;},[activeThreadId]);

  function log(msg){console.log("[TeamBot]",msg);setDebugLog(prev=>[...prev.slice(-19),`${new Date().toLocaleTimeString()} ${msg}`]);}

  function autoResize(){
    const el=textareaRef.current; if(!el)return;
    el.style.height="auto";
    const max=22*18+22;
    el.style.height=Math.min(el.scrollHeight,max)+"px";
    el.style.overflowY=el.scrollHeight>max?"auto":"hidden";
  }
  function resetTextarea(){if(textareaRef.current){textareaRef.current.style.height="44px";textareaRef.current.style.overflowY="hidden";}}

  async function handleLogin() {
    if(!loginUser.trim()||!loginPass.trim()){setLoginErr("Please enter username and password.");return;}
    setLoggingIn(true);setLoginErr("");
    try {
      const hash=await sha256(loginPass);
      const {data,error}=await supabase.from("users").select("*").eq("username",loginUser.trim().toLowerCase()).eq("password_hash",hash).single();
      if(error||!data){setLoginErr("Invalid username or password.");setLoggingIn(false);return;}
      setUser(data);
      localStorage.setItem("teambot_user",JSON.stringify(data));
    }catch(e){setLoginErr("Login failed: "+e.message);}
    setLoggingIn(false);
  }

  function handleLogout(){
    setUser(null);localStorage.removeItem("teambot_user");
    setThreads([]);setMessages([{role:"assistant",content:WELCOME}]);setActiveThreadId(null);
  }

  useEffect(()=>{
    const saved=localStorage.getItem("teambot_user");
    if(saved)try{setUser(JSON.parse(saved));}catch(e){}
  },[]);

  useEffect(()=>{
    (async()=>{
      try {
        const {data,error}=await supabase.from("knowledge_base").select("*").order("created_at");
        if(error)throw error;
        const mapped=data.map(r=>({id:r.id,category:r.category,question:r.question,answer:r.answer,addedBy:r.added_by,date:r.date}));
        setKnowledge(mapped);log("KB loaded: "+mapped.length+" entries");
      }catch(e){log("KB load error: "+e.message);}
    })();
  },[]);

  useEffect(()=>{
    if(!user)return;
    (async()=>{
      try {
        const {data,error}=await supabase.from("chat_threads").select("*").eq("user_id",user.id).order("updated_at",{ascending:false});
        if(error)throw error;
        setThreads(data||[]);log("Threads loaded: "+(data?.length||0));
      }catch(e){log("Threads load error: "+e.message);}
    })();
  },[user]);

  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading]);

  async function persistKnowledge(kb){setKnowledge(kb);knowledgeRef.current=kb;}

  async function saveEntryToSupabase(entry){
    const {error}=await supabase.from("knowledge_base").upsert({id:entry.id,category:entry.category,question:entry.question,answer:entry.answer,added_by:entry.addedBy,date:entry.date});
    if(error)throw error;
  }
  async function deleteEntryFromSupabase(id){
    const {error}=await supabase.from("knowledge_base").delete().eq("id",id);
    if(error)throw error;
  }

  async function saveThread(threadId,msgs,title){
    if(!user||!threadId)return;
    try {
      await supabase.from("chat_threads").upsert({id:threadId,user_id:user.id,title:title||"New Chat",messages:JSON.stringify(msgs),updated_at:new Date().toISOString()});
      const {data}=await supabase.from("chat_threads").select("*").eq("user_id",user.id).order("updated_at",{ascending:false});
      if(data)setThreads(data);
    }catch(e){log("Thread save error: "+e.message);}
  }

  function newChat(){
    setActiveThreadId(null);
    activeThreadRef.current=null;
    setMessages([{role:"assistant",content:WELCOME}]);
    setInput("");resetTextarea();
  }

  function loadThread(thread){
    setActiveThreadId(thread.id);
    activeThreadRef.current=thread.id;
    try{setMessages(JSON.parse(thread.messages)||[{role:"assistant",content:WELCOME}]);}
    catch(e){setMessages([{role:"assistant",content:WELCOME}]);}
    setTab("chat");
  }

  async function deleteThread(e,threadId){
    e.stopPropagation();
    try {
      await supabase.from("chat_threads").delete().eq("id",threadId);
      setThreads(prev=>prev.filter(t=>t.id!==threadId));
      if(activeThreadRef.current===threadId){
        setActiveThreadId(null);activeThreadRef.current=null;
        setMessages([{role:"assistant",content:WELCOME}]);
      }
    }catch(e){log("Thread delete error: "+e.message);}
  }

  function buildContext(kb){
    if(!kb.length)return"No entries yet.";
    return kb.map(e=>`[id:${e.id}][${e.category||"General"}] Q: ${e.question}\nA: ${e.answer}`).join("\n\n");
  }

  async function handlePaste(e){
    const items=e.clipboardData?.items;if(!items)return;
    for(const item of items){if(item.type.startsWith("image/")){e.preventDefault();await attachImage(item.getAsFile());return;}}
  }
  async function handleFileChange(e){const f=e.target.files?.[0];if(!f)return;await attachImage(f);e.target.value="";}
  async function attachImage(file){try{const b=await fileToBase64(file);setPendingImage({base64:b,mediaType:file.type,previewUrl:URL.createObjectURL(file)});}catch(e){}}
  function removePendingImage(){if(pendingImage?.previewUrl)URL.revokeObjectURL(pendingImage.previewUrl);setPendingImage(null);}

  async function callClaude(system,userContent,maxTokens=400){
    const res=await fetch(ANTHROPIC_API,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:maxTokens,system,messages:[{role:"user",content:typeof userContent==="string"?userContent:JSON.stringify(userContent)}]})});
    if(!res.ok){const t=await res.text();throw new Error(`HTTP ${res.status}: ${t}`);}
    const data=await res.json();
    return data.content?.map(b=>b.text||"").join("").trim()||"";
  }

  async function generateTitle(firstUserMsg){
    try{return await callClaude("Generate a short 4-6 word title for a chat that starts with this message. Reply with only the title, no punctuation.",firstUserMsg,30);}
    catch(e){return firstUserMsg.slice(0,40);}
  }

  async function sendMessage(){
    if((!input.trim()&&!pendingImage)||loading)return;
    const userText=input.trim()||"What can you tell me about this image?";
    const contentBlocks=[];
    if(pendingImage)contentBlocks.push({type:"image",source:{type:"base64",media_type:pendingImage.mediaType,data:pendingImage.base64}});
    contentBlocks.push({type:"text",text:userText});

    let threadId=activeThreadRef.current;
    if(!threadId){threadId="thread-"+Date.now();setActiveThreadId(threadId);activeThreadRef.current=threadId;}

    const displayMsg={role:"user",content:userText,imagePreview:pendingImage?.previewUrl??null};
    const updatedDisplay=[...messagesRef.current,displayMsg];
    setMessages(updatedDisplay);
    setInput("");removePendingImage();setLoading(true);resetTextarea();

    const isFirstMsg=messagesRef.current.length<=1;
    let title=threads.find(t=>t.id===threadId)?.title||"New Chat";
    if(isFirstMsg)title=await generateTitle(userText);

    try {
      const recentContext=updatedDisplay.slice(-4).map(m=>`${m.role}: ${m.content}`).join("\n");
      log("Classifying: "+userText.slice(0,60));
      const classifyAnswer=await callClaude(
        `You decide if the conversation is heading toward ADDING or UPDATING information in a team knowledge base.
Reply only "YES" if the user clearly wants to record, update, add, or change a fact/date/value — including short confirmations like "yes" or "sure" that follow a bot proposing a KB change.
Reply only "NO" for questions, greetings, or general conversation with no pending KB change.`,
        recentContext,10
      );
      log("Classifier result: "+classifyAnswer);
      const isKbUpdate=classifyAnswer.toUpperCase().includes("YES");

      if(isKbUpdate){
        log("Extracting KB update...");
        const kbSummary=knowledgeRef.current.map(e=>`id:${e.id} | [${e.category||"General"}] Q: ${e.question} | A: ${e.answer.slice(0,80)}...`).join("\n");
        const recentConv=updatedDisplay.slice(-4).map(m=>`${m.role}: ${m.content}`).join("\n");
        const bestMatch=knowledgeRef.current.find(e=>recentConv.toLowerCase().includes(e.question.toLowerCase().slice(0,20))||recentConv.toLowerCase().includes((e.category||"").toLowerCase()))||knowledgeRef.current[0];

        const extractAnswer=await callClaude(
          `Extract a KB update from the conversation and output ONLY a raw JSON object — no markdown, no backticks, no explanation, just JSON starting with {.

KB entries (id | category | question | answer preview):
${kbSummary}

Most relevant existing entry (FULL raw answer text):
ID: ${bestMatch?.id}
Answer: ${bestMatch?.answer}

Recent conversation:
${recentConv}

Output format:
For NEW: {"type":"add","entry":{"category":"...","question":"...","answer":"..."}}
For EDIT: {"type":"edit","id":"<exact id>","oldSnippet":"<copy exact chars from answer above>","newSnippet":"<replacement>"}
CRITICAL: oldSnippet must be CHARACTER FOR CHARACTER from the answer above.`,
          userText,200
        );
        log("Extractor raw: "+extractAnswer.slice(0,120));
        const cleanJson=extractAnswer.replace(/^```[\w]*\n?/,"").replace(/\n?```$/,"").trim();
        let parsed=null;
        try{parsed=JSON.parse(cleanJson);}catch(e){log("JSON parse failed: "+e.message);}

        if(parsed?.type==="edit"){
          const existing=knowledgeRef.current.find(e=>e.id===parsed.id);
          if(existing){
            const found=parsed.oldSnippet&&existing.answer.includes(parsed.oldSnippet);
            if(!found)log("WARNING: oldSnippet not found: "+parsed.oldSnippet?.slice(0,60));
            const updated=found?existing.answer.replace(parsed.oldSnippet,parsed.newSnippet):existing.answer;
            parsed={type:"edit",id:parsed.id,oldAnswer:parsed.oldSnippet,newSnippet:parsed.newSnippet,entry:{...existing,answer:updated}};
            log(found?"Snippet replace ready":"Snippet not found");
          }
        }

        if(parsed&&(parsed.type==="add"||parsed.type==="edit")){
          log("Showing confirm card");
          const botMsg={role:"assistant",content:"I'd like to make the following change to the Knowledge Base — please confirm:",pending:parsed};
          const newMsgs=[...updatedDisplay,botMsg];
          setMessages(newMsgs);
          await saveThread(threadId,newMsgs,title);
          setLoading(false);return;
        }else{log("Extraction failed, falling through to chat");}
      }

      log("Normal chat response");
      const chatHistory=updatedDisplay.map(m=>({role:m.role,content:m.content}));
      chatHistory[chatHistory.length-1]={role:"user",content:contentBlocks};
      const res=await fetch(ANTHROPIC_API,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:`You are a helpful team knowledge assistant. Answer questions using the knowledge base below. Be concise and friendly. Never mention JSON, KB mechanics, or your own update process.\n\nKNOWLEDGE BASE:\n${buildContext(knowledgeRef.current)}`,messages:chatHistory})});
      const data=await res.json();
      const reply=data.content?.map(b=>b.text||"").join("")||"Sorry, couldn't get a response.";
      const newMsgs=[...updatedDisplay,{role:"assistant",content:reply}];
      setMessages(newMsgs);
      await saveThread(threadId,newMsgs,title);
    }catch(e){
      log("Error: "+e.message);
      setMessages(prev=>[...prev,{role:"assistant",content:`⚠️ Error: ${e.message}`}]);
    }
    setLoading(false);
  }

  async function confirmKbUpdate(msgIndex,pending){
    log("Confirming KB update type="+pending.type);
    const today=new Date().toISOString().slice(0,10);
    const kb=knowledgeRef.current;let updatedKb;
    try {
      if(pending.type==="add"){
        const entry={id:Date.now().toString(),category:pending.entry.category||"General",question:pending.entry.question,answer:pending.entry.answer,addedBy:"Chat",date:today};
        await saveEntryToSupabase(entry);updatedKb=[...kb,entry];
      }else if(pending.type==="edit"){
        const updated={...pending.entry,date:today};
        await saveEntryToSupabase(updated);updatedKb=kb.map(e=>e.id===pending.id?updated:e);
      }
      await persistKnowledge(updatedKb);
      const newMsgs=messagesRef.current.map((m,i)=>i===msgIndex?{...m,pending:null,confirmed:true}:m);
      newMsgs.push({role:"assistant",content:`✅ Done! KB has been ${pending.type==="add"?"updated with a new entry":"updated"}. Switch to the Knowledge Base tab to verify.`});
      setMessages(newMsgs);
      const t=threads.find(t=>t.id===activeThreadRef.current);
      await saveThread(activeThreadRef.current,newMsgs,t?.title||"New Chat");
      log("KB saved to Supabase");
    }catch(e){
      log("Supabase save error: "+e.message);
      setMessages(prev=>[...prev,{role:"assistant",content:"⚠️ Failed to save: "+e.message}]);
    }
  }

  function cancelKbUpdate(msgIndex){
    const newMsgs=messagesRef.current.map((m,i)=>i===msgIndex?{...m,pending:null}:m);
    newMsgs.push({role:"assistant",content:"No problem, no changes made."});
    setMessages(newMsgs);
    const t=threads.find(t=>t.id===activeThreadRef.current);
    saveThread(activeThreadRef.current,newMsgs,t?.title||"New Chat");
  }

  async function addEntry(){
    if(!newEntry.question.trim()||!newEntry.answer.trim())return;setSaving(true);
    const entry={id:Date.now().toString(),category:newEntry.category||"General",question:newEntry.question.trim(),answer:newEntry.answer.trim(),addedBy:newEntry.addedBy||"Anonymous",date:new Date().toISOString().slice(0,10)};
    try{await saveEntryToSupabase(entry);await persistKnowledge([...knowledge,entry]);setNewEntry({category:"",question:"",answer:"",addedBy:""});setAddingNew(false);setSaveMsg("Entry added!");setTimeout(()=>setSaveMsg(""),2500);}catch(e){log("Add error: "+e.message);}
    setSaving(false);
  }
  async function deleteEntry(id){try{await deleteEntryFromSupabase(id);await persistKnowledge(knowledge.filter(e=>e.id!==id));}catch(e){log("Delete error: "+e.message);}}
  async function saveEdit(id){
    try{const entry=knowledge.find(e=>e.id===id);const updated={...entry,...editEntry};await saveEntryToSupabase(updated);await persistKnowledge(knowledge.map(e=>e.id===id?updated:e));setEditId(null);setSaveMsg("Entry updated!");setTimeout(()=>setSaveMsg(""),2500);}catch(e){log("Edit error: "+e.message);}
  }
  function startEdit(e){setEditId(e.id);setEditEntry({...e});}
  const filtered=knowledge.filter(e=>!searchTerm||[e.question,e.answer,e.category||""].some(v=>v.toLowerCase().includes(searchTerm.toLowerCase())));
  function md(t){return t.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/\n/g,'<br/>');}

  const s={
    root:{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:"#0d1117",minHeight:"100vh",display:"flex",flexDirection:"column",color:"#e2e8f0"},
    loginWrap:{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#0d1117"},
    loginCard:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"40px 36px",width:340},
    loginLogo:{display:"flex",alignItems:"center",gap:10,marginBottom:28},
    loginIcon:{width:40,height:40,borderRadius:10,background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,color:"#0d1117",fontWeight:"bold"},
    loginTitle:{fontSize:20,fontWeight:700,color:"#f0fdf4"},
    loginSub:{fontSize:12,color:"#4b5563",marginTop:2},
    loginLabel:{fontSize:12,color:"#6b7280",marginBottom:5,display:"block"},
    loginInput:{width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:9,padding:"10px 13px",color:"#e2e8f0",fontFamily:"inherit",fontSize:14,outline:"none",boxSizing:"border-box",marginBottom:14},
    loginBtn:{width:"100%",background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",border:"none",borderRadius:9,padding:"11px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:14,color:"#0d1117"},
    loginErr:{fontSize:12,color:"#fca5a5",marginTop:10,textAlign:"center"},
    appWrap:{display:"flex",flex:1,overflow:"hidden",height:"100vh"},
    sidebar:{width:sidebarOpen?260:0,minWidth:sidebarOpen?260:0,background:"#0d1f2d",borderRight:"1px solid rgba(255,255,255,0.07)",display:"flex",flexDirection:"column",overflow:"hidden",transition:"all 0.2s",height:"100vh",position:"sticky",top:0,flexShrink:0},
    sidebarInner:{width:260,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"},
    sidebarTop:{padding:"16px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0},
    newChatBtn:{width:"100%",background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",border:"none",borderRadius:9,padding:"9px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:13,color:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center",gap:6},
    sidebarThreads:{flex:1,overflowY:"auto",padding:"8px 6px",minHeight:0},
    threadGroup:{marginBottom:8},
    threadGroupLabel:{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"#374151",padding:"6px 8px 4px"},
    threadItem:(active)=>({display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",borderRadius:8,cursor:"pointer",background:active?"rgba(110,231,183,0.08)":"transparent",border:active?"1px solid rgba(110,231,183,0.15)":"1px solid transparent",marginBottom:2,gap:6}),
    threadTitle:{fontSize:13,color:"#cbd5e1",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
    threadDel:{background:"none",border:"none",cursor:"pointer",color:"#374151",fontSize:14,padding:"2px 4px",borderRadius:4,flexShrink:0},
    sidebarBottom:{padding:"10px 12px",borderTop:"1px solid rgba(255,255,255,0.06)",flexShrink:0},
    userRow:{display:"flex",alignItems:"center",justifyContent:"space-between"},
    userName:{fontSize:13,color:"#6ee7b7",fontWeight:600},
    logoutBtn:{background:"transparent",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"},
    mainCol:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",height:"100vh"},
    header:{background:"linear-gradient(135deg,#0d1f2d 0%,#111827 100%)",borderBottom:"1px solid rgba(110,231,183,0.12)",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexShrink:0},
    headerLeft:{display:"flex",alignItems:"center",gap:10},
    sidebarToggle:{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:7,padding:"6px 9px",cursor:"pointer",fontSize:14,color:"#6b7280"},
    logoWrap:{display:"flex",alignItems:"center",gap:9},
    logoIcon:{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,color:"#0d1117",fontWeight:"bold"},
    logoText:{fontSize:16,fontWeight:700,color:"#f0fdf4"},
    tabs:{display:"flex",gap:3,background:"rgba(255,255,255,0.05)",borderRadius:10,padding:3},
    tab:(a)=>({padding:"6px 14px",borderRadius:7,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,transition:"all 0.2s",background:a?"linear-gradient(135deg,#6ee7b7,#3b82f6)":"transparent",color:a?"#0d1117":"#94a3b8"}),
    badge:{background:"#6ee7b7",color:"#0d1117",borderRadius:20,padding:"1px 6px",fontSize:11,fontWeight:700,marginLeft:4},
    main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0},
    chatArea:{flex:1,overflowY:"auto",padding:"20px 24px",display:"flex",flexDirection:"column",gap:14,maxWidth:740,width:"100%",margin:"0 auto",boxSizing:"border-box"},
    bubble:(r)=>({maxWidth:"78%",alignSelf:r==="user"?"flex-end":"flex-start",background:r==="user"?"linear-gradient(135deg,#2563eb,#1d4ed8)":"rgba(255,255,255,0.05)",border:r==="user"?"none":"1px solid rgba(255,255,255,0.08)",borderRadius:r==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"11px 15px",fontSize:14,lineHeight:1.6,color:r==="user"?"#fff":"#e2e8f0"}),
    inputWrap:{padding:"12px 24px 18px",borderTop:"1px solid rgba(255,255,255,0.07)",maxWidth:740,width:"100%",margin:"0 auto",boxSizing:"border-box",flexShrink:0},
    previewWrap:{display:"flex",alignItems:"center",gap:9,marginBottom:8,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(110,231,183,0.2)",borderRadius:9,padding:"7px 10px"},
    previewImg:{width:52,height:52,objectFit:"cover",borderRadius:6},
    previewLabel:{flex:1,fontSize:12,color:"#6ee7b7"},
    removeBtn:{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:6,padding:"3px 9px",cursor:"pointer",fontSize:12,color:"#fca5a5",fontFamily:"inherit"},
    inputRow:{display:"flex",gap:9,alignItems:"flex-end"},
    chatInput:{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:11,padding:"11px 15px",color:"#e2e8f0",fontFamily:"inherit",fontSize:14,outline:"none",resize:"none",lineHeight:"22px",minHeight:"44px",overflowY:"hidden"},
    uploadBtn:{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:11,padding:"11px 14px",cursor:"pointer",fontSize:17,display:"flex",alignItems:"center",justifyContent:"center",color:"#94a3b8",flexShrink:0},
    sendBtn:{background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",border:"none",borderRadius:11,padding:"11px 18px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:14,color:"#0d1117",whiteSpace:"nowrap",flexShrink:0},
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

  const iconBtn={background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:8,padding:"7px 11px",cursor:"pointer",fontSize:12,color:"#6b7280",fontFamily:"inherit"};

  if(!user) return (
    <div style={s.loginWrap}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap'); ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:rgba(110,231,183,0.18);border-radius:3px} input:focus{border-color:rgba(110,231,183,0.35)!important}`}</style>
      <div style={s.loginCard}>
        <div style={s.loginLogo}>
          <div style={s.loginIcon}>⚡</div>
          <div><div style={s.loginTitle}>TeamBot</div><div style={s.loginSub}>Sign in to continue</div></div>
        </div>
        <label style={s.loginLabel}>Username</label>
        <input style={s.loginInput} placeholder="username" value={loginUser} onChange={e=>setLoginUser(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")handleLogin();}} autoFocus/>
        <label style={s.loginLabel}>Password</label>
        <input style={s.loginInput} type="password" placeholder="••••••••" value={loginPass} onChange={e=>setLoginPass(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")handleLogin();}}/>
        <button style={s.loginBtn} onClick={handleLogin} disabled={loggingIn}>{loggingIn?"Signing in...":"Sign In"}</button>
        {loginErr&&<div style={s.loginErr}>{loginErr}</div>}
      </div>
    </div>
  );

  const groupedThreads=groupThreads(threads);

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:"#0d1117",color:"#e2e8f0",display:"flex",height:"100vh",overflow:"hidden"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap'); @keyframes bounce{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}} ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:rgba(110,231,183,0.18);border-radius:3px} input:focus,textarea:focus{border-color:rgba(110,231,183,0.35)!important}`}</style>

      {/* Sidebar */}
      <div style={s.sidebar}>
        <div style={s.sidebarInner}>
          <div style={s.sidebarTop}>
            <button style={s.newChatBtn} onClick={newChat}>✏️ New Chat</button>
          </div>
          <div style={s.sidebarThreads}>
            {Object.entries(groupedThreads).map(([group,items])=>items.length===0?null:(
              <div key={group} style={s.threadGroup}>
                <div style={s.threadGroupLabel}>{group}</div>
                {items.map(t=>(
                  <div key={t.id} style={s.threadItem(t.id===activeThreadId)} onClick={()=>loadThread(t)}>
                    <span style={s.threadTitle}>{t.title}</span>
                    <button style={s.threadDel} onClick={e=>deleteThread(e,t.id)}>🗑</button>
                  </div>
                ))}
              </div>
            ))}
            {threads.length===0&&<div style={{fontSize:12,color:"#374151",padding:"12px 8px"}}>No past chats yet.</div>}
          </div>
          <div style={s.sidebarBottom}>
            <div style={s.userRow}>
              <span style={s.userName}>👤 {user.username}</span>
              <button style={s.logoutBtn} onClick={handleLogout}>Sign out</button>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={s.mainCol}>
        <header style={s.header}>
          <div style={s.headerLeft}>
            <button style={s.sidebarToggle} onClick={()=>setSidebarOpen(v=>!v)}>☰</button>
            <div style={s.logoWrap}>
              <div style={s.logoIcon}>⚡</div>
              <div style={s.logoText}>TeamBot</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={s.tabs}>
              <button style={s.tab(tab==="chat")} onClick={()=>setTab("chat")}>💬 Chat</button>
              <button style={s.tab(tab==="kb")} onClick={()=>setTab("kb")}>📚 Knowledge Base<span style={s.badge}>{knowledge.length}</span></button>
            </div>
            {tab==="chat"&&<button onClick={()=>setShowDebug(v=>!v)} style={iconBtn}>🔍</button>}
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
                <textarea ref={textareaRef} style={s.chatInput} placeholder="Ask something, or say what to update…" value={input} onChange={e=>{setInput(e.target.value);autoResize();}} onPaste={handlePaste} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}}/>
                <button style={{...s.sendBtn,opacity:loading?0.6:1}} onClick={sendMessage} disabled={loading}>Send →</button>
              </div>
              <div style={s.hint}>Shift+Enter for new line · 📎 upload or paste image</div>
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
    </div>
  );
}
