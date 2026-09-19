import type { LoginResponse, UserMessageResponse } from "../types/users";
import instance from "./http";

export interface LoginInput {
    vinfast_id: string;
    password: string;
}

export const login = async (input: LoginInput): Promise<LoginResponse> =>
  instance.post<LoginResponse, LoginResponse>('auth/login', input);

export const logout = async (): Promise<UserMessageResponse> =>
  instance.post<UserMessageResponse, UserMessageResponse>('auth/logout');
