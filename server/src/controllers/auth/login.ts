import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LoginBody } from '../../interfaces/users';
import {
  getUserProfileById,
  UsersService,
  UsersServiceError,
} from '../../services/users.service';
import {
  AuthorizationError,
  getEffectivePermissions,
} from '../../services/authorization.service';
import {
  AuthSessionError,
  AuthSessionsService,
  authSessionMetadata,
  clearRefreshCookie,
  getRefreshCookie,
  setRefreshCookie,
} from '../../services/auth-sessions.service';

const authPayload = async (
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  sessionId: string,
) => {
  const [access, publicData] = await Promise.all([
    getEffectivePermissions(request.server, userId, sessionId),
    getUserProfileById(request.server, userId),
  ]);
  if (!publicData) throw new AuthorizationError(403, 'Hồ sơ người dùng không còn hợp lệ');
  const accessToken = await reply.jwtSign({ sub: userId, sid: sessionId });
  return {
    accessToken,
    publicData,
    roleIds: access.roleIds,
    permissions: access.permissions,
    isSystemAdmin: access.isSystemAdmin,
  };
};

export const loginUser = async (request: FastifyRequest, reply: FastifyReply) => {
  const { vinfast_id, password } = request.body as LoginBody;

  if (!Number.isInteger(vinfast_id) || !password) {
    return reply.code(400).send({
      error: 'VinFast ID và mật khẩu là bắt buộc',
    });
  }

  try {
    const publicData = await new UsersService(request.server).authenticate(
      vinfast_id,
      password,
    );
    const sessions = new AuthSessionsService(request.server);
    const session = await sessions.create(
      publicData.id,
      authSessionMetadata(request),
    );

    try {
      const payload = await authPayload(
        request,
        reply,
        publicData.id,
        session.sessionId,
      );
      setRefreshCookie(reply, session.refreshToken, session.expiresAt);

      return reply.code(200).send({
        message: 'Đăng nhập thành công',
        ...payload,
      });
    } catch (error) {
      await sessions.revokeSession(session.sessionId);
      throw error;
    }
  } catch (error) {
    if (error instanceof UsersServiceError
        || error instanceof AuthorizationError
        || error instanceof AuthSessionError) {
      return reply.code(error.statusCode).send({
        error: error.message,
        ...(error.message.includes('chờ duyệt')
          ? { code: 'ACCOUNT_NOT_VERIFIED' }
          : {}),
      });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Lỗi máy chủ nội bộ' });
  }
};

export const refreshSession = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const sessions = new AuthSessionsService(request.server);
  try {
    const session = await sessions.rotate(getRefreshCookie(request));
    try {
      const payload = await authPayload(
        request,
        reply,
        session.userId,
        session.sessionId,
      );
      // A grace-window replay must not touch the cookie: the rotation it lost to
      // already stored a newer token in the same browser.
      if (session.rotated) {
        setRefreshCookie(reply, session.refreshToken, session.expiresAt);
      }
      return reply.code(200).send(payload);
    } catch (error) {
      await sessions.revokeSession(session.sessionId);
      throw error;
    }
  } catch (error) {
    clearRefreshCookie(reply);
    if (error instanceof AuthSessionError || error instanceof AuthorizationError) {
      const statusCode = error.statusCode >= 500 ? 500 : 401;
      return reply.code(statusCode).send({
        error: statusCode === 401
          ? 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn'
          : 'Không thể làm mới phiên đăng nhập',
      });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Lỗi máy chủ nội bộ' });
  }
};

export const logoutUser = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    await new AuthSessionsService(request.server).revokeCurrent(
      getRefreshCookie(request),
    );
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Không thể đóng phiên đăng nhập' });
  } finally {
    clearRefreshCookie(reply);
  }
  return reply.code(200).send({ message: 'Đăng xuất thành công' });
};

export const getMe = async (request: FastifyRequest, reply: FastifyReply) => {
  const userId = request.user?.id;

  if (!userId) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  try {
    const publicData = await getUserProfileById(request.server, userId);

    if (!publicData) {
      return reply.code(404).send({ error: 'Không tìm thấy hồ sơ người dùng' });
    }

    return reply.code(200).send({
      id: userId,
      email: request.user?.email,
      publicData,
      roleIds: request.user.roleIds,
      permissions: request.user.permissions,
      isSystemAdmin: request.user.isSystemAdmin,
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'Lỗi máy chủ nội bộ' });
  }
};
