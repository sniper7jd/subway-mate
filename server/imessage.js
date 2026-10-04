import "dotenv/config";
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import station from "../shared/times-square.json" with { type: "json" };
import { scanIMessageAttachment, stopIMessageImageReader } from "./imessage-images.js";
import { createConversationState, processTextMessage } from "./imessage-guide.js";
import { createMessageDeduplicator } from "./message-dedupe.js";

const MAX_CONVERSATIONS = 2_000;
const conversations = new Map();
const isDuplicateDelivery = createMessageDeduplicator();
let spectrum;
let connectionStatus = "disabled";

function currentConversation(spaceId) {
  let state = conversations.get(spaceId);
  if (!state) {
    state = createConversationState();
    if (conversations.size >= MAX_CONVERSATIONS) {
      conversations.delete(conversations.keys().next().value);
    }
  } else {
    conversations.delete(spaceId);
  }
  conversations.set(spaceId, state);
  return state;
}

function messageContents(content) {
  if (content?.type === "group") {
    return content.items.flatMap((item) => messageContents(item.content));
  }
  return content ? [content] : [];
}

function safeError(error) {
  return error instanceof Error ? error.message : "Unknown iMessage integration error";
}

async function handleMessage(space, message) {
  if (message.direction !== "inbound" || message.platform !== "imessage") return;
  if (isDuplicateDelivery(message.id)) return;

  const spaceId = space.id;
  let state = currentConversation(spaceId);
  const responses = [];
  for (const content of messageContents(message.content)) {
    if (content.type === "text" && content.text.trim()) {
      const result = processTextMessage(state, content.text);
      state = result.state;
      responses.push(result.reply);
    } else if (content.type === "attachment") {
      try {
        const result = await scanIMessageAttachment(state, content);
        state = result.state;
        responses.push(result.reply);
      } catch (error) {
        console.error(`Could not process an incoming iMessage photo: ${safeError(error)}`);
        responses.push("I couldn't read that photo. Send a smaller, clear JPEG, PNG, or WebP sign image, or type the sign's line and direction.");
      }
    }
  }
  conversations.set(spaceId, state);

  if (!responses.length) return;
  for (const response of responses) await space.send(response);
}

export async function startIMessage() {
  const projectId = process.env.SPECTRUM_PROJECT_ID || process.env.PROJECT_ID;
  const projectSecret = process.env.SPECTRUM_PROJECT_SECRET || process.env.PROJECT_SECRET;
  if (!projectId || !projectSecret) {
    connectionStatus = "disabled";
    console.warn("iMessage bot disabled: set SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET in .env.");
    return null;
  }

  connectionStatus = "connecting";
  try {
    spectrum = await Spectrum({
      projectId,
      projectSecret,
      providers: [imessage.config()],
    });
  } catch (error) {
    connectionStatus = "failed";
    throw error;
  }
  void (async () => {
    try {
      for await (const [space, message] of spectrum.messages) {
        try {
          await handleMessage(space, message);
        } catch (error) {
          console.error(`Could not respond to an iMessage: ${safeError(error)}`);
        }
      }
    } catch (error) {
      connectionStatus = "disconnected";
      console.error(`Photon iMessage stream stopped: ${safeError(error)}`);
    }
  })();
  connectionStatus = "connected";
  console.log("Photon iMessage assistant is connected.");
  return spectrum;
}

export function getIMessageStatus() {
  return connectionStatus;
}

export async function stopIMessage() {
  connectionStatus = "stopped";
  await spectrum?.stop();
  await stopIMessageImageReader();
}
