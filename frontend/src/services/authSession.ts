export function clearAuthSession() {
  localStorage.removeItem('cido_user');
  localStorage.removeItem('cido_token');
}
