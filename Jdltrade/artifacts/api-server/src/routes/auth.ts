import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

const router: IRouter = Router();

const mockUsers: Record<string, { id: string; name: string; email: string; subscription: string; passwordHash: string }> = {
  "darcel@jdl.trading": {
    id: "u-001",
    name: "Darcel King",
    email: "darcel@jdl.trading",
    subscription: "pro",
    passwordHash: "hashed_password",
  },
};

router.post("/auth/register", (req, res) => {
  const { name, email, password } = req.body as { name: string; email: string; password: string };
  if (!name || !email || !password) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  if (mockUsers[email]) {
    res.status(409).json({ error: "User already exists" });
    return;
  }
  const user = {
    id: `u-${Date.now()}`,
    name,
    email,
    subscription: "free",
    passwordHash: "hashed",
  };
  mockUsers[email] = user;

  req.session.userId = user.id;
  res.json({
    user: { id: user.id, name: user.name, email: user.email, subscription: user.subscription },
  });
});

router.post("/auth/login", (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const user = mockUsers[email];
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  req.session.userId = user.id;
  res.json({
    user: { id: user.id, name: user.name, email: user.email, subscription: user.subscription },
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "Failed to logout" });
      return;
    }
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out successfully" });
  });
});

router.get("/users/me", (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    res.json({
      id: "u-001",
      name: "Darcel King",
      email: "darcel@jdl.trading",
      subscription: "pro",
      kycStatus: "verified",
      twoFAEnabled: true,
      walletAddress: "0x7FD7f50ed0D0625887072a95426F6A5d1e0BD3bF",
      joinedAt: "2026-01-01T00:00:00Z",
    });
    return;
  }

  const user = Object.values(mockUsers).find(u => u.id === userId);
  if (!user) {
    res.status(401).json({ error: "Session expired" });
    return;
  }

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    subscription: user.subscription,
    kycStatus: "verified",
    twoFAEnabled: true,
    walletAddress: "0x7FD7f50ed0D0625887072a95426F6A5d1e0BD3bF",
    joinedAt: "2026-01-01T00:00:00Z",
  });
});

export default router;
