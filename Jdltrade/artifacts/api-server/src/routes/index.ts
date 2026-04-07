import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import agentsRouter from "./agents";
import flashLoansRouter from "./flash-loans";
import walletsRouter from "./wallets";
import analyticsRouter from "./analytics";
import marketRouter from "./market";
import blockchainRouter from "./blockchain";
import creditOracleRouter from "./credit-oracle";
import activityRouter from "./activity.js";
import subscriptionsRouter from "./subscriptions";
import stripeRouter from "./stripe.js";
import usersRouter from "./users.js";
import dashboardRouter from "./dashboard.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use("/users", usersRouter);
router.use(agentsRouter);
router.use(flashLoansRouter);
router.use(walletsRouter);
router.use(analyticsRouter);
router.use(marketRouter);
router.use("/blockchain", blockchainRouter);
router.use(creditOracleRouter);
router.use(activityRouter);
router.use(subscriptionsRouter);
router.use(stripeRouter);
router.use(dashboardRouter);

export default router;
