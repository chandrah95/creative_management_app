// Shared API client — reads token from localStorage or sessionStorage
function getToken() {
  return localStorage.getItem('crp_token') || sessionStorage.getItem('crp_token');
}

async function request(method, path, body) {
  const token = getToken();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data;
}

window.api = {
  get:    (path)         => request('GET',    path),
  post:   (path, body)   => request('POST',   path, body),
  put:    (path, body)   => request('PUT',    path, body),
  delete: (path)         => request('DELETE', path),
};

window.logout = function () {
  localStorage.removeItem('crp_token');
  localStorage.removeItem('crp_user');
  sessionStorage.removeItem('crp_token');
  sessionStorage.removeItem('crp_user');
  window.location.href = '/';
};

// Guard: redirect to login if no token
(function checkAuth() {
  if (window.location.pathname === '/' || window.location.pathname === '/login') return;
  if (!getToken()) window.location.href = '/';
})();
