import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { HeyReachChatroom } from "../heyreach/index.js";
import { normalizeChatroom } from "./outreach-prompts.js";

// TODO (docs/outreach-functions.md §12): swap this synthetic fixture for a
// captured HeyReach /GetChatroom payload once we observe one in production.
// Shapes covered below match `HeyReachChatMessage.sender: unknown` as flagged
// in the open questions — primitive number/string and object-form with
// `id` / `accountId` / `linkedInAccountId`.
const OUR_ACCOUNT_ID = 1234567;

function chatroom(messages: unknown[]): HeyReachChatroom {
  return {
    id: "conv-test",
    read: true,
    groupChat: false,
    linkedInAccountId: OUR_ACCOUNT_ID,
    messages: messages as HeyReachChatroom["messages"],
  };
}

describe("normalizeChatroom", () => {
  it("maps sender shapes to us/them", () => {
    const room = chatroom([
      { createdAt: "2026-04-20T10:00:00Z", body: "hi", sender: OUR_ACCOUNT_ID },
      {
        createdAt: "2026-04-20T10:05:00Z",
        body: "hey",
        sender: String(OUR_ACCOUNT_ID),
      },
      { createdAt: "2026-04-20T10:10:00Z", body: "A", sender: { id: OUR_ACCOUNT_ID } },
      {
        createdAt: "2026-04-20T10:15:00Z",
        body: "B",
        sender: { accountId: String(OUR_ACCOUNT_ID) },
      },
      {
        createdAt: "2026-04-20T10:20:00Z",
        body: "C",
        sender: { linkedInAccountId: OUR_ACCOUNT_ID },
      },
      { createdAt: "2026-04-20T10:25:00Z", body: "lead msg", sender: 9999999 },
      { createdAt: "2026-04-20T10:30:00Z", body: "obj lead", sender: { id: 9999999 } },
      { createdAt: "2026-04-20T10:35:00Z", body: "no sender" },
    ]);

    const out = normalizeChatroom(room, OUR_ACCOUNT_ID);
    assert.equal(out.length, 8);
    assert.deepEqual(
      out.map((m) => m.from),
      ["us", "us", "us", "us", "us", "them", "them", "them"],
    );
  });

  it("filters messages with missing or whitespace-only body", () => {
    const room = chatroom([
      { createdAt: "2026-04-20T10:00:00Z", body: "kept", sender: OUR_ACCOUNT_ID },
      { createdAt: "2026-04-20T10:01:00Z", body: "   ", sender: 9999999 },
      { createdAt: "2026-04-20T10:02:00Z", sender: 9999999 },
      { createdAt: "2026-04-20T10:03:00Z", body: "", sender: OUR_ACCOUNT_ID },
    ]);
    const out = normalizeChatroom(room, OUR_ACCOUNT_ID);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.text, "kept");
  });

  it("sorts chronologically regardless of input order", () => {
    const room = chatroom([
      { createdAt: "2026-04-20T12:00:00Z", body: "third", sender: 9999999 },
      { createdAt: "2026-04-20T10:00:00Z", body: "first", sender: OUR_ACCOUNT_ID },
      { createdAt: "2026-04-20T11:00:00Z", body: "second", sender: 9999999 },
    ]);
    const out = normalizeChatroom(room, OUR_ACCOUNT_ID);
    assert.deepEqual(
      out.map((m) => m.text),
      ["first", "second", "third"],
    );
  });

  it("returns empty array when messages is missing", () => {
    const room: HeyReachChatroom = {
      id: "conv-empty",
      read: true,
      groupChat: false,
      linkedInAccountId: OUR_ACCOUNT_ID,
    };
    assert.deepEqual(normalizeChatroom(room, OUR_ACCOUNT_ID), []);
  });
});
