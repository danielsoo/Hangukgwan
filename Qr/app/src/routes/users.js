// Owner-only account management — the admin 계정 tab. This is where a
// person who signed up on the website as an ordinary customer gets promoted
// to 직원(staff) or 사장(owner), which is what makes the 관리자 페이지 button
// appear for them on the homepage.
//
// Everything here is requireOwner, not requireAdmin: staff must never be
// able to promote themselves (or anyone else), which would be a trivial way
// around every 직원 권한 toggle the owner has switched off.
const express = require("express");
const accounts = require("../accounts");
const { requireOwner } = require("../auth");

const router = express.Router();

router.get("/", requireOwner, async (req, res) => {
  try {
    const users = await accounts.listUsers();
    res.json({ users: users.map(accounts.publicUser) });
  } catch (e) {
    console.error("[users] list failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/:id/role", requireOwner, async (req, res) => {
  const { role } = req.body || {};
  if (!accounts.ROLES.includes(role)) return res.status(400).json({ error: "invalid_role" });

  try {
    const target = await accounts.findById(req.params.id);
    if (!target) return res.status(404).json({ error: "not_found" });

    // Two ways to lock everyone out of the owner role, both blocked here:
    //   1. demoting yourself (the common accident — you're the one clicking)
    //   2. demoting the last remaining owner
    // Either would leave the restaurant with no one who can grant the role
    // back, recoverable only by the legacy password login. That fallback
    // exists, but relying on it as the recovery path for a two-click mistake
    // is not a design.
    if (target.role === "owner" && role !== "owner") {
      if (String(target._id) === String(req.session.userId)) {
        return res.status(400).json({ error: "cannot_demote_self" });
      }
      const owners = await accounts.countOwners();
      if (owners <= 1) return res.status(400).json({ error: "last_owner" });
    }

    const updated = await accounts.setRole(req.params.id, role);
    res.json({ user: accounts.publicUser(updated) });
  } catch (e) {
    if (e.message === "invalid_role") return res.status(400).json({ error: "invalid_role" });
    console.error("[users] role change failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
