// src/services/authService.js

export async function login({ email, password }) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || '로그인 실패');
    }
  
    return res.json(); // { message, token, user }
  }
  