import { http } from './http';
import type { AuthResponse, SignupPayload, User, UserRole } from '../types/api';

export async function login(email: string, password: string) {
  const response = await http.post<AuthResponse>('/auth/login', { email, password });
  return response.data;
}

export async function getProfile() {
  const response = await http.get('/auth/me');
  return response.data;
}

export async function assignUserRole(userId: number, role: UserRole) {
  const response = await http.put<User>(`/auth/users/${userId}/role`, { role });
  return response.data;
}

export async function getUsers(role?: UserRole) {
  const response = await http.get<User[]>('/auth/users', { params: role ? { role } : undefined });
  return response.data;
}

export async function createUser(payload: SignupPayload & { role: UserRole }) {
  const response = await http.post<User>('/auth/users', payload);
  return response.data;
}

export async function resetUserPassword(userId: number, password: string) {
  const response = await http.post<User>(`/auth/users/${userId}/reset-password`, { password });
  return response.data;
}

export async function revokeUserAccess(userId: number) {
  const response = await http.post<User>(`/auth/users/${userId}/revoke`);
  return response.data;
}

export async function restoreUserAccess(userId: number) {
  const response = await http.post<User>(`/auth/users/${userId}/restore`);
  return response.data;
}

export async function deleteUser(userId: number, deleteLogs = false) {
  await http.delete(`/auth/users/${userId}?delete_logs=${deleteLogs}`);
}
