"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
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
  status?: "sending" | "sent" | "failed";
};

type ImageMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  dataUrl: string;
  createdAt: string;
};

type ImageChunk = {
  transferId: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  createdAt: string;
  index: number;
  total: number;
  data: string;
};

type PendingImageTransfer = {
  message: Omit<ImageMessage, "dataUrl">;
  chunks: string[];
  received: number;
  timeout: ReturnType<typeof setTimeout>;
};

type ConversationPart = { conversation_id: string; conversations?: { is_group: boolean } | null };
type ConversationMember = { user_id: string };
type RenderMessage =
  | (TextMessage & { type: "text" })
  | (ImageMessage & { type: "image"; created_at: string; conversation_id: string; sender_id: string; content: string });

const FAMILY_GROUP_ID = "fac5a39f-620e-4df4-a54b-a82c4fd1e523";
const IMAGE_CHUNK_SIZE = 32_000;

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<LocalUser | null>(null);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [selectedId, setSelectedId] = useState<string>(FAMILY_GROUP_ID);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<TextMessage[]>([]);
  const [p2pImages, setP2pImages] = useState<ImageMessage[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserPasswordConfirm, setNewUserPasswordConfirm] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [privateConvMap, setPrivateConvMap] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const imageChannelRef = useRef<RealtimeChannel | null>(null);
  const imageChannelReadyRef = useRef<Promise<void> | null>(null);
  const pendingImageTransfersRef = useRef(new Map<string, PendingImageTransfer>());
  const [sendingImage, setSendingImage] = useState(false);
  const [imageProgress, setImageProgress] = useState(0);
  const [sendingText, setSendingText] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "offline">("connecting");
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      if (!isVaultUnlocked()) {
        router.replace("/");
        return;
      }
      const sessionUser = await getSession();
      if (cancelled) return;
      if (!sessionUser) {
        router.replace("/login");
        return;
      }
      setMe(sessionUser);
      setNewCode(getVaultCode());
      const profiles = await fetchProfiles();
      if (!cancelled) setUsers(profiles);
    };
    initialize();
    return () => { cancelled = true; };
  }, [router]);

  // Resolve actual conversation id (family or private)
  const getActualConversationId = useCallback(async (selected: string): Promise<string> => {
    if (!me) return selected;
    if (selected === FAMILY_GROUP_ID) {
      const { data: family } = await supabase.from("conversations").select("id").eq("id", FAMILY_GROUP_ID).maybeSingle();
      if (!family) {
        const { error } = await supabase.from("conversations").insert({ id: FAMILY_GROUP_ID, is_group: true, group_name: "جروب العائلة" });
        if (error && error.code !== "23505") console.error("Family conversation setup error:", error);
      }
      const { data: familyMembership } = await supabase
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", FAMILY_GROUP_ID)
        .eq("user_id", me.id)
        .maybeSingle();
      if (!familyMembership) {
        const { error: membershipError } = await supabase
          .from("conversation_participants")
          .insert({ conversation_id: FAMILY_GROUP_ID, user_id: me.id });
        if (membershipError && membershipError.code !== "23505") console.error("Family membership error:", membershipError);
      }
      return FAMILY_GROUP_ID;
    }
    // private: check cache
    if (privateConvMap[selected]) return privateConvMap[selected];
    const directKey = [me.id, selected].sort().join(":");
    const { data: directConversation } = await supabase.from("conversations").select("id").eq("direct_key", directKey).maybeSingle();
    if (directConversation?.id) {
      setPrivateConvMap((prev) => ({ ...prev, [selected]: directConversation.id }));
      return directConversation.id;
    }
    // try find existing private conversation between me and selected
    const { data: parts } = await supabase.from("conversation_participants").select("conversation_id, conversations!inner(is_group)").eq("user_id", me.id);
    // brute: find conversation where participants are exactly [me.id, selected]
    if (parts) {
      for (const p of (parts as unknown as ConversationPart[])) {
        if (p.conversations?.is_group) continue;
        const cid = p.conversation_id;
        const { data: members } = await supabase.from("conversation_participants").select("user_id").eq("conversation_id", cid);
        const ids = ((members || []) as unknown as ConversationMember[]).map((m) => m.user_id).sort();
        if (ids.length === 2 && ids.includes(me.id) && ids.includes(selected)) {
          setPrivateConvMap((prev) => ({ ...prev, [selected]: cid }));
          return cid;
        }
      }
    }
    // create new private conversation
    const { data: conv, error } = await supabase.from("conversations").insert({ is_group: false, direct_key: directKey }).select().single();
    if (error || !conv) {
      if (error?.code === "23505") {
        const { data: concurrentConversation } = await supabase.from("conversations").select("id").eq("direct_key", directKey).maybeSingle();
        if (concurrentConversation?.id) return concurrentConversation.id;
      }
      console.error(error);
      return selected;
    }
    const { error: ownerMembershipError } = await supabase
      .from("conversation_participants")
      .insert({ conversation_id: conv.id, user_id: me.id });
    if (ownerMembershipError && ownerMembershipError.code !== "23505") {
      console.error("Conversation owner membership error:", ownerMembershipError);
      return selected;
    }
    const { error: selectedMembershipError } = await supabase
      .from("conversation_participants")
      .insert({ conversation_id: conv.id, user_id: selected });
    if (selectedMembershipError && selectedMembershipError.code !== "23505") {
      console.error("Conversation participant membership error:", selectedMembershipError);
    }
    setPrivateConvMap((prev) => ({ ...prev, [selected]: conv.id }));
    return conv.id;
  }, [me, privateConvMap]);

  const [actualConvId, setActualConvId] = useState<string>(FAMILY_GROUP_ID);

  useEffect(() => {
    if (!me) return;
    let active = true;
    const resolveConversation = async () => {
      setP2pImages([]);
      const conversationId = await getActualConversationId(selectedId);
      if (active) setActualConvId(conversationId);
    };
    void resolveConversation();
    return () => { active = false; };
  }, [selectedId, me, getActualConversationId]);

  // Fetch messages and subscribe - fix: avoid re-subscribe on users change
  const usersRef = useRef(users);
  useEffect(() => { usersRef.current = users; }, [users]);

  useEffect(() => {
    if (!actualConvId || !me) return;
    const pendingImageTransfers = pendingImageTransfersRef.current;
    let cancelled = false;

    // realtime for messages - same channel name for all participants
    const channelName = `messages:${actualConvId}`;
    const chan = supabase.channel(channelName, { config: { presence: { key: me.id } } });
    chan.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${actualConvId}` }, (payload: { new: TextMessage }) => {
      const m = payload.new as TextMessage;
      const sender = usersRef.current.find((u) => u.id === m.sender_id);
      setMessages((prev) => {
        if (prev.find((x) => x.id === m.id)) return prev;
        const pendingIndex = prev.findIndex((x) => x.status === "sending" && x.sender_id === m.sender_id && x.content === m.content);
        if (pendingIndex === -1) return [...prev, { ...m, senderName: sender?.displayName, status: "sent" }];
        return prev.map((message, index) => index === pendingIndex ? { ...m, senderName: sender?.displayName, status: "sent" } : message);
      });
    });
    chan.on("presence", { event: "sync" }, () => {
      const presence = chan.presenceState<{ user_id: string }>();
      const ids = Object.values(presence).flatMap((entries) => entries.map((entry) => entry.user_id));
      setOnlineUserIds([...new Set(ids)]);
    });
    chan.subscribe(async (status: string) => {
      if (cancelled) return;
      if (status === "SUBSCRIBED") {
        setConnectionStatus("connected");
        await chan.track({ user_id: me.id, display_name: me.displayName });
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setConnectionStatus("offline");
    });
    channelRef.current = chan;

    // P2P images via broadcast (ephemeral, no DB) - same channel for all.
    // The image channel is created before loading messages so a slow database
    // request cannot prevent image delivery from being initialized.
    const imgName = `p2p:${actualConvId}`;
    const imgChan = supabase.channel(imgName, { config: { broadcast: { self: false } } });
    imgChan.on("broadcast", { event: "image" }, (payload: { payload: ImageMessage }) => {
      const msg = payload.payload as ImageMessage;
      if (cancelled || msg.conversationId !== actualConvId) return;
      setP2pImages((prev) => (prev.find((x) => x.id === msg.id) ? prev : [...prev, msg]));
    });
    imgChan.on("broadcast", { event: "image-chunk" }, (payload: { payload: ImageChunk }) => {
      const chunk = payload.payload as ImageChunk;
      if (cancelled || chunk.conversationId !== actualConvId || chunk.total < 1 || chunk.total > 1024 || chunk.index < 0 || chunk.index >= chunk.total) return;

      let transfer = pendingImageTransfers.get(chunk.transferId);
      if (!transfer) {
        const timeout = setTimeout(() => {
          pendingImageTransfers.delete(chunk.transferId);
          setNotice("تعذر اكتمال استقبال الصورة. اطلب من المرسل إعادة إرسالها.");
        }, 60_000);
        transfer = {
          message: {
            id: chunk.transferId,
            conversationId: chunk.conversationId,
            senderId: chunk.senderId,
            senderName: chunk.senderName,
            createdAt: chunk.createdAt,
          },
          chunks: Array<string>(chunk.total),
          received: 0,
          timeout,
        };
        pendingImageTransfers.set(chunk.transferId, transfer);
      }

      if (transfer.chunks[chunk.index] !== undefined) return;
      transfer.chunks[chunk.index] = chunk.data;
      transfer.received += 1;

      if (transfer.received === chunk.total) {
        clearTimeout(transfer.timeout);
        pendingImageTransfers.delete(chunk.transferId);
        setP2pImages((prev) => prev.find((x) => x.id === chunk.transferId)
          ? prev
          : [...prev, { ...transfer.message, dataUrl: transfer.chunks.join("") }]);
      }
    });
    const imageChannelReady = new Promise<void>((resolve, reject) => {
      imgChan.subscribe((status: string, error?: Error) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reject(error || new Error(`Image channel failed with status: ${status}`));
        }
      });
    });
    imageChannelReady.catch(() => undefined);
    imageChannelReadyRef.current = imageChannelReady;
    imageChannelRef.current = imgChan;

    const load = async () => {
      const { data } = await supabase.from("messages").select("*").eq("conversation_id", actualConvId).order("created_at", { ascending: true }).limit(200);
      if (cancelled) return;
      if (data) {
        const enriched = (data as unknown as TextMessage[]).map((m) => {
          const sender = usersRef.current.find((u) => u.id === m.sender_id);
          return { ...m, senderName: sender?.displayName || m.sender_id.slice(0, 6) };
        });
        setMessages(enriched);
      }
    };
    load();
    return () => {
      cancelled = true;
      setOnlineUserIds([]);
      for (const transfer of pendingImageTransfers.values()) clearTimeout(transfer.timeout);
      pendingImageTransfers.clear();
      if (imageChannelRef.current === imgChan) {
        imageChannelRef.current = null;
        imageChannelReadyRef.current = null;
      }
      if (chan) supabase.removeChannel(chan);
      if (imgChan) supabase.removeChannel(imgChan);
    };
  }, [actualConvId, me]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, p2pImages]);

  const handleSend = async () => {
    if (!input.trim() || !me || sendingText) return;
    const text = input.trim();
    const { data: membership } = await supabase
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", actualConvId)
      .eq("user_id", me.id)
      .maybeSingle();
    if (!membership) {
      const { error: membershipError } = await supabase
        .from("conversation_participants")
        .insert({ conversation_id: actualConvId, user_id: me.id });
      if (membershipError && membershipError.code !== "23505") {
        console.error("Message membership error:", membershipError);
        setNotice("تعذر تجهيز عضويتك في المحادثة. أعد فتح المحادثة ثم حاول مرة أخرى.");
        return;
      }
    }
    setInput("");
    const temporaryId = `sending-${Date.now()}`;
    setSendingText(true);
    setMessages((prev) => [...prev, { id: temporaryId, conversation_id: actualConvId, sender_id: me.id, senderName: me.displayName, content: text, created_at: new Date().toISOString(), status: "sending" }]);
    const { data, error } = await supabase.from("messages").insert({ conversation_id: actualConvId, sender_id: me.id, content: text }).select();
    if (error || !data?.[0]) {
      console.error("Supabase insert error:", error);
      setMessages((prev) => prev.filter((message) => message.id !== temporaryId));
      setNotice("تعذر إرسال الرسالة. تحقق من الاتصال ثم حاول مرة أخرى.");
      setSendingText(false);
      return;
    }
    const savedMessage = data[0] as TextMessage;
    setMessages((prev) => prev.map((message) => message.id === temporaryId ? { ...savedMessage, senderName: me.displayName, status: "sent" } : message));
    setSendingText(false);
  };

  const handleLogout = async () => {
    await logout();
    lockVault();
    router.push("/");
  };

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newUserPassword !== newUserPasswordConfirm) {
      setNotice("كلمتا سر المستخدم الجديد غير متطابقتين.");
      return;
    }
    setCreatingUser(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("انتهت جلسة الدخول. سجّل الدخول مرة أخرى.");
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ username: newUsername, displayName: newDisplayName, password: newUserPassword }),
      });
      const result = await response.json() as { error?: string; user?: LocalUser };
      if (!response.ok || !result.user) throw new Error(result.error || "تعذر إنشاء المستخدم.");
      setUsers((previous) => [...previous, result.user!].sort((a, b) => a.displayName.localeCompare(b.displayName, "ar")));
      setNewUsername("");
      setNewDisplayName("");
      setNewUserPassword("");
      setNewUserPasswordConfirm("");
      setNotice("تم إنشاء المستخدم بنجاح.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر إنشاء المستخدم.");
    } finally {
      setCreatingUser(false);
    }
  };

  const handleDeleteUser = async (user: LocalUser) => {
    if (!me || user.id === me.id || user.role === "admin" || deletingUserId) return;
    if (!window.confirm(`هل تريد حذف المستخدم ${user.displayName}؟`)) return;
    setDeletingUserId(user.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("انتهت جلسة الدخول. سجّل الدخول مرة أخرى.");
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ profileId: user.id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "تعذر حذف المستخدم.");
      setUsers((previous) => previous.filter((item) => item.id !== user.id));
      if (selectedId === user.id) setSelectedId(FAMILY_GROUP_ID);
      setNotice("تم حذف المستخدم.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حذف المستخدم.");
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !me || sendingImage) return;
    if (file.size > 8 * 1024 * 1024) {
      setNotice("الصورة كبيرة جدًا. الحد الأقصى 8 ميغابايت.");
      return;
    }
    setSendingImage(true);
    setImageProgress(0);
    try {
      const dataUrl = await compressImageToBase64(file);
      setImageProgress(10);
      const imgMsg: ImageMessage = {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        conversationId: actualConvId,
        senderId: me.id,
        senderName: me.displayName,
        dataUrl,
        createdAt: new Date().toISOString(),
      };
      const channel = imageChannelRef.current;
      const ready = imageChannelReadyRef.current;
      if (!channel || !ready) throw new Error("قناة الصور غير جاهزة");
      await ready;

      if (dataUrl.length <= IMAGE_CHUNK_SIZE) {
        const result = await channel.send({ type: "broadcast", event: "image", payload: imgMsg });
        if (result !== "ok") throw new Error(`فشل إرسال الصورة: ${result}`);
        setImageProgress(100);
      } else {
        const total = Math.ceil(dataUrl.length / IMAGE_CHUNK_SIZE);
        for (let index = 0; index < total; index += 1) {
          const result = await channel.send({
            type: "broadcast",
            event: "image-chunk",
            payload: {
              transferId: imgMsg.id,
              conversationId: imgMsg.conversationId,
              senderId: imgMsg.senderId,
              senderName: imgMsg.senderName,
              createdAt: imgMsg.createdAt,
              index,
              total,
              data: dataUrl.slice(index * IMAGE_CHUNK_SIZE, (index + 1) * IMAGE_CHUNK_SIZE),
            } satisfies ImageChunk,
          });
          if (result !== "ok") throw new Error(`فشل إرسال جزء الصورة ${index + 1} من ${total}: ${result}`);
          setImageProgress(Math.round(((index + 1) / total) * 100));
        }
      }

      // Show locally only after Realtime confirms the send.
      setP2pImages((prev) => [...prev, imgMsg]);
    } catch (error) {
      console.error("Image send error:", error);
      setNotice(error instanceof Error ? error.message : "فشل إرسال الصورة");
    } finally {
      setSendingImage(false);
      setImageProgress(0);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const combined: RenderMessage[] = [...messages.map((m) => ({ ...m, type: "text" as const })), ...p2pImages.map((m) => ({ ...m, type: "image" as const, created_at: m.createdAt, conversation_id: m.conversationId, sender_id: m.senderId, content: "" }))].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  if (!me) return null;

  const selectedUser = users.find((u) => u.id === selectedId);
  const connectionLabel = connectionStatus !== "connected"
    ? connectionStatus === "connecting" ? "جار الاتصال…" : "غير متصل"
    : selectedId === FAMILY_GROUP_ID
      ? `${onlineUserIds.length} متصلون الآن`
      : selectedUser && onlineUserIds.includes(selectedUser.id) ? "متصل الآن" : "غير متصل الآن";

  return (
    <div className="h-[100svh] max-h-[100svh] min-h-0 overflow-hidden flex bg-white" dir="rtl">
      <div className="w-[320px] min-h-0 border-l border-zinc-200 flex-col bg-zinc-50 hidden md:flex">
        <div className="h-16 shrink-0 flex items-center justify-between px-4 border-b border-zinc-200 bg-white">
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
          {me.role === "admin" && <button onClick={() => setShowSettings((v) => !v)} className="w-full h-10 rounded-xl border border-zinc-200 text-sm font-medium text-black">الإعدادات</button>}
          <button onClick={handleLogout} className="w-full h-10 rounded-xl bg-black text-white text-sm">قفل والعودة للآلة الحاسبة</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="h-16 shrink-0 border-b border-zinc-200 flex items-center justify-between px-4 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-black text-white flex items-center justify-center text-sm">{selectedId === FAMILY_GROUP_ID ? "👨‍👩‍👧‍👦" : selectedUser?.displayName[0]}</div>
            <div>
              <div className="font-semibold text-black text-sm">{selectedId === FAMILY_GROUP_ID ? "جروب العائلة" : selectedUser?.displayName}</div>
            <div className={`text-xs ${connectionStatus === "connected" ? "text-green-600" : connectionStatus === "connecting" ? "text-amber-600" : "text-red-600"}`} aria-live="polite">{connectionLabel}</div>
          </div>
          </div>
          <div className="flex items-center gap-2 md:hidden">
            {me.role === "admin" && <button onClick={() => setShowSettings((value) => !value)} className="h-9 px-3 rounded-xl border border-zinc-200 text-sm text-black" aria-label="إعدادات المدير">⚙️</button>}
            <button onClick={handleLogout} className="h-9 px-3 rounded-xl border border-zinc-200 text-xs text-black" aria-label="تسجيل الخروج">خروج</button>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="h-9 rounded-xl border border-zinc-200 px-2 text-sm text-black">
              <option value={FAMILY_GROUP_ID}>جروب العائلة</option>
              {users.filter((u) => u.id !== me.id).map((u) => (<option key={u.id} value={u.id}>{u.displayName}</option>))}
            </select>
          </div>
        </div>

        {notice && <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-900 flex items-center justify-between" role="alert">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="mr-3 text-xs font-semibold" aria-label="إغلاق التنبيه">إغلاق</button>
        </div>}

        {showSettings && me.role === "admin" && (
          <div className="max-h-[45svh] overflow-y-auto shrink-0 p-4 bg-amber-50 border-b border-amber-200">
            <div className="text-sm font-semibold text-black mb-2">إعدادات المدير</div>
            <div className="flex gap-2">
              <input value={newCode} onChange={(e) => setNewCode(e.target.value.replace(/\D/g, ""))} className="flex-1 h-10 rounded-xl border border-zinc-300 px-3 text-black" placeholder="2025147151" />
              <button onClick={() => { if (newCode.length < 4) { setNotice("الرمز يجب أن يحتوي على 4 أرقام على الأقل."); return; } setVaultCode(newCode); setNotice("تم حفظ الرمز على هذا الجهاز."); }} className="h-10 px-4 rounded-xl bg-black text-white text-sm">حفظ</button>
            </div>
            <div className="mt-5 border-t border-amber-200 pt-4">
              <div className="text-sm font-semibold text-black mb-1">إضافة فرد للعائلة</div>
              <div className="text-xs text-zinc-600 mb-3">سيتم إنشاء الحساب بأمان دون حفظ كلمة السر في التطبيق.</div>
              <form onSubmit={handleCreateUser} className="grid gap-2 sm:grid-cols-2">
                <input value={newUsername} onChange={(event) => setNewUsername(event.target.value)} placeholder="اسم المستخدم بالإنجليزية" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" required className="h-10 rounded-xl border border-zinc-300 px-3 text-black" />
                <input value={newDisplayName} onChange={(event) => setNewDisplayName(event.target.value)} placeholder="الاسم الظاهر" minLength={2} maxLength={80} required className="h-10 rounded-xl border border-zinc-300 px-3 text-black" />
                <input value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} type="password" placeholder="كلمة السر (8 أحرف على الأقل)" minLength={8} required className="h-10 rounded-xl border border-zinc-300 px-3 text-black" />
                <input value={newUserPasswordConfirm} onChange={(event) => setNewUserPasswordConfirm(event.target.value)} type="password" placeholder="تأكيد كلمة السر" minLength={8} required className="h-10 rounded-xl border border-zinc-300 px-3 text-black" />
                <button disabled={creatingUser} className="h-10 rounded-xl bg-black text-white text-sm sm:col-span-2 disabled:opacity-50">{creatingUser ? "جار إنشاء المستخدم…" : "إنشاء المستخدم"}</button>
              </form>
              <div className="mt-5 border-t border-amber-200 pt-4">
                <div className="text-sm font-semibold text-black mb-2">المستخدمون</div>
                <div className="space-y-2">
                  {users.filter((user) => user.id !== me.id).map((user) => (
                    <div key={user.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-black truncate">{user.displayName}</div>
                        <div className="text-xs text-zinc-500 truncate">@{user.username}</div>
                      </div>
                      {user.role !== "admin" && <button type="button" onClick={() => void handleDeleteUser(user)} disabled={deletingUserId === user.id} className="shrink-0 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700 disabled:opacity-50">{deletingUserId === user.id ? "جار الحذف…" : "حذف"}</button>}
                    </div>
                  ))}
                  {users.filter((user) => user.id !== me.id).length === 0 && <div className="text-xs text-zinc-500">لا يوجد مستخدمون آخرون.</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3 bg-[#ece5dd]">
          {combined.length === 0 && <div className="text-center text-sm text-zinc-500 mt-10">لا توجد رسائل بعد. جرب الإرسال وستظهر فوراً على كل الأجهزة 👋</div>}
          {combined.map((m) => {
            const isMe = m.sender_id === me.id;
            if (m.type === "image") {
              return (
                <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl overflow-hidden shadow ${isMe ? "bg-[#dcf8c6]" : "bg-white"} p-2`}>
                    {/* Data URLs are intentionally kept in memory only; next/image would require a loader here. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.dataUrl} alt={`صورة من ${m.senderName || "المستخدم"}`} className="rounded-xl max-w-full max-h-[60dvh] object-contain" />
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => downloadBase64Image(m.dataUrl, `image-${m.id}${m.dataUrl.startsWith("data:image/jpeg") ? ".jpg" : ".webp"}`)} className="flex-1 h-8 rounded-lg bg-black text-white text-xs">تحميل على الجوال</button>
                      <button onClick={() => setP2pImages((prev) => prev.filter((x) => x.id !== m.id))} className="h-8 px-3 rounded-lg border border-zinc-300 text-xs bg-white text-black">تجاهل</button>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-1 text-left">صورة مؤقتة — لا تُحفظ إلا إذا اخترت تنزيلها</div>
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2 shadow text-sm ${isMe ? "bg-[#dcf8c6] text-black rounded-br-none" : "bg-white text-black rounded-bl-none"}`}>
                  {!isMe && <div className="text-[11px] font-bold text-[#075e54]">{m.senderName || users.find((u) => u.id === m.sender_id)?.displayName}</div>}
                  <div className="leading-6 break-words">{m.content}</div>
                  <div className="text-[10px] text-zinc-500 mt-1 text-left flex justify-end gap-2">
                    <span>{new Date(m.created_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</span>
                    {isMe && m.status === "sending" && <span>جار الإرسال…</span>}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="shrink-0 p-3 border-t border-zinc-200 bg-white flex items-center gap-2">
          <button onClick={() => fileRef.current?.click()} disabled={sendingImage || connectionStatus !== "connected"} className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-black hover:bg-zinc-200 disabled:opacity-50" title="إرسال صورة" aria-label="إرسال صورة">{sendingImage ? `${imageProgress}%` : "📷"}</button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }} placeholder="اكتب رسالة..." className="flex-1 h-11 rounded-full border border-zinc-200 px-4 text-black outline-none focus:border-black bg-zinc-50" />
          <button onClick={handleSend} disabled={sendingText || connectionStatus !== "connected"} className="w-11 h-11 rounded-full bg-[#075e54] text-white flex items-center justify-center disabled:opacity-50" aria-label="إرسال الرسالة">{sendingText ? "…" : "➤"}</button>
        </div>
        <div className="shrink-0 text-center text-[11px] text-zinc-500 bg-white pb-2">النصوص محفوظة • الصور مؤقتة ولا تُحفظ إلا عند تنزيلها</div>
      </div>
    </div>
  );
}
