const express = require("express");
const { store, save } = require("../db");
const { verifyLineSignature, replyLine, getLineProfile } = require("../line");

const router = express.Router();

// LINE calls this URL whenever something happens on the Official Account
// (someone friends it, unfriends it, sends it a message, etc). Must be
// registered as the channel's Webhook URL in the LINE Developers Console
// (Messaging API tab) with "Use webhook" turned on. No session/cookie auth
// is possible here (LINE, not a browser, is the caller) — instead the
// request is verified via the X-Line-Signature header (see verifyLineSignature).
//
// Friending the account does NOT automatically start sending anyone the
// closing summary. It only adds them to a "pending approval" list (with
// their LINE display name + photo, via the Profile API) that the owner
// reviews in Admin > 설정 > 관리자 전용 and explicitly approves by name —
// LINE has no way to look someone up by their personal @ID/phone number, so
// this is the only way to be sure it's actually 엄마/아빠 and not a stranger
// who happened to find the account.
router.post("/", async (req, res) => {
  const signature = req.get("x-line-signature");
  const channelSecret = store.settings.line_channel_secret;
  if (!verifyLineSignature(channelSecret, req.rawBody, signature)) {
    return res.status(401).json({ error: "invalid_signature" });
  }

  // NOTE: this must await all processing (profile lookup, DB save) BEFORE
  // responding — sending res.json() early and continuing work afterward
  // (the usual "ack fast" pattern) doesn't work on Vercel's serverless
  // functions: the function instance can be frozen/torn down the moment the
  // response is flushed, silently killing any pending awaits. That's why
  // people friending the account weren't showing up in the pending list —
  // the response was going out before the profile fetch + save() ever ran.
  const token = store.settings.line_channel_access_token;
  const events = (req.body && req.body.events) || [];
  let changed = false;

  store.settings.line_targets = store.settings.line_targets || [];
  store.settings.line_pending_followers = store.settings.line_pending_followers || [];

  for (const event of events) {
    const userId = event.source && event.source.userId;
    if (!userId) continue;

    if (event.type === "follow") {
      const alreadyApproved = store.settings.line_targets.some((t) => t.userId === userId);
      const alreadyPending = store.settings.line_pending_followers.some((p) => p.userId === userId);

      if (!alreadyApproved && !alreadyPending) {
        const profile = token ? await getLineProfile(token, userId) : null;
        store.settings.line_pending_followers.push({
          userId,
          displayName: (profile && profile.displayName) || "(이름 확인 불가)",
          pictureUrl: (profile && profile.pictureUrl) || null,
          followed_at: new Date().toISOString(),
        });
        changed = true;
      }
      if (token && event.replyToken) {
        await replyLine(
          token,
          event.replyToken,
          alreadyApproved
            ? "✅ 이미 마감 요약을 받고 계세요!"
            : "안녕하세요! 이 계정은 정산 알림 전용이에요. 사장님이 확인 후 연결해드릴게요 🙏"
        );
      }
    } else if (event.type === "unfollow") {
      const beforeTargets = store.settings.line_targets.length;
      const beforePending = store.settings.line_pending_followers.length;
      store.settings.line_targets = store.settings.line_targets.filter((t) => t.userId !== userId);
      store.settings.line_pending_followers = store.settings.line_pending_followers.filter((p) => p.userId !== userId);
      if (store.settings.line_targets.length !== beforeTargets || store.settings.line_pending_followers.length !== beforePending) {
        changed = true;
      }
    }
  }

  if (changed) await save();

  res.status(200).json({ ok: true });
});

module.exports = router;
