import { ble } from "../ble.js";
import { canSend, sendText, getMessages, messagingEvents } from "../messaging.js";

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function tickFor(record) {
  if (record.direction === "in") return null;
  if (record.state === "sending") return { symbol: "…", fail: false };
  if (record.state === "sent") return { symbol: "✓ inviato al nodo", fail: false };
  if (record.state === "fail") return { symbol: "⚠ tocca per reinviare", fail: true };
  return null;
}

export async function mount(container) {
  container.innerHTML = `
    <div class="chat-tab">
      <div class="chat-header">TUTTI</div>
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-disabled-banner" id="chat-disabled" hidden></div>
      <div class="chat-input-row">
        <input type="text" id="chat-input" placeholder="Scrivi un messaggio…" maxlength="1000" />
        <button type="button" class="btn" id="chat-send">Invia</button>
      </div>
    </div>
  `;

  const logEl = container.querySelector("#chat-log");
  const disabledBanner = container.querySelector("#chat-disabled");
  const input = container.querySelector("#chat-input");
  const sendBtn = container.querySelector("#chat-send");

  function showBanner(message) {
    disabledBanner.hidden = false;
    disabledBanner.textContent = message;
  }

  function renderBubble(record) {
    const row = document.createElement("div");
    row.className = `chat-bubble-row ${record.direction === "out" ? "out" : "in"}`;

    const col = document.createElement("div");
    col.className = "chat-bubble-col";

    if (record.direction === "in") {
      const sender = document.createElement("div");
      sender.className = "chat-sender";
      sender.textContent = `Nodo ${record.srcId}`;
      col.appendChild(sender);
    }

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = record.text; // textContent: mai innerHTML su testo utente
    col.appendChild(bubble);

    const meta = document.createElement("div");
    meta.className = "chat-bubble-meta";

    const time = document.createElement("span");
    time.textContent = formatTime(record.timestamp);
    meta.appendChild(time);

    const tick = tickFor(record);
    if (tick) {
      const tickEl = document.createElement("span");
      tickEl.textContent = tick.symbol;
      if (tick.fail) {
        tickEl.classList.add("fail");
        tickEl.addEventListener("click", () => {
          sendText(record.text).catch((err) => showBanner(err.message));
        });
      }
      meta.appendChild(tickEl);
    }
    col.appendChild(meta);

    row.appendChild(col);
    return row;
  }

  async function renderLog() {
    const messages = await getMessages();
    logEl.innerHTML = "";
    for (const record of messages) logEl.appendChild(renderBubble(record));
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function refreshReadyState() {
    const ready = await canSend();
    input.disabled = !ready.ok;
    sendBtn.disabled = !ready.ok;
    disabledBanner.hidden = ready.ok;
    if (!ready.ok) disabledBanner.textContent = ready.reason;
  }

  async function handleSend() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await sendText(text);
    } catch (err) {
      showBanner(err.message);
    }
  }

  sendBtn.addEventListener("click", handleSend);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") handleSend();
  });

  const onChange = () => renderLog();
  const onConnectionChange = () => refreshReadyState();

  messagingEvents.addEventListener("change", onChange);
  ble.addEventListener("connected", onConnectionChange);
  ble.addEventListener("disconnected", onConnectionChange);

  await renderLog();
  await refreshReadyState();

  return {
    onUnmount() {
      messagingEvents.removeEventListener("change", onChange);
      ble.removeEventListener("connected", onConnectionChange);
      ble.removeEventListener("disconnected", onConnectionChange);
    },
  };
}
