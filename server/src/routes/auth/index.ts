import { FastifyPluginAsync } from "fastify";
import {
  getMe,
  loginUser,
  logoutUser,
  refreshSession,
} from "../../controllers/auth/login";
import { verifyToken } from '../../middleware/auth';
import {
  loginSchema,
  logoutSchema,
  refreshSessionSchema,
} from "../../schemas/users";
import { requireTrustedAuthOrigin } from '../../services/auth-sessions.service';

/**
 * /refresh and /logout carry no Bearer token, so anyone can reach them, and a
 * refresh costs an RPC plus a full permission load. Without a cap that is a
 * cheap amplifier. The ceiling is well above real usage: an access token lives
 * 30 minutes, so a busy operator refreshes a couple of times an hour and the
 * rest of the budget only absorbs tab reloads behind a shared NAT address.
 */
const SESSION_ENDPOINT_RATE_LIMIT = {
  max: 60,
  timeWindow: '1 minute',
} as const;

const authRoutes: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.post("/login", {
    schema: loginSchema,
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  }, loginUser);
  fastify.post('/refresh', {
    schema: refreshSessionSchema,
    config: { rateLimit: SESSION_ENDPOINT_RATE_LIMIT },
    preHandler: [requireTrustedAuthOrigin],
  }, refreshSession);
  fastify.post('/logout', {
    schema: logoutSchema,
    config: { rateLimit: SESSION_ENDPOINT_RATE_LIMIT },
    preHandler: [requireTrustedAuthOrigin],
  }, logoutUser);
  fastify.get("/me",{
    preHandler: [verifyToken]
  }, getMe)
};
export default authRoutes;
