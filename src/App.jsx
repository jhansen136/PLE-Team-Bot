import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const WELCOME = "Hey! I'm your team's knowledge bot 👋 Ask me anything about projects, meeting notes, or tell me something to update in the KB. You can also attach images, PDFs, Word docs, text files, and more!";

// ─── File helpers ─────────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});
}

function fileToText(file) {
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsText(file);});
}

const SUPPORTED_TYPES = {
  image: ["image/jpeg","image/png","image/gif","image/webp"],
  pdf:   ["application/pdf"],
  docx:  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/msword"],
  text:  ["text/plain","text/csv","text/markdown","text/html","application/json",
          "application/xml","text/xml","text/css","text/javascript","application/javascript"],
};

function getFileCategory(file) {
  if (SUPPORTED_TYPES.image.includes(file.type)) return "image";
  if (SUPPORTED_TYPES.pdf.includes(file.type)) return "pdf";
  if (SUPPORTED_TYPES.docx.includes(file.type)) return "docx";
  if (SUPPORTED_TYPES.text.includes(file.type) || file.name.match(/\.(txt|csv|md|json|xml|yaml|yml|log|ts|tsx|js|jsx|py|sql|css|html)$/i)) return "text";
  return null;
}

function getFileIcon(category) {
  return {image:"🖼️", pdf:"📄", docx:"📝", text:"📋"}[category] || "📎";
}

// Extract text from a .docx by loading mammoth from CDN
async function extractDocxText(file) {
  if (!window.mammoth) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value || "";
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function safeParseJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {}
  const stripped = raw.replace(/^```[\w]*\n?/,"").replace(/\n?```$/,"").trim();
  try { return JSON.parse(stripped); } catch (_) {}
  const match = raw.match(/(\{[\s\S]*\})/);
  if (match) { try { return JSON.parse(match[1]); } catch (_) {} }
  return null;
}
function fuzzyIndexOf(haystack, needle) {
  if (!needle) return -1;
  let idx = haystack.indexOf(needle); if (idx !== -1) return idx;
  idx = haystack.replace(/\s+/g," ").indexOf(needle.replace(/\s+/g," ")); if (idx !== -1) return idx;
  return haystack.toLowerCase().indexOf(needle.toLowerCase());
}
function applySnippetReplace(fullAnswer, oldSnippet, newSnippet) {
  const idx = fuzzyIndexOf(fullAnswer, oldSnippet);
  if (idx === -1) return `${fullAnswer} [Updated: ${newSnippet}]`;
  return fullAnswer.replace(fullAnswer.substr(idx, oldSnippet.length), newSnippet);
}
function groupThreads(threads) {
  const now=new Date(), today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const yesterday=new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const week=new Date(today); week.setDate(week.getDate()-7);
  const groups={Today:[],Yesterday:[],"Past 7 Days":[],"Older":[]};
  threads.forEach(t=>{
    const d=new Date(t.updated_at);
    if(d>=today)groups.Today.push(t);
    else if(d>=yesterday)groups.Yesterday.push(t);
    else if(d>=week)groups["Past 7 Days"].push(t);
    else groups.Older.push(t);
  });
  return groups;
}

// ─── Small UI components ──────────────────────────────────────────────────────
function Spinner() {
  return <div style={{display:"flex",gap:4,alignItems:"center",padding:"8px 0"}}>{[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#6ee7b7",animation:"bounce 1.2s infinite",animationDelay:`${i*0.2}s`}}/>)}</div>;
}

function ConfirmCard({pending, onConfirm, onCancel}) {
  const isEdit = pending.type==="edit";
  return (
    <div style={{marginTop:8,background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"12px 14px",fontSize:13,border:"1px solid rgba(110,231,183,0.3)"}}>
      <div style={{fontWeight:700,color:"#6ee7b7",marginBottom:8,fontSize:11,textTransform:"uppercase",letterSpacing:"0.8px"}}>{isEdit?"✏️ Edit KB Entry":"➕ New KB Entry"}</div>
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

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [user,setUser]=useState(null);
  const [loginUser,setLoginUser]=useState("");
  const [loginPass,setLoginPass]=useState("");
  const [loginErr,setLoginErr]=useState("");
  const [loggingIn,setLoggingIn]=useState(false);
  const [tab,setTab]=useState("chat");
  const [threads,setThreads]=useState([]);
  const [activeThreadId,setActiveThreadId]=useState(null);
  const [messages,setMessages]=useState([{role:"assistant",content:WELCOME}]);
  const [sidebarOpen,setSidebarOpen]=useState(true);
  const [input,setInput]=useState("");
  const [pendingFile,setPendingFile]=useState(null); // {category, name, base64?, text?, mediaType, previewUrl?}
  const [loading,setLoading]=useState(false);
  const [knowledge,setKnowledge]=useState([]);
  const [meetingNotes,setMeetingNotes]=useState([]);
  const [isDragOver,setIsDragOver]=useState(false);
  // KB
  const [newEntry,setNewEntry]=useState({category:"",question:"",answer:"",addedBy:""});
  const [addingNew,setAddingNew]=useState(false);
  const [saving,setSaving]=useState(false);
  const [saveMsg,setSaveMsg]=useState("");
  const [editId,setEditId]=useState(null);
  const [editEntry,setEditEntry]=useState({});
  const [searchTerm,setSearchTerm]=useState("");
  // Notes
  const [noteMode,setNoteMode]=useState("structured");
  const [addingNote,setAddingNote]=useState(false);
  const [noteForm,setNoteForm]=useState({project:"",date:"",attendees:"",key_decisions:"",action_items:"",raw_notes:""});
  const [rawPaste,setRawPaste]=useState("");
  const [processingRaw,setProcessingRaw]=useState(false);
  const [savingNote,setSavingNote]=useState(false);
  const [noteSaveMsg,setNoteSaveMsg]=useState("");
  const [noteSearch,setNoteSearch]=useState("");
  const [expandedNote,setExpandedNote]=useState(null);
  const [editNoteId,setEditNoteId]=useState(null);
  const [editNoteForm,setEditNoteForm]=useState({});
  const [debugLog,setDebugLog]=useState([]);
  const [showDebug,setShowDebug]=useState(false);

  const chatEndRef=useRef(null);
  const fileInputRef=useRef(null);
  const textareaRef=useRef(null);
  const knowledgeRef=useRef(knowledge);
  const meetingNotesRef=useRef(meetingNotes);
  const messagesRef=useRef(messages);
  const activeThreadRef=useRef(activeThreadId);
  useEffect(()=>{knowledgeRef.current=knowledge;},[knowledge]);
  useEffect(()=>{meetingNotesRef.current=meetingNotes;},[meetingNotes]);
  useEffect(()=>{messagesRef.current=messages;},[messages]);
  useEffect(()=>{activeThreadRef.current=activeThreadId;},[activeThreadId]);

  function log(msg){console.log("[TeamBot]",msg);setDebugLog(prev=>[...prev.slice(-19),`${new Date().toLocaleTimeString()} ${msg}`]);}
  function autoResize(){const el=textareaRef.current;if(!el)return;el.style.height="auto";const max=22*18+22;el.style.height=Math.min(el.scrollHeight,max)+"px";el.style.overflowY=el.scrollHeight>max?"auto":"hidden";}
  function resetTextarea(){if(textareaRef.current){textareaRef.current.style.height="44px";textareaRef.current.style.overflowY="hidden";}}

  async function handleLogin(){
    if(!loginUser.trim()||!loginPass.trim()){setLoginErr("Please enter username and password.");return;}
    setLoggingIn(true);setLoginErr("");
    try{const hash=await sha256(loginPass);const {data,error}=await supabase.from("users").select("*").eq("username",loginUser.trim().toLowerCase()).eq("password_hash",hash).single();if(error||!data){setLoginErr("Invalid username or password.");setLoggingIn(false);return;}setUser(data);localStorage.setItem("teambot_user",JSON.stringify(data));}catch(e){setLoginErr("Login failed: "+e.message);}
    setLoggingIn(false);
  }
  function handleLogout(){setUser(null);localStorage.removeItem("teambot_user");setThreads([]);setMessages([{role:"assistant",content:WELCOME}]);setActiveThreadId(null);}
  useEffect(()=>{const saved=localStorage.getItem("teambot_user");if(saved)try{setUser(JSON.parse(saved));}catch(e){};},[]);

  useEffect(()=>{
    (async()=>{try{const {data,error}=await supabase.from("knowledge_base").select("*").order("created_at");if(error)throw error;setKnowledge(data.map(r=>({id:r.id,category:r.category,question:r.question,answer:r.answer,addedBy:r.added_by,date:r.date})));log("KB loaded");}catch(e){log("KB load error: "+e.message);}})();
    (async()=>{try{const {data,error}=await supabase.from("meeting_notes").select("*").order("date",{ascending:false});if(error)throw error;setMeetingNotes(data||[]);log("Notes loaded: "+(data?.length||0));}catch(e){log("Notes load error: "+e.message);}})();
  },[]);
  useEffect(()=>{if(!user)return;(async()=>{try{const {data,error}=await supabase.from("chat_threads").select("*").eq("user_id",user.id).order("updated_at",{ascending:false});if(error)throw error;setThreads(data||[]);}catch(e){log("Threads load error: "+e.message);}})();},[user]);
  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading]);

  // ── File attachment ───────────────────────────────────────────────────────
  async function attachFile(file) {
    const category = getFileCategory(file);
    if (!category) {
      log(`Unsupported file type: ${file.type || file.name}`);
      alert(`Unsupported file type. Supported: images, PDFs, Word docs (.docx), and text files.`);
      return;
    }
    try {
      if (category === "image") {
        const base64 = await fileToBase64(file);
        setPendingFile({ category, name: file.name, base64, mediaType: file.type, previewUrl: URL.createObjectURL(file) });
      } else if (category === "pdf") {
        const base64 = await fileToBase64(file);
        setPendingFile({ category, name: file.name, base64, mediaType: "application/pdf" });
      } else if (category === "docx") {
        const text = await extractDocxText(file);
        setPendingFile({ category, name: file.name, text: text.slice(0, 20000) });
      } else if (category === "text") {
        const text = await fileToText(file);
        setPendingFile({ category, name: file.name, text: text.slice(0, 20000) });
      }
      log(`File attached: ${file.name} (${category})`);
    } catch(e) {
      log("File attach error: "+e.message);
      alert("Could not read file: "+e.message);
    }
  }

  function removePendingFile() {
    if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile(null);
  }

  async function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    await attachFile(f);
    e.target.value = "";
  }

  async function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        await attachFile(item.getAsFile());
        return;
      }
    }
  }

  // Drag and drop
  function handleDragOver(e) { e.preventDefault(); setIsDragOver(true); }
  function handleDragLeave(e) { e.preventDefault(); setIsDragOver(false); }
  async function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) await attachFile(f);
  }

  // ── Claude API ────────────────────────────────────────────────────────────
  async function callClaude(system,userContent,maxTokens=400){
    const res=await fetch(ANTHROPIC_API,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:maxTokens,system,messages:[{role:"user",content:typeof userContent==="string"?userContent:JSON.stringify(userContent)}]})});
    if(!res.ok){const t=await res.text();throw new Error(`HTTP ${res.status}: ${t}`);}
    const data=await res.json();
    return data.content?.map(b=>b.text||"").join("").trim()||"";
  }
  async function generateTitle(msg){try{return await callClaude("Generate a short 4-6 word title for a chat that starts with this message. Reply with only the title, no punctuation.",msg,30);}catch(e){return msg.slice(0,40);}}

  async function classifyKbIntent(recentMessages,kbSummary){
    const transcript=recentMessages.slice(-6).map(m=>`${m.role.toUpperCase()}: ${typeof m.content==="string"?m.content:"[file]"}`).join("\n");
    const answer=await callClaude(`You decide if the user wants to ADD or UPDATE an entry in the team knowledge base.\nKB entries:\n${kbSummary}\nRules:\n- Reply YES only if user EXPLICITLY states a new fact or asks to record/update something in the KB.\n- Reply YES for short affirmations ONLY if the preceding ASSISTANT message proposed a specific KB change.\n- Reply NO for questions, file analysis, general conversation.\n- When in doubt, reply NO.\nReply with exactly one word: YES or NO.`,`Conversation:\n${transcript}`,10);
    return answer.trim().toUpperCase().startsWith("YES");
  }

  async function extractKbUpdate(recentMessages,kb){
    const transcript=recentMessages.slice(-6).map(m=>`${m.role.toUpperCase()}: ${typeof m.content==="string"?m.content:"[file]"}`).join("\n");
    const kbListing=kb.map(e=>`ID: ${e.id}\nCategory: ${e.category||"General"}\nQuestion: ${e.question}\nAnswer: ${e.answer}`).join("\n---\n");
    const raw=await callClaude(`You extract a KB update and return ONLY raw JSON (no markdown, no fences).\nKNOWLEDGE BASE:\n${kbListing}\nFor NEW: {"type":"add","entry":{"category":"...","question":"...","answer":"..."}}\nFor EDIT: {"type":"edit","id":"<exact id>","oldSnippet":"<verbatim from Answer>","newSnippet":"<replacement>"}\nIf nothing confident: {"type":"none"}\noldSnippet MUST be verbatim substring of the Answer shown above.`,`Conversation:\n${transcript}`,400);
    log("Extractor raw: "+raw.slice(0,120));
    const parsed=safeParseJson(raw);
    if(!parsed||parsed.type==="none"||!parsed.type)return null;
    return parsed;
  }

  // ── KB helpers ────────────────────────────────────────────────────────────
  async function persistKnowledge(kb){setKnowledge(kb);knowledgeRef.current=kb;}
  async function saveEntryToSupabase(entry){const {error}=await supabase.from("knowledge_base").upsert({id:entry.id,category:entry.category,question:entry.question,answer:entry.answer,added_by:entry.addedBy,date:entry.date});if(error)throw error;}
  async function deleteEntryFromSupabase(id){const {error}=await supabase.from("knowledge_base").delete().eq("id",id);if(error)throw error;}
  async function saveThread(threadId,msgs,title){
    if(!user||!threadId)return;
    try{await supabase.from("chat_threads").upsert({id:threadId,user_id:user.id,title:title||"New Chat",messages:JSON.stringify(msgs),updated_at:new Date().toISOString()});const {data}=await supabase.from("chat_threads").select("*").eq("user_id",user.id).order("updated_at",{ascending:false});if(data)setThreads(data);}
    catch(e){log("Thread save error: "+e.message);}
  }
  function newChat(){setActiveThreadId(null);activeThreadRef.current=null;setMessages([{role:"assistant",content:WELCOME}]);setInput("");removePendingFile();resetTextarea();}
  function loadThread(thread){setActiveThreadId(thread.id);activeThreadRef.current=thread.id;try{setMessages(JSON.parse(thread.messages)||[{role:"assistant",content:WELCOME}]);}catch(e){setMessages([{role:"assistant",content:WELCOME}]);}setTab("chat");}
  async function deleteThread(e,threadId){
    e.stopPropagation();
    try{await supabase.from("chat_threads").delete().eq("id",threadId);setThreads(prev=>prev.filter(t=>t.id!==threadId));if(activeThreadRef.current===threadId){setActiveThreadId(null);activeThreadRef.current=null;setMessages([{role:"assistant",content:WELCOME}]);}}
    catch(e){log("Thread delete error: "+e.message);}
  }

  function getRelevantNotes(conversationText,allNotes,maxNotes=2){const lower=conversationText.toLowerCase();const pn=allNotes.filter(n=>lower.includes(n.project.toLowerCase()));return pn.length?pn.slice(0,maxNotes):allNotes.slice(0,maxNotes);}
  function buildNotesContext(notes){if(!notes.length)return"";return notes.map(n=>`[Meeting: ${n.project} | ${n.date}]\nAttendees: ${n.attendees||"N/A"}\nKey Decisions: ${n.key_decisions||"N/A"}\nAction Items: ${n.action_items||"N/A"}\nNotes: ${n.raw_notes?.slice(0,300)||"N/A"}`).join("\n\n");}
  function buildKbContext(kb){if(!kb.length)return"No entries yet.";return kb.map(e=>`[id:${e.id}][${e.category||"General"}] Q: ${e.question}\nA: ${e.answer}`).join("\n\n");}
  function getLastPendingCard(msgs){for(let i=msgs.length-1;i>=0;i--){const m=msgs[i];if(m.role==="assistant"&&m.pending)return{msg:m,index:i};if(m.role==="user")break;}return null;}

  // ── Main send ──────────────────────────────────────────────────────────────
  async function sendMessage(){
    if((!input.trim()&&!pendingFile)||loading)return;
    const userText=input.trim()||(pendingFile?`Please analyze this ${pendingFile.category} file: ${pendingFile.name}`:"");

    // Build content blocks for the API
    const contentBlocks=[];
    if(pendingFile){
      if(pendingFile.category==="image"){
        contentBlocks.push({type:"image",source:{type:"base64",media_type:pendingFile.mediaType,data:pendingFile.base64}});
      } else if(pendingFile.category==="pdf"){
        contentBlocks.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:pendingFile.base64}});
      } else if(pendingFile.text){
        // docx and text — inject as text block with filename context
        contentBlocks.push({type:"text",text:`[File: ${pendingFile.name}]\n\n${pendingFile.text}`});
      }
    }
    contentBlocks.push({type:"text",text:userText});

    let threadId=activeThreadRef.current;
    if(!threadId){threadId="thread-"+Date.now();setActiveThreadId(threadId);activeThreadRef.current=threadId;}
    const displayMsg={role:"user",content:userText,fileAttached:pendingFile?{name:pendingFile.name,category:pendingFile.category,previewUrl:pendingFile.previewUrl}:null};
    const updatedDisplay=[...messagesRef.current,displayMsg];
    setMessages(updatedDisplay);setInput("");removePendingFile();setLoading(true);resetTextarea();
    const isFirstMsg=messagesRef.current.length<=1;
    let title=threads.find(t=>t.id===threadId)?.title||"New Chat";
    if(isFirstMsg)title=await generateTitle(userText);
    try{
      // Fast-path confirm/cancel
      const lastPending=getLastPendingCard(updatedDisplay);
      const lower=userText.trim().toLowerCase();
      if(lastPending&&/^(yes|yeah|yep|sure|ok|okay|do it|confirm|go ahead|correct|right|yup|affirmative)[\s!.]*$/.test(lower)){log("Fast-path: confirm");await confirmKbUpdate(lastPending.index,lastPending.msg.pending);const t=threads.find(t=>t.id===activeThreadRef.current);await saveThread(threadId,messagesRef.current,t?.title||title);setLoading(false);return;}
      if(lastPending&&/^(no|nope|cancel|stop|don't|nevermind|never mind|abort)[\s!.]*$/.test(lower)){log("Fast-path: cancel");cancelKbUpdate(lastPending.index);setLoading(false);return;}

      // If a file is attached, skip KB classifier and go straight to chat
      if(pendingFile===null && displayMsg.fileAttached===null){
        // KB update path — only when no file attached
        const kbSummary=knowledgeRef.current.map(e=>`[${e.id}] [${e.category||"General"}] Q: ${e.question} | A: ${e.answer.slice(0,80)}`).join("\n");
        const isKb=await classifyKbIntent(updatedDisplay,kbSummary);log("KB intent: "+isKb);
        if(isKb){
          const extracted=await extractKbUpdate(updatedDisplay,knowledgeRef.current);
          if(extracted?.type==="edit"){
            const existing=knowledgeRef.current.find(e=>e.id===extracted.id);
            if(existing){const newAnswer=applySnippetReplace(existing.answer,extracted.oldSnippet,extracted.newSnippet);const pp={type:"edit",id:extracted.id,oldAnswer:extracted.oldSnippet||existing.answer,newSnippet:extracted.newSnippet,entry:{...existing,answer:newAnswer}};const botMsg={role:"assistant",content:"I'd like to make the following change to the Knowledge Base — please confirm:",pending:pp};const newMsgs=[...updatedDisplay,botMsg];setMessages(newMsgs);await saveThread(threadId,newMsgs,title);setLoading(false);return;}
          }
          if(extracted?.type==="add"){const pp={type:"add",entry:{category:extracted.entry.category||"General",question:extracted.entry.question,answer:extracted.entry.answer}};const botMsg={role:"assistant",content:"I'd like to add the following to the Knowledge Base — please confirm:",pending:pp};const newMsgs=[...updatedDisplay,botMsg];setMessages(newMsgs);await saveThread(threadId,newMsgs,title);setLoading(false);return;}
          log("KB extraction failed — normal chat");
        }
      }

      // Normal chat (includes file analysis)
      const convText=updatedDisplay.map(m=>typeof m.content==="string"?m.content:"").join(" ");
      const notesContext=buildNotesContext(getRelevantNotes(convText,meetingNotesRef.current));
      const chatHistory=updatedDisplay.slice(-8).map(m=>({role:m.role,content:typeof m.content==="string"?m.content:"[file attached]"}));
      chatHistory[chatHistory.length-1]={role:"user",content:contentBlocks};
      const res=await fetch(ANTHROPIC_API,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1500,system:`You are a helpful team knowledge assistant. Answer using the KB and meeting notes below. Be concise and friendly. When a file is provided, analyze it and answer the user's question about it. Never mention JSON or internal mechanics.\n\nKNOWLEDGE BASE:\n${buildKbContext(knowledgeRef.current)}${notesContext?`\n\nRECENT MEETING NOTES:\n${notesContext}`:""}`,messages:chatHistory})});
      const data=await res.json();const reply=data.content?.map(b=>b.text||"").join("")||"Sorry, no response.";
      const newMsgs=[...updatedDisplay,{role:"assistant",content:reply}];setMessages(newMsgs);await saveThread(threadId,newMsgs,title);
    }catch(e){log("Error: "+e.message);setMessages(prev=>[...prev,{role:"assistant",content:`⚠️ Error: ${e.message}`}]);}
    setLoading(false);
  }

  async function confirmKbUpdate(msgIndex,pending){
    const today=new Date().toISOString().slice(0,10);const kb=knowledgeRef.current;let updatedKb;
    try{
      if(pending.type==="add"){const entry={id:Date.now().toString(),category:pending.entry.category||"General",question:pending.entry.question,answer:pending.entry.answer,addedBy:"Chat",date:today};await saveEntryToSupabase(entry);updatedKb=[...kb,entry];}
      else if(pending.type==="edit"){const updated={...pending.entry,date:today};await saveEntryToSupabase(updated);updatedKb=kb.map(e=>e.id===pending.id?updated:e);}
      await persistKnowledge(updatedKb);
      const newMsgs=messagesRef.current.map((m,i)=>i===msgIndex?{...m,pending:null,confirmed:true}:m);
      newMsgs.push({role:"assistant",content:"✅ Done! KB updated. Switch to the Knowledge Base tab to verify."});
      setMessages(newMsgs);const t=threads.find(t=>t.id===activeThreadRef.current);await saveThread(activeThreadRef.current,newMsgs,t?.title||"New Chat");
    }catch(e){log("Save error: "+e.message);setMessages(prev=>[...prev,{role:"assistant",content:"⚠️ Failed to save: "+e.message}]);}
  }
  function cancelKbUpdate(msgIndex){
    const newMsgs=messagesRef.current.map((m,i)=>i===msgIndex?{...m,pending:null}:m);
    newMsgs.push({role:"assistant",content:"No problem, no changes made."});
    setMessages(newMsgs);const t=threads.find(t=>t.id===activeThreadRef.current);saveThread(activeThreadRef.current,newMsgs,t?.title||"New Chat");
  }

  async function processRawNotes(){
    if(!rawPaste.trim())return;
    setProcessingRaw(true);
    try{
      const today=new Date().toISOString().slice(0,10);
      const result=await callClaude(
        `Extract structured info from these meeting notes. Output ONLY a raw JSON object, no markdown, no backticks, no explanation.
Required fields:
- project: name of the project or team discussed (string, use "Unknown Project" if not found)
- date: meeting date as YYYY-MM-DD (use ${today} if not found)
- attendees: comma-separated list of names (string)
- key_decisions: bullet points of key decisions made (string, use "• " prefix per line)
- action_items: bullet points of action items with owner names if mentioned (string, use "• " prefix per line)
Do NOT include a raw_notes field. Output only the JSON object starting with {`,
        rawPaste.slice(0,6000), 1200
      );
      const parsed=safeParseJson(result);
      if(parsed){setNoteForm({project:parsed.project||"",date:parsed.date||today,attendees:parsed.attendees||"",key_decisions:parsed.key_decisions||"",action_items:parsed.action_items||"",raw_notes:rawPaste});setNoteMode("structured");log("Raw notes OK");}
      else{log("Raw notes parse failed: "+result.slice(0,200));setNoteSaveMsg("Could not extract — try again or enter manually.");setTimeout(()=>setNoteSaveMsg(""),4000);}
    }catch(e){log("Raw notes error: "+e.message);setNoteSaveMsg("Error: "+e.message);setTimeout(()=>setNoteSaveMsg(""),4000);}
    setProcessingRaw(false);
  }
  async function saveNote(){
    if(!noteForm.project?.trim()||!noteForm.date?.trim())return;setSavingNote(true);
    try{const note={id:"note-"+Date.now(),project:noteForm.project.trim(),date:noteForm.date,attendees:noteForm.attendees||"",key_decisions:noteForm.key_decisions||"",action_items:noteForm.action_items||"",raw_notes:noteForm.raw_notes||rawPaste||"",created_by:user?.username||"Unknown"};const {error}=await supabase.from("meeting_notes").insert(note);if(error)throw error;setMeetingNotes(prev=>[note,...prev]);setNoteForm({project:"",date:"",attendees:"",key_decisions:"",action_items:"",raw_notes:""});setRawPaste("");setAddingNote(false);setNoteSaveMsg("Meeting notes saved!");setTimeout(()=>setNoteSaveMsg(""),2500);}
    catch(e){log("Save note error: "+e.message);}setSavingNote(false);
  }
  async function deleteNote(id){try{await supabase.from("meeting_notes").delete().eq("id",id);setMeetingNotes(prev=>prev.filter(n=>n.id!==id));}catch(e){}}
  async function saveEditNote(id){try{const {error}=await supabase.from("meeting_notes").update(editNoteForm).eq("id",id);if(error)throw error;setMeetingNotes(prev=>prev.map(n=>n.id===id?{...n,...editNoteForm}:n));setEditNoteId(null);setNoteSaveMsg("Notes updated!");setTimeout(()=>setNoteSaveMsg(""),2500);}catch(e){}}
  async function addEntry(){if(!newEntry.question.trim()||!newEntry.answer.trim())return;setSaving(true);const entry={id:Date.now().toString(),category:newEntry.category||"General",question:newEntry.question.trim(),answer:newEntry.answer.trim(),addedBy:newEntry.addedBy||"Anonymous",date:new Date().toISOString().slice(0,10)};try{await saveEntryToSupabase(entry);await persistKnowledge([...knowledge,entry]);setNewEntry({category:"",question:"",answer:"",addedBy:""});setAddingNew(false);setSaveMsg("Entry added!");setTimeout(()=>setSaveMsg(""),2500);}catch(e){}setSaving(false);}
  async function deleteEntry(id){try{await deleteEntryFromSupabase(id);await persistKnowledge(knowledge.filter(e=>e.id!==id));}catch(e){}}
  async function saveEdit(id){try{const entry=knowledge.find(e=>e.id===id);const updated={...entry,...editEntry};await saveEntryToSupabase(updated);await persistKnowledge(knowledge.map(e=>e.id===id?updated:e));setEditId(null);setSaveMsg("Entry updated!");setTimeout(()=>setSaveMsg(""),2500);}catch(e){}}
  function startEdit(e){setEditId(e.id);setEditEntry({...e});}

  const filtered=knowledge.filter(e=>!searchTerm||[e.question,e.answer,e.category||""].some(v=>v.toLowerCase().includes(searchTerm.toLowerCase())));
  const filteredNotes=meetingNotes.filter(n=>!noteSearch||[n.project,n.key_decisions||"",n.action_items||"",n.attendees||""].some(v=>v.toLowerCase().includes(noteSearch.toLowerCase())));
  function md(t){return t.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/\n/g,'<br/>');}

  // ── Styles ────────────────────────────────────────────────────────────────
  const s={
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
    sidebar:{width:sidebarOpen?260:0,minWidth:sidebarOpen?260:0,background:"#0d1f2d",borderRight:"1px solid rgba(255,255,255,0.07)",display:"flex",flexDirection:"column",overflow:"hidden",transition:"all 0.2s",height:"100vh",flexShrink:0},
    sidebarInner:{width:260,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"},
    sidebarTop:{padding:"16px 12px 10px",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0},
    newChatBtn:{width:"100%",background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",border:"none",borderRadius:9,padding:"9px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:13,color:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center",gap:6},
    sidebarThreads:{flex:1,overflowY:"auto",padding:"8px 6px",minHeight:0},
    threadGroupLabel:{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"#374151",padding:"6px 8px 4px"},
    threadItem:(active)=>({display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",borderRadius:8,cursor:"pointer",background:active?"rgba(110,231,183,0.08)":"transparent",border:active?"1px solid rgba(110,231,183,0.15)":"1px solid transparent",marginBottom:2,gap:6}),
    threadTitle:{fontSize:13,color:"#cbd5e1",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
    threadDel:{background:"none",border:"none",cursor:"pointer",color:"#374151",fontSize:14,padding:"2px 4px",borderRadius:4,flexShrink:0},
    sidebarBottom:{padding:"10px 12px",borderTop:"1px solid rgba(255,255,255,0.06)",flexShrink:0},
    userName:{fontSize:13,color:"#6ee7b7",fontWeight:600},
    logoutBtn:{background:"transparent",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,color:"#6b7280",fontFamily:"inherit"},
    mainCol:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",height:"100vh"},
    header:{background:"linear-gradient(135deg,#0d1f2d 0%,#111827 100%)",borderBottom:"1px solid rgba(110,231,183,0.12)",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexShrink:0,flexWrap:"wrap"},
    logoWrap:{display:"flex",alignItems:"center",gap:9},
    logoIcon:{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,color:"#0d1117",fontWeight:"bold"},
    logoText:{fontSize:16,fontWeight:700,color:"#f0fdf4"},
    tabs:{display:"flex",gap:3,background:"rgba(255,255,255,0.05)",borderRadius:10,padding:3},
    tab:(a)=>({padding:"6px 11px",borderRadius:7,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,transition:"all 0.2s",background:a?"linear-gradient(135deg,#6ee7b7,#3b82f6)":"transparent",color:a?"#0d1117":"#94a3b8",whiteSpace:"nowrap"}),
    badge:{background:"#6ee7b7",color:"#0d1117",borderRadius:20,padding:"1px 6px",fontSize:11,fontWeight:700,marginLeft:4},
    main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0},
    chatArea:{flex:1,overflowY:"auto",padding:"20px 24px",display:"flex",flexDirection:"column",gap:14,maxWidth:740,width:"100%",margin:"0 auto",boxSizing:"border-box"},
    bubble:(r)=>({maxWidth:"78%",alignSelf:r==="user"?"flex-end":"flex-start",background:r==="user"?"linear-gradient(135deg,#2563eb,#1d4ed8)":"rgba(255,255,255,0.05)",border:r==="user"?"none":"1px solid rgba(255,255,255,0.08)",borderRadius:r==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"11px 15px",fontSize:14,lineHeight:1.6,color:r==="user"?"#fff":"#e2e8f0"}),
    fileChip:{display:"flex",alignItems:"center",gap:7,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"5px 10px",marginBottom:6,fontSize:12,color:"#cbd5e1"},
    inputWrap:{padding:"12px 24px 18px",borderTop:"1px solid rgba(255,255,255,0.07)",maxWidth:740,width:"100%",margin:"0 auto",boxSizing:"border-box",flexShrink:0},
    dropZone:(active)=>({border:`2px dashed ${active?"#6ee7b7":"rgba(255,255,255,0.1)"}`,borderRadius:10,padding:"10px 14px",marginBottom:8,background:active?"rgba(110,231,183,0.06)":"transparent",transition:"all 0.15s",display:"flex",alignItems:"center",gap:10,fontSize:12,color:active?"#6ee7b7":"#4b5563"}),
    previewWrap:{display:"flex",alignItems:"center",gap:9,marginBottom:8,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(110,231,183,0.2)",borderRadius:9,padding:"7px 10px"},
    previewImg:{width:52,height:52,objectFit:"cover",borderRadius:6},
    previewLabel:{flex:1,fontSize:12,color:"#6ee7b7"},
    removeBtn:{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:6,padding:"3px 9px",cursor:"pointer",fontSize:12,color:"#fca5a5",fontFamily:"inherit"},
    inputRow:{display:"flex",gap:9,alignItems:"flex-end"},
    chatInput:{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:11,padding:"11px 15px",color:"#e2e8f0",fontFamily:"inherit",fontSize:14,outline:"none",resize:"none",lineHeight:"22px",minHeight:"44px",overflowY:"hidden"},
    uploadBtn:{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:11,padding:"11px 14px",cursor:"pointer",fontSize:17,display:"flex",alignItems:"center",justifyContent:"center",color:"#94a3b8",flexShrink:0},
    sendBtn:{background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",border:"none",borderRadius:11,padding:"11px 18px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:14,color:"#0d1117",whiteSpace:"nowrap",flexShrink:0},
    hint:{fontSize:11,color:"#374151",marginTop:6,textAlign:"center"},
    debugBox:{background:"#0a0a0a",borderBottom:"1px solid #1f2937",padding:"8px 24px",fontSize:11,color:"#4b5563",fontFamily:"monospace",maxHeight:100,overflowY:"auto",flexShrink:0},
    panelWrap:{flex:1,overflowY:"auto",padding:"20px 24px",maxWidth:900,width:"100%",margin:"0 auto",boxSizing:"border-box"},
    panelTop:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,gap:10,flexWrap:"wrap"},
    panelTitle:{fontSize:19,fontWeight:700,color:"#f0fdf4"},
    searchInput:{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:9,padding:"8px 13px",color:"#e2e8f0",fontFamily:"inherit",fontSize:13,outline:"none",width:180},
    addBtn:{background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",border:"none",borderRadius:9,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:13,color:"#0d1117",whiteSpace:"nowrap"},
    card:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:13,padding:"15px 18px",marginBottom:10},
    cardCat:{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1.2,color:"#6ee7b7",marginBottom:5},
    cardQ:{fontSize:14,fontWeight:600,color:"#f0fdf4",marginBottom:5},
    cardA:{fontSize:13,color:"#94a3b8",lineHeight:1.6},
    cardMeta:{fontSize:11,color:"#4b5563",marginTop:9},
    cardActions:{display:"flex",gap:7,marginTop:10,flexWrap:"wrap"},
    editBtn:{background:"rgba(59,130,246,0.12)",border:"1px solid rgba(59,130,246,0.25)",borderRadius:7,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:"#93c5fd"},
    deleteBtn:{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:7,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:"#fca5a5"},
    saveBtn:{background:"rgba(110,231,183,0.12)",border:"1px solid rgba(110,231,183,0.25)",borderRadius:7,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:"#6ee7b7"},
    expandBtn:{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:7,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",fontSize:12,color:"#94a3b8"},
    formCard:{background:"rgba(110,231,183,0.04)",border:"1px solid rgba(110,231,183,0.18)",borderRadius:13,padding:"18px",marginBottom:14},
    formTitle:{fontSize:13,fontWeight:700,color:"#6ee7b7",marginBottom:12},
    formRow:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9},
    fInput:{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"8px 11px",color:"#e2e8f0",fontFamily:"inherit",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"},
    fTextarea:{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"8px 11px",color:"#e2e8f0",fontFamily:"inherit",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box",resize:"vertical",minHeight:90},
    formBtns:{display:"flex",gap:7,marginTop:11,justifyContent:"flex-end"},
    cancelBtn:{background:"transparent",border:"1px solid rgba(255,255,255,0.09)",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:13,color:"#94a3b8"},
    successMsg:{background:"rgba(110,231,183,0.08)",border:"1px solid rgba(110,231,183,0.2)",borderRadius:8,padding:"7px 13px",fontSize:13,color:"#6ee7b7",marginBottom:11},
    errMsg:{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:8,padding:"7px 13px",fontSize:13,color:"#fca5a5",marginBottom:11},
    empty:{textAlign:"center",color:"#4b5563",padding:"50px 20px",fontSize:14},
    modeToggle:{display:"flex",gap:3,background:"rgba(255,255,255,0.05)",borderRadius:9,padding:3,marginBottom:14},
    modeBtn:(a)=>({flex:1,padding:"7px",borderRadius:7,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,background:a?"rgba(110,231,183,0.15)":"transparent",color:a?"#6ee7b7":"#6b7280"}),
    noteField:{marginBottom:10},
    noteFieldLabel:{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.8,color:"#4b5563",marginBottom:3},
    noteFieldVal:{fontSize:13,color:"#94a3b8",lineHeight:1.6,whiteSpace:"pre-wrap"},
    processBtn:{background:"linear-gradient(135deg,#6ee7b7,#3b82f6)",border:"none",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:13,color:"#0d1117"},
  };

  const iconBtn={background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:8,padding:"7px 11px",cursor:"pointer",fontSize:12,color:"#6b7280",fontFamily:"inherit"};
  const groupedThreads=groupThreads(threads);

  if(!user) return (
    <div style={s.loginWrap}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:rgba(110,231,183,0.18);border-radius:3px}input:focus{border-color:rgba(110,231,183,0.35)!important}`}</style>
      <div style={s.loginCard}>
        <div style={s.loginLogo}><div style={s.loginIcon}>⚡</div><div><div style={s.loginTitle}>TeamBot</div><div style={s.loginSub}>Sign in to continue</div></div></div>
        <label style={s.loginLabel}>Username</label>
        <input style={s.loginInput} placeholder="username" value={loginUser} onChange={e=>setLoginUser(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")handleLogin();}} autoFocus/>
        <label style={s.loginLabel}>Password</label>
        <input style={s.loginInput} type="password" placeholder="••••••••" value={loginPass} onChange={e=>setLoginPass(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")handleLogin();}}/>
        <button style={s.loginBtn} onClick={handleLogin} disabled={loggingIn}>{loggingIn?"Signing in...":"Sign In"}</button>
        {loginErr&&<div style={s.loginErr}>{loginErr}</div>}
      </div>
    </div>
  );

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:"#0d1117",color:"#e2e8f0",display:"flex",height:"100vh",overflow:"hidden"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');@keyframes bounce{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:rgba(110,231,183,0.18);border-radius:3px}input:focus,textarea:focus{border-color:rgba(110,231,183,0.35)!important}`}</style>

      {/* Sidebar */}
      <div style={s.sidebar}>
        <div style={s.sidebarInner}>
          <div style={s.sidebarTop}><button style={s.newChatBtn} onClick={newChat}>✏️ New Chat</button></div>
          <div style={s.sidebarThreads}>
            {Object.entries(groupedThreads).map(([group,items])=>items.length===0?null:(
              <div key={group}>
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
          <div style={s.sidebarBottom}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><span style={s.userName}>👤 {user.username}</span><button style={s.logoutBtn} onClick={handleLogout}>Sign out</button></div></div>
        </div>
      </div>

      {/* Main */}
      <div style={s.mainCol}>
        <header style={s.header}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:7,padding:"6px 9px",cursor:"pointer",fontSize:14,color:"#6b7280"}} onClick={()=>setSidebarOpen(v=>!v)}>☰</button>
            <div style={s.logoWrap}><div style={s.logoIcon}>⚡</div><div style={s.logoText}>TeamBot</div></div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <div style={s.tabs}>
              <button style={s.tab(tab==="chat")} onClick={()=>setTab("chat")}>💬 Chat</button>
              <button style={s.tab(tab==="kb")} onClick={()=>setTab("kb")}>📚 KB<span style={s.badge}>{knowledge.length}</span></button>
              <button style={s.tab(tab==="notes")} onClick={()=>setTab("notes")}>📋 Notes<span style={s.badge}>{meetingNotes.length}</span></button>
            </div>
            {tab==="chat"&&<button onClick={()=>setShowDebug(v=>!v)} style={iconBtn}>🔍</button>}
          </div>
        </header>

        <div style={s.main}>

          {/* Chat */}
          {tab==="chat"&&<>
            {showDebug&&<div style={s.debugBox}>{[...debugLog].reverse().map((l,i)=><div key={i}>{l}</div>)}</div>}
            <div
              style={{...s.chatArea, outline:"none"}}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {isDragOver&&<div style={{position:"sticky",top:0,zIndex:10,background:"rgba(110,231,183,0.08)",border:"2px dashed #6ee7b7",borderRadius:12,padding:"20px",textAlign:"center",fontSize:14,color:"#6ee7b7",marginBottom:8}}>📎 Drop file to attach</div>}
              {messages.map((m,i)=>(
                <div key={i} style={{...s.bubble(m.role),display:"flex",flexDirection:"column",gap:4}}>
                  {m.fileAttached&&(
                    <div style={s.fileChip}>
                      <span>{getFileIcon(m.fileAttached.category)}</span>
                      {m.fileAttached.previewUrl
                        ? <img src={m.fileAttached.previewUrl} alt="preview" style={{width:40,height:40,objectFit:"cover",borderRadius:5}}/>
                        : null}
                      <span style={{fontSize:11,opacity:0.8}}>{m.fileAttached.name}</span>
                    </div>
                  )}
                  <span dangerouslySetInnerHTML={{__html:md(m.content)}}/>
                  {m.pending&&<ConfirmCard pending={m.pending} onConfirm={()=>confirmKbUpdate(i,m.pending)} onCancel={()=>cancelKbUpdate(i)}/>}
                </div>
              ))}
              {loading&&<div style={s.bubble("assistant")}><Spinner/></div>}
              <div ref={chatEndRef}/>
            </div>
            <div style={s.inputWrap}>
              {pendingFile&&(
                <div style={s.previewWrap}>
                  {pendingFile.previewUrl
                    ? <img src={pendingFile.previewUrl} alt="preview" style={s.previewImg}/>
                    : <span style={{fontSize:24}}>{getFileIcon(pendingFile.category)}</span>}
                  <span style={s.previewLabel}>{pendingFile.name}</span>
                  <button style={s.removeBtn} onClick={removePendingFile}>✕</button>
                </div>
              )}
              <div style={s.inputRow}>
                <input ref={fileInputRef} type="file"
                  accept="image/*,.pdf,.doc,.docx,.txt,.csv,.md,.json,.xml,.yaml,.yml,.log,.ts,.tsx,.js,.jsx,.py,.sql,.html,.css"
                  style={{display:"none"}} onChange={handleFileChange}/>
                <button style={s.uploadBtn} onClick={()=>fileInputRef.current?.click()} title="Attach file">📎</button>
                <textarea ref={textareaRef} style={s.chatInput}
                  placeholder="Ask anything, or drop a file to analyze…"
                  value={input}
                  onChange={e=>{setInput(e.target.value);autoResize();}}
                  onPaste={handlePaste}
                  onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}}/>
                <button style={{...s.sendBtn,opacity:loading?0.6:1}} onClick={sendMessage} disabled={loading}>Send →</button>
              </div>
              <div style={s.hint}>Shift+Enter for new line · 📎 images, PDFs, Word docs, text files · drag & drop supported</div>
            </div>
          </>}

          {/* KB */}
          {tab==="kb"&&<div style={s.panelWrap}>
            <div style={s.panelTop}>
              <div style={s.panelTitle}>Knowledge Base</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input style={s.searchInput} placeholder="Search..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/>
                <button style={s.addBtn} onClick={()=>{setAddingNew(true);setEditId(null);}}>+ Add Entry</button>
              </div>
            </div>
            {saveMsg&&<div style={s.successMsg}>✓ {saveMsg}</div>}
            {addingNew&&<div style={s.formCard}>
              <div style={s.formTitle}>New Knowledge Entry</div>
              <div style={s.formRow}><input style={s.fInput} placeholder="Category" value={newEntry.category} onChange={e=>setNewEntry({...newEntry,category:e.target.value})}/><input style={s.fInput} placeholder="Your name" value={newEntry.addedBy} onChange={e=>setNewEntry({...newEntry,addedBy:e.target.value})}/></div>
              <input style={{...s.fInput,marginTop:9}} placeholder="Question" value={newEntry.question} onChange={e=>setNewEntry({...newEntry,question:e.target.value})}/>
              <textarea style={{...s.fTextarea,marginTop:9}} placeholder="Answer..." value={newEntry.answer} onChange={e=>setNewEntry({...newEntry,answer:e.target.value})}/>
              <div style={s.formBtns}><button style={s.cancelBtn} onClick={()=>setAddingNew(false)}>Cancel</button><button style={s.addBtn} onClick={addEntry} disabled={saving}>{saving?"Saving...":"Save Entry"}</button></div>
            </div>}
            {filtered.length===0&&!addingNew&&<div style={s.empty}><div style={{fontSize:38,marginBottom:10}}>🧠</div>{searchTerm?"No entries match.":"No entries yet."}</div>}
            {filtered.map(entry=><div key={entry.id} style={s.card}>
              {editId===entry.id?<>
                <div style={s.formTitle}>Editing Entry</div>
                <div style={s.formRow}><input style={s.fInput} value={editEntry.category} onChange={e=>setEditEntry({...editEntry,category:e.target.value})}/><input style={s.fInput} value={editEntry.addedBy} onChange={e=>setEditEntry({...editEntry,addedBy:e.target.value})}/></div>
                <input style={{...s.fInput,marginTop:9}} value={editEntry.question} onChange={e=>setEditEntry({...editEntry,question:e.target.value})}/>
                <textarea style={{...s.fTextarea,marginTop:9}} value={editEntry.answer} onChange={e=>setEditEntry({...editEntry,answer:e.target.value})}/>
                <div style={s.formBtns}><button style={s.cancelBtn} onClick={()=>setEditId(null)}>Cancel</button><button style={s.saveBtn} onClick={()=>saveEdit(entry.id)}>Save Changes</button></div>
              </>:<>
                <div style={s.cardCat}>{entry.category||"General"}</div>
                <div style={s.cardQ}>{entry.question}</div>
                <div style={s.cardA}>{entry.answer}</div>
                <div style={s.cardMeta}>Added by {entry.addedBy||"Anonymous"} · {entry.date}</div>
                <div style={s.cardActions}><button style={s.editBtn} onClick={()=>startEdit(entry)}>Edit</button><button style={s.deleteBtn} onClick={()=>deleteEntry(entry.id)}>Delete</button></div>
              </>}
            </div>)}
          </div>}

          {/* Notes */}
          {tab==="notes"&&<div style={s.panelWrap}>
            <div style={s.panelTop}>
              <div style={s.panelTitle}>📋 Meeting Notes</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input style={s.searchInput} placeholder="Search notes..." value={noteSearch} onChange={e=>setNoteSearch(e.target.value)}/>
                <button style={s.addBtn} onClick={()=>{setAddingNote(true);setNoteMode("structured");setNoteForm({project:"",date:new Date().toISOString().slice(0,10),attendees:"",key_decisions:"",action_items:"",raw_notes:""});setRawPaste("");}}>+ Add Notes</button>
              </div>
            </div>
            {noteSaveMsg&&<div style={s.successMsg}>✓ {noteSaveMsg}</div>}
            {addingNote&&<div style={s.formCard}>
              <div style={s.modeToggle}><button style={s.modeBtn(noteMode==="raw")} onClick={()=>setNoteMode("raw")}>📋 Paste Raw Notes</button><button style={s.modeBtn(noteMode==="structured")} onClick={()=>setNoteMode("structured")}>✏️ Enter Structured</button></div>
              {noteMode==="raw"&&<><label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:6}}>Paste raw notes — AI extracts structure automatically</label><textarea style={{...s.fTextarea,minHeight:160}} placeholder="Paste meeting notes here..." value={rawPaste} onChange={e=>setRawPaste(e.target.value)}/><div style={{display:"flex",gap:8,marginTop:10,justifyContent:"flex-end"}}><button style={s.cancelBtn} onClick={()=>setAddingNote(false)}>Cancel</button><button style={s.processBtn} onClick={processRawNotes} disabled={processingRaw||!rawPaste.trim()}>{processingRaw?"Processing...":"Extract & Review →"}</button></div></>}
              {noteMode==="structured"&&<>
                <div style={s.formRow}><div><label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:4}}>Project *</label><input style={s.fInput} placeholder="e.g. NADA API for RV" value={noteForm.project} onChange={e=>setNoteForm({...noteForm,project:e.target.value})}/></div><div><label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:4}}>Date *</label><input style={s.fInput} type="date" value={noteForm.date} onChange={e=>setNoteForm({...noteForm,date:e.target.value})}/></div></div>
                <label style={{fontSize:12,color:"#6b7280",display:"block",margin:"10px 0 4px"}}>Attendees</label><input style={s.fInput} placeholder="e.g. Jordan, Brad, Mario" value={noteForm.attendees} onChange={e=>setNoteForm({...noteForm,attendees:e.target.value})}/>
                <label style={{fontSize:12,color:"#6b7280",display:"block",margin:"10px 0 4px"}}>Key Decisions</label><textarea style={s.fTextarea} placeholder="• Decision 1" value={noteForm.key_decisions} onChange={e=>setNoteForm({...noteForm,key_decisions:e.target.value})}/>
                <label style={{fontSize:12,color:"#6b7280",display:"block",margin:"10px 0 4px"}}>Action Items</label><textarea style={s.fTextarea} placeholder="• Action item (Owner)" value={noteForm.action_items} onChange={e=>setNoteForm({...noteForm,action_items:e.target.value})}/>
                <label style={{fontSize:12,color:"#6b7280",display:"block",margin:"10px 0 4px"}}>Full Notes</label><textarea style={{...s.fTextarea,minHeight:120}} value={noteForm.raw_notes} onChange={e=>setNoteForm({...noteForm,raw_notes:e.target.value})}/>
                <div style={s.formBtns}><button style={s.cancelBtn} onClick={()=>setAddingNote(false)}>Cancel</button><button style={s.addBtn} onClick={saveNote} disabled={savingNote||!noteForm.project?.trim()}>{savingNote?"Saving...":"Save Notes"}</button></div>
              </>}
            </div>}
            {filteredNotes.length===0&&!addingNote&&<div style={s.empty}><div style={{fontSize:38,marginBottom:10}}>📋</div>{noteSearch?"No notes match.":"No meeting notes yet."}</div>}
            {filteredNotes.map(note=><div key={note.id} style={s.card}>
              {editNoteId===note.id?<>
                <div style={s.formTitle}>Editing Note</div>
                <div style={s.formRow}><div><label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:4}}>Project</label><input style={s.fInput} value={editNoteForm.project||""} onChange={e=>setEditNoteForm({...editNoteForm,project:e.target.value})}/></div><div><label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:4}}>Date</label><input style={s.fInput} type="date" value={editNoteForm.date||""} onChange={e=>setEditNoteForm({...editNoteForm,date:e.target.value})}/></div></div>
                <label style={{fontSize:12,color:"#6b7280",display:"block",margin:"10px 0 4px"}}>Attendees</label><input style={s.fInput} value={editNoteForm.attendees||""} onChange={e=>setEditNoteForm({...editNoteForm,attendees:e.target.value})}/>
                <label style={{fontSize:12,color:"#6b7280",display:"block",margin:"10px 0 4px"}}>Key Decisions</label><textarea style={s.fTextarea} value={editNoteForm.key_decisions||""} onChange={e=>setEditNoteForm({...editNoteForm,key_decisions:e.target.value})}/>
                <label style={{fontSize:12,color:"#6b7280",display:"block",margin:"10px 0 4px"}}>Action Items</label><textarea style={s.fTextarea} value={editNoteForm.action_items||""} onChange={e=>setEditNoteForm({...editNoteForm,action_items:e.target.value})}/>
                <label style={{fontSize:12,color:"#6b7280",display:"block",margin:"10px 0 4px"}}>Full Notes</label><textarea style={{...s.fTextarea,minHeight:120}} value={editNoteForm.raw_notes||""} onChange={e=>setEditNoteForm({...editNoteForm,raw_notes:e.target.value})}/>
                <div style={s.formBtns}><button style={s.cancelBtn} onClick={()=>setEditNoteId(null)}>Cancel</button><button style={s.saveBtn} onClick={()=>saveEditNote(note.id)}>Save Changes</button></div>
              </>:<>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:8}}>
                  <div><div style={{fontSize:15,fontWeight:700,color:"#f0fdf4"}}>{note.project}</div><div style={{fontSize:12,color:"#4b5563",marginTop:2}}>{note.date}{note.attendees?` · ${note.attendees}`:""}</div></div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    <button style={s.expandBtn} onClick={()=>setExpandedNote(expandedNote===note.id?null:note.id)}>{expandedNote===note.id?"▲ Less":"▼ More"}</button>
                    <button style={s.editBtn} onClick={()=>{setEditNoteId(note.id);setEditNoteForm({...note});}}>Edit</button>
                    <button style={s.deleteBtn} onClick={()=>deleteNote(note.id)}>Delete</button>
                  </div>
                </div>
                {note.key_decisions&&<div style={s.noteField}><div style={s.noteFieldLabel}>Key Decisions</div><div style={s.noteFieldVal}>{note.key_decisions}</div></div>}
                {note.action_items&&<div style={s.noteField}><div style={s.noteFieldLabel}>Action Items</div><div style={s.noteFieldVal}>{note.action_items}</div></div>}
                {expandedNote===note.id&&note.raw_notes&&<div style={s.noteField}><div style={s.noteFieldLabel}>Full Notes</div><div style={s.noteFieldVal}>{note.raw_notes}</div></div>}
              </>}
            </div>)}
          </div>}

        </div>
      </div>
    </div>
  );
}
