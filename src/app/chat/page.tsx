"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSession, logout, fetchProfiles, LocalUser } from "@/lib/auth";
import { isVaultUnlocked, lockVault, getVaultCode, setVaultCode } from "@/lib/vault";
import { compressImageToBase64, downloadBase64Image } from "@/lib/p2pImage";
import { supabase } from "@/lib/supabase";

type TextMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  senderName?: string;
  content: string;
  created_at: string;
};

type ImageMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  dataUrl: string;
  createdAt: string;
};

const FAMILY_GROUP_ID = "fac5a39f-620e-4df4-a54b-a82c4fd1e523";

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<LocalUser | null>(null);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [selectedId, setSelectedId] = useState<string>(FAMILY_GROUP_ID);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<TextMessage[]>([]);
  const [p2pImages, setP2pImages] = useState<ImageMessage[]>([]);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [privateConvMap, setPrivateConvMap] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);
  const imageChannelRef = useRef<any>(null);

  useEffect(() => {
    if (!isVaultUnlocked()) {
      router.replace("/");
      return;
    }
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setMe(s);
    setNewCode(getVaultCode());
    fetchProfiles().then(setUsers);
  }, [router]);

  // Resolve actual conversation id (family or private)
  const getActualConversationId = async (selected: string): Promise<string> => {
    if (selected === FAMILY_GROUP_ID) return FAMILY_GROUP_ID;
    if (!me) return selected;
    // private: check cache
    if (privateConvMap[selected]) return privateConvMap[selected];
    // try find existing private conversation between me and selected
    const { data: parts } = await supabase.from("conversation_participants").select("conversation_id, conversations!inner(is_group)").eq("user_id", me.id);
    // brute: find conversation where participants are exactly [me.id, selected]
    if (parts) {
      for (const p of parts as any[]) {
        if (p.conversations?.is_group) continue;
        const cid = p.conversation_id;
        const { data: members } = await supabase.from("conversation_participants").select("user_id").eq("conversation_id", cid);
        const ids = (members || []).map((m: any) => m.user_id).sort();
        if (ids.length === 2 && ids.includes(me.id) && ids.includes(selected)) {
          setPrivateConvMap((prev) => ({ ...prev, [selected]: cid }));
          return cid;
        }
      }
    }
    // create new private conversation
    const { data: conv, error } = await supabase.from("conversations").insert({ is_group: false }).select().single();
    if (error || !conv) {
      console.error(error);
      return selected;
    }
    await supabase.from("conversation_participants").insert([{ conversation_id: conv.id, user_id: me.id }, { conversation_id: conv.id, user_id: selected }]);
    setPrivateConvMap((prev) => ({ ...prev, [selected]: conv.id }));
    return conv.id;
  };

  const [actualConvId, setActualConvId] = useState<string>(FAMILY_GROUP_ID);

  useEffect(() => {
    if (!me) return;
    getActualConversationId(selectedId).then(setActualConvId);
    setP2pImages([]);
  }, [selectedId, me]);

  // Fetch messages and subscribe - fix: avoid re-subscribe on users change
  const usersRef = useRef(users);
  useEffect(() => { usersRef.current = users; }, [users]);

  useEffect(() => {
    if (!actualConvId || !me) return;
    let chan: any;
    let imgChan: any;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from("messages").select("*").eq("conversation_id", actualConvId).order("created_at", { ascending: true }).limit(200);
      if (cancelled) return;
      if (data) {
        const enriched = data.map((m: any) => {
          const sender = usersRef.current.find((u) => u.id === m.sender_id);
          return { ...m, senderName: sender?.displayName || m.sender_id.slice(0, 6) };
        });
        setMessages(enriched as any);
      }
      // realtime for messages - create channel, add callbacks BEFORE subscribe
      const channelName = `messages:${actualConvId}:${me.id}`;
      chan = supabase.channel(channelName);
      chan.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${actualConvId}` }, async (payload: any) => {
        const m = payload.new as TextMessage;
        const sender = usersRef.current.find((u) => u.id === m.sender_id);
        setMessages((prev) => (prev.find((x) => x.id === m.id) ? prev : [...prev, { ...m, senderName: sender?.displayName } as any]));
      });
      chan.subscribe();
      channelRef.current = chan;

      // P2P images via broadcast (ephemeral, no DB)
      const imgName = `p2p:${actualConvId}:${me.id}`;
      imgChan = supabase.channel(imgName, { config: { broadcast: { self: false } } });
      imgChan.on("broadcast", { event: "image" }, (payload: any) => {
        const msg = payload.payload as ImageMessage;
        setP2pImages((prev) => [...prev, msg]);
      });
      imgChan.subscribe();
      imageChannelRef.current = imgChan;
    };
    load();
    return () => {
      cancelled = true;
      if (chan) supabase.removeChannel(chan);
      if (imgChan) supabase.removeChannel(imgChan);
    };
  }, [actualConvId, me]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, p2pImages]);

  const handleSend = async () => {
    if (!input.trim() || !me) return;
    const text = input.trim();
    setInput("");
    console.log("sending", { actualConvId, selectedId, meId: me.id, text });
    const { data, error } = await supabase.from("messages").insert({ conversation_id: actualConvId, sender_id: me.id, content: text }).select();
    if (error) {
      console.error("Supabase insert error:", JSON.stringify(error, null, 2), error.message, error.details, error.hint, error.code);
      alert(`فشل الإرسال: ${error.message || error.code || JSON.stringify(error)}`);
      // fallback local so UI still shows
      setMessages((prev) => [...prev, { id: String(Date.now()), conversation_id: actualConvId, sender_id: me.id, senderName: me.displayName, content: text, created_at: new Date().toISOString() } as any]);
      return;
    }
    console.log("sent ok", data);
  };

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !me) return;
    if (file.size > 8 * 1024 * 1024) {
      alert("الصورة كبيرة جدا");
      return;
    }
    const dataUrl = await compressImageToBase64(file);
    const imgMsg: ImageMessage = {
      id: String(Date.now()),
      conversationId: actualConvId,
      senderId: me.id,
      senderName: me.displayName,
      dataUrl,
      createdAt: new Date().toISOString(),
    };
    // show locally immediately
    setP2pImages((prev) => [...prev, imgMsg]);
    // broadcast P2P (no storage)
    imageChannelRef.current?.send({ type: "broadcast", event: "image", payload: imgMsg });
    if (fileRef.current) fileRef.current.value = "";
  };

  const combined = [...messages.map((m) => ({ ...m, type: "text" as const })), ...p2pImages.map((m) => ({ ...m, type: "image" as const, created_at: m.createdAt, conversation_id: m.conversationId, sender_id: m.senderId, content: "" }))].sort(
    (a, b) => new Date((a as any).created_at || (a as any).createdAt).getTime() - new Date((b as any).created_at || (b as any).createdAt).getTime()
  );

  if (!me) return null;

  const selectedUser = users.find((u) => u.id === selectedId);

  return (
    <div className="h-[100dvh] flex bg-white" dir="rtl">
      <div className="w-[320px] border-l border-zinc-200 flex-col bg-zinc-50 hidden md:flex">
        <div className="h-16 flex items-center justify-between px-4 border-b border-zinc-200 bg-white">
          <div className="font-bold text-black">الدردشات</div>
          <div className="text-xs text-zinc-500">{me.displayName}</div>
        </div>
        <div className="flex-1 overflow-auto">
          <button onClick={() => setSelectedId(FAMILY_GROUP_ID)} className={`w-full text-right p-4 flex items-center gap-3 hover:bg-white border-b border-zinc-100 ${selectedId === FAMILY_GROUP_ID ? "bg-white" : ""}`}>
            <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center">👨‍👩‍👧‍👦</div>
            <div>
              <div className="font-semibold text-black text-sm">جروب العائلة</div>
              <div className="text-xs text-zinc-500">كل العائلة - Supabase Realtime</div>
            </div>
          </button>
          {users.filter((u) => u.id !== me.id).map((u) => (
            <button key={u.id} onClick={() => setSelectedId(u.id)} className={`w-full text-right p-4 flex items-center gap-3 hover:bg-white border-b border-zinc-100 ${selectedId === u.id ? "bg-white" : ""}`}>
              <div className="w-10 h-10 rounded-full bg-zinc-800 text-white flex items-center justify-center text-sm">{u.displayName[0]}</div>
              <div>
                <div className="font-semibold text-black text-sm">{u.displayName}</div>
                <div className="text-xs text-zinc-500">@{u.username}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-zinc-200 bg-white space-y-2">
          <button onClick={() => setShowSettings((v) => !v)} className="w-full h-10 rounded-xl border border-zinc-200 text-sm font-medium text-black">الإعدادات</button>
          <button onClick={() => { logout(); lockVault(); router.push("/"); }} className="w-full h-10 rounded-xl bg-black text-white text-sm">قفل والعودة للآلة الحاسبة</button>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="h-16 border-b border-zinc-200 flex items-center justify-between px-4 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-black text-white flex items-center justify-center text-sm">{selectedId === FAMILY_GROUP_ID ? "👨‍👩‍👧‍👦" : selectedUser?.displayName[0]}</div>
            <div>
              <div className="font-semibold text-black text-sm">{selectedId === FAMILY_GROUP_ID ? "جروب العائلة" : selectedUser?.displayName}</div>
              <div className="text-xs text-green-600">{typingUser ? `${typingUser} يكتب...` : "متصل - Supabase"}</div>
            </div>
          </div>
          <div className="flex gap-2 md:hidden">
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="h-9 rounded-xl border border-zinc-200 px-2 text-sm text-black">
              <option value={FAMILY_GROUP_ID}>جروب العائلة</option>
              {users.filter((u) => u.id !== me.id).map((u) => (<option key={u.id} value={u.id}>{u.displayName}</option>))}
            </select>
          </div>
        </div>

        {showSettings && (
          <div className="p-4 bg-amber-50 border-b border-amber-200">
            <div className="text-sm font-semibold text-black mb-2">تغيير الرمز السري</div>
            <div className="flex gap-2">
              <input value={newCode} onChange={(e) => setNewCode(e.target.value.replace(/\D/g, ""))} className="flex-1 h-10 rounded-xl border border-zinc-300 px-3 text-black" placeholder="2025147151" />
              <button onClick={() => { if (newCode.length < 4) return alert("الرمز قصير"); setVaultCode(newCode); alert("تم حفظ الرمز: " + newCode + " ثم =="); }} className="h-10 px-4 rounded-xl bg-black text-white text-sm">حفظ</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto p-4 space-y-3 bg-[#ece5dd]">
          {combined.length === 0 && <div className="text-center text-sm text-zinc-500 mt-10">لا توجد رسائل بعد. جرب الإرسال وستظهر فوراً على كل الأجهزة 👋</div>}
          {combined.map((m: any) => {
            const isMe = m.sender_id === me.id || m.senderId === me.id;
            if (m.type === "image") {
              return (
                <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl overflow-hidden shadow ${isMe ? "bg-[#dcf8c6]" : "bg-white"} p-2`}>
                    <img src={m.dataUrl} alt="p2p" className="rounded-xl max-w-full" />
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => downloadBase64Image(m.dataUrl, `image-${m.id}.webp`)} className="flex-1 h-8 rounded-lg bg-black text-white text-xs">تحميل على الجوال</button>
                      <button onClick={() => setP2pImages((prev) => prev.filter((x) => x.id !== m.id))} className="h-8 px-3 rounded-lg border border-zinc-300 text-xs bg-white text-black">تجاهل</button>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-1 text-left">P2P لحظي - Supabase Broadcast - لا تحفظ</div>
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2 shadow text-sm ${isMe ? "bg-[#dcf8c6] text-black rounded-br-none" : "bg-white text-black rounded-bl-none"}`}>
                  {!isMe && <div className="text-[11px] font-bold text-[#075e54]">{m.senderName || users.find((u) => u.id === m.sender_id)?.displayName}</div>}
                  <div className="leading-6 break-words">{m.content}</div>
                  <div className="text-[10px] text-zinc-500 mt-1 text-left">{new Date(m.created_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t border-zinc-200 bg-white flex items-center gap-2">
          <button onClick={() => fileRef.current?.click()} className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-black hover:bg-zinc-200" title="إرسال صورة P2P">📷</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }} placeholder="اكتب رسالة..." className="flex-1 h-11 rounded-full border border-zinc-200 px-4 text-black outline-none focus:border-black bg-zinc-50" />
          <button onClick={handleSend} className="w-11 h-11 rounded-full bg-[#075e54] text-white flex items-center justify-center">➤</button>
        </div>
        <div className="text-center text-[11px] text-zinc-500 bg-white pb-2">النصوص محفوظة في Supabase • الصور P2P لحظية لا تحفظ</div>
      </div>
    </div>
  );
}
