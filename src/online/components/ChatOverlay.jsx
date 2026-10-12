import { useEffect, useRef, useState } from "react";
import {
  Send,
  X,
  MessageCircle,
  Mic,
  Trash2,
  Play,
  Square,
  Smile,
} from "lucide-react-online";
import { useGame, useChat } from "../context/GameContext";
import { voicePlayer } from "../lib/voicePlayer";
import AvatarImg from "./AvatarImg";
import Sheet from "./ui/Sheet";

const MAX_RECORD_MS = 15 * 1000;

// Tap-back palette. Must stay in step with REACTION_EMOJIS in
// server/socket/handlers.js — the server drops anything outside that set.
const REACTIONS = ["😂", "❤️", "😮", "👏", "🔥"];

// Quick-pick emojis for the chat composer.
const CHAT_EMOJIS = [
  "😀",
  "😂",
  "🤣",
  "😎",
  "😉",
  "😜",
  "🥳",
  "😱",
  "😡",
  "🤔",
  "😴",
  "🥲",
  "👍",
  "👎",
  "👏",
  "💪",
  "🙏",
  "❤️",
  "💔",
  "🔥",
  "🍷",
  "🍇",
  "🃏",
  "🎉",
];

/**
 * Small play/stop pill for a received voice clip. Playback is owned by the
 * module-level voicePlayer, so closing the drawer (unmounting this bubble)
 * does NOT stop a clip that's mid-play — the bubble just re-syncs its
 * play/stop icon from the player when it mounts again.
 */
function VoiceBubble({ url, duration, mine }) {
  const [playingUrl, setPlayingUrl] = useState(() => voicePlayer.playingUrl());
  useEffect(() => voicePlayer.subscribe(setPlayingUrl), []);
  const playing = playingUrl === url;
  const toggle = () => voicePlayer.toggle(url);

  const accent = mine ? "#d7fa52" : "#c5cbb9";
  return (
    <button
      onClick={toggle}
      className="inline-flex items-center gap-2 py-0.5 active:scale-95 transition-all"
      style={{ color: "inherit" }}
    >
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ border: `1.5px solid ${accent}`, color: accent }}
      >
        {playing ? (
          <Square size={11} />
        ) : (
          <Play size={11} style={{ marginLeft: 1 }} />
        )}
      </span>
      <span className="tracking-[0.2em] select-none" style={{ opacity: 0.75 }}>
        ▂▄▆▄▂▄▂
      </span>
      <span className="text-[10px] font-mono" style={{ opacity: 0.8 }}>
        {duration}″
      </span>
    </button>
  );
}

export default function ChatOverlay({ open, onClose }) {
  const { mySeat, players, addToast } = useGame();
  const {
    chatMessages,
    sendChat,
    sendVoice,
    typingSeats,
    sendTyping,
    reactToMessage,
    canSpeak,
  } = useChat();
  // Which message currently has its picker pinned open. Touch has no hover,
  // so the palette needs an explicit open state rather than relying on CSS.
  const [pickerFor, setPickerFor] = useState(null);
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const listRef = useRef(null);

  const addEmoji = (e) => {
    setText((t) => (t.length + e.length <= 240 ? t + e : t));
    sendTyping();
  };

  // ── Voice recording ─────────────────────────────────────────────────────
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const recRef = useRef(null); // { recorder, chunks, cancelled, startAt, tickId, maxId }

  const stopRecording = (cancel = false) => {
    const r = recRef.current;
    if (!r) return;
    r.cancelled = cancel;
    if (r.recorder.state !== "inactive") r.recorder.stop();
  };

  const startRecording = async () => {
    if (recording) {
      stopRecording(false);
      return;
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      addToast("ამ ბრაუზერში ხმის ჩაწერა არ არის მხარდაჭერილი.", "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Chrome/Firefox → webm/opus; iOS Safari → mp4/aac. Receivers play
      // whatever mime tag rides along with the bytes.
      const mime = MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported?.("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      const r = { recorder, chunks: [], cancelled: false, startAt: Date.now() };
      recRef.current = r;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) r.chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(r.tickId);
        clearTimeout(r.maxId);
        setRecording(false);
        setRecSecs(0);
        recRef.current = null;
        if (r.cancelled || !r.chunks.length) return;
        const durationSec = Math.max(
          1,
          Math.round((Date.now() - r.startAt) / 1000),
        );
        const blob = new Blob(r.chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        sendVoice(blob, durationSec);
      };

      recorder.start();
      setRecording(true);
      setRecSecs(0);
      r.tickId = setInterval(() => setRecSecs((s) => s + 1), 1000);
      r.maxId = setTimeout(() => stopRecording(false), MAX_RECORD_MS);
    } catch {
      addToast("მიკროფონზე წვდომა ვერ მოხერხდა.", "error");
    }
  };

  // Closing the drawer mid-recording throws the clip away.
  useEffect(() => () => stopRecording(true), []);

  const typingPlayers = Object.keys(typingSeats || {})
    .map((s) => players.find((p) => p.seat === Number(s)))
    .filter(Boolean);

  useEffect(() => {
    if (open && listRef.current)
      listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, chatMessages, typingPlayers.length]);

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    sendChat(text);
    setText("");
    setEmojiOpen(false);
  };

  return (
    <Sheet
      drawer
      eyebrow="TABLE / INSIGHTS"
      title="მაგიდის ჩატი"
      onClose={() => {
        stopRecording(true);
        onClose();
      }}
    >
      <div className="k-chat">
        <div className="k-chat-messages" ref={listRef} aria-live="polite">
          {!chatMessages.length && (
            <div className="k-chat-empty">
              <MessageCircle size={32} strokeWidth={1} />
              <h4>საუბარი აქ იწყება.</h4>
              <p>გაუზიარე მაგიდას შენი აზრი.</p>
            </div>
          )}
          {chatMessages.map((m, i) => {
            const mine = m.seat === mySeat;
            return (
              <div
                key={m.id || `${m.seat}:${m.at ?? i}`}
                className={`k-chat-message ${mine ? "is-mine" : ""}`}
              >
                <AvatarImg avatar={m.avatar} size={28} />
                <div>
                  <span>{m.name}</span>
                  <div className="k-message-body">
                    {m.type === "voice" ? (
                      <VoiceBubble
                        url={m.url}
                        duration={m.duration}
                        mine={mine}
                      />
                    ) : (
                      m.message
                    )}
                  </div>
                  <div className="k-message-reactions">
                    {Object.entries(m.reactions || {}).map(([emoji, by]) => (
                      <button
                        key={emoji}
                        onClick={() => m.id && reactToMessage(m.id, emoji)}
                        title={by.map((r) => r.name).join(", ")}
                      >
                        {emoji}
                        {by.length > 1 ? by.length : ""}
                      </button>
                    ))}
                    {m.id && (
                      <button
                        aria-label="რეაქციის დამატება"
                        onClick={() =>
                          setPickerFor(pickerFor === m.id ? null : m.id)
                        }
                      >
                        <Smile size={13} />
                      </button>
                    )}
                  </div>
                  {pickerFor === m.id && (
                    <div className="k-message-reactions">
                      {REACTIONS.map((e) => (
                        <button
                          key={e}
                          onClick={() => {
                            reactToMessage(m.id, e);
                            setPickerFor(null);
                          }}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {typingPlayers.map((p) => (
            <p key={p.seat} className="k-muted">
              {p.name} წერს…
            </p>
          ))}
        </div>
        {emojiOpen && !recording && (
          <div className="k-chat-emojis">
            {CHAT_EMOJIS.map((e) => (
              <button key={e} type="button" onClick={() => addEmoji(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
        <form className="k-chat-compose" onSubmit={submit}>
          {!recording && (
            <button
              type="button"
              aria-label="ემოჯი"
              aria-expanded={emojiOpen}
              onClick={() => setEmojiOpen((o) => !o)}
            >
              <Smile size={18} />
            </button>
          )}
          {recording ? (
            <div className="k-recording">
              <span>იწერება {recSecs}/15 წმ</span>
              <button
                type="button"
                aria-label="ჩაწერის გაუქმება"
                onClick={() => stopRecording(true)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ) : (
            <input
              aria-label="შეტყობინება"
              maxLength={240}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (e.target.value) sendTyping();
              }}
              placeholder="დაწერე შეტყობინება…"
            />
          )}
          {canSpeak && (
            <button
              type="button"
              aria-label={recording ? "ხმის გაგზავნა" : "ხმოვანი შეტყობინება"}
              className={recording ? "is-recording" : ""}
              onClick={startRecording}
            >
              {recording ? <Send size={18} /> : <Mic size={18} />}
            </button>
          )}
          {!recording && (
            <button
              type="submit"
              className="k-chat-send"
              disabled={!text.trim()}
              aria-label="გაგზავნა"
            >
              <Send size={18} />
            </button>
          )}
        </form>
      </div>
    </Sheet>
  );
}
